/**
 * noberu as an app on phones: asks to be added to the home screen.
 *
 *   NoberuInstall.firstRun(next) - index.html's start-up: on a phone or tablet
 *       in the browser (not the installed app), the steps open first, once per
 *       visit; `next` (the welcome notice and tour) runs when they close.
 *   NoberuInstall.open()         - the "app" button in the top bar
 *
 * Why it matters: an installed app opens full screen, and on iPhone it is the
 * only way to keep games and saves - Safari deletes a site's storage after a
 * week without a visit, home screen apps are exempt.
 *
 * Detecting "installed": inside the app, display-mode is fullscreen/standalone
 * (or navigator.standalone on iOS). From the browser, Android reports an
 * install (appinstalled) but iOS says nothing, so the popup also has "done"
 * for people to tell us. Either way the app button goes away for good.
 */
(function () {
  "use strict";

  const INSTALLED_KEY = "noberu.app.installed";
  const SHOWN_KEY = "noberu.app.prompted";  // sessionStorage: once per visit

  const root = document.documentElement;
  const ua = navigator.userAgent;
  const isTouch = root.dataset.touch === "1";
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);

  function standalone() {
    return navigator.standalone === true ||
      ["fullscreen", "standalone", "minimal-ui"].some((mode) =>
        matchMedia(`(display-mode: ${mode})`).matches);
  }

  function read(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;  // blocked storage: treat as not set
    }
  }

  function write(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) { /* blocked storage: it will just ask again */ }
  }

  function installed() {
    return standalone() || read(localStorage, INSTALLED_KEY) === "1";
  }

  // Chrome and Edge on Android hand over their own install dialog; holding on
  // to the event lets the popup's button open it.
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    render();
  });
  window.addEventListener("appinstalled", () => markInstalled());

  // --- the steps for this phone ------------------------------------------------

  const SHARE = `<svg class="install-glyph" viewBox="0 0 16 16" aria-label="share" role="img"><path d="M8 1.5v8M5 4.5 8 1.5l3 3M4 7H2.5v7.5h11V7H12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function steps() {
    if (isIos) {
      if (/FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat|Discord/i.test(ua)) {
        return {
          lead: "This app's built-in browser can't add to the home screen.",
          list: ["Open this page in <b>Safari</b> (look for <b>Open in browser</b> in the menu).",
            "Then come back here for the steps."],
        };
      }
      if (/CriOS|FxiOS|EdgiOS/.test(ua)) {
        return {
          list: [`Tap ${SHARE} <b>Share</b> in the address bar.`,
            "Tap <b>Add to Home Screen</b>, then <b>Add</b>.",
            "Open noberu from your home screen."],
        };
      }
      return {
        list: [`Tap ${SHARE} <b>Share</b>. On iOS 26 it's inside the <b>•••</b> button.`,
          "Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.",
          "Open noberu from your home screen."],
      };
    }
    if (isAndroid && /SamsungBrowser/.test(ua)) {
      return {
        list: ["Tap the <b>☰</b> menu.", "Tap <b>Add page to</b>, then <b>Home screen</b>.",
          "Open noberu from your home screen."],
      };
    }
    if (isAndroid && /Firefox/.test(ua)) {
      return {
        list: ["Tap the <b>⋮</b> menu.", "Tap <b>Add app to Home screen</b>.",
          "Open noberu from your home screen."],
      };
    }
    return {
      list: ["Tap the <b>⋮</b> menu.", "Tap <b>Add to home screen</b> or <b>Install app</b>.",
        "Open noberu from your home screen."],
    };
  }

  // --- popup -------------------------------------------------------------------

  let backdrop = null;
  let onClose = null;

  function build() {
    backdrop = document.createElement("div");
    backdrop.className = "library-backdrop hidden";
    backdrop.id = "install-backdrop";
    backdrop.innerHTML = `
      <div class="library-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <div class="library-bar">
          <b id="install-title">get the noberu app</b>
          <button class="tiny-button" type="button" data-act="close" aria-label="close">✕</button>
        </div>
        <div class="library-add install-body"></div>
        <div class="library-foot install-foot"></div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("[data-act=close]").addEventListener("click", close);
    backdrop.addEventListener("click", async (event) => {
      const act = event.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "install" && deferred) {
        const prompt = deferred;
        deferred = null;
        prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        if (choice && choice.outcome === "accepted") markInstalled();
        else render();
      } else if (act.dataset.act === "done") {
        markInstalled();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && backdrop && !backdrop.classList.contains("hidden")) close();
    });
  }

  function render() {
    if (!backdrop) return;
    const { lead, list } = steps();
    const body = backdrop.querySelector(".install-body");
    const why = isIos
      ? "Full screen, and your games and saves are kept. Safari deletes them after a week away; the app doesn't."
      : "Full screen, with its own icon, and your games stay put.";
    body.innerHTML = `
      <p class="control-note">${why}</p>
      ${deferred ? "" : `${lead ? `<p class="control-note">${lead}</p>` : ""}
      <ol class="install-steps">${list.map((item) => `<li><span>${item}</span></li>`).join("")}</ol>`}
      ${isIos ? `<p class="control-note install-small">The app keeps its own games and saves, separate from Safari's.</p>` : ""}`;
    backdrop.querySelector(".install-foot").innerHTML = deferred
      ? `<button class="retro-button" type="button" data-act="install">install</button>
         <button class="retro-button secondary" type="button" data-act="done">already installed</button>`
      : `<button class="retro-button secondary" type="button" data-act="done">done, it's on my home screen</button>`;
  }

  function open(next) {
    if (!backdrop) build();
    onClose = typeof next === "function" ? next : null;
    render();
    backdrop.classList.remove("hidden");
    const first = backdrop.querySelector(".install-foot .retro-button") || backdrop.querySelector("[data-act=close]");
    if (first) first.focus();
  }

  function close() {
    if (!backdrop || backdrop.classList.contains("hidden")) return;
    backdrop.classList.add("hidden");
    const next = onClose;
    onClose = null;
    // Next tick: closing with Escape must not also dismiss what opens next
    // (the welcome notice listens for the same keypress).
    if (next) setTimeout(next, 0);
  }

  function markInstalled() {
    write(localStorage, INSTALLED_KEY, "1");
    updateButton();
    close();
  }

  // --- the top bar button ------------------------------------------------------

  const button = document.querySelector("#app-button");

  function updateButton() {
    if (button) button.hidden = !isTouch || installed();
  }

  if (button) button.addEventListener("click", () => open());
  updateButton();
  // Running as the app: remember it, so this browser's tab stops asking too
  // where the two share storage (Android).
  if (standalone()) write(localStorage, INSTALLED_KEY, "1");

  window.NoberuInstall = {
    open,
    installed,
    // Start-up: the steps first on a phone in the browser, once per visit;
    // `next` runs straight away otherwise, or when the popup closes.
    firstRun(next) {
      if (!isTouch || installed() || read(sessionStorage, SHOWN_KEY) === "1") return next();
      write(sessionStorage, SHOWN_KEY, "1");
      open(next);
    },
  };
})();
