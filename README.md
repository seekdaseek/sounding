# sounding

A sounding is the depth measurement taken before committing the ship.

Blend pools let anyone deploy a lending market and choose their own collateral,
oracle and risk parameters. Nothing tells a pool creator whether the collateral
they accepted can actually be sold at the size they are lending against.

In February 2026 the YieldBlox pool lost roughly 10.8 million dollars to oracle
manipulation. The post mortem's own prescription was to check orderbook depth
against the borrow limit before an asset is used as collateral. This measures
exactly that.

## What it found

Measured against Blend Fixed Pool V2 on Stellar mainnet, 7 August 2026.
Pool CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD.
175.74 million supplied, 51.65 million borrowed, 2.79 million backstop.

Routed exit haircut against the pool's own oracle mark, quoted through
Stellar path payments across order books and AMM pools.

| asset | marked | 1k | 10k | 100k | 1M | 10M |
|-------|--------|-----|------|-------|-----|------|
| XLM  | $109,414,596 | 22bps | 25bps | 407bps | 3208bps | 8241bps |
| EURC | $3,233,752 | 41bps | 64bps | 4958bps | 9091bps | n/a |

Selling one million dollars of that XLM costs 32 percent. Selling one hundred
thousand of the EURC costs 49 percent, on a reserve carrying a 0.95 collateral
factor, which is to say the pool treats it as 95 percent as good as cash.

The direct order book alone says XLM has 27,308 dollars of depth and that 9,717
is safe at a 2 percent tolerance. Routing says 100k moves at 4 percent. Those
answers differ by an order of magnitude, and a pool creator sizing off the wrong
one is making the YieldBlox mistake.

Two runs minutes apart gave 304 and then 407 basis points for the same 100k XLM
exit. A single reading is not a finding. That is the argument for continuous
sampling rather than a caveat against it.

## Why Stellar

On an AMM chain depth can only be inferred, by firing quote requests at
increasing sizes and bisecting toward the edge. That is slow, rate limited, and
it quantises the answer to wherever the probes happened to land.

SDEX is a native order book. Depth is read, not inferred, and the exit curve is
closed form from one call. The same measurement is a better product here than on
the chain it was first built for.

## What is honest and what is not

Horizon path finding covers classic order books and classic AMM pools. Whether
it reaches Soroban contract based AMMs such as Aquarius is not established, so
the numbers above are a floor rather than the full picture. Closing that gap is
open work.

Marks are oracle USD and proceeds are USDC, which assumes USDC trades at a
dollar.

A liquidator is not confined to on chain venues. They can take the collateral
and offload it to an exchange. The claim here is that the on chain number binds
during a fast cascade, which is when liquidations fire, not that off chain
liquidity does not exist.

## Layout

    src/depth.mjs   pure math, no I/O and no clock
    test/           26 offline tests, no network
    bin/probe.mjs   live mainnet measurement

## Running it

    npm i
    npm test
    export USDC_ISSUER=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
    export SOROBAN_RPC=https://mainnet.sorobanrpc.com
    node bin/probe.mjs --pool <BLEND_POOL_ID> --denom base

## Rules enforced in code, not prose

A partial fill is reported as partial with the amount actually sold. Never
rounded up to cannot exit, which reads as unsellable and is false. Never
rounded down to zero.

A failed read is never a finding. The verdict is three way, quotable against
soroban native against measurement failed, so a bug in this code cannot
masquerade as the conclusion that there is no liquidity. That masquerade existed
in the first version and was caught in review.

Negative haircuts are reported, not suppressed. A book paying above the mark
means the collateral is marked conservatively, which inverts the naive story.

Missing values throw instead of coercing. Number(null) is 0 and isFinite(null)
is true, so an unguarded read turns a failure into fabricated data. There is a
test for every value JavaScript silently turns into zero.

Prices come from Horizon's exact rational price_r, not the seven decimal string,
which renders anything below 1e-7 as zero. Dust levels are skipped and counted
rather than thrown on. One junk row once discarded an entire good 200 level
book.

Ordering from upstream is never trusted. The book is sorted before it is walked.

## License

MIT
