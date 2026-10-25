#!/usr/bin/env node
// discover.mjs — build data/universe.json, the asset universe, WITHOUT Blend.
//
// Candidates are read live from the Aquarius pool list (public, no key) and, when
// SOROSWAP_API_KEY is set, the Soroswap pool list. Only classic-issued assets and
// XLM are kept (they have a SAC contract and an SDEX/Broker identity, so all four
// venues can be asked). Each candidate is then MEASURED: a $10k and $100k exit
// into USDC through Horizon and Aquarius. The universe is the candidates with the
// cheapest measured $100k exit, plus the three the brief names (XLM, EURC, AQUA).
//
//   node bin/discover.mjs [--n 10] [--out data/universe.json]
import { Asset, Networks } from '@stellar/stellar-sdk';
import { writeFileSync } from 'node:fs';
import * as horizon from '../src/venues/horizon.mjs';
import * as aquarius from '../src/venues/aquarius.mjs';
import { USDC_ISSUER, sleep } from '../src/util.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const N = Number(val('--n', 10));
const OUT = val('--out', new URL('../data/universe.json', import.meta.url).pathname);
// --include forces ids in (curation: the brief names XLM, EURC, AQUA and asks for BTC/ETH
// wrappers, yXLM, USTRY). Everything else is picked by measured $100k cost.
const MUST = (val('--include', 'XLM,EURC,AQUA')).split(',');

function mk(str) {
  if (str === 'native') { const a = Asset.native(); return { id: 'XLM', code: 'XLM', issuer: null, native: true, sac: a.contractId(Networks.PUBLIC) }; }
  const [code, issuer] = str.split(':');
  if (!issuer || !/^G[A-Z2-7]{55}$/.test(issuer)) return null; // soroban-native tokens carry a name, not CODE:ISSUER
  const a = new Asset(code, issuer);
  return { id: code, code, issuer, native: false, sac: a.contractId(Networks.PUBLIC) };
}

async function pagedAquariusPools() {
  let url = 'https://amm-api.aqua.network/api/external/v2/pools/';
  const all = [];
  while (url) { const j = await (await fetch(url)).json(); all.push(...j.results); url = j.next; await sleep(150); }
  return all;
}

const pools = await pagedAquariusPools();
console.error(`aquarius pools: ${pools.length}`);
const cand = new Map();
for (const p of pools) for (const s of p.tokens_str) {
  const m = mk(s); if (!m) continue;
  const key = m.native ? 'XLM' : `${m.code}:${m.issuer}`;
  const c = cand.get(key) || { ...m, pools: 0 };
  c.pools++; cand.set(key, c);
}
if (cand.has(`USDC:${USDC_ISSUER}`)) cand.delete(`USDC:${USDC_ISSUER}`); // the quote asset
console.error(`classic candidates: ${cand.size}`);

// Measure. A 1-unit sell is a bad price on a thin book (dust bids), so: seed with
// 1 unit, quote ~$1k, and use the best $1k proceeds-per-unit as the mark for this
// candidate. Then quote $10k and $100k and cost them against that mark. This is the
// production methodology in miniature (mark = small-size quote).
const rows = [];
const both = async (c, units) => {
  const [h, a] = [await horizon.quote({ asset: c, units }), await aquarius.quote({ asset: c, units })];
  return Math.max(h.proceedsUsdc || 0, a.proceedsUsdc || 0);
};
for (const c of [...cand.values()].sort((a, b) => b.pools - a.pools).slice(0, 45)) {
  const seed = await horizon.quote({ asset: c, units: 1 });
  await sleep(250);
  if (seed.status !== 'ok' || !(seed.proceedsUsdc > 0)) { rows.push({ ...c, measured: 'no_seed' }); continue; }
  const u1k = 1000 / seed.proceedsUsdc;
  const p1k = (await both(c, u1k)) / u1k;
  if (!(p1k > 0)) { rows.push({ ...c, measured: 'no_1k' }); continue; }
  const out = { ...c, seedPrice: p1k };
  for (const usd of [1e4, 1e5]) {
    const best = await both(c, usd / p1k);
    out[`bps_${usd}`] = best ? Math.round((1 - best / usd) * 1e4) : null;
    await sleep(250);
  }
  rows.push(out);
  console.error(`${c.id.padEnd(8)} ${c.issuer ? c.issuer.slice(0, 6) : '------'} pools=${String(c.pools).padStart(3)} mark1k=${p1k.toPrecision(5)} bps@10k=${out.bps_10000} bps@100k=${out.bps_100000}`);
}
const usable = rows.filter((r) => r.bps_100000 !== undefined && r.bps_100000 !== null && r.bps_100000 >= 0 && r.bps_100000 < 3000);
usable.sort((a, b) => a.bps_100000 - b.bps_100000);
const pick = [];
for (const id of MUST) { const r = rows.find((x) => x.id === id && x.bps_10000 != null); if (r) pick.push(r); }
for (const r of usable) { if (pick.length >= N) break; if (!pick.includes(r)) pick.push(r); }
const universe = {
  generated: new Date().toISOString(),
  source: 'aquarius pools list (live) + measured Horizon/Aquarius exits',
  quote_asset: { code: 'USDC', issuer: USDC_ISSUER, sac: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75' },
  assets: pick.map(({ id, code, issuer, native, sac, pools, seedPrice, bps_10000, bps_100000 }) =>
    ({ id, code, issuer, native, sac, aquarius_pools: pools, seed_price_usdc: seedPrice, bps_at_10k: bps_10000, bps_at_100k: bps_100000 })),
};
writeFileSync(OUT, JSON.stringify(universe, null, 2) + '\n');
console.error(`wrote ${OUT}: ${universe.assets.map((a) => a.id).join(' ')}`);
