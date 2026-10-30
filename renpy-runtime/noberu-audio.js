// One decoded copy of each sound for Ren'Py games staged by noberu.
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
//   NoberuAudio.stats()   { decoded, reused }
(function (global) {
  "use strict";

  const alive = new Map(); // key -> WeakRef(AudioBuffer)
  const pending = new Map(); // key -> Promise(AudioBuffer)
  const stats = { decoded: 0, reused: 0 };

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
        result = decode.call(this, data);
        if (k) {
          pending.set(k, result);
          result.then((buffer) => {
            pending.delete(k);
            if (alive.size > 64) forget();
            alive.set(k, new WeakRef(buffer));
          }, () => pending.delete(k));
        }
      }
      if (typeof done === "function" || typeof failed === "function") {
        result.then(
          (buffer) => { if (typeof done === "function") done(buffer); },
          (error) => { if (typeof failed === "function") failed(error); });
      }
      return result;
    };
  }

  global.NoberuAudio = { stats: () => Object.assign({}, stats) };
})(window);
