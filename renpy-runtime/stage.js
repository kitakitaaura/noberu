// Shared staging for the two Ren'Py runtimes (renpy.html for 8.x, renpy7.html
// for 7.x and older).
//
// Ren'Py's web build normally boots from a game.zip holding both the engine
// (renpy/, precompiled) and the game (game/), produced by the developer running
// the launcher's web build. We only ship the engine half of that zip, and put
// the picked game folder into the engine's filesystem directly.
//
// That is not just convenience. Ren'Py does not free the zip after unpacking
// it - /game.zip is still there once the game is running - so going through a
// zip costs twice the game's size: 2.8 GB for a 1.4 GB game, which is enough to
// make a big game thrash. Writing the files in stores each one once, and skips
// the CRC32 pass a zip needs over every byte.

(function (global) {
  "use strict";

  function relativePaths(files) {
    const prefix = files[0].webkitRelativePath
      ? files[0].webkitRelativePath.split("/")[0] + "/"
      : "";
    return files.map((file) => {
      let relative = file.webkitRelativePath || file.name;
      if (prefix && relative.startsWith(prefix)) relative = relative.substring(prefix.length);
      return relative;
    });
  }

  const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|\.git\/|__MACOSX\/)/;

  // Top-level folders that belong to the desktop build rather than the game:
  // the engine zip replaces renpy/ and lib/, and a Mac .app is a second copy.
  const ENGINE_DIRS = /^(renpy|lib|[^/]*\.app)\//i;

  // Except the images of Ren'Py 6's built-in themes (renpy/common/_roundrect
  // and friends), which later engines dropped: a game styled with
  // theme.roundrect shows "Couldn't find file" all over its menus without
  // them (Ripples). The engine has none of these folders, so nothing of its
  // own is replaced.
  const OLD_THEME_IMAGES = /^renpy\/common\/_(roundrect|outline|theme_[^/]*|[a-z]+_theme)\/[^/]+\.(png|jpg|gif|ttf|otf)$/i;

  // Accepts either the folder holding the game (the one with the .exe and a
  // game/ subfolder) or the game/ folder itself. The user's own lib/ and
  // renpy/ are dropped - the engine zip replaces them. Other top-level
  // folders are kept, since games reach outside game/ through
  // config.basedir: DDLC keeps its characters/*.chr files there.
  function findGameFiles(files, paths) {
    const selected = [];
    const names = [];
    const hasGameDir = paths.some((p) => p.startsWith("game/"));

    for (let i = 0; i < files.length; i++) {
      if (IGNORED.test(paths[i])) continue;
      const name = hasGameDir ? paths[i] : "game/" + paths[i];
      if (!name.includes("/") || (ENGINE_DIRS.test(name) && !OLD_THEME_IMAGES.test(name))) continue;
      selected.push(files[i]);
      names.push(name);
    }
    return { files: selected, names: names };
  }

  // Every Ren'Py game ships game/script_version.txt holding a version tuple.
  async function readScriptVersion(files, names) {
    const index = names.indexOf("game/script_version.txt");
    if (index < 0) return null;
    const text = (await files[index].text()).trim();
    const parts = text.replace(/[()\s]/g, "").split(",").map(Number);
    return parts.length && parts.every((n) => Number.isFinite(n)) ? parts : null;
  }

  // Picks the game out of what was dropped in. Nothing is read except the
  // version marker, so this stays instant however big the game is.
  async function prepare(options) {
    const all = [...(options.fileList || [])];
    if (all.length === 0) throw new Error("No files were staged.");

    const picked = findGameFiles(all, relativePaths(all));
    if (!picked.names.some((n) => /^game\/.+\.(rpyc|rpa|rpy)$/.test(n))) {
      throw new Error(
        "No Ren'Py scripts here. Pick the folder holding the game (the one with " +
        "the .exe and a game/ subfolder in it), or the game/ folder itself.");
    }

    const version = await readScriptVersion(picked.files, picked.names);
    if (options.checkVersion) options.checkVersion(version);

    return {
      files: picked.files,
      names: picked.names,
      version: version,
      bytes: picked.files.reduce((sum, f) => sum + f.size, 0),
      // What install() reads in whole; bigger files are read as needed.
      inMemoryBytes: picked.files.reduce((sum, f) => sum + (f.size < LAZY_MIN_BYTES ? f.size : 0), 0),
      count: picked.files.length,
    };
  }

  function mkdirp(FS, path) {
    let sofar = "";
    for (const part of path.split("/").filter(Boolean)) {
      sofar += "/" + part;
      try {
        FS.mkdir(sofar);
      } catch (error) {
        // EEXIST is the normal case for every parent after the first game.
        if (!error || error.errno !== 20) throw error;
      }
    }
  }

  // ---- files read as needed ----------------------------------------------
  //
  // Ren'Py reads its files synchronously, from the middle of Python, so a
  // file the game opens has to be readable right then. Writing every byte in
  // up front did that at the cost of the whole game in memory: KSRE kept
  // 1.4 GB of buffers alive for a game that reads a few MB a scene.
  //
  // Big files are now placeholders instead: MEMFS nodes that report their
  // real size and read their bytes from the picked File when asked, in 1 MB
  // blocks kept in a shared least-recently-used cache. A synchronous
  // XMLHttpRequest of a blob: URL is the one way a page can read a File
  // without yielding (rlvm-runtime/rlvm.html does the same); such requests
  // may not ask for binary, so the bytes come back as "x-user-defined" text,
  // one char code per byte. A game that writes to one of these files gets a
  // full in-memory copy first, and from then on it is an ordinary file.

  const LAZY_MIN_BYTES = 512 * 1024;
  const BLOCK = 1024 * 1024;
  // Several blocks in one request when a read spans them.
  const MAX_REQUEST = 16 * BLOCK;
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const CACHE_BYTES = (touch ? 48 : 192) * 1024 * 1024;

  const cache = new Map(); // "id:block" -> Uint8Array, oldest first
  let cachedBytes = 0;
  let nextId = 1;
  const lazyStats = { requests: 0, bytes: 0, ms: 0, hits: 0, evictions: 0 };

  // Text decoding still sniffs for a byte order mark, which beats the
  // charset asked for: a block that happened to start FF FE came back as
  // UTF-16, half its length. So every request starts with one zero byte,
  // dropped again below.
  const PAD = new Uint8Array(1);

  function readSync(file, start, end) {
    const url = URL.createObjectURL(new Blob([PAD, file.slice(start, end)]));
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.overrideMimeType("text/plain; charset=x-user-defined");
      xhr.send();
      const text = xhr.responseText;
      if (text.length !== end - start + 1) throw new Error(`read ${text.length - 1} of ${end - start} bytes at ${start}`);
      const bytes = new Uint8Array(text.length - 1);
      for (let i = 0; i < bytes.length; i++) bytes[i] = text.charCodeAt(i + 1) & 0xff;
      return bytes;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function remember(key, bytes) {
    cache.set(key, bytes);
    cachedBytes += bytes.length;
    while (cachedBytes > CACHE_BYTES && cache.size > 1) {
      const [oldest, data] = cache.entries().next().value;
      cache.delete(oldest);
      cachedBytes -= data.length;
      lazyStats.evictions++;
    }
  }

  // Block `n` of a lazy node, fetching it (and any missing blocks after it,
  // up to `last`) in one request.
  function block(lazy, n, last) {
    const key = lazy.id + ":" + n;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key); // re-insert as newest
      cache.set(key, hit);
      lazyStats.hits++;
      return hit;
    }
    let end = n;
    while (end < last && end - n + 1 < MAX_REQUEST / BLOCK && !cache.has(lazy.id + ":" + (end + 1))) end++;
    const start = n * BLOCK;
    const stop = Math.min(lazy.file.size, (end + 1) * BLOCK);
    const t = performance.now();
    const bytes = readSync(lazy.file, start, stop);
    lazyStats.requests++;
    lazyStats.bytes += bytes.length;
    lazyStats.ms += performance.now() - t;
    for (let b = n; b <= end; b++) {
      const piece = bytes.subarray((b - n) * BLOCK, Math.min(bytes.length, (b - n + 1) * BLOCK));
      // A copy, so evicting one block does not keep the whole request alive.
      remember(lazy.id + ":" + b, end === n ? piece : piece.slice());
    }
    return cache.get(key);
  }

  function readLazy(lazy, buffer, offset, length, position) {
    const size = Math.min(lazy.file.size - position, length);
    if (size <= 0) return 0;
    const last = Math.floor((position + size - 1) / BLOCK);
    let done = 0;
    while (done < size) {
      const at = position + done;
      const n = Math.floor(at / BLOCK);
      const data = block(lazy, n, last);
      const from = at - n * BLOCK;
      const count = Math.min(size - done, data.length - from);
      buffer.set(data.subarray(from, from + count), offset + done);
      done += count;
    }
    return size;
  }

  // Turns a placeholder into an ordinary MEMFS file holding all its bytes.
  function materialize(node) {
    const lazy = node.noberuLazy;
    if (!lazy) return;
    const bytes = new Uint8Array(lazy.file.size);
    readLazy(lazy, bytes, 0, bytes.length, 0);
    delete node.noberuLazy;
    node.contents = bytes;
    node.usedBytes = bytes.length;
  }

  // One set of stream and node operations for every placeholder, wrapping the
  // ones MEMFS gave the node.
  function lazyOps(FS, stream, nodeOps) {
    const ops = Object.assign({}, stream, {
      read(s, buffer, offset, length, position) {
        const lazy = s.node.noberuLazy;
        if (!lazy) return stream.read.apply(this, arguments);
        try {
          return readLazy(lazy, buffer, offset, length, position);
        } catch (error) {
          // EIO for Python to raise, rather than a JS error inside a syscall.
          console.error("noberu: could not read " + lazy.file.name + ":", error);
          throw new FS.ErrnoError(29);
        }
      },
    });
    for (const name of ["write", "allocate", "mmap", "msync"]) {
      if (typeof stream[name] !== "function") continue;
      ops[name] = function (s) {
        materialize(s.node);
        return stream[name].apply(this, arguments);
      };
    }
    const node = Object.assign({}, nodeOps, {
      setattr(n, attr) {
        if (attr && attr.size !== undefined && n.noberuLazy) {
          // Truncated to nothing (a rewrite): no need to read it first.
          if (attr.size === 0) {
            delete n.noberuLazy;
            n.contents = null;
            n.usedBytes = 0;
          } else {
            materialize(n);
          }
        }
        return nodeOps.setattr.apply(this, arguments);
      },
    });
    return { stream: ops, node: node };
  }

  let ops = null;
  function writeLazy(FS, path, file) {
    FS.writeFile(path, new Uint8Array(0));
    const node = FS.lookupPath(path).node;
    if (!ops) ops = lazyOps(FS, node.stream_ops, node.node_ops);
    node.noberuLazy = { id: nextId++, file: file };
    node.contents = null;
    node.usedBytes = file.size;
    node.stream_ops = ops.stream;
    node.node_ops = ops.node;
  }

  // The File behind a placeholder, for players that take a blob: URL
  // (noberu-video.js) rather than reading through the filesystem.
  function fileAt(FS, path) {
    try {
      const node = FS.lookupPath(path).node;
      return node.noberuLazy ? node.noberuLazy.file : null;
    } catch (error) {
      return null;
    }
  }

  // Writes the picked game into the engine's filesystem. Called from a run
  // dependency, so the engine waits for it before starting the game.
  //
  // Big files become placeholders read as needed (above). The rest are read
  // in whole; `canOwn` hands the browser's own buffer to the filesystem
  // rather than copying it in.
  async function install(FS, staged, onStatus, key) {
    const overlay = key ? loadOverlay(key) : null;
    const totalMB = Math.round(staged.bytes / (1024 * 1024));
    let done = 0;
    let lastReport = 0;

    mkdirp(FS, "/game");

    for (let i = 0; i < staged.files.length; i++) {
      const name = staged.names[i];
      const slash = name.lastIndexOf("/");
      if (slash > 0) mkdirp(FS, "/" + name.slice(0, slash));

      if (staged.files[i].size >= LAZY_MIN_BYTES) {
        writeLazy(FS, "/" + name, staged.files[i]);
      } else {
        FS.writeFile("/" + name, new Uint8Array(await staged.files[i].arrayBuffer()),
          { canOwn: true });
      }

      done += staged.files[i].size;
      const now = Date.now();
      if (onStatus && (now - lastReport > 200 || i === staged.files.length - 1)) {
        lastReport = now;
        onStatus(`installing the game... ${Math.round(done / (1024 * 1024))} of ${totalMB} MB`);
      }
    }

    if (overlay) {
      const changes = await overlay;
      // The engine's data packages may still be unpacking (the game now
      // installs in a moment), and files they write are not the game's. So
      // only the game's own folders are replayed now; the rest, and tracking,
      // wait until the engine's files are all in.
      const roots = new Set(staged.names.map((name) => name.split("/")[0]));
      const inGame = (path) => roots.has(path.split("/")[1]);
      applyOverlay(FS, changes, inGame);
      afterEngineFiles(() => {
        if (applyOverlay(FS, changes, (path) => !inGame(path), true)) saveOverlay(key, changes);
        trackWrites(FS, key, changes);
      });
    }
  }

  // Runs `fn` once every run dependency (data packages included) is done,
  // just before the engine's main().
  function afterEngineFiles(fn) {
    const M = global.Module;
    if (!M || M.calledRun) {
      fn();
      return;
    }
    const previous = M.onRuntimeInitialized;
    M.onRuntimeInitialized = function () {
      try {
        fn();
      } finally {
        if (previous) previous.apply(this, arguments);
      }
    };
  }

  // Files a game writes into its own folder. Desktop Ren'Py games can write
  // next to their scripts (config.basedir), and some depend on it: DDLC marks
  // game/firstrun after its first launch - without it, every boot asks whether
  // to delete your saves - and deletes characters/*.chr as the story goes.
  // Saves have their own IDBFS mount; this keeps the rest, one record per
  // game, and replays it over the picked files at install.
  const OVERLAY_DB = "noberu-renpy-overlay";
  const OVERLAY_MAX_BYTES = 1024 * 1024;
  // Not the game's own files: the engine, saves, caches, compiled scripts
  // and the logs Ren'Py drops at the top level. Python 2 also rewrites the
  // engine's own .pyo files (in folders like /http/) on every boot; replaying
  // those collided with the engine's data package creating the same paths.
  const UNTRACKED = /^\/(home|tmp|dev|proc|renpy|lib)\/|^\/game\/(cache|saves)\/|\.rpy[bcm]?c?$|\.py[co]$|\/__pycache__\/|^\/[^/]*$/;

  function openOverlayDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(OVERLAY_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("games");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // path -> bytes, or null for a file the game deleted.
  async function loadOverlay(key) {
    try {
      const db = await openOverlayDb();
      return await new Promise((resolve) => {
        const request = db.transaction("games").objectStore("games").get(key);
        request.onsuccess = () => resolve(request.result || {});
        request.onerror = () => resolve({});
      });
    } catch (error) {
      return {};
    }
  }

  async function saveOverlay(key, changes) {
    try {
      const db = await openOverlayDb();
      db.transaction("games", "readwrite").objectStore("games").put(changes, key);
    } catch (error) {
      console.warn("noberu: could not keep the game's own files:", error);
    }
  }

  // Replays the entries `which` picks. With `skipExisting`, a file that is
  // already there belongs to the engine (an older noberu tracked those too)
  // and is dropped from the record; returns whether anything was.
  function applyOverlay(FS, changes, which, skipExisting) {
    let dropped = false;
    for (const [path, data] of Object.entries(changes)) {
      if (!which(path)) continue;
      if (UNTRACKED.test(path) || (skipExisting && data !== null && exists(FS, path))) {
        delete changes[path];
        dropped = true;
        continue;
      }
      try {
        if (data === null) {
          FS.unlink(path);
        } else {
          mkdirp(FS, path.slice(0, path.lastIndexOf("/")));
          FS.writeFile(path, data);
        }
      } catch (error) {
        // Already gone, or never there: either way the game sees what it left.
      }
    }
    return dropped;
  }

  function exists(FS, path) {
    try {
      FS.stat(path);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Absolute, with "." and ".." resolved: Ren'Py runs from / and names its
  // own files "./renpy/...", which must not dodge UNTRACKED.
  function normalize(FS, path) {
    if (!path.startsWith("/")) path = FS.cwd() + "/" + path;
    const parts = [];
    for (const part of path.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return "/" + parts.join("/");
  }

  // Emscripten's syscalls look these up on FS at call time, so wrapping them
  // sees every write and delete Python makes.
  function trackWrites(FS, key, changes) {
    let timer = 0;
    const persist = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveOverlay(key, changes), 250);
    };
    const tracked = (path) => !UNTRACKED.test(path);

    // A game writing into a folder beside game/ that was not picked (only
    // game/ was): make the folder, as the desktop download would have had it.
    // DDLC restores characters/*.chr from its archives this way.
    const open = FS.open;
    FS.open = function (path, flags) {
      if (typeof path === "string" && typeof flags === "number" && (flags & 64)) { // O_CREAT
        const full = normalize(FS, path);
        if (tracked(full)) {
          try {
            mkdirp(FS, full.slice(0, full.lastIndexOf("/")));
          } catch (error) {
            // Let the open itself report whatever is wrong.
          }
        }
      }
      return open.apply(this, arguments);
    };

    const close = FS.close;
    FS.close = function (stream) {
      const path = stream && stream.path ? normalize(FS, stream.path) : "";
      const wrote = stream && (stream.flags & 3) !== 0; // O_WRONLY or O_RDWR
      const result = close.apply(this, arguments);
      if (wrote && path && tracked(path)) {
        try {
          const data = FS.readFile(path);
          if (data.length <= OVERLAY_MAX_BYTES) {
            changes[path] = data;
            persist();
          }
        } catch (error) {
          // Written and removed again before the close: nothing to keep.
        }
      }
      return result;
    };

    const unlink = FS.unlink;
    FS.unlink = function (path) {
      const result = unlink.apply(this, arguments);
      const full = normalize(FS, String(path));
      if (tracked(full)) {
        changes[full] = null;
        persist();
      }
      return result;
    };
  }

  global.NoberuRenPyStage = {
    prepare: prepare,
    install: install,
    fileAt: fileAt,
    lazyStats: () => Object.assign({ cachedMB: Math.round(cachedBytes / 1048576), blocks: cache.size }, lazyStats),
  };
})(window);
