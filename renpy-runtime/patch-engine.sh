#!/bin/sh
# Adds noberu_patches.py to a Ren'Py engine zip and has main.py import it
# before Ren'Py starts. Safe to run again on an already patched zip.
#
#   sh patch-engine.sh engine-8.5.3.zip
#   sh patch-engine.sh v7/engine-7.8.7.zip
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ZIP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
unzip -q "$ZIP" main.py
cp "$HERE/noberu_patches.py" noberu_patches.py

if ! grep -q "import noberu_patches" main.py; then
  python3 - main.py <<'EOF'
import sys
path = sys.argv[1]
source = open(path).read()
anchor = "    # Start Ren'Py proper.\n"
if anchor not in source:
    sys.exit("main.py has changed: no \"# Start Ren'Py proper.\" to patch before")
hook = (
    "    # noberu: fixes for shipped desktop games (noberu_patches.py).\n"
    "    try:\n"
    "        import noberu_patches\n"
    "    except Exception as error:\n"
    "        print(\"noberu: patches not loaded: %r\" % (error,))\n"
    "\n"
)
open(path, "w").write(source.replace(anchor, hook + anchor, 1))
EOF
fi

zip -q -X -9 "$ZIP" main.py noberu_patches.py
echo "patched $ZIP"
