/**
 * noberu saves: everything the runtimes have written into this browser, with
 * a way to export it to a real file, put it back, or delete it.
 *
 *   NoberuSaves.open()   - the "saves" button in the header
 *
 * The runtimes keep saves in three places, so all three are scanned:
 *
 *   IndexedDB - Emscripten's IDBFS, one database per mount point, named with
 *               a leading slash ("/save" for onscripter, "/home" for rlvm).
 *               Its FILE_DATA store is keyed by absolute path, holding
 *               { contents, mode, timestamp }.
 *   OPFS      - onscripter-ru writes through WasmFS, so each game's save
 *               folder is a directory in the origin private filesystem.
 *               "library" belongs to the downloads library and is skipped.
 *   flat      - the kirikiri and siglus runtimes keep their own stores rather
 *               than IDBFS: one database per game, with a "files" store keyed
 *               by path holding raw bytes. No directory records and no
 *               timestamps, so those saves show as "date unknown".
 *               kirikiri: "krkr2-space-<game folder>", keys absolute.
 *               siglus:   "siglus-saves-<game folder>", keys relative.
 *
 * Exports are plain zips, so they can be unzipped and inspected, and an
 * import puts the same files back where they came from.
 */
(function () {
  "use strict";

  const LIBRARY_DIR = "library"; // assets/library.js owns this one
  const DIR_MODE = 16895;        // S_IFDIR | 0777
  const FILE_MODE = 33206;       // S_IFREG | 0666

  // Every runtime keeps its files in an Emscripten mount of its own, and
  // most of those mounts hold more than saves. Each one is described here so
  // the panel can show games rather than raw filesystem folders.
  //
  //   games  - one entry per folder: those folders are the games
  //   single - the whole mount is one entry (a disk image, a memory card set)
  const SOURCES = [
    { db: "/save", runtime: "onscripter", mode: "games" },
    { db: "/home", runtime: "rlvm", mode: "games", strip: [".rlvm"] },
    // Ren'Py mounts IDBFS at ~/.renpy and gives each game a folder named after
    // its config.save_directory. Its own database, so it does not collide with
    // rlvm's "/home" one.
    { db: "/home/web_user/.renpy", runtime: "renpy", mode: "games" },
    {
      db: "/home/web_user/.local/share/Play Data Files",
      runtime: "ps2", mode: "single", label: "PS2 memory cards",
    },
    {
      db: "/root", runtime: "boxedwine", mode: "single", system: true,
      label: "BoxedWine disk", note: "the Windows install, its games and their saves",
    },
    {
      db: "/d_drive", runtime: "boxedwine", mode: "single", system: true,
      label: "BoxedWine D: drive",
    },
  ];

  // Scratch directories a mount may contain; never a save on their own.
  // "tokens" is Ren'Py's save-signing keys, not a game.
  const NOISE = new Set([
    "tmp", "var", "dev", "proc", "sys", "run", "(loose files)", "tokens",
  ]);

  // --- reading ------------------------------------------------------------

  function openDb(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        // Opening a database that does not exist would create an empty one.
        request.transaction.abort();
        reject(new Error("no such database"));
      };
    });
  }

  function idbEntries(db) {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains("FILE_DATA")) return resolve([]);
      const store = db.transaction("FILE_DATA").objectStore("FILE_DATA");
      const keys = store.getAllKeys();
      const values = store.getAll();
      keys.onerror = () => reject(keys.error);
      values.onsuccess = () => {
        resolve(keys.result.map((key, i) => ({ path: String(key), value: values.result[i] })));
      };
    });
  }

  // --- flat per-game stores (kirikiri, siglus) -----------------------------
  //
  // Both runtimes keep one database per game with a single "files" store, so
  // one reader serves both. They differ only in the database prefix and
  // whether keys carry a leading slash.
  const FLAT_STORES = [
    { prefix: "krkr2-space-", runtime: "kirikiri", keyPrefix: "/", spacesKey: "krkr2-spaces" },
    { prefix: "siglus-saves-", runtime: "siglus", keyPrefix: "" },
  ];

  function krkrEntries(db) {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains("files")) return resolve([]);
      const store = db.transaction("files").objectStore("files");
      const keys = store.getAllKeys();
      const values = store.getAll();
      keys.onerror = () => reject(keys.error);
      values.onsuccess = () => {
        resolve(keys.result.map((key, i) => ({
          path: String(key),
          data: values.result[i],
        })));
      };
    });
  }

  function krkrBytes(data) {
    return data ? data.length || data.byteLength || 0 : 0;
  }

  // One database is one game, so it is always a single set.
  async function scanFlat(db, spec) {
    let handle;
    try {
      handle = await openDb(db);
    } catch (error) {
      return [];
    }
    const entries = await krkrEntries(handle);
    handle.close();
    if (!entries.length) return [];

    return [{
      id: `flat:${db}`,
      kind: "flat",
      db,
      keyPrefix: spec.keyPrefix,
      spacesKey: spec.spacesKey || null,
      group: "",
      name: db.slice(spec.prefix.length) || db,
      runtime: spec.runtime,
      system: false,
      files: entries.map((entry) => ({
        path: entry.path.replace(/^\//, ""),
        bytes: krkrBytes(entry.data),
      })),
      bytes: entries.reduce((sum, entry) => sum + krkrBytes(entry.data), 0),
      // This store keeps no timestamps; the panel shows "date unknown".
      modified: 0,
    }];
  }

  function isDir(entry) {
    return ((entry.value && entry.value.mode) & 61440) === 16384; // S_IFMT / S_IFDIR
  }

  function bytesOf(entry) {
    const contents = entry.value && entry.value.contents;
    return contents ? contents.length || contents.byteLength || 0 : 0;
  }

  function describe(db) {
    return SOURCES.find((source) => source.db === db) ||
      { db, runtime: "other", mode: "single", system: true, label: db.replace(/^\//, "") };
  }

  // One entry per game folder, or one for the whole mount.
  async function scanIdb(db) {
    const source = describe(db);
    let handle;
    try {
      handle = await openDb(db);
    } catch (error) {
      return [];
    }
    const entries = (await idbEntries(handle)).filter((entry) => !isDir(entry));
    handle.close();
    if (!entries.length) return [];

    const relative = (path) => {
      let rest = path.startsWith(db + "/") ? path.slice(db.length + 1) : path.replace(/^\//, "");
      for (const prefix of source.strip || []) {
        if (rest.startsWith(prefix + "/")) rest = rest.slice(prefix.length + 1);
      }
      return rest;
    };

    const stamp = (entry) => {
      const value = entry.value && entry.value.timestamp;
      return value instanceof Date ? value.getTime() : Number(value) || 0;
    };

    if (source.mode === "single") {
      return [{
        id: `idb:${db}`,
        kind: "idb",
        db,
        group: "",
        name: source.label || db,
        runtime: source.runtime,
        system: !!source.system,
        note: source.note,
        files: entries.map((entry) => ({ path: relative(entry.path), bytes: bytesOf(entry) })),
        bytes: entries.reduce((sum, entry) => sum + bytesOf(entry), 0),
        modified: entries.reduce((latest, entry) => Math.max(latest, stamp(entry)), 0),
      }];
    }

    const groups = new Map();
    for (const entry of entries) {
      const rest = relative(entry.path);
      const cut = rest.indexOf("/");
      const group = cut < 0 ? "" : rest.slice(0, cut);
      // Files loose in the mount, and scratch folders, are not games.
      if (!group || NOISE.has(group.toLowerCase())) continue;
      if (!groups.has(group)) groups.set(group, { files: [], bytes: 0, modified: 0 });
      const target = groups.get(group);
      target.files.push({ path: rest.slice(cut + 1), bytes: bytesOf(entry) });
      target.bytes += bytesOf(entry);
      target.modified = Math.max(target.modified, stamp(entry));
    }

    return [...groups].map(([group, data]) => ({
      id: `idb:${db}:${group}`,
      kind: "idb",
      db,
      group,
      prefix: `${db}/${(source.strip || []).map((p) => p + "/").join("")}${group}`,
      name: group,
      runtime: source.runtime,
      system: false,
      ...data,
    }));
  }

  async function* walk(dir, prefix = "") {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "file") yield { path, handle };
      else yield* walk(handle, path);
    }
  }

  async function scanOpfs() {
    const root = await navigator.storage.getDirectory();
    const sets = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== "directory" || name === LIBRARY_DIR) continue;
      const files = [];
      let bytes = 0;
      let modified = 0;
      for await (const { path, handle: fileHandle } of walk(handle)) {
        const file = await fileHandle.getFile();
        files.push({ path, bytes: file.size });
        bytes += file.size;
        if (file.lastModified > modified) modified = file.lastModified;
      }
      if (!files.length) continue;
      sets.push({
        id: `opfs:${name}`,
        kind: "opfs",
        group: name,
        name,
        runtime: "onscripter-ru",
        where: "browser storage",
        files,
        bytes,
        modified,
      });
    }
    return sets;
  }

  async function scan() {
    const names = (await indexedDB.databases()).map((info) => info.name).filter(Boolean);
    const sets = [];
    // IDBFS mounts are named for their mount point; the kirikiri and siglus
    // runtimes make one database per game instead, so both are discovered
    // rather than listed.
    for (const name of names.filter((n) => n.startsWith("/"))) {
      sets.push(...(await scanIdb(name)));
    }
    for (const spec of FLAT_STORES) {
      for (const name of names.filter((n) => n.startsWith(spec.prefix))) {
        sets.push(...(await scanFlat(name, spec)));
      }
    }
    sets.push(...(await scanOpfs()));
    return sets.sort((a, b) => b.modified - a.modified);
  }

  // --- export / import / delete -------------------------------------------

  async function readSet(set) {
    const files = {};
    if (set.kind === "flat") {
      const db = await openDb(set.db);
      const entries = await krkrEntries(db);
      db.close();
      for (const entry of entries) {
        const data = entry.data;
        files[entry.path.replace(/^\//, "")] =
          data instanceof Uint8Array ? data : new Uint8Array(data);
      }
      return files;
    }
    if (set.kind === "opfs") {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(set.group);
      for await (const { path, handle } of walk(dir)) {
        files[path] = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      }
      return files;
    }
    const db = await openDb(set.db);
    const entries = await idbEntries(db);
    db.close();
    const prefix = set.group ? `${set.prefix}/` : `${set.db}/`;
    for (const entry of entries) {
      if (isDir(entry) || !entry.path.startsWith(prefix)) continue;
      const contents = entry.value.contents;
      files[entry.path.slice(prefix.length)] = contents instanceof Uint8Array
        ? contents
        : new Uint8Array(contents);
    }
    return files;
  }

  async function exportSet(set) {
    const files = await readSet(set);
    if (!Object.keys(files).length) throw new Error("There is nothing in that save.");
    const zipped = await new Promise((resolve, reject) => {
      fflate.zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([zipped], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${set.name}-saves-${stamp}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function importInto(set, file) {
    const data = new Uint8Array(await file.arrayBuffer());
    const unzipped = await new Promise((resolve, reject) => {
      fflate.unzip(data, (err, result) => (err ? reject(err) : resolve(result)));
    });
    const paths = Object.keys(unzipped).filter((p) => !p.endsWith("/"));
    if (!paths.length) throw new Error("That zip is empty.");

    if (set.kind === "flat") {
      const db = await openDb(set.db);
      await new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        const store = tx.objectStore("files");
        // The zip holds paths without a leading slash, the way export wrote
        // them; put them back in whatever form this store keys on.
        for (const path of paths) {
          store.put(unzipped[path], set.keyPrefix + path.replace(/^\//, ""));
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return paths.length;
    }

    if (set.kind === "opfs") {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(set.group, { create: true });
      for (const path of paths) {
        let target = dir;
        const parts = path.split("/");
        for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part, { create: true });
        const handle = await target.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await handle.createWritable();
        await writable.write(unzipped[path]);
        await writable.close();
      }
      return paths.length;
    }

    const db = await openDb(set.db);
    await new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const store = tx.objectStore("FILE_DATA");
      const now = new Date();
      const dirs = new Set();
      for (const path of paths) {
        const full = `${set.group ? set.prefix : set.db}/${path}`;
        // IDBFS wants a record for each directory on the way down.
        const parts = full.split("/");
        for (let i = 2; i < parts.length; i++) {
          const dirPath = parts.slice(0, i).join("/");
          if (dirPath && !dirs.has(dirPath)) {
            dirs.add(dirPath);
            store.put({ timestamp: now, mode: DIR_MODE }, dirPath);
          }
        }
        store.put({ timestamp: now, mode: FILE_MODE, contents: unzipped[path] }, full);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return paths.length;
  }

  async function deleteSet(set) {
    if (set.kind === "flat") {
      // A database is one game, so the whole thing goes. The runtime also
      // keeps a list of its save spaces for its own picker; drop it there too
      // so a deleted game does not linger in it.
      // A running game holds its database open. Chrome then neither completes
      // the delete nor fires "blocked" - the request simply never settles - so
      // this waits a moment and reports it rather than hanging, or claiming a
      // deletion that did not happen. The request stays queued, so it goes
      // through by itself once the game lets go.
      const blocked = new Error(
        `"${set.name}" is still open, so this is waiting on it. ` +
        "Close the game and it will finish on its own.");
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(set.db);
        const timer = setTimeout(() => reject(blocked), 4000);
        const settle = (fn, value) => { clearTimeout(timer); fn(value); };
        request.onsuccess = () => settle(resolve);
        request.onerror = () => settle(reject, request.error);
        request.onblocked = () => settle(reject, blocked);
      });
      if (set.spacesKey) {
        try {
          const spaces = JSON.parse(localStorage.getItem(set.spacesKey) || "[]");
          localStorage.setItem(set.spacesKey,
            JSON.stringify(spaces.filter((name) => name !== set.name)));
        } catch (error) { /* private mode, or nothing stored */ }
      }
      return;
    }

    if (set.kind === "opfs") {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(set.group, { recursive: true });
      return;
    }
    const db = await openDb(set.db);
    await new Promise((resolve, reject) => {
      const tx = db.transaction("FILE_DATA", "readwrite");
      const store = tx.objectStore("FILE_DATA");
      const prefix = set.group ? set.prefix : set.db;
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) {
          const path = String(key);
          if (path === prefix || path.startsWith(prefix + "/")) store.delete(key);
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  // --- helpers -------------------------------------------------------------

  function bytesLabel(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes || 0;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function dateLabel(time) {
    if (!time) return "date unknown";
    const date = new Date(time);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
      ? `today ${date.toTimeString().slice(0, 5)}`
      : date.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  // --- popup ---------------------------------------------------------------

  let dialog = null;
  let busy = false;
  let sets = [];

  function build() {
    dialog = document.createElement("div");
    dialog.className = "library-backdrop hidden";
    dialog.innerHTML = `
      <div class="library-modal" role="dialog" aria-modal="true" aria-label="saves">
        <div class="library-bar">
          <b>saves</b>
          <button class="tiny-button" type="button" id="saves-close">close</button>
        </div>
        <div class="library-add">
          <p class="control-note">Saves the runtimes keep inside this browser. Export one to keep a copy on your device, or put an exported zip back. Close a running game first: it writes its own saves when it exits.</p>
        </div>
        <div class="library-list" id="saves-list"></div>
        <div class="library-foot">
          <p id="saves-status">Status: ready.</p>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    dialog.querySelector("#saves-close").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog && !dialog.classList.contains("hidden")) close();
    });
  }

  function status(text) {
    dialog.querySelector("#saves-status").textContent = `Status: ${text}`;
  }

  async function run(action, doneText) {
    if (busy) return;
    busy = true;
    dialog.classList.add("busy");
    try {
      await action();
      await render();
      status(doneText);
    } catch (error) {
      console.error(error);
      status(String((error && error.message) || error));
    } finally {
      busy = false;
      dialog.classList.remove("busy");
    }
  }

  async function render() {
    const list = dialog.querySelector("#saves-list");
    status("reading...");
    sets = await scan();
    const total = sets.reduce((sum, set) => sum + set.bytes, 0);

    if (!sets.length) {
      list.innerHTML = `<p class="control-note">No saves yet. They appear here once a game has saved.</p>`;
      status("no saves stored.");
      return;
    }

    const item = (set) => `
      <div class="library-item" data-id="${escapeHtml(set.id)}">
        <div class="library-item-main">
          <b>${escapeHtml(set.name)}</b>
          <span>${escapeHtml(set.runtime)} · ${set.files.length} file${set.files.length === 1 ? "" : "s"} · ${bytesLabel(set.bytes)} · ${dateLabel(set.modified)}${set.note ? " · " + escapeHtml(set.note) : ""}</span>
        </div>
        <div class="button-row">
          <button class="retro-button" type="button" data-act="export">export</button>
          <button class="retro-button secondary" type="button" data-act="import">import</button>
          <button class="retro-button secondary" type="button" data-act="delete">delete</button>
        </div>
      </div>`;

    const games = sets.filter((set) => !set.system);
    const other = sets.filter((set) => set.system);

    // Whole-disk and unrecognised mounts are kept apart: they are a runtime's
    // working files (with the saves inside), not one game's save.
    list.innerHTML =
      (games.length ? games.map(item).join("") : `<p class="control-note">No game saves yet.</p>`) +
      (other.length ? `<p class="control-note">Other data these runtimes keep here. Deleting one throws away everything that runtime has installed, not just its saves.</p>` + other.map(item).join("") : "");

    list.querySelectorAll("button[data-act]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.closest(".library-item").dataset.id;
        const set = sets.find((s) => s.id === id);
        if (!set) return;
        const act = button.dataset.act;
        if (act === "export") run(() => exportSet(set), "Exported.");
        else if (act === "import") {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".zip";
          input.addEventListener("change", () => {
            if (!input.files.length) return;
            run(() => importInto(set, input.files[0]),
              "Imported. Reload the page before playing.");
          });
          input.click();
        } else if (act === "delete") {
          const warning = set.system
            ? `Delete "${set.name}"?\n\nThis is everything that runtime keeps in this browser, including installed games. It cannot be undone.`
            : `Delete the saves for "${set.name}"?\n\nThis cannot be undone. Export them first if you want a copy.`;
          if (confirm(warning)) {
            run(() => deleteSet(set), "Deleted.");
          }
        }
      });
    });

    status(`${games.length} game save${games.length === 1 ? "" : "s"}` +
      (other.length ? `, ${other.length} other` : "") + ` · ${bytesLabel(total)} stored`);
  }

  window.NoberuSaves = {
    open() {
      if (!dialog) build();
      dialog.classList.remove("hidden");
      render();
    },
  };

  function close() {
    if (dialog) dialog.classList.add("hidden");
  }
})();
