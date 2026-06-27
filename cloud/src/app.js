'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { buildRouter } = require('./routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);   // behind Railway's edge proxy: trust 1 hop so rate-limiting sees real client IPs

  // Everything is self-hosted now, so the CSP stays tight: only 'self' + inline
  // scripts/styles (the SPA uses one inline <script> and an inline <style>).
  // COEP off and CORP cross-origin so the service worker + manifest load cleanly.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors());                       // PWA + laptop call this from other origins
  app.use(express.json({ limit: '5mb' }));

  // API first so it always wins over static / SPA fallback.
  app.use('/api', buildRouter());

  // Serve the PWA app shell + assets (index.html, manifest.json, sw.js, icons).
  app.use(express.static(PUBLIC_DIR, { index: false, extensions: false }));

  // SPA fallback: non-/api GET requests that didn't match a static file get the shell.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => { if (err) next(err); });
  });

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}

module.exports = { createApp };
