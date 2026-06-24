@echo off
title Demo Gym
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies for the first time, please wait...
  call npm install
  if errorlevel 1 ( echo. & echo Install failed. See the messages above. & pause & exit /b 1 )
)

echo.
echo Starting Demo Gym...  (close this window to stop the app)
echo Open http://localhost:4317 if the browser does not open automatically.
echo.
node server\index.js
pause
