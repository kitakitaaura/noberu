// Host glue for the "kirikiri" tab in ../index.html.
//
// Everything else in this directory is upstream's build, and strip-upstream.py
// overwrites index.html wholesale on every update - so the glue lives here and
// the script tag that loads it is re-injected by that script.
//
// Host entry point:
//   window.KrKrInstallAndBoot(root, files) - `files` is the FileList from the
//   tab's directory picker.
// Status goes to the parent as
// postMessage({ source: "kirikiri-runtime", type, ... }), the same shape the
// other runtimes use.
//
// Nothing is copied. Each File is registered with VLFS as a `blob` source,
// which reads it with .slice() only when the engine opens that path, so a 5 GB
// game stages in seconds and only what is touched is ever read.

(function () {
  "use strict";

  function post(type, detail) {
    window.parent.postMessage(
      Object.assign({ source: "kirikiri-runtime", type: type }, detail || {}), "*");
  }

  function status(text) {
    post("status", { text: text });
  }

  // Saves are keyed by what upstream calls a "space"; one per game folder, so
  // two games never share a save store.
  function saveSpaceName(root) {
    return (root || "game").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "game";
  }

  // A KiriKiri game mounts data.xp3 and pulls the rest in itself, so the
  // engine only needs to be told where to start. Upstream asks the player to
  // choose when there is more than one archive; here the conventional names
  // win and the question never comes up.
  const STARTUP_NAMES = ["/data.xp3", "/startup.xp3", "/patch.xp3"];

  function startupArchive(paths) {
    for (const name of STARTUP_NAMES) {
      const hit = paths.find((p) => p.toLowerCase() === name);
      if (hit) return hit;
    }
    // Otherwise the shallowest, then shortest, name: data-like archives sit at
    // the root while extras tend to be deeper or suffixed.
    return [...paths].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0];
  }

  const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX\/)/;

  // --- KIRIKIROID ------------------------------------------------------------
  //
  // This engine is Kirikiroid2, but it reports osName "Linux", so a game that
  // checks for Kirikiroid2 does not find it. Fate/stay night Réalta Nua
  // Ultimate Edition does, with @if(KIRIKIROID), and without it takes its
  // desktop path, which calls Storages.isExistentDirectory - missing here -
  // and loops forever on its save-folder check.
  //
  // So the startup archive gets one script of ours in front: the engine is
  // handed the same archive with a new startup.tjs added, which sets the
  // KIRIKIROID flag and runs the game's own startup.tjs (renamed
  // startup_game.tjs in the new index). The archive's own bytes are not
  // copied: the result is a Blob of the original File plus a few hundred new
  // bytes and a rebuilt index, read lazily like any other file.

  // The prelude also fills in directory listings. Storages.dirlist (the
  // fstat plugin) lists only the engine's in-memory filesystem, never the
  // picked files, so a game that finds its archives by listing its folder -
  // the UE mounts image.xp3, patch_*.xp3 and the rest that way - finds none.
  // The listing of every picked folder is written into the prelude, and
  // dirlist answers from it as well.
  // "en-US" style, the shape Windows' LocaleName has.
  function browserLocale() {
    const tag = (navigator.language || "en-US").replace("_", "-");
    return /^[a-z]{2}-[A-Za-z]{2}$/.test(tag) ? tag : "en-US";
  }

  function preludeScript(paths) {
    const dirs = new Map(); // "/sub/" -> Set of names ("file", "folder/")
    const add = (dir, name) => {
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir).add(name);
    };
    for (const path of paths) {
      const parts = path.split("/").filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const dir = "/" + parts.slice(0, i).map((p) => p + "/").join("");
        add(dir, i === parts.length - 1 ? parts[i] : parts[i] + "/");
      }
    }
    const listing = [...dirs].map(([dir, names]) =>
      JSON.stringify(dir.toLowerCase()) + " => [" +
      [...names].map((n) => JSON.stringify(n)).join(",") + "]").join(",\n");
    return [
      "// noberu: runs before the game's own startup.tjs (see noberu-glue.js).",
      'Scripts.eval("@set(KIRIKIROID=1)");',
      'if (typeof Storages.dirlist !== "Object") Plugins.link("fstat.dll");',
      "global.noberu_dirlist_files = %[\n" + listing + "\n];",
      "global.noberu_dirlist_original = Storages.dirlist;",
      "Storages.dirlist = function(path) {",
      "  var list = global.noberu_dirlist_original(path);",
      "  var key = path;",
      '  if (key.indexOf("file://./") == 0) key = key.substr(9);',
      '  key = ("/" + key + "/").replace(/\\/+/g, "/").toLowerCase();',
      "  var extra = global.noberu_dirlist_files[key];",
      "  if (extra !== void) {",
      "    for (var i = 0; i < extra.count; i++) if (list.find(extra[i]) < 0) list.add(extra[i]);",
      "  }",
      "  return list;",
      "};",
      // Windows games read the user's locale from the registry, which a
      // browser has none of: answer with the browser's language, so the UE
      // (and others) start in the player's language rather than Japanese.
      "global.noberu_regvalue_original = System.readRegValue;",
      "System.readRegValue = function(key) {",
      '  if (typeof key === "String" && key.toLowerCase().indexOf("international\\\\localename") >= 0)',
      "    return " + JSON.stringify(browserLocale()) + ";",
      "  return global.noberu_regvalue_original(...);",
      "};",
      'Scripts.execStorage("startup_game.tjs");',
      "",
    ].join("\n");
  }

  const XP3_MAGIC = [0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01];

  function u64(view, at) {
    return Number(view.getBigUint64(at, true));
  }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function utf16(text) {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      out[i * 2] = text.charCodeAt(i) & 0xff;
      out[i * 2 + 1] = text.charCodeAt(i) >> 8;
    }
    return out;
  }

  function chunk(tag, body) {
    const out = new Uint8Array(12 + body.length);
    for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
    new DataView(out.buffer).setBigUint64(4, BigInt(body.length), true);
    out.set(body, 12);
    return out;
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  function infoBody(flags, size, packed, name) {
    const body = new Uint8Array(22 + name.length * 2);
    const view = new DataView(body.buffer);
    view.setUint32(0, flags, true);
    view.setBigUint64(4, BigInt(size), true);
    view.setBigUint64(12, BigInt(packed), true);
    view.setUint16(20, name.length, true);
    body.set(utf16(name), 22);
    return body;
  }

  // The archive with the prelude in front, or null if this one cannot take
  // it (no plain startup.tjs entry, an unusual header): then it runs as is.
  async function withPrelude(file, paths) {
    const head = new Uint8Array(await file.slice(0, 0x28).arrayBuffer());
    if (head.length < 0x28 || XP3_MAGIC.some((b, i) => head[i] !== b)) return null;
    const hv = new DataView(head.buffer);
    // Version 2 archives point at a "cushion" at 0x17, whose real index
    // offset sits at 0x20.
    const pointerAt = u64(hv, 11) === 0x17 ? 0x20 : 11;
    const indexAt = u64(hv, pointerAt);
    const meta = new DataView(await file.slice(indexAt, indexAt + 17).arrayBuffer());
    let index;
    if ((meta.getUint8(0) & 7) === 1) {
      const packed = u64(meta, 1);
      index = await inflate(new Uint8Array(await file.slice(indexAt + 17, indexAt + 17 + packed).arrayBuffer()));
    } else if ((meta.getUint8(0) & 7) === 0) {
      const size = u64(meta, 1);
      index = new Uint8Array(await file.slice(indexAt + 9, indexAt + 9 + size).arrayBuffer());
    } else {
      return null;
    }

    const script = concat([new Uint8Array([0xff, 0xfe]), utf16(preludeScript(paths))]);
    const parts = [];
    let renamed = false;
    const iv = new DataView(index.buffer, index.byteOffset, index.byteLength);
    for (let at = 0; at + 12 <= index.length;) {
      const tag = String.fromCharCode(...index.subarray(at, at + 4));
      const len = u64(iv, at + 4);
      const whole = index.subarray(at, at + 12 + len);
      at += 12 + len;
      if (tag !== "File" || renamed) {
        parts.push(whole);
        continue;
      }
      // A File chunk: info (flags, sizes, name), segm, adlr, ...
      const body = whole.subarray(12);
      const bv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const sub = [];
      let isStartup = false;
      for (let p = 0; p + 12 <= body.length;) {
        const t = String.fromCharCode(...body.subarray(p, p + 4));
        const l = u64(bv, p + 4);
        const c = body.subarray(p + 12, p + 12 + l);
        if (t === "info") {
          const cv = new DataView(c.buffer, c.byteOffset, c.byteLength);
          const nameLen = cv.getUint16(20, true);
          const name = String.fromCharCode(...new Uint16Array(c.slice(22, 22 + nameLen * 2).buffer));
          if (name.toLowerCase() === "startup.tjs") {
            isStartup = true;
            sub.push(chunk("info", infoBody(cv.getUint32(0, true), u64(cv, 4), u64(cv, 12), "startup_game.tjs")));
          } else {
            sub.push(body.subarray(p, p + 12 + l));
          }
        } else {
          sub.push(body.subarray(p, p + 12 + l));
        }
        p += 12 + l;
      }
      if (isStartup) {
        renamed = true;
        parts.push(chunk("File", concat(sub)));
      } else {
        parts.push(whole);
      }
    }
    if (!renamed) return null;

    // Our startup.tjs, stored raw right after the original bytes.
    const scriptAt = file.size;
    const segm = new Uint8Array(28);
    const sv = new DataView(segm.buffer);
    sv.setUint32(0, 0, true);
    sv.setBigUint64(4, BigInt(scriptAt), true);
    sv.setBigUint64(12, BigInt(script.length), true);
    sv.setBigUint64(20, BigInt(script.length), true);
    let a = 1, b = 0;
    for (const byte of script) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    const adlr = new Uint8Array(4);
    new DataView(adlr.buffer).setUint32(0, ((b << 16) | a) >>> 0, true);
    parts.push(chunk("File", concat([
      chunk("info", infoBody(0, script.length, script.length, "startup.tjs")),
      chunk("segm", segm),
      chunk("adlr", adlr),
    ])));
    const newIndex = concat(parts);
    const indexHead = new Uint8Array(9);
    new DataView(indexHead.buffer).setBigUint64(1, BigInt(newIndex.length), true);

    const newHead = head.slice();
    new DataView(newHead.buffer).setBigUint64(pointerAt, BigInt(scriptAt + script.length), true);
    return new Blob([newHead, file.slice(0x28), script, indexHead, newIndex]);
  }

  let started = false;

  window.KrKrInstallAndBoot = async function (root, fileList) {
    try {
      if (started) return;
      started = true;

      const files = [...(fileList || [])];
      if (files.length === 0) throw new Error("No files were staged.");

      if (!self.crossOriginIsolated) {
        throw new Error("This page is not cross-origin isolated, so the engine's " +
          "threads are unavailable. Serve it with serve-local.mjs.");
      }

      status("preparing...");
      if (typeof vlfsReady !== "undefined") await vlfsReady;
      await selectSpace(saveSpaceName(root));

      // Paths are relative to the picked folder, the way upstream's own
      // folder handler does it.
      const prefix = files[0].webkitRelativePath
        ? "/" + files[0].webkitRelativePath.split("/")[0]
        : "";
      const archives = [];
      const staged = [];

      for (let i = 0; i < files.length; i++) {
        const relative = files[i].webkitRelativePath || files[i].name;
        const path = ("/" + relative).substring(prefix.length) || "/" + files[i].name;
        if (IGNORED.test(path)) continue;

        VLFS.registerBlobFile(path, files[i]);
        staged.push(path);
        if (path.toLowerCase().endsWith(".xp3")) archives.push(path);

        if (i % 200 === 0 || i === files.length - 1) {
          status(`indexing ${i + 1} of ${files.length} files...`);
        }
      }

      if (archives.length === 0) {
        throw new Error("No .xp3 archives here. Pick the folder holding the game's " +
          "data.xp3 (the one with the .exe in it).");
      }

      const gameStartup = startupArchive(archives);
      if (archives.length > 1) Module._startupXp3Path = gameStartup;
      try {
        const original = files.find((f) =>
          ("/" + (f.webkitRelativePath || f.name)).substring(prefix.length) === gameStartup);
        const patched = original && await withPrelude(original, staged);
        if (patched) VLFS.registerBlobFile(gameStartup, patched);
      } catch (error) {
        console.warn("noberu: starting without the KIRIKIROID prelude", error);
      }

      post("booting", { archives: archives.length });
      status("starting the engine...");
      startGame();

      // The engine paints its first frame a while after startGame() returns;
      // the canvas getting a size is the first sign it is really up.
      const canvas = document.getElementById("canvas");
      const began = Date.now();
      while (Date.now() - began < 120000) {
        if (canvas && canvas.width > 1 && canvas.height > 1) {
          post("running", { width: canvas.width, height: canvas.height });
          canvas.focus();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      post("error", { message: "The engine did not start within two minutes." });
    } catch (error) {
      console.error(error);
      post("error", { message: String((error && error.message) || error) });
    }
  };

  // Upstream shows its own picker and overlay; the tab drives everything, so
  // they stay out of the way until something goes wrong.
  document.documentElement.classList.add("krkr2-autoload");

  // Enter never reaches the game. The web build's SDL table turns Return into
  // cocos KEY_ENTER, and CCKeyCodeConv maps KEY_ENTER to 0 (only KEY_KP_ENTER
  // becomes VK_RETURN, and SDL never produces that), so the key is dropped.
  // KAG and the games built on it treat VK_RETURN and VK_SPACE alike - advance
  // text, press the focused button - so Enter is sent on as Space. That keeps
  // Enter working like it does in every other engine, which is also what the
  // touch pad's and a controller's A button send. A window capture listener
  // added now runs before the engine's own key handlers.
  for (const type of ["keydown", "keyup", "keypress"]) {
    window.addEventListener(type, (event) => {
      if (event.key !== "Enter" || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (type === "keypress") return;
      const space = new KeyboardEvent(type, {
        key: " ",
        code: "Space",
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      Object.defineProperty(space, "keyCode", { get: () => 32 });
      Object.defineProperty(space, "which", { get: () => 32 });
      event.target.dispatchEvent(space);
    }, true);
  }

  // Upstream's error button is "Force Update & Reload": it deletes every
  // Cache Storage entry on the origin, which here is the whole site, other
  // runtimes included. Inside noberu it just reloads the frame. A capture
  // listener on the window runs before upstream's handler on the button.
  const errorTitle = document.querySelector("#error-box h2");
  const errorButton = document.getElementById("error-update-btn");
  if (errorTitle) errorTitle.textContent = "Couldn't start the game";
  if (errorButton) errorButton.textContent = "Reload";
  window.addEventListener("click", (event) => {
    if (!errorButton || event.target !== errorButton) return;
    event.stopImmediatePropagation();
    location.reload();
  }, true);
})();
