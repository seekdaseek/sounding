# sounding

A sounding is the depth measurement taken before committing the ship.

**sounding answers one question for Stellar assets: how much of asset X can I sell right now, and
what does it cost, at size S?** It asks four exit venues (SDEX through Horizon paths, the Soroswap
aggregator, Aquarius, Stellar Broker), measures every ten minutes, and reports the largest size that
stays inside 50, 100, 200 and 500 bps, or says plainly that it cannot be trusted right now.

- Live: <https://sounding.ochinimus.app> (the page opens with a live number: XLM at $100k, cost per venue)
- API: `GET /v1/exit?asset=ETH&size=100000`, `/v1/stats`, `/v1/history.csv` (CC BY 4.0)
- Paid: `GET /paid/v1/exit` over x402, USDC on Stellar. **Testnet only today**; one real settlement
  is [`7a9c3cd9…2db4`](https://stellar.expert/explorer/testnet/tx/7a9c3cd9e2693cc8419459248a8fd24c96cd3a611b384f2c39409c984c2f2db4)
- Design, threat model, runbook: [`ARCHITECTURE.md`](ARCHITECTURE.md). Every claim mapped to a link or tx:
  [`docs/JUDGE_GUIDE.md`](docs/JUDGE_GUIDE.md)

**Headline count:** <!-- HEADLINE:BEGIN --> **1,120 samples** in **7 cycles** (one per 10 minutes) over 0.0 days, 10 assets x 4 sizes x 4 venues, first sample 2026-10-25T17:56:06Z, latest 2026-10-25T18:43:04Z. 0 venue answers failed for a reason other than a missing Soroswap key, each stored as a typed row and none read as zero liquidity; 280 rows are the Soroswap venue recording `no_key`. <!-- HEADLINE:END -->
The live count is always `curl -s https://sounding.ochinimus.app/v1/stats`.

## What it found

Same asset, same cycle, very different exits (cost in bps against the cycle's mark; 100 bps = 1%):

<!-- FINDINGS:BEGIN -->
Selling **$100,000** of the asset into USDC, median cost in bps over 7 cycles:

| asset | SDEX (Horizon paths) | Aquarius | Stellar Broker | spread between venues |
|---|---:|---:|---:|---:|
| XLM | 38 | 323 | 36 | 287 |
| EURC | 76 | 6,106 | 49 | 6,057 |
| USTRY | 6 | 879 | 6 | 872 |
| PYUSD | 408 | 9 | 214 | 400 |
| ETH | 7,367 | 5,970 | 3,840 | 3,527 |
| BTC | 3,588 | 6,506 | 2,871 | 3,635 |

(Soroswap is wired but has not yet returned a live quote; see "What is honest".)
<!-- FINDINGS:END -->

Nobody should size a limit off one venue, and nobody should treat a venue that is not answering as
if it said zero. Both rules are enforced in code (below).

## Five-minute verify path

1. **Open the page.** <https://sounding.ochinimus.app> shows the XLM $100k cost per venue, measured
   `age` seconds ago. Nothing typed.
2. **Ask for a harder case.** `curl 'https://sounding.ochinimus.app/v1/exit?asset=EURC&size=100000'`:
   `venues[]` carries each venue's proceeds and cost; `best`, `disagreement`, `safe_size`, `stale`,
   `age_s`, `published.publishable` and `published.reasons` say what to do with it.
3. **Check a venue yourself.** Run the real request for one venue from [`docs/VENUES.md`](docs/VENUES.md)
   (plain `curl` lines for Horizon, Aquarius and Stellar Broker) and compare to the `venues[]`
   row for the same asset and size, minutes apart.
4. **Check the history.** `curl -O https://sounding.ochinimus.app/v1/history.csv`; every row is one
   venue answer: `ok`, `no_route` or `failed` with a typed `fail_kind`. Recompute any number on the page from it.
5. **Run the tests.** `git clone https://github.com/seekdaseek/sounding && cd sounding && npm ci && npm test`:
   offline, no network.
6. **See the payment.** Open the testnet transaction linked above on stellar.expert.

## Rules enforced in code, not prose

- **A failed read is never a finding.** Each venue answer is `ok`, `no_route` (the venue said it
  cannot fill) or `failed(kind)`. Failures are stored as typed rows and never enter the mark, the best
  exit or a safe size as zero.
- **A refusal is a first-class answer.** Stale readings, a venue paying far more than the rest at $1k,
  and depth carried by a single venue make `published.publishable` false with the reasons listed. The
  consumer rule is hold the current limit, never raise it.
- **Depth is averaged, not snapshotted.** The published size is the time-weighted mean over the last
  hour, capped by the latest cycle, so a level that just appeared cannot raise it and one that just
  vanished lowers it at once.
- **No venue carries more than 60% of the published depth**, and only independent pools are counted.
- **Partial fills are reported as partial**, never as "cannot exit" and never as zero.
- **Missing values throw.** `Number(null)` is 0 and `isFinite(null)` is true; there is a test for every
  value JavaScript silently turns into zero.

## Layout

```
src/engine.mjs      pure: mark, cost, best exit, disagreement, safe size (interpolation, bisection),
                    time-weighted depth, venue share cap, staleness
src/depth.mjs       pure: closed-form safe size on a Horizon order book
src/venues/*.mjs    the four adapters; ok | no_route | failed(kind)
src/sampler.mjs     one cycle: every asset x size x venue -> sqlite; hourly bisection
src/read.mjs        stored samples -> the answer to "how much can I sell"
src/api.mjs         read API and the one-page explainer (node:http, zero dependencies)
src/paid.mjs        x402 paywall on Stellar (testnet)
bin/                sampler, api, paid, discover (asset universe), probe (the original Blend gate)
ops/                deploy.sh, pm2-start.sh, backup.sh
docs/               VENUES.md, DEPLOY.md, JUDGE_GUIDE.md, RESULTS.md
test/               offline tests; fixtures are real API captures
```

## Run it

```bash
npm ci
npm test
node --no-warnings bin/sampler.mjs --once      # one cycle into ./sounding.db (needs network)
PORT=3035 node --no-warnings bin/api.mjs       # then open http://127.0.0.1:3035
```

A full deployment from an empty box is in [`docs/DEPLOY.md`](docs/DEPLOY.md). The Soroswap venue needs
a free key from <https://api.soroswap.finance/register> in `SOROSWAP_API_KEY`; without it that venue
records typed `no_key` rows and everything else runs.

## What is honest and what is not

- Soroswap is wired and unit-tested against its documented API, but **has not yet returned a live
  quote** (no key was available when this was written). Until it does, three of four venues are live.
- The mark is the median of the $1k quotes across venues. If every venue is wrong together at $1k, so
  is the mark. An independent oracle cross-check is planned, not built.
- Safe sizes between the four sampled sizes are interpolated, which is conservative (XLM at 200 bps:
  $119k interpolated against $305k bisected). The hourly bisection and the closed-form order-book
  figure are reported beside it, labelled by method.
- The x402 payment path is proven on **testnet**. Mainnet is not configured.
- The Soroban publisher contract is a design, not code.
- Liquidations are not confined to onchain venues; this measures what is sellable onchain, which is
  what binds in a fast cascade.

## History

v1 sized Blend collateral and measured the largest Blend pool in August 2026 (XLM $1M exit: 32%
cost). That work is kept as one short section of [`ARCHITECTURE.md`](ARCHITECTURE.md) and as
`bin/probe.mjs`. Nothing in v2 depends on Blend. v1's direct-order-book depth figures were computed
under a wrong assumption about Horizon bid amounts (they are USDC, not base) and are withdrawn; the
routed exit costs are unaffected. The correction is recorded in ARCHITECTURE section 13.

## License

Code: MIT. Data (`/v1/*`, `history.csv`): CC BY 4.0, attribute "sounding
(github.com/seekdaseek/sounding)".
