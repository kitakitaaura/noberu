// Host glue for the "kirikiri" tab in ../index.html.
//
// Everything else in this directory is upstream's build, and strip-upstream.py
// overwrites index.html wholesale on every update - so the glue lives here and
// the script tag that loads it is re-injected by that script.
//
// Host entry point:
//   window.KrKrInstallAndBoot(root, files) - `files` is the FileList from the
//   tab's directory picker.
// Status goes to the parent as
// postMessage({ source: "kirikiri-runtime", type, ... }), the same shape the
// other runtimes use.
//
// Nothing is copied. Each File is registered with VLFS as a `blob` source,
// which reads it with .slice() only when the engine opens that path, so a 5 GB
// game stages in seconds and only what is touched is ever read.

(function () {
  "use strict";

  function post(type, detail) {
    window.parent.postMessage(
      Object.assign({ source: "kirikiri-runtime", type: type }, detail || {}), "*");
  }

  function status(text) {
    post("status", { text: text });
  }

  // Saves are keyed by what upstream calls a "space"; one per game folder, so
  // two games never share a save store.
  function saveSpaceName(root) {
    return (root || "game").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "game";
  }

  // A KiriKiri game mounts data.xp3 and pulls the rest in itself, so the
  // engine only needs to be told where to start. Upstream asks the player to
  // choose when there is more than one archive; here the conventional names
  // win and the question never comes up.
  const STARTUP_NAMES = ["/data.xp3", "/startup.xp3", "/patch.xp3"];

  function startupArchive(paths) {
    for (const name of STARTUP_NAMES) {
      const hit = paths.find((p) => p.toLowerCase() === name);
      if (hit) return hit;
    }
    // Otherwise the shallowest, then shortest, name: data-like archives sit at
    // the root while extras tend to be deeper or suffixed.
    return [...paths].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0];
  }

  const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX\/)/;

  let started = false;

  window.KrKrInstallAndBoot = async function (root, fileList) {
    try {
      if (started) return;
      started = true;

      const files = [...(fileList || [])];
      if (files.length === 0) throw new Error("No files were staged.");

      if (!self.crossOriginIsolated) {
        throw new Error("This page is not cross-origin isolated, so the engine's " +
          "threads are unavailable. Serve it with serve-local.mjs.");
      }

      status("preparing...");
      if (typeof vlfsReady !== "undefined") await vlfsReady;
      await selectSpace(saveSpaceName(root));

      // Paths are relative to the picked folder, the way upstream's own
      // folder handler does it.
      const prefix = files[0].webkitRelativePath
        ? "/" + files[0].webkitRelativePath.split("/")[0]
        : "";
      const archives = [];

      for (let i = 0; i < files.length; i++) {
        const relative = files[i].webkitRelativePath || files[i].name;
        const path = ("/" + relative).substring(prefix.length) || "/" + files[i].name;
        if (IGNORED.test(path)) continue;

        VLFS.registerBlobFile(path, files[i]);
        if (path.toLowerCase().endsWith(".xp3")) archives.push(path);

        if (i % 200 === 0 || i === files.length - 1) {
          status(`indexing ${i + 1} of ${files.length} files...`);
        }
      }

      if (archives.length === 0) {
        throw new Error("No .xp3 archives here. Pick the folder holding the game's " +
          "data.xp3 (the one with the .exe in it).");
      }

      if (archives.length > 1) {
        Module._startupXp3Path = startupArchive(archives);
      }

      post("booting", { archives: archives.length });
      status("starting the engine...");
      startGame();

      // The engine paints its first frame a while after startGame() returns;
      // the canvas getting a size is the first sign it is really up.
      const canvas = document.getElementById("canvas");
      const began = Date.now();
      while (Date.now() - began < 120000) {
        if (canvas && canvas.width > 1 && canvas.height > 1) {
          post("running", { width: canvas.width, height: canvas.height });
          canvas.focus();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      post("error", { message: "The engine did not start within two minutes." });
    } catch (error) {
      console.error(error);
      post("error", { message: String((error && error.message) || error) });
    }
  };

  // Upstream shows its own picker and overlay; the tab drives everything, so
  // they stay out of the way until something goes wrong.
  document.documentElement.classList.add("krkr2-autoload");
})();
