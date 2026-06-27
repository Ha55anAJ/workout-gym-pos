'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { buildRouter } = require('./routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());                       // PWA + laptop call this from other origins
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', buildRouter());

  app.get('/', (req, res) => res.type('html').send(LANDING));
  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}

const LANDING = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo Gym - Cloud API</title>
<style>body{font-family:system-ui,sans-serif;max-width:540px;margin:12vh auto;padding:0 20px;color:#222}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px}a{color:#2563eb}</style></head>
<body><h1>Demo Gym - Cloud API</h1>
<p>The API is running. Health check: <a href="/api/health">/api/health</a></p>
<p>This server provides analytics and remote controls for the gym owner and
receives a one-way sync from the gym laptop. The owner dashboard (PWA) is added
in a later phase.</p></body></html>`;

module.exports = { createApp };
