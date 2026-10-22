/**
 * noberu's service worker: makes the site installable and lets it open, and
 * with consent play, offline. Deliberately small.
 *
 * - The shell (the page, its scripts, styles and icons, each runtime's page and
 *   glue) is network-first: always fresh when online, the last copy offline.
 * - Engines (everything under a *-runtime/ folder) are only kept when the
 *   person has turned offline use on (assets/offline.js). That creates the
 *   ENGINES cache; while it exists, engine files are network-first into it and
 *   served from it offline. Without it, engine binaries (.wasm, .data, the
 *   BoxedWine parts) are left to the browser's HTTP cache as before.
 * - Other sites (the demo's Hugging Face download) and range requests pass
 *   straight through.
 * - tyrano-runtime/vfs/ and rpgmaker-runtime/vfs/ belong to those runtimes'
 *   own workers. Their narrower scope normally wins, but when it doesn't (an
 *   iPhone sometimes sends the game frame's first load past it), this worker
 *   must not fetch the address itself: Pages answers it with noberu's own
 *   page, which then showed in the game frame without its styles.
 *
 * Cached responses keep their headers, so the cross-origin isolation headers
 * the threaded engines need (see _headers) survive an offline load.
 */
const CACHE = "noberu-shell-v1";
const ENGINES = "noberu-engines-v1";  // also named in assets/offline.js
const SHELL = /\.(html|js|mjs|css|json|webmanifest|png|svg|ttf|woff2?)$/i;
const BIG = /\.(wasm|data|zip|\d{3})$/i;
const RUNTIME = /^\/[a-z0-9-]+-runtime\//;
// What an engine ships (tools/offline-manifest.mjs lists them). Anything else
// under a runtime folder - a dev link's game files - is never stored.
const ENGINE_FILE = /\.(html|js|mjs|css|json|png|svg|ttf|woff2?|wasm|data|zip|\d{3}|py|txt|ts|sh)$/i;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Old shell versions go; the offline engines stay (only the person's
    // own "turn off" removes them).
    for (const key of await caches.keys()) {
      if (key !== CACHE && key !== ENGINES) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// A redirected response can't answer a navigation later (Safari refuses it),
// so those are passed on but never stored.
function storable(response) {
  return response.ok && response.type === "basic" && !response.redirected;
}

async function shellFetch(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (storable(response)) cache.put(request, response.clone()).catch(() => { });
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    throw error;
  }
}

async function engineFetch(request, url) {
  const navigate = request.mode === "navigate";
  if (!(await caches.has(ENGINES))) {
    // Offline use off: exactly as before - the page and glue into the shell
    // cache, binaries and everything else straight to the network.
    const shellish = navigate || (SHELL.test(url.pathname) && !BIG.test(url.pathname));
    return shellish ? shellFetch(request) : fetch(request);
  }
  if (!navigate && !ENGINE_FILE.test(url.pathname)) return fetch(request);
  const cache = await caches.open(ENGINES);
  try {
    const response = await fetch(request);
    if (storable(response)) {
      // Unchanged since it was stored: skip rewriting what can be 60 MB.
      const stored = await cache.match(request, { ignoreSearch: navigate });
      const tag = response.headers.get("etag");
      if (!stored || !tag || stored.headers.get("etag") !== tag) {
        cache.put(request, response.clone()).catch(() => { });
      }
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: navigate }) ||
      await (await caches.open(CACHE)).match(request, { ignoreSearch: navigate });
    if (cached) return cached;
    if (navigate) return notKept();
    throw error;
  }
}

// Offline, opening an engine that was never kept: say so in the game's frame
// rather than leave the browser's error page (which the tab can't even read,
// so it would sit on "starting" until it timed out). The headers match
// _headers, or the cross-origin-isolated page would refuse to frame it.
function notKept() {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>not kept offline</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#eee;font:15px/1.5 ui-monospace,Menlo,monospace;text-align:center;padding:1.5rem;box-sizing:border-box">
<div><b>You're offline</b><p>This engine isn't kept on this device yet.<br>Connect once and play, or keep every engine in settings → offline.</p></div>`;
  return new Response(page, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (/^\/[a-z0-9-]+-runtime\/vfs\//.test(url.pathname)) return;
  if (RUNTIME.test(url.pathname)) {
    event.respondWith(engineFetch(request, url));
    return;
  }
  if (BIG.test(url.pathname)) return;
  const shell = request.mode === "navigate" || url.pathname === "/" || SHELL.test(url.pathname);
  if (!shell) return;
  event.respondWith(shellFetch(request));
});
