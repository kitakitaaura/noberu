#!/usr/bin/env python3
"""Turn a fresh kirikiroid2-web CI build into the runtime files we ship.

Upstream is a personal fork that does not take pull requests, so every time we
pull a new build we re-apply these edits rather than carrying a patch there.

    gh run download <run-id> -R fenghengzhi/kirikiroid2-web -n web-build -D /tmp/krkr
    python3 strip-upstream.py /tmp/krkr

Our fork (kitakitaaura/kirikiroid2-web, branch noberu) also builds the engine
without WebAssembly JSPI for Safari before 27, in the artifact's nojspi/. When
that folder is there it is stripped the same way into nojspi/ here, with the
shared files (glue, skin, JSZip) loaded from this folder. `--nojspi-only`
updates nojspi/ and leaves the main build alone.

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
# Pages in nojspi/ load these with "../" in front (see tags()).
JSZIP_LOCAL = '<script src="jszip.min.js"></script>'
MANIFEST_LINK = "<link href=manifest.webmanifest rel=manifest>"
GLUE_TAG = '<script src="noberu-glue.js"></script>'
SAVEDATA_MKDIR = 'preRun:[function(){FS.mkdir("/savedata"),'
SAVEDATA_MKDIR_GUARDED = 'preRun:[function(){try{FS.mkdir("/savedata")}catch(e){}'
RUNTIME_TAG = '<script src="../assets/runtime.js"></script>'
SKIN_TAG = '<link rel="stylesheet" href="noberu-skin.css">'
SAVE_PATH_TEST = 'function isSaveStoragePath(e){return e.startsWith("/savedata/")'
SAVE_PATH_WIDER = (
    'function isSaveStoragePath(e){if(window.__noberuSaveDirs&&'
    'window.__noberuSaveDirs.some(function(d){return e.startsWith(d)}))return!0;'
    'return e.startsWith("/savedata/")'
)


def tags(up: str) -> dict[str, str]:
    """Our tags for a page `up` ("" or "../") below kirikiri-runtime/."""
    return {
        "jszip": JSZIP_LOCAL.replace('src="', 'src="' + up),
        "glue": GLUE_TAG.replace('src="', 'src="' + up),
        "runtime": RUNTIME_TAG.replace('src="', 'src="' + up),
        "skin": SKIN_TAG.replace('href="', 'href="' + up),
    }


def strip(html: str, up: str = "") -> tuple[str, list[str]]:
    done = []
    tag = tags(up)

    start = html.index(GTAG_START)
    end = html.index("</script>", start) + len("</script>")
    block = html[start:end]
    if "googletagmanager" not in block:
        raise SystemExit("analytics block found but it does not load gtag; check upstream")
    html = html[:start] + GTAG_REPLACEMENT + html[end:]
    done.append(f"analytics removed ({len(block)} bytes)")

    if JSZIP_CDN not in html:
        raise SystemExit("the JSZip CDN tag changed upstream; check its version")
    html = html.replace(JSZIP_CDN, tag["jszip"], 1)
    done.append("JSZip pointed at the local copy")

    count = html.count('"serviceWorker"in navigator')
    html = html.replace('"serviceWorker"in navigator', 'false&&"serviceWorker"in navigator')
    done.append(f"service worker disabled ({count} sites)")

    if MANIFEST_LINK in html:
        html = html.replace(MANIFEST_LINK, "", 1)
        done.append("manifest link removed")

    # The tab's entry point. It lives in its own file so this script can keep
    # overwriting index.html from upstream without losing it.
    if tag["glue"] not in html:
        html = html.replace("</body>", tag["glue"] + "</body>", 1)
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
    if tag["runtime"] not in html:
        html = html.replace("<head>", "<head>" + tag["runtime"], 1)
        done.append("runtime hooks injected")

    # Only /savedata/ and /save/ are kept between visits, but a KAG game can
    # save anywhere (Config.tjs saveDataLocation; Novectacle's use
    # house_save/), and those saves were lost on reload. noberu-glue.js adds
    # the game's own folder to window.__noberuSaveDirs once KAG reports it.
    if SAVE_PATH_WIDER not in html:
        if SAVE_PATH_TEST not in html:
            raise SystemExit("isSaveStoragePath changed upstream; check which saves are kept")
        html = html.replace(SAVE_PATH_TEST, SAVE_PATH_WIDER, 1)
        done.append("save folders widened")

    # noberu's look for the loading and error overlays. It has to come after
    # upstream's <style> to win, so it goes last in <head>.
    if tag["skin"] not in html:
        html = html.replace("</head>", tag["skin"] + "</head>", 1)
        done.append("noberu skin linked")

    return html, done


def install(source: Path, target: Path, up: str) -> None:
    """Copy one build's runtime files from `source` and strip its page."""
    for name in RUNTIME_FILES:
        if not (source / name).is_file():
            raise SystemExit(f"{name} is missing from {source}")
    target.mkdir(exist_ok=True)
    for name in RUNTIME_FILES:
        shutil.copy2(source / name, target / name)

    html, done = strip((target / "index.html").read_text(encoding="utf-8"), up)
    (target / "index.html").write_text(html, encoding="utf-8")

    print(f"{target.name}/:")
    for line in done:
        print("-", line)

    leftover = [
        line for line in html.splitlines()
        for marker in ("googletagmanager", "jsdelivr")
        if marker in line
    ]
    print("remaining third-party loads:", len(leftover))


def main() -> None:
    args = sys.argv[1:]
    nojspi_only = "--nojspi-only" in args
    args = [a for a in args if a != "--nojspi-only"]
    if len(args) != 1:
        raise SystemExit(__doc__)

    source = Path(args[0])
    here = Path(__file__).resolve().parent

    if not nojspi_only:
        install(source, here, "")
    if (source / "nojspi").is_dir():
        install(source / "nojspi", here / "nojspi", "../")
    elif nojspi_only:
        raise SystemExit(f"{source} has no nojspi/ build")

    print("\nLoad it once and confirm every request is same-origin:")
    print('  performance.getEntriesByType("resource")'
          '.filter(e => new URL(e.name).origin !== location.origin)')


if __name__ == "__main__":
    main()
