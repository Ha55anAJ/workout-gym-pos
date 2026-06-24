# Building the Windows installer (app.exe + Setup.exe)

This produces two files:

- **`dist\app.exe`** — the whole application as one executable. The gym laptop does **not** need Node.js installed to run it.
- **`dist\Demo-Gym-Setup.exe`** — an installer that copies the app into the user's profile, creates Start Menu + desktop shortcuts, and (optionally) starts the app automatically when Windows boots.

## You only need to build once, on any Windows 10/11 PC

Requirements on the **build** machine (not the gym laptop):

1. **Node.js LTS** — https://nodejs.org
2. **Inno Setup 6** — https://jrsoftware.org/isdl.php  (only needed to produce `Setup.exe`)

## Steps

1. Copy this whole `gym-manager` folder to the Windows build PC.
2. Open the `build` folder and **double-click `build-windows.bat`**.
3. When it finishes, look in the `dist` folder for `app.exe` and `Demo-Gym-Setup.exe`.

The script runs `npm install`, bundles the app with `pkg` into `app.exe`, copies
the native modules (`better-sqlite3` for the database, `koffi` for the ZK9500)
next to it, then compiles the installer if Inno Setup is present.

## Installing on the gym laptop

1. Copy `Demo-Gym-Setup.exe` to the gym laptop and run it.
2. Tick **"Start Demo Gym automatically when Windows starts"** during setup.
3. That's it. The app runs in the background after every boot; staff click the
   **Demo Gym** desktop icon to open the screen (it just opens the browser to the
   already-running app).

The database and backups are stored per-user at
`%LOCALAPPDATA%\Demo Gym\` (e.g. `C:\Users\<name>\AppData\Local\Demo Gym\`),
which is writable without administrator rights.

## Fingerprint reader (ZK9500)

`app.exe` includes the fingerprint code. For **live** capture the gym laptop
still needs the ZK9500 **USB driver** and the **ZKFinger SDK** installed so that
`libzkfp.dll` is available (see the main README → "Enabling the ZK9500"). Without
them the app runs in simulation mode.

## Notes / troubleshooting

- If `pkg` warns about `better_sqlite3.node` or `koffi`, that's expected — the
  build script copies those native files into `dist\` next to `app.exe`, which is
  where they load from at runtime. Keep the whole `dist\` contents together (the
  installer bundles them for you).
- If you prefer not to build an exe, the app also runs directly with
  `Start Demo Gym.bat` (needs Node.js installed on the gym laptop). Both
  approaches use the same code and data.
- To change the port, set a `PORT` environment variable before launching.
