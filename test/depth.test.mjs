import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseBids, walkBids, bookDepth, assessExit, safeCollateralSize,
} from '../src/depth.mjs';

// A book with obvious arithmetic so failures are readable.
// 100 @ 1.00, 100 @ 0.90, 100 @ 0.50  →  300 base units total
const BOOK = normaliseBids(
  [
    { price: '1.00', amount: '100' },
    { price: '0.90', amount: '100' },
    { price: '0.50', amount: '100' },
  ],
  'base',
).levels;

test('normaliseBids converts counter-denominated amounts to base', () => {
  const { levels } = normaliseBids([{ price: '2.0', amount: '100' }], 'counter');
  assert.equal(levels[0].base, 50); // 100 counter / 2.0 = 50 base
});

test('normaliseBids rejects an unknown denomination rather than guessing', () => {
  assert.throws(() => normaliseBids([], 'whatever'), /amountDenom/);
});

test('a dust level is SKIPPED and COUNTED, never allowed to kill the whole book', () => {
  // Mainnet reality: Horizon renders any price under 1e-7 as "0.0000000".
  // v1 threw here and discarded a good 200-level EURC book over one junk row.
  const { levels, skippedZeroPrice } = normaliseBids(
    [{ price: '1.0', amount: '100' }, { price: '0.0000000', amount: '5' }],
    'base',
  );
  assert.equal(levels.length, 1);
  assert.equal(skippedZeroPrice, 1);
});

test('price_r exact rational beats the rounded 7-decimal string', () => {
  // price string says zero; price_r says otherwise. price_r wins.
  const { levels, skippedZeroPrice } = normaliseBids(
    [{ price: '0.0000000', amount: '100', price_r: { n: 1, d: 100000000 } }],
    'base',
  );
  assert.equal(skippedZeroPrice, 0);
  assert.equal(levels[0].price, 1e-8);
});

test('price_r with zero denominator throws rather than yielding Infinity', () => {
  assert.throws(
    () => normaliseBids([{ price: '1', amount: '1', price_r: { n: 1, d: 0 } }], 'base'),
    /price_r.d is zero/,
  );
});

test('null amount throws — never coerces to a silent 100% haircut', () => {
  // Two coercion traps, one guard. isFinite(null) === true, AND Number(null) === 0.
  // Either one alone turns a failed read into fabricated data.
  assert.throws(() => normaliseBids([{ price: '1', amount: null }], 'base'), /missing/);
});

test('walkBids fills entirely at the top level when size is small', () => {
  const r = walkBids(BOOK, 50);
  assert.equal(r.filled, 50);
  assert.equal(r.proceeds, 50);
  assert.equal(r.vwap, 1.0);
  assert.equal(r.exhausted, false);
  assert.equal(r.levelsUsed, 1);
});

test('walkBids eats down the book and VWAP degrades with size', () => {
  const r = walkBids(BOOK, 200);
  assert.equal(r.filled, 200);
  assert.equal(r.proceeds, 100 * 1.0 + 100 * 0.9); // 190
  assert.equal(r.vwap, 0.95);
  assert.equal(r.levelsUsed, 2);
});

test('walkBids reports a PARTIAL fill honestly, not as zero and not as "cannot exit"', () => {
  const r = walkBids(BOOK, 500);
  assert.equal(r.exhausted, true);
  assert.equal(r.filled, 300);          // not 0, not 500
  assert.equal(r.proceeds, 100 + 90 + 50);
});

test('walkBids ignores upstream ordering — never trusts the feed to be sorted', () => {
  const shuffled = [BOOK[2], BOOK[0], BOOK[1]];
  assert.deepEqual(walkBids(shuffled, 200), walkBids(BOOK, 200));
});

test('walkBids on an empty book returns zero, not NaN', () => {
  const r = walkBids([], 100);
  assert.equal(r.filled, 0);
  assert.equal(r.proceeds, 0);
  assert.equal(r.vwap, null);
  assert.equal(r.exhausted, true);
});

test('bookDepth is the ceiling on any exit', () => {
  assert.equal(bookDepth(BOOK), 300);
});

test('assessExit: mark equals top of book → zero haircut', () => {
  const a = assessExit({ size: 50, markPrice: 1.0, levels: BOOK });
  assert.equal(a.status, 'clears_full_size');
  assert.equal(a.haircutBps, 0);
  assert.equal(a.markedValue, 50);
  assert.equal(a.realisable, 50);
});

test('assessExit: size that eats two levels prices the slippage exactly', () => {
  const a = assessExit({ size: 200, markPrice: 1.0, levels: BOOK });
  // marked 200, realisable 190 → 500 bps
  assert.equal(a.haircutBps, 500);
  assert.equal(a.coverage, 1);
});

test('assessExit: NEGATIVE haircut when the book pays above the mark', () => {
  // This is not a bug and not an edge case. On Solana the index products sat at
  // a persistent premium for weeks, which inverts the naive thesis.
  const a = assessExit({ size: 50, markPrice: 0.8, levels: BOOK });
  assert.ok(a.haircutBps < 0, `expected negative, got ${a.haircutBps}`);
  assert.ok(a.realisable > a.markedValue);
});

test('assessExit: partial fill reports coverage and leaves haircut on the FILLED part only', () => {
  const a = assessExit({ size: 600, markPrice: 1.0, levels: BOOK });
  assert.equal(a.status, 'partial');
  assert.equal(a.filled, 300);
  assert.equal(a.unfilled, 300);
  assert.equal(a.coverage, 0.5);
  // haircut computed against marked value OF WHAT FILLED (300), not of 600
  assert.equal(a.haircutBps, ((300 - 240) / 300) * 10000);
});

test('assessExit: empty book is no_book, not a 100% haircut', () => {
  const a = assessExit({ size: 10, markPrice: 1.0, levels: [] });
  assert.equal(a.status, 'no_book');
  assert.equal(a.haircutBps, null); // absent, not fabricated
});

test('assessExit refuses a zero mark rather than dividing by it', () => {
  assert.throws(() => assessExit({ size: 1, markPrice: 0, levels: BOOK }), /markPrice is zero/);
});

test('safeCollateralSize: 2% tolerance stops inside the top two levels', () => {
  const s = safeCollateralSize(BOOK, 1.0, 200); // floor VWAP = 0.98
  // 100 @1.00 keeps VWAP 1.00. Adding all of 100 @0.90 gives VWAP 0.95 < 0.98,
  // so it takes a partial slice: (0.98*100 - 100)/(0.90-0.98) = 25
  assert.equal(Math.round(s.safeSize), 125);
  assert.equal(s.limitedBy, 'tolerance');
});

test('safeCollateralSize: a generous tolerance is limited by the book, not the rule', () => {
  const s = safeCollateralSize(BOOK, 1.0, 9000);
  assert.equal(s.safeSize, 300);
  assert.equal(s.limitedBy, 'book_depth');
});

test('safeCollateralSize: empty book yields zero and says why', () => {
  const s = safeCollateralSize([], 1.0, 200);
  assert.equal(s.safeSize, 0);
  assert.equal(s.limitedBy, 'no_book');
});

test('safeCollateralSize agrees with assessExit at the boundary', () => {
  // Cross-check: selling exactly safeSize should land within a hair of tolerance.
  const tol = 200;
  const s = safeCollateralSize(BOOK, 1.0, tol);
  const a = assessExit({ size: s.safeSize, markPrice: 1.0, levels: BOOK });
  assert.ok(a.haircutBps <= tol + 1e-6, `haircut ${a.haircutBps} exceeded tolerance ${tol}`);
});

test('undefined, empty string and array amounts all throw — Number() coerces them to 0', () => {
  assert.throws(() => normaliseBids([{ price: '1', amount: undefined }], 'base'), /missing/);
  assert.throws(() => normaliseBids([{ price: '1', amount: '' }], 'base'), /empty string/);
  assert.throws(() => normaliseBids([{ price: '1', amount: [] }], 'base'), /not a number/);
});

test('haircut is monotonically non-decreasing with size — bigger exits never look cheaper', () => {
  let prev = -Infinity;
  for (const size of [10, 50, 100, 150, 200, 250, 300]) {
    const a = assessExit({ size, markPrice: 1.0, levels: BOOK });
    assert.ok(a.haircutBps >= prev - 1e-9, `haircut fell from ${prev} to ${a.haircutBps} at size ${size}`);
    prev = a.haircutBps;
  }
});

test('safeCollateralSize is monotone in tolerance — a looser rule never allows less', () => {
  let prev = 0;
  for (const tol of [0, 100, 200, 500, 1000, 5000]) {
    const s = safeCollateralSize(BOOK, 1.0, tol);
    assert.ok(s.safeSize >= prev - 1e-9, `safeSize fell from ${prev} to ${s.safeSize} at tol ${tol}`);
    prev = s.safeSize;
  }
});

test('zero tolerance permits exactly the liquidity at or above the mark', () => {
  const s = safeCollateralSize(BOOK, 1.0, 0);
  assert.equal(s.safeSize, 100); // only the 1.00 level qualifies
});
