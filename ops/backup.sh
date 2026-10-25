#!/bin/sh
# backup.sh — VPS. Consistent online copy of the WAL database, 14 days kept.
set -eu
DIR=/opt/backups; mkdir -p "$DIR"
OUT="$DIR/sounding-$(date -u +%F).db"
sqlite3 /opt/sounding/sounding.db ".backup $OUT"
[ -s "$OUT" ] || { echo "empty backup $OUT" >&2; exit 1; }
find "$DIR" -name 'sounding-*.db' -mtime +14 -delete
echo "$(date -u +%FT%TZ) ok $OUT $(wc -c < "$OUT") bytes"
