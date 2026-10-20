/**
 * The noberu menu: one menu over every game, whichever engine runs it.
 *
 * Opens with ` (the key under Esc), a controller's back/home button, the
 * "menu" button in a game's toolbar, the handle in a full screen game's
 * corner, or the menu key on the touch pad. Esc is left to the games: it is
 * their own menu in most of them.
 *
 * It lives inside the running game's frame wrapper, so it shows in native
 * fullscreen too. What it offers:
 *   screenshot (kept on the shelf, assets/shelf.js), the game's own menu
 *   (saves and loads), skip, reading tools (assets/text.js), volume,
 *   fullscreen, report a problem (assets/report.js), and quit to the shelf.
 */
(function () {
  "use strict";

  const { sendKey, rightClick, activeFrame } = window.NoberuInput;

  // The key each engine opens its own menu with (its save/load lives there).
  const GAME_MENU = {
    "renpy-frame-wrap": "Escape",
    "rpgmaker-frame-wrap": "Escape",
    "kirikiri-frame-wrap": "Escape",
    "tyrano-frame-wrap": "rclick",
    "vnds-frame-wrap": "Escape",
    "play-frame-wrap": null,
    "wine-frame-wrap": null,
  };

  const ICONS = {
    resume: '<path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/>',
    shot: '<rect x="1.8" y="4" width="12.4" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8.5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 4l1-1.6h3L10.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    saves: '<path d="M2.5 2.5h8.5L13.5 5v8.5h-11z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 2.5v4h5v-4M5 13.5v-4h6v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    skip: '<path d="M2.5 3.5 7.5 8l-5 4.5zM8 3.5 13 8l-5 4.5z" fill="currentColor"/>',
    text: '<path d="M2.5 3h11M2.5 6.5h11M2.5 10h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 10.5l1.6 3 1.6-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
    full: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    report: '<path d="M8 1.8 14.5 13.5h-13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r=".9" fill="currentColor"/>',
    quit: '<path d="M6 2.5H3v11h3M10.5 5 13.5 8l-3 3M13.5 8H6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    sound: '<path d="M2.5 6h2.6L8.5 3v10L5.1 10H2.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

  let menu = null;      // the open menu element
  let frame = null;     // the frame wrapper it belongs to
  let skipping = new WeakSet();
  let sessionStart = new WeakMap();

  function setting(name, fallback) {
    return window.NoberuSettings ? window.NoberuSettings.get(name) : fallback;
  }

  function currentGame() {
    const shelf = window.NoberuShelf && window.NoberuShelf.current();
    return shelf || null;
  }

  function label(frameWrap) {
    const toolbarLabel = frameWrap.querySelector(".play-frame-toolbar span");
    return toolbarLabel ? toolbarLabel.textContent.trim() : "game";
  }

  function since(frameWrap) {
    const start = sessionStart.get(frameWrap);
    if (!start) return "";
    const minutes = Math.round((Date.now() - start) / 60000);
    if (minutes < 1) return "just started";
    return minutes < 60 ? `${minutes} min this time` : `${Math.floor(minutes / 60)} h ${minutes % 60} min this time`;
  }

  function isOpen() {
    return !!menu;
  }

  function open(frameWrap) {
    frameWrap = frameWrap || activeFrame() || document.querySelector(".play-frame-wrap.active");
    if (!frameWrap || !frameWrap.classList.contains("active")) return;
    fullView(frameWrap);
    if (menu) close();
    frame = frameWrap;
    const game = currentGame();
    const title = game ? game.name.replace(/_+/g, " ") : label(frameWrap);
    const gameMenu = GAME_MENU[frameWrap.id];
    const volume = Number(setting("volume", "100"));
    const muted = setting("mute", "0") === "1";
    const full = document.fullscreenElement === frameWrap || frameWrap.classList.contains("emulator-maximized");
    const textOn = window.NoberuText && window.NoberuText.isOn(frameWrap);

    menu = document.createElement("div");
    menu.className = "nb-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.setAttribute("aria-label", "noberu menu");
    menu.innerHTML = `
      <div class="nb-menu-card">
        <div class="nb-menu-head">
          <div>
            <b>${escapeHtml(title)}</b>
            <span>${escapeHtml(since(frameWrap) || "noberu menu")}</span>
          </div>
          <kbd title="press \` to open and close this menu">\`</kbd>
        </div>
        <div class="nb-menu-grid">
          <button type="button" data-m="resume" class="primary">${icon("resume")}<span>resume</span></button>
          <button type="button" data-m="shot">${icon("shot")}<span>screenshot</span></button>
          ${gameMenu === null ? "" : `<button type="button" data-m="gamemenu">${icon("saves")}<span>save / load</span><small>the game's own menu</small></button>`}
          ${frameWrap.id === "play-frame-wrap" ? "" : `<button type="button" data-m="skip" aria-pressed="${skipping.has(frameWrap)}">${icon("skip")}<span>${skipping.has(frameWrap) ? "stop skipping" : "skip"}</span><small>holds ctrl</small></button>`}
          <button type="button" data-m="text" aria-pressed="${!!textOn}">${icon("text")}<span>reading tools</span><small>text, dictionary, translate</small></button>
          <button type="button" data-m="full">${icon("full")}<span>${full ? "leave fullscreen" : "fullscreen"}</span></button>
          <button type="button" data-m="report">${icon("report")}<span>report a problem</span></button>
          <button type="button" data-m="quit" class="danger">${icon("quit")}<span>quit to games</span></button>
        </div>
        <label class="nb-menu-volume">
          <button type="button" data-m="mute" aria-pressed="${muted}" aria-label="${muted ? "unmute" : "mute"}">${icon("sound")}</button>
          <input type="range" min="0" max="100" step="1" value="${volume}" aria-label="volume" ${muted ? "disabled" : ""} />
          <output>${muted ? "muted" : `${volume}%`}</output>
        </label>
        <p class="nb-menu-note" data-note role="status"></p>
      </div>`;
    frameWrap.appendChild(menu);

    menu.addEventListener("click", (event) => {
      if (event.target === menu) return close();
      const button = event.target.closest("[data-m]");
      if (button) act(button.dataset.m, button);
    });
    const range = menu.querySelector('input[type="range"]');
    range.addEventListener("input", () => {
      window.NoberuSettings && window.NoberuSettings.set("volume", range.value);
      menu.querySelector("output").textContent = `${range.value}%`;
    });
    menu.addEventListener("keydown", onKey);
    menu.querySelector("[data-m]").focus();
  }

  // On a phone the game outside full screen is a small box; the menu (and the
  // reading tools) need the whole screen, so they go back to it first.
  function fullView(frameWrap) {
    if (document.documentElement.dataset.touch !== "1" || frameWrap.classList.contains("emulator-maximized")) return;
    const button = frameWrap.querySelector(".frame-fullscreen");
    if (button) button.click();
  }

  function note(text) {
    const el = menu && menu.querySelector("[data-note]");
    if (el) el.textContent = text;
  }

  function close(refocus = true) {
    if (!menu) return;
    const was = frame;
    menu.remove();
    menu = null;
    frame = null;
    if (refocus && was) focusGame(was);
  }

  function focusGame(frameWrap) {
    const target = frameWrap.querySelector("iframe") || frameWrap.querySelector("canvas");
    if (target) target.focus();
  }

  function toggle(frameWrap) {
    if (menu) close();
    else open(frameWrap);
  }

  function onKey(event) {
    if (event.key === "Escape" || event.code === "Backquote") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const buttons = [...menu.querySelectorAll(".nb-menu-grid button")];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const columns = getComputedStyle(menu.querySelector(".nb-menu-grid")).gridTemplateColumns.split(" ").length;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
    if (move) {
      event.preventDefault();
      buttons[(i + move + buttons.length) % buttons.length].focus();
    }
  }

  // A controller drives the menu while it is open (assets/gamepad.js).
  function gamepad(action) {
    if (!menu) return false;
    const keys = { ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight" };
    if (keys[action]) {
      if (!menu.contains(document.activeElement)) menu.querySelector("[data-m]").focus();
      else onKey(new KeyboardEvent("keydown", { key: keys[action] }));
    } else if (action === "Enter") {
      const focused = menu.contains(document.activeElement) ? document.activeElement : null;
      if (focused) focused.click();
    } else if (action === "rclick" || action === "Escape" || action === "menu") {
      close();
    }
    return true;
  }

  async function act(name, button) {
    const frameWrap = frame;
    if (name === "resume") return close();
    if (name === "shot") {
      close(false);
      await screenshot(frameWrap);
      focusGame(frameWrap);
      return;
    }
    if (name === "gamemenu") {
      close();
      const key = GAME_MENU[frameWrap.id] || "rclick";
      // After the menu is gone, so the game sees its own key arrive.
      setTimeout(() => {
        if (key === "rclick") rightClick(frameWrap);
        else {
          sendKey(frameWrap, key, true);
          setTimeout(() => sendKey(frameWrap, key, false), 80);
        }
      }, 60);
      return;
    }
    if (name === "skip") {
      if (skipping.has(frameWrap)) {
        skipping.delete(frameWrap);
        sendKey(frameWrap, "Control", false, false);
      } else {
        skipping.add(frameWrap);
        sendKey(frameWrap, "Control", true, true);
      }
      close();
      return;
    }
    if (name === "text") {
      close();
      if (window.NoberuText) window.NoberuText.toggle(frameWrap);
      return;
    }
    if (name === "full") {
      close();
      const tool = document.querySelector("#fullscreen-emulator");
      if (tool) tool.click();
      return;
    }
    if (name === "mute") {
      const muted = setting("mute", "0") === "1";
      window.NoberuSettings && window.NoberuSettings.set("mute", muted ? "0" : "1");
      button.setAttribute("aria-pressed", String(!muted));
      menu.querySelector('input[type="range"]').disabled = !muted;
      menu.querySelector("output").textContent = muted ? `${setting("volume", "100")}%` : "muted";
      return;
    }
    if (name === "report") {
      close(false);
      const game = currentGame();
      if (window.NoberuReport) window.NoberuReport.open({ game: game && game.name, engine: game && game.engine, frame: frameWrap.id });
      return;
    }
    if (name === "quit") {
      if (!confirm("Quit this game?\n\nAnything not saved in the game is lost.")) return;
      close(false);
      await quit(frameWrap);
    }
  }

  // --- screenshots -------------------------------------------------------------------

  async function screenshot(frameWrap) {
    const shelf = window.NoberuShelf;
    const blob = shelf ? await shelf.capture(frameWrap, 1920) : null;
    if (!blob) {
      toast(frameWrap, "This game can't be captured.");
      return;
    }
    flash(frameWrap);
    const game = currentGame();
    if (game && shelf) {
      await shelf.addShot(game.id, blob);
      toast(frameWrap, "Screenshot kept on your shelf.", [
        { label: "use as cover", run: async () => {
          await shelf.putCover(game.id, await window.NoberuCovers.shrink(blob, 640), "custom", {}, true);
          toast(frameWrap, "Cover set.");
        } },
        { label: "save image", run: () => download(blob, game.name) },
      ]);
    } else {
      // Played straight from a tab, not from the shelf: just save it.
      download(blob, label(frameWrap));
      toast(frameWrap, "Screenshot saved.");
    }
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${String(name).replace(/[\\/:*?"<>|]+/g, " ")} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function flash(frameWrap) {
    const el = document.createElement("div");
    el.className = "nb-flash";
    frameWrap.appendChild(el);
    setTimeout(() => el.remove(), 450);
  }

  let toastTimer = 0;
  function toast(frameWrap, text, actions = []) {
    frameWrap.querySelectorAll(".nb-toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "nb-toast";
    el.setAttribute("role", "status");
    el.innerHTML = `<span>${escapeHtml(text)}</span>${actions.map((a, i) => `<button type="button" data-t="${i}">${escapeHtml(a.label)}</button>`).join("")}`;
    el.addEventListener("click", (event) => {
      const b = event.target.closest("[data-t]");
      if (!b) return;
      actions[Number(b.dataset.t)].run();
      el.remove();
    });
    frameWrap.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), actions.length ? 6000 : 2600);
  }

  // --- quitting ------------------------------------------------------------------------

  // The frame is emptied and its src removed, as beam does before restoring
  // saves: the tab loads the engine afresh on its next boot.
  async function quit(frameWrap) {
    if (skipping.has(frameWrap)) {
      skipping.delete(frameWrap);
      sendKey(frameWrap, "Control", false, false);
    }
    if (window.NoberuText) window.NoberuText.off(frameWrap);
    if (document.fullscreenElement === frameWrap) await document.exitFullscreen().catch(() => { });
    const iframe = frameWrap.querySelector("iframe");
    if (iframe && iframe.getAttribute("src")) {
      await new Promise((resolve) => {
        iframe.addEventListener("load", resolve, { once: true });
        setTimeout(resolve, 2000);
        iframe.src = "about:blank";
      });
      iframe.removeAttribute("src");
    } else if (frameWrap.id === "play-frame-wrap") {
      // Play! lives on this page; its own staging button stops showing it.
      const hide = document.querySelector("#hide-play");
      if (hide) hide.click();
    }
    frameWrap.classList.remove("emulator-maximized", "active");
    const shelfTab = document.querySelector('.tab-button[data-tab="shelf"]');
    if (shelfTab) shelfTab.click();
  }

  // --- ways in ------------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  const MENU_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  function addButtons(frameWrap) {
    const toolbar = frameWrap.querySelector(".play-frame-toolbar");
    if (toolbar && !toolbar.querySelector(".nb-menu-button")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tiny-button nb-menu-button";
      button.innerHTML = `${MENU_SVG}<span>menu</span>`;
      button.title = "noberu menu ( ` )";
      button.addEventListener("click", () => open(frameWrap));
      toolbar.insertBefore(button, toolbar.querySelector("button"));
    }
    if (!frameWrap.querySelector(":scope > .nb-handle")) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "nb-handle";
      handle.setAttribute("aria-label", "noberu menu");
      handle.title = "noberu menu ( ` )";
      handle.innerHTML = MENU_SVG;
      handle.addEventListener("click", () => toggle(frameWrap));
      frameWrap.appendChild(handle);
    }
  }

  document.querySelectorAll(".play-frame-wrap").forEach(addButtons);
  window.NoberuInput.onGameChange((frameWrap, started) => {
    if (started) sessionStart.set(frameWrap, Date.now());
    else {
      if (frame === frameWrap) close(false);
      skipping.delete(frameWrap);
    }
  });

  // ` on this page. Inside a game, assets/runtime.js catches it and calls
  // NoberuMenu.fromFrame (a key pressed in a game never reaches this page).
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Backquote" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest && event.target.closest("input, textarea, [contenteditable]")) return;
    const frameWrap = activeFrame();
    if (!frameWrap && !menu) return;
    event.preventDefault();
    toggle(frameWrap || frame);
  });

  function fromFrame(win) {
    const frameWrap = [...document.querySelectorAll(".play-frame-wrap")].find((wrap) => {
      const iframe = wrap.querySelector("iframe");
      if (!iframe) return false;
      try {
        let w = win;
        for (let depth = 0; depth < 4 && w; depth++) {
          if (w === iframe.contentWindow) return true;
          w = w.parent === w ? null : w.parent;
        }
      } catch (error) { /* another origin */ }
      return false;
    });
    toggle(frameWrap || activeFrame());
  }

  window.NoberuMenu = { open, close, toggle, isOpen, gamepad, fromFrame, toast, screenshot, fullView };
})();
