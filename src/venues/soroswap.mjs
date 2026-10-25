// soroswap.mjs — venue "soroswap_agg": the Soroswap Aggregator API.
// POST https://api.soroswap.finance/quote?network=mainnet
//   Authorization: Bearer sk_...   (free plan: 1 req/s sustained, burst 5; no approval)
//   body { assetIn, assetOut, amount (stroops string), tradeType: 'EXACT_IN', protocols: [...] }
// Response (docs.soroswap.finance/api-reference/quote): amountOut (stroops string),
// platform ('router'|'aggregator'|'sdex'), routePlan[], rawTrade.distribution[].hops[].
// A missing, malformed or revoked key returns 403, not 401 (their quickstart).
//
// We call it with all protocols (the aggregate) and once per protocol, so the
// per-venue depth is visible: soroswap, aqua, sushi, comet, sdex.
import { ok, noRoute, failed, call, httpFailureKind, retryAfterS, toStroops, USDC_SAC } from '../util.mjs';

export const VENUE = 'soroswap_agg';
export const PROTOCOLS = ['soroswap', 'aqua', 'sushi', 'comet', 'sdex'];
const BASE = 'https://api.soroswap.finance';

/** Venue name for a sub-quote: soroswap_agg:aqua, or soroswap_agg for the aggregate. */
export const venueName = (protocols) => (protocols.length === 1 ? `${VENUE}:${protocols[0]}` : VENUE);

/** Phrases the API could use for "this pair has no route". Matched case-insensitively. */
const NO_ROUTE_RE = /no (route|path|pool|liquidity)|insufficient liquidity|route not found|pair not found|not enough liquidity/i;

export function parseQuote(body, venue = VENUE) {
  if (!body || typeof body !== 'object') return failed(venue, 'parse_error', 'body is not an object');
  if (body.amountOut === undefined || body.amountOut === null) return failed(venue, 'parse_error', 'no amountOut');
  let out;
  try { out = BigInt(body.amountOut); } catch { return failed(venue, 'parse_error', `amountOut not an integer: ${body.amountOut}`); }
  if (out <= 0n) return noRoute(venue, 'amountOut is zero');
  // venues actually used, read from hops (protocol_id names only the first hop)
  const used = new Set();
  for (const d of body.rawTrade?.distribution || []) for (const h of d.hops || []) if (h.protocol) used.add(h.protocol);
  for (const p of body.routePlan || []) if (p.swapInfo?.protocol) used.add(p.swapInfo.protocol);
  return ok(venue, Number(out) / 1e7, {
    platform: body.platform ?? null,
    protocols_used: [...used],
    price_impact_pct: body.priceImpactPct ?? null,
  });
}

export function buildBody(asset, units, protocols) {
  return {
    assetIn: asset.sac,
    assetOut: USDC_SAC,
    amount: toStroops(units).toString(),
    tradeType: 'EXACT_IN',
    protocols,
  };
}

export async function quote(req, { fetch: f = fetch, lane, apiKey, protocols = PROTOCOLS, base = BASE } = {}) {
  const venue = venueName(protocols);
  if (!apiKey) return failed(venue, 'no_key', 'SOROSWAP_API_KEY not set');
  if (!req.asset.sac) return failed(venue, 'unsupported', 'asset has no SAC contract id');
  const r = await call(f, `${base}/quote?network=mainnet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(buildBody(req.asset, req.units, protocols)),
  }, 30000);
  if (r.fail) return failed(venue, r.fail.kind, r.fail.detail);
  if (r.res.status === 429) { lane?.backoff(retryAfterS(r.res) ?? 5); return failed(venue, 'rate_limited', 'HTTP 429', 429); }
  if (!r.res.ok) {
    const msg = r.body?.message ?? r.text;
    // Only a body that says so is "no route". A bare 4xx/5xx is a failure, never zero.
    if (r.res.status !== 403 && r.res.status !== 401 && NO_ROUTE_RE.test(String(msg))) return noRoute(venue, msg);
    return failed(venue, httpFailureKind(r.res.status), msg, r.res.status);
  }
  return parseQuote(r.body, venue);
}
