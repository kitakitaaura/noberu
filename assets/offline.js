/**
 * Playing offline, only with the person's say-so.
 *
 * Games and saves already live on the device; what offline play adds is the
 * engines (a few MB to 60 MB each). Nothing is stored for that until the
 * person agrees, and they choose how much:
 *
 *   "all"  - every engine for this device, downloaded now, kept up to date
 *   "play" - each engine is kept the first time a game runs on it
 *
 * Turning it on creates the ENGINES cache, which is what sw.js looks for;
 * turning it off deletes that cache. The sizes come from offline.json
 * (tools/offline-manifest.mjs, rebuilt on every deploy).
 *
 *   NoberuOffline.askOnce(next) - the home screen app's first launch asks once
 *   NoberuOffline.renderInto(el) - settings → offline
 */
(function () {
  "use strict";

  const SHELL = "noberu-shell-v1";      // sw.js
  const ENGINES = "noberu-engines-v1";  // sw.js
  const MODE_KEY = "noberu.offline";    // "all" | "play" | absent
  const ASKED_KEY = "noberu.offline.asked";

  const LABELS = {
    "ponscripter-runtime": "ponscripter",
    "onscripter-runtime": "onscripter",
    "onscripter-ru-runtime": "umineko",
    "rlvm-runtime": "rlvm",
    "vnds-runtime": "vnds",
    "play-runtime": "ps2",
    "renpy-runtime": "ren'py",
    "kirikiri-runtime": "kirikiri",
    "siglus-runtime": "siglus",
    "tyrano-runtime": "tyrano",
    "rpgmaker-runtime": "rpg maker",
    "boxedwine-runtime": "wine (Windows)",
  };

  const isTouch = document.documentElement.dataset.touch === "1";

  function read(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }
  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (error) { /* blocked storage */ }
  }
  const mode = () => read(MODE_KEY);

  function standalone() {
    return navigator.standalone === true ||
      ["fullscreen", "standalone", "minimal-ui"].some((m) => matchMedia(`(display-mode: ${m})`).matches);
  }

  function mb(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  }

  // --- what there is -----------------------------------------------------------

  let manifestPromise = null;
  function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetch("offline.json", { cache: "no-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`offline.json: ${response.status}`);
          return response.json();
        })
        .catch((error) => { manifestPromise = null; throw error; });
    }
    return manifestPromise;
  }

  // The engines this device can run (the Windows one is desktop only).
  async function engines() {
    const { engines: all } = await manifest();
    return Object.entries(all)
      .filter(([dir]) => !(isTouch && dir === "boxedwine-runtime"))
      .map(([dir, info]) => ({ dir, label: LABELS[dir] || dir.replace(/-runtime$/, ""), ...info }));
  }

  const totalBytes = (list) => list.reduce((sum, e) => sum + e.bytes, 0);

  // The URL a file is fetched and stored by. Pages answers x.html with a
  // redirect to x (and d/index.html with d/), and the tabs load pages by
  // those names, so a page is kept under its extensionless URL.
  function keptUrl(path) {
    if (path.endsWith("/index.html")) return path.slice(0, -"index.html".length);
    if (path.endsWith(".html")) return path.slice(0, -".html".length);
    return path;
  }

  // How much of each engine is stored.
  async function status() {
    const list = await engines();
    const stored = new Set();
    if (await caches.has(ENGINES)) {
      for (const request of await (await caches.open(ENGINES)).keys()) {
        stored.add(new URL(request.url).pathname.replace(/^\//, ""));
      }
    }
    return list.map((engine) => {
      const kept = engine.files.filter(([path]) => stored.has(keptUrl(path)));
      return { ...engine, keptBytes: kept.reduce((sum, [, size]) => sum + size, 0), complete: kept.length === engine.files.length };
    });
  }

  // --- storing -----------------------------------------------------------------

  // The page itself, so noberu opens offline: everything it loaded.
  async function keepShell() {
    const cache = await caches.open(SHELL);
    const urls = new Set(["/", "manifest.webmanifest", "offline.json"]);
    document.querySelectorAll("script[src], link[rel=stylesheet][href], link[rel~=icon][href], link[rel=apple-touch-icon][href], img[src]")
      .forEach((el) => {
        const url = new URL(el.src || el.href, location.href);
        if (url.origin === location.origin) urls.add(url.pathname + url.search);
      });
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: "no-cache" });
        if (response.ok && !response.redirected) await cache.put(url, response);
      } catch (error) { /* offline already: what is there stays */ }
    }
  }

  // Stores one URL unless the stored copy is already current.
  async function keep(cache, url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok || response.redirected) throw new Error(`${url}: ${response.status}`);
    const stored = await cache.match(url);
    const tag = response.headers.get("etag");
    if (stored && tag && stored.headers.get("etag") === tag) {
      await response.body?.cancel();
      return false;
    }
    await cache.put(url, response);
    return true;
  }

  // Every engine for this device. onProgress(doneBytes, totalBytes).
  async function downloadAll(onProgress) {
    const list = await engines();
    const total = totalBytes(list);
    const cache = await caches.open(ENGINES);
    const jobs = [];
    for (const engine of list) {
      for (const [path, size] of engine.files) jobs.push({ url: keptUrl(path), size });
    }
    let done = 0;
    let next = 0;
    let failed = 0;
    async function worker() {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          await keep(cache, job.url);
        } catch (error) {
          // A full device stops everything; one missing file just counts.
          if (error && error.name === "QuotaExceededError") throw error;
          console.warn("noberu offline:", error);
          failed++;
        }
        done += job.size;
        if (onProgress) onProgress(done, total);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (failed) throw new Error(`${failed} engine file${failed === 1 ? "" : "s"} could not be downloaded.`);
  }

  async function enable(choice, onProgress) {
    await caches.open(ENGINES);  // from here on sw.js keeps engines
    write(MODE_KEY, choice);
    write(ASKED_KEY, "1");
    // Stored engines are worth protecting from the browser's clean-ups.
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (error) { /* fine */ }
    await keepShell();
    if (choice === "all") await downloadAll(onProgress);
  }

  async function disable() {
    await caches.delete(ENGINES);
    write(MODE_KEY, null);
    write(ASKED_KEY, "1");
    document.dispatchEvent(new Event("noberu-offline"));
  }

  // --- the airplane next to the logo -------------------------------------------
  //
  // Grey while offline play is on, orange while there is no connection (noberu
  // is then running from what this device keeps, whether or not offline play
  // is on). navigator.onLine stays true on Wi-Fi with no internet, so a tiny
  // request that skips every cache settles it; sw.js leaves HEAD alone.
  const badge = document.querySelector("#offline-badge");

  async function reachable() {
    if (!navigator.onLine) return false;
    try {
      await fetch("manifest.webmanifest", { method: "HEAD", cache: "no-store" });
      return true;
    } catch (error) {
      return false;
    }
  }

  async function updateBadge() {
    if (!badge) return;
    const online = await reachable();
    badge.hidden = online && !mode();
    badge.dataset.state = online ? "on" : "offline";
    const label = online ? "offline play is on" : "offline: playing from this device";
    badge.title = label;
    badge.setAttribute("aria-label", label);
  }

  if (badge) {
    badge.addEventListener("click", () => {
      if (window.NoberuSettings) window.NoberuSettings.open("offline");
    });
    window.addEventListener("online", updateBadge);
    window.addEventListener("offline", updateBadge);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") updateBadge();
    });
    document.addEventListener("noberu-offline", updateBadge);
    updateBadge();
  }

  // "all" means all, including engines added or updated since: top up
  // quietly once the page has settled, if online.
  if (mode() === "all") {
    setTimeout(() => {
      if (navigator.onLine) downloadAll().catch((error) => console.warn("noberu offline top-up:", error));
    }, 8000);
  }

  // --- asking ------------------------------------------------------------------

  let backdrop = null;

  function errorText(error) {
    if (error && error.name === "QuotaExceededError") return "Not enough space on this device.";
    return navigator.onLine ? "Something went wrong. Try again later." : "You're offline. Try again when connected.";
  }

  async function ask(next) {
    let list;
    try {
      list = await engines();
    } catch (error) {
      if (next) next();
      return;
    }
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "library-backdrop";
      backdrop.id = "offline-backdrop";
      document.body.appendChild(backdrop);
    }
    const playMax = Math.max(...list.map((e) => e.bytes));
    backdrop.innerHTML = `
      <div class="library-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="offline-title">
        <div class="library-bar"><b id="offline-title">play offline?</b></div>
        <div class="library-add">
          <p class="control-note">Your games and saves are already on this device. To play them without internet, noberu also needs to keep its engines.</p>
          <p class="control-note install-small">Nothing is downloaded unless you choose. You can change this or free the space in settings → offline.</p>
          <p class="control-note offline-progress" hidden></p>
        </div>
        <div class="library-foot install-foot">
          <button class="retro-button" type="button" data-choice="all">all engines now · ${mb(totalBytes(list))}</button>
          <button class="retro-button secondary" type="button" data-choice="play">only the ones I play · up to ${mb(playMax)} each</button>
          <button class="retro-button secondary" type="button" data-choice="no">not now</button>
        </div>
      </div>`;
    backdrop.classList.remove("hidden");
    const progress = backdrop.querySelector(".offline-progress");
    const buttons = [...backdrop.querySelectorAll("[data-choice]")];
    const finish = () => {
      backdrop.classList.add("hidden");
      document.dispatchEvent(new Event("noberu-offline"));
      if (next) setTimeout(next, 0);
    };
    buttons.forEach((button) => button.addEventListener("click", async () => {
      const choice = button.dataset.choice;
      if (choice === "no") {
        write(ASKED_KEY, "1");
        return finish();
      }
      buttons.forEach((b) => { b.disabled = true; });
      progress.hidden = false;
      progress.textContent = choice === "all" ? "Starting the download..." : "Turning it on...";
      try {
        await enable(choice, (done, total) => {
          progress.textContent = `Downloading engines: ${mb(done)} of ${mb(total)}. Keep noberu open.`;
        });
        finish();
      } catch (error) {
        console.error(error);
        progress.textContent = errorText(error) + (choice === "all" ? " What finished downloading is kept." : "");
        buttons.forEach((b) => { b.disabled = false; });
      }
    }));
    buttons[0].focus();
  }

  // --- settings → offline --------------------------------------------------------

  async function renderInto(el) {
    el.innerHTML = `<p class="settings-note">checking...</p>`;
    let list;
    try {
      list = await status();
    } catch (error) {
      el.innerHTML = `<p class="settings-note">Offline play isn't available here.</p>`;
      return;
    }
    const current = mode();
    const keptBytes = list.reduce((sum, e) => sum + e.keptBytes, 0);
    const missing = list.filter((e) => !e.complete);
    const summary = !current
      ? "Off. Engines load from the internet each time, so games need a connection."
      : current === "all"
        ? `On: every engine is kept and updated (${mb(keptBytes)} stored).`
        : `On: each engine is kept the first time you play it (${mb(keptBytes)} stored).`;
    el.innerHTML = `
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>play offline</b><small>${summary}</small></span>
        ${current
          ? `<button class="retro-button secondary" type="button" data-offline="off">turn off</button>`
          : `<button class="retro-button secondary" type="button" data-offline="on">turn on</button>`}
      </div>
      ${current && missing.length ? `
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>download the rest</b><small>${mb(totalBytes(missing) - missing.reduce((s, e) => s + e.keptBytes, 0))} for ${missing.length} engine${missing.length === 1 ? "" : "s"} not kept yet.</small></span>
        <button class="retro-button secondary" type="button" data-offline="all">download</button>
      </div>` : ""}
      <p class="settings-note offline-progress" hidden></p>
      ${current ? `
      <div class="compat settings-tested">
        <dl>
          ${list.map((e) => `<dt>${e.label}</dt><dd>${e.complete ? "kept" : e.keptBytes ? `part kept <small>${mb(e.keptBytes)} of ${mb(e.bytes)}</small>` : `not kept <small>${mb(e.bytes)}</small>`}</dd>`).join("")}
        </dl>
      </div>` : `<p class="settings-note">Your games and saves are on this device either way.</p>`}`;

    const progress = el.querySelector(".offline-progress");
    el.querySelectorAll("[data-offline]").forEach((button) => button.addEventListener("click", async () => {
      const act = button.dataset.offline;
      if (act === "on") return ask(() => renderInto(el));
      if (act === "off") {
        if (!confirm(`Turn off offline play and free ${mb(keptBytes)}?\n\nYour games and saves are not touched.`)) return;
        await disable();
        return renderInto(el);
      }
      button.disabled = true;
      progress.hidden = false;
      try {
        if (mode() !== "all") write(MODE_KEY, "all");
        await downloadAll((done, total) => {
          progress.textContent = `Downloading engines: ${mb(done)} of ${mb(total)}. Keep noberu open.`;
        });
        renderInto(el);
      } catch (error) {
        console.error(error);
        progress.textContent = errorText(error) + " What finished downloading is kept.";
        button.disabled = false;
      }
    }));
  }

  window.NoberuOffline = {
    ask,
    renderInto,
    // The home screen app's first launch asks once; everyone else turns it on
    // in settings.
    askOnce(next) {
      if (!standalone() || mode() || read(ASKED_KEY) === "1" || !("caches" in window)) return next();
      ask(next);
    },
  };
})();
