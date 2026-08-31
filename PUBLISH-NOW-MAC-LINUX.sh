#!/bin/bash
# ============================================================
#  LCM Ministry Portal - PUBLISH NOW (macOS / Linux)
#  One double-click = your members get a public internet link.
#  Requirements: Node.js installed once (nodejs.org, LTS).
#  "ssh" is already built into macOS and Linux.
# ============================================================
cd "$(dirname "$0")"

echo ""
echo " === LCM Ministry Portal - PUBLISH NOW ==="
echo ""
echo " This will (1) start the portal and (2) create a secure"
echo " public link you can send to members anywhere in the world."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo " [ERROR] Node.js is not installed."
  echo " Install it once from https://nodejs.org (LTS), then run this again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo " [ERROR] ssh not found."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo " Installing components... please wait 1-3 minutes."
  npm install --no-audit --no-fund || {
    echo " [ERROR] Installation failed. Check your internet connection."
    read -r -p "Press Enter to close..."
    exit 1
  }
fi

if [ ! -f server/data/lcm.db ]; then
  echo " Creating the ministry database..."
  node server/seed.js
fi

echo " Starting the portal..."
(node server/server.js > /tmp/lcm-portal-server.log 2>&1 &)
sleep 5

echo ""
echo " Creating your secure public link... this can take up to 30 seconds."
echo ""
echo " ============================================================"
echo "  KEEP THIS WINDOW OPEN. When a line starting with \"https://\""
echo "  appears below, that is YOUR PUBLIC LINK."
echo "  Send it to your members - they open it in any browser."
echo "  Example:  https://xxxx.lhr.life"
echo " ============================================================"
echo ""

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -R 80:localhost:3000 nokey@localhost.run

echo ""
echo " The link has stopped. To publish again, run this file again."
