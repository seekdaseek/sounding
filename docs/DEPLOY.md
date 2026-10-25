# Deploying sounding

From an empty Linux box to the four running processes. This is the document that makes the
service reproducible by someone who is not the maintainer. Everything here was run on the
production box on 2026-10-25 (Debian-family, Node 22.23, PM2, `cloudflared` 2026.10.3); steps that
need an account only the owner has are marked **OWNER**.

## What runs

| PM2 name | file | port | job | memory seen |
|---|---|---|---|---|
| `sounding-sampler` | `bin/sampler.mjs` | - | every 10 min: all assets x 4 sizes x all venues -> sqlite; hourly bisection | ~85 MB |
| `sounding-api` | `bin/api.mjs` | 3035 | read API + one-page explainer (sqlite opened read-only) | ~75 MB |
| `sounding-paid` | `bin/paid.mjs` | 3036 | `/paid/v1/exit` behind x402 (testnet today) | ~80 MB |
| `sounding-tunnel` | `cloudflared` | - | public hostname -> 3035, and `^/paid/` -> 3036 | ~40 MB |

One writer (the sampler) and read-only readers share `/opt/sounding/sounding.db` (WAL mode).
There are no runtime dependencies for the sampler or the API (`node:sqlite` and `fetch` are built
into Node >= 22.13); only `sounding-paid` needs `npm ci` (Express + the x402 packages).

## 1. Box and code

```bash
# VPS
node -v                                  # >= 22.13 (node:sqlite without a flag)
git clone https://github.com/seekdaseek/sounding.git /opt/sounding
cd /opt/sounding && npm ci --omit=dev --omit=optional
install -m 600 /dev/null .env            # secrets live only here, never in git
```

`--omit=optional` skips the Blend SDK, which only `bin/probe.mjs` (the original Blend gate) uses.

## 2. Configuration (`/opt/sounding/.env`, mode 600)

```
SOROSWAP_API_KEY=sk_...                  # OWNER: free key from https://api.soroswap.finance/register
X402_TESTNET_PAYTO=G...                  # public address that receives testnet USDC
```

Without `SOROSWAP_API_KEY` the sampler still runs; the Soroswap venue records typed `no_key` failures.
Check a key without printing it: `awk -F= '/^SOROSWAP_API_KEY=/{print length($2)}' .env`.

**Installing the key from a Mac without echoing it** (zsh; the key travels over ssh stdin, never argv,
replaces any old `SOROSWAP_API_KEY=` line, keeps the other variables, restarts the processes with delete + start):

```zsh
printf 'Paste key: '; read -rs K; echo; case "$K" in sk_??????????*) printf '%s' "$K" | ssh -o BatchMode=yes solwatch 'umask 077; K=$(cat); F=/opt/sounding/.env; touch "$F"; grep -v "^SOROSWAP_API_KEY=" "$F" > "$F.new"; printf "SOROSWAP_API_KEY=%s\n" "$K" >> "$F.new"; mv "$F.new" "$F"; chmod 600 "$F"; echo "key saved, length ${#K}"; sh /opt/sounding/ops/pm2-start.sh' ;; *) echo "that does not look like an sk_ key; nothing written" ;; esac; unset K
```

The first cycle with a key takes about 5 minutes (1 request/s, 6 Soroswap calls per asset and size).

## 3. Start

```bash
# VPS: delete + start, never `pm2 restart` (PM2 freezes the environment at first start)
sh ops/pm2-start.sh
```

From a workstation with an ssh alias, `ops/deploy.sh <alias>` does the whole round trip: rsync,
byte-for-byte checksum comparison of every deployed file, `npm ci`, then `ops/pm2-start.sh`.

## 4. Public hostname (Cloudflare Tunnel)

A dedicated tunnel keeps this service off every other tunnel's ingress. **OWNER** (needs the
Cloudflare zone's `cert.pem` on the box):

```bash
cloudflared tunnel create sounding                         # prints the UUID, writes <UUID>.json
cloudflared tunnel route dns --overwrite-dns <UUID> sounding.example.org
```

`/root/.cloudflared/sounding.yml`:

```yaml
tunnel: <UUID>
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: sounding.example.org
    path: ^/paid/
    service: http://127.0.0.1:3036
  - hostname: sounding.example.org
    service: http://127.0.0.1:3035
  - service: http_status:404
```

```bash
cloudflared tunnel --config /root/.cloudflared/sounding.yml ingress validate
pm2 start /usr/local/bin/cloudflared --name sounding-tunnel --interpreter none -- \
  tunnel --config /root/.cloudflared/sounding.yml --no-autoupdate run
pm2 save
```

Do not send `cloudflared` a SIGHUP: it handles only TERM and INT and a HUP kills the tunnel.

## 5. Verify

```bash
curl -s https://sounding.example.org/healthz                    # {"ok": true, "last_cycle_age_s": <1500}
curl -s 'https://sounding.example.org/v1/exit?asset=XLM&size=100000' | head -40
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s))if(/^sounding/.test(p.name))console.log(p.name,p.pm2_env.status,p.pm2_env.restart_time)})'
```

The first sample lands ~50 seconds after the sampler starts; the first cycle takes about 45 s with
the three keyless venues and about 5 minutes once Soroswap (1 request/s) is added.

## 6. Backup and restore

```bash
# VPS: consistent copy of a live WAL database
sqlite3 /opt/sounding/sounding.db ".backup /opt/backups/sounding-$(date +%F).db"
```

`ops/backup.sh` does this nightly (cron `25 3 * * *`) and keeps 14 days. The measurement history is
also public: `GET /v1/history.csv` (CC BY 4.0). To restore, stop the sampler, copy a backup to
`/opt/sounding/sounding.db`, start the sampler (the next cycle sizes itself from the stored marks).

## 7. Rebuild the asset universe

```bash
node bin/discover.mjs --n 10 --include XLM,EURC,AQUA,yXLM,USTRY,PYUSD,ETH,BTC,XRP,SHX
```

reads the live Aquarius pool list, measures every classic-issued candidate against USDC through
Horizon and Aquarius, and writes `data/universe.json`. Redeploy to apply it.

## 8. Mainnet x402 (not configured; tranche 1 of the grant)

Needs the owner's receiving Stellar account (with a USDC trustline) and an OpenZeppelin channels
mainnet API key. In `src/paid.mjs` set `network: 'stellar:pubnet'`, the facilitator URL, and send the key as the
facilitator client's bearer header. See `stellar/x402-stellar` `examples/simple-paywall/server/src/middleware/payment.ts`.
**UNTESTED on mainnet.**
