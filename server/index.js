'use strict';
/* ---------------------------------------------------------------------------
   Demo Gym — local server.
   Express REST API + static UI + WebSocket for live fingerprint scan events.
   ------------------------------------------------------------------------- */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');

const cfg = require('./config');
const db = require('./db');
const seed = require('./seed');
const routes = require('./routes');
const S = require('./lib/serialize');
const { logCheckin, logStaffCheckin } = require('./lib/checkin');
const fp = require('./services/fingerprint');
const syncAgent = require('./services/sync/agent');

// Never let a stray error take the server down (otherwise the UI shows 'failed to fetch').
function logErr(tag, e) {
  const line = '[' + new Date().toISOString() + '] ' + tag + ' ' + ((e && e.stack) || e) + '\n';
  try { console.error(line.trim()); } catch (_) {}
  try { fs.appendFileSync(path.join(cfg.dataHome, 'error.log'), line); } catch (_) {}
}
process.on('uncaughtException', (e) => logErr('[uncaught]', e));
process.on('unhandledRejection', (e) => logErr('[unhandledRejection]', e));

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', routes);

// Serve the UI by reading the file (works both in dev and inside a packaged
// .exe snapshot). All other assets (Tailwind, Chart.js, Lucide) load from CDN.
const INDEX_HTML = path.join(cfg.publicDir, 'index.html');
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  try { res.type('html').send(fs.readFileSync(INDEX_HTML, 'utf8')); }
  catch (e) { res.status(500).send('UI not found'); }
});

const server = http.createServer(app);

/* ---- WebSocket: broadcast live scan events to the Scan page ---- */
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => { if (c.readyState === 1) { try { c.send(msg); } catch (e) {} } });
}
wss.on('connection', (ws) => { ws.on('error', () => {}); try { ws.send(JSON.stringify({ type: 'hello', fingerprint: fp.status() })); } catch (e) {} });
wss.on('error', onFatalListen);

// If the port is taken, another copy is already running: open the browser to it and exit.
function onFatalListen(e) {
  if (e && e.code === 'EADDRINUSE') { console.log('Demo Gym is already running — opening the browser.'); openBrowser('http://127.0.0.1:' + cfg.port); process.exit(0); }
  logErr('[server-error]', e); // log but keep running — never kill the server
}

// A real finger seen by the reader -> record attendance + notify the UI.
fp.on('scan', (evt) => {
  if (evt && evt.member) {
    const checkin = logCheckin(evt.member);
    broadcast({ type: 'scan', member: S.memberOut(evt.member), checkin, score: evt.score });
  } else if (evt && evt.staff) {
    const attendance = logStaffCheckin(evt.staff);
    broadcast({ type: 'staff-scan', staff: S.staffOut(evt.staff), attendance, score: evt.score });
  } else {
    broadcast({ type: 'scan-unknown' });
  }
});

async function start() {
  await db.init();
  try { if (seed.seedIfEmpty()) console.log('[db] initialised a clean install'); }
  catch (e) { logErr('[db-seed]', e); }
  try { const status = await fp.init(); console.log('[fingerprint] mode:', status.mode, '| device:', status.device); }
  catch (e) { logErr('[fingerprint-init]', e); }

  const url = 'http://127.0.0.1:' + cfg.port;
  const noOpen = process.argv.includes('--no-open') || !cfg.openBrowser;

  server.on('error', onFatalListen); // handle "port in use" gracefully

  server.listen(cfg.port, cfg.host, () => {
    console.log('\n  Demo Gym is running.');
    console.log('  Open:  ' + url + '\n');
    if (!noOpen) openBrowser(url);

    // Phase 2 — optional cloud sync. Outbound-only; fully isolated so it can
    // never take the local app down. Disabled unless explicitly configured.
    try {
      if (cfg.cloudSync && cfg.cloudUrl && cfg.syncToken) {
        syncAgent.start({ cfg, db, logErr });
        console.log('[sync] cloud sync enabled -> ' + cfg.cloudUrl + ' (every ' + (cfg.syncIntervalMs / 1000) + 's)');
      } else {
        console.log('[sync] cloud sync disabled (set CLOUD_SYNC=1, CLOUD_URL and SYNC_DEVICE_TOKEN to enable)');
      }
    } catch (e) { logErr('[sync-start]', e); }
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(cmd + ' "' + url + '"', () => {});
}

function shutdown() {
  console.log('\nShutting down…');
  try { syncAgent.stop(); } catch (e) {}
  try { fp.stop(); } catch (e) {}
  try { db.close(); } catch (e) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
