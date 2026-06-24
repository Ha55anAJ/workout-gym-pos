'use strict';
/* ---------------------------------------------------------------------------
   ZKTeco ZK9500 adapter using the ZKFinger SDK (libzkfp) via koffi FFI.

   The ZK9500 (and the SLK20R family) are USB desktop readers driven by the
   ZKFinger Reader SDK. This module binds the documented libzkfp C API:

     ZKFPM_Init / ZKFPM_Terminate
     ZKFPM_GetDeviceCount / ZKFPM_OpenDevice / ZKFPM_CloseDevice
     ZKFPM_GetParameters                 (image width/height)
     ZKFPM_AcquireFingerprint            (grab image + ISO/ANSI template)
     ZKFPM_DBInit / ZKFPM_DBFree         (in-memory 1:N match cache)
     ZKFPM_DBMerge                       (merge 3 enrolment samples -> 1 template)
     ZKFPM_DBAdd / ZKFPM_DBDel / ZKFPM_DBClear
     ZKFPM_DBIdentify                    (1:N search)

   Requirements on the Windows machine:
     1. Install the ZK9500 USB driver.
     2. Install the "ZKFinger SDK" so that libzkfp.dll (+ its dependencies,
        e.g. libzkfpcsharp / ZKFinger10.dll) are on PATH, or set ZK_LIB_PATH.

   If anything is missing this module throws on init() and the service falls
   back to simulation mode — the rest of the app keeps working.
   ------------------------------------------------------------------------- */

const TEMPLATE_MAX = 2048;

function createZkAdapter(libPath) {
  const koffi = require('koffi'); // optionalDependency — may be absent

  // Try a few common names so a bare "libzkfp" works on Windows.
  const candidates = [libPath, 'libzkfp', 'libzkfp.dll', 'ZKFinger', 'ZKFinger.dll'].filter(Boolean);
  let lib = null, lastErr = null;
  for (const name of candidates) {
    try { lib = koffi.load(name); break; } catch (e) { lastErr = e; }
  }
  if (!lib) throw new Error('could not load ZKFinger SDK (' + (lastErr && lastErr.message) + ')');

  const f = (sig) => lib.func(sig);
  const ZKFPM_Init               = f('int ZKFPM_Init()');
  const ZKFPM_Terminate          = f('int ZKFPM_Terminate()');
  const ZKFPM_GetDeviceCount     = f('int ZKFPM_GetDeviceCount()');
  const ZKFPM_OpenDevice         = f('void* ZKFPM_OpenDevice(int index)');
  const ZKFPM_CloseDevice        = f('int ZKFPM_CloseDevice(void* h)');
  const ZKFPM_GetParameters      = f('int ZKFPM_GetParameters(void* h, int code, _Out_ uint8_t* value, _Inout_ uint32_t* size)');
  const ZKFPM_AcquireFingerprint = f('int ZKFPM_AcquireFingerprint(void* h, _Out_ uint8_t* img, uint32_t cbImg, _Out_ uint8_t* tmpl, _Inout_ uint32_t* cbTmpl)');
  const ZKFPM_DBInit             = f('void* ZKFPM_DBInit()');
  const ZKFPM_DBFree             = f('int ZKFPM_DBFree(void* cache)');
  const ZKFPM_DBMerge            = f('int ZKFPM_DBMerge(void* cache, uint8_t* t1, uint8_t* t2, uint8_t* t3, _Out_ uint8_t* reg, _Inout_ uint32_t* cbReg)');
  const ZKFPM_DBAdd              = f('int ZKFPM_DBAdd(void* cache, uint32_t fid, uint32_t cbTmpl, uint8_t* tmpl)');
  const ZKFPM_DBDel              = f('int ZKFPM_DBDel(void* cache, uint32_t fid)');
  const ZKFPM_DBClear            = f('int ZKFPM_DBClear(void* cache)');
  const ZKFPM_DBIdentify         = f('int ZKFPM_DBIdentify(void* cache, uint8_t* tmpl, uint32_t cbTmpl, _Out_ uint32_t* fid, _Out_ uint32_t* score)');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let dev = null;       // device handle
  let cache = null;     // match-cache handle
  let imgBuf = null;    // image scratch buffer

  function getParamInt(code) {
    const buf = Buffer.alloc(4);
    const size = [4];
    const r = ZKFPM_GetParameters(dev, code, buf, size);
    return r === 0 ? buf.readUInt32LE(0) : 0;
  }

  return {
    name: 'ZKTeco ZK9500',
    device: true,

    async init() {
      if (ZKFPM_Init() !== 0) throw new Error('ZKFPM_Init failed');
      if (ZKFPM_GetDeviceCount() <= 0) { ZKFPM_Terminate(); throw new Error('no fingerprint reader detected'); }
      dev = ZKFPM_OpenDevice(0);
      if (!dev) { ZKFPM_Terminate(); throw new Error('ZKFPM_OpenDevice failed'); }
      const w = getParamInt(1), h = getParamInt(2);          // 1=width, 2=height
      imgBuf = Buffer.alloc((w * h) || 300000);
      cache = ZKFPM_DBInit();
      if (!cache) throw new Error('ZKFPM_DBInit failed');
      return { ok: true, width: w, height: h };
    },

    // Poll the reader until a finger is captured or the timeout elapses.
    async capture(timeoutMs) {
      timeoutMs = timeoutMs || 8000;
      const tmpl = Buffer.alloc(TEMPLATE_MAX);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const len = [TEMPLATE_MAX];
        const ret = ZKFPM_AcquireFingerprint(dev, imgBuf, imgBuf.length, tmpl, len);
        if (ret === 0 && len[0] > 0) return Buffer.from(tmpl.subarray(0, len[0]));
        await sleep(180); // let the event loop breathe between polls
      }
      return null; // no finger
    },

    // Merge three enrolment samples into one registration template.
    merge(templates) {
      const reg = Buffer.alloc(TEMPLATE_MAX);
      const len = [TEMPLATE_MAX];
      const ret = ZKFPM_DBMerge(cache, templates[0], templates[1], templates[2], reg, len);
      if (ret !== 0) throw new Error('ZKFPM_DBMerge failed (' + ret + ')');
      return Buffer.from(reg.subarray(0, len[0]));
    },

    cacheLoad(rows) {
      try { ZKFPM_DBClear(cache); } catch (e) {}
      for (const r of rows) {
        try { ZKFPM_DBAdd(cache, r.fid, r.template.length, r.template); } catch (e) {}
      }
    },
    cacheAdd(fid, template) { ZKFPM_DBAdd(cache, fid, template.length, template); },
    cacheDel(fid) { try { ZKFPM_DBDel(cache, fid); } catch (e) {} },
    cacheClear() { try { ZKFPM_DBClear(cache); } catch (e) {} },

    // 1:N search of a captured template against the cache.
    identify(template) {
      const fid = [0], score = [0];
      const ret = ZKFPM_DBIdentify(cache, template, template.length, fid, score);
      if (ret === 0 && fid[0] > 0) return { fid: fid[0], score: score[0] };
      return null;
    },

    close() {
      try { if (cache) ZKFPM_DBFree(cache); } catch (e) {}
      try { if (dev) ZKFPM_CloseDevice(dev); } catch (e) {}
      try { ZKFPM_Terminate(); } catch (e) {}
      dev = cache = imgBuf = null;
    }
  };
}

module.exports = { createZkAdapter };
