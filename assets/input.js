/**
 * Sending input into a running game, shared by the on-screen pad
 * (assets/touch.js) and controllers (assets/gamepad.js).
 *
 * Keys are real DOM keyboard events, dispatched into the game's own document.
 * Every engine here but siglus, tyrano and rpg maker is Emscripten, whose
 * handler reads key, code, keyCode and which, so all four are set (RPG Maker
 * reads keyCode). A key from here and a key from a keyboard look the same to
 * the runtimes.
 */
(function () {
  "use strict";

  // key, code and keyCode for every key sent. The PS2 codes are the ones
  // Play! is mapped to in index.html's own control list ("Key1" for L1 and so
  // on), so they are kept exactly as written there.
  const KEYS = {
    ArrowUp: ["ArrowUp", "ArrowUp", 38],
    ArrowDown: ["ArrowDown", "ArrowDown", 40],
    ArrowLeft: ["ArrowLeft", "ArrowLeft", 37],
    ArrowRight: ["ArrowRight", "ArrowRight", 39],
    Enter: ["Enter", "Enter", 13],
    Escape: ["Escape", "Escape", 27],
    Control: ["Control", "ControlLeft", 17],
    Backspace: ["Backspace", "Backspace", 8],
    PageUp: ["PageUp", "PageUp", 33],
    PageDown: ["PageDown", "PageDown", 34],
    KeyA: ["a", "KeyA", 65],
    KeyS: ["s", "KeyS", 83],
    KeyX: ["x", "KeyX", 88],
    KeyZ: ["z", "KeyZ", 90],
    Key1: ["1", "Key1", 49],
    Key2: ["2", "Key2", 50],
    Key8: ["8", "Key8", 56],
    Key9: ["9", "Key9", 57],
  };

  // The element a key is dispatched on. Runtimes live in same-origin iframes
  // (a tyrano game is one frame deeper); the PS2 canvas is on this page.
  // Dispatching on the canvas reaches handlers on the canvas itself (winit,
  // Play!) and bubbles up to document and window (Emscripten's SDL).
  function targetFor(frameWrap) {
    const iframe = frameWrap.querySelector("iframe");
    if (!iframe) return frameWrap.querySelector("canvas") || document.body;
    let doc = null;
    try {
      doc = iframe.contentDocument;
      for (let depth = 0; depth < 3 && doc; depth++) {
        const inner = doc.querySelector("iframe");
        if (!inner || !inner.contentDocument) break;
        doc = inner.contentDocument;
      }
    } catch (error) {
      return null;  // cross-origin: nothing here can reach it
    }
    if (!doc) return null;
    return doc.querySelector("canvas") || doc.body;
  }

  function sendKey(frameWrap, name, down, ctrlHeld) {
    const target = targetFor(frameWrap);
    const spec = KEYS[name];
    if (!target || !spec) return;
    const win = target.ownerDocument.defaultView;
    const [key, code, keyCode] = spec;
    const event = new win.KeyboardEvent(down ? "keydown" : "keyup", {
      key,
      code,
      location: name === "Control" ? 1 : 0,
      ctrlKey: name === "Control" ? down : !!ctrlHeld,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    // Not settable through the constructor in every browser.
    Object.defineProperty(event, "keyCode", { get: () => keyCode });
    Object.defineProperty(event, "which", { get: () => keyCode });
    target.dispatchEvent(event);
  }

  // A right click at the middle of the game: the menu in most engines.
  function rightClick(frameWrap) {
    const target = targetFor(frameWrap);
    if (!target) return;
    const win = target.ownerDocument.defaultView;
    const rect = target.getBoundingClientRect();
    const at = {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      screenX: rect.left + rect.width / 2,
      screenY: rect.top + rect.height / 2,
      button: 2,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win,
    };
    const pointer = { ...at, pointerId: 99, pointerType: "mouse", isPrimary: true };
    if (win.PointerEvent) target.dispatchEvent(new win.PointerEvent("pointerdown", { ...pointer, buttons: 2 }));
    target.dispatchEvent(new win.MouseEvent("mousedown", { ...at, buttons: 2 }));
    if (win.PointerEvent) target.dispatchEvent(new win.PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    target.dispatchEvent(new win.MouseEvent("mouseup", { ...at, buttons: 0 }));
    target.dispatchEvent(new win.MouseEvent("contextmenu", { ...at, buttons: 0 }));
  }

  function isPs2(frameWrap) {
    return frameWrap.id === "play-frame-wrap";
  }

  // The game on screen: a started runtime frame in the tab being shown.
  function activeFrame() {
    return document.querySelector(".view.active .play-frame-wrap.active") ||
      document.querySelector(".play-frame-wrap.emulator-maximized.active");
  }

  // Calls fn(frameWrap, started) whenever a runtime frame starts or stops a
  // game. Every runtime's boot code marks its frame "active" once a game is
  // staged and starting, so that one class change is the cue.
  function onGameChange(fn) {
    document.querySelectorAll(".play-frame-wrap").forEach((frameWrap) => {
      let wasActive = frameWrap.classList.contains("active");
      new MutationObserver(() => {
        const active = frameWrap.classList.contains("active");
        if (active !== wasActive) fn(frameWrap, active);
        wasActive = active;
      }).observe(frameWrap, { attributes: true, attributeFilter: ["class"] });
    });
  }

  window.NoberuInput = { KEYS, targetFor, sendKey, rightClick, isPs2, activeFrame, onGameChange };
})();
