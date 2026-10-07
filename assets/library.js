/**
 * noberu library: the games someone has added, and the popup that manages
 * them. Loaded by index.html, which uses it in two ways:
 *
 *   NoberuLibrary.openManager()        - the download icon in the header
 *   NoberuLibrary.pick(engine)         - the "from library" button in a tab;
 *                                        resolves to a File[] (or one File for
 *                                        single-file runtimes), or null
 *
 * A game is stored one of two ways:
 *
 *   linked - a FileSystemDirectoryHandle kept in IndexedDB. Nothing is copied,
 *            so adding a 12 GB game is instant, but it breaks if the folder is
 *            moved or deleted. This is the default for folders on this device.
 *   stored - a copy inside the browser's private storage (OPFS) under
 *            library/<id>/. Downloads land here, and "make a copy" converts a
 *            linked game into one.
 *
 * Files handed to the runtimes are ordinary File objects carrying
 * webkitRelativePath, the same shape a directory <input> produces, so the
 * tabs cannot tell the difference.
 */
(function () {
  "use strict";

  const DB_NAME = "noberu-library";
  const STORE = "games";
  const ROOT_DIR = "library";

  // --- storage ------------------------------------------------------------

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      // Entries saved before gameRoot() existed kept Ren'Py's game/ as their
      // root; everything reads through here, so this corrects them all.
      request.onsuccess = () => resolve(request.result
        .map((entry) => ({ ...entry, root: gameRoot(entry.engine, entry.root || "") }))
        .sort((a, b) => b.addedAt - a.addedAt));
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(entry) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve(entry);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Private windows (Safari, Firefox) refuse this storage with a vague error
  // such as "UnknownError ... transient reason"; say what to do instead.
  async function storageRoot() {
    try {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle(ROOT_DIR, { create: true });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw new Error("This browser won't save games here. " +
        "If this is a private window, open noberu in a normal one.");
    }
  }

  async function entryDir(entry, create = false) {
    return (await storageRoot()).getDirectoryHandle(entry.id, { create });
  }

  // Walks a directory handle, yielding { path, handle } for every file.
  async function* walk(dir, prefix = "") {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith(".")) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "file") yield { path, handle };
      else yield* walk(handle, path);
    }
  }

  async function ensureDir(root, path) {
    let dir = root;
    for (const part of path.split("/").slice(0, -1)) {
      if (part) dir = await dir.getDirectoryHandle(part, { create: true });
    }
    return dir;
  }

  async function writeFile(root, path, data) {
    const dir = await ensureDir(root, path);
    const handle = await dir.getFileHandle(path.split("/").pop(), { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  // --- engines ------------------------------------------------------------

  const ENGINES = {
    rlvm: { label: "RealLive", tab: "rlvm" },
    onscripter: { label: "NScripter", tab: "ons" },
    "onscripter-ru": { label: "Umineko Project", tab: "onsru" },
    renpy: { label: "Ren'Py", tab: "renpy" },
    kirikiri: { label: "KiriKiri", tab: "kirikiri" },
    siglus: { label: "SiglusEngine", tab: "siglus" },
    tyrano: { label: "TyranoScript", tab: "tyrano" },
    rpgmaker: { label: "RPG Maker", tab: "rpgmaker" },
    vnds: { label: "VNDS", tab: "vnds" },
    ps2: { label: "PS2", tab: "ps2" },
    // Desktop only: the wine tab is hidden on touch devices (assets/mobile.css).
    wine: { label: "Windows", tab: document.documentElement.dataset.touch === "1" ? null : "boxedwine" },
    archive: { label: "archive", tab: null },
    unknown: { label: "unknown", tab: null },
  };

  // Guesses from the file names alone; nothing is read. Games are often one
  // or two folders deep inside what someone picked (a "Game/KINETICDATA"
  // layout, or a zip with a wrapper folder), so every directory is tried and
  // the shallowest match wins. Returns { engine, root }, where root is the
  // folder the runtime should treat as the game.
  function detectEngine(paths) {
    const byDir = new Map();
    for (const path of paths) {
      const cut = path.lastIndexOf("/");
      const dir = cut < 0 ? "" : path.slice(0, cut);
      const name = path.slice(cut + 1).toLowerCase();
      if (!byDir.has(dir)) byDir.set(dir, new Set());
      byDir.get(dir).add(name);
    }

    if (paths.length === 1 && /\.(zip|7z|rar)$/i.test(paths[0])) {
      return { engine: "archive", root: "" };
    }

    // TyranoScript ships its engine beside the game as `tyrano/tyrano.js`, which
    // also says where the game's root is - the folder holding that and index.html.
    // Checked before the per-directory tests because Tyrano scenarios are `.ks`
    // files, the same extension KiriKiri uses.
    const tyrano = paths.find((path) => /(^|\/)tyrano\/tyrano\.js$/i.test(path));
    if (tyrano) {
      const cut = tyrano.toLowerCase().lastIndexOf("tyrano/tyrano.js");
      return { engine: "tyrano", root: tyrano.slice(0, cut).replace(/\/$/, "") };
    }

    // RPG Maker MV and MZ are web games too, with the engine's first script at
    // js/rpg_core.js (MV) or js/rmmz_core.js (MZ) inside the game's folder -
    // which is www/ next to the .exe for an MV release, so this goes before the
    // .exe fallback below. The shallowest one is the game; a deeper copy is
    // usually a plugin's bundled sample.
    const rpgmaker = paths
      .filter((path) => /(^|\/)js\/(rpg_core|rmmz_core)\.js$/i.test(path))
      .sort((a, b) => a.split("/").length - b.split("/").length)[0];
    if (rpgmaker) {
      return { engine: "rpgmaker", root: rpgmaker.replace(/\/?js\/[^/]+$/i, "") };
    }

    const test = (names) => {
      const has = (n) => names.has(n);
      const any = (re) => [...names].some((n) => re.test(n));
      if (has("default.cfg") && any(/\.file$/)) return "onscripter-ru";
      // A Ren'Py game's assets live in game/, one below the folder with the .exe.
      if (has("script_version.txt") || any(/\.rpa$/) || any(/\.rpyc$/)) return "renpy";
      // Localized Steam builds ship SceneEN.pck / GameexeEN.dat rather than the
      // canonical names, so match the whole family.
      if (any(/(^|\/)scene[a-z]*\.pck$/i)) return "siglus";
      if (any(/\.xp3$/)) return "kirikiri";
      if (has("gameexe.ini") || has("seen.txt")) return "rlvm";
      if (has("nscript.dat") || has("0.txt") || has("00.txt") ||
          has("nscr_sec.dat") || has("nscript.___") || has("onscript.nt2") ||
          has("onscript.nt3")) return "onscripter";
      if (has("info.txt") || has("default.ttf") && has("icon.png")) return "vnds";
      if (any(/\.(iso|bin|cue|chd|isz|cso|elf)$/)) return "ps2";
      if (any(/\.exe$/)) return "wine";
      return null;
    };

    const dirs = [...byDir.keys()].sort(
      (a, b) => (a ? a.split("/").length : 0) - (b ? b.split("/").length : 0) || a.localeCompare(b));
    // A .exe sits next to many games, so prefer any deeper, more specific hit.
    let fallback = null;
    for (const dir of dirs) {
      const engine = test(byDir.get(dir));
      if (!engine) continue;
      if (engine === "wine" || engine === "ps2") {
        fallback = fallback || { engine, root: dir };
        continue;
      }
      return { engine, root: gameRoot(engine, dir) };
    }
    return fallback || { engine: "unknown", root: "" };
  }

  // A Ren'Py game's scripts are in game/, but the game is the folder above:
  // games also read and write beside it (DDLC's characters/*.chr).
  function gameRoot(engine, root) {
    if (engine !== "renpy") return root;
    if (/^game$/i.test(root)) return "";
    return root.replace(/\/game$/i, "");
  }

  // --- adding -------------------------------------------------------------

  function newId() {
    return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function sanitize(name) {
    return (name || "game").replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 80) || "game";
  }

  async function scanHandle(dir, onProgress) {
    const paths = [];
    let bytes = 0;
    for await (const { path, handle } of walk(dir)) {
      paths.push(path);
      bytes += (await handle.getFile()).size;
      if (onProgress && paths.length % 500 === 0) onProgress(`scanning ${paths.length} files...`);
    }
    return { paths, bytes };
  }

  async function addFolder(onProgress) {
    if (!window.showDirectoryPicker) {
      throw new Error("This browser cannot link folders; use Chrome or Edge, or add a .zip instead.");
    }
    const dir = await window.showDirectoryPicker({ mode: "read", id: "noberu-library" });
    onProgress("scanning folder...");
    const { paths, bytes } = await scanHandle(dir, onProgress);
    if (!paths.length) throw new Error("That folder is empty.");
    return dbPut({
      id: newId(),
      name: dir.name,
      kind: "linked",
      handle: dir,
      ...detectEngine(paths),
      fileCount: paths.length,
      bytes,
      addedAt: Date.now(),
    });
  }

  // Fallback for browsers without folder handles, and for adding a single
  // file (a .zip, a PS2 image): both have to be copied in.
  async function addFiles(files, onProgress) {
    const list = [...files];
    if (!list.length) throw new Error("Nothing was selected.");
    const rootName = (list[0].webkitRelativePath || "").split("/")[0];
    const id = newId();
    const dir = await (await storageRoot()).getDirectoryHandle(id, { create: true });

    let bytes = 0;
    const paths = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      let path = file.webkitRelativePath || file.name;
      if (rootName && path.startsWith(rootName + "/")) path = path.slice(rootName.length + 1);
      await writeFile(dir, path, file);
      paths.push(path);
      bytes += file.size;
      if (i % 20 === 0) onProgress(`copying ${i + 1} / ${list.length} files...`);
    }

    return dbPut({
      id,
      name: sanitize(rootName || list[0].name),
      kind: "stored",
      ...detectEngine(paths),
      fileCount: paths.length,
      bytes,
      addedAt: Date.now(),
    });
  }

  async function addFromUrl(url, onProgress) {
    let parsed;
    try {
      parsed = new URL(url, location.href);
    } catch (e) {
      throw new Error("That is not a valid link.");
    }
    onProgress("downloading...");
    // Browser-direct: a server that does not allow cross-origin reads fails
    // here, and the message says so.
    let response;
    try {
      response = await fetch(parsed.href);
    } catch (e) {
      throw new Error(`The download was blocked by the browser (${e.message}). ` +
        "That server does not allow other sites to read its files.");
    }
    if (!response.ok) throw new Error(`The server answered ${response.status} ${response.statusText}.`);

    const total = Number(response.headers.get("Content-Length")) || 0;
    const name = sanitize(decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "download"));
    const id = newId();
    const dir = await (await storageRoot()).getDirectoryHandle(id, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();

    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        received += value.length;
        onProgress(`downloading ${bytesLabel(received)}${total ? " / " + bytesLabel(total) : ""}...`);
      }
    } else {
      const blob = await response.blob();
      await writable.write(blob);
      received = blob.size;
    }
    await writable.close();

    return dbPut({
      id,
      name,
      kind: "stored",
      ...detectEngine([name]),
      fileCount: 1,
      bytes: received,
      addedAt: Date.now(),
      source: parsed.href,
    });
  }

  // For assets/beam.js: a stored entry written file by file as it arrives
  // from another device. Nothing is listed until commit(); abort() removes
  // whatever was written.
  async function createStored(name) {
    const id = newId();
    const dir = await (await storageRoot()).getDirectoryHandle(id, { create: true });
    return {
      id,
      async open(path) {
        const parent = await ensureDir(dir, path);
        const handle = await parent.getFileHandle(path.split("/").pop(), { create: true });
        return handle.createWritable();
      },
      commit({ paths, bytes, engine, root }) {
        const detected = detectEngine(paths);
        return dbPut({
          id,
          name: sanitize(name),
          kind: "stored",
          engine: engine || detected.engine,
          root: engine ? (root || "") : detected.root,
          fileCount: paths.length,
          bytes,
          addedAt: Date.now(),
          source: "beam",
        });
      },
      async abort() {
        try {
          await (await storageRoot()).removeEntry(id, { recursive: true });
        } catch (error) { /* nothing written yet */ }
      },
    };
  }

  // --- actions on an entry -------------------------------------------------

  async function ensurePermission(entry) {
    if (entry.kind !== "linked") return true;
    const options = { mode: "read" };
    if ((await entry.handle.queryPermission(options)) === "granted") return true;
    return (await entry.handle.requestPermission(options)) === "granted";
  }

  // Returns File objects carrying webkitRelativePath, as a directory input does.
  async function getFiles(entry, onProgress) {
    const dir = entry.kind === "linked" ? entry.handle : await entryDir(entry);
    if (entry.kind === "linked" && !(await ensurePermission(entry))) {
      throw new Error("Permission to read that folder was declined.");
    }
    // Everything below entry.root is the game; the prefix is stripped so the
    // runtime sees the layout it expects.
    const root = gameRoot(entry.engine, entry.root || "");
    const prefix = root ? root + "/" : "";
    const files = [];
    for await (const { path, handle } of walk(dir)) {
      if (prefix && !path.startsWith(prefix)) continue;
      const file = await handle.getFile();
      Object.defineProperty(file, "webkitRelativePath", { value: `${entry.name}/${path.slice(prefix.length)}` });
      files.push(file);
      if (onProgress && files.length % 2000 === 0) onProgress(`opening ${files.length} files...`);
    }
    if (!files.length) throw new Error("That game has no files any more.");
    return files;
  }

  async function copyToStorage(entry, onProgress) {
    if (entry.kind === "stored") return entry;
    if (!(await ensurePermission(entry))) throw new Error("Permission to read that folder was declined.");
    const id = newId();
    const dir = await (await storageRoot()).getDirectoryHandle(id, { create: true });
    let done = 0;
    let bytes = 0;
    for await (const { path, handle } of walk(entry.handle)) {
      const file = await handle.getFile();
      await writeFile(dir, path, file);
      bytes += file.size;
      if (++done % 20 === 0) onProgress(`copying ${done} files (${bytesLabel(bytes)})...`);
    }
    await dbDelete(entry.id);
    return dbPut({ ...entry, id, kind: "stored", handle: undefined, bytes, fileCount: done });
  }

  async function unzip(entry, onProgress) {
    if (entry.kind !== "stored") throw new Error("Make a copy first, then unzip it.");
    const dir = await entryDir(entry);
    let archiveName = null;
    for await (const { path } of walk(dir)) {
      if (/\.zip$/i.test(path)) {
        archiveName = path;
        break;
      }
    }
    if (!archiveName) throw new Error("There is no .zip in that entry.");

    onProgress("reading the archive...");
    const archiveFile = await (await ensureDir(dir, archiveName))
      .getFileHandle(archiveName.split("/").pop())
      .then((h) => h.getFile());
    const data = new Uint8Array(await archiveFile.arrayBuffer());

    onProgress("unpacking...");
    const unzipped = await new Promise((resolve, reject) => {
      fflate.unzip(data, (err, result) => (err ? reject(err) : resolve(result)));
    });

    const paths = Object.keys(unzipped).filter((p) => !p.endsWith("/"));
    if (!paths.length) throw new Error("That archive is empty.");
    // Drop a single wrapping folder, so the game sits at the top.
    const first = paths[0].split("/")[0];
    const wrapped = paths.every((p) => p.startsWith(first + "/"));

    let bytes = 0;
    for (let i = 0; i < paths.length; i++) {
      const path = wrapped ? paths[i].slice(first.length + 1) : paths[i];
      if (!path) continue;
      await writeFile(dir, path, unzipped[paths[i]]);
      bytes += unzipped[paths[i]].length;
      if (i % 20 === 0) onProgress(`writing ${i + 1} / ${paths.length} files...`);
    }
    await dir.removeEntry(archiveName.split("/").pop());

    const kept = paths.map((p) => (wrapped ? p.slice(first.length + 1) : p)).filter(Boolean);
    return dbPut({
      ...entry,
      name: wrapped ? sanitize(first) : entry.name,
      ...detectEngine(kept),
      fileCount: kept.length,
      bytes,
    });
  }

  async function remove(entry) {
    if (entry.kind === "stored") {
      try {
        await (await storageRoot()).removeEntry(entry.id, { recursive: true });
      } catch (e) {
        console.warn("could not remove stored files", e);
      }
    }
    await dbDelete(entry.id);
  }

  async function usage() {
    if (!navigator.storage.estimate) return null;
    const { usage: used, quota } = await navigator.storage.estimate();
    return { used, quota };
  }

  // --- helpers -------------------------------------------------------------

  function bytesLabel(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes || 0;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  // --- popup ---------------------------------------------------------------

  let dialog = null;
  let pickEngine = null;
  let pickResolve = null;
  let busy = false;

  function build() {
    dialog = document.createElement("div");
    dialog.className = "library-backdrop hidden";
    dialog.innerHTML = `
      <div class="library-modal" role="dialog" aria-modal="true" aria-label="downloads">
        <div class="library-bar">
          <b id="library-title">downloads</b>
          <button class="tiny-button" type="button" id="library-close">close</button>
        </div>
        <div class="library-add">
          <div class="button-row">
            <button class="retro-button" type="button" id="library-add-folder">add folder</button>
            <button class="retro-button secondary" type="button" id="library-add-file">add file</button>
            <button class="retro-button secondary" type="button" id="library-receive">receive</button>
          </div>
          <form class="library-url" id="library-url-form">
            <input type="url" id="library-url" placeholder="https://example.com/game.zip" />
            <button class="retro-button" type="submit">download</button>
          </form>
          <p class="control-note" id="library-note"><span class="brief">Add a game folder, or paste a link to a .zip.</span><span class="verbose">Folders stay where they are; only a reference is kept, so adding one is instant. Downloads and files are copied into this browser.</span></p>
        </div>
        <div class="library-list" id="library-list"></div>
        <div class="library-foot">
          <p id="library-status">Status: ready.</p>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    dialog.querySelector("#library-close").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog && !dialog.classList.contains("hidden")) close();
    });

    dialog.querySelector("#library-add-folder").addEventListener("click", () => {
      run(() => addFolder(status), "Added.");
    });
    dialog.querySelector("#library-add-file").addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.addEventListener("change", () => {
        if (input.files.length) run(() => addFiles(input.files, status), "Added.");
      });
      input.click();
    });
    // Another device beams a game here (assets/beam.js).
    dialog.querySelector("#library-receive").addEventListener("click", () => {
      if (window.NoberuBeam) window.NoberuBeam.receive();
    });
    dialog.querySelector("#library-url-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const field = dialog.querySelector("#library-url");
      const url = field.value.trim();
      if (!url) return;
      run(async () => {
        const entry = await addFromUrl(url, status);
        field.value = "";
        return entry;
      }, "Downloaded.");
    });
  }

  function status(text) {
    dialog.querySelector("#library-status").textContent = `Status: ${text}`;
  }

  // Runs one library action, keeping the popup honest about being busy.
  async function run(action, doneText) {
    if (busy) return;
    busy = true;
    dialog.classList.add("busy");
    try {
      await action();
      status(doneText);
      await render();
    } catch (error) {
      if (error && error.name === "AbortError") status("cancelled.");
      else {
        console.error(error);
        status(String((error && error.message) || error));
      }
    } finally {
      busy = false;
      dialog.classList.remove("busy");
    }
  }

  async function render() {
    const list = dialog.querySelector("#library-list");
    const entries = await dbAll();
    const space = await usage();
    const note = dialog.querySelector("#library-note");
    if (space) {
      note.dataset.space = `${bytesLabel(space.used)} of ${bytesLabel(space.quota)} used in this browser`;
    }

    if (!entries.length) {
      list.innerHTML = `<p class="control-note">Nothing added yet. Add a game folder from this device, or paste a link to a .zip.</p>`;
      return;
    }

    // The engine is only a guess from file names, so every entry can be sent
    // to a runtime of the viewer's choosing instead.
    const runtimes = Object.entries(ENGINES).filter(([, e]) => e.tab);
    list.innerHTML = entries.map((entry) => {
      const engine = ENGINES[entry.engine] || ENGINES.unknown;
      const target = pickEngine || (engine.tab ? entry.engine : "");
      const matches = !pickEngine || entry.engine === pickEngine;
      const options = runtimes.map(([id, e]) =>
        `<option value="${id}"${id === target ? " selected" : ""}>${escapeHtml(e.label)}</option>`).join("");
      const detail = [
        escapeHtml(engine.label) + (entry.root ? ` in ${escapeHtml(entry.root)}` : ""),
        `${entry.fileCount} file${entry.fileCount === 1 ? "" : "s"}`,
        bytesLabel(entry.bytes),
        entry.kind,
      ].join(" · ");
      return `
        <div class="library-item${matches ? "" : " dim"}" data-id="${entry.id}">
          <div class="library-item-main">
            <b>${escapeHtml(entry.name)}</b>
            <span>${detail}</span>
          </div>
          <div class="button-row">
            ${entry.engine === "archive" ? "" : `<select class="library-engine" aria-label="runtime for ${escapeHtml(entry.name)}">${options}</select>
            <button class="retro-button" type="button" data-act="boot">${pickEngine ? (matches ? "use this" : "use anyway") : "play"}</button>`}
            ${pickEngine ? "" : `<button class="retro-button secondary" type="button" data-act="beam">beam</button>`}
            ${entry.kind === "linked" ? `<button class="retro-button secondary" type="button" data-act="copy">make a copy</button>` : ""}
            ${entry.engine === "archive" ? `<button class="retro-button secondary" type="button" data-act="unzip">unzip</button>` : ""}
            <button class="retro-button secondary" type="button" data-act="remove">remove</button>
          </div>
        </div>`;
    }).join("");

    list.querySelectorAll("button[data-act]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.closest(".library-item").dataset.id;
        const entry = (await dbAll()).find((e) => e.id === id);
        if (!entry) return;
        const act = button.dataset.act;
        if (act === "beam") {
          if (window.NoberuBeam) window.NoberuBeam.send(entry);
        } else if (act === "copy") run(() => copyToStorage(entry, status), "Copied into this browser.");
        else if (act === "unzip") run(() => unzip(entry, status), "Unpacked.");
        else if (act === "remove") {
          if (confirm(`Remove "${entry.name}" from the library?` +
            (entry.kind === "stored" ? "\n\nIts copy in this browser is deleted." : "\n\nThe folder on your device is left alone."))) {
            run(() => remove(entry), "Removed.");
          }
        } else if (act === "boot") {
          const chosen = button.closest(".library-item").querySelector(".library-engine");
          run(() => boot(entry, chosen ? chosen.value : entry.engine), "Handed to the runtime.");
        }
      });
    });
  }

  async function boot(entry, engineId) {
    const engine = ENGINES[engineId] || ENGINES[entry.engine] || ENGINES.unknown;
    // A corrected guess is worth keeping, along with the root that engine
    // expects (Ren'Py's is the folder above game/).
    if (engineId && engineId !== entry.engine) {
      entry = { ...entry, engine: engineId, root: gameRoot(engineId, entry.root || "") };
      await dbPut(entry);
    }
    status("opening files...");
    const files = await getFiles(entry, status);
    if (pickResolve) {
      const resolve = pickResolve;
      pickResolve = null;
      close();
      resolve(files);
      return;
    }
    if (!engine.tab) throw new Error("No runtime here can play that.");
    close();
    if (window.NoberuSession) window.NoberuSession.remember(entry, engineId || entry.engine);
    window.NoberuLibraryHandoff(engine.tab, files);
  }

  // Straight from an id to a running game, with no popup: the about tab's
  // "continue" (assets/session.js).
  async function play(id, engineId) {
    const entry = (await dbAll()).find((e) => e.id === id);
    if (!entry) throw new Error("That game is no longer in downloads.");
    const engine = ENGINES[engineId] || ENGINES[entry.engine] || ENGINES.unknown;
    if (!engine.tab) throw new Error("No runtime here can play that.");
    const files = await getFiles(entry);
    if (window.NoberuSession) window.NoberuSession.remember(entry, engineId || entry.engine);
    await window.NoberuLibraryHandoff(engine.tab, files, { boot: true });
  }

  function open(title) {
    if (!dialog) build();
    dialog.querySelector("#library-title").textContent = title;
    dialog.classList.remove("hidden");
    status("ready.");
    render();
  }

  function close() {
    if (!dialog) return;
    dialog.classList.add("hidden");
    pickEngine = null;
    if (pickResolve) {
      const resolve = pickResolve;
      pickResolve = null;
      resolve(null);
    }
  }

  // The tab that a library engine id stages into, so callers do not each keep
  // their own copy of this mapping.
  function tabFor(engineId) {
    const engine = ENGINES[engineId];
    return (engine && engine.tab) || null;
  }

  window.NoberuLibrary = {
    tabFor,
    engineLabel(engineId) {
      return (ENGINES[engineId] || ENGINES.unknown).label;
    },
    // Used by the about tab's "autodetect engine" button, which adds a game to
    // the library and stages it in one step rather than making the two trips.
    addFolder,
    addFiles,
    getFiles,
    play,
    createStored,
    list: dbAll,
    // Redraws the popup if it is open (a beam just landed, say).
    refresh() {
      if (dialog && !dialog.classList.contains("hidden")) render();
    },
    openManager() {
      pickEngine = null;
      open("downloads");
    },
    // Resolves to File[] for the chosen game, or null if the popup is closed.
    pick(engine) {
      return new Promise((resolve) => {
        pickEngine = engine;
        pickResolve = resolve;
        open(`downloads — pick a ${(ENGINES[engine] || ENGINES.unknown).label} game`);
      });
    },
    bytesLabel,
  };
})();
