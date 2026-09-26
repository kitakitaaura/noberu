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
