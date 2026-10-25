// store.mjs — the sqlite file. node:sqlite (built in, Node >= 22.5): no native build,
// no dependency. One writer (the sampler), many readers (the API opens read-only).
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS cycles (
  cycle_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_start   INTEGER NOT NULL,           -- epoch ms
  ts_end     INTEGER,
  assets     INTEGER,
  rows       INTEGER,
  note       TEXT
);
CREATE TABLE IF NOT EXISTS marks (
  cycle_id   INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  asset      TEXT NOT NULL,
  mark       REAL,                       -- USDC per unit, median of $1k quotes; NULL = no venue answered
  n_venues   INTEGER NOT NULL,
  PRIMARY KEY (cycle_id, asset)
);
CREATE TABLE IF NOT EXISTS samples (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id   INTEGER NOT NULL,
  ts         INTEGER NOT NULL,           -- epoch ms, when the venue answered
  asset      TEXT NOT NULL,
  size_usd   REAL NOT NULL,              -- nominal size
  units      REAL NOT NULL,              -- actual units sold (size_usd / mark at sizing time)
  venue      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok','no_route','failed')),
  proceeds   REAL,                       -- USDC, only when status = 'ok'
  bps        REAL,                       -- cost vs the cycle mark, only when status = 'ok'
  route      TEXT,                       -- JSON, trimmed
  fail_kind  TEXT,                       -- typed, only when status = 'failed'
  detail     TEXT,
  ms         INTEGER                     -- latency
);
CREATE INDEX IF NOT EXISTS samples_asset_ts ON samples (asset, size_usd, ts);
CREATE INDEX IF NOT EXISTS samples_venue_status ON samples (venue, status);
CREATE INDEX IF NOT EXISTS samples_cycle ON samples (cycle_id);
CREATE TABLE IF NOT EXISTS book_safe (   -- closed form on the direct SDEX orderbook
  cycle_id   INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  asset      TEXT NOT NULL,
  tol_bps    INTEGER NOT NULL,
  safe_units REAL,
  safe_usd   REAL,
  limited_by TEXT,
  depth_units REAL,
  bid_levels INTEGER,
  PRIMARY KEY (cycle_id, asset, tol_bps)
);
CREATE TABLE IF NOT EXISTS bisect (      -- bisection on live quotes, hourly
  cycle_id   INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  asset      TEXT NOT NULL,
  venue      TEXT NOT NULL,
  tol_bps    INTEGER NOT NULL,
  safe_usd   REAL,
  limited_by TEXT,
  quotes     INTEGER,
  PRIMARY KEY (cycle_id, asset, venue, tol_bps)
);
`;

export function openStore(path, { readonly = false } = {}) {
  const db = new DatabaseSync(path, readonly ? { readOnly: true } : {});
  if (!readonly) db.exec(SCHEMA);
  return db;
}

export function insertSamples(db, rows) {
  const st = db.prepare(`INSERT INTO samples (cycle_id, ts, asset, size_usd, units, venue, status, proceeds, bps, route, fail_kind, detail, ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  try {
    for (const r of rows) st.run(r.cycle_id, r.ts, r.asset, r.size_usd, r.units, r.venue, r.status, r.proceeds ?? null, r.bps ?? null,
      r.route ? JSON.stringify(r.route).slice(0, 1500) : null, r.fail_kind ?? null, r.detail ? String(r.detail).slice(0, 300) : null, r.ms ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
