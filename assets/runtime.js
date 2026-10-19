// noberu's hooks for every runtime page: the master volume, sharp pixels and
// hiding an idle cursor.
//
// Loaded first in each runtime page (and in index.html, where Play! and the
// arcade run), before any engine code. Nothing engine-specific: it catches
// sound where every engine has to send it, and styles every game canvas.
//
// Master volume:
//
// - Web Audio: each AudioContext gets one GainNode in front of its real
//   speakers, and `destination` hands out that node instead, so everything an
//   engine connects "to the speakers" passes through it. SDL, OpenAL, Howler,
//   kira and Ren'Py's own audio all go this way.
// - <audio>/<video> played straight from the element: the volume an engine
//   sets is kept and the element plays at that times the master volume.
//   Elements routed into an AudioContext are left alone - the gain covers them.
//
// Settings live in localStorage (written by assets/settings.js), so a change
// reaches a runtime frame through the `storage` event, and the page that made
// it through `noberu-settings`.

(function () {
  "use strict";

  if (window.NoberuVolume) return;

  const KEYS = {
    volume: "noberu.settings.volume",
    mute: "noberu.settings.mute",
    background: "noberu.settings.muteInBackground",
    sharp: "noberu.settings.sharp",
    hideCursor: "noberu.settings.hideCursor",
  };

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  // 0..1, what every sound is multiplied by right now.
  function level() {
    if (read(KEYS.mute, "0") === "1") return 0;
    if (read(KEYS.background, "1") === "1" && document.hidden) return 0;
    const volume = Number(read(KEYS.volume, "100"));
    if (!Number.isFinite(volume)) return 1;
    return Math.min(1, Math.max(0, volume / 100));
  }

  // --- Web Audio --------------------------------------------------------------

  const gains = [];

  const destinationGetter = (() => {
    const base = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
    const descriptor = base && Object.getOwnPropertyDescriptor(base.prototype, "destination");
    return descriptor && descriptor.get;
  })();

  function attach(context) {
    if (!destinationGetter) return;
    try {
      const speakers = destinationGetter.call(context);
      const gain = context.createGain();
      gain.gain.value = level();
      gain.connect(speakers);
      // Read off the destination by some engines when they size buffers.
      for (const name of ["maxChannelCount"]) {
        Object.defineProperty(gain, name, { get: () => speakers[name] });
      }
      Object.defineProperty(context, "destination", { get: () => gain, configurable: true });
      gains.push(new WeakRef(gain));
    } catch (error) {
      // An engine's sound matters more than its volume knob.
      console.warn("noberu: master volume unavailable for this audio", error);
    }
  }

  function wrap(name) {
    const Real = window[name];
    if (typeof Real !== "function") return;
    function Wrapped(...args) {
      const context = new Real(...args);
      attach(context);
      return context;
    }
    Wrapped.prototype = Real.prototype;
    Object.setPrototypeOf(Wrapped, Real);
    window[name] = Wrapped;
  }

  wrap("AudioContext");
  wrap("webkitAudioContext");

  // --- media elements ---------------------------------------------------------

  const volumeProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  const wanted = new WeakMap(); // element -> the volume the engine asked for
  const routed = new WeakSet(); // elements whose sound goes through a context
  const elements = new Set();   // WeakRefs to elements we have seen play

  function applyTo(element) {
    if (routed.has(element)) return;
    const asked = wanted.has(element) ? wanted.get(element) : 1;
    volumeProperty.set.call(element, asked * level());
  }

  if (volumeProperty && volumeProperty.set) {
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      configurable: true,
      enumerable: volumeProperty.enumerable,
      get() {
        return wanted.has(this) ? wanted.get(this) : volumeProperty.get.call(this);
      },
      set(value) {
        wanted.set(this, Number(value));
        if (routed.has(this)) volumeProperty.set.call(this, value);
        else applyTo(this);
      },
    });

    const createSource = window.AudioContext &&
      AudioContext.prototype.createMediaElementSource;
    if (createSource) {
      AudioContext.prototype.createMediaElementSource = function (element) {
        routed.add(element);
        volumeProperty.set.call(element, wanted.has(element) ? wanted.get(element) : 1);
        return createSource.call(this, element);
      };
    }

    // `play` does not bubble, but it can be caught on the way down.
    document.addEventListener("play", (event) => {
      const element = event.target;
      if (!(element instanceof HTMLMediaElement)) return;
      elements.add(new WeakRef(element));
      applyTo(element);
    }, true);
  }

  // --- sharp pixels -------------------------------------------------------------

  // Older games are 640x480 and the browser smooths them as it scales them
  // up, which blurs text and line art. Nearest-neighbour keeps them crisp.
  // Off by default: on an HD game shrunk to fit, it looks jagged instead.
  const sharpStyle = document.createElement("style");
  sharpStyle.textContent =
    'html[data-noberu-sharp] canvas { image-rendering: pixelated !important; }';
  (document.head || document.documentElement).appendChild(sharpStyle);

  function applySharp() {
    if (read(KEYS.sharp, "0") === "1") document.documentElement.dataset.noberuSharp = "";
    else delete document.documentElement.dataset.noberuSharp;
  }
  applySharp();

  // --- hiding an idle cursor ------------------------------------------------------

  // A pointer parked over the text while reading is in the way. After a few
  // seconds without moving it goes, and the next move brings it back. In a
  // runtime frame that is the whole game; on noberu's own page (where Play!
  // runs) only the game's canvas, never the site around it.
  const IDLE_MS = 3000;
  const cursorStyle = document.createElement("style");
  cursorStyle.textContent = window === window.top
    ? "html[data-noberu-idle] .play-frame-wrap.active canvas { cursor: none !important; }"
    : "html[data-noberu-idle], html[data-noberu-idle] * { cursor: none !important; }";
  (document.head || document.documentElement).appendChild(cursorStyle);

  let idleTimer = 0;
  function wake() {
    window.clearTimeout(idleTimer);
    delete document.documentElement.dataset.noberuIdle;
    if (read(KEYS.hideCursor, "1") !== "1") return;
    idleTimer = window.setTimeout(() => {
      document.documentElement.dataset.noberuIdle = "";
    }, IDLE_MS);
  }
  for (const type of ["mousemove", "mousedown", "wheel"]) {
    window.addEventListener(type, wake, { capture: true, passive: true });
  }

  // --- applying changes -------------------------------------------------------

  function refresh() {
    applySharp();
    if (read(KEYS.hideCursor, "1") !== "1") wake();
    const value = level();
    for (const ref of [...gains]) {
      const gain = ref.deref();
      if (!gain) {
        gains.splice(gains.indexOf(ref), 1);
        continue;
      }
      try {
        // A short glide rather than a jump, which clicks.
        gain.gain.setTargetAtTime(value, gain.context.currentTime, 0.015);
      } catch (error) {
        gain.gain.value = value;
      }
    }
    for (const ref of [...elements]) {
      const element = ref.deref();
      if (!element) elements.delete(ref);
      else applyTo(element);
    }
  }

  window.addEventListener("storage", (event) => {
    if (!event.key || Object.values(KEYS).includes(event.key)) refresh();
  });
  window.addEventListener("noberu-settings", refresh);
  document.addEventListener("visibilitychange", refresh);

  window.NoberuVolume = { refresh, level };
})();

// Screenshots (the in-game menu, and the shelf's cover from a game's title
// screen) and an error log (report a problem). Like the rest of this file,
// nothing engine-specific.
//
// Capture: WebGL canvases are cleared once a frame is shown unless the game
// asked to keep them (most don't, and asking costs speed). So the copy is made
// right after the game's own animation-frame callback has drawn, in the same
// task, when the picture is still there. A frame that comes out flat (a fade,
// a cleared buffer) is retried for a few frames.
(function () {
  "use strict";

  if (window.NoberuCapture) return;

  const realRaf = window.requestAnimationFrame && window.requestAnimationFrame.bind(window);
  let waiting = [];

  // A visual novel sits on one still frame for most of its life, and a
  // WebGL canvas that is not redrawn has nothing left to copy. Inside the
  // runtime frames, keep what was drawn (cheap for a game that draws a few
  // times a second). Play! runs on the top page and redraws constantly, so it
  // is left as it is.
  if (window !== window.top && window.HTMLCanvasElement) {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      if (/^(webgl2?|experimental-webgl)$/.test(type)) {
        attributes = { ...(attributes || {}), preserveDrawingBuffer: true };
      }
      return getContext.call(this, type, attributes);
    };
  }

  function biggestCanvas(doc) {
    let best = null;
    let bestArea = 0;
    for (const canvas of doc.querySelectorAll("canvas")) {
      const area = canvas.width * canvas.height;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (area > bestArea) {
        best = canvas;
        bestArea = area;
      }
    }
    return best;
  }

  function flat(ctx, w, h) {
    try {
      const sx = Math.max(1, Math.floor(w / 16));
      const sy = Math.max(1, Math.floor(h / 16));
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let y = 0; y < h; y += sy) {
        for (let x = 0; x < w; x += sx) {
          const i = (y * w + x) * 4;
          const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += l;
          sq += l * l;
          n++;
        }
      }
      const mean = sum / n;
      return sq / n - mean * mean < 40;
    } catch (error) {
      return false;
    }
  }

  // Copies the canvas now; null when it is empty or cannot be read.
  function copyNow(maxWidth) {
    const canvas = biggestCanvas(document);
    if (!canvas || !canvas.width || !canvas.height) return null;
    const scale = Math.min(1, maxWidth / canvas.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = out.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
    } catch (error) {
      return null;
    }
    return flat(ctx, out.width, out.height) ? null : out;
  }

  function settle() {
    if (!waiting.length) return;
    const now = waiting;
    waiting = [];
    for (const job of now) {
      const out = copyNow(job.maxWidth);
      if (out) {
        out.toBlob((blob) => job.resolve(blob), job.type, 0.9);
      } else if (--job.tries > 0) {
        waiting.push(job);
      } else {
        job.resolve(null);
      }
    }
  }

  if (realRaf) {
    window.requestAnimationFrame = function (callback) {
      return realRaf(function (time) {
        callback(time);
        if (waiting.length) settle();
      });
    };
  }

  // Resolves to a Blob (JPEG by default), or null if nothing usable was drawn.
  function grab(maxWidth = 1280, type = "image/jpeg") {
    return new Promise((resolve) => {
      const job = { maxWidth, type, tries: 12, resolve };
      // A 2D canvas, or a game drawing outside animation frames: try at once.
      const direct = copyNow(maxWidth);
      if (direct) {
        direct.toBlob((blob) => resolve(blob), type, 0.9);
        return;
      }
      waiting.push(job);
      // No animation frame in a while (a paused or timer-driven game).
      setTimeout(() => {
        const index = waiting.indexOf(job);
        if (index < 0) return;
        waiting.splice(index, 1);
        resolve(null);
      }, 1500);
    });
  }

  window.NoberuCapture = { grab };

  // --- error log -----------------------------------------------------------------

  // Kept on the top page (assets/report.js), so a report has what every frame
  // said. A frame that is not noberu's keeps its own.
  const MAX = 120;
  function sink() {
    try {
      if (window.top !== window && window.top.NoberuLog) return window.top.NoberuLog;
    } catch (error) { /* another origin */ }
    if (!window.NoberuLog) {
      const lines = [];
      window.NoberuLog = {
        lines,
        add(entry) {
          lines.push(entry);
          if (lines.length > MAX) lines.splice(0, lines.length - MAX);
        },
      };
    }
    return window.NoberuLog;
  }

  const where = (location.pathname.split("/").filter(Boolean)[0] || "noberu").replace(/-runtime$/, "");

  function add(level, parts) {
    try {
      const text = parts.map((part) => {
        if (part instanceof Error) return `${part.name}: ${part.message}`;
        if (typeof part === "string") return part;
        try {
          return JSON.stringify(part);
        } catch (error) {
          return String(part);
        }
      }).join(" ").slice(0, 600);
      sink().add({ t: Date.now(), level, where, text });
    } catch (error) { /* never let logging break a game */ }
  }

  for (const level of ["error", "warn"]) {
    const real = console[level];
    if (typeof real !== "function") continue;
    console[level] = function (...args) {
      add(level, args);
      return real.apply(this, args);
    };
  }
  window.addEventListener("error", (event) => {
    add("error", [event.message || "error", event.filename ? `(${event.filename.split("/").pop()}:${event.lineno})` : ""]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    add("error", ["unhandled:", event.reason]);
  });
})();

// ` opens the noberu menu (assets/menu.js). A key pressed in a game stays in
// the game's document, so each runtime page passes this one up. Caught on the
// way down, before the engine sees it.
(function () {
  "use strict";
  if (window === window.top) return;
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Backquote" || event.ctrlKey || event.metaKey || event.altKey) return;
    try {
      if (!window.top.NoberuMenu) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) window.top.NoberuMenu.fromFrame(window);
    } catch (error) { /* another origin: the game keeps the key */ }
  }, true);
  window.addEventListener("keyup", (event) => {
    if (event.code !== "Backquote") return;
    try {
      if (window.top.NoberuMenu) event.stopImmediatePropagation();
    } catch (error) { /* another origin */ }
  }, true);
})();

// Reading tools (assets/text.js): an engine that knows its own text hands each
// line to NoberuSay, and it goes up to the top page. NoberuSayB64 is for
// engines that can only pass a string through (Ren'Py's Python): base64 of
// UTF-8 JSON. Script engines (TyranoScript, RPG Maker) are hooked from
// text-hooks.js, which this loads beside itself.
(function () {
  "use strict";
  if (window.NoberuSay) return;

  window.NoberuSay = function (line) {
    try {
      if (window.top.NoberuText) window.top.NoberuText.push({ ...line, from: window });
    } catch (error) { /* another origin */ }
  };

  window.NoberuSayB64 = function (b64) {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.NoberuSay(JSON.parse(new TextDecoder("utf-8").decode(bytes)));
    } catch (error) { /* a malformed line is not worth a game */ }
  };

  // Engines that can only print (KiriKiri's TJS through Debug.message, VNDS's
  // Lua through print) mark a line "@@noberu<TAB>name<TAB>text", with
  // newlines written as \n. Taken out of the console here, before any engine
  // binds console.log for itself.
  const MARK = /@@noberu\t([^\t]*)\t(.*)$/;
  const log = console.log;
  console.log = function (...args) {
    if (typeof args[0] === "string" && args[0].indexOf("@@noberu\t") >= 0) {
      const match = MARK.exec(args.join(" "));
      if (match) {
        // A name of "@choice" marks a menu's choices.
        const choice = match[1] === "@choice";
        window.NoberuSay({ name: choice ? "" : match[1], text: match[2].replace(/\\n/g, "\n"), kind: choice ? "choice" : "line" });
        return undefined;
      }
    }
    return log.apply(this, args);
  };

  if (window === window.top) return;
  const me = document.currentScript && document.currentScript.src;
  if (!me) return;
  const script = document.createElement("script");
  script.src = new URL("text-hooks.js", me).href;
  script.async = true;
  (document.head || document.documentElement).appendChild(script);
})();
