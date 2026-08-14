# sounding — technical architecture

Depth-adjusted collateral sizing for Blend lending pools on Stellar.

This document describes the system as it exists today and the Stellar integration planned for the SCF Build award. Every number in the measurement sections was produced by running the code in this repository against Stellar mainnet. Nothing here is projected.

---

## 1. The problem, stated as a Stellar problem

A Blend pool creator sets a collateral factor per reserve. That factor is applied to an oracle mark. The oracle reports what one unit is worth. It does not report how many units the venue will actually absorb before the price moves.

On 22 February 2026 the community-managed YieldBlox DAO pool on Blend was drained for roughly $10.8M through oracle manipulation. The post-mortem's own prescription was to check the depth of the order book before pricing an asset as collateral, and to refuse an asset as collateral where trade volume is smaller than the borrow limit it would support.

Nobody built that. sounding is that.

The measurement below shows the size of the hole on the largest live Blend pool.

---

## 2. Why this is a better product on Stellar than anywhere else

This is the part that is not a shoehorn.

On an AMM chain, book depth can only be inferred. You fire quotes at increasing sizes and bisect toward the point where slippage crosses your tolerance. That is slow, rate limited, and quantised to wherever your probes happen to land.

SDEX is a native order book. Depth is a primitive you read, not a quantity you infer. The exit curve comes back from one call, and the crossing point is then closed form. The same measurement is materially cheaper and materially more exact here than on the chain the engine was first written for.

Stellar also gives the exit side a second surface that most chains do not separate: path payments. `strictSendPaths` routes across multi-hop order books and classic AMM pools in a single query, so realisable value can be quoted against actual routed liquidity rather than one venue.

---

## 3. Read side — pool state

Dependencies, both installed and exercised: `@blend-capital/blend-sdk` 3.3.0, `@stellar/stellar-sdk` 16.2.0.

Flow:

1. `PoolV2.load(network, poolId)` returns the pool. `PoolV1.load` for V1 pools.
2. `pool.reserves` is a `Map<assetId, Reserve>`.
3. `pool.loadOracle()` returns a `PoolOracle`; `getPriceFloat(assetId)` is the marked price the pool prices collateral at.
4. `Reserve.getCollateralFactor()` and `Reserve.totalSupplyFloat()` give the factor and the supplied amount.
5. `ReserveConfigV2` carries `c_factor`, `l_factor`, `util`, `max_util`, `supply_cap`, `enabled`.

The `network` object is `{ rpc, passphrase }`, with the passphrase `Public Global Stellar Network ; September 2015` from `Networks.PUBLIC`.

Two traps that are already handled in the code and are worth stating because they silently corrupt results:

- Raw `data.bSupply` is denominated in bTokens and understates supply. `totalSupplyFloat()` applies bRate and decimals. Use it.
- SDF publishes Soroban RPC for testnet and futurenet only. There is no public SDF mainnet Soroban RPC, so mainnet reads go through a third-party provider. Any candidate is health-checked with a `getHealth` JSON-RPC call and must return `status: healthy` before a run starts.

### The discriminator that decides whether any of this works

`TokenMetadata.load(network, assetId).asset` returns the classic Stellar asset if and only if the token is a Stellar Asset Contract, and `undefined` if it is Soroban native.

This matters because a Soroban-native token has no SDEX order book, and the order book thesis would collapse for it. The probe therefore prints a three-way verdict per reserve — SDEX quotable, Soroban native, or measurement failed — and suppresses any conclusion at all unless failures are zero. A code error that throws on every reserve must never be readable as a finding about the market.

---

## 4. Exit side — realisable value

Horizon is public at `horizon.stellar.org` and needs no key. Two calls carry the exit side.

**Direct order book.** `Horizon.Server.orderbook(selling, buying)` returns bids and asks.

- The response is paginated. The default is 20 levels and the maximum is 200. Without an explicit `.limit(200)` you sum a truncated book and report a fraction of the real depth as if it were all of it.
- Bid `amount` is denominated in the **base** asset. This was settled empirically on mainnet rather than assumed. Top XLM/USDC bid: amount 95.9815328 at price 0.1618353. `strictSendPaths` selling 95.9815328 XLM returned 15.5331969 USDC against a base-hypothesis prediction of 15.5332002. Relative error 0.00% if base, 83.82% if counter. Unambiguous.
- Prices are read from Horizon's exact rational `price_r {n, d}` in preference to the seven-decimal `price` string. A dust bid priced below 1e-7 renders as the string `"0.0000000"`, and reading the string throws away an otherwise good 200-level book over one junk row. Dust levels are skipped and counted, never silently dropped.

**Routed exit.** `strictSendPaths(asset, amount, [destination])` quotes the proceeds of actually selling a given size across multi-hop order books and classic AMM pools. Amounts are rounded to seven decimals because Horizon rejects more.

The haircut is the gap between the oracle mark times size and the routed proceeds, in basis points.

---

## 5. The math

`src/depth.mjs` is 220 lines of pure arithmetic with no I/O and no clock, which is why it is testable offline. 26 tests, zero failures.

The exported primitive is prescriptive rather than descriptive:

```
safeCollateralSize(levels, markPrice, maxHaircutBps)
```

It answers: the largest position this book absorbs before the exit slips past X basis points. That is an input a pool creator sets a borrow limit from, not a metric they read and interpret. The crossing point is solved in closed form by walking the cumulative level curve; there is no bisection and no repeated quoting.

---

## 6. What the code measured on mainnet

Pool: Blend "Fixed Pool V2", `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD`, the largest on mainnet. Supplied $175.74M, borrowed $51.65M, backstop $2.79M.

Verdict: 2 SDEX quotable, 0 Soroban native, 0 measurement failures. Blend collateral is Stellar Asset Contracts with real order books. The kill risk did not fire.

| Reserve | c_factor | Supplied | Mark | Marked value |
|---|---|---|---|---|
| XLM | 0.75 | 675,808,813 | $0.1620 | $109,414,596 |
| USDC | 0.95 | ~62,985,444 | — | $63,026,674 (quote asset, skipped) |
| EURC | 0.95 | 2,803,565 | $1.1535 | $3,233,752 |

Routed exit haircut against the oracle mark, by absolute USD size:

| Size | XLM | EURC |
|---|---|---|
| $1k | 22 bps | 41 bps |
| $10k | 25 bps | 64 bps |
| $100k | 407 bps | 4,958 bps |
| $1M | 3,208 bps | 9,091 bps |
| $10M | 8,241 bps | exceeds supply |

Read plainly: the pool marks $109.4M of XLM and $3.2M of EURC against $51.65M borrowed, but selling $1M of that XLM on chain costs 32 percent, and selling $100k of the EURC costs about 50 percent against a 0.95 collateral factor.

The naive read is far worse. Quoting the direct order book alone gives XLM depth of $27,308 across 200 levels, safe size at a 2 percent tolerance of $9,717; EURC depth of $24,386 across 50 levels, safe size $17,757. A creator sizing off the direct book and a creator sizing off routed liquidity get answers that differ by orders of magnitude, and that mis-sizing is the YieldBlox failure mode.

One reading is not a finding. Two runs minutes apart moved the XLM $100k haircut from 304 bps to 407 bps and direct book depth from $29,396 to $27,308. That drift is the argument for continuous sampling, and it is the product rather than a caveat to bury.

---

## 7. Known measurement gaps

Stated here so a reviewer reads them from me rather than discovering them.

1. Horizon path finding covers classic order books and classic Protocol 18 AMM pools. It may not reach Soroban contract AMMs such as Aquarius, which held over $40M TVL in early 2026. Realisable liquidity is therefore at least what is measured and possibly more. Every figure above is a floor. Closing this gap is scoped as build work, not hidden.
2. Marks are oracle USD and proceeds are USDC, so the numbers assume USDC is approximately USD.
3. A liquidator is not confined to on-chain venues and can warehouse a position and offload to a centralised exchange. The defensible claim is that the on-chain number binds during a fast cascade, which is exactly when liquidations fire. It is not that off-chain liquidity does not exist.

---

## 8. Architecture to be built under the award

Today's system is a probe: one run, one snapshot, a terminal. Three things turn it into infrastructure the ecosystem consumes.

**Sampler.** A scheduled collector that reads Blend V2 pools and writes timestamped depth and haircut snapshots to a time series store. This is what makes the 304 to 407 bps drift legible instead of anecdotal. Node and TypeScript, the same read and exit paths described above.

**Coverage.** Aquarius and other Soroban contract AMMs added to the exit side so the routed quote stops being a floor. This closes gap 1 above.

**Publisher.** A Soroban contract that publishes the depth-adjusted safe collateral size per asset as a risk parameter a pool creator can read on chain. This is the piece that makes Stellar core rather than incidental: the output is not a dashboard someone looks at, it is a value a pool consumes when setting a borrow limit. The contract will be Rust compiled to WASM, MIT licensed, and open sourced in this repository before mainnet deployment.

Data flow:

```
Soroban RPC ──► Blend SDK ──► pool state, marks, factors ──┐
                                                            ├──► depth.mjs ──► sampler store ──► publisher contract ──► pool creators
Horizon ──► orderbook(limit 200) + strictSendPaths ────────┘                              └──► read API + web UI
```

A thin web interface sits on the read API from the first milestone, not bolted on at the end: a pool is pre-loaded so a stranger sees a real number with nothing typed and nothing installed, and a paste-your-own-pool-ID box comes second.

---

## 9. Verified Stellar identifiers used by the system

Blend V2 mainnet core contracts, from the Blend mainnet deployments documentation:

```
Pool Factory  CDSYOAVXFY7SM5S64IZPPPYB4GVGGLMQVFREPSQQEZVIWXX5R23G4QSU
Backstop      CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7
Emitter       CCOQM6S7ICIUWA225O5PSJWUBEMXGFSSW2PQFO6FP4DQEKMS5DASRGRR
BLND (Soroban) CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY
Comet BLND:USDC CAS3FL6TLZKDGGSISDBWGGPXT3NRR4DYTZD7YOD3HMYO6LTJUVGRVEAM
```

Circle USDC on Stellar mainnet, issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.

Individual pool addresses are not published anywhere. Blend pools are deployed permissionlessly, so pool IDs come from the Blend interface or from querying the Pool Factory. The sampler enumerates through the factory.

---

## 10. Repository

`github.com/seekdaseek/sounding`, MIT.

```
src/depth.mjs          220 lines, pure math, no I/O, no clock
test/depth.test.mjs    26 tests, 0 failures, runs offline
bin/probe.mjs          live mainnet gate, three-way verdict
README.md              the mainnet measurements and the caveats
```

Run the live gate with `--denom base`. The default was wrong once and mainnet caught it; every depth figure would have been silently divided by price.
