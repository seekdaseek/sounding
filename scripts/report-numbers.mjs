#!/usr/bin/env node
// report-numbers.mjs — the handful of numbers a status report needs, straight from a database.
//   node scripts/report-numbers.mjs path/to/sounding.db
import { openStore } from '../src/store.mjs';
import { median } from '../src/engine.mjs';
import { exitReport, staleBound } from '../src/read.mjs';
const db = openStore(process.argv[2], { readonly: true });
const all = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);
const iso = (ms) => new Date(ms).toISOString();
const t = one('SELECT COUNT(*) n, MIN(ts) a, MAX(ts) b FROM samples');
console.log(JSON.stringify({ samples: t.n, cycles: one('SELECT COUNT(*) n FROM cycles WHERE rows>0').n, first: iso(t.a), last: iso(t.b) }));
console.log('--- one real quote per venue (latest cycle, XLM, $100k)');
const lc = one("SELECT MAX(cycle_id) c FROM marks WHERE asset='XLM' AND mark IS NOT NULL").c;
for (const r of all("SELECT venue,status,round(proceeds,2) p,round(bps,1) bps,round(units,1) units,datetime(ts/1000,'unixepoch') t FROM samples WHERE cycle_id=? AND asset='XLM' AND size_usd=100000 ORDER BY venue", lc)) console.log(Object.values(r).join(' | '));
console.log('--- venue spread: largest best-vs-worst spread at $100k, per asset, median over cycles');
const assets = all("SELECT DISTINCT asset FROM samples WHERE venue!='engine' ORDER BY 1").map((r) => r.asset);
const spreads = assets.map((a) => {
  const c = all("SELECT MAX(bps)-MIN(bps) s FROM samples WHERE asset=? AND size_usd=100000 AND status='ok' AND venue IN ('sdex_horizon','aquarius','broker') GROUP BY cycle_id HAVING COUNT(*)>=2", a).map((r) => r.s);
  return { a, med: median(c) };
}).sort((x, y) => y.med - x.med);
console.log(spreads.map((s) => `${s.a}:${Math.round(s.med)}`).join('  '));
console.log('--- stale bounds');
for (const a of assets) { const b = staleBound(db, a, t.b); console.log(a, b.n, b.basis, b.boundS, b.sigmaCycle ? (b.sigmaCycle * 1e4).toFixed(1) + 'bps/cycle' : ''); }
console.log('--- published (latest) XLM and ETH');
const now = t.b;
for (const a of ['XLM', 'ETH']) { const r = exitReport(db, a, 100000, now); console.log(a, JSON.stringify({ stale: r.stale, age_s: r.age_s, publishable: r.published.publishable, reasons: r.published.reasons, p200: r.published.safe_size_usd?.[200], bis200: r.safe_size.bisection_hourly?.[200] })); }
console.log('--- bisection rows'); console.log(JSON.stringify(one('SELECT COUNT(*) n, COUNT(DISTINCT asset) a FROM bisect')));
console.log('--- failures excluding no_key'); console.log(JSON.stringify(all("SELECT venue, fail_kind, COUNT(*) n FROM samples WHERE status='failed' AND fail_kind!='no_key' GROUP BY 1,2")));
