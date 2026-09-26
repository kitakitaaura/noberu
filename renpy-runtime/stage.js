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

  // Accepts either the folder holding the game (the one with the .exe and a
  // game/ subfolder) or the game/ folder itself. The user's own lib/ and
  // renpy/ are dropped - the engine zip replaces them.
  function findGameFiles(files, paths) {
    const selected = [];
    const names = [];
    const hasGameDir = paths.some((p) => p.startsWith("game/"));

    for (let i = 0; i < files.length; i++) {
      if (IGNORED.test(paths[i])) continue;
      const name = hasGameDir ? paths[i] : "game/" + paths[i];
      if (!name.startsWith("game/")) continue;
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
  async function install(FS, staged, onStatus) {
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
  }

  global.NoberuRenPyStage = { prepare: prepare, install: install };
})(window);
