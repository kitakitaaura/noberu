/**
 * Game controllers: Xbox, PlayStation, Switch Pro and the rest, through the
 * browser's Gamepad API. Buttons become the same keys the keyboard and the
 * on-screen pad send (assets/input.js), so no runtime knows the difference.
 *
 * Visual novels:  A next · B menu (right click) · X esc · Y / LB back-log
 *                 (PageUp) · RB PageDown · RT skip while held (ctrl) ·
 *                 start / back esc · d-pad or left stick to move.
 * PS2:            each button is the PS2 button in the same place (bottom is
 *                 cross, right is circle...), on Play!'s keyboard keys.
 *
 * RPG Maker games read controllers themselves (A confirm, B cancel, Y menu,
 * X dash), so their frame (data-native-gamepad) gets nothing from here.
 *
 * Buttons are read by position (the "standard" layout), so a Switch pad's
 * right button is B here, as on an Xbox pad. Settings → controller can swap
 * A/B and X/Y for anyone used to Nintendo's confirm-on-the-right.
 *
 * Browsers only reveal a controller once a button on it is pressed, so a
 * controller already plugged in shows up on the first press.
 */
(function () {
  "use strict";

  if (!navigator.getGamepads) return;

  const { sendKey, rightClick, isPs2, activeFrame } = window.NoberuInput;

  // Standard-layout button index -> what it does.
  const VN = {
    0: "Enter",
    1: "rclick",
    2: "Escape",
    3: "PageUp",
    4: "PageUp",
    5: "PageDown",
    7: "Control",
    8: "Escape",
    9: "Escape",
    12: "ArrowUp",
    13: "ArrowDown",
    14: "ArrowLeft",
    15: "ArrowRight",
  };

  const PS2 = {
    0: "KeyZ",      // cross
    1: "KeyX",      // circle
    2: "KeyA",      // square
    3: "KeyS",      // triangle
    4: "Key1",      // L1
    5: "Key8",      // R1
    6: "Key2",      // L2
    7: "Key9",      // R2
    8: "Backspace", // select
    9: "Enter",     // start
    12: "ArrowUp",
    13: "ArrowDown",
    14: "ArrowLeft",
    15: "ArrowRight",
  };

  // The left stick stands in for the d-pad, past this far from centre.
  const STICK = 0.6;
  // Held directions repeat, like a held arrow key.
  const REPEAT_AFTER = 400;
  const REPEAT_EVERY = 110;
  const DIRECTIONS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

  function setting(name, fallback) {
    return window.NoberuSettings ? window.NoberuSettings.get(name) : fallback;
  }

  // Per controller: what each input sent, so its release goes to the same
  // place even if the game or the tab changed in between.
  const held = new Map(); // "pad:input" -> { frame, action, since, repeated }
  let frameRequest = 0;

  function actionFor(frame, index) {
    if (isPs2(frame)) return PS2[index];
    let i = index;
    if (setting("controllerSwap", "0") === "1") {
      i = { 0: 1, 1: 0, 2: 3, 3: 2 }[index] ?? index;
    }
    return VN[i];
  }

  function ctrlHeld() {
    for (const hold of held.values()) if (hold.action === "Control") return true;
    return false;
  }

  function press(id, frame, action) {
    held.set(id, { frame, action, since: performance.now(), repeated: 0 });
    if (action === "rclick") rightClick(frame);
    else sendKey(frame, action, true, ctrlHeld());
  }

  function release(id) {
    const hold = held.get(id);
    if (!hold) return;
    held.delete(id);
    if (hold.action !== "rclick") sendKey(hold.frame, hold.action, false, ctrlHeld());
  }

  function poll() {
    frameRequest = 0;
    const pads = [...navigator.getGamepads()].filter(Boolean);
    const enabled = setting("controller", "1") === "1";
    let frame = enabled ? activeFrame() : null;
    // RPG Maker reads controllers itself, with its own layout; keys from here
    // on top would press everything twice.
    if (frame && frame.hasAttribute("data-native-gamepad")) frame = null;
    const now = performance.now();

    for (const pad of pads) {
      // Which inputs are down this frame: buttons, then the stick as arrows.
      const down = new Map();
      pad.buttons.forEach((button, index) => {
        if (button.pressed || button.value > 0.5) down.set(`b${index}`, index);
      });
      const [x = 0, y = 0] = pad.axes;
      if (y < -STICK) down.set("up", 12);
      if (y > STICK) down.set("down", 13);
      if (x < -STICK) down.set("left", 14);
      if (x > STICK) down.set("right", 15);

      for (const id of [...held.keys()]) {
        if (!id.startsWith(`${pad.index}:`)) continue;
        if (!frame || !down.has(id.slice(id.indexOf(":") + 1))) release(id);
      }
      if (!frame) continue;

      for (const [input, index] of down) {
        const id = `${pad.index}:${input}`;
        const hold = held.get(id);
        if (!hold) {
          const action = actionFor(frame, index);
          if (action) press(id, frame, action);
        } else if (DIRECTIONS.has(hold.action)) {
          const due = REPEAT_AFTER + hold.repeated * REPEAT_EVERY;
          if (now - hold.since >= due) {
            hold.repeated++;
            sendKey(hold.frame, hold.action, true, ctrlHeld());
          }
        }
      }
    }

    // Keep reading while a controller is connected or anything is held.
    if (pads.length || held.size) frameRequest = requestAnimationFrame(poll);
    window.dispatchEvent(new CustomEvent("noberu-gamepad", { detail: { pads } }));
  }

  function start() {
    if (!frameRequest) frameRequest = requestAnimationFrame(poll);
  }

  window.addEventListener("gamepadconnected", start);
  window.addEventListener("gamepaddisconnected", start);
  // A tab switch or a game ending lets everything go.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const id of [...held.keys()]) release(id);
  });
  start();

  window.NoberuGamepad = {
    // Names of the controllers the browser has revealed so far.
    connected() {
      return [...navigator.getGamepads()].filter(Boolean).map((pad) => pad.id);
    },
  };
})();
