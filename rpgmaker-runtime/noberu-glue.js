// The page's side of the rpgmaker tab: stage a picked folder, then hand the
// iframe a URL the service worker will answer. Staging is the tyrano tab's
// (../tyrano-runtime/noberu-glue.js, NoberuVFS); what is RPG Maker's own is
// finding the game in what was picked.
//
//   RpgMakerVFS.stage(files)  -> { id, url, root, count, bytes }, or throws
//   RpgMakerVFS.version(files) -> "MV" | "MZ" | null
(function () {
  "use strict";

  // The engine's first script says both where the game is and which RPG Maker
  // made it: js/rpg_core.js is MV, js/rmmz_core.js is MZ. The game's folder is
  // the one holding that js/ (beside index.html). An MV release has it in www/
  // next to the .exe; an MZ release has it at the top.
  const CORE = /(^|\/)js\/(rpg_core|rmmz_core)\.js$/i;

  function corePath(files) {
    let best = null;
    for (const file of files) {
      const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
      if (!CORE.test(path)) continue;
      if (!best || path.split("/").length < best.split("/").length) best = path;
    }
    return best;
  }

  function findRoot(files) {
    const path = corePath(files);
    return path ? path.replace(/js\/[^/]+$/i, "") : null;
  }

  const vfs = NoberuVFS({
    label: "rpg maker",
    db: "noberu-rpgmaker",
    worker: "rpgmaker-runtime/rpgmaker-sw.js",
    scope: "rpgmaker-runtime/vfs/",
    findRoot,
    rootHint: "no RPG Maker game in that folder — pick the one with the game's .exe (or index.html) in it",
    wwwIsWrapper: true,
  });

  window.RpgMakerVFS = {
    stage: vfs.stage,
    version(files) {
      const path = corePath([...(files || [])]);
      if (!path) return null;
      return /rmmz_core\.js$/i.test(path) ? "MZ" : "MV";
    },
  };
})();
