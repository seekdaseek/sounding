// util.mjs — shared plumbing for the venue adapters. No venue logic here.

export const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
export const USDC_SAC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
export const STROOPS = 10_000_000n;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The three-way verdict. A venue answer is exactly one of:
 *   ok        - the venue quoted proceeds
 *   no_route  - the venue answered, definitively, that it cannot fill this
 *   failed    - we did not get an answer (network, 429, auth, parse, ...)
 * `failed` is NEVER zero liquidity. Readers must keep the two apart.
 */
export const ok = (venue, proceedsUsdc, route, extra = {}) =>
  ({ venue, status: 'ok', proceedsUsdc, route, ts: new Date().toISOString(), ...extra });
export const noRoute = (venue, detail) =>
  ({ venue, status: 'no_route', proceedsUsdc: null, route: null, detail: String(detail ?? ''), ts: new Date().toISOString() });
export const failed = (venue, kind, detail, httpStatus) =>
  ({ venue, status: 'failed', proceedsUsdc: null, route: null, failure: { kind, detail: String(detail ?? '').slice(0, 300), httpStatus: httpStatus ?? null }, ts: new Date().toISOString() });

/** Failure kinds, closed set so the sampler can group by them. */
export const FAILURE_KINDS = ['timeout', 'network', 'rate_limited', 'auth', 'no_key', 'http_error', 'parse_error', 'bad_request', 'unsupported'];

/** units (number, up to 7 decimals) -> stroops BigInt, exact for whole parts < 2^53. */
export function toStroops(units) {
  if (!Number.isFinite(units) || units < 0) throw new RangeError(`bad units: ${units}`);
  const whole = Math.floor(units);
  const frac = Math.round((units - whole) * 1e7);
  return BigInt(whole) * STROOPS + BigInt(frac);
}
/** decimal string or stroops -> number of units. */
export const fromStroops = (s) => Number(BigInt(s)) / 1e7;
/** units -> 7-decimal string, the form Horizon and Stellar Broker want. */
export const unitsStr = (units) => units.toFixed(7);

/**
 * fetch with a deadline, mapping every failure onto the typed set. Returns
 * { res, body } on any HTTP answer (body = parsed JSON or null) and
 * { fail } when there was no usable answer.
 */
export async function call(fetchImpl, url, init = {}, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { res, body, text };
  } catch (e) {
    if (e?.name === 'AbortError') return { fail: { kind: 'timeout', detail: `no answer in ${timeoutMs}ms` } };
    return { fail: { kind: 'network', detail: String(e?.cause?.code || e?.message || e) } };
  } finally { clearTimeout(t); }
}

/** HTTP status -> failure kind for the non-200 case. */
export function httpFailureKind(status) {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'bad_request';
  return 'http_error';
}

/** Retry-After seconds from a response, or null. */
export function retryAfterS(res) {
  const v = res?.headers?.get?.('retry-after');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A serial lane with a minimum gap between calls and 429 back-off. One lane per
 * venue keeps every venue inside its own limit independently.
 */
export class Lane {
  constructor(name, minGapMs) { this.name = name; this.minGapMs = minGapMs; this.next = 0; this.backoffUntil = 0; this.q = Promise.resolve(); }
  run(fn) {
    const job = this.q.then(async () => {
      const wait = Math.max(this.next, this.backoffUntil) - Date.now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); }
      finally { this.next = Date.now() + this.minGapMs; }
    });
    this.q = job.catch(() => {});
    return job;
  }
  /** Called by an adapter result handler when it saw a 429. */
  backoff(seconds) { this.backoffUntil = Math.max(this.backoffUntil, Date.now() + Math.min(seconds, 120) * 1000); }
}
