'use strict';
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

// When run as a packaged .exe (pkg), the install folder is read-only-ish and
// __dirname points inside the exe snapshot, so keep the database in a writable
// per-user location. In dev, keep everything inside the project folder.
const isPackaged = !!process.pkg;
const dataHome = process.env.DEMOGYM_HOME ||
  (isPackaged ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'Demo Gym') : ROOT);

module.exports = {
  ROOT,
  isPackaged,
  dataHome,
  port: Number(process.env.PORT) || 4317,
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || path.join(dataHome, 'data', 'gym.db'),
  backupDir: process.env.BACKUP_DIR || path.join(dataHome, 'backups'),
  publicDir: path.join(ROOT, 'public'),

  enrollSamples: Number(process.env.ENROLL_SAMPLES) || 3,
  fingerprintMode: process.env.FINGERPRINT_MODE || 'auto',
  zkLibPath: process.env.ZK_LIB_PATH || 'libzkfp',

  openBrowser: process.env.OPEN_BROWSER !== '0'
};
