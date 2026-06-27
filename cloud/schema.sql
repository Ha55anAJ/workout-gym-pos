-- Demo Gym - Cloud (PostgreSQL) schema.
-- Mirrors the local SQLite model, MINUS biometric fingerprint templates,
-- which never leave the gym laptop. 'code' is the business key used for sync.

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Receptionist',
  email TEXT,
  password_hash TEXT NOT NULL,
  last_login TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  type TEXT NOT NULL DEFAULT 'Basic',
  join_date TEXT NOT NULL,
  last_payment TEXT,
  suspended INTEGER NOT NULL DEFAULT 0,
  fingerprint INTEGER NOT NULL DEFAULT 0,
  fp_samples INTEGER NOT NULL DEFAULT 0,
  fp_enrolled_at TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  member_id INTEGER,
  member_code TEXT,
  member_name TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  month TEXT,
  method TEXT,
  notes TEXT,
  recorded_by TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Receptionist',
  phone TEXT,
  salary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  join_date TEXT,
  fingerprint INTEGER NOT NULL DEFAULT 0,
  fp_samples INTEGER NOT NULL DEFAULT 0,
  fp_enrolled_at TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  source_id INTEGER UNIQUE,
  at TEXT NOT NULL,
  member_id INTEGER,
  member_code TEXT,
  member_name TEXT
);

CREATE TABLE IF NOT EXISTS staff_checkins (
  id SERIAL PRIMARY KEY,
  source_id INTEGER UNIQUE,
  at TEXT NOT NULL,
  staff_id INTEGER,
  staff_code TEXT,
  staff_name TEXT
);

CREATE TABLE IF NOT EXISTS commands (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMP,
  result TEXT
);

CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_checkins_at ON checkins(at);
CREATE INDEX idx_commands_status ON commands(status);
