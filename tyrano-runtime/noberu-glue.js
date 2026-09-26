// The page's side of the tyrano runtime: stage a picked folder, then hand the
// iframe a URL the service worker will answer. Ours; TyranoScript itself is
// untouched and knows nothing about any of this.
//
//   TyranoVFS.stage(files)  -> { id, url, root, count, bytes }, or throws
//
// See tyrano-sw.js for why a service worker rather than blob URLs.
(function () {
  "use strict";

  const DB_NAME = "noberu-tyrano";
  const STORE = "games";
  const WORKER = "tyrano-runtime/tyrano-sw.js";
  const SCOPE = "tyrano-runtime/vfs/";

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

  /// The folder that actually holds the game: the shallowest `index.html`. A
  /// pick can be the game folder itself, a wrapper around it, or an NW.js
  /// release with the game a level or two down.
  function findRoot(files) {
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
    if (!worker) throw new Error("the tyrano service worker did not install");
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the tyrano service worker never activated")), 10000);
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") {
          clearTimeout(timer);
          resolve();
        } else if (worker.state === "redundant") {
          clearTimeout(timer);
          reject(new Error("the tyrano service worker was discarded"));
        }
      });
    });
    return registration;
  }

  window.TyranoVFS = {
    async stage(list) {
      const files = [...(list || [])];
      if (!files.length) throw new Error("nothing was selected");
      const prefix = findRoot(files);
      if (prefix === null) {
        throw new Error("no index.html in that folder — pick the folder the game's index.html is in");
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

      const name = prefix ? prefix.replace(/\/$/, "").split("/").pop() : files[0].name;
      const id = (name || "game").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60) || "game";
      await putOnly({ id, files: map, stagedAt: Date.now() });
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
})();
