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
    the tab's directory picker. Nothing is read up front: every file becomes a
    MEMFS placeholder under `/game` that reports its real size but holds no
    data, then `rlvm_start()` is called.

  Status/booting/running/error events are forwarded to the parent page via
  `postMessage({ source: "rlvm-runtime", type, ... })`, same convention as
  `../vnds-runtime/` and `../boxedwine-runtime/`.

## On-demand files

rlvm reads files synchronously and used to get the whole game copied into
memory first. A phone's tab is killed long before Clannad's 5 GB fits, so now
the engine's `openat` syscall is replaced (`Noberu/wasm/lazyfs.js`): opening a
placeholder first reads that one file in, then the open proceeds.

- **Synchronous read.** A synchronous `XMLHttpRequest` of a `blob:` URL of the
  file, in 8 MB pieces, as `x-user-defined` text. Not ASYNCIFY: rlvm uses
  Emscripten's JS-based C++ exceptions, whose `invoke_*` trampolines ASYNCIFY
  cannot suspend through, so pausing mid-open trapped.
- **Budget.** Loaded files are kept most-recently-opened first, up to 256 MB
  on touch devices and 1 GB elsewhere; past it, files that are not open are
  dropped and reread when next opened. The file being opened is never the
  one dropped. `Module.lazyFS.stats()` / `setBudget()` exist for testing.
- **Measured** with Clannad (Steam, 3,922 files, 5.1 GB): the title screen
  needs about 10 MB, the prologue about 40 MB. With the budget forced down to
  20 MB it kept playing through 77 drop-and-reload cycles.

Saves (`/home`) are mounted through IDBFS and flushed to this browser's
IndexedDB every five seconds and on unload, so in-game saves survive a reload.
Game files themselves are not persisted here: the folder is staged again each
session, and files are read from it as the game opens them.

## Game folder format

Pick the folder holding `Gameexe.ini` and `Seen.txt`/`SEEN.TXT` (some releases
put these in a `KINETICDATA`/`REALLIVEDATA` subfolder — pick that one). Voice,
music and image archives referenced by the script must sit in their usual
subfolders next to it.

Known gap: Steam re-releases (`#DLL.000="RealLiveSteam"` in `Gameexe.ini`, e.g.
CLANNAD English HD) run, but their English text is laid out by rlvm's Japanese
rules, since rlvm stubs out that Steam DLL.
