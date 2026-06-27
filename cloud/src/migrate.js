'use strict';
/* Idempotent schema migration. Reads schema.sql and runs each statement.
   "already exists" errors are ignored so re-running on every deploy is safe. */
const fs = require('fs');
const path = require('path');
const db = require('./db');

function statements() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run() {
  for (const stmt of statements()) {
    try {
      await db.query(stmt);
    } catch (e) {
      if (!/already exists|duplicate/i.test(e.message || '')) throw e;
    }
  }
  return { ok: true };
}

module.exports = { run, statements };
