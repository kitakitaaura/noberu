# Local ONScripter Runtime Artifacts

Build output from `~/Documents/Noberu/onscripter` (OnscripterYuri, an
ONScripter fork, GPLv2). ONScripter is an open reimplementation of NScripter,
so this runs NScripter games: Tsukihime, the original Higurashi and Umineko
releases, Narcissu, and most doujin visual novels that ship an `nscript.dat`
or `0.txt` plus `.nsa`/`.sar` archives.

- `onsyuri.js` / `onsyuri.wasm` — the engine (Emscripten, SDL2, ASYNCIFY).
  Rebuild with `~/Documents/Noberu/onscripter/build_web.sh install`, which
  copies both here. The engine patch is in `onscripter/patches/`.
- `assets/fallback.ttf` — Kosugi (SIL OFL), used when the game folder has no
  `default.ttf`. See the NOTICE file beside it.
- `ons.html` — the page loaded in an iframe by the "onscripter" tab in
  `../index.html`. Host entry point:
  - `window.ONSInstallAndBoot(root, files, { encoding })` — `files` is the
    `FileList` from the directory picker; `encoding` is `auto`, `sjis` or
    `gbk`. The engine starts once per page, so the host reloads the iframe
    for every boot.

  Events go to the parent as
  `postMessage({ source: "onscripter-runtime", type, ... })` with `type` one
  of `status`, `booting`, `running`, `loaded`, `exited`, `error`.

## How files are loaded

Nothing is copied up front. Each picked file becomes an empty placeholder in
MEMFS under `/game`, so the engine's case-insensitive directory scan still
finds it. The first time the engine opens a file for reading, the patched
`fopen_ons` hook waits (via ASYNCIFY) while the page reads that File into
MEMFS. Files the game never opens (Windows DLLs, unused movies) are never
read. Movies are played by a `<video>` element; one that hasn't been loaded
yet plays straight from its File.

Once a file is loaded it stays in memory for the session. That means a game
whose archives are huge (several GB of `.nsa`) still needs that much memory.

## Script encoding

This fork decodes scripts as GBK unless told otherwise. With `auto`, the
page samples `0.txt`/`00.txt` or `nscript.dat` (XOR 0x84) and picks Shift-JIS
when kana show up or the text decodes cleanly, else GBK. English-only
scripts come out as Shift-JIS, which is fine. Encrypted `nscr_sec.dat` /
`onscript.nt2` / `nt3` scripts can't be sampled and default to Shift-JIS.

When a Shift-JIS script is mostly backtick (1-byte) lines, the page also
passes `--english-menu` (a local engine patch). The save/load menus and
yes/no dialogs then use ONScripter-EN's English text and ASCII numbers.
The fork's Japanese defaults need full-width glyphs that English fan
releases' fonts often lack. Tsukihime's font has only 97 glyphs, for example,
so those menus showed up as rows of boxes.

## Keyboard menus

Up/down in menus and choices move a highlight between buttons. Upstream does
that by warping the mouse onto the next button (`shiftCursorOnButton` →
`warpMouse`), and SDL's emscripten backend cannot warp the pointer: the call
is a no-op, so arrows did nothing here while they work in the Windows build.
The local patch makes `warpMouse` post the equivalent `SDL_MOUSEMOTION` on
the web build instead. The phone d-pad (assets/touch.js) goes through the
same path.

## Saves

`/save` is IDBFS. Each game saves to `/save/<folder name>`, and the engine
flushes it to IndexedDB after every save, plus once more on unload.

## Dev

`ons.html?autoload=testgame` boots the folder symlinked at `./testgame`
(currently Narcissu, `~/narcissu_pkg`), using the `<size> <path>` list in
`testgame_filelist.txt`, without the folder picker.
