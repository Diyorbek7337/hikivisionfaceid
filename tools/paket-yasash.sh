#!/usr/bin/env bash
# Builds a ready-to-install ZIP for an organization (no internet / no build needed on site):
#   server with production node_modules, pre-built web pages, empty .env template, install guide,
#   and the Node.js Windows installer when available.
# Usage: tools/paket-yasash.sh [output-dir] [node-version]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
NODE_VER="${2:-v24.21.0}"
VER="$(node -p "require('$ROOT/server/package.json').version")"
NAME="Davomat-v$VER"
STAGE="$(mktemp -d)/$NAME"
mkdir -p "$STAGE" "$OUT"

echo "1/5 web sahifalar yig'ilmoqda..."
( cd "$ROOT/web" && [ -d node_modules ] || npm ci ) >/dev/null
( cd "$ROOT/web" && npx next build ) >/dev/null

echo "2/5 fayllar ko'chirilmoqda..."
cp "$ROOT"/*.bat "$ROOT/README.md" "$STAGE/"
cp "$ROOT/tools/paket/O'RNATISH.txt" "$STAGE/"
mkdir -p "$STAGE/server" "$STAGE/web"
cp -r "$ROOT/server/src" "$ROOT/server/scripts" "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$ROOT/server/.env.example" "$STAGE/server/"
cp "$ROOT/tools/paket/env.shablon" "$STAGE/server/.env"
cp -r "$ROOT/web/out" "$STAGE/web/out"
cp "$ROOT/web/needs-build.js" "$STAGE/web/"

echo "3/5 server paketlari o'rnatilmoqda..."
( cd "$STAGE/server" && npm ci --omit=dev --no-audit --no-fund ) >/dev/null

echo "4/5 Node.js o'rnatuvchisi..."
MSI="node-$NODE_VER-x64.msi"
CACHE="$ROOT/tools/.cache"
mkdir -p "$CACHE"
if [ ! -f "$CACHE/$MSI" ]; then
  curl -fsSL -o "$CACHE/$MSI.part" "https://nodejs.org/dist/$NODE_VER/$MSI" && mv "$CACHE/$MSI.part" "$CACHE/$MSI" \
    || echo "   (yuklab bo'lmadi - paketsiz davom etiladi)"
fi
[ -f "$CACHE/$MSI" ] && cp "$CACHE/$MSI" "$STAGE/"

echo "5/5 zip..."
python3 - "$STAGE" "$OUT/$NAME.zip" <<'PY'
import os, sys, zipfile
stage, dest = sys.argv[1], sys.argv[2]
base = os.path.dirname(stage)
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for d, _, files in os.walk(stage):
        for f in files:
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, base))
PY
rm -rf "$(dirname "$STAGE")"
echo "Tayyor: $OUT/$NAME.zip ($(du -h "$OUT/$NAME.zip" | cut -f1))"
