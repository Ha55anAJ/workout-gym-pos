'use strict';
/* ---------------------------------------------------------------------------
   REST API. Everything the frontend needs:
   bootstrap, members, payments, expenses, staff, users, settings,
   check-ins, fingerprint enrollment/identify/simulate, backup/restore, CSV.
   ------------------------------------------------------------------------- */
const express = require('express');
const db = require('./db');
const U = require('./lib/util');
const S = require('./lib/serialize');
const { logCheckin } = require('./lib/checkin');
const fp = require('./services/fingerprint');
const backup = require('./services/backup');

const router = express.Router();

/* helpers ----------------------------------------------------------------- */
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value v FROM settings WHERE key=?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.v); } catch (e) { return row.v; }
}
function setSetting(key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, v);
}
function nextCode(prefix, table, width) {
  const rows = db.prepare('SELECT code FROM ' + table).all();
  let max = 0;
  rows.forEach((r) => { const n = parseInt(String(r.code).slice(prefix.length), 10); if (n > max) max = n; });
  return prefix + String(max + 1).padStart(width, '0');
}
const actorOf = (req) => (req.body && (req.body.recordedBy || req.body.actor)) || 'Owner';
const today = () => U.fmtDate(new Date());
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };
const wrapA = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(400).json({ error: e.message }); } };

/* health + bootstrap ------------------------------------------------------ */
router.get('/health', (req, res) => res.json({ ok: true, version: getSetting('version', '1.0.0'), fingerprint: fp.status() }));

router.get('/bootstrap', (req, res) => {
  res.json({
    today: today(),
    settings: {
      gym: getSetting('gym', {}),
      tiers: getSetting('tiers', {}),
      policy: getSetting('policy', { cycleDays: 30, dueSoonDays: 5 }),
      version: getSetting('version', '1.0.0'),
      logo: getSetting('logo', null)
    },
    fingerprint: fp.status(),
    members: db.prepare('SELECT * FROM members ORDER BY id').all().map(S.memberOut),
    payments: db.prepare('SELECT * FROM payments ORDER BY date DESC, id DESC').all().map(S.paymentOut),
    expenses: db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC').all().map(S.expenseOut),
    staff: db.prepare('SELECT * FROM staff ORDER BY id').all().map(S.staffOut),
    users: db.prepare('SELECT * FROM users ORDER BY id').all().map(S.userOut),
    checkins: db.prepare('SELECT * FROM checkins ORDER BY at DESC').all().map(S.checkinOut),
    staffCheckins: db.prepare('SELECT * FROM staff_checkins ORDER BY at DESC').all().map(S.staffCheckinOut)
  });
});

/* members ----------------------------------------------------------------- */
router.post('/members', wrapA(async (req, res) => {
  const { name, phone, type, enrollSessionId } = req.body || {};
  if (!name) throw new Error('name is required');
  const code = nextCode('A', 'members', 3);
  db.prepare('INSERT INTO members(code,name,phone,type,join_date,last_payment,suspended,fingerprint,fp_samples,fp_enrolled_at) VALUES (?,?,?,?,?,?,0,0,0,NULL)')
    .run(code, name, phone || '', type || 'Basic', today(), null);
  if (enrollSessionId) { try { await fp.commitEnroll(enrollSessionId, code); } catch (e) { /* keep member, fingerprint pending */ } }
  res.json(S.memberOut(db.prepare('SELECT * FROM members WHERE code=?').get(code)));
}));

router.put('/members/:code', wrap((req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE code=?').get(req.params.code);
  if (!m) throw new Error('member not found');
  const { name, phone, type } = req.body || {};
  db.prepare('UPDATE members SET name=?, phone=?, type=? WHERE id=?').run(name || m.name, phone != null ? phone : m.phone, type || m.type, m.id);
  res.json(S.memberOut(db.prepare('SELECT * FROM members WHERE id=?').get(m.id)));
}));

router.post('/members/:code/suspend', wrap((req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE code=?').get(req.params.code);
  if (!m) throw new Error('member not found');
  db.prepare('UPDATE members SET suspended=? WHERE id=?').run(m.suspended ? 0 : 1, m.id);
  res.json(S.memberOut(db.prepare('SELECT * FROM members WHERE id=?').get(m.id)));
}));

/* payments ---------------------------------------------------------------- */
router.post('/payments', wrap((req, res) => {
  const { memberId, amount, method, notes } = req.body || {};
  const m = db.prepare('SELECT * FROM members WHERE code=?').get(memberId);
  if (!m) throw new Error('member not found');
  const d = today();
  const code = nextCode('P', 'payments', 4);
  const month = U.fmtMonth(new Date());
  db.prepare('INSERT INTO payments(code,date,member_id,member_code,member_name,amount,month,method,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(code, d, m.id, m.code, m.name, Math.round(Number(amount) || 0), month, method || 'Cash', notes || '', actorOf(req));
  db.prepare('UPDATE members SET last_payment=?, suspended=0 WHERE id=?').run(d, m.id);
  res.json({
    payment: S.paymentOut(db.prepare('SELECT * FROM payments WHERE code=?').get(code)),
    member: S.memberOut(db.prepare('SELECT * FROM members WHERE id=?').get(m.id))
  });
}));

/* expenses ---------------------------------------------------------------- */
router.post('/expenses', wrap((req, res) => {
  const { category, amount, description, date } = req.body || {};
  const code = nextCode('E', 'expenses', 4);
  db.prepare('INSERT INTO expenses(code,date,category,description,amount,recorded_by) VALUES (?,?,?,?,?,?)')
    .run(code, date || today(), category || 'Other', description || (category || 'Other') + ' expense', Math.round(Number(amount) || 0), actorOf(req));
  res.json(S.expenseOut(db.prepare('SELECT * FROM expenses WHERE code=?').get(code)));
}));

/* staff ------------------------------------------------------------------- */
router.post('/staff', wrapA(async (req, res) => {
  const { name, role, phone, salary, status, enrollSessionId } = req.body || {};
  if (!name) throw new Error('name is required');
  const code = nextCode('S', 'staff', 2);
  db.prepare('INSERT INTO staff(code,name,role,phone,salary,status,join_date) VALUES (?,?,?,?,?,?,?)')
    .run(code, name, role || 'Receptionist', phone || '', Math.round(Number(salary) || 0), status || 'active', today());
  if (enrollSessionId) { try { await fp.commitEnroll(enrollSessionId, 'staff', code); } catch (e) { /* keep staff, fingerprint pending */ } }
  res.json(S.staffOut(db.prepare('SELECT * FROM staff WHERE code=?').get(code)));
}));
router.put('/staff/:code', wrap((req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE code=?').get(req.params.code);
  if (!s) throw new Error('staff not found');
  const { name, role, phone, salary, status } = req.body || {};
  db.prepare('UPDATE staff SET name=?, role=?, phone=?, salary=?, status=? WHERE id=?')
    .run(name || s.name, role || s.role, phone != null ? phone : s.phone, salary != null ? Math.round(Number(salary) || 0) : s.salary, status || s.status, s.id);
  res.json(S.staffOut(db.prepare('SELECT * FROM staff WHERE id=?').get(s.id)));
}));

/* users ------------------------------------------------------------------- */
router.post('/users', wrap((req, res) => {
  const { name, role, email } = req.body || {};
  if (!name) throw new Error('name is required');
  const r = role || 'Receptionist', em = email || '', d = today();
  db.prepare('INSERT INTO users(name,role,email,last_login) VALUES (?,?,?,?)').run(name, r, em, d);
  res.json(S.userOut({ name, role: r, email: em, last_login: d }));
}));

/* settings ---------------------------------------------------------------- */
router.put('/settings/gym', wrap((req, res) => {
  const gym = Object.assign({}, getSetting('gym', {}), req.body || {});
  setSetting('gym', gym); res.json(gym);
}));
router.put('/settings/tiers', wrap((req, res) => {
  const tiers = Object.assign({}, getSetting('tiers', {}), req.body || {});
  Object.keys(tiers).forEach((k) => { tiers[k] = Math.round(Number(tiers[k]) || 0); });
  setSetting('tiers', tiers); res.json(tiers);
}));
router.put('/settings/policy', wrap((req, res) => {
  const cur = getSetting('policy', { cycleDays: 30, dueSoonDays: 5 });
  const policy = { cycleDays: Math.round(Number((req.body || {}).cycleDays) || cur.cycleDays), dueSoonDays: Math.round(Number((req.body || {}).dueSoonDays) || cur.dueSoonDays) };
  setSetting('policy', policy); res.json(policy);
}));
router.put('/settings/logo', wrap((req, res) => {
  const logo = (req.body || {}).logo || null;   // a data: URL, or null to clear
  if (logo && logo.length > 800000) throw new Error('logo image is too large (keep it under ~500 KB)');
  setSetting('logo', logo);
  res.json({ logo });
}));

/* check-ins --------------------------------------------------------------- */
router.post('/checkins', wrap((req, res) => {
  const m = db.prepare('SELECT * FROM members WHERE code=?').get((req.body || {}).memberId);
  if (!m) throw new Error('member not found');
  res.json(logCheckin(m));
}));

/* fingerprint ------------------------------------------------------------- */
router.get('/fingerprint/status', (req, res) => res.json(fp.status()));
router.post('/fingerprint/enroll/start', wrap((req, res) => res.json(fp.startEnroll())));
router.post('/fingerprint/enroll/sample', wrapA(async (req, res) => res.json(await fp.captureSample((req.body || {}).sessionId))));
router.post('/fingerprint/enroll/commit', wrapA(async (req, res) => {
  const { sessionId, memberId, kind, id } = req.body || {};
  const k = kind || 'member';
  const code = id || memberId;
  const r = await fp.commitEnroll(sessionId, k, code);
  if (k === 'staff') r.staff = S.staffOut(db.prepare('SELECT * FROM staff WHERE code=?').get(code));
  else r.member = S.memberOut(db.prepare('SELECT * FROM members WHERE code=?').get(code));
  res.json(r);
}));
router.post('/fingerprint/enroll/cancel', wrap((req, res) => { fp.cancelEnroll((req.body || {}).sessionId); res.json({ ok: true }); }));
router.post('/fingerprint/identify', wrapA(async (req, res) => {
  const r = await fp.identify();
  if (r.member) { r.checkin = logCheckin(r.member); r.member = S.memberOut(r.member); }
  res.json(r);
}));
// Identify a finger WITHOUT recording a check-in (used to look up a member, e.g. in the payment form).
router.post('/fingerprint/lookup', wrapA(async (req, res) => {
  const r = await fp.identify();
  if (r.member) r.member = S.memberOut(r.member);
  res.json(r);
}));
router.post('/fingerprint/simulate', wrap((req, res) => {
  const r = fp.simulate((req.body || {}).kind);
  if (r.member) { const c = logCheckin(r.member); res.json({ member: S.memberOut(r.member), checkin: c }); }
  else res.json({ none: true });
}));

/* backup / restore / export ---------------------------------------------- */
router.post('/backup', wrap((req, res) => res.json(backup.create())));
router.get('/backup/list', wrap((req, res) => res.json(backup.list())));
router.get('/backup/file/:name', (req, res) => {
  try { res.download(backup.filePath(req.params.name)); }
  catch (e) { res.status(404).json({ error: 'not found' }); }
});
// raw .db upload
router.post('/backup/restore', express.raw({ type: '*/*', limit: '512mb' }), wrap((req, res) => {
  if (!req.body || !req.body.length) throw new Error('no file received');
  backup.restoreFromBuffer(req.body);
  res.json({ ok: true });
}));

router.get('/export/csv', (req, res) => {
  const policy = getSetting('policy', { cycleDays: 30, dueSoonDays: 5 });
  let csv = 'Member ID,Name,Phone,Type,Join Date,Last Payment,Status,Fingerprint\n';
  db.prepare('SELECT * FROM members ORDER BY id').all().forEach((m) => {
    csv += [m.code, '"' + m.name + '"', m.phone, m.type, m.join_date, m.last_payment || '', U.statusOf(m, policy), m.fingerprint ? 'Enrolled' : 'No'].join(',') + '\n';
  });
  csv += '\nPayment ID,Date,Member,Amount,Method,Recorded By\n';
  db.prepare('SELECT * FROM payments ORDER BY date DESC').all().forEach((p) => {
    csv += [p.code, p.date, '"' + p.member_name + '"', p.amount, p.method, '"' + p.recorded_by + '"'].join(',') + '\n';
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="demo-gym-export-' + today() + '.csv"');
  res.send(csv);
});

module.exports = router;
