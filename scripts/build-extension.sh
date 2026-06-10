#!/bin/sh
# Sync the shared js/ and css/ from the repo root into extension/ so it is
# directly loadable via chrome://extensions → "Load unpacked" → extension/.
# Rerun after editing any shared code, then hit reload on the extension.
# extension/js and extension/css are generated — edit the root copies.
set -e
cd "$(dirname "$0")/.."

rm -rf extension/js extension/css
cp -R js css extension/

echo "Synced extension/ — load (or reload) it via chrome://extensions"
