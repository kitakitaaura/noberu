// Host glue for the "siglus" tab in ../index.html.
//
// Host entry point:
//   window.SiglusInstallAndBoot(root, files) - `files` is the FileList from the
//   tab's directory picker.
// Status goes to the parent as
// postMessage({ source: "siglus-runtime", type, ... }), the same shape the
// other runtimes use.
//
// siglus_rs asks for files by Siglus-relative path through four imports it
// expects on the global object. Nothing is copied: reads slice the picked File
// only when the engine opens that path, so an 8 GB game stages instantly.
//
// Everything in ./pkg is the wasm-bindgen build output; this file and
// noberu.html are ours.

(function () {
  "use strict";

  const CANVAS_ID = "siglus-canvas";
  // wgpu is pinned to the WebGL2 backend on wasm32 (features = ["webgl"] in
  // siglus_scene_vm/Cargo.toml), whose downlevel limits cap a texture at 2048.
  // winit sizes the backing store as CSS size x devicePixelRatio, so the CSS
  // size has to stay under that or Surface::configure panics on a HiDPI screen.
  const MAX_BACKING = 2048;

  function post(type, detail) {
    window.parent.postMessage(
      Object.assign({ source: "siglus-runtime", type: type }, detail || {}), "*");
  }
  function status(text) { post("status", { text: text }); }

  // --- touch as a mouse ---------------------------------------------------
  //
  // winit reports a touch as its own kind of pointer, and siglus_rs only acts
  // on mouse buttons: on a phone a tap moved the highlight onto a menu item
  // and never chose it. So a touch on the game canvas is re-sent as the mouse
  // doing the same thing - press, drag, release - before winit sees it.
  // Only the first finger counts, like a mouse has one pointer.
  //
  // The engine reads the button once per frame, so a press and release in
  // the same frame is never seen. A quick tap can be that fast, so the
  // release is held back until the press has had a few frames.

  const MIN_PRESS_MS = 70;
  let touchId = null;
  let pressedAt = 0;

  function asMouse(event) {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const canvas = document.getElementById(CANVAS_ID);
    if (!canvas || event.target !== canvas) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.type === "pointerdown") {
      if (touchId !== null) return;
      touchId = event.pointerId;
    } else if (event.pointerId !== touchId) {
      return;
    }
    const pressed = event.type === "pointerdown" ||
      (event.type === "pointermove" && touchId !== null);
    if (event.type === "pointerdown") pressedAt = performance.now();
    const send = () => canvas.dispatchEvent(new PointerEvent(event.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: event.type === "pointermove" ? -1 : 0,
      buttons: pressed && event.type !== "pointerup" ? 1 : 0,
      pressure: pressed ? 0.5 : 0,
    }));
    if (event.type === "pointerup" || event.type === "pointercancel") {
      touchId = null;
      const wait = MIN_PRESS_MS - (performance.now() - pressedAt);
      if (wait > 0) {
        window.setTimeout(send, wait);
        return;
      }
    }
    send();
  }

  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel",
    "pointerover", "pointerout"]) {
    window.addEventListener(type, asMouse, true);
  }

  // --- path index ---------------------------------------------------------

  const byPath = new Map();     // normalized path -> File
  const byFolded = new Map();   // lowercased path -> File
  const dirChildren = new Map();

  function norm(p) {
    return String(p || "").replaceAll("\\", "/").split("/")
      .filter((s) => s && s !== ".").join("/");
  }
  function fold(p) { return norm(p).toLowerCase(); }

  // Localized Steam builds ship SceneEN.pck / GameexeEN.dat while the engine
  // asks for the canonical names. Upstream handles this for Gameexe but not
  // for Scene.pck, so the alias is applied here too.
  const LOCALES = ["EN", "ZH", "ZHTW", "DE", "ES", "FR", "ID"];
  function aliases(path) {
    const m = norm(path).match(/^(.*?)(\.[^./]+)$/);
    if (!m) return [];
    return LOCALES.map((loc) => `${m[1]}${loc}${m[2]}`);
  }

  function resolve(path) {
    const n = norm(path);
    if (byPath.has(n)) return byPath.get(n);
    const folded = byFolded.get(n.toLowerCase());
    if (folded) return folded;
    for (const candidate of aliases(n)) {
      if (byPath.has(candidate)) return byPath.get(candidate);
      const cf = byFolded.get(candidate.toLowerCase());
      if (cf) return cf;
    }
    return null;
  }

  // --- writable overlay (saves) -------------------------------------------
  //
  // The picked directory is read-only, so saves live here and are consulted
  // ahead of the original files on every read. Persisted per game folder.

  const overlay = new Map();
  const STORE = "files";
  let db = null;
  let dbName = null;

  function openDb(name) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(name, 1); } catch { return resolve(null); }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function loadOverlay(root) {
    dbName = "siglus-saves-" + (root || "game").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64);
    db = await openDb(dbName);
    if (!db) return;
    await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        overlay.set(cur.key, new Uint8Array(cur.value));
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  }

  function persist(key, bytes) {
    if (!db) return;
    try {
      db.transaction(STORE, "readwrite").objectStore(STORE).put(bytes, key);
    } catch (error) {
      console.warn("siglus: save persist failed", error);
    }
  }

  // --- synchronous reads ---------------------------------------------------
  //
  // The engine's VFS imports are synchronous, so reads go through a blocking
  // XHR against a blob URL. responseText is UTF-16, so a whole-file read of a
  // large movie would cost twice its size - that is why the engine was taught
  // to range-read containers instead.

  function readBlobSync(blob, label) {
    const url = URL.createObjectURL(blob);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.overrideMimeType("text/plain; charset=x-user-defined");
      xhr.send(null);
      if (xhr.status !== 200 && xhr.status !== 0) {
        throw new Error(`read ${label}: HTTP ${xhr.status}`);
      }
      const text = xhr.responseText || "";
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
      return out;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  globalThis.siglusFileExists = (p) =>
    overlay.has(fold(p)) || resolve(p) !== null;

  globalThis.siglusKnownFileCount = () => byPath.size;

  globalThis.siglusFileSize = (p) => {
    const saved = overlay.get(fold(p));
    if (saved) return saved.length;
    const file = resolve(p);
    return file ? file.size : 0;
  };

  globalThis.siglusReadFile = (p) => {
    const saved = overlay.get(fold(p));
    if (saved) return saved;
    const file = resolve(p);
    if (!file) throw new Error(`Siglus file not found: ${p}`);
    return readBlobSync(file, p);
  };

  globalThis.siglusReadRange = (p, offset, len) => {
    const start = Math.max(0, Number(offset) | 0);
    const want = Math.max(0, Number(len) | 0);
    const saved = overlay.get(fold(p));
    if (saved) {
      const from = Math.min(start, saved.length);
      return saved.subarray(from, Math.min(from + want, saved.length));
    }
    const file = resolve(p);
    if (!file) throw new Error(`Siglus file not found: ${p}`);
    const end = Math.min(start + want, file.size);
    if (end <= start) return new Uint8Array(0);
    return readBlobSync(file.slice(start, end), p);
  };

  globalThis.siglusWriteFile = (p, data) => {
    const key = fold(p);
    // The view points into wasm memory, which moves when it grows: copy first.
    const bytes = new Uint8Array(data.length);
    bytes.set(data);
    overlay.set(key, bytes);
    persist(key, bytes);
  };

  globalThis.siglusListDir = (p) => {
    const dir = norm(p).replace(/\/$/, "");
    const out = new Set(dirChildren.get(dir) || []);
    const prefix = dir ? dir.toLowerCase() + "/" : "";
    for (const key of overlay.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes("/")) out.add(rest);
    }
    return Array.from(out);
  };

  // --- boot ---------------------------------------------------------------

  const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX\/)/;

  function sizeCanvas() {
    const canvas = document.getElementById(CANVAS_ID);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // Never override devicePixelRatio to dodge the cap: winit sizes the
    // backing store from the real DPR but reads scale_factor() back from the
    // page, so an override desyncs the two and pointer coords land wrong.
    const maxCss = Math.floor(MAX_BACKING / dpr);
    const availW = Math.min(window.innerWidth, maxCss);
    const availH = Math.min(window.innerHeight, Math.floor(maxCss * 9 / 16));
    const scale = Math.min(availW / 16, availH / 9);
    const w = Math.max(320, Math.floor(scale * 16));
    const h = Math.max(180, Math.floor(scale * 9));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.marginTop = Math.max(0, Math.floor((window.innerHeight - h) / 2)) + "px";
    return { w, h, dpr };
  }

  let started = false;

  window.SiglusInstallAndBoot = async function (root, fileList) {
    try {
      if (started) return;
      started = true;

      const files = [...(fileList || [])];
      if (files.length === 0) throw new Error("No files were staged.");

      status("indexing files...");
      for (const file of files) {
        const relative = file.webkitRelativePath || file.name;
        const parts = norm(relative).split("/");
        // Strip the picked folder itself so paths are game-relative.
        const path = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
        if (!path || IGNORED.test(path)) continue;
        byPath.set(path, file);
        byFolded.set(path.toLowerCase(), file);
        const segments = path.split("/");
        for (let i = 0; i < segments.length; i++) {
          const dir = segments.slice(0, i).join("/");
          if (!dirChildren.has(dir)) dirChildren.set(dir, new Set());
          dirChildren.get(dir).add(segments[i]);
        }
      }

      if (!globalThis.siglusFileExists("Scene.pck") &&
          !globalThis.siglusFileExists("Gameexe.dat") &&
          !globalThis.siglusFileExists("Gameexe.ini")) {
        throw new Error("No Scene.pck or Gameexe here. Pick the folder holding " +
          "the game's Scene.pck (the one with the .exe in it).");
      }

      status("restoring saves...");
      await loadOverlay(root);

      const size = sizeCanvas();
      window.addEventListener("resize", sizeCanvas);

      status("loading the engine...");
      const mod = await import("./pkg/siglus_scene_vm.js");
      await mod.default();

      post("booting", { files: byPath.size });
      status("starting the engine...");
      mod.start_siglus_from_directory(CANVAS_ID, "");

      const canvas = document.getElementById(CANVAS_ID);
      canvas.focus();
      post("running", { width: size.w, height: size.h, files: byPath.size });
    } catch (error) {
      console.error(error);
      post("error", { message: String((error && error.message) || error) });
    }
  };
})();
