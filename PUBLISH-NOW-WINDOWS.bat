@echo off
REM ============================================================
REM  LCM Ministry Portal - PUBLISH NOW (Windows)
REM  One double-click = your members get a public internet link.
REM  Requirements: Node.js installed once (nodejs.org, LTS).
REM  Windows 10/11 already includes the needed "ssh" tool.
REM ============================================================
cd /d "%~dp0"
title LCM Ministry Portal - PUBLISHING...

echo.
echo  === LCM Ministry Portal - PUBLISH NOW ===
echo.
echo  This will (1) start the portal and (2) create a secure
echo  public link you can send to members anywhere in the world.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is not installed.
  echo  Install it once from https://nodejs.org  (LTS version, accept defaults),
  echo  then double-click this file again.
  pause
  exit /b 1
)

where ssh >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] The "ssh" tool is missing on this computer.
  echo  In Windows Settings search for "Optional features", open it,
  echo  click "Add a feature", choose "OpenSSH Client", and install it.
  echo  Then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Installing components... please wait 1-3 minutes.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [ERROR] Installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)

if not exist server\data\lcm.db (
  echo  Creating the ministry database...
  node server\seed.js
)

echo  Starting the portal...
start "LCM Portal Server" cmd /c "cd /d %~dp0 && node server\server.js"
timeout /t 5 /nobreak >nul

echo.
echo  Creating your secure public link... this can take up to 30 seconds.
echo.
echo  ============================================================
echo   KEEP THIS WINDOW OPEN. When a line starting with "https://"
echo   appears below, that is YOUR PUBLIC LINK.
echo   Send it to your members - they open it in any browser.
echo   Example:  https://xxxx.lhr.life
echo  ============================================================
echo.

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -R 80:localhost:3000 nokey@localhost.run

echo.
echo  The link has stopped. To publish again, double-click this file again.
pause
