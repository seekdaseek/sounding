// read.mjs — turns the stored samples into the answer to one question:
// "how much of asset X can I sell right now, and what does it cost, at size S?"
// Pure over a sqlite handle + a clock value; no network.
import { TOP_VENUES } from './venues/index.mjs';
import {
  SIZES_USD, TOLERANCES_BPS, DEFAULT_DISAGREE_BPS, DEFAULT_SHARE_CAP,
  bestExit, disagreement, interpolateSafeSize, effectiveDepth, cappedDepth, staleness, staleBoundFromDrift, costBps,
} from './engine.mjs';

/** Venues whose pools are independent of each other (aggregators and Broker re-route over these). */
export const INDEPENDENT_VENUES = ['sdex_horizon', 'aquarius', 'soroswap_agg:soroswap', 'soroswap_agg:sushi', 'soroswap_agg:comet'];
export const WINDOW_CYCLES = 6;           // time-weighted window = the last 6 cycles (~1 h at 10 min)
export const DEFAULT_STALE_S = 3600;

export function latestCycle(db, assetId) {
  return db.prepare('SELECT cycle_id, ts, mark, n_venues FROM marks WHERE asset = ? AND mark IS NOT NULL ORDER BY ts DESC LIMIT 1').get(assetId) || null;
}

export function cycleRows(db, cycleId, assetId) {
  return db.prepare('SELECT size_usd, units, venue, status, proceeds, bps, fail_kind, detail, ts FROM samples WHERE cycle_id = ? AND asset = ?').all(cycleId, assetId);
}

/** {venue: [{usd,bps}]} from one cycle's rows (ok rows only; gaps stay gaps). */
export function curves(rows) {
  const out = {};
  for (const r of rows) if (r.status === 'ok' && r.bps !== null) (out[r.venue] ||= []).push({ usd: r.size_usd, bps: r.bps });
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.usd - b.usd);
  return out;
}

/** Best-exit curve: at each measured size the lowest cost among the four top venues. */
export function bestCurve(rows) {
  const bySize = new Map();
  for (const r of rows) if (r.status === 'ok' && TOP_VENUES.includes(r.venue) && r.bps !== null) {
    const cur = bySize.get(r.size_usd);
    if (cur === undefined || r.bps < cur) bySize.set(r.size_usd, r.bps);
  }
  return [...bySize].map(([usd, bps]) => ({ usd, bps })).sort((a, b) => a.usd - b.usd);
}

/** One venue at an arbitrary size: exact when measured, log-size interpolation between ok brackets, else unavailable. */
export function venueAtSize(rows, venue, sizeUsd, mark) {
  const mine = rows.filter((r) => r.venue === venue).sort((a, b) => a.size_usd - b.size_usd);
  const exact = mine.find((r) => r.size_usd === sizeUsd);
  if (exact) return rowOut(exact, false);
  const lo = [...mine].reverse().find((r) => r.size_usd < sizeUsd), hi = mine.find((r) => r.size_usd > sizeUsd);
  if (lo?.status === 'ok' && hi?.status === 'ok') {
    const t = (Math.log(sizeUsd) - Math.log(lo.size_usd)) / (Math.log(hi.size_usd) - Math.log(lo.size_usd));
    const bps = lo.bps + t * (hi.bps - lo.bps);
    return { venue, status: 'ok', interpolated: true, cost_bps: round(bps), proceeds_usdc: round(sizeUsd * (1 - bps / 1e4), 2), units: sizeUsd / mark };
  }
  const why = [lo, hi].filter((x) => x && x.status !== 'ok').map((x) => `${x.status}${x.fail_kind ? ':' + x.fail_kind : ''}@${x.size_usd}`);
  return { venue, status: 'unavailable', interpolated: true, cost_bps: null, proceeds_usdc: null, note: why.length ? `bracketing sample not ok (${why.join(', ')})` : 'size outside measured range for this venue' };
}

const round = (x, d = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
function rowOut(r, interpolated) {
  const o = { venue: r.venue, status: r.status, interpolated, cost_bps: round(r.bps), proceeds_usdc: round(r.proceeds, 2), units: r.units };
  if (r.status === 'failed') o.failure_kind = r.fail_kind;
  if (r.status === 'no_route') o.detail = r.detail;
  return o;
}

/** Stale bound for an asset from its own mark history (last 24 h). */
export function staleBound(db, assetId, nowMs) {
  const m = db.prepare('SELECT ts, mark FROM marks WHERE asset = ? AND mark IS NOT NULL AND ts > ? ORDER BY ts').all(assetId, nowMs - 86_400_000);
  const b = staleBoundFromDrift(m);
  return { ...b, boundS: b.basis === 'too_few_samples' ? DEFAULT_STALE_S : b.boundS };
}

/** Safe size per tolerance for a rows-set, from the best-exit curve. */
function safeFor(rows) {
  const pts = bestCurve(rows);
  return Object.fromEntries(TOLERANCES_BPS.map((t) => [t, interpolateSafeSize(pts, t)]));
}

/** Closed-form safe sizes on the direct SDEX orderbook (latest cycle that stored them). */
export function bookSafe(db, assetId) {
  const rows = db.prepare('SELECT tol_bps, safe_usd, limited_by, bid_levels, ts FROM book_safe WHERE asset = ? AND cycle_id = (SELECT MAX(cycle_id) FROM book_safe WHERE asset = ?)').all(assetId, assetId);
  return Object.fromEntries(rows.map((r) => [r.tol_bps, { safe_usd: round(r.safe_usd, 0), limited_by: r.limited_by, bid_levels: r.bid_levels, method: 'closed_form_orderbook' }]));
}

export function exitReport(db, assetId, sizeUsd, nowMs, opts = {}) {
  const disagreeBps = opts.disagreeBps ?? DEFAULT_DISAGREE_BPS, cap = opts.shareCap ?? DEFAULT_SHARE_CAP;
  const lc = latestCycle(db, assetId);
  if (!lc) return { asset: assetId, size_usd: sizeUsd, status: 'no_data', stale: true, published: { status: 'no_data', publishable: false, reasons: ['no cycle with a mark yet'] } };
  const rows = cycleRows(db, lc.cycle_id, assetId);
  const ts = Math.max(...rows.map((r) => r.ts), lc.ts);
  const bound = staleBound(db, assetId, nowMs);
  const st = staleness(ts, nowMs, bound.boundS);

  const venueNames = [...new Set(rows.map((r) => r.venue))].filter((v) => v !== 'engine').sort();
  const venues = venueNames.map((v) => venueAtSize(rows, v, sizeUsd, lc.mark));
  const top = venues.filter((v) => TOP_VENUES.includes(v.venue));
  const topAsRows = top.map((v) => ({ venue: v.venue, status: v.status, proceedsUsdc: v.proceeds_usdc }));
  const best = bestExit(topAsRows);
  const dis = disagreement(topAsRows, disagreeBps);

  // price agreement at the smallest size is the refusal test (larger sizes legitimately diverge)
  const small = rows.filter((r) => r.size_usd === SIZES_USD[0]).map((r) => ({ venue: r.venue, status: r.status, proceedsUsdc: r.proceeds }));
  const priceAgree = disagreement(small, disagreeBps);

  // safe sizes: single-cycle best-exit, time-weighted over the window, per venue, share-capped
  const safeNow = safeFor(rows);
  const win = db.prepare('SELECT cycle_id, ts FROM marks WHERE asset = ? AND mark IS NOT NULL AND ts <= ? ORDER BY ts DESC LIMIT ?').all(assetId, nowMs, WINDOW_CYCLES).reverse();
  const winSafe = win.map((c) => ({ ts: c.ts, s: safeFor(cycleRows(db, c.cycle_id, assetId)) }));
  const safe = {}, published = {}, venueDepths = {};
  for (const t of TOLERANCES_BPS) {
    const series = winSafe.map((w) => ({ ts: w.ts, v: w.s[t].safeUsd })).filter((p) => p.v !== null);
    const tw = effectiveDepth(series, nowMs, WINDOW_CYCLES * 600_000 + 300_000);
    const per = {};
    for (const [v, pts] of Object.entries(curves(rows))) per[v] = interpolateSafeSize(pts, t).safeUsd ?? 0;
    const indep = Object.fromEntries(INDEPENDENT_VENUES.filter((v) => per[v] !== undefined).map((v) => [v, per[v]]));
    const capped = cappedDepth(indep, cap);
    venueDepths[t] = { per_venue_usd: Object.fromEntries(Object.entries(per).map(([k, x]) => [k, round(x, 0)])), independent_total_capped_usd: round(capped.published, 0), shares: Object.fromEntries(Object.entries(capped.shares).map(([k, x]) => [k, round(x, 3)])), cap_limited_by: capped.limitedBy };
    safe[t] = { ...safeNow[t], safe_usd: round(safeNow[t].safeUsd, 0) };
    const twEff = tw ? tw.effective : null;
    const pub = twEff === null ? null : Math.min(twEff, capped.published);
    published[t] = { safe_usd: pub === null ? null : round(pub, 0), time_weighted_usd: round(twEff, 0), venue_capped_usd: round(capped.published, 0), window_cycles: win.length };
  }

  const reasons = [];
  if (st.stale) reasons.push('stale');
  if (priceAgree.flag) reasons.push('venues_disagree');
  if (!priceAgree.comparable) reasons.push('fewer_than_two_venues_at_1k');
  if (Object.values(venueDepths).every((d) => d.cap_limited_by === 'single_venue' || d.cap_limited_by === 'no_depth')) reasons.push('single_venue_depth');
  const publishable = reasons.length === 0;
  return {
    asset: assetId, size_usd: sizeUsd,
    ts: new Date(ts).toISOString(), age_s: Math.round(st.ageS ?? -1), stale: st.stale, stale_bound_s: bound.boundS, stale_bound_basis: bound.basis,
    mark_usdc: lc.mark, cycle_id: lc.cycle_id,
    venues, best: best ? { venue: best.venue, proceeds_usdc: best.proceedsUsdc, cost_bps: round(costBps(lc.mark, sizeUsd / lc.mark, best.proceedsUsdc)) } : null,
    disagreement: { ...dis, spreadBps: round(dis.spreadBps), fullSpreadBps: round(dis.fullSpreadBps) },
    price_agreement_at_1k: { ...priceAgree, spreadBps: round(priceAgree.spreadBps), fullSpreadBps: round(priceAgree.fullSpreadBps) },
    safe_size: { method: 'interpolated_quotes over the best-exit curve; book entry is closed_form_orderbook', tolerance_bps: safe, orderbook_closed_form: bookSafe(db, assetId) },
    venue_depths: venueDepths,
    published: { status: publishable ? 'ok' : (reasons.includes('stale') ? 'stale' : 'refused'), publishable, reasons, safe_size_usd: published, consumer_rule: 'on stale or refused: hold the current limit, never raise' },
  };
}

/** Headline: cost per top venue at one size, latest cycle. Used by the landing page. */
export function headline(db, assetId, sizeUsd, nowMs) {
  const lc = latestCycle(db, assetId); if (!lc) return null;
  const rows = cycleRows(db, lc.cycle_id, assetId);
  const venues = TOP_VENUES.map((v) => venueAtSize(rows, v, sizeUsd, lc.mark));
  const ts = Math.max(...rows.map((r) => r.ts));
  return { asset: assetId, size_usd: sizeUsd, ts, age_s: Math.round((nowMs - ts) / 1000), mark: lc.mark, venues };
}

export function stats(db, universe, nowMs) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const total = one("SELECT COUNT(*) n, MIN(ts) a, MAX(ts) b FROM samples");
  const cyc = one("SELECT COUNT(*) n FROM cycles WHERE rows > 0");
  const byV = db.prepare("SELECT venue, status, COALESCE(fail_kind,'') k, COUNT(*) n FROM samples GROUP BY 1,2,3").all();
  const venues = {};
  for (const r of byV) { const v = (venues[r.venue] ||= { ok: 0, no_route: 0, failed: 0, failures_by_kind: {} }); v[r.status] += r.n; if (r.status === 'failed') v.failures_by_kind[r.k] = r.n; }
  const lastCycle = one('SELECT MAX(ts_start) t FROM cycles WHERE rows > 0');
  return {
    samples: total.n, cycles: cyc.n,
    assets: universe.assets.map((a) => a.id), sizes_usd: SIZES_USD, tolerances_bps: TOLERANCES_BPS,
    venues, first_ts: total.a ? new Date(total.a).toISOString() : null, last_ts: total.b ? new Date(total.b).toISOString() : null,
    last_cycle_age_s: lastCycle.t ? Math.round((nowMs - lastCycle.t) / 1000) : null,
    cycle_interval_s: 600,
    license: 'CC BY 4.0 (data), MIT (code)',
  };
}
