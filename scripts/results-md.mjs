#!/usr/bin/env node
// results-md.mjs — Markdown summary of what the sampler has measured. Reads a sqlite file.
//   node scripts/results-md.mjs path/to/sounding.db [--json]
// Every number comes from the database; nothing is typed here.
import { openStore } from '../src/store.mjs';
import { median, staleBoundFromDrift } from '../src/engine.mjs';

const path = process.argv[2];
if (!path) { console.error('usage: results-md.mjs sounding.db'); process.exit(2); }
const db = openStore(path, { readonly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const q = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const f = (x, d = 0) => (x === null || x === undefined ? 'n/a' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const iso = (ms) => (ms ? new Date(ms).toISOString().replace('.000Z', 'Z') : 'n/a');

const tot = one('SELECT COUNT(*) n, MIN(ts) a, MAX(ts) b FROM samples');
const cycles = one('SELECT COUNT(*) n FROM cycles WHERE rows > 0');
const assets = all('SELECT DISTINCT asset FROM samples WHERE venue != \'engine\' ORDER BY asset').map((r) => r.asset);
const out = [];
out.push(`**${f(tot.n)} samples** in **${f(cycles.n)} cycles**, ${assets.length} assets (${assets.join(', ')}), first ${iso(tot.a)}, last ${iso(tot.b)}.`, '');

out.push('### Answers by venue', '', '| venue | ok | no_route | failed | failure kinds |', '|---|---:|---:|---:|---|');
const byV = {};
for (const r of all("SELECT venue, status, COALESCE(fail_kind,'') k, COUNT(*) n FROM samples GROUP BY 1,2,3")) { const v = (byV[r.venue] ||= { ok: 0, no_route: 0, failed: 0, k: {} }); v[r.status] += r.n; if (r.status === 'failed') v.k[r.k] = r.n; }
for (const [v, x] of Object.entries(byV).sort()) out.push(`| ${v} | ${f(x.ok)} | ${f(x.no_route)} | ${f(x.failed)} | ${Object.entries(x.k).map(([k, n]) => `${k}: ${n}`).join(', ') || '-'} |`);

for (const size of [100000, 1000000]) {
  out.push('', `### Exit cost at $${f(size)} (bps vs the cycle mark): median [p10 - p90] over all cycles`, '', '| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |', '|---|---|---|---|---|');
  for (const a of assets) {
    const cells = [];
    for (const v of ['sdex_horizon', 'aquarius', 'broker']) {
      const xs = all("SELECT bps FROM samples WHERE asset = ? AND size_usd = ? AND venue = ? AND status = 'ok'", a, size, v).map((r) => r.bps);
      cells.push(xs.length ? `${f(median(xs))} [${f(q(xs, 0.1))} - ${f(q(xs, 0.9))}] (n=${xs.length})` : 'n/a');
    }
    const cyc = all("SELECT cycle_id, MAX(bps) hi, MIN(bps) lo, COUNT(*) c FROM samples WHERE asset = ? AND size_usd = ? AND status = 'ok' AND venue IN ('sdex_horizon','aquarius','broker') GROUP BY cycle_id HAVING c >= 2", a, size);
    out.push(`| ${a} | ${cells.join(' | ')} | ${f(median(cyc.map((r) => r.hi - r.lo)))} |`);
  }
}

out.push('', '### Published safe size per tolerance (latest cycle, best-exit curve, USD)', '', '| asset | 50 bps | 100 bps | 200 bps | 500 bps | closed-form SDEX book @200 | bisected @200 (venue) |', '|---|---:|---:|---:|---:|---:|---|');
const { exitReport } = await import('../src/read.mjs');
const now = tot.b || Date.now();
for (const a of assets) {
  const r = exitReport(db, a, 100000, now);
  const t = r.safe_size?.tolerance_bps; if (!t) continue;
  const cell = (k) => `${f(t[k].safe_usd)}${t[k].limitedBy === 'sample_cap' ? '+' : ''}`;
  const bis = r.safe_size.bisection_hourly?.[200];
  out.push(`| ${a} | ${cell(50)} | ${cell(100)} | ${cell(200)} | ${cell(500)} | ${f(r.safe_size.orderbook_closed_form?.[200]?.safe_usd)} | ${bis ? `${f(bis.safe_usd)} (${bis.venue})` : 'n/a'} |`);
}
out.push('', '`+` = lower bound: even the largest sampled size ($1M) stayed inside the tolerance.');

out.push('', '### Stale bounds from measured drift (per asset)', '', '| asset | marks | cycle sigma (bps) | stale bound (s) | basis |', '|---|---:|---:|---:|---|');
for (const a of assets) {
  const m = all('SELECT ts, mark FROM marks WHERE asset = ? AND mark IS NOT NULL ORDER BY ts', a);
  const b = staleBoundFromDrift(m);
  out.push(`| ${a} | ${m.length} | ${b.sigmaCycle ? f(b.sigmaCycle * 1e4, 1) : 'n/a'} | ${f(b.basis === 'too_few_samples' ? 3600 : b.boundS)} | ${b.basis} |`);
}
console.log(out.join('\n'));
