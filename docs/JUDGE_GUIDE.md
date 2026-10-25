# Judge guide

Every claim sounding makes, with the link or command that checks it. Nothing needs an account.
Where a claim is *not* fully met, the row says so. `H` = a check you can run in under a minute.

Base URL: <https://sounding.ochinimus.app> (called `$B` below).
Repo: <https://github.com/seekdaseek/sounding> (MIT).

## A. The product works and is measured, not projected

| # | claim | how to check | result to expect |
|---|---|---|---|
| A1 | The service is live and fresh | `curl -s $B/healthz` (H) | `"ok": true`, `last_cycle_age_s` under 1500 |
| A2 | The landing page opens with a live number, nothing typed | open `$B/` (H) | "Selling $100,000 of XLM ... costs:" with a cost per venue and an age in seconds |
| A3 | It answers the one question | `curl -s "$B/v1/exit?asset=EURC&size=100000"` (H) | JSON with `ts`, `age_s`, `stale`, per-venue rows, `best`, `safe_size`, `disagreement`, `published` |
| A4 | The measurement count is real | `curl -s $B/v1/stats`; the same rows are in `$B/v1/history.csv` (CC BY 4.0) (H) | `samples`, `cycles`, `first_ts`, `last_ts`, failure counts per venue |
| A5 | Numbers can be recomputed from the public history | download the CSV, filter `asset=XLM,size_usd=100000,venue=broker,status=ok`, take `cost_bps` | matches the page within one cycle |
| A6 | Three venues return live quotes | run the `curl` lines in [`VENUES.md`](VENUES.md) for Horizon, Aquarius, Stellar Broker and compare to `venues[]` (H) | within the usual few-minute drift |
| A7 | **Soroswap is not yet live-quoting (disclosed)** | `curl -s "$B/v1/exit?asset=XLM&size=100000"` -> the `soroswap_agg` row | `status: failed`, `failure_kind: no_key`. It is wired and unit-tested; it needs a free key (`VENUES.md` section 4) |

## B. Nothing requires Blend

| # | claim | how to check | result |
|---|---|---|---|
| B1 | v2 has no Blend dependency in the runtime path | `grep -ril blend src bin ops scripts` | only `bin/probe.mjs` (the original, kept as history) and a *comment* in `bin/discover.mjs`; `package.json` lists the Blend SDK under `optionalDependencies` only |
| B2 | The asset universe is not taken from Blend | `data/universe.json` `source` field; `bin/discover.mjs` | read from the live Aquarius pool list and measured |
| B3 | The Blend measurement is history, one short section | `ARCHITECTURE.md` section 13 | August 2026 numbers, labelled as such |

## C. Honesty rules enforced in code

| # | claim | how to check |
|---|---|---|
| C1 | A failed venue is never zero liquidity | `npm test`; tests `a failed venue must not drag the mark down`, `a failing venue is recorded as a typed failure with NULL proceeds`, `refine: a failing venue aborts ... never as a zero size`. In the CSV, `status=failed` rows have empty `proceeds_usdc` and a `fail_kind` |
| C2 | The three-way verdict exists in the data | `awk -F, 'NR>1{c[$7]++}END{for(k in c)print k,c[k]}' history.csv` -> `ok`, `no_route`, `failed` counts |
| C3 | Stale means stale | `curl -s "$B/v1/exit?asset=XLM"` -> `age_s`, `stale`, `stale_bound_s`; test `stale reading: stale true, not publishable` |
| C4 | The consumer rule is hold, never raise | `published.consumer_rule` in every response; `nextLimit` test in `test/engine.test.mjs` |
| C5 | The tests are not vacuous | Mutation check run on 2026-10-25: five core comparisons were mutated (disagreement flag, appearing-level discount, share-cap loop, below-minimum guard, bisection failure handling) and each mutation broke at least one test |

## D. Manipulation resistance (voter feedback item 4)

| # | mechanism | where | test |
|---|---|---|---|
| D1 | time-weighted depth across the window | `effectiveDepth`, `read.mjs` (6 cycles) | `time-weighted publish: a depth spike in the last cycle does not raise the published size` |
| D2 | appearing-level discount, drop applies at once | `min(mean, latest)` | `a drop in depth applies at once` |
| D3 | per-asset stale bounds from measured drift, explicit stale state | `staleBoundFromDrift`; fields `stale_bound_s`, `stale_bound_basis` | `staleBoundFromDrift: calm asset gets a longer bound ...` |
| D4 | venue share cap, single venue never trusted | `cappedDepth` (cap 0.6) | `cappedDepth: single venue is refused; cap binds a dominant venue` |
| D5 | refusal when venues disagree | `disagreement` at $1k | `a venue paying far MORE than the next best at $1k is refused` |

## E. Integration Track fit

| # | claim | evidence |
|---|---|---|
| E1 | Uses three Integration List blocks | Aquarius, Soroswap, Stellar Broker: `ARCHITECTURE.md` section 2 (what is done, what is estimated, hours) and `docs/VENUES.md` |
| E2 | An onchain success metric that is not our own activity | `ARCHITECTURE.md` section 6: distinct non-sounding accounts settling USDC to the receiving address, read from the public ledger. **Zero on mainnet today by construction** (mainnet is not live) |
| E3 | x402 on Stellar works end to end | testnet settlement [`7a9c3cd9...2db4`](https://stellar.expert/explorer/testnet/tx/7a9c3cd9e2693cc8419459248a8fd24c96cd3a611b384f2c39409c984c2f2db4), ledger 5385598; reproduce with `scripts/x402-testnet-pay.mjs` (needs your own funded testnet payer: `scripts/x402-testnet-setup.mjs`) |
| E4 | `$B/paid/v1/exit` demands payment | `curl -i "$B/paid/v1/exit?asset=XLM&size=100000"` (H) -> `402` with a `PAYMENT-REQUIRED` header: scheme `exact`, network `stellar:testnet`, amount `100000` (= $0.01), asset the testnet USDC SAC `CBIELTK6...` |
| E5 | **Mainnet x402 is not done (disclosed)** | needs the owner's receiving account and an OpenZeppelin mainnet key; tranche 1 |
| E6 | **The Soroban publisher contract is not built (disclosed)** | design only, `ARCHITECTURE.md` section 7 |

## F. Threats, monitoring, recovery (voter feedback item 5)

| # | artifact | where |
|---|---|---|
| F1 | STRIDE threat model with a data flow diagram | `ARCHITECTURE.md` section 8 |
| F2 | monitoring plan: threat -> signal -> severity -> response | section 9 |
| F3 | failure and recovery runbook: outage, key compromise, bad data, who pauses, rotation | section 10 |

## G. Key-person risk (voter feedback item 6)

There is one maintainer and no co-maintainer is claimed. The answer is artifacts, each checkable:

| # | artifact | check |
|---|---|---|
| G1 | MIT source | `LICENSE`; the repo is public |
| G2 | architecture and deploy docs | `ARCHITECTURE.md`, `docs/DEPLOY.md` (empty box to running service) |
| G3 | CC BY 4.0 measurement history | `curl -I $B/v1/history.csv` -> `link: <https://creativecommons.org/licenses/by/4.0/>; rel="license"` (H) |
| G4 | zero-dependency sampler and API | `package.json`: runtime code uses Node built-ins; only the paid server needs `npm ci` |
| G5 | admin pause and key rotation | designed in section 7, **not yet code** |
| G6 | nightly database backup | `ops/backup.sh`, cron `25 3 * * *` |

## H. Liveness

Everything is intended to stay up until at least 2026-12-15: sampler, API, page and repo. They run as
PM2 processes on one VPS behind a dedicated Cloudflare tunnel (`sounding-sampler`, `sounding-api`,
`sounding-paid`, `sounding-tunnel`), saved in the PM2 dump so a reboot restores them. A single box is
a single point of failure; the mitigation is the public history, the backup, and a deploy document
that rebuilds it. There is no uptime guarantee and none is claimed.
