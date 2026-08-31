@echo off
REM ============================================================
REM  LCM Ministry Portal - One-click start (Windows)
REM  If you don't have Node.js, install it first from:
REM  https://nodejs.org  (choose LTS, accept defaults)
REM ============================================================
cd /d "%~dp0"
title LCM Ministry Portal

echo.
echo  === LCM Ministry Portal ===
echo  First launch will install a few components (takes 1-3 minutes).
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found.
  echo  Please install it from https://nodejs.org (LTS version),
  echo  then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installing components... please wait.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [ERROR] Installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist server\data\lcm.db (
  echo  Creating the ministry database for the first time...
  call node server\seed.js
)

echo.
echo  Starting the portal...
echo  Your browser will open shortly. If it does not,
echo  open Google Chrome or Edge and go to:  http://localhost:3000
echo.
echo  Members on the SAME Wi-Fi as this computer can also sign in at:
ipconfig | findstr /i "IPv4"
echo  (use that address with :3000 at the end, e.g. http://192.168.1.23:3000)
echo.
echo  IMPORTANT: keep this window open while using the portal.
echo  To stop the portal, close this window (or press Ctrl+C).
echo.
start "" http://localhost:3000
node server\server.js
pause
