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
      if (!name.includes("/") || ENGINE_DIRS.test(name)) continue;
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

  // Writes the picked game into the engine's filesystem. Called from a run
  // dependency, so the engine waits for it before starting the game.
  //
  // `canOwn` hands the browser's own buffer to the filesystem rather than
  // copying it in, and reading one file at a time keeps the peak at the largest
  // single file rather than the whole game.
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

      FS.writeFile("/" + name, new Uint8Array(await staged.files[i].arrayBuffer()),
        { canOwn: true });

      done += staged.files[i].size;
      const now = Date.now();
      if (onStatus && (now - lastReport > 200 || i === staged.files.length - 1)) {
        lastReport = now;
        onStatus(`installing the game... ${Math.round(done / (1024 * 1024))} of ${totalMB} MB`);
      }
    }

    if (overlay) {
      const changes = await overlay;
      applyOverlay(FS, changes);
      trackWrites(FS, key, changes);
    }
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
  // and the logs Ren'Py drops at the top level.
  const UNTRACKED = /^\/(home|tmp|dev|proc|renpy|lib)\/|^\/game\/(cache|saves)\/|\.rpy[bcm]?c?$|^\/[^/]*$/;

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

  function applyOverlay(FS, changes) {
    for (const [path, data] of Object.entries(changes)) {
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

  global.NoberuRenPyStage = { prepare: prepare, install: install };
})(window);
