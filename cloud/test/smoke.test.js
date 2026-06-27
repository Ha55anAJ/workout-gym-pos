'use strict';
/* End-to-end smoke test against an in-memory Postgres (pg-mem).
   Verifies migrations, auth, role boundaries, device-token sync, idempotency,
   and the command queue - the full Phase 1 secure loop. */
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

// Env must be set before requiring modules that read it at call time.
process.env.JWT_SECRET = 'test-secret';
process.env.SYNC_DEVICE_TOKEN = 'test-device-token';
process.env.OWNER_USERNAME = 'owner';
process.env.OWNER_PASSWORD = 'secret123';
process.env.OWNER_NAME = 'Test Owner';

const db = require('../src/db');
const migrate = require('../src/migrate');
const authmod = require('../src/auth');
const { createApp } = require('../src/app');

let server, base;

const post = (path, body, headers) => fetch(base + path, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
  body: JSON.stringify(body)
});
const get = (path, headers) => fetch(base + path, { headers: headers || {} });
const ownerToken = async () => (await (await post('/api/auth/login', { username: 'owner', password: 'secret123' })).json()).token;
const DEV = { authorization: 'Bearer test-device-token' };

test.before(async () => {
  const mem = newDb();
  const pg = mem.adapters.createPg();
  db.init(new pg.Pool());
  await migrate.run();
  await authmod.ensureOwner();
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => { if (server) server.close(); });

test('health is ok', async () => {
  const j = await (await get('/api/health')).json();
  assert.equal(j.ok, true);
  assert.equal(j.db, true);
});

test('bootstrap requires auth', async () => {
  assert.equal((await get('/api/bootstrap')).status, 401);
});

test('login succeeds and unlocks bootstrap', async () => {
  const login = await post('/api/auth/login', { username: 'owner', password: 'secret123' });
  assert.equal(login.status, 200);
  const { token, account } = await login.json();
  assert.ok(token);
  assert.equal(account.role, 'Owner');
  const boot = await get('/api/bootstrap', { authorization: 'Bearer ' + token });
  assert.equal(boot.status, 200);
  assert.ok(Array.isArray((await boot.json()).members));
});

test('wrong password is rejected', async () => {
  assert.equal((await post('/api/auth/login', { username: 'owner', password: 'nope' })).status, 401);
});

test('device sync push is upserted and idempotent', async () => {
  const payload = {
    members: [{ code: 'A001', name: 'Asad', phone: '0300', type: 'Basic', join_date: '2026-06-01', suspended: 0, fingerprint: 1, fp_samples: 3 }],
    payments: [{ code: 'P0001', date: '2026-06-10', member_code: 'A001', member_name: 'Asad', amount: 5000, method: 'Cash', recorded_by: 'Owner' }],
    expenses: [{ code: 'E0001', date: '2026-06-05', category: 'Rent', amount: 30000, recorded_by: 'Owner' }],
    checkins: [{ id: 1, at: '2026-06-10T08:00:00Z', member_code: 'A001', member_name: 'Asad' }],
    settings: { gym: { name: 'Demo Gym', currency: 'PKR' }, tiers: { Basic: 5000 } }
  };
  assert.equal((await post('/api/sync/push', payload, DEV)).status, 200);
  assert.equal((await post('/api/sync/push', payload, DEV)).status, 200); // re-push

  const data = await (await get('/api/bootstrap', { authorization: 'Bearer ' + (await ownerToken()) })).json();
  assert.equal(data.members.length, 1);
  assert.equal(data.members[0].code, 'A001');
  assert.equal(data.payments.length, 1);
  assert.equal(data.expenses.length, 1);
  assert.equal(data.checkins.length, 1);          // idempotent despite double push
  assert.equal(data.settings.gym.name, 'Demo Gym');
});

test('updates flow through (suspend a member via re-sync)', async () => {
  await post('/api/sync/push', { members: [{ code: 'A001', name: 'Asad', type: 'Basic', join_date: '2026-06-01', suspended: 1 }] }, DEV);
  const data = await (await get('/api/bootstrap', { authorization: 'Bearer ' + (await ownerToken()) })).json();
  assert.equal(data.members[0].suspended, 1);
});

test('device auth rejects a bad token', async () => {
  assert.equal((await post('/api/sync/push', {}, { authorization: 'Bearer wrong' })).status, 401);
});

test('owner enqueues a command, laptop pulls and acks it', async () => {
  const token = await ownerToken();
  const enq = await post('/api/commands', { type: 'suspendMember', payload: { code: 'A001' } }, { authorization: 'Bearer ' + token });
  assert.equal(enq.status, 200);
  const cmd = await enq.json();

  const pending = await (await get('/api/sync/commands', DEV)).json();
  assert.ok(pending.find((c) => c.id === cmd.id && c.type === 'suspendMember'));

  assert.equal((await post('/api/sync/commands/' + cmd.id + '/ack', { status: 'applied', result: { ok: true } }, DEV)).status, 200);
  const stillPending = await (await get('/api/sync/commands', DEV)).json();
  assert.ok(!stillPending.find((c) => c.id === cmd.id));
});
