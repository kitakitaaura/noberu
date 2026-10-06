# Local siglus_rs Runtime Artifacts

SiglusEngine games (Key's post-RealLive run: Little Busters!, Rewrite+, Summer
Pockets, planetarian HD, Harmonia, the Steam CLANNAD/Kanon re-releases) through
a wasm build of [xmoezzz/siglus_rs](https://github.com/xmoezzz/siglus_rs)
(MPL-2.0, Rust).

- `pkg/` — the wasm-bindgen build output (`siglus_scene_vm.js`,
  `siglus_scene_vm_bg.wasm`). Build artifact, not source.
- `noberu.html` — the page loaded in an iframe by the "siglus" tab in
  `../index.html`. Ours, not upstream's.
- `noberu-glue.js` — the host glue. Ours. Implements the VFS imports the engine
  expects on the global object and exposes
  `window.SiglusInstallAndBoot(root, files)`. Status is forwarded to the parent
  as `postMessage({ source: "siglus-runtime", type, ... })`, the same
  convention the other runtimes use.
- `index.html`, `main.js`, `style.css` — upstream's own demo page, kept for
  reference. The tab does not use them.

Nothing is copied into memory: each `File` is read with `.slice()` only when the
engine opens that path, and movie containers are read in ranges, so an 8 GB
release stages instantly.

Unlike the kirikiri and Play! runtimes this build has **no threads**, so it needs
no COOP/COEP headers and works on any page.

## Rebuilding

The source is `~/Documents/Noberu/siglus_rs`, branch `noberu`: upstream
`main` at f3edbbc (25 Sep 2026) plus one commit of ours, f52ceda. To take
newer upstream work, rebase that branch onto upstream `main`.

```sh
cd ~/Documents/Noberu/siglus_rs
cargo build --release -p siglus_scene_vm --target wasm32-unknown-unknown
~/.cargo-wasm-bindgen-0.2.111/bin/wasm-bindgen \
  target/wasm32-unknown-unknown/release/siglus_scene_vm.wasm \
  --target web --out-dir <here>/pkg
cargo check -p siglus_scene_vm --lib   # the native build must still compile
```

wasm-bindgen-cli has to match the crate (0.2.111). It lives in its own
`--root` so it does not replace the newer copy on PATH.

## What our commit changes

1. `wasm_vfs.rs` - ranged reads, file sizes and writes (the `siglusReadRange`,
   `siglusFileSize` and `siglusWriteFile` imports in `noberu-glue.js`), and
   `VfsSeekReader`, `Read + Seek` over ranged reads with a 256 KB window.
   `resource.rs` gains `read_file_range`, `write_file_bytes` and
   `create_dir_all`; `original_save.rs` writes saves through them.
2. No threads on wasm. `audio/sfx_engine.rs`: KOE (voice) decodes inline.
   `movie/mod.rs`: MPEG2/WMV movie audio and streaming fail cleanly rather
   than panicking on a thread spawn (those movies play silent or are skipped
   in the browser; Key's OMV movies take the path below).
3. OMV video streams through `OmvInlineProducer`, a single-threaded pull
   decoder feeding the same channel as the native worker, pumped from
   `drain_omv_stream_state`. Header, prefix and preview-frame reads are ranged
   (`omv_open_index` / `omv_ogg_reader` serve both targets), and
   `siglus_assets::omv` gained `open_from_reader`.
4. `wasm_entry.rs` - pointer positions mapped into game space, and the
   renderer pinned to Gameexe SCREEN_SIZE, letterboxed, as the desktop host
   does.
5. Arrow keys (SiglusEngine's SET_MOUSE_MOVE_BY_KEY, which upstream only
   stored): `cursor_move_by_key` in `runtime/mod.rs`, called from
   `SiglusHost::key_down`, moves the cursor to the nearest button that way,
   or through them in reading order when there is none; the first press goes
   to the first in reading order. Targets, in order of preference:
   - SELBTN choices while they are up;
   - engine buttons, top-most order/layer only (a dialog over a screen);
   - for script-driven menus, which have none (Rewrite+'s title, save/load
     and its Yes/No dialog all hit-test their own images), the images the
     script is asking OBJECT.GET_SIZE_X/Y of right now - or, when it has
     locked onto the item under the cursor, what it asked lately, top layer
     only.
   Message-window choices already took arrows natively. A game's own key
   handling still runs after the move (Rewrite+'s map scrolls with them).

   Verified on Rewrite+ by keyboard alone: title → Load → slot → "Load
   game?" Yes/No → back in the game. Also verified on this build: the OP
   movie (op00, 433 MB, streamed), mid-game save and reload, voice-era text.

The September build (before upstream's later fixes) is kept at
`~/Documents/noberu-assets/siglus-pkg-2026-09-19` in case of a regression.

## Touch (ours, in `noberu-glue.js`)

winit reports a touch as its own pointer kind and siglus_rs only acts on mouse
buttons, so on a phone a tap highlighted a menu item and never chose it. The
glue re-sends touch pointer events on the canvas as mouse ones, and holds a
quick tap's release back 70 ms: the engine samples the button once a frame, so
a press and release inside one frame are never seen. Verified in WebKit as an
iPhone: a tap on Rewrite+'s Start starts the game.

Arrow keys move between menu items (see 5 above); Enter chooses the
highlighted one.

**Do not override `window.devicePixelRatio`.** winit sizes the canvas backing
store from the real DPR but reads `scale_factor()` back from the page, so an
override desyncs them and pointer coordinates land wrong. The canvas is sized
instead to keep `css * dpr` under the WebGL2 2048 texture cap.
