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
// before the engine. Its methods are wrapped as _audio.js assigns them: a game
// can queue a movie straight away (KSRE's studio logo, once its adult-content
// question has been answered), too soon for anything that polls.
(function () {
  "use strict";

  const TYPES = { webm: "video/webm", ogv: "video/ogg", ogg: "video/ogg", mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska" };

  // Calls `make(fn)` for whatever function gets assigned to audio[name],
  // now or later, and stores that instead.
  function intercept(audio, name, make) {
    let current = typeof audio[name] === "function" ? make(audio[name]) : audio[name];
    Object.defineProperty(audio, name, {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value) => { current = typeof value === "function" ? make(value) : value; },
    });
  }

  function wrap(audio) {
    if (!audio || typeof audio !== "object" || audio.__noberuVideo) return;
    audio.__noberuVideo = true;
    const video = new Set();  // channels set to play video
    const urls = new Map();   // channel -> the blob: URL it is playing

    intercept(audio, "set_video", (setVideo) => function (channel, isVideo) {
      if (isVideo) video.add(channel);
      else video.delete(channel);
      return setVideo.apply(this, arguments);
    });

    intercept(audio, "queue", (queue) => function (channel, file, name) {
      const args = [...arguments];
      if (video.has(channel) && typeof file === "string" && !file.startsWith("url:")) {
        try {
          const fs = (window.Module && window.Module.FS) || window.FS;
          // A big loose movie is still the picked File (stage.js reads those
          // as needed), so the player can have it as is.
          const picked = window.NoberuRenPyStage && window.NoberuRenPyStage.fileAt(fs, file);
          const data = picked || fs.readFile(file);
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
    });
  }

  // _audio.js runs `renpyAudio = {}` (a global) before adding its methods.
  let audio = window.renpyAudio;
  wrap(audio);
  Object.defineProperty(window, "renpyAudio", {
    configurable: true,
    get: () => audio,
    set: (value) => {
      audio = value;
      wrap(value);
    },
  });
})();
