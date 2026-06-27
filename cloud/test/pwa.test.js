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
  assert.match(html, /<div id="app"/);
  assert.match(html, /Demo Gym/);
  // Real app UI markers (pixel-match of public/index.html, not the rejected dark design).
  assert.match(html, /Membership tiers/);
  assert.match(html, /data-lucide/);
  assert.match(html, /Loading Demo Gym/);
  // The dark design must be gone.
  assert.doesNotMatch(html, /color-scheme: dark|#0f172a/);
});

test('GET /index.html serves the same shell', async () => {
  const res = await get('/index.html');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="app"/);
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

test('CSP is tight (self + inline, no external CDN) and SW-friendly', async () => {
  const res = await get('/');
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /'unsafe-inline'/);
  assert.doesNotMatch(csp, /cdnjs|tailwindcss\.com|jsdelivr|unpkg/);
  // must NOT carry cross-origin isolation that would block the SW/manifest
  assert.equal(res.headers.get('cross-origin-embedder-policy'), null);
});

test('self-hosted assets serve and the shell references them (no CDN)', async () => {
  const css = await get('/app.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
  const cssText = await css.text();
  assert.match(cssText, /tailwindcss/);
  // The custom theme must be compiled in (proves it scanned the real index.html).
  assert.match(cssText, /\.bg-accent/);

  const chart = await get('/chart.umd.js');
  assert.equal(chart.status, 200);
  assert.match(chart.headers.get('content-type') || '', /javascript/);
  assert.match(await chart.text(), /Chart\.js v4/);

  const lucide = await get('/lucide.min.js');
  assert.equal(lucide.status, 200);
  assert.match(lucide.headers.get('content-type') || '', /javascript/);
  assert.match(await lucide.text(), /lucide/i);

  const html = await (await get('/')).text();
  assert.match(html, /\/app\.css/);
  assert.match(html, /\/chart\.umd\.js/);
  assert.match(html, /\/lucide\.min\.js/);
  assert.doesNotMatch(html, /cdnjs|cdn\.tailwindcss\.com|jsdelivr|unpkg/);
});

test('SPA fallback: unknown non-API GET returns the shell, not 404', async () => {
  const res = await get('/members');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="app"/);
});

// ---- /api still works exactly as before ----
test('GET /api/health is ok', async () => {
  const j = await (await get('/api/health')).json();
  assert.equal(j.ok, true);
  assert.equal(j.db, true);
});

test('login returns a token and bootstrap returns the exact UI shape (camelCase)', async () => {
  const login = await post('/api/auth/login', { username: 'owner', password: 'secret123' });
  assert.equal(login.status, 200);
  const { token, account } = await login.json();
  assert.ok(token);
  assert.equal(account.role, 'Owner');

  // Seed some data via the device sync push so we can verify the serialized shape.
  const DEV = { authorization: 'Bearer test-device-token' };
  await post('/api/sync/push', {
    members: [{ code: 'A001', name: 'Asad', phone: '0300', type: 'Premium', join_date: '2026-06-01', last_payment: '2026-06-10', suspended: 0, fingerprint: 1, fp_samples: 3 }],
    payments: [{ code: 'P0001', date: '2026-06-10', member_code: 'A001', member_name: 'Asad', amount: 5000, month: 'Jun 2026', method: 'Cash', recorded_by: 'Owner' }],
    expenses: [{ code: 'E0001', date: '2026-06-05', category: 'Rent', description: 'June rent', amount: 30000, recorded_by: 'Owner' }],
    settings: { gym: { name: 'Demo Gym', city: 'Lahore' }, tiers: { Basic: 5000, Premium: 8000, Student: 3000, Family: 12000 }, policy: { cycleDays: 30, dueSoonDays: 5 } }
  }, DEV);

  const boot = await get('/api/bootstrap', { authorization: 'Bearer ' + token });
  assert.equal(boot.status, 200);
  const b = await boot.json();

  // top-level shape
  assert.match(b.today, /^\d{4}-\d{2}-\d{2}$/, 'today is YYYY-MM-DD');
  assert.ok(b.settings && b.settings.tiers && typeof b.settings.tiers === 'object', 'settings.tiers present');
  assert.equal(b.settings.policy.cycleDays, 30);
  assert.equal(b.settings.version, '1.0.0');
  assert.ok('logo' in b.settings);
  assert.equal(b.fingerprint.mode, 'cloud');
  assert.ok(Array.isArray(b.members) && Array.isArray(b.payments) && Array.isArray(b.expenses));
  assert.ok(Array.isArray(b.staff) && Array.isArray(b.checkins) && Array.isArray(b.staffCheckins));

  // camelCase serialized rows (member uses id=code, joinDate; payment uses memberId, amount)
  const m = b.members.find((x) => x.id === 'A001');
  assert.ok(m, 'member serialized with id=code');
  assert.equal(m.joinDate, '2026-06-01');
  assert.equal(m.lastPayment, '2026-06-10');
  assert.equal(m.type, 'Premium');
  const p = b.payments.find((x) => x.id === 'P0001');
  assert.ok(p, 'payment serialized with id=code');
  assert.equal(p.memberId, 'A001');
  assert.equal(p.amount, 5000);
  const e = b.expenses.find((x) => x.id === 'E0001');
  assert.ok(e && e.category === 'Rent' && e.amount === 30000);
});

test('unknown /api route still 404s as JSON', async () => {
  const res = await get('/api/nope');
  assert.equal(res.status, 404);
  const j = await res.json();
  assert.equal(j.error, 'not found');
});
