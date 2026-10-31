# Local Ren'Py Runtime Artifacts

Nothing here was ported. Ren'Py ships an official Emscripten target, and these
are the files from its web support packages
(`renpy.org/dl/<version>/renpy-<version>-web.zip`), with two small edits to
the Emscripten glue (`patch-glue.py`, below) and noberu's Python patches in
the engine zips (`noberu_patches.py`).

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
- `noberu-crash-report.js`: a phone browser that runs out of memory reloads
  the tab without a word. While a game runs, this keeps the wasm heap (and
  each time it grew, with the line on screen), live GL textures and decoded
  audio (and their peaks), the block cache, the last line and the browser in
  localStorage every second; if the next boot finds the last run never closed
  normally, a card in the frame shows them.
- `noberu-audio.js`: Ren'Py's web audio decodes a whole track (~50 MB a
  song) every time it is queued, unless that file is already loaded on the
  channel. This hands back the buffer already decoded from the same bytes
  while it is still alive (a WeakRef, so it keeps nothing alive itself), and
  shares a decode already in progress. It also lets go of each sound as soon
  as Ren'Py is done with it (no channel has it playing or queued, every
  source that played it has ended). In WebKit that is the fix for iPhone
  reloads: WebKit keeps every source that ever had an `onended` handler
  alive for good, and Ren'Py gives each source one, made inside
  `renpyAudio.queue()` so that it keeps the queue entry and its song
  reachable. Every song decoded stayed in memory (961 MB a minute into
  Katawa Shoujo). So those sources get their handler and buffer cleared,
  and the collector is nudged (a dropped, never-written 256 MB ArrayBuffer)
  until the song is gone. Where the browser allows it (Chrome), the sample
  data is transferred away and freed at once. Any tap or key also resumes
  Ren'Py's audio context, which iOS starts only from a gesture. Ren'Py's
  channels come from a getter `noberu_patches.py` appends to `_audio.js`.
  The crash card counts decodes, reuses, releases and collections, and names
  the files decoded most.
- `noberu-loading.js`: the loading screen, in noberu's style (the same look
  as kirikiri-runtime's `noberu-skin.css`): noberu's wordmark, a hairline bar
  and one line of status in the middle, an error card when something fails. Ren'Py's own
  status boxes are hidden while the game loads; what the engine prints after
  that shows as a small card at the bottom.
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
- **Files read as needed** (`stage.js`): files of 512 KB or more (in practice
  the `.rpa` archives) are placeholders that report their real size and read
  their bytes from the picked `File` when Ren'Py asks, in 1 MB blocks kept in
  a least-recently-used cache (192 MB, 24 MB on touch screens). Ren'Py reads
  synchronously, so a block is read with a synchronous `XMLHttpRequest` of a
  `blob:` URL, as rlvm-runtime does. Each request starts with one padding
  byte: text decoding sniffs for a byte order mark even under
  `x-user-defined`, and a block starting `FF FE` came back as UTF-16 at half
  its length. A file the game writes to is read in whole first and becomes an
  ordinary file. Smaller files are written in whole with `canOwn`. KSRE went
  from 1.4 GB of buffers to ~120 MB.
- **Saves:** both runtimes mount IDBFS at `/home/web_user/.renpy`, which is its
  own IndexedDB database (rlvm's is `/home`, so they do not collide). Ren'Py
  gives each game a folder named after its `config.save_directory` and calls
  `syncfs()` itself after writing, so nothing here has to push saves out.
  `assets/saves.js` lists that database, skipping Ren'Py's `tokens` folder
  (save-signing keys, not a game). Verified end to end: save from the in-game
  menu, reload the page, load the slot back.
- **Rendering:** WebGL via Ren'Py's GLES renderer. Single-threaded, so
  background image preloading is unavailable and loading can hitch.
- **Glue edits** (`patch-glue.py`, run on `renpy.js` and `v7/index.js`):
  1. Ren'Py draws from client-side vertex arrays, which the Emscripten glue
     copied into a ring of small buffers with `bufferSubData`. Overwriting a
     buffer the GPU may still be reading makes ANGLE (Metal on Macs and
     iPhones) wait, on every draw: KSRE's snow scene ran at 2-4 fps with
     700 ms frames. `bufferData` gives each upload fresh storage; 60 fps.
  2. While the game loads, `emscripten_sleep(0)` resumes from a
     `MessageChannel` message instead of `setTimeout`, which browsers clamp to
     4 ms; KSRE yields ~780 times before its first frame. Both pages set
     `Module.noberuFastYield` at boot and clear it at the first frame.
- **Image cache on the web** (`noberu_patches.py` `keep_image_cache`, called by
  both pages once the game runs): Ren'Py trims its image cache only in idle
  frames on Emscripten, and a frame is never idle while anything animates, so
  during animated scenes, skipping or quick taps the cache grew past its budget
  without limit (KSRE asks for 400 MB; 1.5 GB of textures within minutes). A
  phone browser then kills the tab and reloads it with no error. It is now
  trimmed five times a second, with the textures it lets go of freed at once,
  and on touch screens the budget is 64 MB and Ren'Py looks ahead 8 statements
  for images instead of 32.
- **Textures** (`noberu_patches.py`): Ren'Py frees a GL texture from
  `Texture.__del__`, which is Cython and only exists on Python 3, so the 7.x
  runtime never freed one: Butterfly Soup's GPU memory grew ~400 MB a scene
  change. On Python 2 the patch gives `Texture` a `__del__` that deletes the
  texture from Emscripten's GL table. Web video also made a new texture for
  every frame (Cinderella Phenomenon's opening movie: +240 MB/s on the 7.x
  runtime); each video channel now keeps one and re-uploads into it.
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

- **Top-level folders:** everything beside `game/` except `renpy/`, `lib/` and
  `*.app` is installed too, since games reach outside `game/` through
  `config.basedir`. DDLC keeps its `characters/*.chr` files there.
- **Files a game writes into its own folder** (`stage.js`, the overlay): Ren'Py
  saves go to IDBFS, but some games also write next to their scripts, and
  lose track of themselves if that is gone on the next boot. DDLC writes
  `game/firstrun` after its first launch; without it, every boot asks whether
  to delete your saves. `FS.close` and `FS.unlink` are wrapped after install,
  and writes and deletes under the game (not the engine, caches, `.rpyc` or
  saves; 1 MB a file at most) are kept per game folder in the
  `noberu-renpy-overlay` IndexedDB database and replayed at the next install.
  Beam does not carry it yet, so DDLC saves beamed to a new device come with
  that prompt once ("No, continue" keeps them).
- **Sound in archives** (`noberu_patches.py`, in both engine zips): Ren'Py's
  web audio hands the browser a file path, taken from `file.raw.name`. A
  sound inside an `.rpa` has no path of its own, so Ren'Py dropped it without
  a word, and every shipped game that keeps its audio in `audio.rpa` (DDLC,
  Katawa Shoujo) played silent. Ren'Py's own web export never hits this
  because it ships loose files. The patch copies an archived sound to
  `/tmp/noberu-audio/` for the moment the browser reads it, then removes it.
  Verified on DDLC: the title music and menu sounds decode and play.
- **Audio channels for the page** (`noberu_patches.py`, both engine zips):
  `_audio.js` keeps its channels in a `let channels` of its own. The patch
  wraps `webaudio.emscripten.run_script` so the script defining it gets
  `renpyAudio.noberuChannels()` appended, which `noberu-audio.js` reads to
  tell which sounds Ren'Py is done with.
- **Shims** (`renpy7.html`): stand-in Python modules written to `/` for
  desktop-only imports. `fcntl`, which DDLC's single-instance lock needs.

## Host interface

Both pages expose the same thing, so the tab does not care which one it got:

- `window.RenPyInstallAndBoot(root, files)`, where `files` is the `FileList`
  from the directory picker.
- Events go to the parent as
  `postMessage({ source: "renpy-runtime", type, ... })` with `type` one of
  `status`, `booting`, `running`, `save-directory`, `warning` and `error`.
- `save-directory` carries `config.save_directory`, the name of the game's
  save folder. The tab hands it to `NoberuSaves.name()`, so the saves panel
  shows those saves under the game's name and beam finds them.

`running` means the game has drawn its first frame (Ren'Py calls
`presplashEnd()`), not that the engine script loaded.

## Limits

- **Ren'Py 6.99 runs on the 7 runtime.** Verified with DDLC 1.1.1 (6.99.12.4):
  the age gate, name entry, story, save and load all work. 6.99 games ship no
  `script_version.txt`, so the tab reads `renpy/__init__.py` when the whole
  folder was picked, and otherwise treats a game with no marker as old.
- **Size.** Archives are read as needed, so a big game no longer has to fit in
  memory; loose files under 512 KB still are read in whole.
- Video is limited to formats the browser plays, and Live2D does not work.

## Rebuilding an engine zip

From a Ren'Py SDK of the matching version with its web package installed at
`<sdk>/web`:

```sh
<sdk>/renpy.sh launcher web_build <sdk>/the_question --dest /tmp/out
mkdir /tmp/zx && cd /tmp/zx && unzip -q /tmp/out/game.zip
zip -qr -X -9 engine-<version>.zip renpy main.py
sh patch-engine.sh engine-<version>.zip
python3 patch-glue.py renpy.js        # or v7/index.js
```

`patch-engine.sh` is the one edit to the stock engine: it adds
`noberu_patches.py` and has `main.py` import it before Ren'Py starts. Skip it
and archived audio goes silent again, and the 7.x runtime leaks every texture.
`patch-glue.py` edits the Emscripten glue that comes with the engine (see
"Glue edits"); skip it and big games crawl.

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
