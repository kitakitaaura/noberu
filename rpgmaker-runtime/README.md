# Local RPG Maker MV/MZ Runtime

RPG Maker MV and MZ games, played from a folder on this device.

**There is no engine build here.** An MV or MZ game is a website: `index.html`,
`js/` (the engine: `rpg_core.js` for MV, `rmmz_core.js` for MZ, plus pixi and
the game's plugins), `data/` (JSON), `img/` and `audio/`. Its Windows/Mac
release wraps that folder in NW.js. So, like the tyrano tab, this tab only has
to serve the folder. Older RPG Makers (2000, 2003, XP, VX, VX Ace) are native
engines with Ruby or C++ runtimes and do not run here.

- `rpgmaker-sw.js` — ours. The service worker, scoped to `rpgmaker-runtime/vfs/`.
  It is `../tyrano-runtime/tyrano-sw.js` (imported), with its own IndexedDB, and
  `noberu-shim.js` added to every page it serves after `../assets/runtime.js`.
  It has to be a file in this folder because a worker only controls URLs under
  its own folder.
- `noberu-glue.js` — ours. Page side: finds the game in what was picked and
  stages it with the tyrano tab's `NoberuVFS` factory. `RpgMakerVFS.stage(files)`,
  `RpgMakerVFS.version(files)` ("MV" / "MZ").
- `noberu-shim.js` — ours. Runs in the game's page, on `load` (after the engine's
  scripts and plugins have run, before the game starts).

How serving works, ranges, case-insensitive paths and the isolation headers are
all in `../tyrano-runtime/README.md`.

## Finding the game

The engine's first script, `js/rpg_core.js` or `js/rmmz_core.js`, marks the
game's folder (the one holding `js/`) and says which RPG Maker made it. An MV
release has the game in `www/` beside `Game.exe`, so a game found in `www/` is
named after the folder above it.

## What the shim changes

- **Scaling.** In a desktop browser RPG Maker leaves its canvas at its own size
  (816x624 by default) in the middle of the frame; it only stretches in NW.js
  and on phones. `Graphics._defaultStretchMode` is made to return true, so the
  game fills the frame, fullscreen included. Touch and clicks still land right:
  the engine maps them through the same scale.
- **MV saves.** In a browser MV saves to localStorage under fixed names
  (`RPG File1`, `RPG Global`, `RPG Config`), so every MV game on the site would
  share the same slots. `StorageManager.webStorageKey` is wrapped to prefix them
  with the staged game's id: `noberu.rpgmv.<id>.RPG File1`. MZ saves to
  IndexedDB (localforage) with the game's own `gameId` in every key, so it is
  left alone.

## Input

Keyboard, mouse and touch are the game's own: Enter/Space/Z choose, Esc/X open
the menu, Shift runs, a right click cancels, taps and clicks select. The touch
pad's keys reach it as keyboard events (`assets/input.js`). Controllers are read
by the game itself, so the frame wrap carries `data-native-gamepad` and
`assets/gamepad.js` sends it nothing (otherwise every button would press twice).

## Audio on phones

MV plays `.m4a` on phones and `.ogg` elsewhere (`AudioManager.audioFileExt`);
games deployed for the web ship both. MZ uses `.ogg` everywhere and decodes it
itself where the browser cannot.

## Tested

Headless Chrome with an MV game (amirisback/adventure-rpg) and an MZ demo
(unacro/rpgmaker-mz-demo): title, new game, walking, menus, mouse clicks,
saving, reload and Continue, Effekseer animations (MZ). WebKit as an iPhone:
boots, the touch pad and direct taps work.
