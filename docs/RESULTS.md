# Measured results

Generated 2026-10-25T18:21:56Z from the production database by `node scripts/fill-docs.mjs <db>`
(tables by `scripts/results-md.mjs`). Every number below comes from the database; the live
equivalents are `GET /v1/stats` and `GET /v1/history.csv`.

**640 samples** in **4 cycles**, 10 assets (AQUA, BTC, ETH, EURC, PYUSD, SHX, USTRY, XLM, XRP, yXLM), first 2026-10-25T17:56:06.751Z, last 2026-10-25T18:20:13.009Z.

### Answers by venue

| venue | ok | no_route | failed | failure kinds |
|---|---:|---:|---:|---|
| aquarius | 160 | 0 | 0 | - |
| broker | 160 | 0 | 0 | - |
| sdex_horizon | 160 | 0 | 0 | - |
| soroswap_agg | 0 | 0 | 160 | no_key: 160 |

### Exit cost at $100,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |
|---|---|---|---|---|
| AQUA | 227 [221 - 239] (n=4) | 1,523 [1,519 - 1,527] (n=4) | 190 [168 - 214] (n=4) | 1,333 |
| BTC | 3,585 [3,580 - 3,588] (n=4) | 6,506 [6,506 - 6,506] (n=4) | 2,864 [2,859 - 2,875] (n=4) | 3,642 |
| ETH | 7,366 [7,364 - 7,367] (n=4) | 5,970 [5,969 - 5,970] (n=4) | 3,849 [3,803 - 3,863] (n=4) | 3,516 |
| EURC | 76 [76 - 76] (n=4) | 6,102 [6,101 - 6,106] (n=4) | 50 [49 - 50] (n=4) | 6,052 |
| PYUSD | 408 [408 - 408] (n=4) | 9 [9 - 9] (n=4) | 214 [214 - 214] (n=4) | 400 |
| SHX | 2,115 [2,111 - 2,121] (n=4) | 5,537 [5,537 - 5,542] (n=4) | 1,581 [1,578 - 1,583] (n=4) | 3,956 |
| USTRY | 6 [6 - 6] (n=4) | 879 [878 - 879] (n=4) | 6 [6 - 6] (n=4) | 872 |
| XLM | 36 [34 - 40] (n=4) | 322 [320 - 330] (n=4) | 35 [32 - 37] (n=4) | 288 |
| XRP | 947 [939 - 951] (n=4) | 5,949 [5,947 - 5,951] (n=4) | 808 [794 - 811] (n=4) | 5,139 |
| yXLM | 60 [58 - 62] (n=4) | 343 [338 - 351] (n=4) | 58 [55 - 61] (n=4) | 285 |

### Exit cost at $1,000,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |
|---|---|---|---|---|
| AQUA | 8,231 [8,230 - 8,231] (n=4) | 6,499 [6,498 - 6,502] (n=4) | 4,712 [4,703 - 4,713] (n=4) | 3,519 |
| BTC | 9,367 [9,367 - 9,367] (n=4) | 9,491 [9,491 - 9,491] (n=4) | 7,382 [7,371 - 7,394] (n=4) | 2,109 |
| ETH | 9,657 [9,657 - 9,657] (n=4) | 9,373 [9,373 - 9,373] (n=4) | 8,392 [8,385 - 8,392] (n=4) | 1,264 |
| EURC | 9,689 [9,689 - 9,696] (n=4) | 9,610 [9,610 - 9,611] (n=4) | 6,013 [6,007 - 6,068] (n=4) | 3,678 |
| PYUSD | 9,256 [9,256 - 9,256] (n=4) | 11 [11 - 11] (n=4) | 2,008 [2,008 - 2,008] (n=4) | 9,246 |
| SHX | 7,321 [7,317 - 7,324] (n=4) | 9,292 [9,292 - 9,293] (n=4) | 6,521 [6,519 - 6,639] (n=4) | 2,772 |
| USTRY | 9,999 [9,999 - 9,999] (n=4) | 4,785 [4,785 - 4,785] (n=4) | 4,256 [4,256 - 4,256] (n=4) | 5,743 |
| XLM | 2,994 [2,992 - 2,995] (n=4) | 3,776 [3,775 - 3,781] (n=4) | 2,203 [2,200 - 2,204] (n=4) | 1,575 |
| XRP | 5,268 [5,263 - 5,287] (n=4) | 9,362 [9,362 - 9,363] (n=4) | 4,868 [4,864 - 4,871] (n=4) | 4,494 |
| yXLM | 4,618 [4,618 - 4,620] (n=4) | 7,402 [7,402 - 7,405] (n=4) | 2,575 [2,571 - 2,582] (n=4) | 4,829 |

### Published safe size per tolerance (latest cycle, best-exit curve, USD)

| asset | 50 bps | 100 bps | 200 bps | 500 bps | closed-form SDEX book @200 | bisected @200 (venue) |
|---|---:|---:|---:|---:|---:|---|
| AQUA | 14,162 | 25,746 | 85,089 | 115,826 | 4 | n/a |
| BTC | 1,410 | 1,803 | 2,952 | 10,513 | 1,727,103 | n/a |
| ETH | 1,370 | 1,600 | 2,184 | 5,550 | 0 | n/a |
| EURC | 100,011 | 101,960 | 105,972 | 118,981 | 116,768 | n/a |
| PYUSD | 1,000,000 | 1,000,000 | 1,000,000 | 1,000,000 | 74,313 | n/a |
| SHX | 2,157 | 3,938 | 10,378 | 16,995 | 20 | n/a |
| USTRY | 102,393 | 105,205 | 111,062 | 130,665 | 288,355 | n/a |
| XLM | 101,788 | 107,332 | 119,344 | 164,062 | 43,244 | n/a |
| XRP | 10,308 | 12,009 | 16,302 | 40,777 | 2,380 | n/a |
| yXLM | 72,576 | 104,023 | 113,968 | 149,878 | 42 | n/a |

`+` = lower bound: even the largest sampled size ($1M) stayed inside the tolerance.

### Stale bounds from measured drift (per asset)

| asset | marks | cycle sigma (bps) | stale bound (s) | basis |
|---|---:|---:|---:|---|
| AQUA | 5 | n/a | 3,600 | too_few_samples |
| BTC | 5 | n/a | 3,600 | too_few_samples |
| ETH | 5 | n/a | 3,600 | too_few_samples |
| EURC | 5 | n/a | 3,600 | too_few_samples |
| PYUSD | 5 | n/a | 3,600 | too_few_samples |
| SHX | 5 | n/a | 3,600 | too_few_samples |
| USTRY | 5 | n/a | 3,600 | too_few_samples |
| XLM | 5 | n/a | 3,600 | too_few_samples |
| XRP | 5 | n/a | 3,600 | too_few_samples |
| yXLM | 5 | n/a | 3,600 | too_few_samples |

