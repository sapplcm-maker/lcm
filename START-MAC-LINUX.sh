#!/bin/bash
# ============================================================
#  LCM Ministry Portal - One-click start (macOS / Linux)
#  If you don't have Node.js, install it first from:
#  https://nodejs.org  (choose LTS, accept defaults)
# ============================================================
cd "$(dirname "$0")"

echo ""
echo " === LCM Ministry Portal ==="
echo " First launch will install a few components (1-3 minutes)."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo " [ERROR] Node.js was not found."
  echo " Please install it from https://nodejs.org (LTS version),"
  echo " then run this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo " Installing components... please wait."
  npm install --no-audit --no-fund || {
    echo " [ERROR] Installation failed. Check your internet connection and try again."
    read -r -p "Press Enter to close..."
    exit 1
  }
fi

if [ ! -f server/data/lcm.db ]; then
  echo " Creating the ministry database for the first time..."
  node server/seed.js
fi

echo ""
echo " Starting the portal..."
echo " Your browser will open shortly. If it does not,"
echo " open your browser and go to:  http://localhost:3000"
echo ""
echo " Members on the SAME Wi-Fi as this computer can also sign in at:"
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$IP" ]; then echo "   http://$IP:3000"; fi
IP2=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$IP2" ]; then echo "   http://$IP2:3000"; fi
echo ""
echo " IMPORTANT: keep this window open while using the portal."
echo " To stop the portal, press Ctrl+C in this window."
echo ""

(sleep 1; open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) &
node server/server.js
