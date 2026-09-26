# Local rlvm Runtime Artifacts

Build output from `~/Documents/Noberu/wasm/build` (see `~/Documents/Noberu` for
the engine sources, patches and build scripts). rlvm is a clone of VisualArt's
RealLive engine, so this runs Key's RealLive-era games: Kanon, Air, Clannad,
Little Busters, Planetarian and the like. Gitignored: the wasm/js build is a
large build artifact, not source.

- `rlvm.js` / `rlvm.wasm` — the rlvm engine itself (Emscripten build, SDL2 +
  WebGL). Rebuild with `cmake --build wasm/build` in the Noberu checkout and
  copy both files here.
- `assets/fallback.ttf` — Kosugi (SIL Open Font License), used when a game
  folder has no `msgothic.ttc` of its own. See the NOTICE file beside it.
- `rlvm.html` — the page loaded in an iframe by the "rlvm" tab in
  `../index.html`. It owns the Emscripten module, the virtual filesystem and
  save persistence, and exposes one host-callable function:
  - `window.RLVMInstallAndBoot(root, files)` — `files` is the `FileList` from
    the tab's directory picker. The whole game folder is read here (16 reads in
    flight, with retries) and written into MEMFS under `/game`, the bundled
    fallback font into `/fonts`, then `rlvm_start()` is called. Reading in the
    runtime rather than the host page means a multi-gigabyte game is held in
    memory once instead of twice.

  Status/booting/running/error events are forwarded to the parent page via
  `postMessage({ source: "rlvm-runtime", type, ... })`, same convention as
  `../vnds-runtime/` and `../boxedwine-runtime/`.

Saves (`/home`) are mounted through IDBFS and flushed to this browser's
IndexedDB every five seconds and on unload, so in-game saves survive a reload.
Game files themselves are not persisted: the folder is staged again each
session, which keeps everything in memory for the whole session and avoids
per-file fetch latency while playing.

## Game folder format

Pick the folder holding `Gameexe.ini` and `Seen.txt`/`SEEN.TXT` (some releases
put these in a `KINETICDATA`/`REALLIVEDATA` subfolder — pick that one). Voice,
music and image archives referenced by the script must sit in their usual
subfolders next to it.

Known gap: Steam re-releases (`#DLL.000="RealLiveSteam"` in `Gameexe.ini`, e.g.
CLANNAD English HD) run, but their English text is laid out by rlvm's Japanese
rules, since rlvm stubs out that Steam DLL.
