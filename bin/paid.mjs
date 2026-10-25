#!/usr/bin/env node
// TESTNET paid endpoint. env: X402_TESTNET_PAYTO (G... address, public), SOUNDING_DB, PORT (3036)
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store.mjs';
import { createPaidApp } from '../src/paid.mjs';

const DB = process.env.SOUNDING_DB || new URL('../sounding.db', import.meta.url).pathname;
const universe = JSON.parse(readFileSync(process.env.SOUNDING_UNIVERSE || new URL('../data/universe.json', import.meta.url).pathname, 'utf8'));
const PORT = Number(process.env.PORT || 3036);
const app = createPaidApp({ db: openStore(DB, { readonly: true }), universe, payTo: process.env.X402_TESTNET_PAYTO, facilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator' });
app.listen(PORT, '127.0.0.1', () => console.log(`${new Date().toISOString()} sounding-paid (stellar:testnet) on 127.0.0.1:${PORT}`));
