@echo off
REM ===========================================================================
REM  Demo Gym - Windows build kit
REM  Produces:  dist\app.exe              (the app, no Node needed on gym PC)
REM             dist\Demo-Gym-Setup.exe   (installer: shortcuts + auto-start)
REM  Run ONCE on a Windows 10/11 PC that has Node.js 20 or 22 LTS installed.
REM  (Inno Setup 6 is needed only to produce the Setup.exe.)
REM ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo.
echo ===== Demo Gym :: Windows build =====
echo.

where node >nul 2>nul
if errorlevel 1 ( echo [X] Node.js not found. Install Node 22 LTS from https://nodejs.org then re-run. & pause & exit /b 1 )

REM Match the packaged runtime to the installed Node so the native database
REM module loads correctly (otherwise app.exe throws ERR_DLOPEN_FAILED).
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
set TARGET=node%NODEMAJOR%-win-x64
echo Detected Node v%NODEMAJOR%  ->  building for %TARGET%
echo.

echo [1/5] Installing dependencies (downloads the correct Windows binaries)...
call npm install
if errorlevel 1 ( echo [X] npm install failed. & pause & exit /b 1 )

echo [2/5] Installing the pkg bundler...
call npm install -g @yao-pkg/pkg
if errorlevel 1 ( echo [!] @yao-pkg/pkg install had issues; will try npx at build time. )

echo [3/5] Building app.exe for %TARGET% ...
if not exist dist mkdir dist
call pkg . --targets %TARGET% --output dist\app.exe
if not exist dist\app.exe (
  echo     retrying via npx...
  call npx --yes @yao-pkg/pkg . --targets %TARGET% --output dist\app.exe
)
if not exist dist\app.exe ( echo [X] Could not build app.exe. Make sure you are on Node 20 or 22 LTS and online. & pause & exit /b 1 )

echo [4/5] Copying native modules next to app.exe ...
for /r "node_modules\better-sqlite3" %%f in (better_sqlite3.node) do copy /y "%%f" "dist\" >nul 2>nul
if exist "node_modules\koffi\build" xcopy /e /i /y "node_modules\koffi\build" "dist\build" >nul 2>nul
copy /y "build\run-hidden.vbs" "dist\" >nul 2>nul

echo [5/5] Building the installer (Setup.exe) ...
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if defined ISCC (
  "!ISCC!" "build\installer.iss"
  if exist "dist\Demo-Gym-Setup.exe" ( echo     Installer built: dist\Demo-Gym-Setup.exe ) else ( echo [!] Installer compile reported a problem - see messages above. )
) else (
  echo [!] Inno Setup 6 not found.
  echo     Install it from https://jrsoftware.org/isdl.php and re-run this script,
  echo     OR open build\installer.iss in Inno Setup and press F9 to compile.
)

echo.
echo ===== Done =====
echo   App:        dist\app.exe
echo   Installer:  dist\Demo-Gym-Setup.exe   (if Inno Setup was available)
echo.
echo Tip: double-click dist\app.exe to test it before handing over the Setup.exe.
echo.
pause
