'use strict';
/* Fingerprint service facade.
   - Simulation mode: in-process mock (no native code). Used when no reader/SDK.
   - Device mode: spawns an isolated worker process for ALL ZK9500 access. If the
     worker crashes, the main app survives — operations just fail gracefully.
   The public API is unchanged so routes/server need no changes. */
const EventEmitter = require('events');
const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const cfg = require('../../config');
const db = require('../../db');
const U = require('../../lib/util');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STAFF_FID = 2000000; // staff template ids are offset so they never collide with member ids

class FingerprintService extends EventEmitter {
  constructor() {
    super();
    this.mode = 'simulation';
    this.deviceName = 'none';
    this.adapter = null;        // mock adapter (simulation)
    this.sessions = new Map();
    this.busy = false;
    this.looping = false;
    this.deviceDown = false;
    this.worker = null;
    this._queue = []; this._inflight = null; this._seq = 0; this._crashes = 0;
  }

  /* ---------- lifecycle ---------- */
  async init() {
    const want = cfg.fingerprintMode;
    if (want !== 'simulation') {
      try {
        const ok = await this._startWorker();
        if (!ok) throw new Error('reader not ready');
        this.mode = 'device';
        this.deviceName = 'ZKTeco ZK9500';
        await this._loadCache();
        this._loop();
        console.log('[fingerprint] ZK9500 ready (isolated worker)');
      } catch (e) {
        this._killWorker();
        if (want === 'device') console.error('[fingerprint] device required but unavailable:', e.message);
        else console.log('[fingerprint] no reader/SDK detected — simulation mode (' + e.message + ')');
        this.mode = 'simulation';
      }
    }
    if (this.mode !== 'device') {
      const { createMockAdapter } = require('./mock');
      this.adapter = createMockAdapter();
      await this.adapter.init();
      this.mode = 'simulation';
      this.deviceName = this.adapter.name;
    }
    return this.status();
  }
  status() { return { mode: this.mode, device: this.deviceName, samplesRequired: cfg.enrollSamples }; }
  stop() { this.looping = false; this._killWorker(); }

  /* ---------- isolated worker plumbing ---------- */
  _startWorker() {
    return new Promise((resolve) => {
      this._queue = []; this._inflight = null; this._seq = 0; this.deviceDown = false;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        this.worker = fork(path.join(__dirname, 'worker.js'), [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
      } catch (e) { return done(false); }
      this.worker.on('message', (m) => {
        if (m && m.type === 'ready') return done(true);
        if (m && m.type === 'fatal') return done(false);
        if (m && m.id != null && this._inflight && m.id === this._inflight.id) {
          clearTimeout(this._inflight.timer); const job = this._inflight; this._inflight = null;
          m.ok ? job.resolve(m.result) : job.reject(new Error(m.error || 'reader error'));
          this._pump();
        }
      });
      this.worker.on('error', () => {});
      this.worker.on('exit', (code) => this._onWorkerExit(code));
      setTimeout(() => done(false), 8000); // init timeout
    });
  }
  _killWorker() { if (this.worker) { try { this.worker.removeAllListeners(); this.worker.kill(); } catch (e) {} this.worker = null; } }
  _onWorkerExit(code) {
    // a crash: reject everything in flight, keep the app alive
    if (this._inflight) { clearTimeout(this._inflight.timer); this._inflight.reject(new Error('reader stopped')); this._inflight = null; }
    while (this._queue.length) this._queue.shift().reject(new Error('reader stopped'));
    this.worker = null;
    this._crashes++;
    if (this.mode === 'device' && this._crashes <= 3) {
      console.error('[fingerprint] reader process exited (' + code + ') — restarting it; app unaffected');
      setTimeout(() => { this._startWorker().then((ok) => { if (ok) this._loadCache().catch(() => {}); }); }, 1200);
    } else if (this.mode === 'device') {
      this.deviceDown = true;
      console.error('[fingerprint] reader keeps failing — live scanning disabled, app continues normally');
    }
  }
  _call(cmd, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.mode !== 'device' || this.deviceDown || !this.worker) return reject(new Error('reader unavailable'));
      this._queue.push({ cmd, args, timeoutMs, resolve, reject }); this._pump();
    });
  }
  _pump() {
    if (this._inflight || !this._queue.length || !this.worker) return;
    const job = this._queue.shift(); job.id = ++this._seq; this._inflight = job;
    job.timer = setTimeout(() => { if (this._inflight === job) { this._inflight = null; job.reject(new Error('reader timeout')); this._pump(); } }, job.timeoutMs || 12000);
    try { this.worker.send({ id: job.id, cmd: job.cmd, args: job.args }); }
    catch (e) { clearTimeout(job.timer); this._inflight = null; job.reject(e); }
  }

  /* ---------- helpers ---------- */
  _policy() { try { return JSON.parse(db.prepare("SELECT value v FROM settings WHERE key='policy'").get().v); } catch (e) { return { cycleDays: 30, dueSoonDays: 5 }; } }
  _memberById(id) { return db.prepare('SELECT * FROM members WHERE id=?').get(id); }
  _staffById(id) { return db.prepare('SELECT * FROM staff WHERE id=?').get(id); }
  _resolve(fid) {
    if (fid >= STAFF_FID) { const s = this._staffById(fid - STAFF_FID); return s ? { staff: s } : null; }
    const m = this._memberById(fid); return m ? { member: m } : null;
  }
  async _loadCache() {
    if (this.mode !== 'device') return;
    const rows = [
      ...db.prepare('SELECT member_id, template FROM fingerprints').all().map((r) => ({ fid: r.member_id, template: Buffer.from(r.template).toString('base64') })),
      ...db.prepare('SELECT staff_id, template FROM staff_fingerprints').all().map((r) => ({ fid: STAFF_FID + r.staff_id, template: Buffer.from(r.template).toString('base64') }))
    ];
    try { await this._call('cacheLoad', { rows }, 8000); } catch (e) {}
  }
  async _loop() {
    if (this.mode !== 'device' || this.looping) return;
    this.looping = true;
    while (this.looping) {
      if (this.busy || this.deviceDown || !this.worker) { await sleep(250); continue; }
      let hit = null;
      try { hit = await this._call('identify', { timeoutMs: 1000 }, 3000); }
      catch (e) { await sleep(400); continue; }
      if (hit) { const r = this._resolve(hit.fid); if (r) this.emit('scan', Object.assign({ score: hit.score }, r)); await sleep(1500); }
      else await sleep(60);
    }
  }

  /* ---------- enrollment ---------- */
  startEnroll() { const sessionId = crypto.randomBytes(8).toString('hex'); this.sessions.set(sessionId, { templates: [], required: cfg.enrollSamples }); return { sessionId, required: cfg.enrollSamples }; }
  cancelEnroll(sessionId) { this.sessions.delete(sessionId); }
  async captureSample(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('enrollment session not found');
    this.busy = true;
    try {
      let tmpl = null;
      if (this.mode === 'device') { const b64 = await this._call('capture', { timeoutMs: 10000 }, 13000); tmpl = b64 ? Buffer.from(b64, 'base64') : null; }
      else { const t = await this.adapter.capture(150); tmpl = t ? Buffer.from(t) : null; }
      if (!tmpl) return { captured: false, timeout: true, sample: s.templates.length, total: s.required };
      s.templates.push(tmpl);
      return { captured: true, sample: s.templates.length, total: s.required, done: s.templates.length >= s.required };
    } finally { this.busy = false; }
  }
  async commitEnroll(sessionId, kind, code) {
    if (code === undefined) { code = kind; kind = 'member'; }   // back-compat: (sessionId, memberCode)
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('enrollment session not found');
    if (s.templates.length < s.required) throw new Error('need ' + s.required + ' samples, have ' + s.templates.length);
    let reg;
    if (this.mode === 'device') { const b64 = await this._call('merge', { templates: s.templates.map((t) => Buffer.from(t).toString('base64')) }, 12000); reg = Buffer.from(b64, 'base64'); }
    else { reg = Buffer.from(this.adapter.merge(s.templates)); }
    const now = U.fmtDate(new Date());
    if (kind === 'staff') {
      const st = db.prepare('SELECT * FROM staff WHERE code=?').get(code);
      if (!st) throw new Error('staff not found');
      db.prepare('INSERT OR REPLACE INTO staff_fingerprints(staff_id,template,samples,enrolled_at) VALUES (?,?,?,?)').run(st.id, reg, s.required, now);
      db.prepare('UPDATE staff SET fingerprint=1, fp_samples=?, fp_enrolled_at=? WHERE id=?').run(s.required, now, st.id);
      if (this.mode === 'device') { try { await this._call('cacheAdd', { fid: STAFF_FID + st.id, template: reg.toString('base64') }, 8000); } catch (e) {} }
    } else {
      const m = db.prepare('SELECT * FROM members WHERE code=?').get(code);
      if (!m) throw new Error('member not found');
      db.prepare('INSERT OR REPLACE INTO fingerprints(member_id,template,samples,enrolled_at) VALUES (?,?,?,?)').run(m.id, reg, s.required, now);
      db.prepare('UPDATE members SET fingerprint=1, fp_samples=?, fp_enrolled_at=? WHERE id=?').run(s.required, now, m.id);
      if (this.mode === 'device') { try { await this._call('cacheAdd', { fid: m.id, template: reg.toString('base64') }, 8000); } catch (e) {} }
    }
    this.sessions.delete(sessionId);
    return { ok: true, samples: s.required, enrolledAt: now, kind: kind };
  }

  /* ---------- identify / simulate ---------- */
  async identify(timeoutMs) {
    if (this.mode !== 'device') return { none: true, mode: this.mode };
    this.busy = true;
    try { const hit = await this._call('identify', { timeoutMs: timeoutMs || 12000 }, (timeoutMs || 12000) + 2000); if (!hit) return { none: true }; const r = this._resolve(hit.fid); return r ? Object.assign({ score: hit.score }, r) : { none: true }; }
    catch (e) { return { none: true, error: e.message }; }
    finally { this.busy = false; }
  }
  simulate(kind) {
    const policy = this._policy();
    const rows = db.prepare('SELECT * FROM members WHERE fingerprint=1').all();
    const withStatus = rows.map((m) => ({ m, st: U.statusOf(m, policy) }));
    let pool;
    if (kind === 'paid') pool = withStatus.filter((x) => x.st === 'Paid');
    else if (kind === 'overdue') pool = withStatus.filter((x) => x.st === 'Overdue');
    else return { none: true };
    if (!pool.length) pool = withStatus;
    if (!pool.length) return { none: true };
    return { member: pool[Math.floor(Math.random() * pool.length)].m };
  }
}

module.exports = new FingerprintService();
