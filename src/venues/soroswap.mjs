// soroswap.mjs — venue "soroswap_agg": the Soroswap Aggregator API.
// POST https://api.soroswap.finance/quote?network=mainnet
//   Authorization: Bearer sk_...   (free plan: 1 req/s sustained, burst 5; no approval)
//   body { assetIn, assetOut, amount (stroops string), tradeType: 'EXACT_IN', protocols: [...] }
// Response (docs.soroswap.finance/api-reference/quote, and as captured live on 2026-10-25):
//   HTTP 201 (not 200) with amountOut (stroops string), platform ('router'|'aggregator'|'sdex'),
//   routePlan[], rawTrade. Every route has 10 bps deducted from the INPUT before routing (rawTrade.amountIn,
//   or rawTrade.source_amount on the sdex platform, is 0.1% below amountIn); that is a real seller cost and is
//   inside our cost figure. No route is HTTP 400 {"title":"No path found","detail":"No path found",...}.
//   A missing, malformed or revoked key returns 403, not 401 (their quickstart).
// The aggregate is NOT best-of: its sdex leg is the direct order book only, and on 2026-10-25 for AQUA at
// $100k the aggregate cost 1,211 bps while Horizon's multi-hop paths cost 228.
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
/** Statuses on which a "no route" body is believed. A 401/403/429/5xx is never a no-route answer. */
const NO_ROUTE_STATUS = new Set([400, 404, 422]);

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
  // fee taken from the input before routing, in bps of the requested input
  let routedIn = null;
  try {
    if (body.rawTrade?.source_amount !== undefined) routedIn = Number(body.rawTrade.source_amount) * 1e7;
    else if (body.rawTrade?.amountIn !== undefined) routedIn = Number(body.rawTrade.amountIn);
  } catch { /* leave null */ }
  const reqIn = Number(body.amountIn);
  const inputFeeBps = routedIn !== null && reqIn > 0 ? Math.round((1 - routedIn / reqIn) * 1e5) / 10 : null;
  return ok(venue, Number(out) / 1e7, {
    platform: body.platform ?? null,
    protocols_used: [...used],
    price_impact_pct: body.priceImpactPct ?? null,
    input_fee_bps: inputFeeBps,
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
    const msg = r.body?.detail ?? r.body?.message ?? r.body?.title ?? r.text;
    // Only a body that says so, on a status that can carry it, is "no route". A bare 4xx/5xx is a failure, never zero.
    if (NO_ROUTE_STATUS.has(r.res.status) && NO_ROUTE_RE.test(String(msg))) return noRoute(venue, msg);
    return failed(venue, httpFailureKind(r.res.status), msg, r.res.status);
  }
  return parseQuote(r.body, venue);
}
