#!/bin/bash
# ──────────────────────────────────────────────────────────
#  SafeClaw — Double-click to launch the dashboard
#  No terminal knowledge required!
# ──────────────────────────────────────────────────────────

# Move to the directory where this script lives (the SafeClaw folder)
cd "$(dirname "$0")" || exit 1

clear
echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │        🐾  SafeClaw v1.0.0-beta     │"
echo "  │     Safe-by-default AI agent gate   │"
echo "  └─────────────────────────────────────┘"
echo ""

# ── Step 1: Check for Node.js ──────────────────────────────

if ! command -v node &>/dev/null; then
  echo "  ⚠  Node.js is not installed."
  echo ""
  echo "  SafeClaw needs Node.js (v18+) to run."
  echo "  Opening the Node.js download page for you..."
  echo ""
  open "https://nodejs.org/en/download"
  echo "  After installing Node.js, double-click this file again."
  echo ""
  echo "  Press any key to close..."
  read -n 1 -s
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ] 2>/dev/null; then
  echo "  ⚠  Node.js v${NODE_VERSION} is too old. SafeClaw needs v18+."
  echo "  Opening the Node.js download page..."
  open "https://nodejs.org/en/download"
  echo ""
  echo "  Press any key to close..."
  read -n 1 -s
  exit 1
fi

echo "  ✓  Node.js $(node -v) found"

# ── Step 2: Install dependencies (first run only) ─────────

if [ ! -d "node_modules" ]; then
  echo "  ⏳ First run — installing dependencies..."
  echo ""
  npm install --production 2>&1 | while IFS= read -r line; do echo "     $line"; done
  echo ""
  echo "  ✓  Dependencies installed"
else
  echo "  ✓  Dependencies ready"
fi

# ── Step 3: Check for config ──────────────────────────────

SAFECLAW_DIR="$HOME/.safeclaw"
if [ ! -f "$SAFECLAW_DIR/config.json" ]; then
  echo ""
  echo "  📋 First time? The setup wizard will open in your browser."
  echo "     You'll need your Authensor token to get started."
fi

# ── Step 4: Launch the dashboard ──────────────────────────

echo ""
echo "  🚀 Starting SafeClaw dashboard..."
echo "  ─────────────────────────────────"
echo "  The dashboard will open in your browser automatically."
echo "  To stop SafeClaw, close this window or press Ctrl+C."
echo ""

node src/server.js 2>&1

# If we get here, the server stopped
echo ""
echo "  SafeClaw has stopped."
echo "  Press any key to close..."
read -n 1 -s
