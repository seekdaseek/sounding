#!/usr/bin/env node
// probe.mjs v2 — GATE, NOT A BUILD.
//
// v1 answered the kill question correctly (Blend reserves ARE Stellar Asset
// Contracts with SDEX books) but its NUMBERS were wrong for two reasons, both
// found by disbelieving an implausible result rather than filing it:
//
//   BUG 1  Horizon paginates. The orderbook call had no .limit(), so it
//          returned the DEFAULT 20 price levels per side and bookDepth()
//          summed a truncated book. On XLM/USDC that reported ~5,037 XLM of
//          depth against $109M of marked collateral. Horizon's max is 200.
//
//   BUG 2  The direct orderbook is only ONE venue. Stellar routes exits
//          through path payments, which traverse multi-hop order books AND
//          AMM liquidity pools. Quoting only the direct book understates
//          realisable value, possibly by orders of magnitude. strictSendPaths
//          is what a liquidator would actually use, and the denomination
//          check already proved it works.
//
// v2 measures BOTH and prints them side by side, because the difference
// between them IS the finding: it is the gap between the naive read and the
// real one, and any product built here has to use the second.
//
// USAGE (MAC):
//   export USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
//   export SOROBAN_RPC=https://mainnet.sorobanrpc.com
//   node bin/probe.mjs --pool <POOL_ID>            (bid amounts are COUNTER-denominated; see verifyDenomination)

import { Horizon, Asset, Networks } from '@stellar/stellar-sdk';
import { PoolV2, PoolV1, TokenMetadata } from '@blend-capital/blend-sdk';
import { normaliseBids, assessExit, safeCollateralSize, bookDepth, walkBids } from '../src/depth.mjs';

const HORIZON = process.env.HORIZON_URL || 'https://horizon.stellar.org';
const RPC = process.env.SOROBAN_RPC || '';
const USDC_ISSUER = process.env.USDC_ISSUER || '';
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const ORDERBOOK_LIMIT = 200; // Horizon's maximum. Never leave this defaulted.
const horizon = new Horizon.Server(HORIZON);
function fail(m) { console.error(`\n  FAIL: ${m}\n`); process.exit(1); }
const short = (id) => (id.length > 14 ? `${id.slice(0, 6)}\u2026${id.slice(-4)}` : id);
const usd = (n) => (n === null || n === undefined ? '' : `$${Math.round(n).toLocaleString('en-US')}`);

/**
 * Which asset are order_book bid amounts denominated in? CORRECTED 2026-10-25.
 * v1 compared a path quote with the top bid's AMOUNT, which cannot tell the hypotheses apart (it concluded
 * "base"; that was wrong, and every direct-book depth figure from v1 inherited the error). The test here
 * sells exactly what the first 15 bid levels absorb under the COUNTER hypothesis, then walks the book under
 * both hypotheses and compares each with the real strictSendPaths quote. The right one reproduces it.
 */
async function verifyDenomination() {
  if (!USDC_ISSUER) fail('set USDC_ISSUER (read off stellar.expert, never memory)');
  const base = Asset.native();
  const counter = new Asset('USDC', USDC_ISSUER);
  const ob = await horizon.orderbook(base, counter).limit(ORDERBOOK_LIMIT).call();
  if (!ob.bids?.length) fail('no bids on XLM/USDC');
  const lc = normaliseBids(ob.bids, 'counter').levels;
  const lb = normaliseBids(ob.bids, 'base').levels;
  const size = lc.slice(0, 15).reduce((s, l) => s + l.base, 0);
  const paths = await horizon.strictSendPaths(base, size.toFixed(7), [counter]).call();
  if (!paths.records?.length) fail('no path found');
  const got = Math.max(...paths.records.map((x) => Number(x.destination_amount)));
  const eC = Math.abs(walkBids(lc, size).proceeds - got) / got;
  const eB = Math.abs(walkBids(lb, size).proceeds - got) / got;
  console.log(`\n  strictSendPaths(sell ${size.toFixed(7)} XLM) -> ${got}`);
  console.log(`  walk error if bids are counter-denominated=${(eC * 100).toFixed(4)}%  if base-denominated=${(eB * 100).toFixed(4)}%`);
  console.log(`  => bid amounts are ${eC < eB ? 'COUNTER' : 'BASE'}-denominated\n`);
}

/**
 * Routed exit quote: what a liquidator actually gets for selling `size`,
 * across every venue Horizon can route through (multi-hop books + AMM pools).
 * Returns null when no path exists at that size — which is itself information,
 * and is NOT the same as zero proceeds.
 */
async function routedQuote(sourceAsset, size, destAsset) {
  try {
    const r = await horizon.strictSendPaths(sourceAsset, size.toFixed(7), [destAsset]).call();
    if (!r.records?.length) return null;
    return Math.max(...r.records.map((x) => Number(x.destination_amount)));
  } catch {
    return null;
  }
}

async function probePool(poolId, denom) {
  if (!RPC) fail('set SOROBAN_RPC');
  if (!USDC_ISSUER) fail('set USDC_ISSUER');
  const network = { rpc: RPC, passphrase: Networks.PUBLIC };

  console.log(`\n  loading pool ${short(poolId)}`);
  let pool;
  try { pool = await PoolV2.load(network, poolId); console.log('  loaded as V2'); }
  catch (e2) {
    try { pool = await PoolV1.load(network, poolId); console.log('  loaded as V1'); }
    catch (e1) { fail(`V2: ${e2.message} | V1: ${e1.message}`); }
  }

  const oracle = await pool.loadOracle();
  console.log(`  oracle ${short(oracle.oracleId)} - ${oracle.prices.size} prices - ledger ${oracle.latestLedger}`);
  console.log(`  orderbook limit ${ORDERBOOK_LIMIT} (Horizon max) - bid amounts '${denom}'-denominated`);
  console.log('  marks are oracle USD, proceeds USDC - assumes USDC ~ USD\n');

  const usdc = new Asset('USDC', USDC_ISSUER);
  const rows = [];
  const curves = [];

  for (const [assetId, reserve] of pool.reserves) {
    const supplied = reserve.totalSupplyFloat();
    const mark = oracle.getPriceFloat(assetId);
    const row = { asset: short(assetId), cf: reserve.getCollateralFactor(), supplied: Math.round(supplied) };

    if (mark === undefined) { row.status = 'no_oracle_price'; rows.push(row); continue; }
    row.markedUSD = usd(supplied * mark);

    let meta;
    try { meta = await TokenMetadata.load(network, assetId); }
    catch (e) { row.status = 'measurement_failed'; row.note = String(e.message).slice(0, 50); rows.push(row); continue; }
    row.sym = meta.symbol;

    if (meta.asset === undefined) { row.status = 'soroban_native_no_sdex'; rows.push(row); continue; }
    if (meta.asset.equals(usdc)) { row.status = 'quote_asset'; rows.push(row); continue; }

    try {
      const ob = await horizon.orderbook(meta.asset, usdc).limit(ORDERBOOK_LIMIT).call();
      const { levels, skippedZeroPrice } = normaliseBids(ob.bids || [], denom);
      row.bidLevels = (ob.bids || []).length;
      if (skippedZeroPrice) row.dust = skippedZeroPrice;
      row.bookDepthUSD = usd(bookDepth(levels) * mark);
      row.bookSafeUSD = usd(safeCollateralSize(levels, mark, 200).safeValue);
      row.status = assessExit({ size: supplied, markPrice: mark, levels }).status;

      // ROUTED EXIT CURVE - the venue that actually matters.
      // A ladder of absolute USD sizes so numbers are comparable across
      // reserves of wildly different size.
      const curve = { sym: meta.symbol };
      for (const targetUSD of [1e3, 1e4, 1e5, 1e6, 1e7]) {
        const label = targetUSD >= 1e6 ? `$${targetUSD / 1e6}M` : `$${targetUSD / 1e3}k`;
        const units = targetUSD / mark;
        if (units > supplied) { curve[label] = 'n/a'; continue; }
        const got = await routedQuote(meta.asset, units, usdc);
        curve[label] = got === null ? 'no route' : `${Math.round(((targetUSD - got) / targetUSD) * 10000)}bps`;
      }
      curves.push(curve);
    } catch (e) {
      row.status = 'measurement_failed';
      row.note = `${e?.response?.status ?? '?'}: ${String(e.message).slice(0, 50)}`;
    }
    rows.push(row);
  }

  console.log('  DIRECT ORDERBOOK ONLY (naive read)');
  console.table(rows);
  console.log('\n  ROUTED EXIT - haircut vs oracle mark, all venues (books + AMM pools, multi-hop)');
  console.table(curves);

  const failed = rows.filter((r) => r.status === 'measurement_failed');
  const native = rows.filter((r) => r.status === 'soroban_native_no_sdex');
  const quotable = rows.filter((r) => ['clears_full_size', 'partial', 'no_fill', 'no_book'].includes(r.status));

  console.log(`\n  VERDICT: ${quotable.length} SDEX-quotable - ${native.length} soroban-native - ${failed.length} failures`);
  if (failed.length) console.log('  -> failures are a code problem, not a finding. Fix before reading anything.');
  else if (!quotable.length && !native.length) console.log('  -> nothing measurable in this pool.');
  else if (!quotable.length) console.log('  -> all collateral Soroban-native: NO SDEX book. Exit side must be AMM/paths.');
  else console.log('  -> thesis holds. The gap between the two tables IS the product.');
  console.log('');
}

const denomFlag = val('--denom') || 'counter'; // corrected 2026-10-25: Horizon bid amounts are counter-denominated
if (has('--verify-denomination')) await verifyDenomination();
else if (val('--pool')) await probePool(val('--pool'), denomFlag);
else console.log(`
  sounding probe v2

    node bin/probe.mjs --verify-denomination
    node bin/probe.mjs --pool <BLEND_POOL_ID> [--denom counter|base]   (default counter)

  env: SOROBAN_RPC, USDC_ISSUER, HORIZON_URL (optional)
`);
