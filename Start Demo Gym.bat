@echo off
title Demo Gym
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

REM Dependencies are bundled inside this folder. Only install if somehow missing.
if not exist "node_modules\sql.js" (
  echo Installing dependencies, please wait...
  call npm install --omit=optional
)

echo Checking the database on this PC...
node -e "process.env.DB_PATH='.selftest.db';var db=require('./server/db');db.init().then(function(){db.prepare('INSERT INTO members(code,name,type,join_date) VALUES (?,?,?,?)').run('T1','x','Basic','2000-01-01');var n=db.prepare('SELECT COUNT(*) n FROM members').get().n;console.log('DATABASE OK (wrote '+n+' row)');process.exit(0);}).catch(function(e){console.log('DATABASE FAILED: '+e);process.exit(1);});"
set RC=%errorlevel%
del ".selftest.db" >nul 2>nul
if not "%RC%"=="0" (
  echo.
  echo The database engine failed on this PC. Please copy the DATABASE FAILED line above and send it to support.
  echo.
  pause
  exit /b 1
)

echo.
echo Starting Demo Gym...  (close this window to stop the app)
echo Open http://127.0.0.1:4317 if the browser does not open automatically.
echo.
node server\index.js
pause
