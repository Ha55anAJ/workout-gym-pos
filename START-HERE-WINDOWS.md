# Running Demo Gym on Windows — step by step

There are two ways to run it. **Start with Method A** (fastest, ~5 minutes). Use
Method B later when you want a proper installer for the gym laptop.

---

## Method A — Run it now (Node + launcher)

### Step 1 — Install Node.js (one time)
1. Go to **https://nodejs.org**
2. Download the **LTS** version (the big green button, "Windows Installer").
3. Run the downloaded `.msi`, click **Next** through the wizard, accept the
   defaults, and finish. (This installs `node` and `npm`. Any current version
   works — Node 22.5+ including Node 24 — and **no Python or build tools are needed**.)

### Step 2 — Unzip the app
1. Right-click **`gym-manager.zip`** → **Extract All…**
2. Extract to somewhere permanent, e.g. **`C:\DemoGym`**.
3. Open the extracted folder. You should see `Start Demo Gym.bat`,
   `package.json`, and the `server`, `public`, `build` folders.

### Step 3 — Start the app
1. Double-click **`Start Demo Gym.bat`**.
2. If Windows shows a blue "Windows protected your PC" box, click
   **More info → Run anyway** (this happens for any unsigned script).
3. The first time, a black window shows **"Installing dependencies…"** — this
   takes 1–3 minutes and needs an internet connection. (It only happens once.)
4. When it's ready it prints **"Demo Gym is running"** and your browser opens at
   **http://localhost:4317** with the dashboard.

### Step 4 — Using it day to day
- Keep the black command window **open** while you use the app (closing it stops
  the app). Minimise it if it's in the way.
- Each day, just double-click **`Start Demo Gym.bat`** again, or bookmark
  **http://localhost:4317**.
- To stop the app, close the black window.

Your data is saved automatically in **`data\gym.db`** inside the app folder, and
**Settings → Back up now** saves a copy you can keep on a USB or cloud drive.

---

## Method B — Build a proper installer (app.exe + Setup.exe)

This produces a double-click app that needs **no Node.js** on the gym laptop and
can **start automatically when Windows boots**.

1. On any Windows PC, install **Node.js LTS** (Step 1 above) and
   **Inno Setup 6** from **https://jrsoftware.org/isdl.php**.
2. Open the app's **`build`** folder and double-click **`build-windows.bat`**.
3. When it finishes, open the **`dist`** folder — you'll have **`app.exe`** and
   **`Demo-Gym-Setup.exe`**.
4. Copy **`Demo-Gym-Setup.exe`** to the gym laptop and run it. During setup tick
   **"Start Demo Gym automatically when Windows starts."**
5. After that the app runs in the background on every boot; staff click the
   **Demo Gym** desktop icon to open the screen.

Full details: **`build/README-BUILD.md`**.

---

## Connecting the ZK9500 fingerprint reader (optional)

The app works without the reader — the **Scan** page just uses the on-screen
"Simulate scan" buttons (simulation mode).

To turn on **live** fingerprint scanning and enrollment:

1. Plug the **ZK9500** into a USB port.
2. Install its **USB driver** (from ZKTeco).
3. Install the **ZKFinger SDK** (also from ZKTeco) so that `libzkfp.dll` is
   available on the system.
4. Restart the app. The sidebar shows **"Scanner connected"** and the Scan page
   reads fingers automatically.

Note: the demo members included on first install were never scanned on your
device, so live scanning only recognises members you actually enroll on the
reader (Members → Add new member → capture 3 samples).

---

## Troubleshooting

- **"node is not recognized…"** — Node.js isn't installed, or you need to close
  and reopen the window after installing it. Redo Method A, Step 1.
- **Browser didn't open** — type **http://localhost:4317** into Chrome/Edge.
- **"Port already in use"** — the app is probably already running in another
  window. Just open http://localhost:4317. (To change the port, right-click
  `Start Demo Gym.bat` → Edit and add `set PORT=5000` on a line before the
  `node` line.)
- **First-run install fails** — you need an internet connection the first time
  (it downloads the app's components). After that it runs offline.
- **The black window closed and the app stopped** — that's expected; reopen
  `Start Demo Gym.bat`. Use Method B if you want it to run on its own.
- **You saw `ERR_DLOPEN_FAILED` or a "Python not found" error on an earlier
  version** — fixed in this build (it now uses the SQLite engine built into
  Node, so nothing compiles). Delete the `node_modules` folder and run the
  launcher again.
