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

  // The game shelf (assets/shelf.js) redraws on this.
  function changed() {
    window.dispatchEvent(new CustomEvent("noberu-library-change"));
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
      tx.oncomplete = () => {
        changed();
        resolve(entry);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => {
        changed();
        resolve();
      };
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

  // Chrome's folder-handle API silently skips files whose names it considers
  // unsafe (control characters, for instance: Umineko ships voice files with a
  // DEL in the name). Those files are invisible to a linked folder and to a
  // copy made from one, so "fix missing files" re-reads the folder through the
  // directory <input>, which has no such filter, and keeps whatever was hidden
  // here, in the browser's own storage.
  async function patchDir(entry, create = false) {
    return (await storageRoot()).getDirectoryHandle(`${entry.id}-patch`, { create });
  }

  async function patchFiles(entry) {
    try {
      const dir = await patchDir(entry);
      const out = [];
      for await (const file of walk(dir)) out.push(file);
      return out;
    } catch (error) {
      return []; // no patch for this entry
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

  async function createWritable(root, path) {
    const dir = await ensureDir(root, path);
    const handle = await dir.getFileHandle(path.split("/").pop(), { create: true });
    return handle.createWritable();
  }

  // A File goes over in slices: handing a multi-GB one to write() in one go
  // can make a phone's browser buffer it and run out of memory.
  const WRITE_SLICE = 16 * 1024 * 1024;

  async function writeFile(root, path, data) {
    const writable = await createWritable(root, path);
    if (data instanceof Blob && data.size > WRITE_SLICE) {
      for (let at = 0; at < data.size; at += WRITE_SLICE) {
        await writable.write(data.slice(at, at + WRITE_SLICE));
      }
    } else {
      await writable.write(data);
    }
    await writable.close();
  }

  // --- archives -------------------------------------------------------------

  // Unpacks a zip or 7z straight from a File (or Blob) into a directory without
  // ever holding the archive, or any file in it, in memory. For a zip the
  // central directory is read from the end, then each entry is inflated a
  // slice at a time and written as it comes out; 7z works the same way in
  // assets/sevenzip.js. A 4 GB archive on a phone needs a few MB of memory
  // rather than 8 GB. ZIP64 is understood, which zips that size need.

  const READ_WINDOW = 4 * 1024 * 1024;
  const INFLATE_SLICE = 1024 * 1024;

  // Random access into a Blob through one cached window, so walking thousands
  // of small entries is not one disk read per header.
  function blobReader(blob) {
    let start = 0;
    let bytes = new Uint8Array(0);
    return async function read(pos, len) {
      if (pos < start || pos + len > start + bytes.length) {
        start = pos;
        bytes = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + Math.max(len, READ_WINDOW))).arrayBuffer());
        if (bytes.length < len) throw new Error("That zip is cut short; download it again.");
      }
      return bytes.subarray(pos - start, pos - start + len);
    };
  }

  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 0x100000000;

  // Names are UTF-8 when the zip says so; older Japanese zips are usually
  // Shift_JIS, which is what the games inside expect their files to be called.
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let sjis = null;
  function zipName(bytes, flags) {
    if (flags & 0x800) return new TextDecoder().decode(bytes);
    try {
      return utf8.decode(bytes);
    } catch (e) {
      sjis = sjis || new TextDecoder("shift_jis");
      return sjis.decode(bytes);
    }
  }

  async function readZipIndex(blob) {
    const read = blobReader(blob);
    // The end-of-central-directory record is in the last 22 bytes plus up to
    // 64 KB of comment.
    const tailStart = Math.max(0, blob.size - 22 - 0xffff);
    const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("That file is not a zip or 7z, or it is cut short.");

    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);
    // ZIP64: a locator sits just before the record and points at the real one.
    if (eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
      const z = await read(u64(tail, eocd - 12), 56);
      if (u32(z, 0) !== 0x06064b50) throw new Error("That zip's ZIP64 record is damaged.");
      count = u64(z, 32);
      cdSize = u64(z, 40);
      cdOffset = u64(z, 48);
    }

    const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new Error("That zip's file list is damaged.");
      const flags = u16(cd, p + 8);
      const method = u16(cd, p + 10);
      let compressed = u32(cd, p + 20);
      let size = u32(cd, p + 24);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      let offset = u32(cd, p + 42);
      const name = zipName(cd.subarray(p + 46, p + 46 + nameLen), flags);
      // ZIP64 extra field: the 64-bit values, only for fields that overflowed.
      for (let e = p + 46 + nameLen, end = e + extraLen; e + 4 <= end;) {
        const id = u16(cd, e);
        const len = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
          if (compressed === 0xffffffff) { compressed = u64(cd, q); q += 8; }
          if (offset === 0xffffffff) { offset = u64(cd, q); }
        }
        e += 4 + len;
      }
      entries.push({ name, flags, method, compressed, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, read };
  }

  // A zip as an archive: { files, extract(files, sink) }, the same shape
  // assets/sevenzip.js gives a 7z, so unpackTo() below handles either.
  async function openZip(blob) {
    const { entries, read } = await readZipIndex(blob);
    return {
      files: entries,
      async extract(files, sink) {
        for (const e of files) {
          if (e.flags & 1) throw new Error("That zip is password-protected; unpack it on a computer first.");
          if (e.method !== 0 && e.method !== 8) {
            throw new Error(`That zip uses a compression this can't unpack (method ${e.method}); ` +
              "re-zip it with normal (deflate) compression.");
          }
        }
        for (const e of files) {
          const header = await read(e.offset, 30);
          if (u32(header, 0) !== 0x04034b50) throw new Error(`That zip is damaged near ${e.name}.`);
          let pos = e.offset + 30 + u16(header, 26) + u16(header, 28);
          const end = pos + e.compressed;
          await sink.start(e);
          if (e.method === 0) {
            for (; pos < end; pos += INFLATE_SLICE) {
              // The reader's window is reused, so each write gets its own copy.
              await sink.write((await read(pos, Math.min(INFLATE_SLICE, end - pos))).slice());
            }
          } else if (e.compressed > 0) {
            let out = [];
            const inflate = new fflate.Inflate();
            inflate.ondata = (chunk) => out.push(chunk);
            for (; pos < end; pos += INFLATE_SLICE) {
              const len = Math.min(INFLATE_SLICE, end - pos);
              // push() may keep a reference to the input, so it gets a copy too.
              inflate.push((await read(pos, len)).slice(), pos + len >= end);
              for (const chunk of out) await sink.write(chunk);
              out = [];
            }
          }
          await sink.end();
        }
      },
    };
  }

  async function openArchive(blob) {
    const magic = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (window.NoberuSevenZip && NoberuSevenZip.is(magic)) return NoberuSevenZip.open(blob);
    if (String.fromCharCode(...magic.subarray(0, 4)) === "Rar!") {
      throw new Error("RAR archives can't be unpacked here; re-pack it as a zip or 7z.");
    }
    return openZip(blob);
  }

  // Unpacks a zip or 7z `blob` into `dir`, dropping a single wrapping folder so
  // the game sits at the top. Resolves to { paths, bytes, wrapper }.
  async function unpackTo(blob, dir, onProgress) {
    onProgress("reading the archive's file list...");
    const archive = await openArchive(blob);

    const files = archive.files.filter((e) => {
      const name = e.name.replace(/\\/g, "/");
      e.path = name.split("/").filter((part) => part && part !== ".").join("/");
      return e.path && !e.dir && !name.endsWith("/") && !/(^|\/)__MACOSX\//.test(name);
    });
    if (!files.length) throw new Error("That archive is empty.");
    for (const e of files) {
      if (e.path.split("/").includes("..")) throw new Error(`That archive has an unsafe path: ${e.name}`);
    }
    const first = files[0].path.split("/")[0];
    const wrapped = files.every((e) => e.path.startsWith(first + "/"));
    if (wrapped) for (const e of files) e.path = e.path.slice(first.length + 1);

    const total = files.reduce((sum, e) => sum + e.size, 0);
    const space = await usage();
    if (space && space.quota && total > space.quota - space.used) {
      throw new Error(`Unpacking needs ${bytesLabel(total)}, but this browser only has ` +
        `${bytesLabel(space.quota - space.used)} free.`);
    }

    let bytes = 0;
    let count = 0;
    let shown = 0;
    const say = (force) => {
      const now = Date.now();
      if (!force && now - shown < 250) return;
      shown = now;
      onProgress(`unpacking ${count} / ${files.length} files (${bytesLabel(bytes)} / ${bytesLabel(total)})...`);
    };

    let writable = null;
    try {
      await archive.extract(files, {
        async start(e) {
          count++;
          say(count === 1);
          writable = await createWritable(dir, e.path);
        },
        async write(chunk) {
          await writable.write(chunk);
          bytes += chunk.length;
          say();
        },
        async end() {
          const done = writable;
          writable = null;
          await done.close();
        },
      });
    } finally {
      if (writable) await writable.abort().catch(() => { });
    }
    say(true);
    return { paths: files.map((e) => e.path), bytes, wrapper: wrapped ? first : null };
  }

  // Keeps the screen on while a long unpack runs: a phone that locks part way
  // through suspends the page and the unpack with it.
  async function keepAwake(task) {
    let lock = null;
    try {
      if (navigator.wakeLock) lock = await navigator.wakeLock.request("screen");
    } catch (e) { /* not allowed here; carry on without it */ }
    try {
      return await task();
    } finally {
      if (lock) lock.release().catch(() => { });
    }
  }

  // --- engines ------------------------------------------------------------

  const ENGINES = {
    rlvm: { label: "RealLive", tab: "rlvm" },
    onscripter: { label: "NScripter", tab: "ons" },
    "onscripter-ru": { label: "Umineko Project", tab: "onsru" },
    ponscripter: { label: "Ponscripter", tab: "pons" },
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
      // Ponscripter keeps the NScripter archives but has
      // its own UTF-8 script: pscript.dat, or 0.utf and up in plain text.
      if (has("pscript.dat") || any(/^\d+\.utf$/)) return "ponscripter";
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

  // The guess is made once, when a game is added, so a game added before its
  // engine had a tab stays "Windows" (its .exe) or "unknown" for good. Bump
  // this when detectEngine learns an engine; entries guessed by an older
  // version get one more look. A runtime picked by hand is stamped with the
  // current version, so it is never second-guessed.
  const DETECT_VERSION = 2;  // 2: Ponscripter

  async function redetect(entries) {
    const out = [];
    for (const entry of entries) {
      const stale = (entry.detectVersion || 1) < DETECT_VERSION &&
        (entry.engine === "wine" || entry.engine === "unknown");
      if (!stale) {
        out.push(entry);
        continue;
      }
      try {
        let dir;
        if (entry.kind === "linked") {
          // No permission prompt from a list redraw; try again next time.
          if ((await entry.handle.queryPermission({ mode: "read" })) !== "granted") {
            out.push(entry);
            continue;
          }
          dir = entry.handle;
        } else {
          dir = await entryDir(entry);
        }
        const paths = [];
        for await (const { path } of walk(dir)) paths.push(path);
        for (const { path } of await patchFiles(entry)) paths.push(path);
        const fresh = { ...entry, ...detectEngine(paths), detectVersion: DETECT_VERSION };
        await dbPut(fresh);
        out.push({ ...fresh, root: gameRoot(fresh.engine, fresh.root || "") });
      } catch (error) {
        out.push(entry);  // files gone or unreadable: leave the old guess
      }
    }
    return out;
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
    return addHandle(dir, onProgress);
  }

  // A folder handle from the picker, or from a folder dropped on the page
  // (DataTransferItem.getAsFileSystemHandle): linked, nothing copied.
  async function addHandle(dir, onProgress = () => { }) {
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
    if (list.length === 1 && !list[0].webkitRelativePath && /\.(zip|7z)$/i.test(list[0].name)) {
      return addArchive(list[0], onProgress);
    }
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

  // A picked .zip or .7z is unpacked straight from where it is, rather than
  // copied in and unpacked afterwards: that would need room for the archive
  // and the game at once, and a few GB is often more than a phone has spare.
  async function addArchive(file, onProgress) {
    const id = newId();
    const root = await storageRoot();
    const dir = await root.getDirectoryHandle(id, { create: true });
    try {
      const { paths, bytes, wrapper } = await keepAwake(() => unpackTo(file, dir, onProgress));
      return await dbPut({
        id,
        // A Japanese folder name sanitizes to underscores; the zip's own name
        // is usually more telling then.
        name: sanitize(wrapper && /[A-Za-z0-9]/.test(sanitize(wrapper)) ? wrapper : file.name.replace(/\.(zip|7z)$/i, "")),
        kind: "stored",
        ...detectEngine(paths),
        fileCount: paths.length,
        bytes,
        addedAt: Date.now(),
      });
    } catch (error) {
      try {
        await root.removeEntry(id, { recursive: true });
      } catch (e) { /* nothing to clean up */ }
      throw error;
    }
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
    for (const { path, handle } of await patchFiles(entry)) {
      if (prefix && !path.startsWith(prefix)) continue;
      const file = await handle.getFile();
      Object.defineProperty(file, "webkitRelativePath", { value: `${entry.name}/${path.slice(prefix.length)}` });
      files.push(file);
    }
    if (!files.length) throw new Error("That game has no files any more.");
    return files;
  }

  // Copies in the files the folder-handle API cannot see. `files` is the
  // FileList from a directory <input> pointed at the same folder.
  async function addMissing(entry, files, onProgress) {
    const list = [...files];
    if (!list.length) throw new Error("Nothing was selected.");
    const rootName = (list[0].webkitRelativePath || "").split("/")[0];

    onProgress("reading what is already here...");
    const seen = new Set();
    if (entry.kind === "linked") {
      if (!(await ensurePermission(entry))) throw new Error("Permission to read that folder was declined.");
    }
    const source = entry.kind === "linked" ? entry.handle : await entryDir(entry);
    for await (const { path } of walk(source)) seen.add(path);
    for (const { path } of await patchFiles(entry)) seen.add(path);

    const missing = list.filter((file) => {
      let path = file.webkitRelativePath || file.name;
      if (rootName && path.startsWith(rootName + "/")) path = path.slice(rootName.length + 1);
      return path && !seen.has(path);
    });

    // A folder that shares almost nothing with this entry is the wrong folder.
    if (missing.length > list.length / 2) {
      throw new Error(`That folder does not look like "${entry.name}": ${missing.length} of ${list.length} files are new.`);
    }
    if (!missing.length) return { entry, added: 0 };

    const dir = await patchDir(entry, true);
    let bytes = 0;
    for (let i = 0; i < missing.length; i++) {
      const file = missing[i];
      let path = file.webkitRelativePath || file.name;
      if (rootName && path.startsWith(rootName + "/")) path = path.slice(rootName.length + 1);
      await writeFile(dir, path, file);
      bytes += file.size;
      onProgress(`copying ${i + 1} / ${missing.length} hidden files...`);
    }

    const updated = await dbPut({
      ...entry,
      patchCount: (entry.patchCount || 0) + missing.length,
      patchBytes: (entry.patchBytes || 0) + bytes,
      fileCount: entry.fileCount + missing.length,
      bytes: entry.bytes + bytes,
    });
    return { entry: updated, added: missing.length };
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
      if (/\.(zip|7z)$/i.test(path)) {
        archiveName = path;
        break;
      }
    }
    if (!archiveName) throw new Error("There is no .zip or .7z in that entry.");

    const archiveFile = await (await ensureDir(dir, archiveName))
      .getFileHandle(archiveName.split("/").pop())
      .then((h) => h.getFile());
    const { paths, bytes, wrapper } = await keepAwake(() => unpackTo(archiveFile, dir, onProgress));
    await dir.removeEntry(archiveName.split("/").pop());

    return dbPut({
      ...entry,
      name: wrapper ? sanitize(wrapper) : entry.name,
      ...detectEngine(paths),
      fileCount: paths.length,
      bytes,
    });
  }

  async function remove(entry) {
    try {
      await (await storageRoot()).removeEntry(`${entry.id}-patch`, { recursive: true });
    } catch (error) { /* no patch */ }
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
          <p class="control-note" id="library-note">Folders stay where they are; only a reference is kept, so adding one is instant. Downloads and files are copied into this browser. If a game later reports missing files, use "fix missing files": the browser hides files with unusual names from linked folders, and that copies just those back in.</p>
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
    const entries = await redetect(await dbAll());
    const space = await usage();
    const note = dialog.querySelector("#library-note");
    if (space) {
      note.dataset.space = `${bytesLabel(space.used)} of ${bytesLabel(space.quota)} used in this browser`;
    }

    if (!entries.length) {
      list.innerHTML = `<p class="control-note">Nothing added yet. Add a game folder from this device, or paste a link to a .zip or .7z.</p>`;
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
            ${pickEngine || entry.engine === "archive" ? "" : `<button class="retro-button secondary" type="button" data-act="patch">fix missing files</button>`}
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
        } else if (act === "patch") {
          patchIntro(entry);
        } else if (act === "boot") {
          const chosen = button.closest(".library-item").querySelector(".library-engine");
          run(() => boot(entry, chosen ? chosen.value : entry.engine), "Handed to the runtime.");
        }
      });
    });
  }

  // Asked before the folder picker opens, because "pick the folder again"
  // makes no sense without knowing why. The picker is opened straight from
  // this dialog's button: a file input needs the click to open it.
  function patchIntro(entry) {
    const intro = document.createElement("div");
    intro.className = "library-backdrop library-intro";
    intro.innerHTML = `
      <div class="library-modal" role="dialog" aria-modal="true" aria-label="fix missing files">
        <div class="library-bar">
          <b>fix missing files</b>
          <button class="tiny-button" type="button" data-intro="cancel">cancel</button>
        </div>
        <div class="library-add">
          <p class="control-note brief">Your browser hides files with unusual names, so a few of a game's files can be missing. Pick <b>${escapeHtml(entry.name)}</b>'s folder again and noberu copies just those missing files in.</p>
          <p class="control-note verbose">Chrome does not let a linked folder show files whose names it considers unsafe, such as names containing control characters, so those files never reach the game and it may report them as missing. Choosing the folder again here uses a different picker, one that can see them; noberu compares the two listings and copies only the difference into this browser. The game keeps using your folder for everything else.</p>
          <p class="control-note">Choose the same folder you added for this game — the folder itself, not a file inside it. Nothing on your device is changed.</p>
          <div class="button-row">
            <button class="retro-button" type="button" data-intro="pick">choose folder</button>
            <button class="retro-button secondary" type="button" data-intro="cancel">cancel</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(intro);

    const close = () => intro.remove();
    intro.querySelectorAll('[data-intro="cancel"]').forEach((b) => b.addEventListener("click", close));
    intro.addEventListener("click", (event) => {
      if (event.target === intro) close();
    });

    intro.querySelector('[data-intro="pick"]').addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.multiple = true;
      input.addEventListener("change", () => {
        close();
        if (!input.files.length) return;
        run(async () => {
          const { added } = await addMissing(entry, input.files, status);
          status(added
            ? `recovered ${added} file${added === 1 ? "" : "s"} the browser had hidden`
            : "nothing was missing");
        }, "Checked.");
      });
      input.addEventListener("cancel", close);
      input.click();
    });
  }

  async function boot(entry, engineId) {
    const engine = ENGINES[engineId] || ENGINES[entry.engine] || ENGINES.unknown;
    // A corrected guess is worth keeping, along with the root that engine
    // expects (Ren'Py's is the folder above game/).
    if (engineId && engineId !== entry.engine) {
      entry = { ...entry, engine: engineId, root: gameRoot(engineId, entry.root || ""), detectVersion: DETECT_VERSION };
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
    addHandle,
    addFromUrl,
    getFiles,
    play,
    // For the game shelf's detail panel (assets/shelf.js): the same actions
    // the downloads popup has, without the popup.
    remove,
    copyToStorage,
    unzip,
    ensurePermission,
    async update(id, changes) {
      const entry = (await dbAll()).find((e) => e.id === id);
      if (!entry) throw new Error("That game is no longer in downloads.");
      const next = { ...entry, ...changes };
      if (changes.engine && changes.engine !== entry.engine) {
        next.root = gameRoot(changes.engine, entry.root || "");
        next.detectVersion = DETECT_VERSION;
      }
      return dbPut(next);
    },
    fixMissing(entry) {
      if (!dialog) build();
      pickEngine = null;
      open("downloads");
      patchIntro(entry);
    },
    runtimes() {
      return Object.entries(ENGINES).filter(([, e]) => e.tab).map(([id, e]) => ({ id, label: e.label }));
    },
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
