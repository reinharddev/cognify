#!/bin/bash
# Bungkus ekstensi browser jadi dua zip: Chrome/Edge (manifest.json) dan Firefox (manifest.firefox.json jadi manifest.json).
# Pemakaian: scripts/pack-extension.sh [folder-keluaran]   (bawaan: build/extension)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-build/extension}"
VERSION=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
for target in chrome firefox; do
  stage=$(mktemp -d)
  cp -R extension/. "$stage/"
  rm -f "$stage/README.md" "$stage/.DS_Store"
  if [ "$target" = firefox ]; then mv "$stage/manifest.firefox.json" "$stage/manifest.json"; else rm -f "$stage/manifest.firefox.json"; fi
  zip="$OUT/cognify-extension-$target-$VERSION.zip"
  rm -f "$zip"
  (cd "$stage" && zip -qr "$zip" . -x '*.DS_Store')
  rm -rf "$stage"
  echo "$zip"
done
