// horizon.mjs — venue "sdex_horizon": SDEX orderbooks + classic pools, multi-hop,
// via Horizon GET /paths/strict-send. No key. Public Horizon allows bursts but
// answers 429 with Retry-After when we are too fast; the sampler lane honours it.
import { ok, noRoute, failed, call, httpFailureKind, retryAfterS, unitsStr, USDC_ISSUER } from '../util.mjs';

export const VENUE = 'sdex_horizon';
const BASE = 'https://horizon.stellar.org';

/** Horizon wants asset_type/asset_code/asset_issuer split, native as asset_type=native. */
export function sourceParams(asset) {
  if (asset.native) return { source_asset_type: 'native' };
  const t = asset.code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
  return { source_asset_type: t, source_asset_code: asset.code, source_asset_issuer: asset.issuer };
}

export function buildUrl(asset, units, base = BASE) {
  const q = new URLSearchParams({
    ...sourceParams(asset),
    source_amount: unitsStr(units),
    destination_assets: `USDC:${USDC_ISSUER}`,
  });
  return `${base}/paths/strict-send?${q}`;
}

/** Pure: Horizon paths body -> venue result. Best record = max destination_amount. */
export function parsePaths(body) {
  const recs = body?._embedded?.records;
  if (!Array.isArray(recs)) return failed(VENUE, 'parse_error', 'no _embedded.records array');
  if (recs.length === 0) return noRoute(VENUE, 'strict-send returned no paths');
  let best = null;
  for (const r of recs) {
    const d = Number(r.destination_amount);
    if (!Number.isFinite(d)) return failed(VENUE, 'parse_error', `destination_amount not numeric: ${r.destination_amount}`);
    if (!best || d > best.d) best = { d, r };
  }
  const hops = (best.r.path || []).map((p) => p.asset_type === 'native' ? 'XLM' : p.asset_code);
  return ok(VENUE, best.d, { hops, source_amount: best.r.source_amount, paths_seen: recs.length });
}

export async function quote(req, { fetch: f = fetch, lane, base } = {}) {
  const r = await call(f, buildUrl(req.asset, req.units, base));
  if (r.fail) return failed(VENUE, r.fail.kind, r.fail.detail);
  if (r.res.status === 429) { lane?.backoff(retryAfterS(r.res) ?? 30); return failed(VENUE, 'rate_limited', 'HTTP 429', 429); }
  if (!r.res.ok) {
    // Horizon answers 400 for an asset/amount it cannot path; the body names the field.
    return failed(VENUE, httpFailureKind(r.res.status), r.body?.detail || r.text, r.res.status);
  }
  return parsePaths(r.body);
}
