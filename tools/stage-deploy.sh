#!/bin/sh
# Stage a deployable copy of the site.
#
# `wrangler pages deploy` FOLLOWS symlinks and has no exclude flag, and this tree
# carries dev symlinks into real games outside it (onscripter-runtime/testgame ->
# ~/narcissu_pkg, and friends - see each runtime's README). Deploying the folder
# directly therefore tries to upload gigabytes of game data and fails on Pages'
# 25 MiB per-file limit.
#
# So the deploy goes from a copy made without symlinks: `rsync -rptgoD` is `-a`
# minus `-l`, which skips them and says so. Everything else - including _headers,
# which Pages needs - comes across unchanged.
#
#   sh tools/stage-deploy.sh            # stages to /tmp/noberu-deploy
#   sh tools/stage-deploy.sh <dir>      # or wherever you like
set -eu

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:-/tmp/noberu-deploy}"

# The reading tools' dictionary (dict/) is generated, not committed.
if [ ! -f "$SRC/dict/ja-en/meta.json" ]; then
  DICT_SRC="${DICT_SRC:-$HOME/Documents/noberu-assets/dict-src}"
  JM="$(ls "$DICT_SRC"/jmdict-eng-*.json 2>/dev/null | head -1)"
  KD="$(ls "$DICT_SRC"/kanjidic2-en-*.json 2>/dev/null | head -1)"
  if [ -n "$JM" ] && [ -n "$KD" ]; then
    node "$SRC/tools/build-dict.mjs" "$JM" "$KD"
  else
    echo "warning: no dict/ and no dictionary sources in $DICT_SRC; the reading tools' dictionary won't work" >&2
  fi
fi

rm -rf "$DST"
mkdir -p "$DST"
rsync -rptgoD \
  --exclude '.git' \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  --exclude 'node_modules' \
  --exclude '.wrangler' \
  --exclude 'beam-worker' \
  "$SRC"/ "$DST"/ 2>&1 | grep -v '^$' || true

# The engine list for offline use, built from exactly what is being uploaded.
node "$SRC/tools/offline-manifest.mjs" "$DST"

echo
echo "staged: $DST"
echo "  files:   $(find "$DST" -type f | wc -l | tr -d ' ')"
echo "  size:    $(du -sh "$DST" | cut -f1)"
echo "  largest: $(find "$DST" -type f -exec stat -f '%z %N' {} \; | sort -nr | head -1 | awk '{printf "%.1f MiB  %s", $1/1048576, $2}')"
echo
echo "deploy with:"
echo "  npx wrangler pages deploy $DST --project-name noberu"
