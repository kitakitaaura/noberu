# Local KiriKiri Runtime Artifacts

A WebAssembly build of **Kirikiroid2** (the engine behind the Android app of the
same name), from the CI of
[fenghengzhi/kirikiroid2-web](https://github.com/fenghengzhi/kirikiroid2-web).
Nothing here was ported.

The other candidate, [krkrsdl2](https://github.com/krkrsdl2/krkrsdl2), is the
cleaner project but the wrong one for this tab: its README says outright that
unmodified commercial games are not supported, its `src/plugins/` holds no
plugin reimplementations, and plugins load through `SDL_LoadObject`, which
cannot load a Windows `.dll`. Commercial KiriKiri games call
`Plugins.link("*.dll")` constantly. Kirikiroid2 reimplements ~30 of those
plugins natively, which is why it runs them.

- `index.js` / `index.wasm`: the engine (~22 MB).
- `vlfs.js`: upstream's lazy virtual filesystem. Sources are `blob`, `fsa`
  (File System Access), `remote` (HTTP Range), `zip` and `overlay`, so a game
  is read on demand instead of being loaded up front.
- `assets.zip`: the engine's own UI assets.
- `jszip.min.js`: v3.10.1, vendored (see below).
- `index.html`: upstream's page with the edits `strip-upstream.py` makes.
- `noberu-glue.js`: ours. The page loaded in an iframe by the "kirikiri" tab in
  `../index.html`. Host entry point:
  - `window.KrKrInstallAndBoot(root, files)`, where `files` is the `FileList`
    from the directory picker.

  Events go to the parent as
  `postMessage({ source: "kirikiri-runtime", type, ... })` with `type` one of
  `status`, `booting`, `running` and `error`. `running` means the canvas has a
  size, not just that `startGame()` returned.

  It registers every picked file with VLFS as a `blob` source, so each archive
  is read with `.slice()` only when the engine opens it - nothing is copied and
  a 5 GB game stages in seconds. Upstream asks the player which archive to
  start from when a folder holds several; the glue picks `data.xp3` (then
  `startup.xp3`, `patch.xp3`, then the shallowest name) so the question never
  comes up. Saves go to upstream's per-game "space", named after the game
  folder.

## Getting a build

There are no releases; take the CI artifact, which needs no local toolchain:

```sh
gh run list -R fenghengzhi/kirikiroid2-web --workflow "Build Web" --status success --limit 1
gh run download <run-id> -R fenghengzhi/kirikiroid2-web -n web-build -D /tmp/krkr
python3 strip-upstream.py /tmp/krkr
```

Upstream is a personal fork that does not accept pull requests, so the edits
are re-applied to each new build rather than carried upstream.

## What is stripped, and why

- **Google Analytics.** The stock page loads gtag on every start and reports to
  `G-X4FRTWKHGR`. noberu plays games off this device and does not tell anyone
  what was played. `gtag` is left as a no-op so any call site stays harmless.
- **JSZip from `cdn.jsdelivr.net`.** A third-party script tag, and it made the
  zip loading path depend on the network. The same version is vendored here.
- **The service worker and web app manifest.** This runs in an iframe, its PWA
  cache is unwanted, and the registration failed here anyway.
- `sw.js`, `manifest.webmanifest`, `pwa/`, `robots.txt`, `sitemap.xml` and the
  Baidu site-verification page are website furniture and are not copied.

After any update, load it once and confirm nothing reaches off-origin:

```js
performance.getEntriesByType("resource")
  .filter(e => new URL(e.name, location.href).origin !== location.origin)
```

## Requirements

Unlike the Ren'Py runtimes, this build uses threads, so the page must be
**cross-origin isolated** (COOP/COEP) for SharedArrayBuffer — `serve-local.mjs`
already sends those headers.

## Status

Verified through the tab: staging Nekopara's `data.xp3` reaches the language
screen, with the engine reporting `running nekopara_vol4 (802x602)`, its
startup archive resolved to `/data.xp3` and its save space opened as
`krkr2-space-nekopara_vol4`.

Saves persist and the saves panel lists them. This engine does not use IDBFS
like the other runtimes: it creates one database per game,
`krkr2-space-<game folder>`, with a `files` store keyed by absolute path
holding raw bytes, no directory records and no timestamps. `assets/saves.js`
discovers those databases by prefix and reads that shape, so export, import and
delete work as they do for every other runtime; saves show as "date unknown"
because the store keeps no timestamps. Deleting also drops the game from the
runtime's own `krkr2-spaces` list in localStorage. A running game holds its
database open, and a delete then waits on it - the panel says so rather than
hanging, and the delete completes by itself once the game is closed.

Verified directly (driving the engine, not the tab): **Nekopara vol.4 plays** — language select, title screen, the opening
choice, then dialogue with voice — reading its 5.1 GB of `.xp3` lazily. That
game ships 27 plugin DLLs including E-mote's `emotedriver`/`motionplayer`, so
the plugin layer carries a modern commercial title.

Fate/stay night Réalta Nua *Ultimate Edition* does not get in yet: it runs
Fate's own TJS stack and reads its `config.ksc`, then spins re-parsing that file
and never reaches the title. That edition is a switches-driven fan megapatch
across 19 archives and 15 GB, so it is an unusually awkward target rather than
proof of a limit.

## Driving it without the folder picker (dev)

A real tab uses VLFS's `fsa` source through the directory picker. For automated
testing, serve the build and a game folder from one cross-origin-isolated,
Range-capable origin, then per archive:

```js
VLFS.registerRemote("/data.xp3", "/game/data.xp3", sizeInBytes, true);
startGame();
```

## The prelude (noberu-glue.js)

The startup archive (usually `data.xp3`) is handed to the engine with one
script of ours in front of the game's: a Blob of the original file plus a new
`startup.tjs` and a rebuilt index, the game's own `startup.tjs` renamed
`startup_game.tjs`. Nothing is copied. The prelude:

- sets `KIRIKIROID=1`. This engine is Kirikiroid2 but reports osName "Linux",
  so scripts written for Kirikiroid2 (Fate/stay night Réalta Nua Ultimate
  Edition uses `@if(KIRIKIROID)`) took their desktop path, which calls
  functions this build lacks - the UE looped forever on its save-folder check.
- links `fstat.dll` and makes `Storages.dirlist` also list the picked files.
  The plugin lists only the engine's in-memory filesystem, so a game that
  finds its archives by listing its folder (the UE mounts `image.xp3` and
  every `patch_*.xp3` that way) found none.
- answers the registry's `LocaleName` with the browser's language, so games
  that pick their language from it (the UE) start in English, not Japanese.

Verified with Fate/stay night Réalta Nua UE 1.14 (25.7 GB): boots, plays in
English, game menu on Esc, save, reboot, load. Known issue: English lines
sometimes break mid-word at the right edge (the UE's word wrap and the
engine's line width disagree).

`index.html` also gets `preRun`'s `/savedata` mkdir guarded
(strip-upstream.py): with saves present the restore creates it first, the
unguarded mkdir threw, and every game's second launch hung on "Restoring
saves...".

## Look

`noberu-skin.css` re-skins upstream's loading, error and picker overlays in
noberu's colours (black stage, monospace status, one blue accent) and hides the
"Kirikiroid2 Web" title. `strip-upstream.py` links it last in `<head>` so it
wins over upstream's `<style>`. The glue renames the error button to "Reload"
and makes it only reload the frame: upstream's "Force Update" deletes every
Cache Storage entry on the origin, which here would be every runtime's.

## Enter

Upstream's web build drops the Enter key: SDL maps Return to cocos
`KEY_ENTER`, and `CCKeyCodeConv.cpp` maps `KEY_ENTER` to 0 (only `KEY_KP_ENTER`
becomes `VK_RETURN`, which SDL never produces). Numpad Enter is lost the same
way. The glue catches Enter in a window capture listener and sends Space in
its place, which KAG games treat the same (advance text, press the focused
button). The touch pad's and controllers' A button send Enter, so this is what
makes them work here. A real fix is a one-line case in `CCKeyCodeConv.cpp` and
an engine rebuild.
