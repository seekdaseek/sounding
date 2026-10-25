# Measured results

Generated 2026-10-25T18:43:17Z from the production database by `node scripts/fill-docs.mjs <db>`
(tables by `scripts/results-md.mjs`). Every number below comes from the database; the live
equivalents are `GET /v1/stats` and `GET /v1/history.csv`.

**1,120 samples** in **7 cycles**, 10 assets (AQUA, BTC, ETH, EURC, PYUSD, SHX, USTRY, XLM, XRP, yXLM), first 2026-10-25T17:56:06.751Z, last 2026-10-25T18:43:04.568Z.

### Answers by venue

| venue | ok | no_route | failed | failure kinds |
|---|---:|---:|---:|---|
| aquarius | 280 | 0 | 0 | - |
| broker | 280 | 0 | 0 | - |
| sdex_horizon | 280 | 0 | 0 | - |
| soroswap_agg | 0 | 0 | 280 | no_key: 280 |

### Exit cost at $100,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |
|---|---|---|---|---|
| AQUA | 233 [221 - 238] (n=7) | 1,526 [1,520 - 1,527] (n=7) | 177 [173 - 210] (n=7) | 1,343 |
| BTC | 3,588 [3,584 - 3,589] (n=7) | 6,506 [6,506 - 6,506] (n=7) | 2,871 [2,864 - 2,872] (n=7) | 3,635 |
| ETH | 7,367 [7,366 - 7,368] (n=7) | 5,970 [5,969 - 5,970] (n=7) | 3,840 [3,835 - 3,859] (n=7) | 3,524 |
| EURC | 76 [75 - 76] (n=7) | 6,106 [6,101 - 6,107] (n=7) | 49 [49 - 50] (n=7) | 6,057 |
| PYUSD | 408 [407 - 408] (n=7) | 9 [9 - 9] (n=7) | 214 [214 - 214] (n=7) | 400 |
| SHX | 2,116 [2,113 - 2,119] (n=7) | 5,542 [5,537 - 5,542] (n=7) | 1,580 [1,579 - 1,583] (n=7) | 3,962 |
| USTRY | 6 [6 - 6] (n=7) | 879 [879 - 879] (n=7) | 6 [6 - 6] (n=7) | 872 |
| XLM | 38 [35 - 40] (n=7) | 323 [322 - 329] (n=7) | 36 [33 - 37] (n=7) | 290 |
| XRP | 946 [943 - 948] (n=7) | 5,950 [5,948 - 5,950] (n=7) | 799 [796 - 808] (n=7) | 5,151 |
| yXLM | 60 [59 - 62] (n=7) | 343 [343 - 350] (n=7) | 60 [57 - 61] (n=7) | 288 |

### Exit cost at $1,000,000 (bps vs the cycle mark): median [p10 - p90] over all cycles

| asset | sdex_horizon | aquarius | broker | best-venue spread (median, bps) |
|---|---|---|---|---|
| AQUA | 8,231 [8,231 - 8,232] (n=7) | 6,501 [6,499 - 6,502] (n=7) | 4,711 [4,704 - 4,713] (n=7) | 3,519 |
| BTC | 9,367 [9,367 - 9,367] (n=7) | 9,491 [9,491 - 9,491] (n=7) | 7,380 [7,371 - 7,394] (n=7) | 2,111 |
| ETH | 9,657 [9,657 - 9,657] (n=7) | 9,373 [9,373 - 9,373] (n=7) | 8,385 [8,385 - 8,392] (n=7) | 1,271 |
| EURC | 9,689 [9,689 - 9,690] (n=7) | 9,611 [9,610 - 9,611] (n=7) | 6,012 [6,011 - 6,068] (n=7) | 3,677 |
| PYUSD | 9,256 [9,256 - 9,256] (n=7) | 11 [11 - 11] (n=7) | 2,008 [2,008 - 2,008] (n=7) | 9,246 |
| SHX | 7,320 [7,317 - 7,324] (n=7) | 9,293 [9,292 - 9,293] (n=7) | 6,520 [6,519 - 6,639] (n=7) | 2,772 |
| USTRY | 9,999 [9,999 - 9,999] (n=7) | 4,785 [4,785 - 4,785] (n=7) | 4,256 [4,256 - 4,256] (n=7) | 5,743 |
| XLM | 2,994 [2,992 - 2,994] (n=7) | 3,778 [3,776 - 3,780] (n=7) | 2,203 [2,200 - 2,203] (n=7) | 1,577 |
| XRP | 5,265 [5,249 - 5,285] (n=7) | 9,362 [9,362 - 9,362] (n=7) | 4,867 [4,850 - 4,868] (n=7) | 4,495 |
| yXLM | 4,620 [4,618 - 4,620] (n=7) | 7,404 [7,402 - 7,405] (n=7) | 2,572 [2,571 - 2,582] (n=7) | 4,831 |

### Safe size per tolerance (USD): three methods side by side

Columns 50-500 bps: interpolated from the latest cycle's best-exit curve. `published @200`: what the API publishes (time-weighted over six cycles, capped by the latest, share-capped across independent venues). `book` = closed form on the direct SDEX order book. `bisected` = hourly bisection on live quotes (venue named).

| asset | 50 bps | 100 bps | 200 bps | 500 bps | published @200 | book @200 | bisected @200 (venue) |
|---|---:|---:|---:|---:|---:|---:|---|
| AQUA | 15,397 | 32,087 | 101,156 | 117,832 | 32,414 | 14,397 | 115,478 (broker) |
| BTC | 1,406 | 1,800 | 2,947 | 10,508 | 2,909 | 21 | 4,532 (broker) |
| ETH | 1,372 | 1,603 | 2,187 | 5,558 | 2,187 | 0 | 2,129 (broker) |
| EURC | 100,030 | 101,960 | 105,933 | 118,806 | 26,703 | 107,503 | 103,663 (broker) |
| PYUSD | 1,000,000+ | 1,000,000+ | 1,000,000+ | 1,000,000+ | 77,368 | 74,348 | 1,000,000+ (aquarius) |
| SHX | 2,263 | 4,170 | 10,477 | 17,110 | 10,438 | 3,981 | 9,647 (broker) |
| USTRY | 102,393 | 105,205 | 111,062 | 130,665 | 36,855 | 267,813 | 273,842 (broker) |
| XLM | 101,575 | 107,115 | 119,118 | 163,819 | 91,248 | 264,204 | 305,053 (broker) |
| XRP | 10,091 | 11,768 | 16,004 | 40,252 | 5,240 | 1,889 | 43,714 (broker) |
| yXLM | 63,594 | 103,780 | 113,740 | 149,732 | 78,862 | 247 | 273,842 (broker) |

`+` = lower bound: even the largest sampled size ($1M) stayed inside the tolerance. A published size of 0 means the share cap refused a single-venue depth.

### Stale bounds from measured drift (per asset)

Drift series = best-exit price at $100k per cycle (mark and depth together). bound = clamp((100 bps / sigma)^2 x cycle gap, 1200 s, 7200 s); 3,600 s until six cycles exist.

| asset | cycles in series | cycle sigma (bps) | stale bound (s) | basis |
|---|---:|---:|---:|---|
| AQUA | 7 | 31.4 | 4,676 | drift |
| BTC | 7 | 10.8 | 7,200 | drift |
| ETH | 7 | 58.2 | 1,360 | drift |
| EURC | 7 | 0.4 | 7,200 | drift |
| PYUSD | 7 | 0.0 | 7,200 | drift |
| SHX | 7 | 7.0 | 7,200 | drift |
| USTRY | 7 | 0.0 | 7,200 | drift |
| XLM | 7 | 6.5 | 7,200 | drift |
| XRP | 7 | 10.1 | 7,200 | drift |
| yXLM | 7 | 7.7 | 7,200 | drift |

