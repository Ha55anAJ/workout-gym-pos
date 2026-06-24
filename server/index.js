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
const { logCheckin } = require('./lib/checkin');
const fp = require('./services/fingerprint');

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
wss.on('connection', (ws) => { ws.send(JSON.stringify({ type: 'hello', fingerprint: fp.status() })); });
wss.on('error', onFatalListen);

// If the port is taken, another copy is already running: open the browser to it and exit.
function onFatalListen(e) {
  if (e && e.code === 'EADDRINUSE') { console.log('Demo Gym is already running — opening the browser.'); openBrowser('http://localhost:' + cfg.port); process.exit(0); }
  console.error(e); process.exit(1);
}

// A real finger seen by the reader -> record attendance + notify the UI.
fp.on('scan', (evt) => {
  if (evt && evt.member) {
    const checkin = logCheckin(evt.member);
    broadcast({ type: 'scan', member: S.memberOut(evt.member), checkin, score: evt.score });
  } else {
    broadcast({ type: 'scan-unknown' });
  }
});

async function start() {
  const seeded = seed.seedIfEmpty();
  if (seeded) console.log('[db] seeded fresh database with demo data');
  const status = await fp.init();
  console.log('[fingerprint] mode:', status.mode, '| device:', status.device);

  const url = 'http://localhost:' + cfg.port;
  const noOpen = process.argv.includes('--no-open') || !cfg.openBrowser;

  server.on('error', onFatalListen); // handle "port in use" gracefully

  server.listen(cfg.port, cfg.host, () => {
    console.log('\n  Demo Gym is running.');
    console.log('  Open:  ' + url + '\n');
    if (!noOpen) openBrowser(url);
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(cmd + ' "' + url + '"', () => {});
}

function shutdown() {
  console.log('\nShutting down…');
  try { fp.stop(); } catch (e) {}
  try { db.close(); } catch (e) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
