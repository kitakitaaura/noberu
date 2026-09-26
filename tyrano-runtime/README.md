# Local TyranoScript Runtime Artifacts

TyranoScript and TyranoBuilder games, from
[ShikemokuMK/tyranoscript](https://github.com/ShikemokuMK/tyranoscript).

**There is no engine build here, and no upstream code at all.** A Tyrano game *is*
a website: `index.html`, `tyrano/` (the engine, plain JavaScript) and `data/`
(scenario `.ks` files, images, audio). Every other tab in noberu compiles an
engine to wasm so a game's files can be fed to it; this one only has to serve the
folder. Each game ships its own copy of the engine, so there is nothing to keep in
step with upstream.

- `tyrano-sw.js` — ours. A service worker scoped to `tyrano-runtime/vfs/` that
  answers the game's requests out of the staged `File` objects.
- `noberu-glue.js` — ours. Page side: finds the game's root, writes the file map
  to IndexedDB, registers the worker, and hands back the URL to point an iframe
  at. Exposes `TyranoVFS.stage(files)`.
- `test-vfs.mjs` — ours. Runs both files in Node against stubbed browser APIs:
  `node tyrano-runtime/test-vfs.mjs`.

## Why a service worker

The game loads its own assets at runtime by relative path, many of them built by
string concatenation inside a scenario (`[bg storage="room.jpg"]` becomes
`data/bgimage/room.jpg` deep inside the engine). There is no document to rewrite
and no way to know the paths in advance, so `blob:` URLs cannot work. A worker in
the request path serves whatever the game asks for and the game never knows.

Two things that are easy to get wrong, and are covered by the test:

- **The file map lives in IndexedDB, not in the worker's memory.** A service
  worker is killed after a stretch of inactivity - a title screen someone leaves
  for a minute - and restarts empty. Keeping the map in memory meant every asset
  404ing part way into a game.
- **Range requests are honoured.** Chrome refuses to play a `<video>` from a
  source that cannot do ranges, and seeks audio with them too.

Files are read with `.slice()` when the game opens them, so staging copies
nothing and a multi-gigabyte release stages instantly. The map holds `File`
references; if the folder is moved or deleted, staging it again is the fix.

## What it needs from the browser

Service workers, which means any current browser over `https://` or on
`localhost`. They are unavailable in some embedded webviews and with site data
blocked (private browsing in some setups), and the tab says so rather than
hanging.

## Games

Anything built with TyranoScript or TyranoBuilder, including the Steam releases -
a Windows `.exe` from TyranoBuilder is usually an NW.js wrapper with this exact
folder inside it, so stage that inner folder. The tab finds the game's root by
looking for the shallowest `index.html`, so a wrapper folder is fine.
