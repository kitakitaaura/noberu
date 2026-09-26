# Local Play! Runtime Artifacts

Place the real Play! browser build outputs here:

- `Play.js`
- `Play.wasm`

These are produced by the upstream Play! WASM build. In the Play! source tree, the official helper is:

```sh
./build_cmake/build_wasm_release.sh
```

The app in `../index.html` loads these files directly through `play-bridge.js`; it no longer embeds `playjs.purei.org`.

Because upstream Play! is built with pthreads, serve the site over HTTP with these headers when possible:

```txt
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
