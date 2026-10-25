import test from 'node:test';
import assert from 'node:assert/strict';
import * as e from '../src/engine.mjs';

const ok = (venue, p) => ({ venue, status: 'ok', proceedsUsdc: p });
const nr = (venue) => ({ venue, status: 'no_route', proceedsUsdc: null });
const fl = (venue) => ({ venue, status: 'failed', proceedsUsdc: null, failure: { kind: 'timeout' } });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('median: odd, even, ignores non-finite, empty is null', () => {
  assert.equal(e.median([3, 1, 2]), 2);
  assert.equal(e.median([4, 1, 2, 3]), 2.5);
  assert.equal(e.median([1, NaN, 3, Infinity]), 2);
  assert.equal(e.median([]), null);
});

test('mark: median of proceeds per unit over answering top venues only', () => {
  const rows = [ok('sdex_horizon', 99), ok('aquarius', 101), ok('broker', 100), fl('soroswap_agg'), ok('soroswap_agg:aqua', 5)];
  close(e.markFromSmallQuotes(rows, 100), 1.0); // sub-venue row is not a top venue; failed row is not zero
  assert.equal(e.markFromSmallQuotes([fl('broker'), nr('aquarius')], 10), null);
  assert.equal(e.markFromSmallQuotes([ok('broker', 5)], 10, 2), null); // minVenues
  assert.throws(() => e.markFromSmallQuotes(rows, 0), RangeError);
});

test('a failed venue must not drag the mark down (the zero-liquidity bug class)', () => {
  const withFail = e.markFromSmallQuotes([ok('broker', 100), ok('aquarius', 100), fl('sdex_horizon')], 100);
  const wrongZero = e.markFromSmallQuotes([ok('broker', 100), ok('aquarius', 100), ok('sdex_horizon', 0.0001)], 100);
  close(withFail, 1.0);
  assert.ok(wrongZero <= withFail);
});

test('costBps: zero when proceeds equal mark value, positive when worse, negative when better', () => {
  close(e.costBps(2, 10, 20), 0);
  close(e.costBps(2, 10, 19), 500);
  close(e.costBps(2, 10, 21), -500);
  assert.throws(() => e.costBps(0, 10, 1), RangeError);
  assert.throws(() => e.costBps(2, 10, NaN), TypeError);
});

test('bestExit picks max proceeds among top venues and skips non-ok', () => {
  const b = e.bestExit([ok('aquarius', 90), ok('broker', 95), fl('sdex_horizon'), ok('soroswap_agg:sdex', 999)]);
  assert.equal(b.venue, 'broker');
  assert.equal(e.bestExit([nr('aquarius'), fl('broker')]), null);
});

test('disagreement: spread of top two, flag above threshold, alone is not comparable', () => {
  const d = e.disagreement([ok('aquarius', 100), ok('broker', 95), ok('sdex_horizon', 50)], 300);
  close(d.spreadBps, 500); close(d.fullSpreadBps, 5000); assert.equal(d.flag, true);
  const agree = e.disagreement([ok('aquarius', 100), ok('broker', 99.5)], 300);
  assert.equal(agree.flag, false);
  const alone = e.disagreement([ok('aquarius', 100), fl('broker')], 300);
  assert.equal(alone.comparable, false); assert.equal(alone.flag, false);
});

test('interpolateSafeSize: crossing, lower bound, below minimum, gaps skipped', () => {
  const pts = [{ usd: 1e3, bps: 10 }, { usd: 1e4, bps: 50 }, { usd: 1e5, bps: 450 }, { usd: 1e6, bps: 3000 }];
  const r100 = e.interpolateSafeSize(pts, 100); // between 1e4 (50) and 1e5 (450): t = 50/400
  close(r100.safeUsd, Math.exp(Math.log(1e4) + (50 / 400) * Math.log(10)), 1e-6); assert.equal(r100.limitedBy, 'tolerance');
  assert.equal(e.interpolateSafeSize(pts, 5).safeUsd, 0);
  assert.equal(e.interpolateSafeSize(pts, 5).limitedBy, 'below_min_sample');
  const cap = e.interpolateSafeSize(pts, 5000);
  assert.equal(cap.safeUsd, 1e6); assert.equal(cap.limitedBy, 'sample_cap');
  assert.equal(e.interpolateSafeSize([], 100).limitedBy, 'no_data');
  // a failed point (null) is skipped, not read as zero cost
  const gap = e.interpolateSafeSize([{ usd: 1e3, bps: 10 }, { usd: 1e4, bps: null }, { usd: 1e5, bps: 450 }], 100);
  assert.equal(gap.limitedBy, 'tolerance'); assert.ok(gap.safeUsd > 1e3 && gap.safeUsd < 1e5);
});

test('interpolateSafeSize is monotone in tolerance', () => {
  const pts = [{ usd: 1e3, bps: 5 }, { usd: 1e4, bps: 40 }, { usd: 1e5, bps: 400 }, { usd: 1e6, bps: 2500 }];
  let last = -1;
  for (const t of [10, 50, 100, 200, 500, 1000, 3000]) { const s = e.interpolateSafeSize(pts, t).safeUsd; assert.ok(s >= last, `tol ${t}`); last = s; }
});

test('bisectSafeSize finds the crossing of a monotone curve within iteration budget', async () => {
  const curve = (usd) => usd / 2000; // 1bp per $2000: tol 100 bps -> $200k
  const r = await e.bisectSafeSize(async (u) => curve(u), { lo: 1e3, hi: 1e6, tolBps: 100, iters: 12 });
  assert.equal(r.limitedBy, 'tolerance'); assert.equal(r.method, 'bisection_quotes');
  assert.ok(r.safeUsd <= 200_000 && r.safeUsd > 195_000, String(r.safeUsd));
  assert.ok(r.quotes <= 14);
});

test('bisectSafeSize edge cases: below minimum, sample cap, failure aborts (never read as 0 or as cheap)', async () => {
  assert.equal((await e.bisectSafeSize(async () => 900, { lo: 1e3, hi: 1e6, tolBps: 100 })).safeUsd, 0);
  assert.equal((await e.bisectSafeSize(async () => 1, { lo: 1e3, hi: 1e6, tolBps: 100 })).limitedBy, 'sample_cap');
  const f1 = await e.bisectSafeSize(async () => null, { lo: 1e3, hi: 1e6, tolBps: 100 });
  assert.equal(f1.safeUsd, null); assert.equal(f1.limitedBy, 'failed');
  let n = 0;
  const f2 = await e.bisectSafeSize(async (u) => (++n >= 4 ? null : u / 2000), { lo: 1e3, hi: 1e6, tolBps: 100, iters: 10 });
  assert.equal(f2.limitedBy, 'failed_partial'); assert.ok(f2.safeUsd >= 1e3); // keeps the last size proven safe
});

test('effectiveDepth: time-weighted mean; a fresh spike is averaged down; a fresh drop applies at once', () => {
  const H = 3600_000, now = 10 * H;
  // flat 100 for 9h then spikes to 1000 only for the last 6 minutes
  const spike = e.effectiveDepth([{ ts: 0, v: 100 }, { ts: now - 6 * 60_000, v: 1000 }], now, H);
  assert.ok(spike.mean < 200 && spike.mean > 100, String(spike.mean));
  assert.equal(spike.latest, 1000); close(spike.effective, spike.mean);
  // flat 100 for an hour then collapses to 10 in the last 6 minutes
  const drop = e.effectiveDepth([{ ts: 0, v: 100 }, { ts: now - 6 * 60_000, v: 10 }], now, H);
  assert.equal(drop.effective, 10);
  close(e.effectiveDepth([{ ts: 0, v: 7 }], now, H).effective, 7);
  assert.equal(e.effectiveDepth([], now, H), null);
  assert.equal(e.effectiveDepth([{ ts: now + 1, v: 5 }], now, H), null); // future samples are not data
});

test('cappedDepth: single venue is refused; cap binds a dominant venue; shares sum to 1', () => {
  assert.equal(e.cappedDepth({ a: 1000 }, 0.6).published, 0);
  assert.equal(e.cappedDepth({ a: 1000 }, 0.6).limitedBy, 'single_venue');
  assert.equal(e.cappedDepth({}, 0.6).limitedBy, 'no_depth');
  const r = e.cappedDepth({ a: 1000, b: 100 }, 0.6); // a may be at most 1.5 x b = 150
  close(r.counted.a, 150, 1e-6); close(r.counted.b, 100, 1e-6); close(r.published, 250, 1e-6);
  assert.equal(r.limitedBy, 'share_cap');
  close(Object.values(r.shares).reduce((s, x) => s + x, 0), 1, 1e-9);
  assert.ok(r.shares.a <= 0.6 + 1e-9);
  const even = e.cappedDepth({ a: 100, b: 100, c: 100 }, 0.6);
  assert.equal(even.limitedBy, 'none'); close(even.published, 300);
  assert.throws(() => e.cappedDepth({ a: 1, b: 1 }, 1), RangeError);
});

test('cappedDepth ignores failed/null/zero venues instead of counting them as depth or as "others"', () => {
  const r = e.cappedDepth({ a: 100, b: null, c: 0, d: NaN }, 0.6);
  assert.equal(r.limitedBy, 'single_venue');
});

test('staleness: bound, boundary is not stale, missing reading is stale', () => {
  assert.equal(e.staleness(1000, 1000 + 1200_000, 1200).stale, false);
  assert.equal(e.staleness(1000, 1000 + 1201_000, 1200).stale, true);
  assert.equal(e.staleness(NaN, 5, 1200).stale, true);
  close(e.staleness(5000, 4000, 10).ageS, 0); // clock skew never gives negative age
});

test('nextLimit: stale holds (never raises, never acts on the old number); fresh follows the publish', () => {
  assert.equal(e.nextLimit(500, 900, true), 500);
  assert.equal(e.nextLimit(500, 100, true), 500);
  assert.equal(e.nextLimit(500, 900, false), 900);
  assert.equal(e.nextLimit(500, 100, false), 100);
  assert.equal(e.nextLimit(500, null, false), 500);
});

test('staleBoundFromDrift: calm asset gets a longer bound than a volatile one; clamps; few samples', () => {
  const mk = (vol) => Array.from({ length: 50 }, (_, i) => ({ ts: i * 600_000, mark: 100 * (1 + vol * Math.sin(i * 2.1) * (i % 3 === 0 ? 1 : -0.7)) }));
  const calm = e.staleBoundFromDrift(mk(0.0002)), wild = e.staleBoundFromDrift(mk(0.02));
  assert.ok(calm.boundS >= wild.boundS);
  assert.ok(wild.boundS >= 1200 && calm.boundS <= 7200);
  assert.equal(e.staleBoundFromDrift([{ ts: 0, mark: 1 }]).basis, 'too_few_samples');
  const flat = e.staleBoundFromDrift(Array.from({ length: 20 }, (_, i) => ({ ts: i * 600_000, mark: 5 })));
  assert.equal(flat.boundS, 7200);
});

test('constants: tolerances and sizes are the ones the brief names', () => {
  assert.deepEqual(e.TOLERANCES_BPS, [50, 100, 200, 500]);
  assert.deepEqual(e.SIZES_USD, [1000, 10000, 100000, 1000000]);
});
