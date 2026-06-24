@echo off
REM ===========================================================================
REM  Demo Gym - Windows build kit
REM  Produces:  dist\app.exe              (the application, no Node needed)
REM             dist\Demo-Gym-Setup.exe   (installer w/ shortcuts + auto-start)
REM  Run this ONCE on any Windows 10/11 PC that has Node.js LTS installed.
REM ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo.
echo ===== Demo Gym :: Windows build =====
echo.

where node >nul 2>nul
if errorlevel 1 ( echo [X] Node.js not found. Install the LTS from https://nodejs.org then re-run. & pause & exit /b 1 )

echo [1/5] Installing dependencies (gets Windows-native binaries)...
call npm install
if errorlevel 1 ( echo [X] npm install failed. & pause & exit /b 1 )

echo [2/5] Installing the pkg bundler...
call npm install -g pkg
if errorlevel 1 ( echo [X] Could not install pkg. & pause & exit /b 1 )

echo [3/5] Building app.exe ...
if not exist dist mkdir dist
call pkg . --targets node18-win-x64 --output dist\app.exe
if errorlevel 1 ( echo [X] pkg build failed. & pause & exit /b 1 )

echo [4/5] Copying native modules next to app.exe ...
REM better-sqlite3 native addon
for /r "node_modules\better-sqlite3" %%f in (better_sqlite3.node) do copy /y "%%f" "dist\" >nul 2>nul
REM koffi native binaries (fingerprint FFI) - copy the whole build tree
if exist "node_modules\koffi\build" xcopy /e /i /y "node_modules\koffi\build" "dist\build" >nul 2>nul
REM hidden launcher used for boot auto-start
copy /y "build\run-hidden.vbs" "dist\" >nul 2>nul

echo [5/5] Building the installer (Setup.exe) ...
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if defined ISCC (
  "!ISCC!" "build\installer.iss"
  if errorlevel 1 ( echo [!] Installer compile failed - see messages above. ) else ( echo     Installer built. )
) else (
  echo [!] Inno Setup 6 not found.
  echo     Install it once from https://jrsoftware.org/isdl.php and re-run,
  echo     or open build\installer.iss in Inno Setup and click Compile.
)

echo.
echo ===== Done =====
echo   App:        dist\app.exe
echo   Installer:  dist\Demo-Gym-Setup.exe   (if Inno Setup was available)
echo.
echo Test app.exe by double-clicking it. Hand the gym the Setup.exe.
echo.
pause
