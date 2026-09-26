// Runs the real tyrano-runtime files in Node with the browser APIs stubbed, so the
// path/range/staging logic is exercised for real even where service workers are off.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert";

const DIR = new URL("./", import.meta.url);
const read = (n) => readFileSync(new URL(n, DIR), "utf8");

// --- stubs -----------------------------------------------------------------
const db = new Map(); // store name -> Map(key -> record)
db.set("games", new Map());
const indexedDB = {
  open() {
    const req = {};
    queueMicrotask(() => {
      req.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        transaction: () => ({
          objectStore: () => ({
            get(key) { const r = {}; queueMicrotask(() => { r.result = db.get("games").get(key); r.onsuccess && r.onsuccess(); }); return r; },
            put(v) { db.get("games").set(v.id, v); },
            clear() { db.get("games").clear(); },
          }),
          set oncomplete(fn) { queueMicrotask(fn); },
          set onerror(_) {},
        }),
        close() {},
      };
      req.onsuccess && req.onsuccess();
    });
    return req;
  },
};

const listeners = {};
const ctx = {
  console, URL, Response, Request, Headers, File, Blob, Map, Set, Number, Math, Date,
  queueMicrotask, setTimeout, clearTimeout, indexedDB,
  TextEncoder, Object, JSON, encodeURIComponent, decodeURIComponent,
  self: {
    addEventListener: (name, fn) => (listeners[name] = fn),
    registration: { scope: "http://localhost:4175/tyrano-runtime/vfs/" },
    location: { origin: "http://localhost:4175" },
    clients: { claim: () => {} },
  },
  navigator: { serviceWorker: { register: async () => ({ active: {} }) } },
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read("tyrano-sw.js"), ctx);
vm.runInContext(read("noberu-glue.js"), ctx);

const file = (name, body) => {
  const f = new File([body], name.split("/").pop());
  Object.defineProperty(f, "webkitRelativePath", { value: name });
  return f;
};
const serve = async (path, headers = {}) => {
  let out;
  await listeners.fetch({
    request: new Request("http://localhost:4175/tyrano-runtime/vfs/" + path, { headers }),
    respondWith: (p) => (out = p),
  });
  return await out;
};

// --- 1. staging ------------------------------------------------------------
const picked = [
  file("My Game/readme.txt", "x"),
  file("My Game/www/index.html", "<html>hi</html>"),
  file("My Game/www/tyrano/tyrano.js", "// engine"),
  file("My Game/www/data/scenario/first.ks", "*start"),
  file("My Game/www/data/image/BG.png", "PNGDATA"),
  file("My Game/www/data/bgm/theme.ogg", "0123456789"),
];
const staged = await ctx.window.TyranoVFS.stage(picked);
assert.equal(staged.root, "www", "root is the folder holding index.html");
assert.equal(staged.count, 5, "the file above the root is left out");
assert.equal(staged.url, "tyrano-runtime/vfs/www/index.html");
console.log("ok  staging picks the shallowest index.html and strips its prefix");

// a pick with no index.html is refused, clearly
await assert.rejects(() => ctx.window.TyranoVFS.stage([file("Game/data/x.ks", "y")]), /index\.html/);
console.log("ok  a folder with no index.html is refused");

// --- 2. serving ------------------------------------------------------------
const id = staged.id;
assert.equal(await (await serve(`${id}/index.html`)).text(), "<html>hi</html>");
assert.equal(await (await serve(`${id}/`)).text(), "<html>hi</html>", "a directory serves index.html");
assert.equal(await (await serve(`${id}`)).text(), "<html>hi</html>", "so does the bare id");
console.log("ok  index.html is served for the root, the bare id and a trailing slash");

const ks = await serve(`${id}/data/scenario/first.ks`);
assert.equal(ks.headers.get("Content-Type"), "text/plain; charset=utf-8", ".ks is text, not a download");
assert.equal((await serve(`${id}/data/bgm/theme.ogg`)).headers.get("Content-Type"), "audio/ogg");
assert.equal((await serve(`${id}/tyrano/tyrano.js`)).headers.get("Content-Type"), "text/javascript; charset=utf-8");
console.log("ok  content types: .ks, .ogg, .js");

assert.equal(await (await serve(`${id}/data/image/bg.png`)).text(), "PNGDATA", "windows-cased path falls back");
assert.equal(await (await serve(`${id}/data/scenario/../image/BG.png`)).text(), "PNGDATA", "../ is resolved");
assert.equal(await (await serve(`${id}/./index.html`)).text(), "<html>hi</html>", "./ is resolved");
console.log("ok  case fallback and . / .. path resolution");

// --- 3. ranges (Chrome will not play a <video> without them) ---------------
const r1 = await serve(`${id}/data/bgm/theme.ogg`, { Range: "bytes=2-5" });
assert.equal(r1.status, 206);
assert.equal(await r1.text(), "2345");
assert.equal(r1.headers.get("Content-Range"), "bytes 2-5/10");
const r2 = await serve(`${id}/data/bgm/theme.ogg`, { Range: "bytes=7-" });
assert.equal(await r2.text(), "789", "open-ended range");
const r3 = await serve(`${id}/data/bgm/theme.ogg`, { Range: "bytes=-3" });
assert.equal(await r3.text(), "789", "suffix range");
const r4 = await serve(`${id}/data/bgm/theme.ogg`, { Range: "bytes=99-" });
assert.equal(r4.status, 416, "a range past the end is 416");
const whole = await serve(`${id}/data/bgm/theme.ogg`);
assert.equal(whole.status, 200, "no Range header means a plain 200");
assert.equal(whole.headers.get("Accept-Ranges"), "bytes");
console.log("ok  range requests: partial, open-ended, suffix, 416, and plain GET stays 200");

// --- 4. isolation headers, or the frame is blocked -------------------------
// noberu is cross-origin isolated, so a frame with no COEP/CORP is refused by
// Chrome and rendered as "localhost refused to connect". These responses never
// pass through serve-local.mjs, so the worker has to carry the headers itself -
// on the document AND on every asset.
for (const path of [`${id}/index.html`, `${id}/tyrano/tyrano.js`, `${id}/data/image/BG.png`]) {
  const res = await serve(path);
  assert.equal(res.headers.get("Cross-Origin-Embedder-Policy"), "require-corp", path);
  assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), "same-origin", path);
}
const ranged = await serve(`${id}/data/bgm/theme.ogg`, { Range: "bytes=0-1" });
assert.equal(ranged.headers.get("Cross-Origin-Embedder-Policy"), "require-corp", "206 too");
const missing = await serve(`${id}/nope.png`);
assert.equal(missing.headers.get("Cross-Origin-Resource-Policy"), "same-origin", "404 too");
console.log("ok  every response carries the isolation headers a framed document needs");

// --- 5. the failure paths a person will actually hit ----------------------
assert.equal((await serve(`${id}/data/image/missing.png`)).status, 404);
assert.match(await (await serve(`${id}/data/image/missing.png`)).text(), /not in the staged folder/);
const gone = await serve("some-other-game/index.html");
assert.equal(gone.status, 503);
assert.match(await gone.text(), /stage it again/i);
console.log("ok  a missing asset is a 404, an unstaged game says to stage it again");

console.log("\nall tyrano runtime checks passed");
