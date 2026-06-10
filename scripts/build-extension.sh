#!/bin/sh
# Assemble the Chrome extension into dist/extension/ for "Load unpacked"
# or store packaging. Shared js/ and css/ are copied from the repo root
# so the web app and extension stay one source of truth.
set -e
cd "$(dirname "$0")/.."

rm -rf dist/extension
mkdir -p dist/extension

cp -R js css dist/extension/
cp extension/manifest.json extension/sw.js extension/tab-source.js extension/visualizer.html dist/extension/

echo "Built dist/extension — load it via chrome://extensions → Load unpacked"
