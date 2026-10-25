# Measured results

Generated 2026-10-25T19:11:05Z from the production database by `node scripts/fill-docs.mjs <db>`
(tables by `scripts/results-md.mjs`). Every number below comes from the database; the live
equivalents are `GET /v1/stats` and `GET /v1/history.csv`.

**2,000 samples** in **10 cycles**, 10 assets (AQUA, BTC, ETH, EURC, PYUSD, SHX, USTRY, XLM, XRP, yXLM), first 2026-10-25T17:56:06.751Z, last 2026-10-25T19:10:56.365Z.

### Answers by venue

| venue | ok | no_route | failed | failure kinds |
|---|---:|---:|---:|---|
| aquarius | 400 | 0 | 0 | - |
| broker | 400 | 0 | 0 | - |
| sdex_horizon | 400 | 0 | 0 | - |
| soroswap_agg | 80 | 0 | 320 | no_key: 320 |
| soroswap_agg:aqua | 80 | 0 | 0 | - |
| soroswap_agg:comet | 0 | 80 | 0 | - |
| soroswap_agg:sdex | 80 | 0 | 0 | - |
| soroswap_agg:soroswap | 64 | 16 | 0 | - |
| soroswap_agg:sushi | 12 | 68 | 0 | - |

### Exit cost at $100,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | soroswap_agg | spread (median, bps) |
|---|---|---|---|---|---|
| AQUA | 231 [221 - 239] (n=10) | 1,526 [1,520 - 1,528] (n=10) | 190 [168 - 214] (n=10) | 1,216 [1,211 - 1,222] (n=2) | 1,334 |
| BTC | 3,589 [3,584 - 3,592] (n=10) | 6,506 [6,506 - 6,506] (n=10) | 2,872 [2,864 - 2,875] (n=10) | 6,913 [6,912 - 6,913] (n=2) | 3,639 |
| ETH | 7,368 [7,366 - 7,370] (n=10) | 5,970 [5,969 - 5,973] (n=10) | 3,843 [3,822 - 3,859] (n=10) | 4,935 [4,935 - 4,936] (n=2) | 3,524 |
| EURC | 76 [73 - 76] (n=10) | 6,107 [6,101 - 6,107] (n=10) | 49 [47 - 50] (n=10) | 82 [81 - 83] (n=2) | 6,058 |
| PYUSD | 407 [403 - 408] (n=10) | 9 [4 - 9] (n=10) | 214 [210 - 214] (n=10) | 14 [14 - 14] (n=2) | 399 |
| SHX | 2,117 [2,113 - 2,121] (n=10) | 5,542 [5,537 - 5,542] (n=10) | 1,580 [1,579 - 1,587] (n=10) | 5,689 [5,687 - 5,691] (n=2) | 3,963 |
| USTRY | 6 [1 - 6] (n=10) | 879 [874 - 879] (n=10) | 6 [1 - 6] (n=10) | 11 [11 - 11] (n=2) | 872 |
| XLM | 37 [34 - 40] (n=10) | 326 [322 - 330] (n=10) | 37 [32 - 38] (n=10) | 55 [53 - 58] (n=2) | 291 |
| XRP | 947 [943 - 951] (n=10) | 5,950 [5,948 - 5,951] (n=10) | 804 [795 - 811] (n=10) | 5,972 [5,969 - 5,975] (n=2) | 5,154 |
| yXLM | 60 [58 - 62] (n=10) | 344 [340 - 351] (n=10) | 60 [55 - 62] (n=10) | 402 [400 - 404] (n=2) | 290 |

### Exit cost at $1,000,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | soroswap_agg | spread (median, bps) |
|---|---|---|---|---|---|
| AQUA | 8,231 [8,231 - 8,232] (n=10) | 6,502 [6,499 - 6,502] (n=10) | 4,708 [4,703 - 4,719] (n=10) | 6,578 [6,575 - 6,580] (n=2) | 3,523 |
| BTC | 9,367 [9,367 - 9,367] (n=10) | 9,491 [9,491 - 9,491] (n=10) | 7,385 [7,369 - 7,395] (n=10) | 9,574 [9,574 - 9,574] (n=2) | 2,114 |
| ETH | 9,657 [9,657 - 9,657] (n=10) | 9,373 [9,373 - 9,373] (n=10) | 8,388 [8,385 - 8,392] (n=10) | 9,090 [9,090 - 9,090] (n=2) | 1,268 |
| EURC | 9,689 [9,689 - 9,697] (n=10) | 9,611 [9,610 - 9,611] (n=10) | 6,013 [6,007 - 6,072] (n=10) | 6,820 [6,819 - 6,821] (n=2) | 3,677 |
| PYUSD | 9,256 [9,256 - 9,256] (n=10) | 11 [6 - 11] (n=10) | 2,008 [2,004 - 2,008] (n=10) | 16 [16 - 16] (n=2) | 9,246 |
| SHX | 7,320 [7,317 - 7,324] (n=10) | 9,293 [9,292 - 9,293] (n=10) | 6,521 [6,519 - 6,639] (n=10) | 9,304 [9,304 - 9,305] (n=2) | 2,773 |
| USTRY | 9,999 [9,999 - 9,999] (n=10) | 4,785 [4,784 - 4,785] (n=10) | 4,256 [4,255 - 4,256] (n=10) | 4,687 [4,687 - 4,687] (n=2) | 5,743 |
| XLM | 2,994 [2,992 - 2,995] (n=10) | 3,779 [3,776 - 3,781] (n=10) | 2,203 [2,200 - 2,205] (n=10) | 2,618 [2,617 - 2,620] (n=2) | 1,577 |
| XRP | 5,266 [5,246 - 5,287] (n=10) | 9,362 [9,362 - 9,363] (n=10) | 4,866 [4,838 - 4,871] (n=10) | 9,372 [9,372 - 9,373] (n=2) | 4,497 |
| yXLM | 4,620 [4,618 - 4,620] (n=10) | 7,404 [7,402 - 7,405] (n=10) | 2,572 [2,567 - 2,582] (n=10) | 7,564 [7,562 - 7,566] (n=2) | 4,831 |

### Safe size per tolerance (USD): three methods side by side

Columns 50-500 bps: interpolated from the latest cycle's best-exit curve. `published @200`: what the API publishes (time-weighted over six cycles, capped by the latest, share-capped across independent venues). `book` = closed form on the direct SDEX order book. `bisected` = hourly bisection on live quotes (venue named).

| asset | 50 bps | 100 bps | 200 bps | 500 bps | published @200 | book @200 | bisected @200 (venue) |
|---|---:|---:|---:|---:|---:|---:|---|
| AQUA | 13,206 | 23,738 | 76,695 | 115,371 | 32,084 | 13,483 | 115,478 (broker) |
| BTC | 1,417 | 1,816 | 2,985 | 10,548 | 2,952 | 21 | 4,532 (broker) |
| ETH | 1,283 | 1,500 | 2,049 | 5,228 | 2,049 | 0 | 2,129 (broker) |
| EURC | 100,136 | 102,090 | 106,113 | 119,161 | 36,789 | 107,738 | 103,663 (broker) |
| PYUSD | 1,000,000+ | 1,000,000+ | 1,000,000+ | 1,000,000+ | 212,169 | 74,386 | 1,000,000+ (aquarius) |
| SHX | 2,494 | 4,540 | 10,568 | 17,186 | 10,473 | 4,094 | 9,647 (broker) |
| USTRY | 102,668 | 105,485 | 111,352 | 130,987 | 37,308 | 267,813 | 273,842 (broker) |
| XLM | 100,651 | 106,153 | 118,078 | 162,510 | 118,078 | 262,652 | 305,053 (broker) |
| XRP | 10,045 | 11,673 | 15,764 | 38,825 | 5,195 | 1,916 | 43,714 (broker) |
| yXLM | 54,432 | 103,189 | 113,116 | 149,005 | 84,102 | 201 | 273,842 (broker) |

`+` = lower bound: even the largest sampled size ($1M) stayed inside the tolerance. A published size of 0 means the share cap refused a single-venue depth.

### Stale bounds from measured drift (per asset)

Drift series = best-exit price at $100k per cycle (mark and depth together). bound = clamp((100 bps / sigma)^2 x cycle gap, 1200 s, 7200 s); 3,600 s until six cycles exist.

| asset | cycles in series | cycle sigma (bps) | stale bound (s) | basis |
|---|---:|---:|---:|---|
| AQUA | 10 | 26.8 | 6,628 | drift |
| BTC | 10 | 10.9 | 7,200 | drift |
| ETH | 10 | 48.5 | 2,026 | drift |
| EURC | 10 | 0.5 | 7,200 | drift |
| PYUSD | 10 | 0.0 | 7,200 | drift |
| SHX | 10 | 12.3 | 7,200 | drift |
| USTRY | 10 | 0.0 | 7,200 | drift |
| XLM | 10 | 9.1 | 7,200 | drift |
| XRP | 10 | 9.8 | 7,200 | drift |
| yXLM | 10 | 10.6 | 7,200 | drift |

