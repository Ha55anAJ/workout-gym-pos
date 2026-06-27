'use strict';
/* ---------------------------------------------------------------------------
   Tests for the cloud sync agent. Run with:  node --test server/services/sync/
   No real cloud, no real data:
     - DB_PATH is pointed at a throwaway temp file before requiring db.js.
     - A tiny local http server stands in for the cloud API.
   ------------------------------------------------------------------------- */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// IMPORTANT: set DB_PATH before requiring db/config (dbPath is read at import).
const TMP_DB = path.join(os.tmpdir(), 'sync-agent-test-' + process.pid + '-' + Date.now() + '.db');
process.env.DB_PATH = TMP_DB;

const db = require('../../db');
const agent = require('./agent');

// quiet logger so failing-HTTP tests don't spam the test output
const noopLog = () => {};

/* -- seed a throwaway DB with representative rows -------------------------- */
async function seedDb() {
  await db.init();
  db.exec('DELETE FROM members; DELETE FROM payments; DELETE FROM expenses; DELETE FROM staff; DELETE FROM checkins; DELETE FROM staff_checkins; DELETE FROM settings; DELETE FROM fingerprints; DELETE FROM staff_fingerprints;');

  db.prepare('INSERT INTO members(code,name,phone,type,join_date,last_payment,suspended,fingerprint,fp_samples,fp_enrolled_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('A001', 'Alice', '0500000001', 'Premium', '2026-01-01', '2026-06-01', 0, 1, 3, '2026-01-02');
  db.prepare('INSERT INTO members(code,name,phone,type,join_date,last_payment,suspended,fingerprint,fp_samples,fp_enrolled_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('A002', 'Bob', '0500000002', 'Basic', '2026-02-01', null, 0, 0, 0, null);

  db.prepare('INSERT INTO payments(code,date,member_id,member_code,member_name,amount,month,method,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('P0001', '2026-06-01', 1, 'A001', 'Alice', 200, 'Jun 2026', 'Cash', '', 'Owner');

  db.prepare('INSERT INTO expenses(code,date,category,description,amount,recorded_by) VALUES (?,?,?,?,?,?)')
    .run('E0001', '2026-06-10', 'Utilities', 'Electricity', 150, 'Owner');

  db.prepare('INSERT INTO staff(code,name,role,phone,salary,status,join_date) VALUES (?,?,?,?,?,?,?)')
    .run('S01', 'Coach Carl', 'Trainer', '0500000003', 3000, 'active', '2026-01-01');

  db.prepare('INSERT INTO checkins(at,member_id,member_code,member_name) VALUES (?,?,?,?)')
    .run('2026-06-20T08:00:00', 1, 'A001', 'Alice');
  db.prepare('INSERT INTO staff_checkins(at,staff_id,staff_code,staff_name) VALUES (?,?,?,?)')
    .run('2026-06-20T07:30:00', 1, 'S01', 'Coach Carl');

  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run('gym', JSON.stringify({ name: 'Iron Temple' }));
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run('version', '1.0.0'); // bare string

  // Biometric template BLOB — this must NEVER appear in any pushed payload.
  const SECRET = Buffer.from('BIOMETRIC_TEMPLATE_SECRET_BYTES', 'utf8');
  db.prepare('INSERT OR REPLACE INTO fingerprints(member_id,template,samples,enrolled_at) VALUES (?,?,?,?)')
    .run(1, SECRET, 3, '2026-01-02');
  db.prepare('INSERT OR REPLACE INTO staff_fingerprints(staff_id,template,samples,enrolled_at) VALUES (?,?,?,?)')
    .run(1, SECRET, 3, '2026-01-02');
}

/* -- a tiny mock cloud ---------------------------------------------------- */
function startMockCloud() {
  const state = { pushes: [], acks: [], served: false };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      if (req.method === 'POST' && req.url === '/api/sync/push') {
        state.pushes.push({ auth, body: JSON.parse(raw || '{}') });
        const b = state.pushes[state.pushes.length - 1].body;
        const counts = {};
        ['members', 'payments', 'expenses', 'staff', 'checkins', 'staffCheckins'].forEach((k) => { counts[k] = (b[k] || []).length; });
        counts.settings = Object.keys(b.settings || {}).length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, counts }));
      }
      if (req.method === 'GET' && req.url === '/api/sync/commands') {
        // Serve a single suspendMember command exactly once.
        const cmds = state.served ? [] : [{ id: 'cmd-1', type: 'suspendMember', payload: JSON.stringify({ code: 'A001' }), status: 'pending', created_at: '2026-06-28T00:00:00' }];
        state.served = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(cmds));
      }
      const m = req.url.match(/^\/api\/sync\/commands\/(.+)\/ack$/);
      if (req.method === 'POST' && m) {
        state.acks.push({ id: m[1], body: JSON.parse(raw || '{}') });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(404); res.end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

function mkCfg(port) {
  return { cloudUrl: 'http://127.0.0.1:' + port, syncToken: 'test-token', cloudSync: true, syncIntervalMs: 999999 };
}

test.before(async () => { await seedDb(); });
test.after(() => { try { db.close(); } catch (e) {} try { fs.unlinkSync(TMP_DB); } catch (e) {} });

/* -- collectPayload: shape, snake_case, no biometrics --------------------- */
test('collectPayload returns raw snake_case rows and never includes fingerprint templates', async () => {
  agent._setDeps({ db, logErr: noopLog });
  const p = agent.collectPayload();

  assert.equal(p.members.length, 2, 'two members');
  assert.equal(p.payments.length, 1);
  assert.equal(p.expenses.length, 1);
  assert.equal(p.staff.length, 1);
  assert.equal(p.checkins.length, 1);
  assert.equal(p.staffCheckins.length, 1);

  // snake_case raw columns are present (not the camelCase serialized shape)
  assert.equal(p.members[0].code, 'A001');
  assert.ok('join_date' in p.members[0], 'member rows are raw snake_case (join_date)');
  assert.ok('last_payment' in p.members[0]);
  assert.ok('member_code' in p.payments[0], 'payment rows are raw snake_case');

  // check-ins carry their local id so the cloud can dedupe by source_id
  assert.ok(typeof p.checkins[0].id === 'number', 'checkins carry id');
  assert.ok(typeof p.staffCheckins[0].id === 'number', 'staffCheckins carry id');

  // settings is a map; JSON values parsed, bare strings passed through
  assert.deepEqual(p.settings.gym, { name: 'Iron Temple' });
  assert.equal(p.settings.version, '1.0.0');

  // NO biometric template bytes anywhere in the serialized payload
  const serialized = JSON.stringify(p);
  assert.ok(!/BIOMETRIC_TEMPLATE_SECRET_BYTES/.test(serialized), 'secret template bytes must not appear');
  assert.ok(!/template/.test(serialized), 'no "template" field should be present');
  assert.ok(!('fingerprints' in p) && !('staffFingerprints' in p), 'no fingerprint tables in payload');
});

/* -- pushOnce hits the cloud with bearer auth and clean body -------------- */
test('pushOnce POSTs to /api/sync/push with bearer token and a body free of biometric data', async () => {
  const cloud = await startMockCloud();
  try {
    agent._setDeps({ cfg: mkCfg(cloud.port), db, logErr: noopLog });
    const resp = await agent.pushOnce();
    assert.ok(resp && resp.ok, 'push returned ok');
    assert.equal(cloud.state.pushes.length, 1, 'cloud received exactly one push');

    const push = cloud.state.pushes[0];
    assert.equal(push.auth, 'Bearer test-token', 'bearer token sent');
    assert.equal(push.body.members.length, 2);
    assert.equal(push.body.checkins[0].member_code, 'A001');
    assert.ok(typeof push.body.checkins[0].id === 'number', 'pushed checkins carry id');
    assert.ok(!/BIOMETRIC_TEMPLATE_SECRET_BYTES/.test(JSON.stringify(push.body)), 'no biometric bytes pushed');
  } finally {
    cloud.server.close();
  }
});

/* -- pollCommands applies the suspendMember command and acks applied ------ */
test('pollCommands applies a suspendMember command and acks it as applied', async () => {
  await seedDb(); // reset (A001 not suspended)
  const cloud = await startMockCloud();
  try {
    agent._setDeps({ cfg: mkCfg(cloud.port), db, logErr: noopLog });
    await agent.pollCommands();

    const a = db.prepare('SELECT suspended FROM members WHERE code=?').get('A001');
    assert.equal(a.suspended, 1, 'member A001 suspended by command');

    assert.equal(cloud.state.acks.length, 1, 'one ack sent');
    assert.equal(cloud.state.acks[0].id, 'cmd-1');
    assert.equal(cloud.state.acks[0].body.status, 'applied');
  } finally {
    cloud.server.close();
  }
});

/* -- applyCommand: individual command types ------------------------------- */
test('applyCommand suspendMember sets suspended=1', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  const r = agent.applyCommand({ id: 'x', type: 'suspendMember', payload: JSON.stringify({ code: 'A001' }) });
  assert.equal(r.suspended, 1);
  assert.equal(db.prepare('SELECT suspended s FROM members WHERE code=?').get('A001').s, 1);
});

test('applyCommand reactivateMember sets suspended=0', async () => {
  await seedDb();
  db.prepare('UPDATE members SET suspended=1 WHERE code=?').run('A001');
  agent._setDeps({ db, logErr: noopLog });
  agent.applyCommand({ type: 'reactivateMember', payload: { code: 'A001' } }); // object payload also accepted
  assert.equal(db.prepare('SELECT suspended s FROM members WHERE code=?').get('A001').s, 0);
});

test('applyCommand recordPayment inserts a payment, bumps last_payment and un-suspends', async () => {
  await seedDb();
  db.prepare('UPDATE members SET suspended=1 WHERE code=?').run('A001');
  agent._setDeps({ db, logErr: noopLog });
  const before = db.prepare('SELECT COUNT(*) c FROM payments').get().c;
  const r = agent.applyCommand({ type: 'recordPayment', payload: JSON.stringify({ memberCode: 'A001', amount: 250, method: 'Card' }) });
  const after = db.prepare('SELECT COUNT(*) c FROM payments').get().c;
  assert.equal(after, before + 1, 'a payment row was inserted');
  const pay = db.prepare('SELECT * FROM payments WHERE code=?').get(r.paymentCode);
  assert.equal(pay.amount, 250);
  assert.equal(pay.method, 'Card');
  assert.equal(pay.member_code, 'A001');
  const m = db.prepare('SELECT suspended, last_payment FROM members WHERE code=?').get('A001');
  assert.equal(m.suspended, 0, 'member un-suspended after payment');
  assert.ok(m.last_payment, 'last_payment set');
});

test('applyCommand addExpense inserts an expense', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  const before = db.prepare('SELECT COUNT(*) c FROM expenses').get().c;
  const r = agent.applyCommand({ type: 'addExpense', payload: JSON.stringify({ category: 'Rent', amount: 5000, description: 'June rent' }) });
  const after = db.prepare('SELECT COUNT(*) c FROM expenses').get().c;
  assert.equal(after, before + 1);
  const exp = db.prepare('SELECT * FROM expenses WHERE code=?').get(r.expenseCode);
  assert.equal(exp.category, 'Rent');
  assert.equal(exp.amount, 5000);
});

test('applyCommand editMember updates fields', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  agent.applyCommand({ type: 'editMember', payload: JSON.stringify({ code: 'A002', name: 'Bobby', type: 'Premium' }) });
  const m = db.prepare('SELECT * FROM members WHERE code=?').get('A002');
  assert.equal(m.name, 'Bobby');
  assert.equal(m.type, 'Premium');
});

test('applyCommand addMember inserts a member with the next A### code', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  const before = db.prepare('SELECT COUNT(*) c FROM members').get().c; // A001, A002 seeded
  const r = agent.applyCommand({ type: 'addMember', payload: JSON.stringify({ name: 'Carol', phone: '0500000099', type: 'Premium' }) });
  const after = db.prepare('SELECT COUNT(*) c FROM members').get().c;
  assert.equal(after, before + 1, 'a member row was inserted');
  assert.equal(r.code, 'A003', 'next code follows the highest existing code');
  const m = db.prepare('SELECT * FROM members WHERE code=?').get('A003');
  assert.equal(m.name, 'Carol');
  assert.equal(m.phone, '0500000099');
  assert.equal(m.type, 'Premium');
  assert.equal(m.suspended, 0);
  assert.equal(m.fingerprint, 0);
  assert.ok(m.join_date, 'join_date set to today');
});

test('applyCommand addMember requires a name', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  assert.throws(() => agent.applyCommand({ type: 'addMember', payload: JSON.stringify({ phone: '0300' }) }), /name is required/);
});

test('applyCommand updateSettings merges into settings', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  agent.applyCommand({ type: 'updateSettings', payload: JSON.stringify({ tiers: { Basic: 100, Premium: 200 }, policy: { dueSoonDays: 7 } }) });
  const tiers = JSON.parse(db.prepare('SELECT value v FROM settings WHERE key=?').get('tiers').v);
  assert.equal(tiers.Basic, 100);
  const policy = JSON.parse(db.prepare('SELECT value v FROM settings WHERE key=?').get('policy').v);
  assert.equal(policy.dueSoonDays, 7);
});

test('applyCommand throws on an unknown command type (so it acks failed)', async () => {
  agent._setDeps({ db, logErr: noopLog });
  assert.throws(() => agent.applyCommand({ type: 'definitelyNotARealType', payload: '{}' }), /unknown command type/);
});

test('applyCommand throws on a missing member', async () => {
  await seedDb();
  agent._setDeps({ db, logErr: noopLog });
  assert.throws(() => agent.applyCommand({ type: 'suspendMember', payload: JSON.stringify({ code: 'NOPE' }) }), /member not found/);
});
