'use strict';
/* Phase 3 PWA tests: the cloud app must serve the installable owner dashboard
   (app shell, manifest, service worker, icons) AND keep the /api intact.
   Same pg-mem pattern as smoke.test.js. */
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

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
const get = (path, headers) => fetch(base + path, { headers: headers || {} });
const post = (path, body, headers) => fetch(base + path, {
  method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
  body: JSON.stringify(body)
});

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

test('GET / serves the SPA shell (HTML with app marker + title)', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /<div id="app">/);
  assert.match(html, /Demo Gym/);
});

test('GET /index.html serves the same shell', async () => {
  const res = await get('/index.html');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="app">/);
});

test('GET /manifest.json is JSON named "Demo Gym"', async () => {
  const res = await get('/manifest.json');
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.name, 'Demo Gym');
  assert.equal(j.short_name, 'Demo Gym');
  assert.equal(j.display, 'standalone');
  assert.ok(Array.isArray(j.icons) && j.icons.length >= 2);
  assert.ok(j.icons.some((i) => /maskable/.test(i.purpose || '')));
});

test('GET /sw.js is a service worker (JS, addEventListener)', async () => {
  const res = await get('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
  const js = await res.text();
  assert.match(js, /addEventListener/);
});

test('icons are valid PNGs (200 + image/png)', async () => {
  for (const name of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']) {
    const res = await get(name);
    assert.equal(res.status, 200, name + ' should be 200');
    assert.match(res.headers.get('content-type') || '', /image\/png/, name + ' should be image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG magic number
    assert.deepEqual(buf.slice(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]), name + ' has PNG signature');
  }
});

test('CSP allows self + cdnjs + inline so the SPA can load', async () => {
  const res = await get('/');
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /cdnjs\.cloudflare\.com/);
  assert.match(csp, /'unsafe-inline'/);
  // must NOT carry cross-origin isolation that would block the SW/manifest
  assert.equal(res.headers.get('cross-origin-embedder-policy'), null);
});

test('SPA fallback: unknown non-API GET returns the shell, not 404', async () => {
  const res = await get('/members');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="app">/);
});

// ---- /api still works exactly as before ----
test('GET /api/health is ok', async () => {
  const j = await (await get('/api/health')).json();
  assert.equal(j.ok, true);
  assert.equal(j.db, true);
});

test('login returns a token and bootstrap returns members[]', async () => {
  const login = await post('/api/auth/login', { username: 'owner', password: 'secret123' });
  assert.equal(login.status, 200);
  const { token, account } = await login.json();
  assert.ok(token);
  assert.equal(account.role, 'Owner');
  const boot = await get('/api/bootstrap', { authorization: 'Bearer ' + token });
  assert.equal(boot.status, 200);
  assert.ok(Array.isArray((await boot.json()).members));
});

test('unknown /api route still 404s as JSON', async () => {
  const res = await get('/api/nope');
  assert.equal(res.status, 404);
  const j = await res.json();
  assert.equal(j.error, 'not found');
});
