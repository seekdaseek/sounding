#!/bin/zsh
# deploy.sh — MAC. Sync the repo to the VPS, verify every file byte-for-byte, then (re)start the
# four PM2 processes with delete + start (never `pm2 restart`: PM2 freezes env at first start).
# Usage:  ops/deploy.sh [host-alias]      default alias: solwatch
# Secrets are never copied: /opt/sounding/.env lives only on the VPS (mode 600).
set -eu
HOST=${1:-solwatch}
cd "$(dirname "$0")/.."
rsync -a --delete --exclude node_modules --exclude '*.db*' --exclude .env --exclude .git --exclude test --exclude scripts --exclude docs \
  ./src ./bin ./data ./ops ./package.json ./package-lock.json "$HOST":/opt/sounding/
LC_ALL=C; export LC_ALL
mac=$(find src bin data ops package.json package-lock.json -type f | sort | xargs shasum -a 256 | awk '{print $1"  "$2}' | shasum -a 256)
vps=$(ssh -o BatchMode=yes "$HOST" 'cd /opt/sounding && chown -R root:root . && LC_ALL=C find src bin data ops package.json package-lock.json -type f | LC_ALL=C sort | xargs sha256sum | sha256sum')
[ "$mac" = "$vps" ] || { echo "SHA MISMATCH mac=$mac vps=$vps"; exit 1; }
echo "files identical: $mac"
ssh -o BatchMode=yes "$HOST" 'cd /opt/sounding && npm ci --omit=dev --omit=optional >/dev/null 2>&1 && sh ops/pm2-start.sh'
