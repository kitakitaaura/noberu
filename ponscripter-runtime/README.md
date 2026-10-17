# Local Ponscripter Runtime Artifacts

Build output from `~/Documents/Noberu/ponscripter`: chronotrig's
[ponscripter-fork-wh](https://github.com/chronotrig/ponscripter-fork-wh)
(GPLv2), the Ponscripter fork that Ciconia When They Cry ships with.
Ponscripter is an ONScripter descendant for Western-language games: it keeps
the NScripter archives (`.nsa`/`.sar`) but reads a UTF-8 script, `pscript.dat`
or `0.utf` and up.

- `ponscr.js` / `ponscr.wasm` — the engine (Emscripten, SDL2, ASYNCIFY, no
  threads, so no cross-origin isolation needed). Rebuild with
  `~/Documents/Noberu/ponscripter/build_web.sh install`, which copies both
  here. The engine patch is in `ponscripter/patches/`; the web-only C files
  (file access, movie decoding) are in `ponscripter/web/`.
- `pons.html` — the page loaded in an iframe by the "ponscripter" tab in
  `../index.html`. Host entry point:
  - `window.PonsInstallAndBoot(root, files)` — `files` is the `FileList` from
    the directory picker. The engine starts once per page, so the host
    reloads the iframe for every boot.

  Events go to the parent as
  `postMessage({ source: "ponscripter-runtime", type, ... })` with `type` one
  of `status`, `booting`, `running`, `exited`, `error`.

## How files are loaded

Ciconia's archives are over 1 GB each, too big to copy into the wasm heap the
way the onscripter tab does. Each picked file becomes an empty MEMFS
placeholder under `/game` (so the engine's case-correcting directory scan
finds it), and `fopen` is wrapped at link time (`web/webio.c`): a game file
opened for reading becomes an `fopencookie` stream that reads byte ranges of
the File on demand (`Blob.slice`, awaited through ASYNCIFY), with a 32 MB
block cache. The heap stays around 150 MB for the 3 GB game.

## Movies

The engine plays `.mpg` through smpeg, which needs threads. `web/smpeg_web.c`
implements the same API single-threaded with pl_mpeg (MPEG-1 video, MIT) and
minimp3 (MPEG audio layers I-III, CC0; Ciconia's movies use layer I, which
pl_mpeg can't decode). Frames are decoded when the engine polls the movie,
and the audio is resampled to the mixer's rate so the audio device is never
reopened (that would mean a new AudioContext, which autoplay rules can leave
silent).

## Saves

IDBFS mounted at `/pons` (its own IndexedDB database: the onscripter tab
owns `/save`, and an IDBFS sync deletes entries it doesn't know about), one
folder per game folder name. Ponscripter writes global variables, read-text
flags and settings only when the game quits, which a browser tab never does,
so the page calls the exported `pons_save_all()` whenever it is hidden, once
a minute, and 1.5 s after a save slot is written. That last one matters:
Ciconia marks a slot as used in a global variable right after `savegame`, and
a sync started while the page unloads doesn't finish, so without it a fresh
save shows as an empty slot after a reload.

## Dev

`pons.html?autoload=ciconia` boots the folder symlinked at `./ciconia`, listed
as `<size> <path>` lines in `ciconia_filelist.txt` (both gitignored). The
files are stand-ins that fetch byte ranges, which `serve-local.mjs` supports.
