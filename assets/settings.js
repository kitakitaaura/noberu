// The settings popup: sound, on-screen controls, display, beam and storage.
//
// Each setting is one localStorage key. That keeps them readable from the
// runtime frames with no messaging: assets/runtime.js in every engine page
// reads the sound keys and hears changes through the `storage` event. The
// page that makes a change gets `noberu-settings` instead, since `storage`
// only fires in the *other* documents.
//
// Two keys predate this file and keep their names: `noberu-theme` (the theme
// button) and `noberu.beam.includeSaves` (assets/beam.js).

(function () {
  "use strict";

  const SETTINGS = {
    volume: { key: "noberu.settings.volume", fallback: "100" },
    mute: { key: "noberu.settings.mute", fallback: "0" },
    muteInBackground: { key: "noberu.settings.muteInBackground", fallback: "1" },
    padSize: { key: "noberu.settings.padSize", fallback: "medium" },
    padOpacity: { key: "noberu.settings.padOpacity", fallback: "100" },
    vibrate: { key: "noberu.settings.vibrate", fallback: "1" },
    leftHanded: { key: "noberu.settings.leftHanded", fallback: "0" },
    padDesktop: { key: "noberu.settings.padDesktop", fallback: "0" },
    controller: { key: "noberu.settings.controller", fallback: "1" },
    controllerSwap: { key: "noberu.settings.controllerSwap", fallback: "0" },
    keepAwake: { key: "noberu.settings.keepAwake", fallback: "1" },
    openLast: { key: "noberu.settings.openLast", fallback: "0" },
    sharp: { key: "noberu.settings.sharp", fallback: "0" },
    crt: { key: "noberu.settings.crt", fallback: "0" },
    reduceMotion: { key: "noberu.settings.reduceMotion", fallback: "auto" },
    warnLeave: { key: "noberu.settings.warnLeave", fallback: "1" },
    fullscreenOnStart: { key: "noberu.settings.fullscreenOnStart", fallback: "0" },
    hideCursor: { key: "noberu.settings.hideCursor", fallback: "1" },
    deviceName: { key: "noberu.settings.deviceName", fallback: "" },
    theme: { key: "noberu-theme", fallback: "dark" },
    verbose: { key: "noberu.settings.verbose", fallback: "0" },
    beamSaves: { key: "noberu.beam.includeSaves", fallback: "1" },
  };

  const PAD_SCALE = { small: 0.82, medium: 1, large: 1.22 };

  // "auto" (never changed) follows the device's own reduced-motion setting.
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function reducedMotion() {
    const value = get("reduceMotion");
    return value === "auto" ? motionQuery.matches : value === "1";
  }

  function get(name) {
    const setting = SETTINGS[name];
    try {
      const value = localStorage.getItem(setting.key);
      return value === null ? setting.fallback : value;
    } catch (error) {
      return setting.fallback;
    }
  }

  function set(name, value) {
    try {
      localStorage.setItem(SETTINGS[name].key, String(value));
    } catch (error) {
      // Private mode: the change holds for this page only.
    }
    apply();
    window.dispatchEvent(new CustomEvent("noberu-settings", { detail: { name, value } }));
  }

  // What the page itself shows: short or detailed text, the CRT look, and the
  // on-screen controls' side, size, opacity and whether a computer shows them. (Sharp pixels and the volume
  // are applied inside each game, by assets/runtime.js.)
  function apply() {
    const flag = (name, on) => {
      if (on) document.documentElement.dataset[name] = "1";
      else delete document.documentElement.dataset[name];
    };
    flag("verbose", get("verbose") === "1");
    flag("crt", get("crt") === "1");
    flag("reduceMotion", reducedMotion());
    flag("padDesktop", get("padDesktop") === "1");
    if (get("leftHanded") === "1") document.documentElement.dataset.padHand = "left";
    else delete document.documentElement.dataset.padHand;
    const root = document.documentElement.style;
    root.setProperty("--pad-scale", String(PAD_SCALE[get("padSize")] || 1));
    root.setProperty("--pad-opacity", String(Number(get("padOpacity")) / 100 || 1));
  }

  // --- the popup --------------------------------------------------------------

  let dialog = null;

  const toggle = (name, title, note) => `
    <label class="settings-row">
      <span class="settings-text"><b>${title}</b>${note ? `<small>${note}</small>` : ""}</span>
      <input class="settings-switch" type="checkbox" data-setting="${name}" />
    </label>`;

  const PANELS = {
    sound: `
      <label class="settings-row settings-wide">
        <span class="settings-text"><b>master volume</b><small>Every game, whichever engine runs it.</small></span>
        <span class="settings-range">
          <input type="range" min="0" max="100" step="1" data-setting="volume" aria-label="master volume" />
          <output data-show="volume">100%</output>
        </span>
      </label>
      ${toggle("mute", "mute", "Silence everything without losing the volume.")}
      ${toggle("muteInBackground", "mute in the background", "Quiet while you are in another tab or app.")}`,

    play: `
      ${toggle("keepAwake", "keep the screen on", "Stops the screen dimming while a game is open.")}
      ${toggle("openLast", "open my last game on start", "Picks up where you left off when noberu opens.")}
      ${toggle("warnLeave", "ask before leaving a game", "Closing the tab mid-game asks first, so unsaved progress is not lost.")}
      <div class="settings-wide-only">
        ${toggle("fullscreenOnStart", "fullscreen when a game starts", "Fills the screen as soon as a game boots.")}
        ${toggle("hideCursor", "hide the cursor while reading", "It disappears after a few seconds still, and comes back when moved.")}
      </div>`,

    controls: `
      <p class="settings-note desktop-only">These are the on-screen buttons over a game on phones and tablets.</p>
      <div class="desktop-only">
        ${toggle("padDesktop", "show them in fullscreen here too", "On this computer, when a game is fullscreen. Click them like a phone's.")}
      </div>
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>size</b></span>
        <span class="settings-segments" role="radiogroup" aria-label="control size">
          <label><input type="radio" name="settings-pad-size" value="small" data-setting="padSize" /><span>small</span></label>
          <label><input type="radio" name="settings-pad-size" value="medium" data-setting="padSize" /><span>medium</span></label>
          <label><input type="radio" name="settings-pad-size" value="large" data-setting="padSize" /><span>large</span></label>
        </span>
      </div>
      <label class="settings-row settings-wide">
        <span class="settings-text"><b>opacity</b><small>Lower to see more of the game behind them.</small></span>
        <span class="settings-range">
          <input type="range" min="25" max="100" step="5" data-setting="padOpacity" aria-label="control opacity" />
          <output data-show="padOpacity">100%</output>
        </span>
      </label>
      <div class="settings-preview" aria-hidden="true">
        <span class="settings-preview-pad">
          <i style="grid-area: 1 / 2"></i><i style="grid-area: 2 / 1"></i>
          <i style="grid-area: 2 / 3"></i><i style="grid-area: 3 / 2"></i>
        </span>
        <span class="settings-preview-key">enter</span>
      </div>
      ${toggle("leftHanded", "left-handed", "Buttons on the left, d-pad on the right.")}
      ${toggle("vibrate", "vibrate on press", "A short buzz per button, where the phone supports it.")}`,

    controller: `
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>controller</b><small data-show="pads">None found yet. Press any button on it.</small></span>
      </div>
      ${toggle("controller", "use a controller", "Xbox, PlayStation, Switch and most others.")}
      ${toggle("controllerSwap", "Nintendo layout", "Confirm with the right button instead of the bottom one.")}
      <dl class="settings-map">
        <dt data-show="confirm">A</dt><dd>next / choose</dd>
        <dt data-show="back">B</dt><dd>menu</dd>
        <dt>RT</dt><dd>skip (hold)</dd>
        <dt>LB</dt><dd>back-log</dd>
        <dt>d-pad</dt><dd>move</dd>
        <dt>start</dt><dd>esc</dd>
      </dl>`,

    display: `
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>theme</b></span>
        <span class="settings-segments" role="radiogroup" aria-label="theme">
          <label><input type="radio" name="settings-theme" value="dark" data-setting="theme" /><span>dark</span></label>
          <label><input type="radio" name="settings-theme" value="light" data-setting="theme" /><span>light</span></label>
        </span>
      </div>
      ${toggle("sharp", "sharp pixels", "Crisp edges for older, low-resolution games. Can look jagged on HD ones.")}
      ${toggle("crt", "CRT look", "Scanlines and soft corners, like an old screen.")}
      ${toggle("reduceMotion", "reduce motion", "Turns off the site's animations. Follows your device until changed.")}
      <div class="settings-wide-only">
        ${toggle("verbose", "detailed descriptions", "Show the longer, technical notes on each tab.")}
      </div>`,

    beam: `
      <label class="settings-row settings-wide">
        <span class="settings-text"><b>this device's name</b><small>What the other device sees when you beam.</small></span>
        <input class="settings-input" type="text" maxlength="40" data-setting="deviceName" autocomplete="off" spellcheck="false" />
      </label>
      ${toggle("beamSaves", "send saves with a game", "Beaming a game also brings its saves. Saves can always be beamed on their own from the saves panel.")}`,

    storage: `
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>space used</b><small data-show="usage">checking...</small></span>
      </div>
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>keep my games</b><small data-show="persist">checking...</small></span>
        <button class="retro-button secondary" type="button" data-act="persist">ask the browser</button>
      </div>
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>the tour</b><small>The walkthrough from the first visit.</small></span>
        <button class="retro-button secondary" type="button" data-act="tour">replay</button>
      </div>
      <div class="settings-row settings-wide settings-danger">
        <span class="settings-text"><b>erase everything</b><small>Games, saves and settings stored by noberu in this browser. Folders on your device are not touched.</small></span>
        <button class="retro-button secondary" type="button" data-act="erase">erase</button>
      </div>`,
  };

  function build() {
    dialog = document.createElement("div");
    dialog.className = "library-backdrop hidden";
    dialog.id = "settings-backdrop";
    const names = Object.keys(PANELS);
    dialog.innerHTML = `
      <div class="library-modal settings-modal" role="dialog" aria-modal="true" aria-label="settings">
        <div class="library-bar">
          <b>settings</b>
          <button class="tiny-button" type="button" data-act="close">close</button>
        </div>
        <div class="settings-body">
          <div class="settings-tabs" role="tablist" aria-label="settings sections">
            ${names.map((name) => `<button type="button" role="tab" data-tab="${name}"
              aria-controls="settings-${name}" aria-selected="false">${name}</button>`).join("")}
          </div>
          <div class="settings-panels">
            ${names.map((name) => `<section class="settings-panel" role="tabpanel" id="settings-${name}"
              data-panel="${name}" hidden>${PANELS[name]}</section>`).join("")}
          </div>
        </div>
        <div class="library-foot">noberu v0.2 · settings are kept in this browser.</div>
      </div>`;
    document.body.appendChild(dialog);

    dialog.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => showPanel(button.dataset.tab));
    });

    dialog.querySelectorAll("input[data-setting]").forEach((input) => {
      const name = input.dataset.setting;
      const handler = () => {
        if (input.type === "checkbox") set(name, input.checked ? "1" : "0");
        else if (input.type === "text") set(name, input.value.trim());
        else if (input.type === "radio") {
          if (!input.checked) return;
          if (name === "theme") setTheme(input.value);
          else set(name, input.value);
        } else set(name, input.value);
        sync();
      };
      input.addEventListener(input.type === "range" ? "input" : "change", handler);
    });

    dialog.querySelector('[data-act="close"]').addEventListener("click", close);
    dialog.querySelector('[data-act="persist"]').addEventListener("click", askToPersist);
    dialog.querySelector('[data-act="tour"]').addEventListener("click", () => {
      close();
      if (window.NoberuTour) window.NoberuTour.start();
    });
    dialog.querySelector('[data-act="erase"]').addEventListener("click", eraseEverything);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog && !dialog.classList.contains("hidden")) close();
    });
  }

  function showPanel(name) {
    dialog.querySelectorAll("[data-tab]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tab === name));
    });
    dialog.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
    if (name === "storage") refreshStorage();
  }

  // Puts every control back in line with what is stored.
  function sync() {
    dialog.querySelectorAll("input[data-setting]").forEach((input) => {
      const name = input.dataset.setting;
      const value = get(name);
      if (name === "reduceMotion") input.checked = reducedMotion();
      else if (input.type === "checkbox") input.checked = value === "1";
      else if (input.type === "radio") input.checked = input.value === value;
      else input.value = value;
    });
    dialog.querySelector('[data-show="volume"]').textContent = `${get("volume")}%`;
    dialog.querySelector('[data-show="padOpacity"]').textContent = `${get("padOpacity")}%`;
    dialog.querySelector(".settings-range input[data-setting='volume']")
      .closest(".settings-row").classList.toggle("dim", get("mute") === "1");
    const swapped = get("controllerSwap") === "1";
    dialog.querySelector('[data-show="confirm"]').textContent = swapped ? "B" : "A";
    dialog.querySelector('[data-show="back"]').textContent = swapped ? "A" : "B";
    const nameInput = dialog.querySelector('input[data-setting="deviceName"]');
    if (window.NoberuBeam && window.NoberuBeam.autoDeviceName) {
      nameInput.placeholder = window.NoberuBeam.autoDeviceName();
    }
    showPads();
  }

  // Which controllers the browser has revealed (assets/gamepad.js).
  function showPads() {
    if (!dialog) return;
    const names = window.NoberuGamepad ? window.NoberuGamepad.connected() : [];
    dialog.querySelector('[data-show="pads"]').textContent = names.length
      ? names.map((name) => name.replace(/\s*\(.*$/, "")).join(", ")
      : "None found yet. Press any button on it.";
  }

  // The theme button in the top bar owns the theme (its icon and label follow
  // it), so this goes through it rather than around it.
  function setTheme(theme) {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    if (theme !== current) document.querySelector("#theme-button").click();
  }

  // --- storage ----------------------------------------------------------------

  function bytesLabel(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  async function refreshStorage() {
    const usage = dialog.querySelector('[data-show="usage"]');
    const persist = dialog.querySelector('[data-show="persist"]');
    const button = dialog.querySelector('[data-act="persist"]');
    try {
      const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
      usage.textContent = quota
        ? `${bytesLabel(used)} of the ${bytesLabel(quota)} this browser allows.`
        : `${bytesLabel(used)}.`;
    } catch (error) {
      usage.textContent = "This browser does not say.";
    }
    let persisted = false;
    try {
      persisted = await navigator.storage.persisted();
    } catch (error) { /* unsupported: offer the button anyway */ }
    persist.textContent = persisted
      ? "On: the browser will not clear your games to free up space."
      : "Off: when space runs low, the browser may clear stored games and saves.";
    button.hidden = persisted || !(navigator.storage && navigator.storage.persist);
  }

  async function askToPersist() {
    try {
      const granted = await navigator.storage.persist();
      if (!granted) {
        dialog.querySelector('[data-show="persist"]').textContent =
          "The browser said no. Installing noberu as an app, or using it more, usually changes that.";
        return;
      }
    } catch (error) { /* fall through to the refresh */ }
    refreshStorage();
  }

  async function eraseEverything() {
    if (!confirm("Erase everything noberu keeps in this browser?\n\n" +
      "Every stored game, every save and every setting goes. Folders on your " +
      "device are left alone. Export saves you want to keep first.")) return;
    if (!confirm("This cannot be undone. Erase now?")) return;

    try {
      if (indexedDB.databases) {
        for (const { name } of await indexedDB.databases()) {
          if (name) indexedDB.deleteDatabase(name);
        }
      }
    } catch (error) { console.warn("noberu: could not clear IndexedDB", error); }
    try {
      const root = await navigator.storage.getDirectory();
      for await (const name of root.keys()) {
        await root.removeEntry(name, { recursive: true });
      }
    } catch (error) { console.warn("noberu: could not clear stored games", error); }
    try {
      for (const name of await caches.keys()) await caches.delete(name);
    } catch (error) { /* no caches */ }
    try {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
    } catch (error) { /* no workers */ }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (error) { /* private mode */ }
    location.reload();
  }

  function open(panel) {
    if (!dialog) build();
    sync();
    showPanel(panel || "sound");
    dialog.classList.remove("hidden");
  }

  function close() {
    if (dialog) dialog.classList.add("hidden");
  }

  // A device setting changed while "auto": follow it.
  motionQuery.addEventListener("change", apply);
  window.addEventListener("gamepadconnected", showPads);
  window.addEventListener("gamepaddisconnected", showPads);

  apply();

  window.NoberuSettings = { get, set, open };
})();
