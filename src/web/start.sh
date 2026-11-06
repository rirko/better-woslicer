#!/bin/sh
# Starts the woslicer-dx offline web build: serves this folder on
# http://127.0.0.1 and opens the default browser (Node.js required).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run the local server. See README for alternatives."
  exit 1
fi
exec node server.mjs
