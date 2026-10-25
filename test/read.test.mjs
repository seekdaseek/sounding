import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, insertSamples } from '../src/store.mjs';
import { exitReport, venueAtSize, bestCurve, curves, staleBound } from '../src/read.mjs';

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);
const MARK = 2;
/** Insert one cycle for asset A. spec: { venue: { 1000: bps|'nr'|'fail', ... } } */
function cycle(db, id, ts, spec, asset = 'A') {
  db.prepare('INSERT OR REPLACE INTO cycles (cycle_id, ts_start, ts_end, rows) VALUES (?,?,?,1)').run(id, ts, ts);
  db.prepare('INSERT OR REPLACE INTO marks (cycle_id, ts, asset, mark, n_venues) VALUES (?,?,?,?,3)').run(id, ts, asset, MARK);
  const rows = [];
  for (const [venue, bySize] of Object.entries(spec)) for (const [size, v] of Object.entries(bySize)) {
    const usd = Number(size), units = usd / MARK;
    const base = { cycle_id: id, ts, asset, size_usd: usd, units, venue, ms: 5 };
    if (v === 'nr') rows.push({ ...base, status: 'no_route', detail: 'no path' });
    else if (v === 'fail') rows.push({ ...base, status: 'failed', fail_kind: 'timeout', detail: 'x' });
    else rows.push({ ...base, status: 'ok', bps: v, proceeds: usd * (1 - v / 1e4) });
  }
  insertSamples(db, rows);
}
const GOOD = {
  sdex_horizon: { 1000: 5, 10000: 30, 100000: 200, 1000000: 2000 },
  aquarius: { 1000: 8, 10000: 45, 100000: 300, 1000000: 3000 },
  broker: { 1000: 0, 10000: 25, 100000: 150, 1000000: 1500 },
  'soroswap_agg:soroswap': { 1000: 10, 10000: 60, 100000: 500, 1000000: 4000 },
};
const uni = { assets: [{ id: 'A' }] };

test('fresh report with agreeing venues is publishable and carries every field the brief names', () => {
  const db = openStore(':memory:');
  for (let i = 1; i <= 6; i++) cycle(db, i, T0 + i * 600_000, GOOD);
  const now = T0 + 6 * 600_000 + 60_000;
  const r = exitReport(db, 'A', 100000, now);
  assert.equal(r.stale, false); assert.equal(r.age_s, 60); assert.equal(r.best.venue, 'broker'); assert.equal(r.best.cost_bps, 150);
  assert.equal(r.published.publishable, true); assert.deepEqual(r.published.reasons, []);
  assert.ok(r.published.safe_size_usd[200].safe_usd > 0);
  assert.ok(r.disagreement && 'flag' in r.disagreement); assert.equal(r.venues.length, 4);
  // per-tolerance safe size is monotone in tolerance
  const s = [50, 100, 200, 500].map((t) => r.safe_size.tolerance_bps[t].safe_usd);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1]);
});

test('stale reading: stale true, not publishable, consumer rule says hold', () => {
  const db = openStore(':memory:');
  cycle(db, 1, T0, GOOD);
  const r = exitReport(db, 'A', 100000, T0 + 4 * 3600_000);
  assert.equal(r.stale, true); assert.equal(r.published.publishable, false);
  assert.ok(r.published.reasons.includes('stale')); assert.equal(r.published.status, 'stale');
  assert.match(r.published.consumer_rule, /hold/);
});

test('a venue paying far MORE than the next best at $1k is refused (spoofed or manipulated bid); a laggard alone is not', () => {
  const db = openStore(':memory:');
  const spoof = { ...GOOD, broker: { ...GOOD.broker, 1000: -500 } }; // 5% better than everyone else
  cycle(db, 1, T0, spoof);
  const r = exitReport(db, 'A', 100000, T0 + 60_000);
  assert.equal(r.price_agreement_at_1k.flag, true);
  assert.ok(r.published.reasons.includes('venues_disagree')); assert.equal(r.published.publishable, false);

  const db2 = openStore(':memory:');
  cycle(db2, 1, T0, { ...GOOD, aquarius: { ...GOOD.aquarius, 1000: 900 } }); // one venue 9% WORSE: harmless to an exit
  const r2 = exitReport(db2, 'A', 100000, T0 + 60_000);
  assert.equal(r2.price_agreement_at_1k.flag, false); assert.equal(r2.published.publishable, true);
});

test('only one venue answering at $1k: not comparable, refused', () => {
  const db = openStore(':memory:');
  cycle(db, 1, T0, { broker: GOOD.broker, aquarius: { 1000: 'fail', 10000: 'fail', 100000: 'fail', 1000000: 'fail' }, sdex_horizon: { 1000: 'nr', 10000: 'nr', 100000: 'nr', 1000000: 'nr' } });
  const r = exitReport(db, 'A', 100000, T0 + 60_000);
  assert.equal(r.price_agreement_at_1k.comparable, false);
  assert.ok(r.published.reasons.includes('fewer_than_two_venues_at_1k')); assert.equal(r.published.publishable, false);
});

test('a single independent venue carrying the depth is never trusted alone (share cap -> single_venue)', () => {
  const db = openStore(':memory:');
  cycle(db, 1, T0, { broker: GOOD.broker, sdex_horizon: GOOD.sdex_horizon, aquarius: { 1000: 'fail', 10000: 'fail', 100000: 'fail', 1000000: 'fail' } });
  const r = exitReport(db, 'A', 100000, T0 + 60_000);
  assert.equal(r.venue_depths[200].cap_limited_by, 'single_venue');
  assert.equal(r.published.safe_size_usd[200].safe_usd, 0);
});

test('time-weighted publish: a depth spike in the last cycle does not raise the published size', () => {
  const db = openStore(':memory:');
  const thin = { sdex_horizon: { 1000: 5, 10000: 400, 100000: 3000, 1000000: 9000 }, aquarius: { 1000: 6, 10000: 420, 100000: 3100, 1000000: 9100 }, broker: { 1000: 0, 10000: 390, 100000: 2900, 1000000: 8900 } };
  for (let i = 1; i <= 5; i++) cycle(db, i, T0 + i * 600_000, thin);
  cycle(db, 6, T0 + 6 * 600_000, GOOD); // depth "appears" this cycle only
  const r = exitReport(db, 'A', 100000, T0 + 6 * 600_000 + 30_000);
  const now200 = r.safe_size.tolerance_bps[200].safe_usd;
  assert.ok(r.published.safe_size_usd[200].time_weighted_usd < now200, `${r.published.safe_size_usd[200].time_weighted_usd} < ${now200}`);
});

test('a drop in depth applies at once (min with latest)', () => {
  const db = openStore(':memory:');
  const thin = { sdex_horizon: { 1000: 5, 10000: 400, 100000: 3000, 1000000: 9000 }, aquarius: { 1000: 6, 10000: 420, 100000: 3100, 1000000: 9100 }, broker: { 1000: 0, 10000: 390, 100000: 2900, 1000000: 8900 } };
  for (let i = 1; i <= 5; i++) cycle(db, i, T0 + i * 600_000, GOOD);
  cycle(db, 6, T0 + 6 * 600_000, thin);
  const r = exitReport(db, 'A', 100000, T0 + 6 * 600_000 + 30_000);
  const latest = r.safe_size.tolerance_bps[200].safe_usd;
  assert.ok(r.published.safe_size_usd[200].time_weighted_usd <= latest + 1);
});

test('unknown asset has no data and is stale, never a fabricated zero', () => {
  const r = exitReport(openStore(':memory:'), 'A', 100000, T0);
  assert.equal(r.status, 'no_data'); assert.equal(r.stale, true); assert.equal(r.published.publishable, false);
});

test('venueAtSize: exact, interpolated between ok brackets, unavailable when a bracket failed', () => {
  const rows = [
    { venue: 'v', size_usd: 1000, status: 'ok', bps: 10, proceeds: 990, units: 500, fail_kind: null },
    { venue: 'v', size_usd: 10000, status: 'ok', bps: 110, proceeds: 9890, units: 5000, fail_kind: null },
    { venue: 'v', size_usd: 100000, status: 'failed', bps: null, proceeds: null, units: 50000, fail_kind: 'timeout' },
  ];
  assert.equal(venueAtSize(rows, 'v', 1000, 2).cost_bps, 10);
  const mid = venueAtSize(rows, 'v', Math.sqrt(1000 * 10000), 2);
  assert.equal(mid.interpolated, true); assert.ok(Math.abs(mid.cost_bps - 60) < 0.2);
  const gap = venueAtSize(rows, 'v', 30000, 2);
  assert.equal(gap.status, 'unavailable'); assert.equal(gap.cost_bps, null); assert.match(gap.note, /failed:timeout/);
});

test('bestCurve takes the cheapest top venue per size and ignores sub-venues and failures', () => {
  const db = openStore(':memory:');
  cycle(db, 1, T0, { ...GOOD, 'soroswap_agg:sdex': { 1000: -50, 10000: -50, 100000: -50, 1000000: -50 }, aquarius: { 1000: 'fail', 10000: 45, 100000: 300, 1000000: 3000 } });
  const c = bestCurve(db.prepare('SELECT * FROM samples').all());
  assert.deepEqual(c.map((p) => p.bps), [0, 25, 150, 1500]);
  assert.deepEqual(Object.keys(curves(db.prepare('SELECT * FROM samples').all())).includes('soroswap_agg:sdex'), true);
});

test('staleBound uses the default until it has history, then the measured drift of the best-exit price', () => {
  const db = openStore(':memory:');
  cycle(db, 1, T0, GOOD);
  assert.equal(staleBound(db, 'A', T0 + 1000).boundS, 3600);
  assert.equal(staleBound(db, 'A', T0 + 1000).basis, 'too_few_samples');
  for (let i = 2; i <= 30; i++) cycle(db, i, T0 + i * 600_000, GOOD);
  const calm = staleBound(db, 'A', T0 + 31 * 600_000);
  assert.equal(calm.basis, 'drift'); assert.ok(calm.boundS >= 1200 && calm.boundS <= 7200);
});

test('depth drift shortens the stale bound even when the mark never moves (the mark-only blind spot)', () => {
  const steady = openStore(':memory:'), pulled = openStore(':memory:');
  const thin = { sdex_horizon: { 1000: 5, 10000: 400, 100000: 3000, 1000000: 9000 }, aquarius: { 1000: 6, 10000: 420, 100000: 3100, 1000000: 9100 }, broker: { 1000: 0, 10000: 390, 100000: 2900, 1000000: 8900 } };
  for (let i = 1; i <= 30; i++) {
    cycle(steady, i, T0 + i * 600_000, GOOD);
    cycle(pulled, i, T0 + i * 600_000, i % 2 ? GOOD : thin); // same mark every cycle, depth flips between deep and thin
  }
  const a = staleBound(steady, 'A', T0 + 31 * 600_000), b = staleBound(pulled, 'A', T0 + 31 * 600_000);
  assert.ok(b.boundS < a.boundS, `pulled ${b.boundS} < steady ${a.boundS}`);
});
