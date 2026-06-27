# Demo Gym — Management System

A local, offline-first gym management app for a single location. It runs on the
gym's Windows laptop as a small web server (Node.js + SQLite) that you open in a
browser, and it talks to a **ZKTeco ZK9500** USB fingerprint reader for check-in
and member enrollment.

The interface is identical to the approved HTML demo — Dashboard, Scan, Members,
Payments, Expenses, Reports, Staff, Settings — but every screen is now backed by
a real database and real APIs, so data persists and is shared across the app.

---

## What works

- **Members** — full list with live search/filter, add, edit, suspend/re-activate, member detail with payment history and a 30-day attendance heatmap.
- **Registration with fingerprint enrollment** — new members are enrolled by capturing **3 fingerprint samples** on the ZK9500; the samples are merged into one template and stored. Existing members can be (re-)enrolled from their detail screen.
- **Scan (check-in)** — with a ZK9500 connected, placing a finger identifies the member automatically (1:N search) and records attendance in real time. Without a reader the screen runs in **simulation mode** with the demo buttons.
- **Payments** — record payments (cash/card/Easypaisa/JazzCash), printable A6 receipts, filters, "collected today".
- **Expenses** — categorised expense tracking with monthly/YTD summaries (Owner only).
- **Reports** — 10 reports (attendance, daily collection, monthly revenue, expenses by category, P&L, lapsed members, retention cohorts, top members by visits/spend, year-end summary), Owner only.
- **Staff & Users** — staff roster with salary history; system users.
- **Roles** — switch between **Owner** (everything) and **Receptionist** (Dashboard, Scan, Members, Payments only).
- **Local backup & restore** — one-click backup saves the entire database as a single `.db` file (to the app's `backups/` folder and your Downloads). Restore re-loads everything from a chosen backup file. Plus CSV export for Excel.

All money is in **PKR**. A fresh install starts **empty** — you add your own
members, staff, users and gym details. (If you ever want sample data for a
walkthrough, run `node server/seed.js --demo`.)

---

## Requirements

- **Windows 10/11** (the gym laptop). macOS/Linux also work for development.
- **Node.js 22.5 or newer** — https://nodejs.org (current LTS, or Node 24 — both fine). No Python or build tools required.
- **ZKTeco ZK9500** reader, its **USB driver**, and the **ZKFinger SDK** (only needed for live fingerprint capture — see below). The app runs fully without it in simulation mode.

---

## Quick start

1. Install Node.js LTS.
2. Unzip this folder somewhere permanent, e.g. `C:\DemoGym`.
3. Double-click **`Start Demo Gym.bat`** (it installs dependencies the first time, then launches the app and opens your browser at `http://localhost:4317`).

Or from a terminal in the project folder:

```
npm install
npm start
```

The first run creates and seeds the database at `data/gym.db`. Subsequent runs
reuse it.

---

## Enabling the ZK9500 fingerprint reader

The app auto-detects the reader. If the SDK and device are present it runs in
**device mode**; otherwise it falls back to **simulation mode** (everything still
works, only live finger capture is replaced by the on-screen "Simulate scan"
buttons). The current mode is shown in the sidebar and in **Settings → About**.

To enable real capture on the gym laptop:

1. Plug in the ZK9500 and install its **USB driver** (from ZKTeco).
2. Install the **ZKFinger SDK / ZKFinger Reader SDK** for Windows. This provides
   `libzkfp.dll` and its companion DLLs.
3. Make sure `libzkfp.dll` is reachable — the simplest options are to install the
   SDK normally (it adds itself to the system `PATH`), or copy the SDK's DLLs into
   this project folder next to `package.json`. You can also point the app at an
   explicit location with the `ZK_LIB_PATH` setting (see Configuration).
4. Start the app. The console prints `ZK9500 ready — live scanning enabled` when
   the reader is detected.

Notes on how it uses the SDK:

- Enrollment captures `ENROLL_SAMPLES` (default 3) templates and merges them with `ZKFPM_DBMerge` into one registration template, stored in the `fingerprints` table.
- On startup all stored templates are loaded into the SDK's in-memory match cache, so identification is a fast 1:N search (`ZKFPM_DBIdentify`).
- Seeded demo members are flagged as "enrolled" but have **no real template** (they were never scanned on your device). Real identification only matches members you actually enroll on the reader — exactly as expected for a fresh install.

---

## Configuration

Settings are read from environment variables (you can copy `.env.example`, though
the defaults are fine for most installs):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4317` | Web server port |
| `DB_PATH` | `data/gym.db` | SQLite database file |
| `BACKUP_DIR` | `backups/` | Where "Back up now" writes `.db` snapshots |
| `FINGERPRINT_MODE` | `auto` | `auto` (try device, fall back), `device` (require reader), or `simulation` |
| `ZK_LIB_PATH` | `libzkfp` | Name/path of the ZKFinger library |
| `ENROLL_SAMPLES` | `3` | Fingerprint samples captured per enrollment |
| `OPEN_BROWSER` | `1` | Auto-open the browser on start (`0` to disable) |

To force device mode (so you get a clear error if the reader isn't found):
`set FINGERPRINT_MODE=device` before `npm start`.

---

## Backups

- **Back up now** (Settings → Backup) writes a timestamped copy of the database to `backups/` and downloads a copy through the browser. Keep one on a USB drive or cloud folder.
- **Restore from backup file** replaces the live database with a chosen `.db` backup (the current data is snapshotted first, just in case).
- **Export everything to Excel** downloads a CSV of members and payments.

Because the whole system is a single `data/gym.db` file, you can also just copy
that file to back it up manually.

---

## Useful commands

```
npm start                    # run the app
node server/seed.js          # initialise a clean install if the database is empty
node server/seed.js --reset  # wipe everything back to a clean, empty install
node server/seed.js --demo   # load sample data (for a demo/walkthrough only)
```

The app starts empty by default. To wipe an existing install back to empty,
stop the app and delete the `data` folder (or run `node server/seed.js --reset`).

---

## Build a Windows installer (app.exe + Setup.exe) with auto-start

To hand the gym a proper double-click app that needs **no Node.js** and starts
itself on boot, build the distributables once on any Windows PC:

1. Install **Node.js LTS** and **Inno Setup 6** (https://jrsoftware.org/isdl.php) on the build PC.
2. Double-click **`build\build-windows.bat`**.
3. Collect the results from the `dist` folder:
   - `app.exe` — the standalone application
   - `Demo-Gym-Setup.exe` — the installer (Start Menu + desktop shortcuts, and a checkbox to **start automatically when Windows boots**)

Run `Demo-Gym-Setup.exe` on the gym laptop, tick the auto-start option, and the
app runs in the background after every boot — staff click the **Demo Gym**
desktop icon to open the screen. Data lives at `%LOCALAPPDATA%\Demo Gym\`.

Full details and troubleshooting are in **`build/README-BUILD.md`**.

(If you'd rather not build an exe, `Start Demo Gym.bat` runs the same app
directly when Node.js is installed on the laptop. To auto-start that version,
put a shortcut to it in the Windows Startup folder — `shell:startup`.)

---

## Project layout

```
gym-manager/
  Start Demo Gym.bat        Windows launcher (installs + runs)
  package.json
  server/
    index.js                Express app + WebSocket + startup
    config.js               Configuration / env vars
    db.js                   SQLite connection + schema
    seed.js                 Deterministic demo data
    routes.js               REST API
    lib/                    util, serializers, check-in helper
    services/
      backup.js             DB-file backup / restore
      fingerprint/
        index.js            Service facade (sessions, cache, scan loop)
        zk9500.js           ZK9500 adapter via ZKFinger SDK (koffi)
        mock.js             Simulation adapter
  public/
    index.html              The whole UI (same design as the demo)
  build/
    build-windows.bat       One-click: builds app.exe + Setup.exe
    installer.iss           Inno Setup installer (shortcuts + auto-start)
    run-hidden.vbs          Boot launcher (runs hidden, no browser popup)
    README-BUILD.md         Build & install instructions
  data/                     gym.db lives here (created on first run)
  backups/                  .db snapshots
```

---

## Troubleshooting

- **"Could not reach the server" in the browser** — the server isn't running; start it with `npm start` or the `.bat`.
- **Port already in use** — set a different `PORT` (e.g. `set PORT=5000 && npm start`).
- **`ERR_DLOPEN_FAILED` or "find Python" / node-gyp errors** — these were from an older build that used a compiled database module. This version uses the SQLite engine built into Node, so they no longer apply: delete the `node_modules` folder and re-run the launcher.
- **Reader not detected** — confirm the USB driver is installed (it shows in Device Manager), the ZKFinger SDK is installed, and `libzkfp.dll` is on PATH or set `ZK_LIB_PATH`. Run with `FINGERPRINT_MODE=device` to see the exact error.
- **Fingerprint won't match a seeded member** — expected: seed members have no real template. Enroll the member on the device first.

---

Built for a single-location gym. Currency PKR. Offline by design — your data
never leaves the laptop.
