'use strict';
/* Isolated fingerprint worker. ALL native ZK9500/koffi calls happen here, in a
   separate process. If the reader/native code crashes, only this process dies —
   the main app keeps running. Commands arrive over IPC; results go back as base64. */
const cfg = require('../../config');
const fs = require('fs');
const path = require('path');
function log(m) { try { fs.appendFileSync(path.join(cfg.dataHome, 'fingerprint.log'), '[' + new Date().toISOString() + '] ' + m + '\n'); } catch (e) {} }

let adapter = null;
const FAKE = process.env.FP_FAKE_DEVICE === '1';   // test-only fake reader

function makeFake() {
  const crypto = require('crypto');
  let firstCapture = true;
  return {
    name: 'Fake device (test)',
    async init() { return { ok: true }; },
    async capture() {
      if (process.env.FP_TEST_CRASH === '1' && firstCapture) { firstCapture = false; log('TEST: simulating native crash'); process.exit(134); }
      return crypto.randomBytes(256);
    },
    merge(t) { return Buffer.concat(t).subarray(0, 512); },
    identify() { return null; },
    cacheLoad() {}, cacheAdd() {}
  };
}

(async () => {
  try {
    adapter = FAKE ? makeFake() : require('./zk9500').createZkAdapter(cfg.zkLibPath);
    await adapter.init();
    log('reader init ok' + (FAKE ? ' (fake)' : ''));
    if (process.send) process.send({ type: 'ready' });
  } catch (e) {
    log('reader init failed: ' + e.message);
    if (process.send) process.send({ type: 'fatal', error: e.message });
    process.exit(2);
  }

  process.on('message', async (msg) => {
    const { id, cmd, args } = msg || {};
    try {
      let result = null;
      if (cmd === 'identify') { const t = await adapter.capture((args && args.timeoutMs) || 800); result = t ? (adapter.identify(t) || null) : null; }
      else if (cmd === 'capture') { const t = await adapter.capture((args && args.timeoutMs) || 10000); result = t ? Buffer.from(t).toString('base64') : null; }
      else if (cmd === 'merge') { const reg = adapter.merge(args.templates.map((b) => Buffer.from(b, 'base64'))); result = Buffer.from(reg).toString('base64'); }
      else if (cmd === 'cacheLoad') { adapter.cacheLoad((args.rows || []).map((r) => ({ fid: r.fid, template: Buffer.from(r.template, 'base64') }))); }
      else if (cmd === 'cacheAdd') { adapter.cacheAdd(args.fid, Buffer.from(args.template, 'base64')); }
      if (process.send) process.send({ id, ok: true, result });
    } catch (e) {
      log('cmd ' + cmd + ' error: ' + e.message);
      if (process.send) process.send({ id, ok: false, error: e.message });
    }
  });
})();
