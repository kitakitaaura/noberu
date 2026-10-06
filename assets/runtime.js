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
