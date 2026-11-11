#!/usr/bin/env bash
# Rebuilds js/globe/globe.bundle.js from tools/globe/src with three.js bundled in (no CDN at run time).
# Usage: bash tools/globe/build.sh   (needs Node and network access to npm, once)
set -euo pipefail
cd "$(dirname "$0")/../.."
T="${TMPDIR:-/tmp}/kakde-three-0.187.0"
if [[ ! -f "$T/package/build/three.module.js" ]]; then mkdir -p "$T" && (cd "$T" && npm pack three@0.187.0 --silent >/dev/null && tar -xzf three-0.187.0.tgz); fi
npx --yes esbuild@0.28.2 tools/globe/src/hero.js --bundle --minify --format=esm --target=es2020 --alias:three="$T/package/build/three.module.js" --outfile=js/globe/globe.bundle.js
