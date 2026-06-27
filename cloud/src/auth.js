'use strict';
/* Authentication: password hashing, JWT issue/verify, route guards.
   - Owner/staff log in with username + password (bcrypt), receive a JWT.
   - The gym laptop's sync agent authenticates with a shared device token. */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

async function hashPassword(pw) { return bcrypt.hash(String(pw), 10); }
async function verifyPassword(pw, hash) { return bcrypt.compare(String(pw), String(hash || '')); }

function signToken(account) {
  return jwt.sign(
    { sub: account.id, role: account.role, username: account.username },
    secret(),
    { expiresIn: process.env.TOKEN_TTL || '30d' }
  );
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/i);
  return m ? m[1] : null;
}

function authRequired(req, res, next) {
  const t = bearer(req);
  if (!t) return res.status(401).json({ error: 'authentication required' });
  try { req.user = jwt.verify(t, secret()); next(); }
  catch (e) { return res.status(401).json({ error: 'invalid or expired token' }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

function deviceAuth(req, res, next) {
  const expected = process.env.SYNC_DEVICE_TOKEN;
  const t = bearer(req);
  if (!expected || !t || t !== expected) return res.status(401).json({ error: 'device authentication required' });
  next();
}

// Ensure the owner account matches the OWNER_* env vars. OWNER_PASSWORD is the
// source of truth for the owner login: the account is created on first boot, and
// its password is re-synced on every boot so changing the env var (then
// redeploying) reliably resets the login. Trim values to avoid stray whitespace.
async function ensureOwner() {
  const username = (process.env.OWNER_USERNAME || '').trim();
  const password = process.env.OWNER_PASSWORD;
  if (!username || !password) return { created: false, reason: 'OWNER_USERNAME/OWNER_PASSWORD not set' };
  const name = process.env.OWNER_NAME || 'Gym Owner';
  const hash = await hashPassword(password);
  const existing = await db.one('SELECT id FROM accounts WHERE username=$1', [username]);
  if (existing) {
    await db.query('UPDATE accounts SET password_hash=$1, name=$2, role=$3 WHERE id=$4', [hash, name, 'Owner', existing.id]);
    return { created: false, synced: true, reason: 'owner password synced from env' };
  }
  await db.query('INSERT INTO accounts (username, name, role, password_hash) VALUES ($1,$2,$3,$4)', [username, name, 'Owner', hash]);
  return { created: true };
}

async function login(username, password) {
  const acct = await db.one('SELECT * FROM accounts WHERE username=$1', [username]);
  if (!acct) return null;
  const ok = await verifyPassword(password, acct.password_hash);
  if (!ok) return null;
  await db.query('UPDATE accounts SET last_login=$1 WHERE id=$2', [new Date().toISOString(), acct.id]);
  return {
    token: signToken(acct),
    account: { id: acct.id, username: acct.username, name: acct.name, role: acct.role, email: acct.email }
  };
}

module.exports = {
  hashPassword, verifyPassword, signToken,
  authRequired, requireRole, deviceAuth,
  ensureOwner, login
};
