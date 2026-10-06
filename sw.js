/**
 * noberu's service worker: makes the site installable and lets the app shell
 * open offline. Deliberately small.
 *
 * - The shell (the page, its scripts, styles and icons, each runtime's page and
 *   glue) is network-first: always fresh when online, the last copy offline.
 * - Engine binaries (.wasm, .data, the BoxedWine parts) are left to the
 *   browser's HTTP cache. They are up to 22 MB each, and copying every one into
 *   a second cache on every visit would double the storage for no gain.
 * - Other sites (the demo's Hugging Face download) and range requests pass
 *   straight through.
 * - tyrano-runtime/vfs/ belongs to the Tyrano runtime's own worker, whose
 *   narrower scope wins for those pages anyway.
 *
 * Cached responses keep their headers, so the cross-origin isolation headers
 * the threaded engines need (see _headers) survive an offline load.
 */
const CACHE = "noberu-shell-v1";
const SHELL = /\.(html|js|mjs|css|json|webmanifest|png|svg|ttf|woff2?)$/i;
const BIG = /\.(wasm|data|zip|\d{3})$/i;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/tyrano-runtime/vfs/")) return;
  if (BIG.test(url.pathname)) return;
  const shell = request.mode === "navigate" || url.pathname === "/" || SHELL.test(url.pathname);
  if (!shell) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => { });
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
      if (cached) return cached;
      throw error;
    }
  })());
});
