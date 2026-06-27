'use strict';
/* PostgreSQL access layer (node-postgres).
   A single pool is created from DATABASE_URL. For tests, an alternate pool
   (e.g. pg-mem) can be injected via init(pool). */
const { Pool } = require('pg');

let pool = null;

function init(injected) {
  if (injected) { pool = injected; return pool; }
  if (pool) return pool;
  const useSsl = process.env.PGSSL !== 'disable' && process.env.NODE_ENV === 'production';
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX) || 5
  });
  return pool;
}

function getPool() {
  if (!pool) throw new Error('db not initialised - call db.init() first');
  return pool;
}

async function query(text, params) { return getPool().query(text, params); }
async function one(text, params) { const r = await query(text, params); return r.rows[0] || null; }
async function many(text, params) { const r = await query(text, params); return r.rows; }

module.exports = { init, getPool, query, one, many };
