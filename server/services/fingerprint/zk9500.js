'use strict';
/* ZKTeco ZK9500 via the ZKFinger SDK (libzkfp) using koffi.
   SDK bindings copied verbatim from the known-working reference
   (lib/fingerprint.js): _Inout_/_Out_ markers, DBAdd = (db, fid, template, length),
   DBIdentify for 1:N match. */
const fs = require('fs');
const path = require('path');
const cfg = require('../../config');
function log(m) { try { fs.appendFileSync(path.join(cfg.dataHome, 'fingerprint.log'), '[' + new Date().toISOString() + '] zk: ' + m + '\n'); } catch (e) {} }

const MATCH_THRESHOLD = Number(process.env.FP_MATCH_THRESHOLD) || 60;

function createZkAdapter(libPath) {
  const koffi = require('koffi');
  const candidates = [libPath, 'libzkfp.dll', 'libzkfp',
    'C:\\Program Files\\ZKFinger SDK\\libzkfp.dll',
    'C:\\Program Files (x86)\\ZKFinger SDK\\libzkfp.dll',
    'C:\\Windows\\System32\\libzkfp.dll'].filter(Boolean);
  let dll = null, lastErr = null;
  for (const p of candidates) { try { dll = koffi.load(p); log('loaded SDK: ' + p); break; } catch (e) { lastErr = e; } }
  if (!dll) throw new Error('libzkfp.dll not found (' + (lastErr && lastErr.message) + ')');

  const ZKFPM_Init = dll.func('int ZKFPM_Init()');
  const ZKFPM_Terminate = dll.func('int ZKFPM_Terminate()');
  const ZKFPM_GetDeviceCount = dll.func('int ZKFPM_GetDeviceCount()');
  const ZKFPM_OpenDevice = dll.func('void* ZKFPM_OpenDevice(int)');
  const ZKFPM_CloseDevice = dll.func('int ZKFPM_CloseDevice(void*)');
  const ZKFPM_AcquireFingerprint = dll.func('int ZKFPM_AcquireFingerprint(void*, _Inout_ uint8_t*, uint32_t, _Inout_ uint8_t*, _Inout_ uint32_t*)');
  const ZKFPM_DBInit = dll.func('void* ZKFPM_DBInit()');
  const ZKFPM_DBFree = dll.func('int ZKFPM_DBFree(void*)');
  const ZKFPM_DBAdd = dll.func('int ZKFPM_DBAdd(void*, uint32_t, uint8_t*, uint32_t)');
  const ZKFPM_DBDel = dll.func('int ZKFPM_DBDel(void*, uint32_t)');
  const ZKFPM_DBClear = dll.func('int ZKFPM_DBClear(void*)');
  const ZKFPM_DBIdentify = dll.func('int ZKFPM_DBIdentify(void*, uint8_t*, uint32_t, _Out_ uint32_t*, _Out_ uint32_t*)');
  const ZKFPM_DBMerge = dll.func('int ZKFPM_DBMerge(void*, uint8_t*, uint8_t*, uint8_t*, _Inout_ uint8_t*, _Inout_ uint32_t*)');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let device = null, db = null;
  const imgBuf = Buffer.alloc(300 * 400);   // ZK9500 sensor is 256x360; headroom
  const tplBuf = Buffer.alloc(4096);

  return {
    name: 'ZKTeco ZK9500', device: true,
    async init() {
      const ir = ZKFPM_Init(); log('ZKFPM_Init=' + ir);
      if (ir !== 0) throw new Error('ZKFPM_Init failed (' + ir + ')');
      const cnt = ZKFPM_GetDeviceCount(); log('device count=' + cnt);
      if (cnt < 1) { ZKFPM_Terminate(); throw new Error('no fingerprint reader detected'); }
      device = ZKFPM_OpenDevice(0); if (!device) { ZKFPM_Terminate(); throw new Error('ZKFPM_OpenDevice failed'); }
      db = ZKFPM_DBInit(); if (!db) throw new Error('ZKFPM_DBInit failed');
      log('init complete (match threshold ' + MATCH_THRESHOLD + ')');
      return { ok: true };
    },
    async capture(timeoutMs) {
      timeoutMs = timeoutMs || 8000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const tplLen = [tplBuf.length];
        const ret = ZKFPM_AcquireFingerprint(device, imgBuf, imgBuf.length, tplBuf, tplLen);
        if (ret === 0) return Buffer.from(tplBuf.subarray(0, tplLen[0]));
        await sleep(180);
      }
      return null;
    },
    merge(t) {
      const regBuf = Buffer.alloc(4096), regLen = [regBuf.length];
      const r = ZKFPM_DBMerge(db, t[0], t[1], t[2], regBuf, regLen);
      log('DBMerge=' + r);
      if (r !== 0) throw new Error('ZKFPM_DBMerge failed (' + r + ')');
      return Buffer.from(regBuf.subarray(0, regLen[0]));
    },
    cacheLoad(rows) {
      try { ZKFPM_DBClear(db); } catch (e) {}
      let n = 0;
      for (const row of rows) { try { const buf = Buffer.from(row.template); ZKFPM_DBAdd(db, row.fid, buf, buf.length); n++; } catch (e) { log('DBAdd err ' + e.message); } }
      log('loaded ' + n + ' template(s) into SDK DB');
    },
    cacheAdd(fid, template) { const buf = Buffer.from(template); try { ZKFPM_DBDel(db, fid); } catch (e) {} ZKFPM_DBAdd(db, fid, buf, buf.length); log('DBAdd fid=' + fid + ' ok'); },
    cacheDel(fid) { try { ZKFPM_DBDel(db, fid); } catch (e) {} },
    cacheClear() { try { ZKFPM_DBClear(db); } catch (e) {} },
    identify(captured) {
      const fid = [0], score = [0];
      const r = ZKFPM_DBIdentify(db, captured, captured.length, fid, score);
      log('DBIdentify r=' + r + ' fid=' + fid[0] + ' score=' + score[0] + ' (need >=' + MATCH_THRESHOLD + ')');
      if (r === 0 && score[0] >= MATCH_THRESHOLD && fid[0] > 0) return { fid: fid[0], score: score[0] };
      return null;
    },
    close() { try { if (db) ZKFPM_DBFree(db); } catch (e) {} try { if (device) ZKFPM_CloseDevice(device); } catch (e) {} try { ZKFPM_Terminate(); } catch (e) {} device = db = null; }
  };
}
module.exports = { createZkAdapter };
