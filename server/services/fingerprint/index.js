'use strict';
/* ---------------------------------------------------------------------------
   Fingerprint service facade.
   - Picks the real ZK9500 adapter when the SDK + reader are present,
     otherwise a simulation adapter (so the app always runs).
   - Owns enrollment sessions, the 1:N match cache, and a background scan
     loop that emits 'scan' events for the live check-in screen.
   ------------------------------------------------------------------------- */
const EventEmitter = require('events');
const crypto = require('crypto');
const cfg = require('../../config');
const db = require('../../db');
const U = require('../../lib/util');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FingerprintService extends EventEmitter {
  constructor() {
    super();
    this.adapter = null;
    this.mode = 'simulation';
    this.sessions = new Map();
    this.busy = false;     // pause scan loop during enrollment / manual identify
    this.looping = false;
  }

  async init() {
    const want = cfg.fingerprintMode;
    if (want !== 'simulation') {
      try {
        const { createZkAdapter } = require('./zk9500');
        this.adapter = createZkAdapter(cfg.zkLibPath);
        await this.adapter.init();
        this.mode = 'device';
        this._loadCache();
        this._startLoop();
        console.log('[fingerprint] ZK9500 ready — live scanning enabled');
      } catch (e) {
        this.adapter = null;
        if (want === 'device') console.error('[fingerprint] FINGERPRINT_MODE=device but reader unavailable:', e.message);
        else console.log('[fingerprint] no reader/SDK detected — simulation mode (' + e.message + ')');
      }
    }
    if (!this.adapter) {
      const { createMockAdapter } = require('./mock');
      this.adapter = createMockAdapter();
      await this.adapter.init();
      this.mode = 'simulation';
    }
    return this.status();
  }

  status() {
    return { mode: this.mode, device: this.adapter ? this.adapter.name : 'none', samplesRequired: cfg.enrollSamples };
  }

  _policy() {
    try { return JSON.parse(db.prepare("SELECT value v FROM settings WHERE key='policy'").get().v); }
    catch (e) { return { cycleDays: 30, dueSoonDays: 5 }; }
  }
  _memberById(id) { return db.prepare('SELECT * FROM members WHERE id=?').get(id); }
  _loadCache() {
    const rows = db.prepare('SELECT member_id, template FROM fingerprints').all();
    this.adapter.cacheLoad(rows.map((r) => ({ fid: r.member_id, template: r.template })));
    console.log('[fingerprint] loaded ' + rows.length + ' enrolled template(s) into match cache');
  }

  async _startLoop() {
    if (this.mode !== 'device' || this.looping) return;
    this.looping = true;
    while (this.looping) {
      if (this.busy) { await sleep(200); continue; }
      let tmpl = null;
      try { tmpl = await this.adapter.capture(800); } catch (e) { await sleep(500); continue; }
      if (!tmpl) { await sleep(80); continue; }
      const hit = this.adapter.identify(tmpl);
      if (hit) { const m = this._memberById(hit.fid); if (m) this.emit('scan', { member: m, score: hit.score }); }
      else this.emit('scan', { none: true });
      await sleep(1500); // debounce so one touch = one event
    }
  }

  // ---- enrollment ----
  startEnroll() {
    const sessionId = crypto.randomBytes(8).toString('hex');
    this.sessions.set(sessionId, { templates: [], required: cfg.enrollSamples, ts: Date.now() });
    return { sessionId, required: cfg.enrollSamples };
  }
  async captureSample(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('enrollment session not found');
    this.busy = true;
    try {
      const tmpl = await this.adapter.capture(this.mode === 'device' ? 10000 : 150);
      if (!tmpl) return { captured: false, timeout: true, sample: s.templates.length, total: s.required };
      s.templates.push(tmpl);
      return { captured: true, sample: s.templates.length, total: s.required, done: s.templates.length >= s.required };
    } finally { this.busy = false; }
  }
  cancelEnroll(sessionId) { this.sessions.delete(sessionId); }
  commitEnroll(sessionId, memberCode) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('enrollment session not found');
    if (s.templates.length < s.required) throw new Error('need ' + s.required + ' samples, have ' + s.templates.length);
    const m = db.prepare('SELECT * FROM members WHERE code=?').get(memberCode);
    if (!m) throw new Error('member not found');
    const reg = this.adapter.merge(s.templates.slice(0, s.required));
    const now = U.fmtDate(new Date());
    db.prepare('INSERT OR REPLACE INTO fingerprints(member_id,template,samples,enrolled_at) VALUES (?,?,?,?)').run(m.id, reg, s.required, now);
    db.prepare('UPDATE members SET fingerprint=1, fp_samples=?, fp_enrolled_at=? WHERE id=?').run(s.required, now, m.id);
    try { this.adapter.cacheAdd(m.id, reg); } catch (e) {}
    this.sessions.delete(sessionId);
    return { ok: true, samples: s.required, enrolledAt: now };
  }

  // ---- manual identify (device mode) ----
  async identify(timeoutMs) {
    if (this.mode !== 'device') return { none: true, mode: this.mode };
    this.busy = true;
    try {
      const tmpl = await this.adapter.capture(timeoutMs || 12000);
      if (!tmpl) return { none: true, timeout: true };
      const hit = this.adapter.identify(tmpl);
      if (!hit) return { none: true };
      return { member: this._memberById(hit.fid), score: hit.score };
    } finally { this.busy = false; }
  }

  // ---- demo simulate (works in any mode) ----
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

  stop() { this.looping = false; if (this.adapter && this.adapter.close) { try { this.adapter.close(); } catch (e) {} } }
}

module.exports = new FingerprintService();
