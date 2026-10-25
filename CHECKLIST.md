# SCF #46 Integration Track: pre-submission checklist

Project: **sounding**, exit liquidity for Stellar assets. Repo <https://github.com/seekdaseek/sounding> (MIT).
Live <https://sounding.ochinimus.app>. SCF form deadline: **2026-11-08**. Each line below is answered from
what exists on the date in the last row; items not done are marked **OPEN**, never glossed.

| # | line | answer |
|---|---|---|
| 1 | **Rubric** | The SCF rubric text was not supplied to me. This submission is mapped to the six items of written voter feedback from #45 instead, in [`docs/JUDGE_GUIDE.md`](docs/JUDGE_GUIDE.md): no Blend dependency (B), Integration-Track fit (E), Soroban AMM exit liquidity (E1, `docs/VENUES.md`), manipulation resistance and staleness (D), STRIDE + monitoring + runbook (F), key-person risk answered with artifacts (G). **OPEN:** re-map to the official rubric when its text is available. |
| 2 | **Sponsor primitives, by name** | Integration List blocks: **Aquarius** (`find-path` API, AMM router `CBQDHNBF...6QUK`), **Soroswap** (Aggregator API `/quote`, protocols `soroswap`/`aqua`/`sushi`/`comet`/`sdex`), **Stellar Broker** (`/quote` estimate, the call behind `@stellar-broker/client` `estimateSwap`; router audited by Runtime Verification). Stellar platform: Horizon `strict-send` paths and `order_book`, SDEX, Soroban Stellar Asset Contracts, Circle USDC, **x402** (`@x402/stellar` 2.28.0, `stellar/x402-stellar` pattern), friendbot and the testnet DEX for the payer. |
| 3 | **User action** | A lender, vault manager or agent calls `GET /v1/exit?asset=&size=` (free during the build) or `GET /paid/v1/exit` (x402, $0.01 testnet USDC today) and reads: cost per venue, best exit, largest size inside 50/100/200/500 bps, and `published.publishable` (hold the limit if false). A reader with no wallet opens the landing page. |
| 4 | **Evidence** | Live samples: `GET /v1/stats` (count, first/last time, failures by venue) and `GET /v1/history.csv`; per-claim links in `docs/JUDGE_GUIDE.md`; testnet x402 settlement `7a9c3cd9e2693cc8419459248a8fd24c96cd3a611b384f2c39409c984c2f2db4` (ledger 5385598); offline test suite (`npm test`); real API captures as test fixtures; `docs/RESULTS.md` generated from the production database. **OPEN:** a live Soroswap quote (needs a free API key). |
| 5 | **Field** (form fields) | Technical Architecture Document: link to [`ARCHITECTURE.md`](ARCHITECTURE.md) on the default branch of the public repo. Integration List blocks: Aquarius, Soroswap, Stellar Broker, with the hours in ARCHITECTURE section 2. Onchain success metric (not our own activity): ARCHITECTURE section 6. Form-field wording beyond this was not supplied. |
| 6 | **Format** | Public GitHub repo, Markdown documents, no login needed to read anything. The architecture document carries the STRIDE data-flow diagram as Mermaid (GitHub renders it). The measurement history is a plain CSV under CC BY 4.0. |
| 7 | **Liveness** | Required to **2026-12-03** (community vote window end; the Integration panel runs 2026-11-11 to 2026-11-18). Intended to **2026-12-15**: sampler, API, page, repo. One VPS, PM2 (`sounding-sampler`, `sounding-api`, `sounding-paid`, `sounding-tunnel`) saved in the PM2 dump; nightly database backup; no uptime guarantee. Check with `curl https://sounding.ochinimus.app/healthz`. |
| 8 | **Social** | Nothing posted. Posting is the owner's call. |
| 9 | **Fit** | Integration Track (panel-reviewed, no community vote): uses three Integration List blocks, has an onchain metric that is not the team's own activity, and removes the Blend dependency that cost #45 the vote. Open honesty items stated in the README: Soroswap not yet live-quoting, mainnet x402 not configured, publisher contract is a design. |
| 10 | **Control** | One maintainer, no co-maintainer named. GitHub account `seekdaseek`; VPS and Cloudflare account are the owner's. Secrets exist only on the box (`/opt/sounding/.env`, mode 600) and the owner's Mac (`.env`, gitignored): the Soroswap key (owner-registered), the testnet payer and payTo secrets (generated, testnet only, never printed). The mainnet receiving account and the OpenZeppelin mainnet key are the owner's and are **OPEN** (tranche 1). |
| 11 | **Gates** | Go/no-go before pressing submit. [x] `npm test` passes offline. [x] sampler, API, paid endpoint and tunnel online. [ ] repo public after a full-history secret scan. [ ] every URL in the form returns 200. [x] testnet x402 settlement verified on Horizon. [ ] Soroswap key installed and one live quote captured. [ ] `docs/RESULTS.md`, README headline and ARCHITECTURE section 12 regenerated from the database on the day. [ ] 14 days of continuous samples, so the stale bounds are measured and not defaulted. |
| 12 | **Artifacts** | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`README.md`](README.md), [`docs/JUDGE_GUIDE.md`](docs/JUDGE_GUIDE.md), [`docs/VENUES.md`](docs/VENUES.md), [`docs/DEPLOY.md`](docs/DEPLOY.md), [`docs/RESULTS.md`](docs/RESULTS.md), this file; `/v1/history.csv`; `scripts/x402-testnet-*.mjs`; `ops/`. |

## Rules 36-39

The text of rules 36-39 was not supplied to me and I have not invented it. Paste it here and answer
each against the table above:

- Rule 36: **OPEN, text not supplied**
- Rule 37: **OPEN, text not supplied**
- Rule 38: **OPEN, text not supplied**
- Rule 39: **OPEN, text not supplied**

Last updated: 2026-10-25.
