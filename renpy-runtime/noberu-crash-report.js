// What a Ren'Py game looked like just before its page died.
//
// A phone browser that runs out of memory kills the tab and loads it again
// without a word, so nobody can tell why a game "just reloaded". While a game
// runs, this keeps a few numbers in localStorage every second: the wasm heap
// (and each time it grew), the GL textures and decoded audio alive (and their
// peaks), stage.js's block cache, the last line of dialogue and the browser;
// growth counts from the game's first frame, since
// loading itself grows the heap. A page that closes normally marks the record
// closed (pagehide). If the next boot finds it still open, the game ended
// some other way, and a card at the top of the frame says what things looked
// like then, until it is closed.
//
//   NoberuCrashReport.start(name)   when a game boots (both runtime pages)
//   NoberuCrashReport.running()     at its first frame
(function (global) {
  "use strict";

  const KEY = "noberu.renpy.lastRun";
  const WEEK = 7 * 24 * 3600 * 1000;

  let previous = null;
  try {
    previous = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (error) {
    previous = null;
  }

  // GL textures alive, by what was uploaded into them (level 0 only).
  const textures = new Map();
  let textureBytes = 0;
  let bound = null;
  function sized(texture, bytes) {
    if (!texture) return;
    textureBytes += bytes - (textures.get(texture) || 0);
    textures.set(texture, bytes);
  }
  for (const C of [global.WebGL2RenderingContext, global.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    const bindTexture = P.bindTexture;
    P.bindTexture = function (target, texture) {
      bound = texture;
      return bindTexture.apply(this, arguments);
    };
    const deleteTexture = P.deleteTexture;
    P.deleteTexture = function (texture) {
      if (textures.has(texture)) {
        textureBytes -= textures.get(texture);
        textures.delete(texture);
      }
      return deleteTexture.apply(this, arguments);
    };
    const texImage2D = P.texImage2D;
    P.texImage2D = function (target, level) {
      if (level === 0) {
        if (arguments.length >= 9) {
          sized(bound, arguments[3] * arguments[4] * 4);
        } else {
          const source = arguments[5];
          const w = source && (source.videoWidth || source.width);
          const h = source && (source.videoHeight || source.height);
          if (w && h) sized(bound, w * h * 4);
        }
      }
      return texImage2D.apply(this, arguments);
    };
    const copyTexImage2D = P.copyTexImage2D;
    P.copyTexImage2D = function (target, level, format, x, y, w, h) {
      if (level === 0) sized(bound, w * h * 4);
      return copyTexImage2D.apply(this, arguments);
    };
  }

  // Decoded audio alive (Ren'Py's web audio decodes each track whole: ~50 MB
  // a song), dropped as the browser collects each AudioBuffer.
  let audioBytes = 0;
  const audioGone = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((bytes) => { audioBytes -= bytes; })
    : null;
  for (const C of [global.AudioContext, global.webkitAudioContext]) {
    if (!C || !C.prototype.decodeAudioData) continue;
    const decode = C.prototype.decodeAudioData;
    C.prototype.decodeAudioData = function (data, done, failed) {
      const counted = (buffer) => {
        if (buffer && audioGone) {
          const bytes = buffer.length * buffer.numberOfChannels * 4;
          audioBytes += bytes;
          audioGone.register(buffer, bytes);
        }
        return buffer;
      };
      const wrapped = typeof done === "function" ? (buffer) => done(counted(buffer)) : done;
      const result = decode.call(this, data, wrapped, failed);
      return result && typeof done !== "function" ? result.then(counted) : result;
    };
  }

  // "iPhone; CPU iPhone OS 18_6 like Mac OS X · Version/18.6", for the card.
  function browser() {
    const ua = navigator.userAgent || "";
    const platform = (ua.match(/\(([^)]+)\)/) || [])[1] || "";
    const name = (ua.match(/(CriOS|FxiOS|EdgiOS|EdgA|SamsungBrowser|Firefox|Chrome|Version)\/[\d.]+/) || [])[0] || "";
    const memory = navigator.deviceMemory ? ` · ${navigator.deviceMemory} GB` : "";
    return [platform, name].filter(Boolean).join(" · ") + memory;
  }

  const mb = (bytes) => Math.round(bytes / (1024 * 1024));

  function wasmBytes() {
    const heap = global.HEAPU8 || (global.Module && global.Module.HEAPU8);
    if (heap) return heap.length;
    const memory = global.wasmMemory || (global.Module && global.Module.wasmMemory);
    return memory ? memory.buffer.byteLength : 0;
  }

  let run = null;
  let lastLine = "";

  // The text hook hands each line to window.NoberuSayB64 (noberu-text-hook.js).
  function watchLines() {
    const say = global.NoberuSayB64;
    if (typeof say !== "function" || say.__noberuCrash) return;
    const wrapped = function (b64) {
      try {
        const data = JSON.parse(atob(b64));
        lastLine = ((data.name ? data.name + ": " : "") + (data.text || "")).slice(0, 120);
      } catch (error) {
        // Not a line we can read; keep the previous one.
      }
      return say.apply(this, arguments);
    };
    wrapped.__noberuCrash = true;
    global.NoberuSayB64 = wrapped;
  }

  function save() {
    if (!run) return;
    watchLines();
    const wasm = mb(wasmBytes());
    if (wasm && wasm !== run.wasmMB) {
      if (run.wasmMB && run.running) {
        run.growth.push([Math.round((Date.now() - run.started) / 60000), wasm, lastLine.slice(0, 60)]);
        run.growth = run.growth.slice(-6);
      }
      run.wasmMB = wasm;
    }
    run.at = Date.now();
    run.textureMB = mb(textureBytes);
    run.textures = textures.size;
    run.audioMB = mb(audioBytes);
    if (global.NoberuAudio) Object.assign(run, global.NoberuAudio.stats());
    run.peakTextureMB = Math.max(run.peakTextureMB || 0, run.textureMB);
    run.peakAudioMB = Math.max(run.peakAudioMB || 0, run.audioMB);
    const stage = global.NoberuRenPyStage;
    run.fileCacheMB = stage && stage.lazyStats ? stage.lazyStats().cachedMB : null;
    if (global.performance && performance.memory) run.jsMB = mb(performance.memory.usedJSHeapSize);
    run.line = lastLine;
    try {
      localStorage.setItem(KEY, JSON.stringify(run));
    } catch (error) {
      // Storage full or blocked: nothing to report next time, that's all.
    }
  }

  function start(name) {
    if (run) return;
    showPrevious();
    run = {
      game: String(name || "the game"),
      open: true,
      started: Date.now(),
      touch: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
      browser: browser(),
      growth: [],
    };
    save();
    setInterval(save, 1000);
    global.addEventListener("pagehide", () => {
      run.open = false;
      save();
    });
    document.addEventListener("visibilitychange", () => {
      run.hidden = document.visibilityState === "hidden";
      save();
    });
  }

  function showPrevious() {
    const p = previous;
    if (!p || !p.open || !p.at || Date.now() - p.at > WEEK) return;
    const minutes = Math.max(1, Math.round((p.at - p.started) / 60000));
    const details = [
      `wasm ${p.wasmMB} MB`,
      `textures ${p.textureMB} MB (${p.textures})` + (p.peakTextureMB > p.textureMB ? `, peak ${p.peakTextureMB}` : ""),
      p.audioMB != null ? `audio ${p.audioMB} MB` + (p.peakAudioMB > p.audioMB ? `, peak ${p.peakAudioMB}` : "") +
        (p.decoded != null ? ` (${p.decoded} decoded, ${p.reused} reused)` : "") : null,
      p.decodes && p.decodes.length ? "decoded " + p.decodes.map((d) => `${d[0]} ×${d[1]}`).join(", ") : null,
      p.audioState && p.audioState !== "running" ? `sound ${p.audioState}` : null,
      p.fileCacheMB != null ? `file cache ${p.fileCacheMB} MB` : null,
      p.jsMB != null ? `js ${p.jsMB} MB` : null,
      p.hidden ? "in the background" : null,
    ].filter(Boolean).join(" · ");
    const growth = (p.growth || []).map((g) => `${g[0]} min: ${g[1]} MB${g[2] ? ` ("${g[2]}")` : ""}`).join("; ");

    const card = document.createElement("div");
    card.setAttribute("role", "status");
    card.style.cssText =
      "position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);" +
      "z-index:1001;box-sizing:border-box;width:min(560px,calc(100% - 24px));padding:12px 40px 12px 14px;" +
      "border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(11,11,11,.94);" +
      "color:#8b8b93;font:12px/1.5 'IBM Plex Mono',ui-monospace,Menlo,monospace;text-align:left;";
    const title = document.createElement("div");
    title.style.cssText = "color:#e4e4e4;font-weight:600;margin-bottom:4px;";
    title.textContent = `Last time, ${p.game} closed unexpectedly after ${minutes} min.`;
    const body = document.createElement("div");
    body.textContent =
      "That usually means the browser ran out of memory. Then: " + details +
      (p.line ? `. Last line: "${p.line}"` : "") +
      (growth ? `. Memory grew at ${growth}` : "") + "." +
      (p.browser ? ` (${p.browser})` : "");
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "close");
    close.textContent = "×";
    close.style.cssText =
      "position:absolute;top:6px;right:6px;width:28px;height:28px;border:0;border-radius:8px;" +
      "background:transparent;color:#e4e4e4;font:16px/1 sans-serif;cursor:pointer;";
    close.addEventListener("click", () => card.remove());
    card.append(title, body, close);
    const attach = () => document.body.appendChild(card);
    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach);
    console.warn("[noberu] last run closed unexpectedly:", p);
  }

  function running() {
    if (!run) return;
    run.running = true;
    save();
  }

  global.NoberuCrashReport = { start: start, running: running, previous: () => previous };
})(window);
