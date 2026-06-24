#!/usr/bin/env bash
# Dev launcher for macOS / Linux.
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo "Node.js not found. Install it from https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
node server/index.js
