'use strict';
/* Local backup = a timestamped copy of the SQLite database file.
   Restore overwrites the live database file with an uploaded backup. */
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const db = require('../db');

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

function ensureDir() { fs.mkdirSync(cfg.backupDir, { recursive: true }); }
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function create() {
  ensureDir();
  db.checkpoint(); // flush WAL so the copy is complete
  const file = 'demo-gym-backup-' + stamp() + '.db';
  const dest = path.join(cfg.backupDir, file);
  fs.copyFileSync(cfg.dbPath, dest);
  return { file, size: fs.statSync(dest).size, takenAt: new Date().toISOString() };
}

function list() {
  ensureDir();
  return fs.readdirSync(cfg.backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => { const st = fs.statSync(path.join(cfg.backupDir, f)); return { file: f, size: st.size, takenAt: st.mtime.toISOString() }; })
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

function filePath(name) {
  const p = path.join(cfg.backupDir, path.basename(name)); // basename blocks traversal
  return p;
}

function isSqlite(buf) { return buf && buf.length >= 16 && buf.subarray(0, 16).equals(SQLITE_MAGIC); }

function restoreFromBuffer(buf) {
  if (!isSqlite(buf)) throw new Error('not a SQLite database file');
  ensureDir();
  try { create(); } catch (e) {} // safety snapshot of current data first
  db.close();
  ['', '-wal', '-shm'].forEach((s) => { try { fs.rmSync(cfg.dbPath + s, { force: true }); } catch (e) {} });
  fs.writeFileSync(cfg.dbPath, buf);
  db.reopen();
  return true;
}

module.exports = { create, list, filePath, restoreFromBuffer, isSqlite };
