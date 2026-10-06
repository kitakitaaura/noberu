# noberu

Play visual novels in the browser, from your own copies of the games.

![Noberu Screenshot](./assets/markdown/Screenshot%202026-09-28%20at%201.28.33 AM.png)

noberu is a static website that runs real visual novel engines, compiled to
WebAssembly, inside your browser.

**noberu is still in development, and it at a very underdeveloped state. Please back up saves, don't use it for anything you consider "important", and please report bugs.**

Questions (not for issues - just file an issue on GitHub)? DM me on Discord - farisnyanyann

**noberu does not host or distribute games.** You use a copy you own. The one
exception is the demo, *Narcissu*, a freeware title whose authors allow
unmodified redistribution (see [Demo game](#demo-game)).

Live at **https://noberu.kitaaura.com** (also https://noberu.pages.dev).

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
accounts. The one piece of server code is the small matchmaker for
[beam](#beam-send-games-between-devices), which only introduces two devices to
each other. Everything a player does stays in their browser:

| What | Where it's kept |
|---|---|
| Linked game folders | A `FileSystemDirectoryHandle` in IndexedDB (`noberu-library`) - nothing copied |
| Downloaded / copied games | The browser's private file storage (OPFS), under `library/<id>/` |
| Saves | Per engine: IDBFS databases (`/save`, `/home`, `/home/web_user/.renpy`), OPFS (umineko), `krkr2-space-*` databases (kirikiri), `localStorage` / localforage (rpg maker) |
| Settings, theme, tour, welcome notice | `localStorage` (`noberu.settings.*` and a few older keys) |

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
- **add file**: copies files (a `.zip`, a disc image) into browser storage.
- **web link**: the browser downloads a file straight from a URL into browser
  storage. ***The server has to allow cross-origin reads, or the download fails
  with a message saying so.***

A downloaded `.zip` gets an **unzip** button (via vendored `fflate`). **play**
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
   instead (**add file** with a `.zip`, or a web link).
2. Either open the tab for your game's engine and **choose folder**, or use
   **downloads → add folder** and let it detect the engine, or use the
   **autodetect engine** button on the about page.
3. Press **boot local**.
4. Press **▣** in the window bar for fullscreen; Esc comes back.

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

## Beam (send games between devices)

Beam sends a game, its saves, or just saves from one browser to another, like
AirDrop. Both devices open beam, one shows a code (and QR code), the other
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
| `assets/` | Shared code: library, saves, beam, settings, touch/gamepad input, theme, tour, vendored fflate and qrcode |
| `*-runtime/` | One folder per engine, each with its own README |
| `beam-worker/` | The beam matchmaker (Cloudflare Worker) |
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
