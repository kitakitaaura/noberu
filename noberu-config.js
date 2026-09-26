// Where the files that are too big for the site host live.
//
// Cloudflare Pages refuses any single asset over 25 MiB, and BoxedWine's root
// filesystem zip is ~152 MiB — the Linux userland and Wine, always fetched
// before the emulator can start. So that one file is not a site asset: it sits
// in an R2 bucket, served by the little Worker in `large-assets-worker/`, and
// everything that needs it asks here for the base URL rather than keeping its
// own copy of the answer.
//
// The default is the local server's own `/large/` route (see serve-local.mjs),
// which serves `../noberu-assets/`. For a deployed site, set this to the
// Worker's origin, WITH the trailing slash:
//
//   window.NOBERU_LARGE_ASSET_BASE = "https://assets.example.com/";
//
// The Worker sends `Cross-Origin-Resource-Policy: cross-origin` and CORS
// headers, which a cross-origin fetch needs to survive this site's
// `Cross-Origin-Embedder-Policy: require-corp` (see `_headers`).
window.NOBERU_LARGE_ASSET_BASE = "/large/";
