// engine.mjs — pure functions over venue results. No I/O, no clock (callers pass `now`),
// no network. Everything the API and the sampler decide is decided here so it can be
// tested offline.
//
// Venue results follow src/util.mjs: { venue, status: 'ok'|'no_route'|'failed', proceedsUsdc, ... }.
// `failed` is never read as zero. Only status === 'ok' carries proceeds.

import { TOP_VENUES } from './venues/index.mjs';

export const TOLERANCES_BPS = [50, 100, 200, 500];
export const SIZES_USD = [1_000, 10_000, 100_000, 1_000_000];
/** Disagreement threshold between the two best venues, in bps of the best proceeds. */
export const DEFAULT_DISAGREE_BPS = 300;
/** Max share of the published depth any single independent venue may carry. */
export const DEFAULT_SHARE_CAP = 0.6;

export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (a.length === 0) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const okRows = (rows, venues = TOP_VENUES) => rows.filter((r) => r.status === 'ok' && venues.includes(r.venue) && r.proceedsUsdc > 0);

/**
 * THE MARK. Median of proceeds-per-unit over the venues that answered at the
 * smallest size ($1k). Why not an oracle: it needs no extra dependency, it is
 * contemporaneous with the exit quotes it is compared against, and at $1k every
 * venue's price impact is a few bps so the median is a fair "price right now".
 * What it hides: if every venue is wrong together at $1k the mark is wrong too, and
 * the fee a venue charges is inside it. Returns null when fewer than `minVenues` answered.
 */
export function markFromSmallQuotes(rows, units, minVenues = 1) {
  if (!(units > 0)) throw new RangeError('units must be > 0');
  const ok = okRows(rows);
  if (ok.length < minVenues) return null;
  return median(ok.map((r) => r.proceedsUsdc / units));
}

/** Cost of an exit versus the mark, in bps. Positive = worse than mark. */
export function costBps(mark, units, proceeds) {
  if (!(mark > 0) || !(units > 0)) throw new RangeError('mark and units must be > 0');
  if (!Number.isFinite(proceeds)) throw new TypeError('proceeds must be finite');
  return (1 - proceeds / (mark * units)) * 1e4;
}

/** Best exit among the four venues: the one that pays the most. null if none answered. */
export function bestExit(rows) {
  let best = null;
  for (const r of okRows(rows)) if (!best || r.proceedsUsdc > best.proceedsUsdc) best = r;
  return best;
}

/**
 * Disagreement between venues at one (asset, size). spreadBps is the gap between
 * the best and second-best proceeds as bps of the best. Flag when it exceeds the
 * threshold. With one answering venue there is nothing to compare: flag stays
 * false and `comparable` is false, so a reader can tell "agree" from "alone".
 */
export function disagreement(rows, thresholdBps = DEFAULT_DISAGREE_BPS) {
  const p = okRows(rows).map((r) => r.proceedsUsdc).sort((a, b) => b - a);
  if (p.length < 2) return { comparable: false, spreadBps: null, fullSpreadBps: null, flag: false, thresholdBps };
  const spreadBps = (1 - p[1] / p[0]) * 1e4;
  const fullSpreadBps = (1 - p[p.length - 1] / p[0]) * 1e4;
  return { comparable: true, spreadBps, fullSpreadBps, flag: spreadBps > thresholdBps, thresholdBps };
}

/**
 * Largest size whose cost stays within tolerance, read off a measured curve
 * [{usd, bps}] by log-size / linear-bps interpolation between samples.
 * METHOD: 'interpolated_quotes'. It never extrapolates past the largest sample:
 * if even that is within tolerance the answer is a LOWER BOUND (limitedBy 'sample_cap');
 * if even the smallest is over, the answer is 0 with limitedBy 'below_min_sample'.
 * Points with null bps (venue failed) are skipped, not treated as zero cost.
 */
export function interpolateSafeSize(points, tolBps) {
  const pts = points.filter((p) => Number.isFinite(p.bps) && p.usd > 0).sort((a, b) => a.usd - b.usd);
  if (pts.length === 0) return { safeUsd: null, limitedBy: 'no_data', method: 'interpolated_quotes' };
  if (pts[0].bps > tolBps) return { safeUsd: 0, limitedBy: 'below_min_sample', method: 'interpolated_quotes' };
  // walk until the curve first crosses the tolerance (monotone cost assumed from there)
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].bps > tolBps) {
      const a = pts[i - 1], b = pts[i];
      const t = (tolBps - a.bps) / (b.bps - a.bps);
      const safe = Math.exp(Math.log(a.usd) + t * (Math.log(b.usd) - Math.log(a.usd)));
      return { safeUsd: safe, limitedBy: 'tolerance', method: 'interpolated_quotes' };
    }
  }
  return { safeUsd: pts[pts.length - 1].usd, limitedBy: 'sample_cap', method: 'interpolated_quotes' };
}

/**
 * Bisection on live quotes, for AMM venues where there is no closed form.
 * quoteBps(usd) -> Promise<number|null>; null means the quote FAILED, which aborts
 * the search (reporting 'failed') instead of being treated as "too expensive".
 * Assumes cost is non-decreasing in size. Terminates in at most `iters` quotes.
 * METHOD: 'bisection_quotes'.
 */
export async function bisectSafeSize(quoteBps, { lo, hi, tolBps, iters = 8 }) {
  const base = { method: 'bisection_quotes', quotes: 0 };
  const q = async (usd) => { base.quotes++; return quoteBps(usd); };
  const cLo = await q(lo);
  if (cLo === null) return { ...base, safeUsd: null, limitedBy: 'failed' };
  if (cLo > tolBps) return { ...base, safeUsd: 0, limitedBy: 'below_min_sample' };
  const cHi = await q(hi);
  if (cHi === null) return { ...base, safeUsd: null, limitedBy: 'failed' };
  if (cHi <= tolBps) return { ...base, safeUsd: hi, limitedBy: 'sample_cap' };
  let a = lo, b = hi; // cost(a) <= tol < cost(b)
  for (let i = 0; i < iters; i++) {
    const m = Math.sqrt(a * b); // geometric midpoint: sizes span decades
    const c = await q(m);
    if (c === null) return { ...base, safeUsd: a, limitedBy: 'failed_partial' };
    if (c <= tolBps) a = m; else b = m;
  }
  return { ...base, safeUsd: a, limitedBy: 'tolerance' };
}

/**
 * Manipulation resistance, part 1: time-weighted depth.
 * series: [{ts (ms), v}] ascending. Each sample holds until the next (step function)
 * and the last holds until `now`. Returns the time-weighted mean over [now-windowMs, now]
 * AND the appearing-level discount: effective = min(mean, latest). A level that has
 * only just appeared is averaged down by the window; one that just vanished drops at
 * once. So a one-cycle spike in depth cannot raise the published number, and a drop
 * cannot be hidden. Returns null when the series has no sample in/before the window.
 */
export function effectiveDepth(series, now, windowMs) {
  const s = series.filter((p) => Number.isFinite(p.v) && p.ts <= now).sort((a, b) => a.ts - b.ts);
  if (s.length === 0) return null;
  const start = now - windowMs;
  let acc = 0, covered = 0;
  for (let i = 0; i < s.length; i++) {
    const from = Math.max(s[i].ts, start);
    const to = i + 1 < s.length ? s[i + 1].ts : now;
    if (to <= start) continue;
    const w = to - from;
    if (w > 0) { acc += s[i].v * w; covered += w; }
  }
  if (covered === 0) return null;
  const mean = acc / covered;
  const latest = s[s.length - 1].v;
  return { mean, latest, effective: Math.min(mean, latest), coveredFraction: covered / windowMs };
}

/**
 * Manipulation resistance, part 2: venue share cap.
 * depths: { venue: safeUsd } for INDEPENDENT venues (caller removes overlap: the
 * aggregator and Broker re-route over the same pools, so only count them once).
 * No venue may carry more than `cap` of the published total, so each venue's counted
 * depth is limited to cap/(1-cap) x the sum of the others. Iterated to a fixed point.
 * A single venue alone is therefore never trusted: published = 0, limitedBy 'single_venue'.
 */
export function cappedDepth(depths, cap = DEFAULT_SHARE_CAP) {
  if (!(cap > 0 && cap < 1)) throw new RangeError('cap must be in (0,1)');
  const names = Object.keys(depths).filter((k) => Number.isFinite(depths[k]) && depths[k] > 0);
  if (names.length === 0) return { published: 0, counted: {}, shares: {}, limitedBy: 'no_depth' };
  if (names.length === 1) return { published: 0, counted: { [names[0]]: 0 }, shares: { [names[0]]: 0 }, limitedBy: 'single_venue' };
  const ratio = cap / (1 - cap);
  let counted = Object.fromEntries(names.map((n) => [n, depths[n]]));
  for (let i = 0; i < 50; i++) {
    let changed = false;
    for (const n of names) {
      const others = names.reduce((s, m) => (m === n ? s : s + counted[m]), 0);
      const lim = ratio * others;
      if (counted[n] > lim + 1e-9) { counted[n] = lim; changed = true; }
    }
    if (!changed) break;
  }
  const published = names.reduce((s, n) => s + counted[n], 0);
  const shares = Object.fromEntries(names.map((n) => [n, published > 0 ? counted[n] / published : 0]));
  const capped = names.some((n) => counted[n] < depths[n] - 1e-9);
  return { published, counted, shares, limitedBy: capped ? 'share_cap' : 'none' };
}

/**
 * Staleness: a reading older than `boundS` is stale. The consumer rule is HOLD,
 * never raise: on a stale reading the safe size may be kept or lowered, not raised.
 */
export function staleness(tsMs, nowMs, boundS) {
  if (!Number.isFinite(tsMs)) return { ageS: null, stale: true, reason: 'no_reading' };
  const ageS = Math.max(0, (nowMs - tsMs) / 1000);
  return { ageS, stale: ageS > boundS, reason: ageS > boundS ? 'older_than_bound' : null };
}

/** Consumer rule, as code so it is tested: next limit given a fresh/stale reading. */
export function nextLimit(currentLimit, published, stale) {
  if (stale || published === null || published === undefined) return currentLimit; // hold: neither raise nor act on an old number
  return published; // fresh: may go up or down
}

/**
 * Per-asset stale bound from measured drift. Given cycle timestamps (ms) and the
 * per-cycle marks, the bound is the longest the mark can sit unobserved before it has
 * plausibly moved more than `driftBps` at the asset's own measured volatility:
 *   sigma_cycle = stdev of log-returns between consecutive cycles
 *   cycles_allowed = (driftBps/1e4 / sigma_cycle)^2   (random-walk: sigma grows with sqrt(n))
 * bound = clamp(cycles_allowed * median cycle gap, minS, maxS).
 */
export function staleBoundFromDrift(samples, { driftBps = 100, minS = 1200, maxS = 7200 } = {}) {
  const s = samples.filter((p) => p.mark > 0 && Number.isFinite(p.ts)).sort((a, b) => a.ts - b.ts);
  if (s.length < 6) return { boundS: minS * 2, basis: 'too_few_samples', n: s.length };
  const rets = [], gaps = [];
  for (let i = 1; i < s.length; i++) { rets.push(Math.log(s[i].mark / s[i - 1].mark)); gaps.push((s[i].ts - s[i - 1].ts) / 1000); }
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sigma = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
  const gap = median(gaps);
  const n = sigma > 0 ? (driftBps / 1e4 / sigma) ** 2 : Infinity;
  const raw = Number.isFinite(n) ? n * gap : maxS;
  return { boundS: Math.round(Math.min(maxS, Math.max(minS, raw))), basis: 'drift', sigmaCycle: sigma, cycleGapS: gap, n: s.length };
}
