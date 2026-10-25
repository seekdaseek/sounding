// sampler.mjs — one measurement cycle: every asset x every size x every venue -> sqlite.
//
// Pipeline per asset (assets run concurrently, but every venue has its own serial lane
// with a minimum gap, so each venue sees a steady, limit-respecting request rate):
//   A. quote the smallest size ($1k) on every venue, sized from the previous mark
//   B. mark = median of the answering venues' proceeds/unit  (engine.markFromSmallQuotes)
//   C. quote $10k, $100k, $1M sized from that mark
//   D. closed-form safe sizes on the direct SDEX orderbook (src/depth.mjs)
// Each answer is stored as ok | no_route | failed(kind). Nothing failed is stored as zero.
import { Lane } from './util.mjs';
import { horizon, aquarius, broker, soroswap } from './venues/index.mjs';
import { markFromSmallQuotes, costBps, SIZES_USD, TOLERANCES_BPS } from './engine.mjs';
import { insertSamples } from './store.mjs';
import { normaliseBids, safeCollateralSize, bookDepth } from './depth.mjs';
import { USDC_ISSUER } from './util.mjs';

export const LANE_GAPS_MS = { sdex_horizon: 350, aquarius: 300, broker: 400, soroswap_agg: 1150 };

export function makeLanes() {
  return Object.fromEntries(Object.entries(LANE_GAPS_MS).map(([k, g]) => [k, new Lane(k, g)]));
}

/** The tasks for one (asset, units): [{ venueName, lane, run() }]. */
export function tasksFor(req, ctx) {
  const { lanes, apiKey, fetch: f } = ctx;
  const t = [
    { lane: 'sdex_horizon', run: () => horizon.quote(req, { fetch: f, lane: lanes.sdex_horizon }) },
    { lane: 'aquarius', run: () => aquarius.quote(req, { fetch: f, lane: lanes.aquarius }) },
    { lane: 'broker', run: () => broker.quote(req, { fetch: f, lane: lanes.broker }) },
    { lane: 'soroswap_agg', run: () => soroswap.quote(req, { fetch: f, lane: lanes.soroswap_agg, apiKey, protocols: soroswap.PROTOCOLS }) },
  ];
  // per-protocol depth only when we have a key; without one a single aggregate row says no_key
  if (apiKey) for (const p of soroswap.PROTOCOLS) {
    t.push({ lane: 'soroswap_agg', run: () => soroswap.quote(req, { fetch: f, lane: lanes.soroswap_agg, apiKey, protocols: [p] }) });
  }
  return t;
}

async function timed(lanes, task) {
  const t0 = Date.now();
  const r = await lanes[task.lane].run(task.run);
  return { ...r, ms: Date.now() - t0, tsMs: Date.now() };
}

export async function quoteAll(req, ctx) {
  return Promise.all(tasksFor(req, ctx).map((t) => timed(ctx.lanes, t)));
}

function toRow(cycleId, asset, sizeUsd, units, mark, r) {
  const row = { cycle_id: cycleId, ts: r.tsMs ?? Date.now(), asset: asset.id, size_usd: sizeUsd, units, venue: r.venue, status: r.status, ms: r.ms };
  if (r.status === 'ok') {
    row.proceeds = r.proceedsUsdc;
    row.bps = mark ? costBps(mark, units, r.proceedsUsdc) : null;
    row.route = r.route;
  } else if (r.status === 'no_route') row.detail = r.detail;
  else { row.fail_kind = r.failure.kind; row.detail = r.failure.detail; }
  return row;
}

/** Last stored non-null mark for an asset, or null. */
export function lastMark(db, assetId) {
  const r = db.prepare('SELECT mark FROM marks WHERE asset = ? AND mark IS NOT NULL ORDER BY ts DESC LIMIT 1').get(assetId);
  return r ? r.mark : null;
}

async function bookSafe(db, cycleId, asset, mark, ctx) {
  if (asset.native === undefined) return;
  const lane = ctx.lanes.sdex_horizon;
  const q = new URLSearchParams(asset.native ? { selling_asset_type: 'native' }
    : { selling_asset_type: asset.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12', selling_asset_code: asset.code, selling_asset_issuer: asset.issuer });
  q.set('buying_asset_type', 'credit_alphanum4'); q.set('buying_asset_code', 'USDC'); q.set('buying_asset_issuer', USDC_ISSUER); q.set('limit', '200');
  const r = await lane.run(async () => {
    try { const res = await ctx.fetch(`https://horizon.stellar.org/order_book?${q}`); return res.ok ? await res.json() : null; } catch { return null; }
  });
  if (!r || !Array.isArray(r.bids)) return;
  const { levels } = normaliseBids(r.bids, 'base');
  const ts = Date.now();
  const ins = db.prepare('INSERT OR REPLACE INTO book_safe (cycle_id, ts, asset, tol_bps, safe_units, safe_usd, limited_by, depth_units, bid_levels) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const tol of TOLERANCES_BPS) {
    const s = safeCollateralSize(levels, mark, tol);
    ins.run(cycleId, ts, asset.id, tol, s.safeSize, s.safeValue, s.limitedBy, bookDepth(levels), r.bids.length);
  }
}

export async function runCycle(db, universe, ctx, { log = () => {} } = {}) {
  const ts0 = Date.now();
  const cycleId = Number(db.prepare('INSERT INTO cycles (ts_start, assets) VALUES (?, ?)').run(ts0, universe.assets.length).lastInsertRowid);
  let nRows = 0;

  const perAsset = async (asset) => {
    // A. size the smallest quote from the previous mark; seed with a 1-unit Horizon probe on cold start
    let prev = lastMark(db, asset.id);
    if (!prev) {
      const seed = await ctx.lanes.sdex_horizon.run(() => horizon.quote({ asset, units: 1 }, { fetch: ctx.fetch, lane: ctx.lanes.sdex_horizon }));
      prev = seed.status === 'ok' ? seed.proceedsUsdc : asset.seed_price_usdc;
    }
    const sizes = SIZES_USD;
    let u0 = sizes[0] / prev;
    let rowsA = await quoteAll({ asset, units: u0, sizeUsd: sizes[0] }, ctx);
    let mark = markFromSmallQuotes(rowsA, u0);
    // Cold start or a big move: the previous mark was off, so the "$1k" quote was not $1k.
    // Re-quote once at the size the new mark implies, so the nominal size is honest.
    if (mark && Math.abs(u0 * mark - sizes[0]) / sizes[0] > 0.02) {
      u0 = sizes[0] / mark;
      rowsA = await quoteAll({ asset, units: u0, sizeUsd: sizes[0] }, ctx);
      mark = markFromSmallQuotes(rowsA, u0);
    }
    db.prepare('INSERT OR REPLACE INTO marks (cycle_id, ts, asset, mark, n_venues) VALUES (?,?,?,?,?)')
      .run(cycleId, Date.now(), asset.id, mark, rowsA.filter((r) => r.status === 'ok').length);
    const out = rowsA.map((r) => toRow(cycleId, asset, sizes[0], u0, mark, r));
    if (!mark) {
      out.push({ cycle_id: cycleId, ts: Date.now(), asset: asset.id, size_usd: sizes[0], units: u0, venue: 'engine', status: 'failed', fail_kind: 'no_mark', detail: 'no venue answered at the smallest size; larger sizes skipped', ms: 0 });
      insertSamples(db, out); nRows += out.length; return;
    }
    // C. the larger sizes, sized from this cycle's mark
    for (const s of sizes.slice(1)) {
      const units = s / mark;
      const rows = await quoteAll({ asset, units, sizeUsd: s }, ctx);
      for (const r of rows) out.push(toRow(cycleId, asset, s, units, mark, r));
    }
    insertSamples(db, out); nRows += out.length;
    // D. closed form on the direct book
    await bookSafe(db, cycleId, asset, mark, ctx);
    log(`  ${asset.id}: mark=${mark.toPrecision(6)} rows=${out.length}`);
  };

  await Promise.all(universe.assets.map((a) => perAsset(a).catch((e) => log(`  ${a.id}: cycle error ${e?.message}`))));
  db.prepare('UPDATE cycles SET ts_end = ?, rows = ? WHERE cycle_id = ?').run(Date.now(), nRows, cycleId);
  return { cycleId, rows: nRows, ms: Date.now() - ts0 };
}
