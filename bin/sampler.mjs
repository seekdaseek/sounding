#!/usr/bin/env node
// sampler.mjs — the daemon. One cycle every INTERVAL_S (default 600). If a cycle is
// still running when the next is due, the next is skipped (and noted), never stacked.
//   SOUNDING_DB=/opt/sounding/sounding.db  SOROSWAP_API_KEY=sk_...  node bin/sampler.mjs
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store.mjs';
import { makeLanes, runCycle, runRefine } from '../src/sampler.mjs';

const DB = process.env.SOUNDING_DB || new URL('../sounding.db', import.meta.url).pathname;
const UNI = process.env.SOUNDING_UNIVERSE || new URL('../data/universe.json', import.meta.url).pathname;
const INTERVAL_S = Number(process.env.INTERVAL_S || 600);
const ONCE = process.argv.includes('--once');
const universe = JSON.parse(readFileSync(UNI, 'utf8'));
const db = openStore(DB);
const lanes = makeLanes();
// The hourly bisection gets its own lanes at half the rate so it never delays a cycle's quotes.
const refineLanes = makeLanes(2);
let refining = false;
const apiKey = process.env.SOROSWAP_API_KEY || '';
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

let running = false;
async function tick() {
  if (running) { log('previous cycle still running; skipping this tick'); db.prepare("INSERT INTO cycles (ts_start, ts_end, assets, rows, note) VALUES (?,?,0,0,'skipped_overrun')").run(Date.now(), Date.now()); return; }
  running = true;
  try {
    const r = await runCycle(db, universe, { lanes, apiKey, fetch }, { log });
    if (r.cycleId % 6 === 0 && !refining) {
      refining = true; // background: do not hold up the next cycle
      runRefine(db, universe, { lanes: refineLanes, apiKey, fetch }, r.cycleId, { iters: 6 })
        .then((n) => log(`refine for cycle ${r.cycleId}: ${n} bisections`))
        .catch((e) => log(`refine failed: ${e?.message}`))
        .finally(() => { refining = false; });
    }
    log(`cycle ${r.cycleId} done: ${r.rows} rows in ${(r.ms / 1000).toFixed(0)}s  rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB  soroswap_key=${apiKey ? 'set' : 'MISSING'}`);
  } catch (e) { log(`cycle failed: ${e?.stack || e}`); }
  finally { running = false; }
}

log(`sounding-sampler start: ${universe.assets.length} assets, interval ${INTERVAL_S}s, db ${DB}, soroswap key ${apiKey ? `set (len ${apiKey.length})` : 'MISSING'}`);
await tick();
if (!ONCE) setInterval(tick, INTERVAL_S * 1000);
else db.close();
