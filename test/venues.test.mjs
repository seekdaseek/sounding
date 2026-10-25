import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as util from '../src/util.mjs';
import * as horizon from '../src/venues/horizon.mjs';
import * as aquarius from '../src/venues/aquarius.mjs';
import * as broker from '../src/venues/broker.mjs';
import * as soroswap from '../src/venues/soroswap.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const XLM = { id: 'XLM', code: 'XLM', native: true, issuer: null, sac: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA' };
const AQUA = { id: 'AQUA', code: 'AQUA', native: false, issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA', sac: 'CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK' };

/** A fake fetch that answers once with a status/body and records the request. */
function fakeFetch(status, body, { headers = {}, throwErr } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init });
    if (throwErr) throw throwErr;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => text };
  };
  f.calls = calls;
  return f;
}

test('toStroops is exact for 7 decimals and big whole parts', () => {
  assert.equal(util.toStroops(1), 10_000_000n);
  assert.equal(util.toStroops(5000.1234567), 50_001_234_567n);
  assert.equal(util.toStroops(5.9e6), 59_000_000_000_000n);
  assert.throws(() => util.toStroops(-1), RangeError);
  assert.throws(() => util.toStroops(NaN), RangeError);
});

test('horizon: parses the best path, keeps 7-decimal source amount in the URL', async () => {
  const f = fakeFetch(200, fx('horizon-paths-xlm.json'));
  const r = await horizon.quote({ asset: XLM, units: 5000 }, { fetch: f });
  assert.equal(r.status, 'ok'); assert.equal(r.venue, 'sdex_horizon'); assert.equal(r.proceedsUsdc, 848.0680445);
  assert.match(f.calls[0].url, /source_amount=5000\.0000000/);
  assert.match(f.calls[0].url, /source_asset_type=native/);
});

test('horizon: empty records is no_route, not failed and not zero proceeds', async () => {
  const r = await horizon.quote({ asset: AQUA, units: 5 }, { fetch: fakeFetch(200, fx('horizon-no-path.json')) });
  assert.equal(r.status, 'no_route'); assert.equal(r.proceedsUsdc, null);
});

test('horizon: 429 is a typed rate_limited failure and backs the lane off', async () => {
  const lane = new util.Lane('h', 0);
  const r = await horizon.quote({ asset: XLM, units: 1 }, { fetch: fakeFetch(429, '', { headers: { 'retry-after': '7' } }), lane });
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'rate_limited');
  assert.ok(lane.backoffUntil - Date.now() > 5000);
});

test('horizon: a network error is failed/network, never no_route', async () => {
  const r = await horizon.quote({ asset: XLM, units: 1 }, { fetch: fakeFetch(0, '', { throwErr: Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }) }) });
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'network'); assert.match(r.failure.detail, /ECONNRESET/);
});

test('horizon: malformed body is parse_error', () => {
  assert.equal(horizon.parsePaths({}).failure.kind, 'parse_error');
  assert.equal(horizon.parsePaths({ _embedded: { records: [{ destination_amount: 'abc' }] } }).failure.kind, 'parse_error');
});

test('aquarius: stroops amount becomes USDC; request carries SACs and stroop string', async () => {
  const f = fakeFetch(200, fx('aquarius-findpath-xlm.json'));
  const r = await aquarius.quote({ asset: XLM, units: 5000 }, { fetch: f });
  assert.equal(r.status, 'ok'); assert.equal(r.proceedsUsdc, 847.5153804);
  const body = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(body, { token_in_address: XLM.sac, token_out_address: util.USDC_SAC, amount: '50000000000' });
});

test('aquarius: success:false is no_route; 400 is bad_request; missing SAC is unsupported', async () => {
  assert.equal(aquarius.parseFindPath({ success: false, amount: 0 }).status, 'no_route');
  assert.equal(aquarius.parseFindPath({ success: true, amount: 0 }).status, 'no_route');
  const bad = await aquarius.quote({ asset: AQUA, units: 1 }, { fetch: fakeFetch(400, fx('aquarius-no-path.json')) });
  assert.equal(bad.status, 'failed'); assert.equal(bad.failure.kind, 'bad_request');
  const uns = await aquarius.quote({ asset: { ...AQUA, sac: undefined }, units: 1 }, { fetch: fakeFetch(200, {}) });
  assert.equal(uns.failure.kind, 'unsupported');
  assert.equal(aquarius.parseFindPath({ success: true, amount: 'x' }).failure.kind, 'parse_error');
});

test('broker: estimatedBuyingAmount is the proceeds; direct baseline is kept', async () => {
  const f = fakeFetch(200, fx('broker-quote-xlm.json'));
  const r = await broker.quote({ asset: XLM, units: 5000 }, { fetch: f });
  assert.equal(r.status, 'ok'); assert.equal(r.proceedsUsdc, 848.0680445); assert.equal(r.route.direct_proceeds, 848.0680445);
  assert.match(f.calls[0].url, /sellingAsset=XLM/); assert.match(f.calls[0].url, /sellingAmount=5000\.0000000/);
  assert.match(f.calls[0].url, /buyingAsset=USDC-GA5ZSEJYB37/);
});

test('broker: status unfeasible is no_route (observed live: "Not enough liquidity on the DEX.")', async () => {
  const r = await broker.quote({ asset: AQUA, units: 5 }, { fetch: fakeFetch(200, fx('broker-no-path.json')) });
  assert.equal(r.status, 'no_route'); assert.match(r.detail, /Not enough liquidity/);
});

test('broker: an unknown status is failed, not zero', () => {
  assert.equal(broker.parseQuote({ status: 'rejected', error: 'bad' }).status, 'failed');
  assert.equal(broker.parseQuote({ status: 'success', estimatedBuyingAmount: 'n/a' }).failure.kind, 'parse_error');
});

test('broker asset param: native is XLM, issued is CODE-ISSUER', () => {
  assert.equal(broker.assetParam(XLM), 'XLM');
  assert.equal(broker.assetParam(AQUA), `AQUA-${AQUA.issuer}`);
});

test('soroswap: no key is a typed no_key failure and sends nothing', async () => {
  const f = fakeFetch(200, {});
  const r = await soroswap.quote({ asset: XLM, units: 1 }, { fetch: f });
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'no_key'); assert.equal(f.calls.length, 0);
});

test('soroswap: request shape matches the docs; bearer key is sent; per-protocol venue name', async () => {
  const f = fakeFetch(200, fx('soroswap-quote-DOCS-SHAPE.json'));
  const r = await soroswap.quote({ asset: XLM, units: 5000 }, { fetch: f, apiKey: 'sk_test', protocols: ['aqua'] });
  assert.equal(r.venue, 'soroswap_agg:aqua'); assert.equal(r.status, 'ok'); assert.equal(r.proceedsUsdc, 847.5153804);
  assert.deepEqual(r.route.protocols_used, ['aqua']); assert.equal(r.route.platform, 'aggregator');
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer sk_test');
  assert.match(f.calls[0].url, /quote\?network=mainnet/);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { assetIn: XLM.sac, assetOut: util.USDC_SAC, amount: '50000000000', tradeType: 'EXACT_IN', protocols: ['aqua'] });
});

test('soroswap: 403 is auth, a bare 500 is http_error, only a stated "no route" body is no_route', async () => {
  const mk = (s, b) => soroswap.quote({ asset: XLM, units: 1 }, { fetch: fakeFetch(s, b), apiKey: 'sk_x' });
  assert.equal((await mk(403, { message: 'Forbidden resource' })).failure.kind, 'auth');
  assert.equal((await mk(500, 'boom')).failure.kind, 'http_error');
  assert.equal((await mk(404, { message: 'No route found for this pair' })).status, 'no_route');
  assert.equal((await mk(403, { message: 'no route' })).status, 'failed'); // auth failure can never read as no_route
});

test('soroswap: zero amountOut is no_route; non-integer is parse_error', () => {
  assert.equal(soroswap.parseQuote({ amountOut: '0' }).status, 'no_route');
  assert.equal(soroswap.parseQuote({ amountOut: '1.5' }).failure.kind, 'parse_error');
  assert.equal(soroswap.parseQuote({}).failure.kind, 'parse_error');
});

test('Lane enforces the minimum gap between calls', async () => {
  const lane = new util.Lane('t', 80); const t = [];
  await Promise.all([1, 2, 3].map(() => lane.run(async () => { t.push(Date.now()); })));
  assert.ok(t[1] - t[0] >= 75 && t[2] - t[1] >= 75, `gaps ${t[1] - t[0]} ${t[2] - t[1]}`);
});
