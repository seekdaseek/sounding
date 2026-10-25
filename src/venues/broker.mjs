// broker.mjs — venue "broker": Stellar Broker price estimate.
// GET https://api.stellar.broker/quote?sellingAsset=&buyingAsset=&sellingAmount=&slippageTolerance=
// This is the same call @stellar-broker/client's estimateSwap() makes (src/estimate.js,
// v0.7.0). No key for estimates. status is 'success' | 'unfeasible' | 'rejected'.
// `estimatedBuyingAmount` is the routed result; `directTrade.buying` is the plain
// single-path baseline Broker compares against.
import { ok, noRoute, failed, call, httpFailureKind, retryAfterS, unitsStr, USDC_ISSUER } from '../util.mjs';

export const VENUE = 'broker';
const BASE = 'https://api.stellar.broker';

export const assetParam = (a) => (a.native ? 'XLM' : `${a.code}-${a.issuer}`);

export function parseQuote(body) {
  if (!body || typeof body !== 'object') return failed(VENUE, 'parse_error', 'body is not an object');
  if (body.status === 'unfeasible') return noRoute(VENUE, body.error || 'unfeasible');
  if (body.status !== 'success') return failed(VENUE, 'http_error', `status=${body.status} ${body.error || ''}`);
  const est = Number(body.estimatedBuyingAmount);
  if (!Number.isFinite(est)) return failed(VENUE, 'parse_error', `estimatedBuyingAmount not numeric: ${body.estimatedBuyingAmount}`);
  if (est <= 0) return noRoute(VENUE, 'estimate is zero');
  const direct = Number(body.directTrade?.buying);
  return ok(VENUE, est, { direct_proceeds: Number.isFinite(direct) ? direct : null, direct_path: body.directTrade?.path ?? null });
}

export async function quote(req, { fetch: f = fetch, lane, base = BASE } = {}) {
  const q = new URLSearchParams({
    sellingAsset: assetParam(req.asset),
    buyingAsset: `USDC-${USDC_ISSUER}`,
    sellingAmount: unitsStr(req.units),
    slippageTolerance: '0.02',
  });
  const r = await call(f, `${base}/quote?${q}`);
  if (r.fail) return failed(VENUE, r.fail.kind, r.fail.detail);
  if (r.res.status === 429) { lane?.backoff(retryAfterS(r.res) ?? 30); return failed(VENUE, 'rate_limited', 'HTTP 429', 429); }
  if (!r.res.ok && !r.body) return failed(VENUE, httpFailureKind(r.res.status), r.text, r.res.status);
  return parseQuote(r.body);
}
