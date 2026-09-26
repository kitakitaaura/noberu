# Local onscripter-ru Runtime Artifacts

Build output from `~/Documents/Noberu/onscripter-ru`: onscripter-ru, the
Umineko Project's ONScripter fork, built to wasm with pthreads. It runs the
Umineko Project release, whose scripts are compiled `.file`s (`en.file`,
`ru.file`, `chiru.file`). Plain NScripter games belong in the "onscripter" tab.

- `onscripter-ru.js` / `onscripter-ru.wasm`: the engine. Rebuild with
  `~/Documents/Noberu/onscripter-ru/build_web.sh install` (dependencies come
  from `build_deps.sh`; the engine patch is in `onscripter-ru/patches/`).
- `onscripter-ru.html`: the page loaded in an iframe by the "umineko" tab in
  `../index.html`. Host entry point:
  - `window.ONSRUInstallAndBoot(root, files)`, where `files` is the `FileList`
    from the directory picker.

  Events go to the parent as
  `postMessage({ source: "onscripter-ru-runtime", type, ... })` with `type` one
  of `status`, `booting`, `running`, `relaunch` (the host boots a fresh
  iframe), `exited` and `error`.

The page must be cross-origin isolated (`serve-local.mjs` sends COOP/COEP),
because the engine uses SharedArrayBuffer threads.

## How it runs

- **Threads:** `main()` runs on a worker (`PROXY_TO_PTHREAD`), so the engine can
  block the way it does on desktop.
- **Files:** nothing is copied. Each picked File gets a `blob:` URL, and the
  engine's `/game` is a read-only WasmFS backend. Sizes are known up front, and
  each read slices the File on a dedicated worker. Umineko is about 102k files
  and 12 GB, and only what the game touches is ever read.
- **Rendering:** the engine renders into its own OffscreenCanvas; EGL runs on
  its thread (`web/gen_egl.py`). Each finished frame is sent here as an
  ImageBitmap and drawn into the visible canvas.
- **Saves:** `/save/<folder name>` is OPFS, which persists. `ons.cfg` lives
  there too, because the game folder is read-only.

## Resource limits

An early build brought a 16 GB Mac down. The guards now in place:

- **Frame pacing:** the engine waits until this page has drawn the previous
  frame (a shared `pending` flag) and drops frames rather than queueing them.
- **Pixel density:** `devicePixelRatio` is forced to 1, so the canvas is not
  rendered at 2× on Retina screens.
- **Engine caches:** `--ramlimit 1024` sizes the engine's image and sound
  caches; it cannot detect RAM in a browser.
- **Wasm memory:** capped at 2 GB, and retained Blob handles are bounded.
- **CPU:** the frame loop sleeps rather than busy-waits. Expect roughly a
  quarter of one core on animated screens.

## First launch

Umineko checks every file once ("Game file verification"). It only compares
sizes, so nothing is read. Right-click to continue. The desktop first-run
screen (window size, fullscreen) is skipped with `--env[first_launch] passed`.
In the game, move the mouse before clicking: SDL takes a click's position from
the last mouse move.

## Dev

`onscripter-ru.html?autoload=testgame` boots the folder symlinked at
`./testgame` (`~/Downloads/Umineko`) over plain HTTP, using
`testgame_filelist.txt`. HTTP reads download whole files, so that mode uses
more memory than a picked folder does.
