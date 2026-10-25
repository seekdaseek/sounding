#!/bin/sh
# pm2-start.sh — VPS. Idempotent: delete + start each sounding process, then pm2 save.
# Needs /opt/sounding/.env (mode 600) with, as applicable:
#   SOROSWAP_API_KEY=sk_...           (sampler; the Soroswap venue reads no_key without it)
#   X402_TESTNET_PAYTO=G...           (paid endpoint, public address)
cd /opt/sounding || exit 1
NODEARGS="--env-file=.env --no-warnings"
for n in sounding-sampler sounding-api sounding-paid; do pm2 delete $n >/dev/null 2>&1; done
pm2 start bin/sampler.mjs --name sounding-sampler --cwd /opt/sounding --node-args="$NODEARGS --max-old-space-size=160" --max-memory-restart 220M --time -e /var/log/sounding-sampler.err.log -o /var/log/sounding-sampler.out.log >/dev/null
PORT=3035 pm2 start bin/api.mjs --name sounding-api --cwd /opt/sounding --node-args="$NODEARGS --max-old-space-size=96" --max-memory-restart 150M --time -e /var/log/sounding-api.err.log -o /var/log/sounding-api.out.log >/dev/null
PORT=3036 pm2 start bin/paid.mjs --name sounding-paid --cwd /opt/sounding --node-args="$NODEARGS --max-old-space-size=128" --max-memory-restart 200M --time -e /var/log/sounding-paid.err.log -o /var/log/sounding-paid.out.log >/dev/null
pm2 save >/dev/null
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s)) if(/^sounding/.test(p.name)) console.log(p.name,p.pm2_env.status,"restarts",p.pm2_env.restart_time)})'
