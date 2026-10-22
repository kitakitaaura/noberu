# noberu

Play visual novels in the browser, from your own copies of the games.

![Noberu Screenshot](./assets/markdown/Screenshot%202026-09-28%20at%201.28.33 AM.png)

noberu is a static website that runs real visual novel engines, compiled to
WebAssembly, inside your browser.

**noberu is still in development, and it at a very underdeveloped state. Please back up saves, don't use it for anything you consider "important", and please report bugs.**

Questions (not for issues - just file an issue on GitHub)? DM me on Discord - farisnyanyann

**noberu does not host or distribute games.** You use a copy you own. The one
exception is the demo, *Narcissu*, a freeware title whose authors allow
unmodified redistribution (see [Demo game](#demo-game)). The other
[free games](#free-games) on the shelf download from their makers' own sites.

Live at **https://noberu.kitaaura.com** (see update, unstable version https://staging.noberu.pages.dev).

> [!WARNING]
> Things can break, games fail to boot, and saves can be lost between updates.

---

## Supported engines

Each tab runs a different "engine". An engine is an official WASM build, or reverse engineered WASM build, or emulator designed to run the visual novel directly in the browser itself. The downloads library guesses the engine
from a folder's file names and sends the game to the right tab.

| Tab | Engine | Plays | How it's identified | Upstream |
|---|---|---|---|---|
| **rlvm** | rlvm (RealLive clone) | Key's RealLive era: Kanon, Air, Clannad, Little Busters, Planetarian | `Gameexe.ini`, `Seen.txt` | [eglaysher/rlvm](https://github.com/eglaysher/rlvm) |
| **onscripter** | OnscripterYuri (ONScripter fork) | NScripter games: Tsukihime, original Higurashi/Umineko, Narcissu, most doujin VNs | `nscript.dat`, `0.txt`, `00.txt`, `nscr_sec.dat`, `onscript.nt2/nt3` | [YuriSizuku/OnscripterYuri](https://github.com/YuriSizuku/OnscripterYuri) |
| **umineko** | onscripter-ru | The Umineko Project release | `default.cfg` + `.file` scripts | [umineko-project/onscripter-ru](https://github.com/umineko-project/onscripter-ru) |
| **ren'py** | Ren'Py official web build (8.5.3 and 7.8.7) | Ren'Py games (Python 3 and Python 2 generations, back to 6.99 - Doki Doki Literature Club verified) | `script_version.txt`, `.rpa`, `.rpyc` | [renpy/renpy](https://github.com/renpy/renpy) |
| **kirikiri** | Kirikiroid2 (web build) | KiriKiri 2 / Z games, including commercial ones with plugins (Nekopara verified) | `.xp3` | [fenghengzhi/kirikiroid2-web](https://github.com/fenghengzhi/kirikiroid2-web) |
| **siglus** | siglus_rs (Rust) | SiglusEngine: Little Busters!, Rewrite+, Summer Pockets, planetarian HD, Steam Clannad/Kanon | `Scene*.pck` | [xmoezzz/siglus_rs](https://github.com/xmoezzz/siglus_rs) |
| **tyrano** | none needed | TyranoScript / TyranoBuilder games | `tyrano/tyrano.js` | [ShikemokuMK/tyranoscript](https://github.com/ShikemokuMK/tyranoscript) |
| **rpg maker** | none needed | RPG Maker MV and MZ games (not 2000/2003/XP/VX/VX Ace) | `js/rpg_core.js`, `js/rmmz_core.js` | - |
| **vnds** | VNDS-LOVE on love.js | VNDS-format novels (Nintendo DS VN ports) | `info.txt` | [ajusa/VNDS-LOVE](https://github.com/ajusa/VNDS-LOVE), [Davidobot/love.js](https://github.com/Davidobot/love.js) |
| **ps2** | Play! | PlayStation 2 disc images | `.iso`, `.bin`, `.cue`, `.chd`, `.cso` … | [jpd002/Play-](https://github.com/jpd002/Play-) |
| **wine** | BoxedWine | Windows `.exe` games, as a last resort | `.exe` | [danoon2/Boxedwine](https://github.com/danoon2/Boxedwine) |


### Engine notes

- **rlvm** reads the whole game into memory when it boots, so a multi-gigabyte
  game needs that much RAM. Steam re-releases (e.g. Clannad English HD) run, but
  their English text uses rlvm's Japanese layout rules.
- **onscripter** loads files lazily: every file starts as an empty placeholder,
  and a file is only read the first time the engine opens it (through a patched
  `fopen` and ASYNCIFY). The script's text encoding is detected automatically
  (Shift-JIS or GBK). English fan releases get English save/load menus through a
  local `--english-menu` patch, because the fork's Japanese menus need glyphs
  that English games' fonts lack.
- **umineko** runs on pthreads with WasmFS: Umineko is ~102k files and 12 GB,
  and only what the game touches is ever read. It renders into an
  OffscreenCanvas on its own thread. It has frame pacing and memory caps, added
  after an early build took down a 16 GB machine.
- **ren'py** uses the stock web packages from renpy.org, nothing ported. The tab
  reads `game/script_version.txt` and picks the 8.x (Python 3) or 7.x (Python 2)
  runtime. Games are installed file by file rather than as a zip, so memory
  stays at one copy. The whole game still has to fit in memory. Live2D doesn't
  work, and video is limited to what the browser can play. Older 6.99 games
  run on the 7.8.7 runtime with a couple of shims; files a game writes next to
  itself (DDLC's `firstrun`) go to a per-game overlay in IndexedDB.
- **kirikiri** reads archives on demand through upstream's virtual filesystem,
  so a 5 GB game stages in seconds. It reimplements ~30 of the Windows plugin
  DLLs commercial games call. Google Analytics, a CDN script and the PWA service
  worker are stripped from upstream's page (`strip-upstream.py`).
- **siglus** is the least mature. We carry six patches against
  upstream (listed in `siglus-runtime/README.md`).
- **tyrano** needs no engine: a Tyrano game *is* a website. A service worker
  serves the game's files straight from the folder you picked.
- **rpg maker** works the same way as tyrano (MV and MZ games are websites
  too). A small shim makes the game fill the window and keeps each game's saves
  under its own name. Details in `rpgmaker-runtime/README.md`.
- **ps2** and **wine** are general emulators, included for VNs that only exist
  as console or Windows releases. Both are heavy.

---

## How it works

### The structure
`index.html` is the whole app: header, tabs, and one "adapter" view per engine.
Each engine is in its own folder (`*-runtime/`) as a page that the tab loads
in an `<iframe>`. Every runtime page follows the same contract:

- It exposes one function on `window`, e.g. `ONSInstallAndBoot(root, files, options)`,
  `RLVMInstallAndBoot(root, files)`, `RenPyInstallAndBoot(root, files)`.
  `files` is always the shape a folder `<input webkitdirectory>` produces: `File`
  objects with a `webkitRelativePath`.
- It reports back to the parent page with
  `postMessage({ source: "<name>-runtime", type, ... })`, where `type` is one of
  `status`, `booting`, `running`, `error` (plus a few engine-specific extras).

So a runtime doesn't know or even care whether its files came from a folder picker, the downloads library, or a zip that was unpacked in the browser.

### (Almost) no server

The site itself is static: HTML, JS, wasm, and a `_headers` file. There are no
accounts. The one piece of server code is `beam-worker/`: the small matchmaker
for [beam](#beam-send-games-between-devices), which only introduces two devices
to each other, plus a pass-through for vndb.org cover images and the encrypted
store behind [save sync](#save-sync) (Durable Object storage, no R2), and a
relay for download links whose servers block other sites. Everything else a player does stays in
their browser:

| What | Where it's kept |
|---|---|
| Linked game folders | A `FileSystemDirectoryHandle` in IndexedDB (`noberu-library`) - nothing copied |
| Downloaded / copied games | The browser's private file storage (OPFS), under `library/<id>/` |
| Saves | Per engine: IDBFS databases (`/save`, `/home`, `/home/web_user/.renpy`), OPFS (umineko), `krkr2-space-*` databases (kirikiri), `localStorage` / localforage (rpg maker) |
| Settings, theme, tour, welcome notice | `localStorage` (`noberu.settings.*` and a few older keys) |
| Covers and screenshots | IndexedDB (`noberu-shelf`) |
| Play time, saved words, sync key | `localStorage` (`noberu.stats`, `noberu.words`, `noberu.sync`) |

Because storage is tied to the site's address, **saves on one domain don't
save on another** (ex. `noberu.pages.dev` vs `noberu.kitaaura.com`). The
saves panel can export and import them as zips.


### Cross-origin isolation

Several engines use threads (kirikiri, umineko, Play!, BoxedWine), which need
`SharedArrayBuffer`, which browsers only allow on a *cross-origin isolated*
page. `_headers` sets, for every file:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
```

The problem: under `require-corp`, anything loaded from another site must send
CORS headers or a `Cross-Origin-Resource-Policy` header, or the browser blocks
it. This is why the demo game is hosted on Hugging Face (which sends CORS
headers) rather than archive.org or GitHub (which don't).


### Downloads library (`assets/library.js`)

The download icon in the header opens this pop. Three ways:

- **add folder**: links a folder on this computer (Chrome/Edge). Instant, even
  for a 12 GB game, because only a reference is stored.
- **add file**: copies files (a disc image, say) into browser storage. A single
  `.zip` or `.7z` is unpacked straight from where it is instead, so the archive
  itself is never copied in.
- **web link**: the browser downloads a file straight from a URL into browser
  storage. When the server doesn't allow cross-origin reads (archive.org,
  GitHub releases and most file hosts), the download goes through the beam
  Worker's `/fetch` relay instead: streamed, never stored or cached, refused
  for private addresses, 10 GB per address a day (`DOWNLOAD_DAILY_BYTES`).

A downloaded `.zip` or `.7z` gets an **unzip** button. Both unzip paths
stream: the archive's file list is read first, then each entry is decoded a
slice at a time straight into storage, so a 4 GB archive on a phone needs a
few MB of memory (a 7z: about its dictionary size, usually 16-64 MB), not
8 GB. Zips are inflated with vendored `fflate`; ZIP64 and Shift_JIS names
work. 7z goes through `assets/sevenzip.js`, a small streaming reader for what
7-Zip uses on games: LZMA2, LZMA, the BCJ/BCJ2 filters on .exe/.dll, Deflate
and Copy, solid or not. PPMd, BZip2, ARM filters and passwords are refused
before anything is written. RAR is not supported. **play**
hands the game to the tab for its detected engine - the engine dropdown
overrides a wrong guess.

### Saves panel (`assets/saves.js`)

Lists every save every engine has written, grouped by game, with export (zip),
import, delete and beam. It knows every storage shape above.

### Demo tour (`assets/tour.js`)

On a first visit, after the welcome notice, a guided tour highlights each
control in turn: downloads → types the Narcissu link for you → download →
unzip → play → boot local → the ▣ fullscreen button. It uses the real
controls, so people learn the actual flow. 

***`?tour` replays it - `?tour-url=…` points it at a different zip (useful for local testing).***

---

## Using it

1. Open the site. Chrome or Edge on a computer works best: linking a folder
   needs the File System Access API. Other browsers and phones copy the game in
   instead (a `.zip`, or a web link).
2. On **games** (the home screen), press **add a game** or drop the game's
   folder or `.zip` anywhere on the page. noberu works out the engine.
3. Press **play**. (The engine tabs, under **more engines** in the dock, still
   work the old way: **choose folder**, then **boot local**.)
4. Press **▣** in the window bar for fullscreen; Esc comes back. Press **`**
   (or a controller's back button, or **menu** on the touch pad) for the
   noberu menu.

Pick the folder that holds the game's data files (the one with `nscript.dat`,
`Gameexe.ini`, `data.xp3`, and so on). A wrapper folder one level above is
usually fine; the library searches a couple of levels down.

For every SDL-based engine: move the mouse before clicking. SDL takes a
click's position from the last mouse movement, so a click without one can land
in the wrong place.

---

## Phones, controllers and settings

- **Phones and tablets.** The site works as an app: "Add to Home Screen" installs
  it (it's a PWA, `manifest.webmanifest` + `sw.js`). When a game starts it fills
  the screen, and a see-through on-screen pad appears (d-pad, enter, esc, a skip
  latch, right-click; a full pad on the PS2 tab). `?touch` forces the phone
  controls on a desktop for testing. The wine tab is hidden on phones.
- **Controllers.** Any standard gamepad is mapped to the keys each engine
  expects (`assets/gamepad.js`).
- **Settings** (top bar): sound (master volume), play, controls, controller,
  display (theme, sharp pixels, CRT overlay, reduce motion, detailed
  descriptions), beam and storage. Each setting is one `localStorage` key.

## The shelf, the menu and the reading tools

- **Games** (`assets/shelf.js`, `covers.js`): every game in downloads as a
  cover, with play time and last played. Covers come from the game's own files
  (RPG Maker's title image, decrypted if need be; Ren'Py's main menu; Tyrano's
  title background; the `.exe`'s icon), from a capture of its title screen while
  it runs, from vndb.org ("find it online", through the Worker's `/cover`), or
  from an image the player picks.
- **Free games** (`assets/free.js`): a list under the shelf of freeware that
  noberu plays, one click each. See [Free games](#free-games).
- **The noberu menu** (`assets/menu.js`): screenshot (kept on the shelf, can be
  the cover), the game's own save/load menu, skip, reading tools, volume,
  fullscreen, report a problem, quit to games. It sits inside the running
  frame, so it works in fullscreen too.
- **Reading tools** (`assets/text.js`, `deinflect.js`, `text-hooks.js`): each
  line a game shows, in a bar over it. Point at (or tap) a word for its
  dictionary entry, with conjugations undone and each kanji explained;
  translate the line on the device (Chrome's built-in Translator API; elsewhere
  a Google Translate link); keep a backlog; save words with their sentence and
  export them for Anki or as CSV; or send lines to a texthooker (clipboard or
  WebSocket). How each engine hands its text over:

  | Engine | Hook |
  |---|---|
  | Ren'Py 7/8 | Python run at the first frame (`renpy-runtime/noberu-text-hook.js`) |
  | TyranoScript, RPG Maker | wraps the engine's own JS (`assets/text-hooks.js`) |
  | NScripter, Ponscripter, umineko, RealLive, Siglus | a few lines in the engine, `Module.noberuText` / `window.NoberuSay` (patches in each engine's tree) |
  | KiriKiri (KAG games) | a TJS prelude wraps the message layers; lines come out through a file write the glue catches |
  | VNDS | a `print` in VNDS-LOVE's `main.moon`, caught from the console |

  Games with their own text systems (Nekopara on KiriKiri, some Siglus
  scenes) don't share their text; the reader says so.
- **Dictionary**: JMdict and KANJIDIC2 (EDRDG, CC BY-SA 4.0), built into
  1,024 small shards under `dict/` by `tools/build-dict.mjs` from
  [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)'s JSON.
  `dict/` is generated (gitignored); `tools/stage-deploy.sh` builds it from
  `~/Documents/noberu-assets/dict-src/` when it's missing.
- **Report a problem** (`assets/report.js`): the player's note, the browser,
  the engine and the errors every frame logged, as a GitHub issue to post or
  text to copy. noberu sends nothing itself.

## Save sync

Settings → sync makes a key (eight groups of four); entering it on another
device joins it. Saves are encrypted in the browser (AES-GCM, key from HKDF of
the sync key) before they go to the Worker's `/sync`. There, one `SyncRoom`
Durable Object per player, named by a hash of the key, keeps them in its own
SQLite storage, split into 1 MB rows. The server sees sizes and times only.
Per save set, the latest change wins. Nothing is ever deleted by a sync, and
saves wait while a game is running.

Limits (`SYNC_MAX_*` in `beam-worker/wrangler.jsonc`): 32 MB per game's saves
and 256 MB per player. On the Workers Free plan the whole account has 5 GB of
Durable Object storage and 100,000 rows written a day; past either, writes fail
(nothing is charged) and the page says the server is full.

Nothing to set up beyond deploying `beam-worker/` (no R2 bucket needed).

## Beam (send games between devices)

Beam sends a game, its saves, or just saves from one browser to another, like
some sort of AirDrop. Both devices open beam, one shows a code (and QR code), the other
enters it. The data goes straight between the two devices over WebRTC; the
matchmaker (`beam-worker/`, a Cloudflare Worker at `beam.kitaaura.com`) only
pairs them. If a direct connection can't be made (strict NATs, some VPNs) it
falls back to a relay, which is capped at 2 GB per beam and 4 GB per day per
address.

---
## Running it locally

Requires Node.js. From the repo root:

```sh
node serve-local.mjs
```

This serves the site on http://localhost:4175 (or the next free port) with the
same cross-origin isolation headers as production, and also on your LAN
address so you can check it from another device. `HOST=127.0.0.1` keeps it
local-only; `PORT=...` changes the port.

A plain static server (`python -m http.server`, etc.) will *load* the page, but
the threaded engines won't start without the COOP/COEP headers.

### Dev shortcuts

Most runtime pages accept `?autoload=<name>` to boot a folder without the
picker: symlink a game at `<runtime>/<name>` and list its files in
`<name>_filelist.txt` as `<size> <relative path>` lines. The repo has
`testgame` symlinks pointing at games on my machine; they
are dev-only and are **never deployed** (see below).

--
## Deploying

Production is **Cloudflare Pages**, project `noberu`, deployed by direct upload
(not a Git-connected build), with the custom domain `noberu.kitaaura.com`.

### Rules

- **25 MiB per file.** Pages rejects any single file over 25 MiB. The largest
  engine files (Ren'Py and KiriKiri wasm, ~22 MB) fit. BoxedWine's 152 MiB root
  filesystem is split into eight parts under `boxedwine-runtime/root/` with a
  `parts.json` manifest, and joined in the browser
  (`tools/split-root-zip.mjs` regenerates them).
- **Never deploy the symlinks.** `wrangler pages deploy` follows symlinks, and
  the `testgame` links point at real games. Deploying the folder directly either
  fails on the size limit or, worse, publishes a game. Always deploy a
  symlink-free copy.
- **`_headers` must ship.** 

```sh
# 1. stage a copy without symlinks, .git or .wrangler
rsync -a --no-links --exclude .git --exclude .wrangler --exclude .DS_Store \
  ./ /tmp/noberu-deploy/

# 2. upload it to the production branch
npx wrangler pages deploy /tmp/noberu-deploy --project-name noberu --branch main
```

`tools/stage-deploy.sh` does step 1 too, and also leaves out `beam-worker/`.
The beam matchmaker is deployed separately (`cd beam-worker && npx wrangler
deploy`; its TURN keys are Wrangler secrets, never in the repo).

---

## Repository layout

| Path | What |
|---|---|
| `index.html` | The app: header, tabs, one adapter per engine |
| `assets/` | Shared code: shelf and covers, the noberu menu, reading tools, sync, report, library, 7z reader, saves, beam, settings, touch/gamepad input, theme (IBM Plex Mono in `assets/fonts`, SIL OFL), tour, vendored fflate and qrcode |
| `dict/` | Generated dictionary shards for the reading tools (`tools/build-dict.mjs`, not committed) |
| `*-runtime/` | One folder per engine, each with its own README |
| `beam-worker/` | The beam matchmaker, vndb cover pass-through and save sync store (Cloudflare Worker) |
| `tools/` | Deploy staging and asset helpers |
| `serve-local.mjs` | Local server with production headers |
| `_headers`, `sw.js`, `manifest.webmanifest` | Pages headers, offline shell, PWA manifest |

## Rebuilding an engine

The compiled engines are committed here; their **builds are not**. The
Emscripten builds of rlvm, OnscripterYuri and onscripter-ru live in a separate
workspace with their patches and build scripts. In short:

| Engine | How it's built |
|---|---|
| rlvm | Emscripten + SDL2 + WebGL, `cmake --build wasm/build`, copy `rlvm.js/.wasm` |
| OnscripterYuri | `onscripter/build_web.sh install` (emsdk ports + Lua 5.4.4); patch in `onscripter/patches/` |
| onscripter-ru | `onscripter-ru/build_web.sh install` after `build_deps.sh`; patch in `onscripter-ru/patches/` |
| Ren'Py | Not built: take the engine half of a "Web (Beta)" build from a matching SDK (see `renpy-runtime/README.md`) |
| Kirikiroid2 | Not built: download upstream's CI artifact, then `python3 strip-upstream.py <dir>` |
| siglus_rs | `cargo build --release -p siglus_scene_vm --target wasm32-unknown-unknown`, then `wasm-bindgen` 0.2.111 |
| VNDS-LOVE | love.js web export from the VNDS-LOVE repo; re-apply the `vnds.html` changes |
| Play! | `./build_cmake/build_wasm_release.sh` in the Play! tree |
| BoxedWine | Emscripten build in the BoxedWine tree; re-apply the shell patches, then split `boxedwine.zip` |

Toolchain: [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk).

---

## Free games

The shelf lists freeware visual novels that were downloaded, unpacked and
booted in noberu. "get" downloads the file from the makers' own site through
`NoberuLibrary.addFromUrl` (so through the relay when the site sends no CORS
headers), unpacks it, names it and sets its vndb cover. Nothing is hosted by
noberu except Narcissu (below). Cards show an age where a game has one, and
an 18+ game (Katawa Shoujo) asks in a popup before it downloads.

| Game | Engine | Language | From |
| --- | --- | --- | --- |
| Narcissu | NScripter | English | noberu's copy (see [Demo game](#demo-game)) |
| May Sky (Gogatsu no Sora) | NScripter | English | insani.org (Altogether 2008) |
| Moonshine (Tsuki no Terasu) | NScripter | English | insani.org (Altogether 2008) |
| The Letter (Tegami) | NScripter | English | insani.org (Altogether 2008) |
| Ripples | Ren'Py | English | sakevisual.com |
| Carrot Cake Jinkaku Shuffle Jiken | KiriKiri | English | Novectacle (novect.net, Google Drive) |
| Seventh Coat | KiriKiri | Japanese | Novectacle (novect.net, Google Drive) |
| TRUE REMEMBRANCE -remake- | KiriKiri | Japanese | Vector (vector.co.jp); its archive is inside `true.exe` |
| Katawa Shoujo: Re-Engineered | Ren'Py 8 | English | GitHub (fleetingheart/ksre releases), 1.5 GB |
| Your Turn to Die | RPG Maker MV | English | vgperson.com (the free chapters, vgperson's translation) |
| Butterfly Soup | Ren'Py | English | the player downloads it at itch.io, then adds the zip |
| Our Life: Beginnings & Always | Ren'Py | English | the player downloads it at itch.io, then adds the zip |
| Cinderella Phenomenon | Ren'Py | English | the player downloads it at itch.io (a MediaFire file), then adds the zip |
| Doki Doki Literature Club! | Ren'Py | English | the player downloads it at ddlc.moe, then adds the zip |

Some games are only offered through itch.io, which hands out a new link for
each download (and for DDLC and Butterfly Soup, a pay-what-you-want page
first), so their cards open the game's page and then take the zip the player
saved. They're checked by file name (`ddlc-win.zip`, `ButterflySoup-2.20-pc.zip`,
`our-life-windows-linux.zip`, `CinderellaPhenomenon-1.1-pc.zip`).

Making them run took three fixes, all general: the KiriKiri tab finds an
archive appended to the game's `.exe` (and the library recognises such a game
by its `plugin/*.dll`); the RPG Maker shim points synchronous XHR (which service
workers never see) at a `blob:` URL of the staged file, for Your Turn to Die's
translation; and the Ren'Py 7 page has stand-in `requests` and `_renpysteam`
modules, which Our Life's update check and Cinderella Phenomenon's achievements
import.

Every game was played a few lines in, saved, and loaded back. That found
more, also fixed in general:

- Ren'Py: saving failed in any game once a menu had been shown ("Can't pickle
  function"): the reading tools' menu hook now pickles by name. Movies threw
  "Videos must not be stored in game.zip" (Katawa Shoujo's opening):
  `noberu-video.js` hands them to the player as `blob:` URLs. Old theme images
  (`renpy/common/_roundrect` and friends, which current Ren'Py dropped) are
  kept from the game's own `renpy/` (Ripples' menus).
- KiriKiri: `*` inside a macro passed on only the macro's own arguments, not
  the keys the macro set in `mp`, so Novectacle's character macros failed the
  moment a character appeared. The prelude now rewrites `*` as scenarios load
  and fills the missing keys in before each tag (`MACRO_STAR_FIX`). A right
  click now reaches the game as Escape, which KAG games treat as a right click.
- RPG Maker: the saves panel now finds MV saves whose keys carry a prefix
  (Your Turn to Die's `Kimi RPG File1`).

Known gaps: Carrot Cake's and Seventh Coat's save menus open on mouse hover,
which this KiriKiri build never receives (it only sees the mouse while a
button is down), so they can be played but not saved yet. The Letter resumes
from its title screen when a save is loaded: an ONScripter issue with its
custom click-wait routine (`textgosub`); May Sky, Moonshine and Narcissu load
fine.

insani's releases are the Mac zips: the same game files as the Windows
installers, which noberu can't unpack. Left out after testing: *[text] - A
Summer Story* (Ren'Py 6.10, too old for the bundled Ren'Py), the original
Katawa Shoujo (Re-Engineered plays better), and games only on freem (no fixed
download link) or only as installers or `.tar.bz2`.

## Demo game

The tour downloads **Narcissu** (Web Edition), from
https://huggingface.co/datasets/noberu/noberu-demo.

- Game © stage-nana. Freeware; its readme allows redistribution "so long as
  you do not modify its contents".
- English translation by insani, under the PFSL (Public Fansub Script License).
- ONScripter (bundled with the original package) under the GPL.

The zip is the release exactly as distributed, with `readme.txt`, `PFSL.txt` and
`GPL.txt` inside. It's hosted on Hugging Face because Pages can't serve a 100 MB
file and Hugging Face sends the CORS headers the site needs.

---

## Legal

This project is intended solely for use with lawfully acquired copies of the
original works. It hosts no commercial game data. Engine licenses belong to their
respective projects (see each upstream); several are GPL, which applies to the
compiled engines shipped here.

noberu itself is licensed under the GNU GPLv3, see `LICENSE` for details.
