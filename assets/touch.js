/**
 * noberu on touch devices: when a game starts it takes the whole screen, and
 * transparent on-screen keys sit over it.
 *
 * Visual novel runtimes get a d-pad, enter, esc, ctrl (a latch, for skipping)
 * and a right click. The PS2 runtime gets a PS2 pad instead: d-pad, the four
 * face buttons, L1/L2/R1/R2, select and start.
 *
 * The keys are real DOM keyboard events, dispatched into the game's own
 * document by assets/input.js. Nothing about the runtimes changes: a key from
 * here and a key from a keyboard look the same to them.
 *
 * On touch devices (index.html sets :root[data-touch="1"]) a starting game
 * goes full screen with the pad over it. Anywhere else the pad is only built
 * when a game is made fullscreen, and mobile.css shows it there only while
 * Settings → controls → "show them in fullscreen here too" is on
 * (:root[data-pad-desktop="1"]).
 */
(function () {
  "use strict";

  const TOUCH = document.documentElement.dataset.touch === "1";

  const VN_PAD = `
    <div class="tp-group tp-top-left">
      <button type="button" class="tp-pill" data-act="exit" aria-label="leave the game">✕</button>
      <button type="button" class="tp-pill" data-act="hide" aria-label="hide the controls">hide</button>
    </div>
    <div class="tp-group tp-top-right">
      <button type="button" class="tp-pill" data-act="rclick" aria-label="right click">r-click</button>
    </div>
    <div class="tp-group tp-dpad">
      <button type="button" data-key="ArrowUp" aria-label="up">▲</button>
      <button type="button" data-key="ArrowLeft" aria-label="left">◀</button>
      <button type="button" data-key="ArrowRight" aria-label="right">▶</button>
      <button type="button" data-key="ArrowDown" aria-label="down">▼</button>
    </div>
    <div class="tp-group tp-vn">
      <button type="button" data-key="Escape">esc</button>
      <button type="button" data-key="Control" data-latch aria-label="ctrl (skip), tap to hold">ctrl</button>
      <button type="button" data-key="Enter">enter</button>
    </div>`;

  const PS2_PAD = `
    <div class="tp-group tp-top-left">
      <button type="button" class="tp-pill" data-act="exit" aria-label="leave the game">✕</button>
      <button type="button" class="tp-pill" data-act="hide" aria-label="hide the controls">hide</button>
    </div>
    <div class="tp-group tp-shoulder-left">
      <button type="button" data-key="Key2">L2</button>
      <button type="button" data-key="Key1">L1</button>
    </div>
    <div class="tp-group tp-shoulder-right">
      <button type="button" data-key="Key8">R1</button>
      <button type="button" data-key="Key9">R2</button>
    </div>
    <div class="tp-group tp-dpad">
      <button type="button" data-key="ArrowUp" aria-label="up">▲</button>
      <button type="button" data-key="ArrowLeft" aria-label="left">◀</button>
      <button type="button" data-key="ArrowRight" aria-label="right">▶</button>
      <button type="button" data-key="ArrowDown" aria-label="down">▼</button>
    </div>
    <div class="tp-group tp-center">
      <button type="button" class="tp-pill" data-key="Backspace">select</button>
      <button type="button" class="tp-pill" data-key="Enter">start</button>
    </div>
    <div class="tp-group tp-face">
      <button type="button" data-key="KeyS" aria-label="triangle">△</button>
      <button type="button" data-key="KeyA" aria-label="square">□</button>
      <button type="button" data-key="KeyX" aria-label="circle">○</button>
      <button type="button" data-key="KeyZ" aria-label="cross">✕</button>
    </div>`;

  // Keys and right clicks go into the game through assets/input.js, which
  // controllers (assets/gamepad.js) share.
  const { sendKey, rightClick, isPs2 } = window.NoberuInput;

  // --- the pad ----------------------------------------------------------------

  function buildPad(frameWrap) {
    const pad = document.createElement("div");
    pad.className = "touch-pad";
    const ps2 = isPs2(frameWrap);
    pad.dataset.kind = ps2 ? "ps2" : "vn";
    pad.innerHTML = ps2 ? PS2_PAD : VN_PAD;
    frameWrap.appendChild(pad);

    const latched = new Set();
    const ctrlHeld = () => latched.has("Control");
    // Off in settings, or no vibration motor (every iPhone): nothing.
    const buzz = () => {
      const on = !window.NoberuSettings || window.NoberuSettings.get("vibrate") === "1";
      if (on && navigator.vibrate) navigator.vibrate(8);
    };

    // A quick tap can lift within one frame of landing, and an engine that
    // looks at its keys once a frame (RPG Maker, most of the wasm ones) would
    // never see it down. The key-up waits until it has been held this long.
    const MIN_PRESS_MS = 70;

    const press = (button) => {
      button.classList.add("down");
      button.pressedAt = performance.now();
      buzz();
      sendKey(frameWrap, button.dataset.key, true, ctrlHeld());
    };
    const release = (button) => {
      if (!button.classList.contains("down")) return;
      button.classList.remove("down");
      const wait = MIN_PRESS_MS - (performance.now() - button.pressedAt);
      const up = () => sendKey(frameWrap, button.dataset.key, false, ctrlHeld());
      if (wait > 0) setTimeout(up, wait);
      else up();
    };

    pad.querySelectorAll("button[data-key]").forEach((button) => {
      const name = button.dataset.key;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (button.hasAttribute("data-latch")) {
          // Tap to hold, tap again to let go: skipping means holding ctrl
          // for a long time, which is miserable on glass.
          if (latched.has(name)) {
            latched.delete(name);
            button.classList.remove("latched");
            sendKey(frameWrap, name, false, false);
          } else {
            latched.add(name);
            button.classList.add("latched");
            buzz();
            sendKey(frameWrap, name, true, true);
          }
          return;
        }
        press(button);
        // Keeps the key held while a thumb slides off it; can throw for a
        // pointer the browser has already let go of, which is harmless.
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) { /* released already */ }
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
        button.addEventListener(type, () => {
          if (!button.hasAttribute("data-latch")) release(button);
        });
      });
    });

    pad.querySelectorAll("button[data-act]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const act = button.dataset.act;
        if (act === "exit") leave(frameWrap);
        else if (act === "hide") {
          const hidden = pad.classList.toggle("tp-hidden");
          button.textContent = hidden ? "show" : "hide";
          button.setAttribute("aria-label", hidden ? "show the controls" : "hide the controls");
        } else if (act === "rclick") rightClick(frameWrap);
      });
    });

    // Nothing stays held once the game is left.
    pad.releaseAll = () => {
      pad.querySelectorAll("button.down").forEach(release);
      latched.forEach((name) => sendKey(frameWrap, name, false, false));
      latched.clear();
      pad.querySelectorAll("button.latched").forEach((b) => b.classList.remove("latched"));
    };

    // A long press would otherwise open the text-selection callout on iOS.
    pad.addEventListener("contextmenu", (event) => event.preventDefault());
    return pad;
  }

  // --- entering and leaving -----------------------------------------------------

  function enter(frameWrap) {
    if (!frameWrap.querySelector(":scope > .touch-pad")) buildPad(frameWrap);
    if (!frameWrap.classList.contains("emulator-maximized")) {
      frameWrap.classList.add("emulator-maximized");
    }
    // Real fullscreen where the browser allows it (Android, iPad). An iPhone
    // has no element fullscreen; there the page-level maximize is it, and an
    // installed app has no browser bars to hide anyway.
    if (frameWrap.requestFullscreen && !document.fullscreenElement) {
      frameWrap.requestFullscreen({ navigationUI: "hide" })
        .then(() => screen.orientation && screen.orientation.lock &&
          screen.orientation.lock("landscape").catch(() => { }))
        .catch(() => { });
    }
  }

  function leave(frameWrap) {
    const pad = frameWrap.querySelector(":scope > .touch-pad");
    if (pad && pad.releaseAll) pad.releaseAll();
    if (document.fullscreenElement === frameWrap) {
      // index.html's fullscreenchange handler clears the maximize.
      document.exitFullscreen().catch(() => { });
    }
    frameWrap.classList.remove("emulator-maximized");
    if (typeof clearMaximized === "function") clearMaximized();
  }

  // Every runtime's boot code marks its frame "active" once a game is staged
  // and starting, so that one class change is the cue to go full screen.
  function watch(frameWrap) {
    let wasActive = frameWrap.classList.contains("active");
    new MutationObserver(() => {
      const active = frameWrap.classList.contains("active");
      if (TOUCH && active && !wasActive) enter(frameWrap);
      if (TOUCH && !active && wasActive) leave(frameWrap);
      // The window bar's fullscreen button maximizes too; bring the keys.
      if (frameWrap.classList.contains("emulator-maximized") &&
          !frameWrap.querySelector(":scope > .touch-pad")) {
        buildPad(frameWrap);
      }
      wasActive = active;
    }).observe(frameWrap, { attributes: true, attributeFilter: ["class"] });
  }

  document.querySelectorAll(".play-frame-wrap").forEach(watch);
})();
