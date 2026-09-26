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

```sh
cd <siglus_rs checkout>
cargo build --release -p siglus_scene_vm --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/siglus_scene_vm.wasm \
  --target web --out-dir <here>/pkg
```

Needs `wasm-bindgen-cli` 0.2.111 (must match the crate version).

## Local patches carried against upstream

These are not upstream yet; a fresh checkout will not have them. See the
`noberu-vn-roadmap` notes for the full reasoning.

1. `resource.rs` — `SCENE_PCK_CANDIDATES`, so localized Steam builds shipping
   `SceneEN.pck` are found (upstream already does this for Gameexe).
2. `wasm_entry.rs` — pointer positions mapped into game space via
   `surface_point_to_game`, instead of `to_logical()` which yields CSS pixels.
3. `wasm_entry.rs` — the renderer's logical viewport pinned to Gameexe
   SCREEN_SIZE at scale 1, as the desktop host does.
4. `audio/sfx_engine.rs` — KOE (voice) decode runs inline instead of on a
   thread.
5. `movie/mod.rs` — `OmvInlineProducer`, a single-threaded pull decoder that
   replaces the streaming worker thread; plus ranged reads for the OMV header
   and file prefixes, and a shared `omv_open_index` / `omv_ogg_reader` so the
   wasm and native paths stop diverging.
6. `wasm_vfs.rs` — `VfsSeekReader` (ranged `Read + Seek`), `read_range`,
   `file_size`, and `write_all`; `original_save.rs` routed through
   `resource::write_file_bytes` so saves work at all.

**Do not override `window.devicePixelRatio`.** winit sizes the canvas backing
store from the real DPR but reads `scale_factor()` back from the page, so an
override desyncs them and pointer coordinates land wrong. The canvas is sized
instead to keep `css * dpr` under the WebGL2 2048 texture cap.
