'use strict';
/* Simulation adapter — used when no ZK9500 / SDK is present (e.g. a dev laptop).
   It lets the whole app run and demo. It cannot match real fingers, so live
   identification is driven by the "Simulate scan" buttons instead. */
const crypto = require('crypto');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createMockAdapter() {
  return {
    name: 'Simulation (no scanner connected)',
    device: false,
    async init() { return { ok: true }; },
    async capture(/* timeoutMs */) {
      await sleep(120);                 // feel like a real read
      return crypto.randomBytes(256);   // dummy template
    },
    merge(templates) { return Buffer.concat(templates).subarray(0, 512); },
    cacheLoad() {}, cacheAdd() {}, cacheClear() {}, cacheDel() {},
    identify() { return null; },        // cannot match real fingers in simulation
    close() {}
  };
}

module.exports = { createMockAdapter };
