# LUCA System runtime

noberu's own engine for LUCA System games (Prototype's re-releases), starting
with Little Busters! English Edition. Source: the public repo
[kitakitaaura/noberu-engines](https://github.com/kitakitaaura/noberu-engines)
(GPLv3), crates `luca-web` (this build), `luca-vm`, `luca-script`, `luca-pak`,
`luca-cz`, `luca-lbee`.

- `pkg/` - wasm-bindgen output (`luca_web.js`, `luca_web_bg.wasm`). Build artifact.
- `noberu.html`, `luca.js`, `luca.css` - the page the "luca" tab loads in an iframe.
  Entry point: `window.LucaInstallAndBoot(root, files)`. Status goes to the
  parent as `postMessage({ source: "luca-runtime", type, ... })`.

The wasm side never touches files: `luca.js` reads byte ranges of the .PAK
archives with `File.slice` and hands them in. wasm parses archive indexes,
decodes CZ images and runs the script; `player.step()` returns the events up
to the next thing the page must do (show a line, offer a choice, wait for a
transition). No threads, no SharedArrayBuffer.

Dev and test switches (URL of `noberu.html`): `?dev=testgame` boots the game in
`luca-runtime/testgame` (a git-ignored symlink to a local `files/` folder, read
by HTTP ranges), `?mute=1`, `?fast=1` (text advances by itself),
`?start=SEEN0514`. `window.lucaDebug` has the player, `location()` and audio
decode counts.

Open `http://127.0.0.1:4175/...` rather than `localhost` when a browser profile
has an old noberu service worker registered for localhost.

## Rebuilding

```sh
cd ~/Documents/Noberu/noberu-engines
cargo build --release --target wasm32-unknown-unknown -p luca-web
wasm-bindgen target/wasm32-unknown-unknown/release/luca_web.wasm \
  --target web --out-dir ~/Documents/noberu-web/luca-runtime/pkg
node ~/Documents/noberu-web/tools/offline-manifest.mjs   # offline.json lists the files
```

The wasm-bindgen CLI must match the crate's `wasm-bindgen` version (0.2.126).
