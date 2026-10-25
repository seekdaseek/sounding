# Venues

The four exit venues sounding quotes, as read off their real APIs on 2026-10-25. Every request
below was run; every response is trimmed from a real capture unless marked otherwise. The
adapters are `src/venues/*.mjs`; the fixtures their tests use are `test/fixtures/*.json`.

All four are asked the same question: *sell N units of asset X for USDC (issuer
`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, SAC
`CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`), exact input.* Each adapter answers
with one of three verdicts and never collapses them:

| verdict | meaning | stored as |
|---|---|---|
| `ok` | the venue quoted proceeds | `status=ok`, `proceeds`, `bps` |
| `no_route` | the venue answered, definitively, that it cannot fill | `status=no_route` |
| `failed` | no usable answer: `timeout`, `network`, `rate_limited`, `auth`, `no_key`, `http_error`, `parse_error`, `bad_request`, `unsupported` | `status=failed`, `fail_kind` |

A `failed` row is never zero liquidity. The mark, the best exit, and every safe size ignore it.

| venue id | what it is | package / URL | auth | state on 2026-10-25 |
|---|---|---|---|---|
| `sdex_horizon` | classic order books + classic pools, multi-hop | Horizon `GET /paths/strict-send` | none | live, sampled every 10 min |
| `aquarius` | Aquarius AMM path finder (Soroban pools) | `POST amm-api.aqua.network/api/external/v2/find-path/` | none | live, sampled every 10 min |
| `broker` | Stellar Broker router estimate | `GET api.stellar.broker/quote` | none for estimates | live, sampled every 10 min |
| `soroswap_agg` (+ `:soroswap` `:aqua` `:sushi` `:comet` `:sdex`) | Soroswap aggregator, whole and per protocol | `POST api.soroswap.finance/quote?network=mainnet` | `Authorization: Bearer sk_...` | **live since 2026-10-25** (first keyed cycle returned 360 rows, 40 aggregate quotes `ok`); tests use live captures |

---

## 1. SDEX through Horizon paths: `sdex_horizon`

- **URL:** `https://horizon.stellar.org/paths/strict-send` (public Horizon; the app does not use `@stellar/stellar-sdk` for this, only `fetch`).
- **Auth:** none.
- **Amounts:** 7 decimal places as a string (`source_amount=5000.0000000`). `destination_assets` is `USDC:<issuer>`.
- **Request (real):**

```
GET /paths/strict-send?source_asset_type=native&source_amount=5000.0000000&destination_assets=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

- **Response (real, trimmed):**

```json
{ "_embedded": { "records": [ {
  "source_asset_type": "native", "source_amount": "5000.0000000",
  "destination_asset_code": "USDC", "destination_amount": "848.0680445", "path": []
} ] } }
```

The adapter takes the record with the largest `destination_amount`.

- **No route (real):** HTTP 200 with `"records": []`, which the adapter stores as `no_route`.
- **Rate limits:** Horizon sent no `X-RateLimit-*` or `Retry-After` header on the responses I inspected. The sampler paces this venue at one call per 350 ms and honours `Retry-After` if a 429 ever arrives (unit test: `horizon: 429 is a typed rate_limited failure`). The observed `rate_limited` count is in `/v1/stats` (`venues.sdex_horizon.failures_by_kind`).
- **Failure modes:** see the section at the end for what the sampler has recorded. A 400 on a malformed asset is mapped to `bad_request`.
- **Order book denomination (corrected 2026-10-25).** In `GET /order_book`, a bid's `amount` is in the **counter** asset (USDC), not the base. Evidence: the raw offer behind the top BTC bid is `amount 8.4780112` of USDC at `price 0.0000125` BTC per USDC, and a sell of 0.001 BTC does not fill at that bid's price as it would if the bid were for 8.48 BTC; walking the book under each reading against a real `strict-send` quote for XLM and EURC gives 0.000% error for counter and 0.28% / 0.05% for base (`bin/probe.mjs --verify-denomination`, `test/depth.test.mjs`). v1 of this project had it the other way round.
- **Also used:** `GET /order_book?...&limit=200` for the closed-form safe size on the direct book (`src/depth.mjs`). 200 is Horizon's maximum; the default of 20 silently truncates.

## 2. Aquarius: `aquarius`

- **URL:** `https://amm-api.aqua.network/api/external/v2/find-path/` (POST). The docs name this API, and name `v2` as the one to use. Source: `docs.aqua.network/developers/reference/backend-api.md`. Router contract `CBQDHNBFBZYE4MKPWBSJOPIYLW4SFSXAXUTSXJN76GNKYVYPCKWC6QUK`.
- **Auth:** none ("no API key or authentication is currently required", per their docs).
- **Amounts:** integer **stroops** as a string, both ways.
- **Request (real):**

```bash
curl -X POST https://amm-api.aqua.network/api/external/v2/find-path/ -H 'content-type: application/json' \
  -d '{"token_in_address":"CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
       "token_out_address":"CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
       "amount":"50000000000"}'
```

- **Response (real, XDR trimmed):**

```json
{ "success": true, "swap_chain_xdr": "<omitted>",
  "pools": ["CBBMQBNHB2FYVZYV7VNHOJHUMTFJLR4PUMRVQYNW6RHIKZO2NQMIBUCV"],
  "tokens": ["native", "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"],
  "amount": 8475153804, "amount_with_fee": 8475153804 }
```

`amount` is the expected output in stroops (here 847.5153804 USDC for 5,000 XLM).

- **No route:** the docs say HTTP 200 with `success:false` and zeroed fields. **I did not trigger this live** (every token pair I tried either routed or was rejected earlier); the adapter handles it and the unit test uses the documented shape. Label: documented, UNTESTED live.
- **Invalid input (real):** an address that is not an Aquarius-known contract returns HTTP 400 `{"token_in_address":["Object with address=C... does not exist."]}` -> `bad_request`.
- **Rate limits:** none published, no rate-limit headers (Cloudflare in front). Paced at 300 ms per call.
- **Pool list:** `GET /pools/` is public and paginated at 10 per page (368 pools on 2026-10-25). `?page_size=` and `?ordering=` are ignored. It carries no reserves or TVL, only `total_volume`; sounding therefore ranks assets by *measured* exit cost, not by the list order (`bin/discover.mjs`).

## 3. Stellar Broker: `broker`

- **Where the API comes from:** `github.com/stellar-broker/client`, `@stellar-broker/client` 0.7.0 (MIT, peer dependency `@stellar/stellar-sdk >= 16`). Its `src/estimate.js` (`estimateSwap`) issues the call below; sounding makes the same call with `fetch` instead of importing the package, to stay dependency-free.
- **URL:** `GET https://api.stellar.broker/quote`
- **Auth:** none for estimates. (The interactive WebSocket session takes a `partnerKey`; sounding does not trade and does not use it.)
- **Amounts:** decimal strings in whole units. Asset format `XLM` or `CODE-ISSUER`.
- **Request (real):**

```
GET /quote?sellingAsset=XLM&buyingAsset=USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&sellingAmount=5000&slippageTolerance=0.02
```

- **Response (real):**

```json
{ "status": "success", "sellingAsset": "XLM", "buyingAsset": "USDC-GA5Z...4KZVN", "slippageTolerance": 0.02,
  "direction": "strict_send",
  "directTrade": { "path": [], "selling": "5000", "buying": "848.0680445" },
  "sellingAmount": "5000", "estimatedBuyingAmount": "848.0680445" }
```

`estimatedBuyingAmount` is the routed result; `directTrade.buying` is the plain single-path baseline, kept in the stored row as `direct_proceeds`.

- **No route (real):** HTTP 200 `{"status":"unfeasible", ..., "error":"Not enough liquidity on the DEX."}` -> `no_route`. Statuses per the client's typings: `success | unfeasible | rejected`; `rejected` is treated as `failed`, not as `no_route`.
- **Rate limits:** none published, no rate-limit headers. Paced at 400 ms per call.
- **Audit:** the router contract was audited by Runtime Verification as part of the SDF Audit Bank (report dated 2025-04-18, listing: 0 critical/high, 1 medium, 3 low/informative): <https://runtimeverification.com/public-report/stellar-broker> (HTTP 200 on 2026-10-25; I read the listing, not the findings in the PDF).

## 4. Soroswap aggregator: `soroswap_agg`

All of this section was observed live on 2026-10-25 with a free-plan key (the key is never printed
or committed; it lives only in `/opt/sounding/.env`, mode 600).

- **URL:** `POST https://api.soroswap.finance/quote?network=mainnet` (docs: `docs.soroswap.finance/api/quickstart.md`, `/api-reference/quote/quote.md`).
- **Auth:** `Authorization: Bearer sk_...`. A missing, malformed or revoked key returns **403, not 401** (their quickstart; I saw 403 on `/quote` and `/protocols` without a key). Registration is at `api.soroswap.finance/register`; the free plan needs no approval.
- **Rate limit:** free plan 1 request/s sustained, burst 5 (`GET /rate-limits/tiers`, no key needed). Live responses carry `x-ratelimit-limit: 5`, `x-ratelimit-remaining: 4`, `x-ratelimit-reset: 1`. The sampler paces this venue at 1,150 ms; across the first keyed cycle (240 calls to this venue) there was **no 429**. Cost of that pacing: a keyed cycle takes **354 s** against 45 s without the key.
- **Request (real):**

```json
{ "assetIn": "CAS3J7GY...", "assetOut": "CCW67TSZ...", "amount": "5900000000000",
  "tradeType": "EXACT_IN", "protocols": ["soroswap","aqua","sushi","comet","sdex"] }
```

- **Success is HTTP 201, not 200.** Response (real, 590,000 XLM, trimmed from `test/fixtures/soroswap-live-sdex-xlm-590k.json`):

```json
{ "amountIn": "5900000000000", "amountOut": "993447495968", "priceImpactPct": "4.27", "platform": "sdex",
  "rawTrade": { "source_amount": "589410.0000000", "destination_amount": "99344.7495968", "path": [] },
  "routePlan": [ { "swapInfo": { "protocol": "sdex", "path": ["CAS3...", "CCW6..."] }, "percent": "100" } ] }
```

- **10 bps are deducted from the input before routing** on every route: `source_amount` 589,410 of 590,000 above; on the aggregator platform `rawTrade.amountIn` 999,309,690,000 of 1,000,310,000,000 (PYUSD). That is a real cost to a seller who executes through Soroswap, so it stays inside our cost figure, and the adapter stores it as `input_fee_bps` (observed 10.0). It is why Soroswap is about 10 bps dearer than the same pool reached directly.
- **`platform`** is `sdex` when the best leg is the classic book (XLM in the 590,000 capture) and `aggregator` for Soroban routes (PYUSD via Aquarius; AQUA split across three routes). `routePlan[].swapInfo.protocol` names **only the first hop**; the real venues are in `rawTrade.distribution[].hops[].protocol`, exactly as their docs warn (the AQUA capture is `aqua` in the plan and `aqua` + `sushi` in the hops; the adapter unions both).
- **The aggregate is not best-of, and its `sdex` leg is the direct order book only.** Cycle 10, $100k, cost in bps: AQUA aggregate 1,211 vs Horizon multi-hop 228 (Soroswap `sdex` sub-quote 7,902); yXLM 400 vs 51; XRP 5,969 vs 949; BTC 6,912 vs 3,590; XLM 53 vs 32 (roughly the 10 bps fee plus roughly 10 bps from the direct-book-only path). Do not read `soroswap_agg` as "the best of everything"; read it as "what Soroswap's API would give you".
- **No route is HTTP 400** with `{"title":"No path found","detail":"No path found","extra":{},"error":"Quote Failed"}` (real). Stored as `no_route`. Cycle 10 saw it for `comet` on all 40 (asset, size) pairs, `sushi` on 34 of 40 and `soroswap` on 8 of 40. A 400 with any other message (e.g. a bad asset) is `bad_request`; 403/429/5xx are never read as no-route.
- **Per-protocol depth:** the sampler also calls the endpoint once per protocol (`protocols:["aqua"]`, `["sdex"]`, ...), stored as `soroswap_agg:aqua` etc. These overlap with `aquarius` and `sdex_horizon`; the share cap (ARCHITECTURE section 4) counts only independent pools (`soroswap`, `sushi`, `comet` sub-venues, `sdex_horizon`, `aquarius`).
- **Latency note:** the stored `ms` of samples written before commit "Measure latency around the request" included lane queue wait (a median of 81 s for this venue). New rows measure the request only. `ms` is not exported in `history.csv`.

---

## What the sampler has seen go wrong

Live counts are in `GET /v1/stats` (`venues.<id>.failures_by_kind`) and in `GET /v1/history.csv`
(`fail_kind`). The per-venue table of `ok` / `no_route` / `failed` answers, with failures by kind,
is the first table in [`RESULTS.md`](RESULTS.md) ("Answers by venue"), regenerated from the
production database. `no_key` on `soroswap_agg` (rows before the key was installed at 18:54Z on 2026-10-25) is a configuration state, not an outage.
