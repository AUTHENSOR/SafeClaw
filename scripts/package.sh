#!/bin/bash
# ──────────────────────────────────────────────────────────
#  Build distributable SafeClaw zip files
#  Usage: bash scripts/package.sh
# ──────────────────────────────────────────────────────────

set -e

VERSION="1.0.0-beta"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
STAGING="$DIST_DIR/SafeClaw"

echo "Building SafeClaw v${VERSION} distribution..."

# Clean
rm -rf "$DIST_DIR"
mkdir -p "$STAGING"

# Copy project files (exclude dev/build artifacts)
INCLUDE=(
  src
  ui
  policies
  examples
  docs
  package.json
  package-lock.json
  README.md
  CHANGELOG.md
  LICENSE
  SafeClaw.command
  SafeClaw.bat
  Dockerfile
)

for item in "${INCLUDE[@]}"; do
  if [ -e "$PROJECT_DIR/$item" ]; then
    cp -r "$PROJECT_DIR/$item" "$STAGING/$item"
  fi
done

# Ensure launcher is executable
chmod +x "$STAGING/SafeClaw.command"

# Build macOS zip
echo "Creating SafeClaw-v${VERSION}-macos.zip..."
cd "$DIST_DIR"
zip -r "SafeClaw-v${VERSION}-macos.zip" SafeClaw \
  -x "SafeClaw/SafeClaw.bat" \
  -x "SafeClaw/.DS_Store" \
  -x "SafeClaw/**/.DS_Store"

# Build Windows zip (exclude .command, include .bat)
echo "Creating SafeClaw-v${VERSION}-windows.zip..."
zip -r "SafeClaw-v${VERSION}-windows.zip" SafeClaw \
  -x "SafeClaw/SafeClaw.command" \
  -x "SafeClaw/.DS_Store" \
  -x "SafeClaw/**/.DS_Store"

# Build universal zip (both launchers)
echo "Creating SafeClaw-v${VERSION}.zip..."
zip -r "SafeClaw-v${VERSION}.zip" SafeClaw \
  -x "SafeClaw/.DS_Store" \
  -x "SafeClaw/**/.DS_Store"

# Clean staging
rm -rf "$STAGING"

echo ""
echo "Done! Distribution files:"
ls -lh "$DIST_DIR"/*.zip
echo ""
echo "Upload these to GitHub Releases or your download page."
