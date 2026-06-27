'use strict';
/* ---------------------------------------------------------------------------
   Phase 2 — local → cloud sync agent.

   Runs inside the offline gym laptop app. Periodically PUSHES local data up to
   the cloud API and PULLS pending commands back down to apply locally.

   Design rules (important):
   - Outbound HTTPS only. This module NEVER opens a port or accepts connections.
   - It must be impossible for sync to crash the host app: every async path is
     wrapped so failures are logged and swallowed, never thrown to the runtime.
   - Biometric fingerprint templates (tables `fingerprints` / `staff_fingerprints`)
     are NEVER read or transmitted. The non-biometric flag/count columns on
     `members` / `staff` (fingerprint, fp_samples, fp_enrolled_at) are fine.

   The sync contract (cloud side, already deployed):
   - POST <cloudUrl>/api/sync/push   body: { members, payments, expenses, staff,
       checkins, staffCheckins, settings }  (raw snake_case rows; settings is a map)
   - GET  <cloudUrl>/api/sync/commands           -> [{ id, type, payload, ... }]
   - POST <cloudUrl>/api/sync/commands/:id/ack    body: { status, result? }
   All requests carry header  Authorization: Bearer <syncToken>.
   ------------------------------------------------------------------------- */

// Dependencies are injectable so the agent can be unit-tested against a mock
// cloud and a throwaway DB without touching real config/data. They default to
// the real app config/db, but are only require()'d lazily (in start() or via
// _setDeps) so importing this module never forces a DB init.
let cfg = null;
let db = null;
let logErr = defaultLogErr;

function ensureRealDeps() {
  if (!cfg) cfg = require('../../config');
  if (!db) db = require('../../db');
}

let timer = null;     // setInterval handle
let running = false;  // guard against overlapping cycles

/* -- small helpers -------------------------------------------------------- */
function defaultLogErr(tag, e) {
  try { console.error('[' + new Date().toISOString() + '] ' + tag + ' ' + ((e && e.stack) || e)); } catch (_) {}
}
const pad = (n) => String(n).padStart(2, '0');
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtMonth(d) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return M[d.getMonth()] + ' ' + d.getFullYear();
}
function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.syncToken };
}

// Mirror routes.js nextCode(prefix, table, width) against the LOCAL db.
function nextCode(prefix, table, width) {
  const rows = db.prepare('SELECT code FROM ' + table).all();
  let max = 0;
  rows.forEach((r) => { const n = parseInt(String(r.code).slice(prefix.length), 10); if (n > max) max = n; });
  return prefix + String(max + 1).padStart(width, '0');
}
// Mirror routes.js setSetting (string passthrough, otherwise JSON-encode).
function setSetting(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, v);
}
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value v FROM settings WHERE key=?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.v); } catch (e) { return row.v; }
}

/* -- collect outbound payload -------------------------------------------- */
// Returns RAW snake_case rows (as stored) for everything safe to sync.
// Deliberately omits `fingerprints` / `staff_fingerprints` (biometric BLOBs).
function collectPayload() {
  const all = (sql) => db.prepare(sql).all();

  const settingsMap = {};
  all('SELECT key, value FROM settings').forEach((r) => {
    try { settingsMap[r.key] = JSON.parse(r.value); }
    catch (e) { settingsMap[r.key] = r.value; }
  });

  return {
    members: all('SELECT * FROM members ORDER BY id'),
    payments: all('SELECT * FROM payments ORDER BY id'),
    expenses: all('SELECT * FROM expenses ORDER BY id'),
    staff: all('SELECT * FROM staff ORDER BY id'),
    // check-ins must carry their local id so the cloud can dedupe by source_id.
    checkins: all('SELECT id, at, member_id, member_code, member_name FROM checkins ORDER BY id'),
    staffCheckins: all('SELECT id, at, staff_id, staff_code, staff_name FROM staff_checkins ORDER BY id'),
    settings: settingsMap
  };
}

/* -- push ----------------------------------------------------------------- */
async function pushOnce() {
  try {
    const payload = collectPayload();
    const res = await fetch(cfg.cloudUrl + '/api/sync/push', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await safeText(res);
      logErr('[sync-push]', 'HTTP ' + res.status + ' ' + text);
      return;
    }
    const body = await res.json().catch(() => ({}));
    const c = (body && body.counts) || {};
    console.log('[sync] pushed members=' + (c.members || 0) +
      ' payments=' + (c.payments || 0) +
      ' expenses=' + (c.expenses || 0) +
      ' staff=' + (c.staff || 0) +
      ' checkins=' + (c.checkins || 0) +
      ' staffCheckins=' + (c.staffCheckins || 0) +
      ' settings=' + (c.settings || 0));
    return body;
  } catch (e) {
    logErr('[sync-push]', e);
  }
}

/* -- poll + apply commands ------------------------------------------------ */
async function pollCommands() {
  let commands;
  try {
    const res = await fetch(cfg.cloudUrl + '/api/sync/commands', { headers: authHeaders() });
    if (!res.ok) { logErr('[sync-poll]', 'HTTP ' + res.status + ' ' + (await safeText(res))); return; }
    commands = await res.json();
  } catch (e) {
    logErr('[sync-poll]', e);
    return;
  }
  if (!Array.isArray(commands) || !commands.length) return;

  for (const cmd of commands) {
    let status = 'applied';
    let result;
    try {
      result = applyCommand(cmd);
    } catch (e) {
      status = 'failed';
      result = { error: (e && e.message) || String(e) };
      logErr('[sync-apply ' + (cmd && cmd.type) + ']', e);
    }
    await ackCommand(cmd.id, status, result);
  }
}

async function ackCommand(id, status, result) {
  try {
    await fetch(cfg.cloudUrl + '/api/sync/commands/' + id + '/ack', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ status, result })
    });
  } catch (e) {
    logErr('[sync-ack]', e);
  }
}

/* -- apply a single command to the LOCAL db ------------------------------- */
// Throws on failure (caller acks 'failed'). Returns a small result object that
// is sent back to the cloud as the ack result.
function applyCommand(cmd) {
  if (!cmd || !cmd.type) throw new Error('command missing type');
  let p = cmd.payload;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { throw new Error('invalid payload JSON'); } }
  p = p || {};

  switch (cmd.type) {
    case 'suspendMember': {
      const m = mustMember(p.code);
      db.prepare('UPDATE members SET suspended=1 WHERE id=?').run(m.id);
      return { code: m.code, suspended: 1 };
    }
    case 'reactivateMember': {
      const m = mustMember(p.code);
      db.prepare('UPDATE members SET suspended=0 WHERE id=?').run(m.id);
      return { code: m.code, suspended: 0 };
    }
    case 'recordPayment': {
      // Mirrors POST /api/payments: insert a payment, bump member last_payment + un-suspend.
      const m = mustMember(p.memberCode);
      const d = today();
      const code = nextCode('P', 'payments', 4);
      const month = fmtMonth(new Date());
      db.prepare('INSERT INTO payments(code,date,member_id,member_code,member_name,amount,month,method,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(code, d, m.id, m.code, m.name, Math.round(Number(p.amount) || 0), month, p.method || 'Cash', p.notes || '', 'Cloud');
      db.prepare('UPDATE members SET last_payment=?, suspended=0 WHERE id=?').run(d, m.id);
      return { paymentCode: code, memberCode: m.code, amount: Math.round(Number(p.amount) || 0) };
    }
    case 'addExpense': {
      // Mirrors POST /api/expenses.
      const code = nextCode('E', 'expenses', 4);
      const category = p.category || 'Other';
      db.prepare('INSERT INTO expenses(code,date,category,description,amount,recorded_by) VALUES (?,?,?,?,?,?)')
        .run(code, p.date || today(), category, p.description || (category + ' expense'), Math.round(Number(p.amount) || 0), 'Cloud');
      return { expenseCode: code, category, amount: Math.round(Number(p.amount) || 0) };
    }
    case 'editMember': {
      const m = mustMember(p.code);
      db.prepare('UPDATE members SET name=?, phone=?, type=? WHERE id=?')
        .run(p.name || m.name, p.phone != null ? p.phone : m.phone, p.type || m.type, m.id);
      return { code: m.code };
    }
    case 'updateSettings': {
      // Merge each provided block into its settings row (setSetting-style upsert).
      const touched = [];
      if (p.gym != null) { setSetting('gym', Object.assign({}, getSetting('gym', {}), p.gym)); touched.push('gym'); }
      if (p.tiers != null) {
        const tiers = Object.assign({}, getSetting('tiers', {}), p.tiers);
        Object.keys(tiers).forEach((k) => { tiers[k] = Math.round(Number(tiers[k]) || 0); });
        setSetting('tiers', tiers); touched.push('tiers');
      }
      if (p.policy != null) { setSetting('policy', Object.assign({}, getSetting('policy', { cycleDays: 30, dueSoonDays: 5 }), p.policy)); touched.push('policy'); }
      return { updated: touched };
    }
    default:
      throw new Error('unknown command type: ' + cmd.type);
  }
}

function mustMember(code) {
  if (!code) throw new Error('member code is required');
  const m = db.prepare('SELECT * FROM members WHERE code=?').get(code);
  if (!m) throw new Error('member not found: ' + code);
  return m;
}

async function safeText(res) { try { return await res.text(); } catch (e) { return ''; } }

/* -- lifecycle ------------------------------------------------------------ */
// deps: { cfg?, db?, logErr? }  — anything omitted falls back to the real app.
function start(deps) {
  deps = deps || {};
  if (deps.cfg) cfg = deps.cfg;
  if (deps.db) db = deps.db;
  if (deps.logErr) logErr = deps.logErr;
  ensureRealDeps(); // fill in anything not injected with the real app config/db

  if (timer) return; // already started

  const cycle = async () => {
    if (running) return; // never overlap a slow cycle with the next tick
    running = true;
    try {
      await pushOnce();
      await pollCommands();
    } catch (e) {
      logErr('[sync-cycle]', e);
    } finally {
      running = false;
    }
  };

  // Kick off shortly after start (let the host finish booting), then on interval.
  setTimeout(() => { cycle().catch((e) => logErr('[sync-cycle]', e)); }, 2000);
  timer = setInterval(() => { cycle().catch((e) => logErr('[sync-cycle]', e)); }, cfg.syncIntervalMs || 30000);
  if (timer.unref) timer.unref(); // don't keep the process alive just for sync

  return { ok: true };
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  start,
  stop,
  // exported for tests:
  collectPayload,
  pushOnce,
  pollCommands,
  applyCommand,
  _setDeps(deps) { if (deps.cfg) cfg = deps.cfg; if (deps.db) db = deps.db; if (deps.logErr) logErr = deps.logErr; }
};
