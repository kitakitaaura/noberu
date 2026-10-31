// Decoded sounds for Ren'Py games staged by noberu: one copy of each, given
// back as soon as Ren'Py is done with it.
//
// Ren'Py's web audio (renpy/common/_audio.js) decodes a whole track every
// time it is queued, unless the same file is already loaded on that channel:
// ~50 MB for a 2.5-minute song. A looping track is queued again each time
// round, so a channel whose sound ends early (iOS interrupts a page's audio)
// or loses its track between queues decodes the song again and again, and
// the copies pile up faster than they are collected. An iPhone playing Katawa
// Shoujo reached 673 MB of decoded audio in a minute and Safari killed the
// tab.
//
// So decodeAudioData hands back the buffer it already made for the same
// bytes while that buffer is still alive (held through a WeakRef, so this
// keeps nothing alive itself), and a decode of bytes already being decoded
// waits for that one. Both runtime pages load this before the engine.
//
// iOS starts a page's audio only from a tap, and Ren'Py resumes its context
// from its main loop, never from one; so any tap or key resumes it here.
//
// After that card, the next one (30 decoded, 3 reused, 779 MB) still could not
// be reproduced in Chrome or WebKit, so each decode is also noted by the name
// Ren'Py queued it under, with the audio's state then, for the crash card.
//
// The card after that (961 MB, 36 decoded, 6 reused: door sounds, bells, songs,
// none more than twice) showed the real cause: Ren'Py drops each sound when it
// is done, but Safari's collector can leave the dropped buffers uncollected for
// minutes, and KSRE plays some 30 sounds in its first minutes. So once no
// channel has a sound Ren'Py decoded playing or queued, and every source that
// played it has ended, it is let go of at once:
// - where the browser allows it (Chrome), its sample data is transferred to a
//   closed MessageChannel port, which frees it there and then;
// - WebKit refuses that for a buffer once it has been given to a source ("its
//   backing store has been accessed by the JavaScriptCore C API"). Worse, it
//   keeps every source that ever had an onended handler alive for good, and
//   Ren'Py gives each one, so the sources it made and never started (the next
//   loop of a song, a queued track) held their songs forever: every song
//   decoded stayed in memory, through the source's buffer and through its
//   onended handler, which _audio.js makes inside renpyAudio.queue() and so
//   keeps that call's queue entry (and its buffer) reachable. So each source
//   given the buffer has its onended handler and buffer cleared
//   (pw/audio-unstarted-leak.mjs: 6 of 6 songs kept, 0 of 6 once nulled;
//   pw/audio-renpy-js.mjs drives the real _audio.js), and the collector is nudged, once a second while such a buffer is alive, by
//   allocating and dropping a 256 MB ArrayBuffer: counted as memory, but never
//   written, so it costs no footprint. Ten dropped songs in WebKit: footprint
//   170 -> 70 MB after four nudges, 71 -> 20 MB after one of 256 MB; waiting
//   6 s freed nothing.
// Ren'Py's channels come from renpyAudio.noberuChannels(), which
// noberu_patches.py appends to _audio.js; without it nothing is let go of.
//
//   NoberuAudio.stats()   { decoded, reused, released, collected, held, waiting, decodes: [[name, times], ...], audioState }
(function (global) {
  "use strict";

  const alive = new Map(); // key -> WeakRef(AudioBuffer)
  const pending = new Map(); // key -> Promise(AudioBuffer)
  const stats = { decoded: 0, reused: 0, released: 0, collected: 0 };
  const names = new Map(); // name Ren'Py queued -> times decoded
  let queuing = null; // the name being queued while renpyAudio.queue runs
  const keys = new WeakMap(); // AudioBuffer -> its key in `alive`
  const queued = new Set(); // WeakRef(AudioBuffer) of each decode made for renpyAudio.queue
  const playing = new WeakMap(); // AudioBuffer -> sources started and not yet ended
  // Buffers Ren'Py is done with that are left to the collector: token -> nudges so far. Watched
  // through a FinalizationRegistry, not WeakRefs: a deref keeps the buffer alive to the end of the
  // task, and the collection a nudge sets off then could not take it.
  const dropped = new Map();
  const collected = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((token) => {
      dropped.delete(token);
      stats.collected++;
    })
    : null;

  const hook = setInterval(() => {
    const audio = global.renpyAudio;
    if (!audio || typeof audio.queue !== "function") return;
    clearInterval(hook);
    const queue = audio.queue;
    audio.queue = function (channel, file, name) {
      queuing = String(name || file).split("/").pop();
      try {
        return queue.apply(this, arguments);
      } finally {
        queuing = null;
      }
    };
  }, 200);

  function unlock() {
    const context = global.renpyAudio && global.renpyAudio.context;
    if (context && context.state !== "running" && context.state !== "closed") {
      context.resume().catch(() => {});
    }
  }
  for (const type of ["touchend", "pointerup", "click", "keydown"]) {
    global.addEventListener(type, unlock, true);
  }

  // The bytes' identity: length plus a hash of the first and last 64 KB.
  function key(data) {
    const bytes = new Uint8Array(data);
    const n = bytes.length;
    let h = 0x811c9dc5;
    const take = (from, to) => {
      for (let i = from; i < to; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
    };
    take(0, Math.min(n, 65536));
    take(Math.max(65536, n - 65536), n);
    return n + ":" + (h >>> 0).toString(16);
  }

  function forget() {
    for (const [k, ref] of alive) if (!ref.deref()) alive.delete(k);
  }

  const sources = new WeakMap(); // AudioBuffer -> WeakRefs of the sources given it
  const Source = global.AudioBufferSourceNode && global.AudioBufferSourceNode.prototype;
  const bufferProperty = Source && Object.getOwnPropertyDescriptor(Source, "buffer");
  if (bufferProperty && bufferProperty.set) {
    Object.defineProperty(Source, "buffer", Object.assign({}, bufferProperty, {
      set(value) {
        bufferProperty.set.call(this, value);
        if (value) {
          let list = sources.get(value);
          if (!list) sources.set(value, (list = []));
          list.push(new WeakRef(this));
        }
      },
    }));
  }
  if (Source && Source.start) {
    const start = Source.start;
    Source.start = function () {
      const result = start.apply(this, arguments);
      const buffer = this.buffer;
      if (buffer) {
        playing.set(buffer, (playing.get(buffer) || 0) + 1);
        this.addEventListener("ended", () => playing.set(buffer, playing.get(buffer) - 1), { once: true });
      }
      return result;
    };
  }

  // Every buffer a Ren'Py channel is playing or has queued, or null when the
  // channels can't be seen.
  function inUse() {
    const audio = global.renpyAudio;
    if (!audio || typeof audio.noberuChannels !== "function") return null;
    const used = new Set();
    for (const c of Object.values(audio.noberuChannels() || {})) {
      for (const q of [c.playing, c.queued]) {
        if (!q) continue;
        if (q.buffer) used.add(q.buffer);
        if (q.source && q.source.buffer) used.add(q.source.buffer);
      }
    }
    return used;
  }

  // Frees the buffer's sample data now, if the browser lets it.
  function detach(buffer) {
    const sink = new MessageChannel();
    sink.port2.close();
    try {
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        sink.port1.postMessage(null, [buffer.getChannelData(c).buffer]);
      }
      return true;
    } catch (error) {
      return false;
    } finally {
      sink.port1.close();
    }
  }

  function release() {
    const used = queued.size ? inUse() : null;
    if (used) {
      for (const ref of queued) {
        const buffer = ref.deref();
        if (buffer && (used.has(buffer) || playing.get(buffer) > 0)) continue;
        queued.delete(ref);
        if (!buffer) continue;
        if (keys.has(buffer)) alive.delete(keys.get(buffer));
        // WebKit keeps every source that ever had an onended handler alive for
        // good, and Ren'Py gives each one; the ones it never started (the next
        // loop of a song, a queued track) would hold the song forever.
        for (const ref of sources.get(buffer) || []) {
          const source = ref.deref();
          if (source && source.buffer === buffer) {
            // Its handler was made inside renpyAudio.queue() and keeps that
            // call's queue entry, and so the song, reachable too.
            source.onended = null;
            try {
              source.buffer = null;
            } catch (error) {
              // Can't happen per spec; the collector may still get it.
            }
          }
        }
        sources.delete(buffer);
        if (detach(buffer)) {
          stats.released++;
          if (global.NoberuCrashAudio) global.NoberuCrashAudio.released(buffer);
        } else if (collected) {
          const token = {};
          dropped.set(token, 0);
          collected.register(buffer, token);
        }
      }
    }
    // Not while a movie plays: on an iPhone it already has the phone busy
    // (software VP9 at 1080p), and its sound crackled.
    if (!dropped.size || moviePlaying()) return;
    for (const [token, nudges] of dropped) {
      if (nudges >= 30) dropped.delete(token); // something else still holds it
      else dropped.set(token, nudges + 1);
    }
    // In a task of its own, after this one's derefs have let go.
    setTimeout(nudge, 0);
  }

  function moviePlaying() {
    const audio = global.renpyAudio;
    const channels = audio && typeof audio.noberuChannels === "function" ? audio.noberuChannels() : null;
    return !!channels && Object.values(channels).some((c) => c.video && c.playing);
  }

  function nudge() {
    try {
      let memory = new ArrayBuffer(256 * 1024 * 1024);
      memory = null;
    } catch (error) {
      // No room even for an untouched 256 MB: nothing to do but wait.
    }
  }
  setInterval(release, 1000);

  for (const C of [global.AudioContext, global.webkitAudioContext]) {
    if (!C || !C.prototype.decodeAudioData || typeof WeakRef !== "function") continue;
    const decode = C.prototype.decodeAudioData;
    C.prototype.decodeAudioData = function (data, done, failed) {
      let k = null;
      try {
        k = key(data);
      } catch (error) {
        // Not something we can read; decode it as given.
      }
      const kept = k && alive.has(k) ? alive.get(k).deref() : null;
      let result;
      if (kept) {
        stats.reused++;
        result = Promise.resolve(kept);
      } else if (k && pending.has(k)) {
        stats.reused++;
        result = pending.get(k);
      } else {
        stats.decoded++;
        const name = queuing || "?";
        names.set(name, (names.get(name) || 0) + 1);
        result = decode.call(this, data);
        const forRenPy = queuing !== null;
        result.then((buffer) => {
          if (forRenPy) queued.add(new WeakRef(buffer));
          if (!k) return;
          pending.delete(k);
          if (alive.size > 64) forget();
          alive.set(k, new WeakRef(buffer));
          keys.set(buffer, k);
        }, () => { if (k) pending.delete(k); });
        if (k) pending.set(k, result);
      }
      if (typeof done === "function" || typeof failed === "function") {
        result.then(
          (buffer) => { if (typeof done === "function") done(buffer); },
          (error) => { if (typeof failed === "function") failed(error); });
      }
      return result;
    };
  }

  global.NoberuAudio = {
    stats: () => {
      const context = global.renpyAudio && global.renpyAudio.context;
      return Object.assign({}, stats, {
        decodes: [...names].sort((a, b) => b[1] - a[1]).slice(0, 6),
        audioState: context ? context.state : null,
        held: [...queued].filter((ref) => ref.deref()).length,
        waiting: dropped.size,
      });
    },
  };
})(window);
