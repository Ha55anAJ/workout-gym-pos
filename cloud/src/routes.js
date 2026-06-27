'use strict';
/* REST API for the cloud service.
   - Public:        GET /health, POST /auth/login
   - Owner/staff:   GET /me, GET /bootstrap, POST/GET /commands  (JWT)
   - Gym laptop:    POST /sync/push, GET /sync/commands, POST /sync/commands/:id/ack  (device token)
*/
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const auth = require('./auth');
const S = require('./serialize');

const flag = (v) => (v ? 1 : 0);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: e.message }));
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

/* ---- sync upsert helpers (laptop is the single writer; upsert by business code) ---- */
async function upsertMembers(list) {
  if (!Array.isArray(list)) return 0;
  for (const m of list) {
    await db.query(
      `INSERT INTO members (code,name,phone,type,join_date,last_payment,suspended,fingerprint,fp_samples,fp_enrolled_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (code) DO UPDATE SET
         name=EXCLUDED.name, phone=EXCLUDED.phone, type=EXCLUDED.type, join_date=EXCLUDED.join_date,
         last_payment=EXCLUDED.last_payment, suspended=EXCLUDED.suspended, fingerprint=EXCLUDED.fingerprint,
         fp_samples=EXCLUDED.fp_samples, fp_enrolled_at=EXCLUDED.fp_enrolled_at, updated_at=NOW()`,
      [m.code, m.name, m.phone || null, m.type || 'Basic', m.join_date || null, m.last_payment || null,
       flag(m.suspended), flag(m.fingerprint), num(m.fp_samples), m.fp_enrolled_at || null]
    );
  }
  return list.length;
}

async function upsertPayments(list) {
  if (!Array.isArray(list)) return 0;
  for (const p of list) {
    await db.query(
      `INSERT INTO payments (code,date,member_id,member_code,member_name,amount,month,method,notes,recorded_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (code) DO UPDATE SET
         date=EXCLUDED.date, member_id=EXCLUDED.member_id, member_code=EXCLUDED.member_code,
         member_name=EXCLUDED.member_name, amount=EXCLUDED.amount, month=EXCLUDED.month,
         method=EXCLUDED.method, notes=EXCLUDED.notes, recorded_by=EXCLUDED.recorded_by, updated_at=NOW()`,
      [p.code, p.date, p.member_id || null, p.member_code || null, p.member_name || null,
       num(p.amount), p.month || null, p.method || null, p.notes || null, p.recorded_by || null]
    );
  }
  return list.length;
}

async function upsertExpenses(list) {
  if (!Array.isArray(list)) return 0;
  for (const e of list) {
    await db.query(
      `INSERT INTO expenses (code,date,category,description,amount,recorded_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (code) DO UPDATE SET
         date=EXCLUDED.date, category=EXCLUDED.category, description=EXCLUDED.description,
         amount=EXCLUDED.amount, recorded_by=EXCLUDED.recorded_by, updated_at=NOW()`,
      [e.code, e.date, e.category || 'Other', e.description || null, num(e.amount), e.recorded_by || null]
    );
  }
  return list.length;
}

async function upsertStaff(list) {
  if (!Array.isArray(list)) return 0;
  for (const s of list) {
    await db.query(
      `INSERT INTO staff (code,name,role,phone,salary,status,join_date,fingerprint,fp_samples,fp_enrolled_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (code) DO UPDATE SET
         name=EXCLUDED.name, role=EXCLUDED.role, phone=EXCLUDED.phone, salary=EXCLUDED.salary,
         status=EXCLUDED.status, join_date=EXCLUDED.join_date, fingerprint=EXCLUDED.fingerprint,
         fp_samples=EXCLUDED.fp_samples, fp_enrolled_at=EXCLUDED.fp_enrolled_at, updated_at=NOW()`,
      [s.code, s.name, s.role || 'Receptionist', s.phone || null, num(s.salary), s.status || 'active',
       s.join_date || null, flag(s.fingerprint), num(s.fp_samples), s.fp_enrolled_at || null]
    );
  }
  return list.length;
}

async function insertCheckins(list) {
  if (!Array.isArray(list)) return 0;
  for (const c of list) {
    await db.query(
      `INSERT INTO checkins (source_id, at, member_id, member_code, member_name)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_id) DO NOTHING`,
      [c.source_id != null ? c.source_id : (c.id != null ? c.id : null), c.at, c.member_id || null, c.member_code || null, c.member_name || null]
    );
  }
  return list.length;
}

async function insertStaffCheckins(list) {
  if (!Array.isArray(list)) return 0;
  for (const c of list) {
    await db.query(
      `INSERT INTO staff_checkins (source_id, at, staff_id, staff_code, staff_name)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_id) DO NOTHING`,
      [c.source_id != null ? c.source_id : (c.id != null ? c.id : null), c.at, c.staff_id || null, c.staff_code || null, c.staff_name || null]
    );
  }
  return list.length;
}

async function upsertSettings(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  const keys = Object.keys(obj);
  for (const k of keys) {
    const v = typeof obj[k] === 'string' ? obj[k] : JSON.stringify(obj[k]);
    await db.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  }
  return keys.length;
}

function buildRouter() {
  const r = express.Router();

  /* ---- public ---- */
  r.get('/health', wrap(async (req, res) => {
    try { await db.query('SELECT 1'); res.json({ ok: true, db: true, time: new Date().toISOString() }); }
    catch (e) { res.status(500).json({ ok: false, db: false, error: e.message }); }
  }));

  r.post('/auth/login', loginLimiter, wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const result = await auth.login(username, password);
    if (!result) return res.status(401).json({ error: 'invalid credentials' });
    res.json(result);
  }));

  /* ---- authenticated (owner / staff) ---- */
  r.get('/me', auth.authRequired, (req, res) => res.json({ id: req.user.sub, username: req.user.username, role: req.user.role }));

  // Returns the EXACT shape the copied app UI's loadBootstrap() expects:
  // camelCase serialized rows + a settings block with gym/tiers/policy/version/logo defaults.
  r.get('/bootstrap', auth.authRequired, wrap(async (req, res) => {
    const [settings, members, payments, expenses, staff, checkins, staffCheckins] = await Promise.all([
      db.many('SELECT key, value FROM settings'),
      db.many('SELECT * FROM members ORDER BY id'),
      db.many('SELECT * FROM payments ORDER BY date DESC, id DESC'),
      db.many('SELECT * FROM expenses ORDER BY date DESC, id DESC'),
      db.many('SELECT * FROM staff ORDER BY id'),
      db.many('SELECT * FROM checkins ORDER BY at DESC LIMIT 2000'),
      db.many('SELECT * FROM staff_checkins ORDER BY at DESC LIMIT 2000')
    ]);
    // Parse settings rows (JSON values, bare strings passed through).
    const raw = {};
    for (const row of settings) { try { raw[row.key] = JSON.parse(row.value); } catch (_) { raw[row.key] = row.value; } }
    res.json({
      today: todayStr(),
      settings: {
        gym: raw.gym || {},
        tiers: raw.tiers || {},
        policy: raw.policy || { cycleDays: 30, dueSoonDays: 5 },
        version: raw.version || '1.0.0',
        logo: raw.logo || null
      },
      fingerprint: { mode: 'cloud', device: '', samplesRequired: 3 },
      members: members.map(S.memberOut),
      payments: payments.map(S.paymentOut),
      expenses: expenses.map(S.expenseOut),
      staff: staff.map(S.staffOut),
      users: [],
      checkins: checkins.map(S.checkinOut),
      staffCheckins: staffCheckins.map(S.staffCheckinOut)
    });
  }));

  // Owner enqueues a remote action; receptionists may not.
  r.post('/commands', auth.authRequired, auth.requireRole('Owner'), wrap(async (req, res) => {
    const { type, payload } = req.body || {};
    if (!type) return res.status(400).json({ error: 'command type required' });
    const row = await db.one(
      'INSERT INTO commands (type, payload, created_by) VALUES ($1,$2,$3) RETURNING *',
      [type, JSON.stringify(payload || {}), req.user.username || 'owner']
    );
    res.json(row);
  }));

  r.get('/commands', auth.authRequired, wrap(async (req, res) => {
    res.json(await db.many('SELECT * FROM commands ORDER BY id DESC LIMIT 200'));
  }));

  /* ---- gym laptop sync (device token) ---- */
  r.post('/sync/push', auth.deviceAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const counts = {
      members: await upsertMembers(b.members),
      payments: await upsertPayments(b.payments),
      expenses: await upsertExpenses(b.expenses),
      staff: await upsertStaff(b.staff),
      checkins: await insertCheckins(b.checkins),
      staffCheckins: await insertStaffCheckins(b.staffCheckins),
      settings: await upsertSettings(b.settings)
    };
    res.json({ ok: true, counts });
  }));

  r.get('/sync/commands', auth.deviceAuth, wrap(async (req, res) => {
    res.json(await db.many("SELECT * FROM commands WHERE status='pending' ORDER BY id"));
  }));

  r.post('/sync/commands/:id/ack', auth.deviceAuth, wrap(async (req, res) => {
    const { status, result } = req.body || {};
    await db.query(
      'UPDATE commands SET status=$1, result=$2, applied_at=NOW() WHERE id=$3',
      [status === 'failed' ? 'failed' : 'applied', result != null ? JSON.stringify(result) : null, req.params.id]
    );
    res.json({ ok: true });
  }));

  return r;
}

module.exports = { buildRouter };
