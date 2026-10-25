#!/usr/bin/env node
// fill-docs.mjs — regenerate every measured number in the docs from a database, in one step.
//   node scripts/fill-docs.mjs path/to/sounding.db
// Rewrites: docs/RESULTS.md (full tables), and the marker blocks
//   <!-- HEADLINE:BEGIN --> ... <!-- HEADLINE:END -->  and  <!-- FINDINGS:BEGIN --> ... <!-- FINDINGS:END --> in README.md
//   <!-- RESULTS:BEGIN --> ... <!-- RESULTS:END --> in ARCHITECTURE.md
// Nothing is typed by hand: every number comes from the database.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openStore } from '../src/store.mjs';
import { median } from '../src/engine.mjs';

const dbPath = process.argv[2];
if (!dbPath) { console.error('usage: fill-docs.mjs sounding.db'); process.exit(2); }
const root = new URL('..', import.meta.url).pathname;
const db = openStore(dbPath, { readonly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const f = (x, d = 0) => (x === null || x === undefined ? 'n/a' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

const tot = one('SELECT COUNT(*) n, MIN(ts) a, MAX(ts) b FROM samples');
const cyc = one('SELECT COUNT(*) n FROM cycles WHERE rows > 0').n;
const assets = all("SELECT DISTINCT asset FROM samples WHERE venue != 'engine' ORDER BY asset").map((r) => r.asset);
const venues = all("SELECT DISTINCT venue FROM samples WHERE venue != 'engine' AND venue NOT LIKE '%:%'").length;
const fails = one("SELECT COUNT(*) n FROM samples WHERE status = 'failed' AND fail_kind != 'no_key'").n;
const noKey = one("SELECT COUNT(*) n FROM samples WHERE fail_kind = 'no_key'").n;
const days = (tot.b - tot.a) / 86_400_000;

// rule: ONE headline = the sample count plus ONE exit-cost figure; everything else is appendix
const xlm = (v) => { const xs = all("SELECT bps FROM samples WHERE asset = 'XLM' AND size_usd = 100000 AND venue = ? AND status = 'ok'", v).map((r) => r.bps); return xs.length ? median(xs) : null; };
const xl = ['sdex_horizon', 'aquarius', 'broker', 'soroswap_agg'].map((v) => [v, xlm(v)]).filter(([, b]) => b !== null);
const bestX = xl.reduce((a, b) => (b[1] < a[1] ? b : a)), worstX = xl.reduce((a, b) => (b[1] > a[1] ? b : a));
const NAME = { sdex_horizon: 'SDEX via Horizon', aquarius: 'Aquarius', broker: 'Stellar Broker', soroswap_agg: 'the Soroswap aggregator' };
const headline = `**${f(tot.n)} samples** of live Stellar exit liquidity, and one number: selling **$100,000 of XLM** costs **${f(bestX[1])} bps** at the best venue (${NAME[bestX[0]]}) and **${f(worstX[1])} bps** at the worst (${NAME[worstX[0]]}), median over ${f(cyc)} cycles. Data: ${assets.length} assets x 4 sizes x ${venues} venues, one cycle per 10 minutes, ${iso(tot.a)} to ${iso(tot.b)}. ${f(fails)} venue answers failed for a reason other than a missing Soroswap key; each is a typed row and none is read as zero liquidity (${f(noKey)} rows are the Soroswap venue recording \`no_key\` before its key was installed).`;

// findings: $100k exit by venue, median over all cycles, for a handful of assets
const med = (a, size, v) => { const xs = all("SELECT bps FROM samples WHERE asset = ? AND size_usd = ? AND venue = ? AND status = 'ok'", a, size, v).map((r) => r.bps); return xs.length ? median(xs) : null; };
const pick = ['XLM', 'EURC', 'USTRY', 'PYUSD', 'ETH', 'BTC'].filter((a) => assets.includes(a));
const rows = pick.map((a) => {
  const c = { sdex_horizon: med(a, 100000, 'sdex_horizon'), aquarius: med(a, 100000, 'aquarius'), broker: med(a, 100000, 'broker'), soroswap_agg: med(a, 100000, 'soroswap_agg') };
  const vals = Object.values(c).filter((x) => x !== null);
  return `| ${a} | ${f(c.sdex_horizon)} | ${f(c.aquarius)} | ${f(c.broker)} | ${f(c.soroswap_agg)} | ${f(Math.max(...vals) - Math.min(...vals))} |`;
});
const findings = `Selling **$100,000** of the asset into USDC, median cost in bps over all cycles (the Soroswap column only counts cycles since its key was installed):

| asset | SDEX (Horizon paths) | Aquarius | Stellar Broker | Soroswap aggregator | spread between venues |
|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

The Soroswap aggregator is not best-of and carries a 10 bps input fee (\`docs/VENUES.md\` section 4).`;

const resultsTool = execFileSync('node', ['--no-warnings', `${root}scripts/results-md.mjs`, dbPath], { encoding: 'utf8' });
const resultsMd = `# Measured results

Generated ${iso(Date.now())} from the production database by \`node scripts/fill-docs.mjs <db>\`
(tables by \`scripts/results-md.mjs\`). Every number below comes from the database; the live
equivalents are \`GET /v1/stats\` and \`GET /v1/history.csv\`.

${resultsTool}
`;
writeFileSync(`${root}docs/RESULTS.md`, resultsMd);

const sub = (file, tag, body) => {
  const p = `${root}${file}`; let s = readFileSync(p, 'utf8');
  const re = new RegExp(`(<!-- ${tag}:BEGIN -->)[\\s\\S]*?(<!-- ${tag}:END -->)`);
  if (!re.test(s)) throw new Error(`${file}: marker ${tag} not found`);
  s = s.replace(re, (_m, a, b) => `${a}${body}${b}`);
  writeFileSync(p, s);
};
sub('README.md', 'HEADLINE', ` ${headline} `);
sub('README.md', 'FINDINGS', `\n${findings}\n`);
sub('ARCHITECTURE.md', 'RESULTS', `\n${headline}\n\n${findings}\n\nFull tables (per-venue answers, cost at $100k and $1M with spread, safe sizes by method, stale bounds): [\`docs/RESULTS.md\`](docs/RESULTS.md).\n`);
console.log(JSON.stringify({ samples: tot.n, cycles: cyc, first: iso(tot.a), last: iso(tot.b), days: Number(days.toFixed(2)), failsExclNoKey: fails, noKey }));
