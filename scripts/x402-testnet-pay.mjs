#!/usr/bin/env node
// x402-testnet-pay.mjs — ONE real paid call, end to end, on stellar:testnet.
//   node scripts/x402-testnet-pay.mjs [url]   (default https://sounding.ochinimus.app/paid/v1/exit?asset=XLM&size=100000)
// Reads X402_TESTNET_PAYER_SECRET from ./.env (never printed). Flow = x402-stellar examples/client-cli:
// fetch -> 402 -> sign payment payload -> retry with PAYMENT-SIGNATURE -> 200 + PAYMENT-RESPONSE (settlement).
import { readFileSync } from 'node:fs';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url).pathname, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const url = process.argv[2] || 'https://sounding.ochinimus.app/paid/v1/exit?asset=XLM&size=100000';
const signer = createEd25519Signer(env.X402_TESTNET_PAYER_SECRET, 'stellar:testnet');
const client = new x402HTTPClient(new x402Client().register('stellar:*', new ExactStellarScheme(signer)));

const first = await fetch(url);
console.log('1. unpaid request ->', first.status);
if (first.status !== 402) { console.log(await first.text()); process.exit(first.status === 200 ? 0 : 1); }
const required = client.getPaymentRequiredResponse((n) => first.headers.get(n), await first.json().catch(() => undefined));
const acc = required.accepts[0];
console.log('2. server asks:', { scheme: acc.scheme, network: acc.network, amount: acc.amount, asset: acc.asset, payTo: acc.payTo });
const payload = await client.createPaymentPayload(required);
const headers = client.encodePaymentSignatureHeader(payload);
const paid = await fetch(url, { headers });
console.log('3. paid request ->', paid.status);
const settle = paid.headers.get('payment-response') || paid.headers.get('x-payment-response');
let receipt = null;
if (settle) { try { receipt = client.getPaymentSettleResponse((n) => paid.headers.get(n)); } catch (e) { receipt = { raw: settle.slice(0, 200), err: String(e) }; } }
console.log('4. settlement:', JSON.stringify(receipt));
const body = await paid.json().catch(() => null);
console.log('5. body:', body ? { paid: body.paid, asset: body.asset, size_usd: body.size_usd, ts: body.ts, best: body.best } : null);
if (receipt?.transaction) console.log('EXPLORER https://stellar.expert/explorer/testnet/tx/' + receipt.transaction);
