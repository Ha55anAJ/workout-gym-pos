'use strict';
/* SQLite via sql.js (SQLite compiled to WebAssembly).
   Pure JavaScript: no native module, no node-gyp, no flags — runs on any Node.
   The DB lives in memory and is saved to disk (cfg.dbPath) after every change. */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  phone TEXT, type TEXT NOT NULL, join_date TEXT NOT NULL, last_payment TEXT,
  suspended INTEGER NOT NULL DEFAULT 0, fingerprint INTEGER NOT NULL DEFAULT 0,
  fp_samples INTEGER NOT NULL DEFAULT 0, fp_enrolled_at TEXT );
CREATE TABLE IF NOT EXISTS fingerprints (
  member_id INTEGER PRIMARY KEY, template BLOB NOT NULL, samples INTEGER NOT NULL DEFAULT 0,
  enrolled_at TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, date TEXT NOT NULL,
  member_id INTEGER, member_code TEXT, member_name TEXT, amount INTEGER NOT NULL,
  month TEXT, method TEXT, notes TEXT, recorded_by TEXT );
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, date TEXT NOT NULL,
  category TEXT NOT NULL, description TEXT, amount INTEGER NOT NULL, recorded_by TEXT );
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL, phone TEXT, salary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', join_date TEXT,
  fingerprint INTEGER NOT NULL DEFAULT 0, fp_samples INTEGER NOT NULL DEFAULT 0, fp_enrolled_at TEXT );
CREATE TABLE IF NOT EXISTS staff_fingerprints (
  staff_id INTEGER PRIMARY KEY, template BLOB NOT NULL, samples INTEGER NOT NULL DEFAULT 0,
  enrolled_at TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS staff_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, staff_id INTEGER,
  staff_code TEXT, staff_name TEXT );
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL,
  email TEXT, last_login TEXT );
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, member_id INTEGER,
  member_code TEXT, member_name TEXT );
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_checkins_at ON checkins(at);
`;

let SQL = null;        // sql.js module
let database = null;   // current DB
let inTxn = false;

async function init() {
  if (database) return database;
  if (!SQL) {
    const initSqlJs = require('sql.js');
    const dir = path.dirname(require.resolve('sql.js'));
    SQL = await initSqlJs({ locateFile: (f) => path.join(dir, f) });
  }
  openFromDisk();
  return database;
}
function openFromDisk() {
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  let data = null;
  try { if (fs.existsSync(cfg.dbPath)) data = fs.readFileSync(cfg.dbPath); } catch (e) {}
  database = new SQL.Database(data && data.length ? new Uint8Array(data) : undefined);
  database.run('PRAGMA foreign_keys = ON');
  database.exec(SCHEMA);
  // migrate older databases: add staff fingerprint columns if missing
  ['ALTER TABLE staff ADD COLUMN fingerprint INTEGER NOT NULL DEFAULT 0',
   'ALTER TABLE staff ADD COLUMN fp_samples INTEGER NOT NULL DEFAULT 0',
   'ALTER TABLE staff ADD COLUMN fp_enrolled_at TEXT'].forEach((sql) => { try { database.run(sql); } catch (e) {} });
  persist();
}
function persist() {
  if (!database) return;
  try { fs.writeFileSync(cfg.dbPath, Buffer.from(database.export())); } catch (e) {}
}
function maybePersist() { if (!inTxn) persist(); }

function normParams(args) {
  if (args.length === 1) {
    const a = args[0];
    if (a && typeof a === 'object' && !Array.isArray(a) && !Buffer.isBuffer(a) && !(a instanceof Uint8Array)) {
      const o = {}; for (const k in a) o['@' + k] = a[k]; return o;   // bare keys -> @named
    }
    return [a];
  }
  return args.length ? Array.prototype.slice.call(args) : undefined;
}
function makeStmt(sql) {
  return {
    get(...args) {
      const st = database.prepare(sql);
      try { const p = normParams(args); if (p !== undefined) st.bind(p); return st.step() ? st.getAsObject() : undefined; }
      finally { st.free(); }
    },
    all(...args) {
      const st = database.prepare(sql); const out = [];
      try { const p = normParams(args); if (p !== undefined) st.bind(p); while (st.step()) out.push(st.getAsObject()); return out; }
      finally { st.free(); }
    },
    run(...args) {
      database.run(sql, normParams(args));
      maybePersist();
      return { changes: database.getRowsModified() };
    }
  };
}

module.exports = {
  init,
  get conn() { return database; },
  prepare: (sql) => makeStmt(sql),
  exec: (sql) => { database.exec(sql); maybePersist(); },
  checkpoint() { persist(); },
  transaction(fn) {
    return (...args) => {
      inTxn = true; database.exec('BEGIN');
      try { const r = fn(...args); database.exec('COMMIT'); inTxn = false; persist(); return r; }
      catch (e) { try { database.exec('ROLLBACK'); } catch (_) {} inTxn = false; throw e; }
    };
  },
  close() { if (database) { try { persist(); database.close(); } catch (e) {} database = null; } },
  reopen() { if (database) { try { database.close(); } catch (e) {} database = null; } openFromDisk(); return database; }
};
