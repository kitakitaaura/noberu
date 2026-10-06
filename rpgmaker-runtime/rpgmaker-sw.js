// The service worker for the rpgmaker tab. An RPG Maker MV or MZ game is a
// website, like a Tyrano one, so it is served the same way: by
// ../tyrano-runtime/tyrano-sw.js, imported here. This file exists because a
// worker only controls URLs under its own folder, so the rpgmaker games need a
// worker that lives in rpgmaker-runtime/.
//
// What differs: its own IndexedDB (staging one tab's game must not unstage the
// other's), the tab named in messages, and noberu-shim.js in every page.

self.NOBERU_VFS_DB = "noberu-rpgmaker";
self.NOBERU_VFS_TAB = "rpg maker";
self.NOBERU_VFS_SCRIPTS = ["noberu-shim.js"];

importScripts("../tyrano-runtime/tyrano-sw.js");
