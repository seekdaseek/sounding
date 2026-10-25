import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.mjs';
import { makeLanes, runCycle, tasksFor } from '../src/sampler.mjs';

const XLM = { id: 'XLM', code: 'XLM', native: true, issuer: null, sac: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA', seed_price_usdc: 0.17 };
const uni = { assets: [XLM] };

/** Fake network: every venue pays `price` per XLM minus an impact that grows with size. */
function fakeNet({ price = 0.17, failVenue = null, noRouteVenue = null } = {}) {
  const pay = (units) => units * price * (1 - Math.min(0.9, units * price / 4e6));
  const calls = [];
  const f = async (url, init) => {
    url = String(url); calls.push(url);
    const res = (status, b) => ({ ok: status < 300, status, headers: new Headers(), text: async () => JSON.stringify(b), json: async () => b });
    if (url.includes('order_book')) return res(200, { bids: [{ price: String(price), price_r: { n: 17, d: 100 }, amount: '100000.0000000' }] });
    if (url.includes('horizon.stellar.org/paths')) {
      if (failVenue === 'sdex_horizon') throw Object.assign(new Error('boom'), { cause: { code: 'ECONNRESET' } });
      if (noRouteVenue === 'sdex_horizon') return res(200, { _embedded: { records: [] } });
      const u = Number(new URL(url).searchParams.get('source_amount'));
      return res(200, { _embedded: { records: [{ destination_amount: pay(u).toFixed(7), source_amount: u.toFixed(7), path: [] }] } });
    }
    if (url.includes('aqua.network')) {
      const u = Number(BigInt(JSON.parse(init.body).amount)) / 1e7;
      return res(200, { success: true, amount: Math.round(pay(u) * 0.999 * 1e7), pools: ['C1'], tokens: [] });
    }
    if (url.includes('stellar.broker')) {
      const u = Number(new URL(url).searchParams.get('sellingAmount'));
      if (failVenue === 'broker') return res(429, '');
      return res(200, { status: 'success', estimatedBuyingAmount: pay(u).toFixed(7), directTrade: { buying: (pay(u) * 0.99).toFixed(7), path: [] } });
    }
    if (url.includes('api.soroswap.finance')) {
      const u = Number(BigInt(JSON.parse(init.body).amount)) / 1e7;
      return res(200, { amountOut: String(Math.round(pay(u) * 0.998 * 1e7)), platform: 'aggregator', routePlan: [] });
    }
    throw new Error('unexpected url ' + url);
  };
  f.calls = calls; return f;
}
const lanesFast = () => { const l = makeLanes(); for (const k of Object.keys(l)) l[k].minGapMs = 0; return l; };
const q = (db, sql, ...a) => db.prepare(sql).all(...a);

test('a cycle writes marks, one row per (size x venue), a typed no_key row for soroswap, and book_safe', async () => {
  const db = openStore(':memory:');
  const r = await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: fakeNet() });
  assert.equal(r.rows, 16); // 4 sizes x (3 keyless venues + 1 soroswap no_key)
  const m = q(db, 'SELECT * FROM marks')[0];
  assert.ok(Math.abs(m.mark - 0.17) / 0.17 < 0.01, `mark ${m.mark}`);
  const nk = q(db, "SELECT * FROM samples WHERE venue='soroswap_agg'");
  assert.equal(nk.length, 4); assert.ok(nk.every((x) => x.status === 'failed' && x.fail_kind === 'no_key' && x.proceeds === null));
  const sizes = q(db, "SELECT DISTINCT size_usd FROM samples WHERE venue='broker' ORDER BY 1").map((x) => x.size_usd);
  assert.deepEqual(sizes, [1000, 10000, 100000, 1000000]);
  assert.equal(q(db, 'SELECT * FROM book_safe').length, 4);
  const c = q(db, 'SELECT * FROM cycles')[0]; assert.ok(c.ts_end >= c.ts_start); assert.equal(c.rows, 16);
});

test('nominal size is honest: units x mark ~ size_usd even on a cold start with a wrong seed', async () => {
  const db = openStore(':memory:');
  await runCycle(db, { assets: [{ ...XLM, seed_price_usdc: 0.5 }] }, { lanes: lanesFast(), apiKey: '', fetch: fakeNet() });
  const mark = q(db, 'SELECT mark FROM marks')[0].mark;
  for (const s of q(db, "SELECT size_usd, units FROM samples WHERE venue='broker'")) assert.ok(Math.abs(s.units * mark - s.size_usd) / s.size_usd < 0.03, `${s.size_usd}: ${s.units * mark}`);
});

test('with a key every protocol is quoted per size, and the rows are named soroswap_agg:<protocol>', async () => {
  const db = openStore(':memory:');
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: 'sk_test', fetch: fakeNet() });
  const v = q(db, "SELECT DISTINCT venue FROM samples WHERE venue LIKE 'soroswap_agg%' ORDER BY 1").map((x) => x.venue);
  assert.deepEqual(v, ['soroswap_agg', 'soroswap_agg:aqua', 'soroswap_agg:comet', 'soroswap_agg:soroswap', 'soroswap_agg:sdex', 'soroswap_agg:sushi'].sort());
  assert.equal(tasksFor({ asset: XLM, units: 1 }, { lanes: lanesFast(), apiKey: 'sk', fetch: fakeNet() }).length, 9);
});

test('a failing venue is recorded as a typed failure with NULL proceeds, and does not move the mark', async () => {
  const db = openStore(':memory:');
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: fakeNet({ failVenue: 'sdex_horizon' }) });
  const bad = q(db, "SELECT * FROM samples WHERE venue='sdex_horizon'");
  assert.equal(bad.length, 4 + 0); // 4 sizes
  assert.ok(bad.every((x) => x.status === 'failed' && x.fail_kind === 'network' && x.proceeds === null && x.bps === null));
  assert.ok(Math.abs(q(db, 'SELECT mark FROM marks')[0].mark - 0.17) / 0.17 < 0.01);
});

test('no_route is stored as no_route, distinct from failed', async () => {
  const db = openStore(':memory:');
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: fakeNet({ noRouteVenue: 'sdex_horizon' }) });
  const s = q(db, "SELECT status, fail_kind FROM samples WHERE venue='sdex_horizon'");
  assert.ok(s.every((x) => x.status === 'no_route' && x.fail_kind === null));
});

test('if no venue answers at the smallest size, larger sizes are skipped and an engine/no_mark row says why', async () => {
  const db = openStore(':memory:');
  const dead = async () => { throw new Error('offline'); };
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: dead });
  assert.equal(q(db, 'SELECT mark FROM marks')[0].mark, null);
  const e = q(db, "SELECT * FROM samples WHERE venue='engine'");
  assert.equal(e.length, 1); assert.equal(e[0].fail_kind, 'no_mark');
  assert.equal(q(db, 'SELECT DISTINCT size_usd FROM samples').length, 1);
});

test('the second cycle sizes the smallest quote from the stored mark (no seed probe)', async () => {
  const db = openStore(':memory:');
  const f = fakeNet();
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: f });
  const before = f.calls.length;
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: f });
  const seedProbes = f.calls.slice(before).filter((u) => u.includes('source_amount=1.0000000')).length;
  assert.equal(seedProbes, 0);
  assert.equal(q(db, 'SELECT COUNT(*) n FROM cycles')[0].n, 2);
});

test('hourly refine bisects live quotes on the cheapest keyless venue and stores a size per tolerance', async () => {
  const { runRefine } = await import('../src/sampler.mjs');
  const db = openStore(':memory:');
  const f = fakeNet();
  const { cycleId } = await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: f });
  const n = await runRefine(db, uni, { lanes: lanesFast(), apiKey: '', fetch: f }, cycleId, { iters: 6 });
  assert.equal(n, 4);
  const rows = q(db, 'SELECT * FROM bisect ORDER BY tol_bps');
  assert.deepEqual(rows.map((r) => r.tol_bps), [50, 100, 200, 500]);
  for (const r of rows) { assert.ok(['tolerance', 'sample_cap', 'below_min_sample'].includes(r.limited_by), r.limited_by); assert.ok(r.quotes >= 2); }
  const safe = rows.map((r) => r.safe_usd);
  for (let i = 1; i < safe.length; i++) assert.ok(safe[i] >= safe[i - 1], `monotone in tolerance: ${safe}`);
});

test('refine: a failing venue aborts the search as limited_by failed, never as a zero size', async () => {
  const { runRefine } = await import('../src/sampler.mjs');
  const db = openStore(':memory:');
  const good = fakeNet();
  const { cycleId } = await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: good });
  const dead = async () => { throw Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }); };
  await runRefine(db, uni, { lanes: lanesFast(), apiKey: '', fetch: dead }, cycleId, { iters: 4 });
  const rows = q(db, 'SELECT * FROM bisect');
  assert.ok(rows.length === 4 && rows.every((r) => r.limited_by === 'failed' && r.safe_usd === null));
});

test('the marks row is written after the asset\'s samples, so a reader never sees a cycle with no rows', async () => {
  const db = openStore(':memory:');
  // observe the DB from inside the slowest venue call: at that moment samples for this cycle are not all
  // written, so the marks row for the cycle must not exist yet
  const net = fakeNet();
  let seenMarksDuringCycle = null;
  const spy = async (url, init) => {
    if (String(url).includes('stellar.broker') && Number(new URL(String(url)).searchParams.get('sellingAmount')) > 100000) {
      seenMarksDuringCycle = db.prepare("SELECT COUNT(*) n FROM marks WHERE mark IS NOT NULL AND cycle_id = (SELECT MAX(cycle_id) FROM cycles)").get().n;
    }
    return net(url, init);
  };
  await runCycle(db, uni, { lanes: lanesFast(), apiKey: '', fetch: spy });
  assert.equal(seenMarksDuringCycle, 0, 'mark was visible before the cycle finished');
  const m = db.prepare('SELECT ts FROM marks').get().ts, last = db.prepare("SELECT MAX(ts) t FROM samples WHERE venue != 'engine'").get().t;
  assert.ok(m >= last, 'mark is not older than the newest sample');
});
