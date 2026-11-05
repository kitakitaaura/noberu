// LUCA System runtime for the "luca" tab (Little Busters! English Edition).
//
// Host entry point: window.LucaInstallAndBoot(root, files), `files` being the
// FileList (or File array with webkitRelativePath) of the game folder.
// Status goes to the parent as postMessage({ source: "luca-runtime", type, ... }),
// like the other runtimes.
//
// The engine is ours (noberu-engines, crates/luca-web, GPLv3). It never touches
// files: this page reads byte ranges of the .PAK archives with File.slice and
// hands them to wasm, which parses indexes, decodes images and runs the script.
// player.step() returns the events up to the next thing the page must do.
//
// Test switches (URL): ?mute=1 silences audio, ?start=SEEN0514 starts at a
// scene, ?fast=1 advances text by itself, ?dev=testgame boots the game in that
// folder of the dev server (read by HTTP ranges; serve-local.mjs supports them).

import init, { Player, pak_index, pak_index_len, decode_cz, oggpak_skip } from "./pkg/luca_web.js";

const params = new URLSearchParams(location.search);
const MUTE = params.get("mute") === "1";
const FAST = params.get("fast") === "1";

const W = 1280, H = 720;
const FPS = 60;

const $ = (id) => document.getElementById(id);
const stage = $("stage"), screen = $("screen"), ctx = screen.getContext("2d");
const textbox = $("textbox"), nameEl = $("name"), textEl = $("text");
const choicesEl = $("choices"), notice = $("notice"), movie = $("movie");

function post(type, detail) {
  window.parent.postMessage(Object.assign({ source: "luca-runtime", type }, detail || {}), "*");
}
function status(text) { post("status", { text }); }
function say(line) { if (window.NoberuSay) window.NoberuSay(line); }

// --- fit the 1280x720 stage to the window -----------------------------------

function fit() {
  const k = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `scale(${k})`;
}
window.addEventListener("resize", fit);
fit();

// --- files and archives -----------------------------------------------------

const files = new Map(); // upper-case base name -> File

async function readRange(file, start, length) {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

class Archive {
  constructor(name, file, index) {
    this.name = name;
    this.file = file;
    this.idStart = index.id_start;
    this.count = index.count;
    this.offsets = index.offsets();
    this.lengths = index.lengths();
    // CHARCG: the body each face image is drawn on (0 = stands alone)
    this.bases = index.bases();
    index.free();
  }
  has(id) { return id >= this.idStart && id < this.idStart + this.count; }
  base(id) { return this.bases.length ? this.bases[id - this.idStart] : 0; }
  read(id) {
    const i = id - this.idStart;
    return readRange(this.file, this.offsets[i], this.lengths[i]);
  }
}

async function openArchive(name) {
  const file = files.get(name);
  if (!file) return null;
  const head = await readRange(file, 0, 36);
  const len = pak_index_len(head);
  return new Archive(name, file, pak_index(await readRange(file, 0, len), file.size));
}

const IMAGE_PAKS = ["BGCG.PAK", "EVENTCG.PAK", "CHARCG.PAK", "FACECG.PAK", "OTHCG.PAK", "GENCG.PAK",
  "SYSCG.PAK", "SYSCG2.PAK", "PARTS.PAK", "PT.PAK", "GM.PAK", "BATTLE.PAK"];
let imagePaks = [], musicPak = null, sePaks = [], voicePaks = [];

// --- images -----------------------------------------------------------------

// Plain screens the scripts use instead of an image.
const PLAIN = { 65000: "#fff", 65001: "#000" };
const images = new Map(); // id -> Promise<{bitmap, w, h, ox, oy, ax, ay}>

function image(id) {
  let p = images.get(id);
  if (!p) {
    p = loadImage(id).catch((error) => {
      console.warn(`image ${id}:`, error);
      return null;
    });
    images.set(id, p);
    if (images.size > 160) images.delete(images.keys().next().value); // oldest first
  }
  return p;
}

async function loadImage(id) {
  const pak = imagePaks.find((a) => a.has(id));
  if (!pak) throw new Error("no archive holds it");
  const im = decode_cz(await pak.read(id));
  const rgba = im.take_rgba();
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), im.width, im.height);
  const out = {
    bitmap: await createImageBitmap(data),
    w: im.width, h: im.height, ox: im.offset_x, oy: im.offset_y, ax: im.anchor_x, ay: im.anchor_y,
  };
  im.free();
  return out;
}

// --- frames and transitions -------------------------------------------------
//
// The script builds the next frame (background, up to two sprites) and DRAW
// changes to it over n frames. `shown` is on screen; `next` is being built.

let shown = { bg: null, sprites: [] };
let next = null;
const shownCanvas = new OffscreenCanvas(W, H);
const nextCanvas = new OffscreenCanvas(W, H);
let transition = null; // { start, ms, done: Promise, finish() }

function building() {
  if (!next) next = { bg: shown.bg, sprites: shown.sprites.slice() };
  return next;
}

async function compose(frame, target) {
  const c = target.getContext("2d");
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  if (frame.bg != null) {
    if (PLAIN[frame.bg]) {
      c.fillStyle = PLAIN[frame.bg];
      c.fillRect(0, 0, W, H);
    } else {
      const img = await image(frame.bg);
      if (img) c.drawImage(img.bitmap, 0, 0);
    }
  }
  for (const s of frame.sprites) {
    // Most sprite ids are faces: CHARCG's table gives the body to draw first.
    const pak = imagePaks.find((a) => a.has(s.id));
    const base = pak ? pak.base(s.id) : 0;
    for (const id of base ? [base, s.id] : [s.id]) {
      const img = await image(id);
      if (!img) continue;
      // The script's (x, y) is where the sprite's anchor goes; the pixels sit
      // at (ox, oy) in the sprite's full box. No anchor: bottom center.
      const left = img.ax ? s.x - img.ax + img.ox : s.x - img.w / 2;
      const top = img.ay ? s.y - img.ay + img.oy : s.y - img.h;
      c.drawImage(img.bitmap, left, top);
    }
  }
}

function paint(alpha) {
  ctx.globalAlpha = 1;
  ctx.drawImage(shownCanvas, 0, 0);
  if (alpha > 0) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(nextCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
}

async function draw(frames) {
  const target = next || { bg: shown.bg, sprites: shown.sprites.slice() };
  next = null;
  if (transition) transition.finish();
  await compose(target, nextCanvas);
  const ms = skipping() ? 0 : (frames / FPS) * 1000;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const t = { start: performance.now(), ms, done, finish: null };
  t.finish = () => {
    if (transition !== t) return;
    transition = null;
    shownCanvas.getContext("2d").drawImage(nextCanvas, 0, 0);
    shown = target;
    paint(0);
    finish();
  };
  transition = t;
  if (!ms) {
    t.finish();
    return;
  }
  // requestAnimationFrame stops in a background tab: a timer makes sure the
  // transition still ends (and the script goes on).
  setTimeout(() => t.finish(), ms + 250);
  const tick = (now) => {
    if (transition !== t) return;
    const k = t.ms ? (now - t.start) / t.ms : 1;
    if (k >= 1) t.finish();
    else {
      paint(k);
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// --- audio ------------------------------------------------------------------

let audio = null, master = null;
let bgm = null; // { id, source, gain }
let voice = null;
const seBuffers = new Map();

function audioReady() {
  if (audio) return;
  audio = new AudioContext();
  master = audio.createGain();
  master.gain.value = MUTE ? 0 : 1;
  master.connect(audio.destination);
}

const decoded = { bgm: 0, se: 0, voice: 0, failed: 0 }; // for tests (lucaDebug.decoded)

async function decodeEntry(pak, id, kind) {
  const bytes = await pak.read(id);
  const skip = oggpak_skip(bytes.subarray(0, 16));
  try {
    const buffer = await audio.decodeAudioData(bytes.slice(skip).buffer);
    decoded[kind]++;
    return buffer;
  } catch (error) {
    decoded.failed++;
    throw error;
  }
}

async function playBgm(id) {
  if (!audio || !musicPak || !musicPak.has(id)) return;
  if (bgm && bgm.id === id) return;
  stopBgm(30);
  const mine = { id, source: null, gain: audio.createGain() };
  bgm = mine;
  try {
    const buffer = await decodeEntry(musicPak, id, "bgm");
    if (bgm !== mine) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    mine.gain.gain.value = 0.7;
    source.connect(mine.gain).connect(master);
    source.start();
    mine.source = source;
  } catch (error) {
    console.warn(`bgm ${id}:`, error);
  }
}

function stopBgm(frames) {
  if (!bgm) return;
  const old = bgm;
  bgm = null;
  if (!old.source) return;
  const end = audio.currentTime + Math.max(0.02, frames / FPS);
  old.gain.gain.setValueAtTime(old.gain.gain.value, audio.currentTime);
  old.gain.gain.linearRampToValueAtTime(0, end);
  old.source.stop(end + 0.05);
}

async function playSe(id) {
  if (!audio) return;
  const pak = sePaks.find((a) => a.has(id));
  if (!pak) return;
  try {
    let buffer = seBuffers.get(id);
    if (!buffer) {
      buffer = await decodeEntry(pak, id, "se");
      seBuffers.set(id, buffer);
      if (seBuffers.size > 80) seBuffers.delete(seBuffers.keys().next().value);
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
  } catch (error) {
    console.warn(`se ${id}:`, error);
  }
}

function stopVoice() {
  if (voice) {
    try { voice.stop(); } catch (error) { /* already ended */ }
    voice = null;
  }
}

async function playVoice(id) {
  stopVoice();
  if (!audio || !id) return;
  const pak = voicePaks.find((a) => a.has(id));
  if (!pak) return;
  try {
    const buffer = await decodeEntry(pak, id, "voice");
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
    voice = source;
  } catch (error) {
    console.warn(`voice ${id}:`, error);
  }
}

// --- input ------------------------------------------------------------------

let advance = null; // resolve function while waiting for a click
let ctrlHeld = false;
const skipping = () => ctrlHeld || FAST;

function waitAdvance() {
  return new Promise((resolve) => {
    advance = resolve;
    if (skipping()) setTimeout(() => { if (advance === resolve) { advance = null; resolve(); } }, FAST ? 5 : 40);
  });
}

function onAdvance() {
  audioReady();
  if (!choicesEl.classList.contains("hidden")) return;
  if (transition) { transition.finish(); return; }
  if (advance) {
    const a = advance;
    advance = null;
    a();
  }
}

stage.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.target.closest("#choices") == null) onAdvance(); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Control") { ctrlHeld = true; onAdvance(); }
  if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); onAdvance(); }
});
window.addEventListener("keyup", (e) => { if (e.key === "Control") ctrlHeld = false; });
window.addEventListener("blur", () => { ctrlHeld = false; });
stage.addEventListener("wheel", (e) => { if (e.deltaY > 0) onAdvance(); }, { passive: true });

function choose(options) {
  return new Promise((resolve) => {
    choicesEl.replaceChildren();
    options.forEach((text, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        audioReady();
        choicesEl.classList.add("hidden");
        resolve(i);
      });
      choicesEl.appendChild(b);
    });
    choicesEl.classList.remove("hidden");
    choicesEl.querySelector("button").focus();
  });
}

// --- movies -----------------------------------------------------------------

async function playMovie(name) {
  const file = files.get(`${name}_EN.WEBM`) || files.get(`${name}.WEBM`);
  if (!file || skipping()) return;
  const url = file.url || URL.createObjectURL(file);
  movie.src = url;
  movie.muted = MUTE;
  movie.classList.add("playing");
  textbox.classList.add("hidden");
  try {
    await movie.play();
    await new Promise((resolve) => {
      movie.onended = resolve;
      advance = resolve; // a click skips
    });
  } catch (error) {
    console.warn("movie:", error);
  } finally {
    advance = null;
    movie.pause();
    movie.classList.remove("playing");
    movie.removeAttribute("src");
    if (!file.url) URL.revokeObjectURL(url);
  }
}

// --- the script loop --------------------------------------------------------

let player = null;

function showText(e) {
  nameEl.textContent = e.name;
  textEl.textContent = e.text;
  textbox.classList.remove("hidden");
  textbox.classList.add("ready");
  say({ name: e.name, text: e.text, kind: "line", original: e.jp });
}

async function run() {
  for (;;) {
    const events = JSON.parse(player.step());
    for (const e of events) {
      switch (e.t) {
        case "bg": building().bg = e.id; if (!PLAIN[e.id]) image(e.id); break;
        case "sprite": {
          const f = building();
          const at = f.sprites.findIndex((s) => s.x === e.x);
          const s = { id: e.id, x: e.x, y: e.y };
          if (at >= 0) f.sprites[at] = s; else f.sprites.push(s);
          image(e.id); // start decoding early
          break;
        }
        case "frame": building().sprites = []; break;
        case "draw": await draw(e.frames); break;
        case "wait": if (transition) await transition.done; break;
        case "sleep":
          if (!skipping()) await new Promise((r) => setTimeout(r, (e.frames / FPS) * 1000));
          break;
        case "bgm": playBgm(e.id); break;
        case "bgm_stop": stopBgm(e.frames); break;
        case "se": if (!skipping()) playSe(e.id); break;
        case "close": textbox.classList.add("hidden"); break;
        case "movie": await playMovie(e.name); break;
        case "trophy": post("trophy", { id: e.id }); break;
        case "text":
          showText(e);
          if (e.voice && !skipping()) playVoice(e.voice);
          await waitAdvance();
          textbox.classList.remove("ready");
          break;
        case "select": {
          textbox.classList.remove("ready");
          say({ name: "", text: e.options.join("\n"), kind: "choice" });
          stopVoice();
          player.choose(await choose(e.options));
          break;
        }
        case "end":
          notice.textContent = `The script stopped.\n${e.at}`;
          notice.classList.remove("hidden");
          status(`stopped: ${e.at}`);
          return;
        default: break;
      }
    }
  }
}

// --- dev loader -------------------------------------------------------------

// A File-like object read by HTTP range requests (only what this page uses).
class RemoteFile {
  constructor(url, name, size) { this.url = url; this.name = name; this.size = size; }
  slice(start, end) {
    const url = this.url;
    return {
      arrayBuffer: async () => {
        const r = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      },
    };
  }
  async arrayBuffer() { return (await fetch(this.url)).arrayBuffer(); }
}

async function devFiles(dir) {
  const names = [...IMAGE_PAKS, "SCRIPT.PAK", "MUSIC.PAK", "SE.PAK", "SYSSE.PAK", "VOICE0.PAK", "VOICE2.PAK",
    "movie/OP00.webm", "movie/OP00_en.webm", "movie/EDAL.webm", "movie/EDAL_en.webm", "movie/AYA.webm"];
  const out = [];
  for (const n of names) {
    const url = `${dir}/${n}`;
    const r = await fetch(url, { method: "HEAD" });
    if (r.ok) out.push(new RemoteFile(url, n.split("/").pop(), Number(r.headers.get("content-length"))));
  }
  return out;
}

// --- boot -------------------------------------------------------------------

window.LucaInstallAndBoot = async function (root, fileList) {
  try {
    status("loading the LUCA engine...");
    await init();
    files.clear();
    for (const f of Array.from(fileList)) {
      files.set(f.name.toUpperCase(), f);
    }
    const script = files.get("SCRIPT.PAK");
    if (!script) throw new Error("No SCRIPT.PAK here. Choose the game folder (the one with files/).");

    status("reading archives...");
    imagePaks = (await Promise.all(IMAGE_PAKS.map(openArchive))).filter(Boolean);
    musicPak = await openArchive("MUSIC.PAK");
    sePaks = (await Promise.all(["SE.PAK", "SYSSE.PAK"].map(openArchive))).filter(Boolean);
    voicePaks = (await Promise.all(["VOICE0.PAK", "VOICE2.PAK"].map(openArchive))).filter(Boolean);

    status("compiling the script...");
    player = new Player(new Uint8Array(await script.arrayBuffer()), Date.now() % 1e9);
    if (params.get("start")) player.start(params.get("start"));
    window.lucaDebug = { player, files, decoded, shown: () => shown, location: () => player.location() };

    post("running", { width: W, height: H });
    notice.textContent = "Click to start";
    notice.classList.remove("hidden");
    stage.focus();
    await waitAdvance();
    notice.classList.add("hidden");
    audioReady();
    await run();
  } catch (error) {
    console.error(error);
    notice.textContent = String(error.message || error);
    notice.classList.remove("hidden");
    post("error", { message: String(error.message || error) });
  }
};

if (params.get("dev")) {
  devFiles(params.get("dev")).then((list) => window.LucaInstallAndBoot("dev", list));
}
