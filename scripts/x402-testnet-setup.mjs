#!/usr/bin/env node
// x402-testnet-setup.mjs — one-time TESTNET setup for the paid-endpoint proof.
//   1. generates a payer and a payTo keypair (fresh, testnet only)
//   2. writes their secrets to ./.env (mode 600, gitignored) - never printed
//   3. funds both with friendbot, opens USDC trustlines
//   4. buys USDC for the payer with testnet XLM on the testnet DEX (no captcha faucet)
// Prints PUBLIC addresses and balances only. Safe to re-run: reuses keys already in .env.
import { Keypair, Asset, Horizon, Networks, TransactionBuilder, Operation, BASE_FEE } from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

const ENV = new URL('../.env', import.meta.url).pathname;
const H = new Horizon.Server('https://horizon-testnet.stellar.org');
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'); // Circle testnet USDC
const WANT_USDC = process.env.WANT_USDC || '5';

const env = existsSync(ENV) ? Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {};
let changed = false;
for (const k of ['X402_TESTNET_PAYER_SECRET', 'X402_TESTNET_PAYTO_SECRET']) if (!env[k]) { env[k] = Keypair.random().secret(); changed = true; }
if (changed) {
  writeFileSync(ENV, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(ENV, 0o600);
}
const payer = Keypair.fromSecret(env.X402_TESTNET_PAYER_SECRET), payTo = Keypair.fromSecret(env.X402_TESTNET_PAYTO_SECRET);

async function fund(kp) {
  try { await H.loadAccount(kp.publicKey()); return 'exists'; } catch { /* not yet */ }
  const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
  return 'funded';
}
async function submit(kp, ops) {
  const acct = await H.loadAccount(kp.publicKey());
  let b = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).setTimeout(60);
  for (const op of ops) b = b.addOperation(op);
  const tx = b.build(); tx.sign(kp);
  return H.submitTransaction(tx);
}
const bal = async (kp) => { const a = await H.loadAccount(kp.publicKey()); const f = (c) => a.balances.find((x) => c(x))?.balance ?? null; return { xlm: f((x) => x.asset_type === 'native'), usdc: f((x) => x.asset_code === 'USDC' && x.asset_issuer === USDC.issuer) }; };
const hasTrust = async (kp) => (await bal(kp)).usdc !== null;

console.log('payer :', payer.publicKey(), await fund(payer));
console.log('payTo :', payTo.publicKey(), await fund(payTo));
for (const [name, kp] of [['payer', payer], ['payTo', payTo]]) {
  if (!(await hasTrust(kp))) { await submit(kp, [Operation.changeTrust({ asset: USDC })]); console.log(`${name}: USDC trustline opened`); }
}
const before = await bal(payer);
if (Number(before.usdc) < Number(WANT_USDC)) {
  const r = await submit(payer, [Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: '200', destination: payer.publicKey(), destAsset: USDC, destAmount: WANT_USDC })]);
  console.log('payer: bought', WANT_USDC, 'USDC on testnet DEX, tx', r.hash);
}
console.log('payer balances', await bal(payer));
console.log('payTo balances', await bal(payTo));
