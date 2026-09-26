# Local Ren'Py Runtime Artifacts

Nothing here was ported. Ren'Py ships an official Emscripten target, and these
are the stock files from its web support packages
(`renpy.org/dl/<version>/renpy-<version>-web.zip`).

There are two of them, because Ren'Py 8 runs Python 3 and Ren'Py 7 runs
Python 2 and neither can load the other's compiled bytecode. The "ren'py" tab
in `../index.html` reads `game/script_version.txt` and loads the matching page:

| | Ren'Py 8 | Ren'Py 7 and older |
|---|---|---|
| page | `renpy.html` | `renpy7.html` |
| engine | `renpy.js` / `renpy.wasm` / `renpy.data` | `v7/index.js` / `v7/index.wasm` / `v7/*.data` |
| engine zip | `engine-8.5.3.zip` | `v7/engine-7.8.7.zip` |
| version | 8.5.3 | 7.8.7 |

Shared:

- `stage.js`: builds the `game.zip` both runtimes boot from (below).
- `dev.js`: the `?autoload=` path, dev only.

`renpy.html` is written here around Ren'Py's own `renpy-pre.js`. `renpy7.html`
*is* Ren'Py's own 7.8.7 `index.html`, whose bootstrap is inline rather than in
a pre-js, with four edits — all marked in the file:

1. `DEFAULT_GAME_FILENAME` starts null and is set to the staged blob URL.
2. The `index.js` script tag is dropped; the glue loads it once staging is done.
3. `Module.locateFile` and the two `*-data.js` script tags point at `v7/`.
   Without this Python starts with no standard library ("No module named
   site") and the engine quits before the game is ever extracted.
4. Host glue appended at the end.

No cross-origin isolation needed: neither build uses threads.

## How it runs

Ren'Py's web build expects a developer to have run a "Web (Beta)" build, which
emits a `game.zip` holding the engine *and* the game together. We only ship the
engine half of that zip; `stage.js` writes the picked game folder into the
engine's filesystem directly, from a run dependency the engine waits on.

- **Why not a zip:** Ren'Py never frees it. `/game.zip` is still in the
  filesystem once the game is running, next to the unpacked copy, so a 1.4 GB
  game costs 2.8 GB. Installing the files instead stores each one once, and
  skips the CRC32 pass a zip needs over every byte. Measured on the test game:
  `/game.zip` went from the whole game to the 4 MB engine zip.
- **Memory:** `FS.writeFile(..., { canOwn: true })` hands the browser's own
  buffer to the filesystem rather than copying it in, and files are read one at
  a time, so the peak is the largest single file rather than the whole game.
- **Saves:** both runtimes mount IDBFS at `/home/web_user/.renpy`, which is its
  own IndexedDB database (rlvm's is `/home`, so they do not collide). Ren'Py
  gives each game a folder named after its `config.save_directory` and calls
  `syncfs()` itself after writing, so nothing here has to push saves out.
  `assets/saves.js` lists that database, skipping Ren'Py's `tokens` folder
  (save-signing keys, not a game). Verified end to end: save from the in-game
  menu, reload the page, load the slot back.
- **Rendering:** WebGL via Ren'Py's GLES renderer. Single-threaded, so
  background image preloading is unavailable and loading can hitch.
- **Render scale:** both pages override `window.devicePixelRatio` before the GL
  context exists. Left alone, SDL sizes the canvas by the browser's ratio, so a
  1080p game renders at 3840x2160 on a Retina screen - 4x the pixels - and is
  then scaled straight back down to fit. With no threads, that lands on the one
  frame thread. `?scale=N` sets the override (the tab's "render scale" control
  passes it); `?scale=native` restores the browser's ratio. Measured on the
  1280x720 test game: native 2560x1440 (3.7 MP), 1x 1280x720 (0.9 MP), 0.5x
  640x360 (0.2 MP). Forcing 1x also fixes the canvas being stretched off its
  aspect ratio.

- **Shift+G (graphics) in the browser:** only half of that screen applies here.
  `renpy/common/00gltest.rpy` offers the GL2 renderer only off Emscripten and
  "Force ANGLE2" only on Windows, so in a browser the renderer is always
  `gles2` — confirmed at runtime: `{'renderer': 'gles2', 'models': True,
  'gpu_driver_version': 'OpenGL ES 3.0 (WebGL 2.0 ...)'}`. Choosing it changes
  nothing. Powersave and the framerate cap are real, so both pages turn
  powersave off and leave the framerate on the screen's rate once the game has
  drawn its first frame. The player can still change both from Shift+G.

## Host interface

Both pages expose the same thing, so the tab does not care which one it got:

- `window.RenPyInstallAndBoot(root, files)`, where `files` is the `FileList`
  from the directory picker.
- Events go to the parent as
  `postMessage({ source: "renpy-runtime", type, ... })` with `type` one of
  `status`, `booting`, `running`, `warning` and `error`.

`running` means the game has drawn its first frame (Ren'Py calls
`presplashEnd()`), not that the engine script loaded.

## Limits

- **Ren'Py 6 is untested.** The 7.8.7 runtime is there for DDLC (6.99.12.4) and
  Katawa Shoujo, but only a 7.8.7 game has actually been run through it. Ren'Py
  7 is the direct continuation of 6.99 on the same Python 2, so it should load
  them; if it does not, the oldest published web package is 7.3.5, which is one
  release off 6.99.13 and can be dropped in as a third runtime the same way.
- **Size.** The whole game still has to fit in memory at once; there is no
  lazy reading. Past `BIG_GAME_BYTES` the tab warns and boots anyway — 1.2 GB
  on 8.x, 900 MB on the older 7.x build.
- Video is limited to formats the browser plays, and Live2D does not work.

Going below that means Ren'Py's progressive download path
(`renpy/webloader.py`): files listed in `game/renpyweb_remote_files.txt` are
indexed as present, `load_from_remote_file` raises `DownloadNeeded` when one is
opened, and webloader fetches it by XHR from the document-relative `game/<path>`
and unlinks it again later. Serving those from the picked `File`s would keep a
big game out of memory entirely.

The catch is archives: `index_archives()` opens every `.rpa` at startup, so an
archive can never be remote — only loose files can. A `.rpa`-packed game (Katawa
Shoujo Re-Engineered is five archives, 1.4 GB, 779 MB of it `images.rpa`) would
first need its archives read in JS: RPA-3.0 is a header line with the index
offset and XOR key, then a zlib-compressed pickle of `{path: [(offset, length,
prefix)]}`. With `fflate` (already vendored) each entry could be exposed as a
`Blob` slice of the original file, the way onscripter-ru reads its game data.
Ren'Py wants pixel dimensions for remote images, so image headers would have to
be parsed too.

## Rebuilding an engine zip

From a Ren'Py SDK of the matching version with its web package installed at
`<sdk>/web`:

```sh
<sdk>/renpy.sh launcher web_build <sdk>/the_question --dest /tmp/out
mkdir /tmp/zx && cd /tmp/zx && unzip -q /tmp/out/game.zip
zip -qr -X -9 engine-<version>.zip renpy main.py
```

The `game/`, `_placeholders/` and `the_question.py` entries are the sample
game's and are left out. Bump `ENGINE_ZIP` and `ENGINE_VERSION` in the matching
page. The runtime files (`renpy.*`, or `index.*` and `*.data` for 7.x) come
from the same `/tmp/out`.

## Dev

`renpy.html?autoload=testgame` and `renpy7.html?autoload=testgame7` boot the
folders symlinked at `./testgame` (`~/Downloads/RenPyTestGame`) and
`./testgame7` (`~/Downloads/RenPy7TestGame`) — each SDK's "The Question" with
its progressive assets folded back in — over plain HTTP, using
`<name>_filelist.txt` (`<size> <path>` lines, paths relative to the folder).
That mode downloads whole files, so it uses more memory than a picked folder.

As in the other tabs, move the mouse before clicking: SDL takes a click's
position from the last mouse move, so a click without one lands nowhere.
