// api.mjs — the read API and the one-page explainer. node:http only, sqlite opened read-only.
import { createServer } from 'node:http';
import { exitReport, headline, stats } from './read.mjs';
import { SIZES_USD } from './engine.mjs';

const REPO = 'https://github.com/seekdaseek/sounding';
const LICENSE_DATA = 'https://creativecommons.org/licenses/by/4.0/';
const MIN_SIZE = SIZES_USD[0], MAX_SIZE = SIZES_USD[SIZES_USD.length - 1];

const VENUE_LABEL = { sdex_horizon: 'SDEX (Horizon paths)', soroswap_agg: 'Soroswap aggregator', aquarius: 'Aquarius', broker: 'Stellar Broker' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function json(res, code, body, cache = 15) {
  const text = JSON.stringify(body, null, 2) + '\n';
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache ? `public, max-age=${cache}` : 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
  res.end(text);
}

class Limiter {
  constructor(perMin) { this.perMin = perMin; this.hits = new Map(); }
  allow(key, now = Date.now()) {
    const w = (this.hits.get(key) || []).filter((t) => now - t < 60_000);
    if (w.length >= this.perMin) { this.hits.set(key, w); return false; }
    w.push(now); this.hits.set(key, w);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 60_000)) this.hits.delete(k);
    return true;
  }
}

const csvCell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function streamHistory(db, res, { since, asset, limit }) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="sounding-history.csv"',
    'link': `<${LICENSE_DATA}>; rel="license"`, 'x-data-license': 'CC BY 4.0 - attribute: sounding (github.com/seekdaseek/sounding)', 'access-control-allow-origin': '*', 'cache-control': 'no-store',
  });
  res.write('ts,cycle_id,asset,size_usd,units,venue,status,proceeds_usdc,cost_bps,fail_kind,detail\n');
  let lastId = 0, sent = 0;
  const q = asset
    ? db.prepare('SELECT * FROM samples WHERE id > ? AND ts >= ? AND asset = ? ORDER BY id LIMIT 5000')
    : db.prepare('SELECT * FROM samples WHERE id > ? AND ts >= ? ORDER BY id LIMIT 5000');
  for (;;) {
    const rows = asset ? q.all(lastId, since, asset) : q.all(lastId, since);
    if (!rows.length) break;
    let chunk = '';
    for (const r of rows) {
      if (sent >= limit) break;
      chunk += [new Date(r.ts).toISOString(), r.cycle_id, r.asset, r.size_usd, r.units, r.venue, r.status, r.proceeds, r.bps === null ? null : Math.round(r.bps * 10) / 10, r.fail_kind, r.detail].map(csvCell).join(',') + '\n';
      sent++;
    }
    res.write(chunk);
    lastId = rows[rows.length - 1].id;
    if (sent >= limit) break;
  }
  res.end();
}

function page(db, universe, nowMs) {
  const h = headline(db, 'XLM', 100_000, nowMs);
  const st = stats(db, universe, nowMs);
  const row = (v) => {
    const label = VENUE_LABEL[v.venue] || v.venue;
    const val = v.status === 'ok' ? `<b>${v.cost_bps} bps</b> <span class="m">$${Math.round(v.proceeds_usdc).toLocaleString('en-US')} back</span>`
      : v.status === 'no_route' ? '<span class="m">no route at this size</span>'
      : `<span class="m">no answer (${esc(v.failure_kind || v.status)}) - not zero liquidity</span>`;
    return `<tr><td>${esc(label)}</td><td>${val}</td></tr>`;
  };
  const live = h ? `
    <p class="big">Selling <b>$100,000 of XLM</b> into USDC on Stellar right now costs:</p>
    <table>${h.venues.map(row).join('')}</table>
    <p class="m">Measured ${h.age_s}s ago against a ${h.mark.toFixed(4)} USDC/XLM mark. Nothing typed, nothing mocked: this is the latest sample from the running sampler.</p>`
    : '<p class="big">The sampler has not completed a cycle yet. Reload in a minute.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>sounding - Stellar exit liquidity</title>
<meta name="description" content="How much of an asset can you sell on Stellar right now, and what does it cost, at size S? Four venues, measured every 10 minutes.">
<style>
:root{--bg:#fff;--fg:#14171f;--m:#5b6270;--line:#d9dde4;--acc:#0a5cd6;--card:#f5f7fa}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--fg:#e6e9ef;--m:#9aa3b2;--line:#2a303b;--acc:#6aa6ff;--card:#171b23}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:720px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:1.5rem;margin:.2em 0 0}h2{font-size:1.1rem;margin:1.8em 0 .4em}
.big{font-size:1.15rem;margin:1.2em 0 .6em}table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px}
td{padding:9px 12px;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:0}td:first-child{width:46%}
.m{color:var(--m);font-size:.9rem}a{color:var(--acc)}code,pre{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 5px;font-size:.88rem}
pre{padding:10px 12px;overflow:auto;white-space:pre}li{margin:.25em 0}
</style></head><body><main>
<h1>sounding</h1><div class="m">Exit liquidity for Stellar assets. MIT code, CC BY 4.0 data.</div>
${live}
<h2>The question it answers</h2>
<p>How much of asset X can I sell on Stellar right now, and what does it cost, at size S? Each answer quotes four exit venues - the classic order books and pools through Horizon paths, the Soroswap aggregator, Aquarius, and Stellar Broker - against a mark taken from the smallest-size quotes, and reports the largest size that stays inside 50, 100, 200 and 500 bps.</p>
<h2>Try it</h2>
<pre>curl 'https://sounding.ochinimus.app/v1/exit?asset=ETH&amp;size=100000'
curl 'https://sounding.ochinimus.app/v1/stats'
curl -O 'https://sounding.ochinimus.app/v1/history.csv'</pre>
<p>Assets: ${universe.assets.map((a) => `<code>${esc(a.id)}</code>`).join(' ')}. Sizes $1,000 to $1,000,000.</p>
<h2>What it has measured</h2>
<p>${st.samples.toLocaleString('en-US')} samples in ${st.cycles} cycles across ${st.assets.length} assets and ${Object.keys(st.venues).length} venue rows, since ${esc(st.first_ts || 'n/a')}. A venue that does not answer is recorded as a typed failure, never as zero liquidity. <a href="/v1/stats">/v1/stats</a></p>
<h2>How a lender should read it</h2>
<p>Each response carries <code>age_s</code>, <code>stale</code> and a per-asset bound. When the reading is stale, or the venues disagree beyond a threshold, or only one venue carries the depth, <code>published.publishable</code> is false and the rule is: <b>hold the current limit, never raise it</b>.</p>
<h2>Status</h2>
<p>Free during the build. A paid endpoint (x402, USDC on Stellar) is being proven on testnet. Source and design: <a href="${REPO}">${REPO}</a></p>
</main></body></html>`;
}

export function makeHandler({ db, universe, now = () => Date.now(), paidRoute = null }) {
  const lim = new Limiter(60), limCsv = new Limiter(6);
  const ids = new Map(universe.assets.map((a) => [a.id.toUpperCase(), a.id]));
  return async (req, res) => {
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'x';
    let u;
    try { u = new URL(req.url, 'http://x'); } catch { return json(res, 400, { error: 'bad url' }, 0); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }, 0);
    try {
      if (u.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=15', 'x-content-type-options': 'nosniff' });
        return res.end(page(db, universe, now()));
      }
      if (u.pathname === '/healthz') {
        const s = stats(db, universe, now());
        const ok = s.last_cycle_age_s !== null && s.last_cycle_age_s < 1500;
        return json(res, ok ? 200 : 503, { ok, last_cycle_age_s: s.last_cycle_age_s }, 0);
      }
      if (u.pathname === '/v1/stats') return json(res, 200, stats(db, universe, now()));
      if (u.pathname === '/v1/assets') return json(res, 200, { quote_asset: universe.quote_asset, assets: universe.assets.map(({ id, code, issuer, sac }) => ({ id, code, issuer, sac })) });
      if (u.pathname === '/v1/license') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`Data (history.csv, /v1/*): CC BY 4.0 ${LICENSE_DATA}\nCode: MIT ${REPO}\nAttribution: "sounding (${REPO})"\n`); }
      if (u.pathname === '/v1/exit' || (paidRoute && u.pathname === paidRoute.path)) {
        if (!lim.allow(ip)) return json(res, 429, { error: 'rate limit: 60/min' }, 0);
        const id = ids.get(String(u.searchParams.get('asset') || '').toUpperCase());
        if (!id) return json(res, 400, { error: 'unknown asset', assets: [...ids.values()] }, 0);
        const size = Number(u.searchParams.get('size') ?? 100000);
        if (!Number.isFinite(size) || size < MIN_SIZE || size > MAX_SIZE) return json(res, 400, { error: `size must be a number between ${MIN_SIZE} and ${MAX_SIZE} (USD)` }, 0);
        return json(res, 200, exitReport(db, id, size, now()));
      }
      if (u.pathname === '/v1/history.csv') {
        if (!limCsv.allow(ip)) return json(res, 429, { error: 'rate limit: 6/min for history.csv' }, 0);
        const a = u.searchParams.get('asset'); const asset = a ? ids.get(a.toUpperCase()) : null;
        if (a && !asset) return json(res, 400, { error: 'unknown asset' }, 0);
        const sinceRaw = u.searchParams.get('since'); let since = 0;
        if (sinceRaw) { since = /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : Date.parse(sinceRaw); if (!Number.isFinite(since)) return json(res, 400, { error: 'since must be epoch ms or ISO time' }, 0); }
        return streamHistory(db, res, { since, asset, limit: Math.min(Number(u.searchParams.get('limit')) || 5_000_000, 5_000_000) });
      }
      return json(res, 404, { error: 'not found', routes: ['/', '/v1/exit?asset=&size=', '/v1/stats', '/v1/assets', '/v1/history.csv', '/v1/license', '/healthz'] }, 0);
    } catch (e) {
      console.error(new Date().toISOString(), 'handler error', e?.stack || e);
      return json(res, 500, { error: 'internal error' }, 0);
    }
  };
}

export function startServer(opts, port, host = '127.0.0.1') {
  const server = createServer(makeHandler(opts));
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
