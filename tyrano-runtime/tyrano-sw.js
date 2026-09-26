// The service worker that makes a folder on this device look like a web server.
//
// A TyranoScript game IS a website: `index.html`, `tyrano/` (the engine) and
// `data/` (scenario, images, audio). Nothing needs emulating - it only needs
// serving. But the game loads its assets itself, at runtime, by relative path
// (`data/bgimage/room.jpg`, and plenty of them built by string concatenation
// inside the scenario), so handing the page a set of `blob:` URLs cannot work:
// there is no document to rewrite, and no way to know the paths in advance.
//
// So this worker sits under `tyrano-runtime/vfs/` and answers every request in
// that scope out of the staged `File` objects. The game asks for
// `vfs/<id>/data/bgm/theme.ogg`, this serves the bytes, and the game is none the
// wiser. Files are read with `.slice()` when asked for, so staging a 2 GB game
// copies nothing.
//
// The map lives in IndexedDB rather than in this worker's memory because a
// service worker is KILLED after a stretch of inactivity - a title screen
// someone leaves for a minute is enough - and it restarts with nothing. That
// showed up as every asset 404ing part way into a game.

const DB_NAME = "noberu-tyrano";
const STORE = "games";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A staged game's files, cached per worker lifetime. The IndexedDB read is one
// round trip; doing it per asset would show up on a scene change.
const cached = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function gameFiles(id) {
  if (cached.has(id)) return cached.get(id);
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const query = db.transaction(STORE).objectStore(STORE).get(id);
    query.onsuccess = () => resolve(query.result || null);
    query.onerror = () => reject(query.error);
  });
  db.close();
  if (!record) return null;
  const files = new Map(Object.entries(record.files));
  // Games authored on Windows reference `Data/Image/BG.png` for a file stored as
  // `data/image/bg.png` and nobody notices until it is served by something that
  // cares. A lowercase index is the fallback, and only the fallback: an exact
  // match always wins, so two files differing only in case still resolve.
  const lower = new Map();
  for (const [path, file] of files) lower.set(path.toLowerCase(), file);
  const entry = { files, lower };
  cached.set(id, entry);
  return entry;
}

const TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  ks: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

const typeFor = (path) => TYPES[path.split(".").pop().toLowerCase()] || "application/octet-stream";

/// Resolve `.` and `..` segments, and drop a leading slash. A scenario that
/// builds a path by concatenation produces these ("data/image/../system/x.png"),
/// and a Map lookup is literal.
function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// The headers that let this page be EMBEDDED at all.
//
// noberu is cross-origin isolated (see ../_headers): the kirikiri and Play!
// runtimes are pthreads builds and need SharedArrayBuffer. Under
// `Cross-Origin-Embedder-Policy: require-corp` a nested document is blocked
// unless it carries CORP *and* opts into COEP itself - and a blocked frame is
// what Chrome renders as "localhost refused to connect", which looks for all the
// world like a dead server.
//
// Every other tab's frame comes from serve-local.mjs, which stamps these onto
// everything it serves. These responses never touch that server, so the worker
// has to supply them - on assets as well as documents, because a subresource
// without CORP is refused just the same.
const ISOLATION = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function plain(status, message) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...ISOLATION,
    },
  });
}

async function serve(request, url) {
  const scope = new URL(self.registration.scope).pathname;
  const rest = decodeURIComponent(url.pathname.slice(scope.length));
  const cut = rest.indexOf("/");
  const id = cut === -1 ? rest : rest.slice(0, cut);
  let path = cut === -1 ? "" : rest.slice(cut + 1);
  if (path === "" || path.endsWith("/")) path += "index.html";
  path = normalize(path);

  const entry = await gameFiles(id);
  if (!entry) {
    return plain(503, "noberu: this game is no longer staged. Stage it again in the tyrano tab.");
  }
  const file = entry.files.get(path) || entry.lower.get(path.toLowerCase());
  if (!file) return plain(404, `noberu: ${path} is not in the staged folder`);

  const headers = {
    ...ISOLATION,
    "Content-Type": typeFor(path),
    "Accept-Ranges": "bytes",
    // The bytes are whatever is on disk right now, and staging the same game
    // again must not serve yesterday's build out of the HTTP cache.
    "Cache-Control": "no-store",
  };

  // Chrome will not play a <video> from a source that cannot do ranges, and it
  // seeks audio with them too, so the request's own Range is honoured rather
  // than answered with the whole file.
  const range = request.headers.get("Range");
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match) {
    const size = file.size;
    let start = match[1] === "" ? null : Number(match[1]);
    let end = match[2] === "" ? null : Number(match[2]);
    if (start === null) {
      // A suffix range ("bytes=-500"): the LAST n bytes.
      start = Math.max(0, size - (end || 0));
      end = size - 1;
    } else if (end === null || end >= size) {
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { ...ISOLATION, "Content-Range": `bytes */${size}` },
      });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }

  return new Response(file, { status: 200, headers });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(serve(event.request, url));
});
