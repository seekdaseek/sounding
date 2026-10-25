#!/usr/bin/env node
//   SOUNDING_DB=/opt/sounding/sounding.db PORT=3035 node bin/api.mjs
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store.mjs';
import { startServer } from '../src/api.mjs';

const DB = process.env.SOUNDING_DB || new URL('../sounding.db', import.meta.url).pathname;
const UNI = process.env.SOUNDING_UNIVERSE || new URL('../data/universe.json', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 3035);
const universe = JSON.parse(readFileSync(UNI, 'utf8'));
const db = openStore(DB, { readonly: true });
await startServer({ db, universe }, PORT);
console.log(`${new Date().toISOString()} sounding-api listening on 127.0.0.1:${PORT}, db ${DB} (read-only)`);
