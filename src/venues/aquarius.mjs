// aquarius.mjs — venue "aquarius": Aquarius AMM path finder.
// POST https://amm-api.aqua.network/api/external/v2/find-path/  (no key, per their docs)
// Response amount is the expected OUTPUT in stroops for exact-input. success:false
// with HTTP 200 means "no route" (docs: "No route found -> HTTP 200 with success:false").
import { ok, noRoute, failed, call, httpFailureKind, retryAfterS, toStroops, USDC_SAC } from '../util.mjs';

export const VENUE = 'aquarius';
const BASE = 'https://amm-api.aqua.network/api/external/v2';

export function parseFindPath(body) {
  if (!body || typeof body !== 'object') return failed(VENUE, 'parse_error', 'body is not an object');
  if (body.success === false) return noRoute(VENUE, 'find-path success:false');
  if (body.success !== true) return failed(VENUE, 'parse_error', `success is ${JSON.stringify(body.success)}`);
  let out;
  try { out = BigInt(body.amount); } catch { return failed(VENUE, 'parse_error', `amount not an integer: ${body.amount}`); }
  if (out <= 0n) return noRoute(VENUE, 'find-path returned zero amount');
  return ok(VENUE, Number(out) / 1e7, { pools: body.pools || [], tokens: body.tokens || [] });
}

export async function quote(req, { fetch: f = fetch, lane, base = BASE } = {}) {
  if (!req.asset.sac) return failed(VENUE, 'unsupported', 'asset has no SAC contract id');
  const r = await call(f, `${base}/find-path/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token_in_address: req.asset.sac,
      token_out_address: USDC_SAC,
      amount: toStroops(req.units).toString(),
    }),
  });
  if (r.fail) return failed(VENUE, r.fail.kind, r.fail.detail);
  if (r.res.status === 429) { lane?.backoff(retryAfterS(r.res) ?? 30); return failed(VENUE, 'rate_limited', 'HTTP 429', 429); }
  if (!r.res.ok) return failed(VENUE, httpFailureKind(r.res.status), r.text, r.res.status);
  return parseFindPath(r.body);
}
