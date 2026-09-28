# noberu

Play visual novels in the browser, from your own copies of the games.

noberu is a static website that runs real visual novel engines, compiled to
WebAssembly, inside browser tabs. You point it at a game folder on your
computer, or a download link, and the matching engine plays it. Nothing is
uploaded anywhere: the game's files stay on your machine and the engine reads
them in place.

**noberu does not host or distribute games.** You bring a copy you own. The one
exception is the demo, *Narcissu*, a freeware title whose authors allow
unmodified redistribution (see [Demo game](#demo-game)).

Live at **https://noberu.kitaaura.com** (also https://noberu.pages.dev).

> Status: beta. Things break, games fail to boot, and saves can be lost between
> updates. Desktop browsers only; phones get a "desktop only" screen.

---

## Contents

- [Supported engines](#supported-engines)
- [How it works](#how-it-works)
- [Using it](#using-it)
- [Running it locally](#running-it-locally)
- [Deploying](#deploying)
- [Repository layout](#repository-layout)
- [Rebuilding an engine](#rebuilding-an-engine)
- [Demo game](#demo-game)
- [Upstream projects and credits](#upstream-projects-and-credits)
- [Legal](#legal)

---

## Supported engines

Each tab runs a different engine. The downloads library guesses the engine
from a folder's file names and sends the game to the right tab.

| Tab | Engine | Plays | How it's identified | Upstream |
|---|---|---|---|---|
| **rlvm** | rlvm (RealLive clone) | Key's RealLive era: Kanon, Air, Clannad, Little Busters, Planetarian | `Gameexe.ini`, `Seen.txt` | [eglaysher/rlvm](https://github.com/eglaysher/rlvm) |
| **onscripter** | OnscripterYuri (ONScripter fork) | NScripter games: Tsukihime, original Higurashi/Umineko, Narcissu, most doujin VNs | `nscript.dat`, `0.txt`, `00.txt`, `nscr_sec.dat`, `onscript.nt2/nt3` | [YuriSizuku/OnscripterYuri](https://github.com/YuriSizuku/OnscripterYuri) |
| **umineko** | onscripter-ru | The Umineko Project release | `default.cfg` + `.file` scripts | [umineko-project/onscripter-ru](https://github.com/umineko-project/onscripter-ru) |
| **ren'py** | Ren'Py official web build (8.5.3 and 7.8.7) | Ren'Py games (Python 3 and Python 2 generations) | `script_version.txt`, `.rpa`, `.rpyc` | [renpy/renpy](https://github.com/renpy/renpy) |
| **kirikiri** | Kirikiroid2 (web build) | KiriKiri 2 / Z games, including commercial ones with plugins (Nekopara verified) | `.xp3` | [fenghengzhi/kirikiroid2-web](https://github.com/fenghengzhi/kirikiroid2-web) |
| **siglus** | siglus_rs (Rust) | SiglusEngine: Little Busters!, Rewrite+, Summer Pockets, planetarian HD, Steam Clannad/Kanon | `Scene*.pck` | [xmoezzz/siglus_rs](https://github.com/xmoezzz/siglus_rs) |
| **tyrano** | none needed | TyranoScript / TyranoBuilder games | `tyrano/tyrano.js` | [ShikemokuMK/tyranoscript](https://github.com/ShikemokuMK/tyranoscript) |
| **vnds** | VNDS-LOVE on love.js | VNDS-format novels (Nintendo DS VN ports) | `info.txt` | [ajusa/VNDS-LOVE](https://github.com/ajusa/VNDS-LOVE), [Davidobot/love.js](https://github.com/Davidobot/love.js) |
| **ps2** | Play! | PlayStation 2 disc images | `.iso`, `.bin`, `.cue`, `.chd`, `.cso` … | [jpd002/Play-](https://github.com/jpd002/Play-) |
| **wine** | BoxedWine | Windows `.exe` games, as a last resort | `.exe` | [danoon2/Boxedwine](https://github.com/danoon2/Boxedwine) |

There are also two toys in the noberu menu (breakout and a slot machine) that
have nothing to do with visual novels.

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
  work, and video is limited to what the browser can play.
- **kirikiri** reads archives on demand through upstream's virtual filesystem,
  so a 5 GB game stages in seconds. It reimplements ~30 of the Windows plugin
  DLLs commercial games call. Google Analytics, a CDN script and the PWA service
  worker are stripped from upstream's page (`strip-upstream.py`).
- **siglus** is the least mature. We carry six unmerged patches against
  upstream (listed in `siglus-runtime/README.md`).
- **tyrano** needs no engine: a Tyrano game *is* a website. A service worker
  serves the game's files straight from the folder you picked.
- **ps2** and **wine** are general emulators, included for VNs that only exist
  as console or Windows releases. Both are heavy.

---

## How it works

### The shell

`index.html` is the whole app: header, tabs, and one "adapter" view per engine.
Each engine lives in its own folder (`*-runtime/`) as a page that the tab loads
in an `<iframe>`. Every runtime page follows the same contract:

- It exposes one function on `window`, e.g. `ONSInstallAndBoot(root, files, options)`,
  `RLVMInstallAndBoot(root, files)`, `RenPyInstallAndBoot(root, files)`.
  `files` is always the shape a folder `<input webkitdirectory>` produces: `File`
  objects with a `webkitRelativePath`.
- It reports back to the parent page with
  `postMessage({ source: "<name>-runtime", type, ... })`, where `type` is one of
  `status`, `booting`, `running`, `error` (plus a few engine-specific extras).

So a runtime doesn't know or care whether its files came from a folder picker,
the downloads library, or a zip that was unpacked in the browser.

### No server

The site is 100% static: HTML, JS, wasm, and a `_headers` file. There are no
API endpoints and no accounts. Everything a player does stays in their browser:

| What | Where it's kept |
|---|---|
| Linked game folders | A `FileSystemDirectoryHandle` in IndexedDB (`noberu-library`); nothing copied |
| Downloaded / copied games | The browser's private file storage (OPFS), under `library/<id>/` |
| Saves | Per engine: IDBFS databases (`/save`, `/home`, `/home/web_user/.renpy`), OPFS (umineko), `krkr2-space-*` databases (kirikiri) |
| Theme, tour, welcome notice | `localStorage` |

Because storage is tied to the site's address, **saves on one domain don't
appear on another** (e.g. `noberu.pages.dev` vs `noberu.kitaaura.com`). The
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

The catch: under `require-corp`, anything loaded from another site must send
CORS headers or a `Cross-Origin-Resource-Policy` header, or the browser blocks
it. This is why the demo game is hosted on Hugging Face (which sends CORS
headers) rather than archive.org or GitHub (which don't).

### Downloads library (`assets/library.js`)

The download icon in the header opens it. Three ways in:

- **add folder**: links a folder on this computer (Chrome/Edge). Instant, even
  for a 12 GB game, because only a reference is stored.
- **add file**: copies files (a `.zip`, a disc image) into browser storage.
- **web link**: the browser downloads a file straight from a URL into browser
  storage. The server has to allow cross-origin reads, or the download fails
  with a message saying so.

A downloaded `.zip` gets an **unzip** button (via vendored `fflate`). **play**
hands the game to the tab for its detected engine; the engine dropdown
overrides a wrong guess.

### Saves panel (`assets/saves.js`)

Lists every save every engine has written, grouped by game, with export (zip),
import and delete. It knows the three storage shapes above.

### Demo tour (`assets/tour.js`)

On a first visit, after the welcome notice, a guided tour highlights each
control in turn: downloads → types the Narcissu link for you → download →
unzip → play → boot local → the ▣ fullscreen button. It uses the real
controls, so people learn the actual flow. `?tour` replays it; `?tour-url=…`
points it at a different zip (useful for local testing).

---

## Using it

1. Open the site on a desktop browser (Chrome or Edge recommended; folder
   linking needs the File System Access API).
2. Either open the tab for your game's engine and **choose folder**, or use
   **downloads → add folder** and let it detect the engine, or use the
   **autodetect engine** button on the about page.
3. Press **boot local**.
4. Press **▣** in the window bar for fullscreen; Esc comes back.

Pick the folder that holds the game's data files (the one with `nscript.dat`,
`Gameexe.ini`, `data.xp3`, and so on). A wrapper folder one level above is
usually fine; the library searches a couple of levels down.

Tip for every SDL-based engine: move the mouse before clicking. SDL takes a
click's position from the last mouse movement, so a click without one can land
in the wrong place.

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
`testgame` symlinks pointing at games on the original developer's machine; they
are dev-only and are **never deployed** (see below).

---

## Deploying

Production is **Cloudflare Pages**, project `noberu`, deployed by direct upload
(not a Git-connected build), with the custom domain `noberu.kitaaura.com`.

### Rules that matter

- **25 MiB per file.** Pages rejects any single file over 25 MiB. The largest
  engine files (Ren'Py and KiriKiri wasm, ~22 MB) fit. BoxedWine's 152 MiB root
  filesystem is split into eight parts under `boxedwine-runtime/root/` with a
  `parts.json` manifest, and joined in the browser
  (`tools/split-root-zip.mjs` regenerates them).
- **Never deploy the symlinks.** `wrangler pages deploy` follows symlinks, and
  the `testgame` links point at real games. Deploying the folder directly either
  fails on the size limit or, worse, publishes a game. Always deploy a
  symlink-free copy.
- **`_headers` must ship.** Without it the threaded engines break.

### Steps

```sh
# 1. stage a copy without symlinks, .git or .wrangler
rsync -a --no-links --exclude .git --exclude .wrangler --exclude .DS_Store \
  ./ /tmp/noberu-deploy/

# 2. upload it to the production branch
npx wrangler pages deploy /tmp/noberu-deploy --project-name noberu --branch main
```

`tools/stage-deploy.sh` does step 1 too (add `--exclude '.wrangler'` to it
first; it currently copies that folder).

### Custom domain

`noberu.kitaaura.com` was added from the Pages project (**Custom domains → Set
up a custom domain**), which creates a proxied `CNAME noberu → noberu.pages.dev`
in the `kitaaura.com` zone and issues the certificate. Adding the CNAME by hand
isn't enough; Pages has to know about the domain or it returns 522.

### Before overwriting production

If more than one machine deploys, compare the live files with your local copy
first, so you don't roll back someone else's changes.

---

## Repository layout

```
index.html                 the app: header, tabs, adapter views, all glue code
_headers                   Cloudflare Pages headers (cross-origin isolation)
serve-local.mjs            local dev server with the same headers
assets/
  theme.css                flat dark/light theme
  library.js               downloads library
  saves.js                 saves panel
  tour.js                  first-visit demo tour
  vendor/fflate.min.js     unzip (MIT)
rlvm-runtime/              rlvm.js/.wasm + rlvm.html
onscripter-runtime/        onsyuri.js/.wasm + ons.html
onscripter-ru-runtime/     onscripter-ru.js/.wasm + onscripter-ru.html
renpy-runtime/             renpy.* (8.x), v7/ (7.x), stage.js
kirikiri-runtime/          Kirikiroid2 build, vlfs.js, noberu-glue.js, strip-upstream.py
siglus-runtime/            pkg/ (wasm-bindgen output), noberu.html, noberu-glue.js
tyrano-runtime/            tyrano-sw.js (service worker), noberu-glue.js, test-vfs.mjs
vnds-runtime/              love.js/.wasm, game.data (VNDS-LOVE), vnds.html
play-runtime/              Play.js/.wasm, play-bridge.js
boxedwine-runtime/         boxedwine.js/.wasm, root/ (split rootfs), overlays/
tools/                     split-root-zip.mjs, stage-deploy.sh, make-favicon-frames.py
```

Each `*-runtime/README.md` documents that engine in depth: its host API, how it
reads files, where it saves, and its known limits.

---

## Rebuilding an engine

The compiled engines are committed here; their **build trees are not**. The
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

## Upstream projects and credits

noberu stands on these projects. Engines marked *patched* carry local changes.

- [eglaysher/rlvm](https://github.com/eglaysher/rlvm) (*patched*) — RealLive clone
- [YuriSizuku/OnscripterYuri](https://github.com/YuriSizuku/OnscripterYuri) (*patched*) — ONScripter fork, GPLv2
- [umineko-project/onscripter-ru](https://github.com/umineko-project/onscripter-ru) (*patched*) and [umineko-project/sdl-gpu](https://github.com/umineko-project/sdl-gpu)
- [renpy/renpy](https://github.com/renpy/renpy) — official web packages from renpy.org
- [fenghengzhi/kirikiroid2-web](https://github.com/fenghengzhi/kirikiroid2-web) (*patched page*) — Kirikiroid2 web build
- [xmoezzz/siglus_rs](https://github.com/xmoezzz/siglus_rs) (*patched*) — SiglusEngine in Rust, MPL-2.0
- [ShikemokuMK/tyranoscript](https://github.com/ShikemokuMK/tyranoscript) — nothing consumed; games ship their own engine
- [ajusa/VNDS-LOVE](https://github.com/ajusa/VNDS-LOVE) and [Davidobot/love.js](https://github.com/Davidobot/love.js)
- [jpd002/Play-](https://github.com/jpd002/Play-) — PS2 emulator
- [danoon2/Boxedwine](https://github.com/danoon2/Boxedwine) (*patched shell*) — Windows emulator
- [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk), [boostorg/boost](https://github.com/boostorg/boost)
- [101arrowz/fflate](https://github.com/101arrowz/fflate) — unzip, MIT
- Kosugi font (SIL Open Font License) — fallback font for rlvm and onscripter
- *Katawa Shoujo* art on the mobile screen — Four Leaf Studios, CC BY-NC-ND 3.0

Also evaluated and not used: [krkrsdl2/krkrsdl2](https://github.com/krkrsdl2/krkrsdl2)
(no commercial plugin support), [FWGS/rlvm](https://github.com/FWGS/rlvm) (SDL2
fork, dormant), [cretz/vitaslop](https://github.com/cretz/vitaslop) (PS Vita,
out of scope).

---

## Legal

This project is intended solely for use with lawfully acquired copies of the
original works. It hosts no commercial game data. Engine licenses belong to their
respective projects (see each upstream); several are GPL, which applies to the
compiled engines shipped here.

<!-- TODO before publishing:
  - pick a license for noberu's own code (index.html, assets/*.js, glue files)
  - confirm each engine's license and whether its source must be linked/offered
    (GPL engines: rlvm, OnscripterYuri, onscripter-ru, BoxedWine)
  - Discord contact: farisnyanyann
-->
