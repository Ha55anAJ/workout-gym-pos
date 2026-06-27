'use strict';
/* Cloud entry point: connect to Postgres, run migrations, ensure the owner
   account exists, then start the HTTP server. */
require('dotenv').config();
const db = require('./src/db');
const migrate = require('./src/migrate');
const auth = require('./src/auth');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 8080;

async function main() {
  db.init();
  await migrate.run();
  console.log('[cloud] migrations applied');

  try {
    const seed = await auth.ensureOwner();
    console.log('[cloud] owner account:', seed.created ? 'created (' + process.env.OWNER_USERNAME + ')' : seed.reason);
  } catch (e) {
    console.error('[cloud] owner seed skipped:', e.message);
  }

  const app = createApp();
  app.listen(PORT, () => console.log('[cloud] listening on :' + PORT));
}

main().catch((e) => { console.error('[cloud] fatal:', e); process.exit(1); });
