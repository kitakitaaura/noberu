# Local VNDS-LOVE Runtime Artifacts

Real build output from `~/VNDS-LOVE/web-build/`, the LÖVE (Love2D) engine
compiled via [love.js](https://github.com/Davidobot/love.js), running the
VNDS-LOVE interpreter (a VNDS-format visual novel player). Gitignored: the
data package and wasm/js build are large and are build artifacts, not source.

- `love.js` / `love.wasm` — the LÖVE engine itself (Emscripten build)
- `game.js` / `game.data` — Emscripten's preloaded package containing
  `game.love`, the VNDS-LOVE interpreter (not a user's novel — the engine)
- `jszip.min.js` — used internally by the engine to read the zipped asset
  bundles (`script.zip`, `background.zip`, `foreground.zip`, `sound.zip`)
  that VNDS novel folders ship
- `theme/` — stock love.js loading-screen styling
- `vnds.html` — the page loaded in an iframe by the "vnds" tab in
  `../index.html`. Adapted from the stock `web-build/index.html`: the
  built-in launcher (folder picker + continue button) and footer are hidden
  (the tab's sidebar drives everything), and the exact same install-then-boot
  logic that used to live inline in the launcher's event handlers is exposed
  as two host-callable functions instead:
  - `window.VNDSInstallAndBoot(root, entries)` — `entries` is
    `[{ relative, data }]` (Uint8Array per file), installs them under
    `/home/web_user/love/VNDS-LOVE/novels/<root>/` via the same
    `Module.onRuntimeInitialized` + `FS_createPath`/`FS.writeFile` sequence
    the original launcher used, then boots.
  - `window.VNDSContinue()` — boots without installing anything new; love.js's
    own IDBFS mount+sync on startup pulls back in whatever a previous
    `VNDSInstallAndBoot` call persisted.
  Status/ready/error events are forwarded to the parent page via
  `postMessage({ source: "vnds-runtime", type, ... })`, same convention as
  `../boxedwine-runtime/`.

## Novel folder format

A VNDS novel is a folder (what you'd pick with a directory upload) containing
`info.txt`, `icon.png`/`thumbnail.png`, and either loose `script/`,
`background/`, `foreground/`, `sound/` directories or the zipped equivalents
(`script.zip`, `background.zip.`, `foreground.zip`, `sound.zip` — VNDS-LOVE
unzips these itself via jszip.min.js at runtime). The vnds tab's sidebar
uploads this whole folder (or a zip of it) and hands the files straight to
`VNDSInstallAndBoot` — no repackaging needed.

## Rebuilding from upstream VNDS-LOVE (source at `~/VNDS-LOVE`)

See `~/VNDS-LOVE/README.md` for the Alfons/LuaRocks build chain. The
`web-build` target there is love.js's web export; copy `love.js`,
`love.wasm`, `game.js`, `game.data`, `jszip.min.js`, `theme/` from its output
here, and re-apply the `vnds.html` patch described above (it is not part of
the upstream build and will be overwritten if `index.html` is copied over
verbatim instead).

## Screen shape

The engine draws at a fixed 800x600. `vnds.html` used to stretch the canvas to
100% of the frame both ways, which was invisible in the roughly 4:3 desktop
frame and squashed the game to 2:1 on a landscape phone. `fitCanvas()` now
sizes it to fit with its shape kept, centred on black, on resize and whenever
the engine changes the canvas size. Taps still land right: Emscripten maps them
through the canvas's on-screen box.

Choices are picked with the arrow keys and Enter (the touch pad's d-pad and
enter on a phone); VNDS-LÖVE does not take clicks or taps on a choice.
