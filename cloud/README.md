# Demo Gym - Cloud API

The cloud half of the gym system: an Express + PostgreSQL service that holds a
copy of the gym's data for **remote analytics and owner controls**, and serves
the owner's PWA dashboard (added in a later phase).

It is deliberately separate from the local laptop app (`../server`), which keeps
running the ZK9500 fingerprint check-in offline. The laptop pushes data **up** to
this service; the owner's controls flow **down** as a command queue. **Biometric
fingerprint templates never leave the laptop** and are not part of this schema.

## What's here (Phase 1)

- PostgreSQL schema mirroring the local model (no biometric BLOBs) - `schema.sql`
- Idempotent migrations run on startup - `src/migrate.js`
- Authentication: bcrypt passwords, JWT, Owner/Receptionist roles - `src/auth.js`
- REST API - `src/routes.js`:
  - Public: `GET /api/health`, `POST /api/auth/login`
  - Authenticated: `GET /api/me`, `GET /api/bootstrap`, `POST/GET /api/commands`
  - Laptop (device token): `POST /api/sync/push`, `GET /api/sync/commands`, `POST /api/sync/commands/:id/ack`
- End-to-end smoke test against in-memory Postgres - `test/smoke.test.js`

## Local development

```bash
cd cloud
cp .env.example .env        # then edit secrets + DATABASE_URL
npm install
npm test                    # runs against in-memory Postgres, no DB needed
npm start                   # needs a real Postgres in DATABASE_URL
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection (Railway injects it) |
| `JWT_SECRET` | yes | Signs login tokens |
| `SYNC_DEVICE_TOKEN` | yes | Shared secret the gym laptop uses to sync |
| `OWNER_USERNAME` / `OWNER_PASSWORD` | yes | First owner login, created on startup |
| `OWNER_NAME` | no | Display name for the owner account |
| `PORT` | no | Set by Railway; defaults to 8080 |
| `PGSSL` | no | `disable` for local dev; production uses SSL |

## Deploy to Railway

1. New Railway project -> Deploy from GitHub repo (`Ha55anAJ/workout-gym-pos`).
2. In the service Settings, set **Root Directory = `cloud`** (this folder).
3. Add a **PostgreSQL** database to the project.
4. In the service Variables, add `JWT_SECRET`, `SYNC_DEVICE_TOKEN`,
   `OWNER_USERNAME`, `OWNER_PASSWORD`, `NODE_ENV=production`, and reference the
   Postgres `DATABASE_URL`. (`PORT` is automatic.)
5. Deploy. Migrations run automatically; the owner account is created on first
   boot. Verify at `https://<your-app>.up.railway.app/api/health`.

## Sync contract (for the laptop agent, Phase 2)

`POST /api/sync/push` with header `Authorization: Bearer <SYNC_DEVICE_TOKEN>` and
a JSON body of raw rows (snake_case), any subset:

```json
{
  "members":  [{ "code": "A001", "name": "...", "type": "Basic", "join_date": "2026-06-01", "suspended": 0 }],
  "payments": [{ "code": "P0001", "date": "2026-06-10", "member_code": "A001", "amount": 5000, "method": "Cash" }],
  "expenses": [{ "code": "E0001", "date": "2026-06-05", "category": "Rent", "amount": 30000 }],
  "staff":    [{ "code": "S01", "name": "...", "role": "Receptionist" }],
  "checkins": [{ "id": 1, "at": "2026-06-10T08:00:00Z", "member_code": "A001" }],
  "settings": { "gym": { "name": "Demo Gym" }, "tiers": { "Basic": 5000 } }
}
```

Members/payments/expenses/staff upsert by `code`; check-ins dedupe by the
laptop's row `id` (stored as `source_id`), so re-pushing is safe.
