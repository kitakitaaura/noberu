#!/usr/bin/env python3
"""Turn a fresh kirikiroid2-web CI build into the runtime files we ship.

Upstream is a personal fork that does not take pull requests, so every time we
pull a new build we re-apply these edits rather than carrying a patch there.

    gh run download <run-id> -R fenghengzhi/kirikiroid2-web -n web-build -D /tmp/krkr
    python3 strip-upstream.py /tmp/krkr

What it removes, and why:

  * Google Analytics. The stock page loads gtag on every start and reports to
    G-X4FRTWKHGR. noberu runs games off this device; it does not tell anyone
    what someone played. `gtag` stays as a no-op so any call site is harmless.
  * JSZip from cdn.jsdelivr.net. A third-party script tag, and it made the zip
    loading path need the network at all. The same version (3.10.1) is vendored
    next to this file.
  * The service worker and web app manifest. This runs in an iframe, its PWA
    cache is not wanted, and the registration failed here anyway.

It also injects the script tag for `noberu-glue.js` and the link to
`noberu-skin.css` (the loading and error overlays in noberu's look), both ours.

Website furniture in the artifact (sw.js, manifest.webmanifest, pwa/,
robots.txt, sitemap.xml, the Baidu site-verification page) is simply not
copied.
"""

import shutil
import sys
from pathlib import Path

RUNTIME_FILES = ["index.html", "index.js", "index.wasm", "vlfs.js", "assets.zip"]

GTAG_START = "<script>function gtag(){dataLayer.push(arguments)}"
GTAG_REPLACEMENT = (
    "<script>/* noberu: analytics removed; kept as a no-op for any call sites. */"
    "function gtag(){}</script>"
)
JSZIP_CDN = (
    "<script src=https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
    " crossorigin=anonymous></script>"
)
JSZIP_LOCAL = '<script src="jszip.min.js"></script>'
MANIFEST_LINK = "<link href=manifest.webmanifest rel=manifest>"
GLUE_TAG = '<script src="noberu-glue.js"></script>'
SAVEDATA_MKDIR = 'preRun:[function(){FS.mkdir("/savedata"),'
SAVEDATA_MKDIR_GUARDED = 'preRun:[function(){try{FS.mkdir("/savedata")}catch(e){}'
RUNTIME_TAG = '<script src="../assets/runtime.js"></script>'
SKIN_TAG = '<link rel="stylesheet" href="noberu-skin.css">'


def strip(html: str) -> tuple[str, list[str]]:
    done = []

    start = html.index(GTAG_START)
    end = html.index("</script>", start) + len("</script>")
    block = html[start:end]
    if "googletagmanager" not in block:
        raise SystemExit("analytics block found but it does not load gtag; check upstream")
    html = html[:start] + GTAG_REPLACEMENT + html[end:]
    done.append(f"analytics removed ({len(block)} bytes)")

    if JSZIP_CDN not in html:
        raise SystemExit("the JSZip CDN tag changed upstream; check its version")
    html = html.replace(JSZIP_CDN, JSZIP_LOCAL, 1)
    done.append("JSZip pointed at the local copy")

    count = html.count('"serviceWorker"in navigator')
    html = html.replace('"serviceWorker"in navigator', 'false&&"serviceWorker"in navigator')
    done.append(f"service worker disabled ({count} sites)")

    if MANIFEST_LINK in html:
        html = html.replace(MANIFEST_LINK, "", 1)
        done.append("manifest link removed")

    # The tab's entry point. It lives in its own file so this script can keep
    # overwriting index.html from upstream without losing it.
    if GLUE_TAG not in html:
        html = html.replace("</body>", GLUE_TAG + "</body>", 1)
        done.append("noberu glue injected")

    # preRun makes /savedata unguarded. When a game already has saves, the
    # restore (idbRestoreSaves) has created it by then, so the mkdir throws
    # EEXIST, preRun stops, and the engine sits on "Restoring saves..."
    # forever - every game's second launch.
    if SAVEDATA_MKDIR in html:
        html = html.replace(SAVEDATA_MKDIR, SAVEDATA_MKDIR_GUARDED, 1)
        done.append("preRun /savedata mkdir guarded")
    elif SAVEDATA_MKDIR_GUARDED not in html:
        raise SystemExit("preRun's /savedata mkdir changed upstream; check the restore path")

    # noberu's runtime hooks (master volume, sharp pixels) have to be in
    # place before the engine makes its AudioContext, so they go first in
    # <head>.
    if RUNTIME_TAG not in html:
        html = html.replace("<head>", "<head>" + RUNTIME_TAG, 1)
        done.append("runtime hooks injected")

    # noberu's look for the loading and error overlays. It has to come after
    # upstream's <style> to win, so it goes last in <head>.
    if SKIN_TAG not in html:
        html = html.replace("</head>", SKIN_TAG + "</head>", 1)
        done.append("noberu skin linked")

    return html, done


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)

    source = Path(sys.argv[1])
    here = Path(__file__).resolve().parent

    for name in RUNTIME_FILES:
        if not (source / name).is_file():
            raise SystemExit(f"{name} is missing from {source}")
        shutil.copy2(source / name, here / name)

    html, done = strip((here / "index.html").read_text(encoding="utf-8"))
    (here / "index.html").write_text(html, encoding="utf-8")

    for line in done:
        print("-", line)

    leftover = [
        line for line in html.splitlines()
        for marker in ("googletagmanager", "jsdelivr")
        if marker in line
    ]
    print("remaining third-party loads:", len(leftover))
    print("\nLoad it once and confirm every request is same-origin:")
    print('  performance.getEntriesByType("resource")'
          '.filter(e => new URL(e.name).origin !== location.origin)')


if __name__ == "__main__":
    main()
