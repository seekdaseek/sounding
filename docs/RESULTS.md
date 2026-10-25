# Measured results

Generated 2026-10-25T18:39:11Z from the production database by `node scripts/fill-docs.mjs <db>`
(tables by `scripts/results-md.mjs`). Every number below comes from the database; the live
equivalents are `GET /v1/stats` and `GET /v1/history.csv`.

**960 samples** in **6 cycles**, 10 assets (AQUA, BTC, ETH, EURC, PYUSD, SHX, USTRY, XLM, XRP, yXLM), first 2026-10-25T17:56:06.751Z, last 2026-10-25T18:38:20.670Z.

### Answers by venue

| venue | ok | no_route | failed | failure kinds |
|---|---:|---:|---:|---|
| aquarius | 240 | 0 | 0 | - |
| broker | 240 | 0 | 0 | - |
| sdex_horizon | 240 | 0 | 0 | - |
| soroswap_agg | 0 | 0 | 240 | no_key: 240 |

### Exit cost at $100,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |
|---|---|---|---|---|
| AQUA | 229 [221 - 239] (n=6) | 1,523 [1,520 - 1,528] (n=6) | 190 [173 - 214] (n=6) | 1,333 |
| BTC | 3,586 [3,584 - 3,592] (n=6) | 6,506 [6,506 - 6,506] (n=6) | 2,868 [2,864 - 2,875] (n=6) | 3,638 |
| ETH | 7,367 [7,366 - 7,368] (n=6) | 5,970 [5,969 - 5,970] (n=6) | 3,847 [3,837 - 3,863] (n=6) | 3,519 |
| EURC | 76 [75 - 76] (n=6) | 6,105 [6,101 - 6,107] (n=6) | 49 [49 - 50] (n=6) | 6,055 |
| PYUSD | 408 [407 - 408] (n=6) | 9 [9 - 9] (n=6) | 214 [214 - 214] (n=6) | 400 |
| SHX | 2,117 [2,113 - 2,121] (n=6) | 5,540 [5,537 - 5,542] (n=6) | 1,580 [1,579 - 1,583] (n=6) | 3,959 |
| USTRY | 6 [6 - 6] (n=6) | 879 [879 - 879] (n=6) | 6 [6 - 6] (n=6) | 872 |
| XLM | 38 [35 - 40] (n=6) | 323 [322 - 330] (n=6) | 36 [33 - 37] (n=6) | 289 |
| XRP | 947 [944 - 951] (n=6) | 5,950 [5,948 - 5,951] (n=6) | 804 [796 - 811] (n=6) | 5,145 |
| yXLM | 61 [59 - 62] (n=6) | 343 [343 - 351] (n=6) | 59 [57 - 61] (n=6) | 286 |

### Exit cost at $1,000,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |
|---|---|---|---|---|
| AQUA | 8,231 [8,231 - 8,232] (n=6) | 6,500 [6,499 - 6,502] (n=6) | 4,712 [4,704 - 4,719] (n=6) | 3,519 |
| BTC | 9,367 [9,367 - 9,367] (n=6) | 9,491 [9,491 - 9,491] (n=6) | 7,377 [7,371 - 7,394] (n=6) | 2,114 |
| ETH | 9,657 [9,657 - 9,657] (n=6) | 9,373 [9,373 - 9,373] (n=6) | 8,389 [8,385 - 8,392] (n=6) | 1,268 |
| EURC | 9,689 [9,689 - 9,696] (n=6) | 9,610 [9,610 - 9,611] (n=6) | 6,012 [6,011 - 6,068] (n=6) | 3,677 |
| PYUSD | 9,256 [9,256 - 9,256] (n=6) | 11 [11 - 11] (n=6) | 2,008 [2,008 - 2,008] (n=6) | 9,246 |
| SHX | 7,321 [7,317 - 7,324] (n=6) | 9,293 [9,292 - 9,293] (n=6) | 6,521 [6,519 - 6,640] (n=6) | 2,772 |
| USTRY | 9,999 [9,999 - 9,999] (n=6) | 4,785 [4,785 - 4,785] (n=6) | 4,256 [4,256 - 4,256] (n=6) | 5,743 |
| XLM | 2,994 [2,992 - 2,995] (n=6) | 3,777 [3,776 - 3,781] (n=6) | 2,203 [2,200 - 2,204] (n=6) | 1,576 |
| XRP | 5,268 [5,263 - 5,287] (n=6) | 9,362 [9,362 - 9,363] (n=6) | 4,868 [4,864 - 4,871] (n=6) | 4,494 |
| yXLM | 4,619 [4,618 - 4,620] (n=6) | 7,404 [7,402 - 7,405] (n=6) | 2,575 [2,571 - 2,582] (n=6) | 4,829 |

### Published safe size per tolerance (latest cycle, best-exit curve, USD)

| asset | 50 bps | 100 bps | 200 bps | 500 bps | closed-form SDEX book @200 | bisected @200 (venue) |
|---|---:|---:|---:|---:|---:|---|
| AQUA | 14,568 | 31,786 | 101,358 | 118,051 | 4 | 115,478 (broker) |
| BTC | 1,390 | 1,781 | 2,925 | 10,508 | 1,693,184 | 4,532 (broker) |
| ETH | 1,373 | 1,604 | 2,189 | 5,564 | 0 | 2,129 (broker) |
| EURC | 100,030 | 101,980 | 105,995 | 119,013 | 117,200 | 103,663 (broker) |
| PYUSD | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 | 74,313 | 1,000,000 (aquarius) |
| SHX | 2,255 | 4,114 | 10,438 | 17,063 | 20 | 9,647 (broker) |
| USTRY | 102,393 | 105,205 | 111,062 | 130,665 | 288,355 | 273,842 (broker) |
| XLM | 101,414 | 106,950 | 118,945 | 163,622 | 42,487 | 305,053 (broker) |
| XRP | 10,061 | 11,734 | 15,961 | 40,170 | 2,376 | 43,714 (broker) |
| yXLM | 61,220 | 103,691 | 113,604 | 149,402 | 42 | 273,842 (broker) |

`+` = lower bound: even the largest sampled size ($1M) stayed inside the tolerance.

### Stale bounds from measured drift (per asset)

Drift series = best-exit price at $100k per cycle (mark and depth together). bound = clamp((100 bps / sigma)^2 x cycle gap, 1200 s, 7200 s); 3,600 s until six cycles exist.

| asset | cycles in series | cycle sigma (bps) | stale bound (s) | basis |
|---|---:|---:|---:|---|
| AQUA | 6 | 35.0 | 3,886 | drift |
| BTC | 6 | 12.0 | 7,200 | drift |
| ETH | 6 | 62.9 | 1,205 | drift |
| EURC | 6 | 0.5 | 7,200 | drift |
| PYUSD | 6 | 0.0 | 7,200 | drift |
| SHX | 6 | 7.8 | 7,200 | drift |
| USTRY | 6 | 0.0 | 7,200 | drift |
| XLM | 6 | 6.9 | 7,200 | drift |
| XRP | 6 | 11.2 | 7,200 | drift |
| yXLM | 6 | 8.4 | 7,200 | drift |

