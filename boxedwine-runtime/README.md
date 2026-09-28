# Local BoxedWine Runtime Artifacts

This folder holds the real BoxedWine Emscripten build output, gitignored because
of size (the root filesystem zip alone is ~150MB):

- `boxedwine.js` / `boxedwine.wasm` — the emulator itself
- `boxedwine.css` — stock BoxedWine styling (kept for the loading spinner)
- `root/` — the root filesystem (Linux userland + Wine), produced by the upstream
  BoxedWine build and always required, **split into numbered parts**. At ~152 MiB
  the zip is far over Cloudflare Pages' 25 MiB per-asset limit, so it ships as
  eight ~20 MiB pieces plus `parts.json`, and `boxedwine-shell.js` fetches them in
  order and joins them before handing the bytes to the emulator (`fetchRootZip` /
  `loadRootZip`, ours — one more patch against upstream). That costs no extra
  memory: the whole zip landed in a single array either way. Regenerate after any
  rebuild of the zip:

  ```sh
  node tools/split-root-zip.mjs ~/Documents/noberu-assets/boxedwine.zip
  ```

  The unsplit zip is kept outside the site at `~/Documents/noberu-assets/`, so it
  is never deployed or committed
- `boxedwine.html` — the page loaded in an iframe by the "boxedwine" tab in
  `../index.html`. Patched from the stock BoxedWine shell page: built-in
  controls are hidden (the tab's sidebar drives everything) and it establishes
  `window.BoxedWineHostGate`, a promise the host page resolves once it has
  handed over the uploaded game.
- `boxedwine-shell.js` — patched from the stock BoxedWine shell script. See
  `applyHostConfig()` / `continueInitialSetup()` near the top for the bridge:
  the host page sets `window.BoxedWineHost = { appName, appBytes, overlays,
  program, programArgs, workingDir, resolution, cpu, bpp, soundEnabled,
  frameSkip, audioFreq, disableHideCursor, storageMode, loadDesktop }` and
  calls `window.__resolveBoxedWineHost()`; bytes are written straight into the
  emulator's virtual filesystem, no base64/URL-param size limits. Status,
  readiness, and error events are also forwarded to the parent page via
  `postMessage({ source: "boxedwine-runtime", type, ... })`.
- `overlays/` — small reusable overlay zips (redistributable DLLs, fonts,
  etc.) that the tab's "advanced settings" panel lists as checkboxes, driven
  by `overlays/manifest.json`. Add a new overlay by dropping the zip here and
  adding a `{ file, label, description }` entry to the manifest — no other
  changes needed.

Rebuilding from upstream BoxedWine (source at `~/Boxedwine`):

```sh
cd ~/Boxedwine/project/emscripten
./build.sh   # or whatever the current build entrypoint is; see BUILD.md
```

Then copy `boxedwine.js`, `boxedwine.wasm`, `boxedwine.css`, `boxedwine.zip`
from the build output here, and re-apply the `boxedwine-shell.js` /
`boxedwine.html` patches described above (they are not part of the upstream
build and will be overwritten if you copy the shell files verbatim).

Because BoxedWine uses pthreads, serve this site with the same headers the
PS2/Play! runtime needs:

```txt
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`../serve-local.mjs` already sets these for every response.
