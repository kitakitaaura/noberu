// The page's side of the tyrano runtime: stage a picked folder, then hand the
// iframe a URL the service worker will answer. Ours; TyranoScript itself is
// untouched and knows nothing about any of this.
//
//   TyranoVFS.stage(files)  -> { id, url, root, count, bytes }, or throws
//
// See tyrano-sw.js for why a service worker rather than blob URLs.
//
// The rpgmaker tab serves its games the same way, so the staging is a factory:
//   NoberuVFS({ label, db, worker, scope, findRoot, rootHint, wwwIsWrapper }) -> { stage }
// findRoot(files) returns the path prefix of the game's folder, or null.
// wwwIsWrapper names a game found in `www/` after the folder above it.
(function () {
  "use strict";

  const STORE = "games";

  function makeVfs({ label, db: DB_NAME, worker: WORKER, scope: SCOPE, findRoot, rootHint, wwwIsWrapper }) {
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

    // One staged game at a time. The store holds `File` references rather than
    // copies, so this is about tidiness rather than space: a stale entry would
    // otherwise keep pointing at a folder someone has since moved.
    // The staged game's file map, also kept here for the worker to ask for
    // (tyrano-sw.js, pageFiles): the only copy when IndexedDB will not hold
    // File objects, which is private browsing in Safari and Firefox.
    const memory = new Map();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        const ask = event.data;
        if (!ask || ask.type !== "noberu-vfs-files" || ask.db !== DB_NAME || !event.ports[0]) return;
        event.ports[0].postMessage(memory.get(ask.id) || null);
      });
      // Messages to a page the worker does not control wait until this.
      if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
    }

    async function putOnly(record) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        store.put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }

    async function register() {
      if (!("serviceWorker" in navigator)) {
        throw new Error("this browser has no service workers, which is how the game is served");
      }
      let registration;
      try {
        registration = await navigator.serviceWorker.register(WORKER, { scope: SCOPE });
      } catch (error) {
        // Registration fails outright in contexts that allow the API but disable
        // the feature - some embedded webviews, and a browser with site data
        // blocked. The raw TypeError names a scope and a script and explains
        // nothing, so say what it means for the person looking at the tab.
        throw new Error(
          `this browser would not start the worker that serves the game (${error.message || error}). ` +
            "Service workers are usually blocked by private browsing or a site-data setting."
        );
      }
      // The iframe is inside the worker's scope but this page is not, so
      // `navigator.serviceWorker.ready` (which waits for the worker controlling
      // THIS page) never resolves here. Wait on the registration itself.
      if (registration.active) return registration;
      const worker = registration.installing || registration.waiting;
      if (!worker) throw new Error(`the ${label} service worker did not install`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the ${label} service worker never activated`)), 10000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") {
            clearTimeout(timer);
            resolve();
          } else if (worker.state === "redundant") {
            clearTimeout(timer);
            reject(new Error(`the ${label} service worker was discarded`));
          }
        });
      });
      return registration;
    }

    return {
      async stage(list) {
        const files = [...(list || [])];
        if (!files.length) throw new Error("nothing was selected");
        const prefix = findRoot(files);
        if (prefix === null) {
          throw new Error(rootHint);
        }

        const map = {};
        let bytes = 0;
        for (const file of files) {
          const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
          if (prefix && !path.startsWith(prefix)) continue;
          map[path.slice(prefix.length)] = file;
          bytes += file.size;
        }
        if (!map["index.html"] && !map["Index.html"]) {
          throw new Error("the game's index.html did not survive staging");
        }

        // An RPG Maker MV release keeps the game in `www/` beside its .exe;
        // the folder above is the one with the game's name.
        const parts = prefix.replace(/\/$/, "").split("/");
        if (wwwIsWrapper && parts.length > 1 && /^www$/i.test(parts[parts.length - 1])) parts.pop();
        const name = prefix ? parts.pop() : files[0].name;
        const id = (name || "game").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "game";
        memory.clear();
        memory.set(id, map);
        await putOnly({ id, files: map, stagedAt: Date.now() }).catch((error) => {
          console.warn(`noberu: kept ${label} game in memory only (${error && error.name || error})`);
        });
        await register();
        return {
          id,
          url: `${SCOPE}${encodeURIComponent(id)}/index.html`,
          root: name || "game",
          count: Object.keys(map).length,
          bytes,
        };
      },
    };
  }

  /// The folder that actually holds a Tyrano game: the shallowest `index.html`.
  /// A pick can be the game folder itself, a wrapper around it, or an NW.js
  /// release with the game a level or two down.
  function findIndexRoot(files) {
    let best = null;
    for (const file of files) {
      const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      if (!/(^|\/)index\.html$/i.test(path)) continue;
      const depth = path.split("/").length;
      if (!best || depth < best.depth) {
        best = { depth, prefix: path.replace(/index\.html$/i, "") };
      }
    }
    return best ? best.prefix : null;
  }

  window.NoberuVFS = makeVfs;
  window.TyranoVFS = makeVfs({
    label: "tyrano",
    db: "noberu-tyrano",
    worker: "tyrano-runtime/tyrano-sw.js",
    scope: "tyrano-runtime/vfs/",
    findRoot: findIndexRoot,
    rootHint: "no index.html in that folder — pick the folder the game's index.html is in",
  });
})();
