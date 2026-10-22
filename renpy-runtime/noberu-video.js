// Movies for Ren'Py games staged by noberu.
//
// Ren'Py's web audio (renpy/common/_audio.js, window.renpyAudio) plays a
// video only from a "url:..." it can hand a <video> element; a file in the
// engine's own filesystem throws "Videos must not be stored in game.zip.", and
// the game stops there. noberu writes every game into that filesystem (and
// noberu_patches.py copies archived media out to a file of its own), so every
// movie hit it - Katawa Shoujo's opening right after its first menu.
//
// So a video channel's file is read out of the filesystem into a Blob, and
// the player is handed a blob: URL for it. Both runtime pages load this
// before the engine; it waits for renpyAudio to appear, then wraps it once.
(function () {
  "use strict";

  const TYPES = { webm: "video/webm", ogv: "video/ogg", ogg: "video/ogg", mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska" };

  function wrap(audio) {
    if (audio.__noberuVideo) return;
    audio.__noberuVideo = true;
    const video = new Set();  // channels set to play video
    const urls = new Map();   // channel -> the blob: URL it is playing

    const setVideo = audio.set_video;
    audio.set_video = function (channel, isVideo) {
      if (isVideo) video.add(channel);
      else video.delete(channel);
      return setVideo.apply(this, arguments);
    };

    const queue = audio.queue;
    audio.queue = function (channel, file, name) {
      const args = [...arguments];
      if (video.has(channel) && typeof file === "string" && !file.startsWith("url:")) {
        try {
          const fs = (window.Module && window.Module.FS) || window.FS;
          const data = fs.readFile(file);
          const ext = String(name || file).split(".").pop().toLowerCase();
          const url = URL.createObjectURL(new Blob([data], TYPES[ext] ? { type: TYPES[ext] } : {}));
          if (urls.has(channel)) URL.revokeObjectURL(urls.get(channel));
          urls.set(channel, url);
          args[1] = "url:" + url;
        } catch (error) {
          console.warn("[noberu] could not hand the video to the player", file, error);
        }
      }
      return queue.apply(this, args);
    };
  }

  const started = Date.now();
  const timer = setInterval(() => {
    if (window.renpyAudio && typeof window.renpyAudio.queue === "function") {
      clearInterval(timer);
      wrap(window.renpyAudio);
    } else if (Date.now() - started > 600000) {
      clearInterval(timer);
    }
  }, 200);
})();
