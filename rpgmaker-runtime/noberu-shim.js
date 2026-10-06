// Runs in an RPG Maker MV/MZ game's own page, ahead of the engine: the service
// worker (rpgmaker-sw.js) adds it to the game's index.html, after
// ../assets/runtime.js. The game itself is untouched.
//
// Both changes are made on `load`. By then the engine's scripts (and its
// plugins) have run, so the objects exist, and nothing has used them yet: an
// MV game starts in `window.onload` and an MZ game in its own load listener,
// both added after this one, so they run after it.
(function () {
  "use strict";

  // vfs/<id>/index.html: the id the tab staged the game under.
  const match = /\/vfs\/([^/]+)\//.exec(location.pathname);
  const gameId = match ? decodeURIComponent(match[1]) : "game";

  window.addEventListener("load", () => {
    // Scale to the frame. RPG Maker stretches its canvas to the window only in
    // its desktop app and on phones; in a desktop browser it stays at its own
    // size (816x624 for MV) in the middle of whatever frame it is in.
    if (typeof Graphics === "function") {
      Graphics._defaultStretchMode = () => true;
    }

    // Saves. In a browser MV keeps them in localStorage under fixed names
    // ("RPG File1", "RPG Global", "RPG Config"), so every MV game on this site
    // would read and overwrite the same slots. Prefix them with the game. (MZ
    // already puts its gameId in every save key, so it needs nothing.)
    if (typeof StorageManager === "function" &&
        typeof StorageManager.webStorageKey === "function" &&
        typeof StorageManager.forageKey !== "function") {
      const key = StorageManager.webStorageKey;
      StorageManager.webStorageKey = function (savefileId) {
        return `noberu.rpgmv.${gameId}.${key.call(this, savefileId)}`;
      };
    }

    // Tell the tab what this game's saves are called, so the saves panel can
    // show them under the game's folder and beam can find them
    // (index.html → NoberuSaves.name). An MV game's saves carry the staged id;
    // an MZ game's carry its own gameId, known once data/System.json loads.
    const report = () => {
      if (!window.$dataSystem) return false;
      const mz = typeof StorageManager.forageKey === "function";
      const advanced = window.$dataSystem.advanced;
      const name = mz && advanced ? `rmmz.${advanced.gameId}` : gameId;
      window.parent.postMessage({ source: "rpgmaker-runtime", type: "save-name", name }, "*");
      return true;
    };
    let tries = 0;
    const timer = setInterval(() => {
      if (report() || ++tries > 240) clearInterval(timer);
    }, 500);
  });
})();
