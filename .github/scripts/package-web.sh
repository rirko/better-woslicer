#!/usr/bin/env bash
set -euo pipefail

archive="$(node -p 'const pkg = require("./package.json"); pkg.name + "-" + pkg.version + "-web.zip"')"
mkdir -p release/web
(cd dist/app && zip -q -r "../../release/web/$archive" . -x '*.map' '.vite/*')
unzip -t "release/web/$archive"
