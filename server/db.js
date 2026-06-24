'use strict';
/* ---------------------------------------------------------------------------
   SQLite data layer (better-sqlite3).
   Exposes a thin wrapper so the connection can be re-opened after a restore
   without every module holding a stale reference.
   ------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

let conn = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  type          TEXT NOT NULL,
  join_date     TEXT NOT NULL,
  last_payment  TEXT,
  suspended     INTEGER NOT NULL DEFAULT 0,
  fingerprint   INTEGER NOT NULL DEFAULT 0,
  fp_samples    INTEGER NOT NULL DEFAULT 0,
  fp_enrolled_at TEXT
);

CREATE TABLE IF NOT EXISTS fingerprints (
  member_id   INTEGER PRIMARY KEY,
  template    BLOB NOT NULL,
  samples     INTEGER NOT NULL DEFAULT 0,
  enrolled_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  date        TEXT NOT NULL,
  member_id   INTEGER,
  member_code TEXT,
  member_name TEXT,
  amount      INTEGER NOT NULL,
  month       TEXT,
  method      TEXT,
  notes       TEXT,
  recorded_by TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  date        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  amount      INTEGER NOT NULL,
  recorded_by TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL,
  phone     TEXT,
  salary    INTEGER NOT NULL DEFAULT 0,
  status    TEXT NOT NULL DEFAULT 'active',
  join_date TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  email      TEXT,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS checkins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  member_id   INTEGER,
  member_code TEXT,
  member_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_code);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_checkins_at ON checkins(at);
CREATE INDEX IF NOT EXISTS idx_checkins_member ON checkins(member_code);
`;

function open() {
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const d = new Database(cfg.dbPath);
  // WAL is best for a normal local disk (Windows). Some network/overlay
  // filesystems can't manage the -wal/-shm files, so fall back gracefully.
  try { d.pragma('journal_mode = WAL'); }
  catch (e) { try { d.pragma('journal_mode = DELETE'); } catch (e2) {} }
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);
  return d;
}

function ensure() { if (!conn) conn = open(); return conn; }

module.exports = {
  get conn() { return ensure(); },
  prepare: (sql) => ensure().prepare(sql),
  exec: (sql) => ensure().exec(sql),
  pragma: (p, opt) => ensure().pragma(p, opt),
  transaction: (fn) => ensure().transaction(fn),
  // Flush WAL into the main .db file so a file copy is a complete snapshot.
  checkpoint() { try { ensure().pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ } },
  close() { if (conn) { try { conn.close(); } catch (e) {} conn = null; } },
  reopen() { this.close(); conn = open(); return conn; }
};
