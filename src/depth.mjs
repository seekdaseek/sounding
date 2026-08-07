// depth.mjs — pure math over an SDEX orderbook. No I/O, no clock, no network.
//
// THE POINT OF THIS FILE, and the reason Stellar is a better home for this
// measurement than Solana: on an AMM chain you can only INFER depth by firing
// quote requests at increasing sizes and bisecting. Here the orderbook IS the
// depth. One read gives the exact realisable curve, computed analytically.
// No probing, no bisection, no rate limit, no quantisation artifact.

/**
 * A single price level. `price` is counter-per-base. `amount` is in whatever
 * denomination the caller declares — see walkBids().
 * @typedef {{price: string|number, amount: string|number}} Level
 */

/** Reject anything that would silently poison the arithmetic. */
function num(v, field) {
  // CAUGHT BY test/depth.test.mjs, and it matters: Number(null) === 0,
  // Number('') === 0, Number([]) === 0. A finite-check alone therefore lets a
  // missing field through as ZERO DEPTH, which is silently worse than a throw —
  // it reads as "the book is empty" instead of "we failed to read the book".
  // Reject absent and non-numeric inputs explicitly, before any coercion.
  if (v === null || v === undefined) throw new TypeError(`${field} is missing (${v})`);
  if (typeof v !== 'number' && typeof v !== 'string') {
    throw new TypeError(`${field} is not a number or numeric string: ${JSON.stringify(v)}`);
  }
  if (typeof v === 'string' && v.trim() === '') throw new TypeError(`${field} is an empty string`);
  const n = Number(v);
  // Number.isFinite, never the global isFinite() — isFinite(null) is true, and
  // that exact coercion fabricated 100% haircuts in an earlier collector.
  if (!Number.isFinite(n)) throw new TypeError(`${field} is not a finite number: ${JSON.stringify(v)}`);
  if (n < 0) throw new RangeError(`${field} is negative: ${n}`);
  return n;
}

/**
 * Normalise a raw Horizon bid array into base-denominated levels.
 *
 * PRICE SOURCE: Horizon serves `price` as a 7-decimal STRING and `price_r` as
 * an exact rational {n, d}. The string rounds any price below 1e-7 to
 * "0.0000000". Real books carry dust bids down there, so the string form both
 * loses precision and manufactures zeroes. Use price_r when present.
 *
 * DUST HANDLING: a level whose price is still zero after using price_r is not
 * liquidity — selling into it yields nothing. Skip it and COUNT it. Throwing
 * would discard an entire good book over one junk level (that is exactly what
 * happened to EURC on mainnet), and silently dropping it would hide how much
 * of the book was ignored.
 *
 * HORIZON DENOMINATION: settled empirically on mainnet — bid amounts are
 * 'base'-denominated. Kept as an explicit argument so the assumption stays
 * visible and falsifiable rather than buried.
 *
 * @param {Level[]} bids
 * @param {'base'|'counter'} amountDenom
 * @returns {{levels: {price:number, base:number}[], skippedZeroPrice: number}}
 */
export function normaliseBids(bids, amountDenom) {
  if (!Array.isArray(bids)) throw new TypeError('bids must be an array');
  if (amountDenom !== 'base' && amountDenom !== 'counter') {
    throw new TypeError(`amountDenom must be 'base' or 'counter', got ${amountDenom}`);
  }
  const levels = [];
  let skippedZeroPrice = 0;

  bids.forEach((b, i) => {
    // Exact rational first, 7-decimal string only as fallback.
    let price;
    if (b.price_r && b.price_r.d !== undefined && b.price_r.n !== undefined) {
      const n = num(b.price_r.n, `bids[${i}].price_r.n`);
      const d = num(b.price_r.d, `bids[${i}].price_r.d`);
      if (d === 0) throw new RangeError(`bids[${i}].price_r.d is zero`);
      price = n / d;
    } else {
      price = num(b.price, `bids[${i}].price`);
    }
    const amount = num(b.amount, `bids[${i}].amount`);

    if (price === 0) { skippedZeroPrice++; return; } // dust, not liquidity
    levels.push({ price, base: amountDenom === 'base' ? amount : amount / price });
  });

  return { levels, skippedZeroPrice };
}

/**
 * Sell `size` units of the base asset into the bid side, best price first.
 *
 * Returns BOTH bounds honestly. A partial fill is reported as partial with the
 * amount actually sold — never rounded up to "cannot exit", which reads as
 * unsellable and is false, and never rounded down to zero.
 *
 * @param {{price:number, base:number}[]} levels - normalised, any order
 * @param {number} size - units of base asset to sell
 * @returns {{filled:number, proceeds:number, vwap:number|null, exhausted:boolean, levelsUsed:number}}
 */
export function walkBids(levels, size) {
  const want = num(size, 'size');
  if (want === 0) return { filled: 0, proceeds: 0, vwap: null, exhausted: false, levelsUsed: 0 };

  // Best bid = highest price. Never trust upstream ordering.
  const sorted = [...levels].sort((a, b) => b.price - a.price);

  let remaining = want;
  let proceeds = 0;
  let levelsUsed = 0;

  for (const lvl of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lvl.base);
    if (take <= 0) continue;
    proceeds += take * lvl.price;
    remaining -= take;
    levelsUsed++;
  }

  const filled = want - remaining;
  return {
    filled,
    proceeds,
    vwap: filled > 0 ? proceeds / filled : null,
    exhausted: remaining > 1e-12,
    levelsUsed,
  };
}

/** Total base units the book can absorb. The ceiling on any exit. */
export function bookDepth(levels) {
  return levels.reduce((s, l) => s + l.base, 0);
}

/**
 * The measurement. Compare what a pool MARKS collateral at against what the
 * book would actually pay for it.
 *
 * A positive haircut means the mark is optimistic: selling realises less than
 * the oracle says it is worth. A NEGATIVE haircut means the mark is
 * conservative — the book pays more than the oracle. Both happen and both are
 * reported; on Solana the index products sat at a persistent premium for weeks,
 * which inverts the naive "collateral is overvalued" story.
 *
 * @param {object} a
 * @param {number} a.size - units of collateral marked by the pool
 * @param {number} a.markPrice - the pool oracle's price per unit
 * @param {{price:number, base:number}[]} a.levels - normalised bid levels
 * @returns {object} assessment
 */
export function assessExit({ size, markPrice, levels }) {
  const sz = num(size, 'size');
  const mark = num(markPrice, 'markPrice');
  if (mark === 0) throw new RangeError('markPrice is zero — refusing to divide by it');

  const markedValue = sz * mark;
  const walk = walkBids(levels, sz);
  const depth = bookDepth(levels);

  // Only meaningful over the portion that actually filled.
  const markedOnFilled = walk.filled * mark;
  const haircutBps = markedOnFilled > 0
    ? ((markedOnFilled - walk.proceeds) / markedOnFilled) * 10000
    : null;

  let status;
  if (depth === 0) status = 'no_book';
  else if (!walk.exhausted) status = 'clears_full_size';
  else if (walk.filled > 0) status = 'partial';
  else status = 'no_fill';

  return {
    status,
    markedValue,
    realisable: walk.proceeds,
    filled: walk.filled,
    unfilled: sz - walk.filled,
    coverage: sz > 0 ? walk.filled / sz : null,
    haircutBps,
    vwap: walk.vwap,
    markPrice: mark,
    bookDepthBase: depth,
    levelsUsed: walk.levelsUsed,
  };
}

/**
 * The prescriptive output — the number a pool creator can actually act on.
 *
 * Instead of "your collateral is overvalued by X", answer "the largest position
 * this book can absorb without the exit slipping past `maxHaircutBps`". That is
 * a borrow-limit input, not a dashboard metric.
 *
 * Exact, not searched: walk the levels once and stop at the crossing point.
 *
 * @param {{price:number, base:number}[]} levels
 * @param {number} markPrice
 * @param {number} maxHaircutBps - tolerance, e.g. 200 = 2%
 * @returns {{safeSize:number, safeValue:number, bindingPrice:number|null, limitedBy:'tolerance'|'book_depth'|'no_book'}}
 */
export function safeCollateralSize(levels, markPrice, maxHaircutBps) {
  const mark = num(markPrice, 'markPrice');
  const tol = num(maxHaircutBps, 'maxHaircutBps');
  if (mark === 0) throw new RangeError('markPrice is zero');

  const sorted = [...levels].sort((a, b) => b.price - a.price);
  if (sorted.length === 0) {
    return { safeSize: 0, safeValue: 0, bindingPrice: null, limitedBy: 'no_book' };
  }

  const floorPrice = mark * (1 - tol / 10000);

  let size = 0;
  let proceeds = 0;
  let binding = null;

  for (const lvl of sorted) {
    // Full level: does taking all of it keep VWAP above the floor?
    const nextSize = size + lvl.base;
    const nextProceeds = proceeds + lvl.base * lvl.price;
    if (nextSize > 0 && nextProceeds / nextSize >= floorPrice) {
      size = nextSize;
      proceeds = nextProceeds;
      binding = lvl.price;
      continue;
    }
    // Partial level: solve for the exact size where VWAP == floorPrice.
    //   (proceeds + x*p) / (size + x) = floor
    //   x = (floor*size - proceeds) / (p - floor)
    const denom = lvl.price - floorPrice;
    if (denom >= 0) break; // cannot bind; guard against divide-by-zero
    const x = (floorPrice * size - proceeds) / denom;
    if (x > 0) {
      const take = Math.min(x, lvl.base);
      size += take;
      proceeds += take * lvl.price;
      binding = lvl.price;
    }
    break;
  }

  return {
    safeSize: size,
    safeValue: proceeds,
    bindingPrice: binding,
    limitedBy: size >= bookDepth(levels) - 1e-9 ? 'book_depth' : 'tolerance',
  };
}
