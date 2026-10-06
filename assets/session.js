/**
 * While a game is open, and picking it back up later.
 *
 * - Keep the screen on: phones dim and lock in the middle of a long read.
 *   A screen wake lock is held whenever a game is running and noberu is the
 *   tab in front (the browser drops it when it is not, so it is asked for
 *   again on the way back). Settings → play turns it off.
 * - Fullscreen on start (desktop; phones always do it, assets/touch.js).
 * - Leaving: closing the tab or going back with a game open asks first,
 *   since a visual novel usually only saves when told to.
 * - Continue: the last game played from downloads is remembered, and the
 *   about tab offers it back with one button. Settings → play can open it
 *   straight away when noberu starts. A folder picked straight into a tab is
 *   not remembered: the browser gives no way back to it without asking again.
 */
(function () {
  "use strict";

  const LAST_KEY = "noberu.lastGame";
  const { onGameChange } = window.NoberuInput;

  function setting(name, fallback) {
    return window.NoberuSettings ? window.NoberuSettings.get(name) : fallback;
  }

  // --- keep the screen on --------------------------------------------------------

  let lock = null;
  let asking = false;

  const playing = () => !!document.querySelector(".play-frame-wrap.active");

  async function updateWakeLock() {
    const want = playing() && !document.hidden && setting("keepAwake", "1") === "1";
    if (!want) {
      if (lock) {
        const held = lock;
        lock = null;
        held.release().catch(() => { });
      }
      return;
    }
    if (lock || asking || !("wakeLock" in navigator)) return;
    asking = true;
    try {
      lock = await navigator.wakeLock.request("screen");
      lock.addEventListener("release", () => { lock = null; });
    } catch (error) {
      // Battery saver, or a browser without it: the screen dims as usual.
    } finally {
      asking = false;
    }
  }

  onGameChange(updateWakeLock);
  document.addEventListener("visibilitychange", updateWakeLock);
  window.addEventListener("noberu-settings", updateWakeLock);

  // --- fullscreen on start, and a warning on the way out ---------------------------

  onGameChange((frameWrap, started) => {
    if (!started || document.documentElement.dataset.touch === "1") return;
    if (setting("fullscreenOnStart", "0") !== "1" || !window.NoberuFullscreenFrame) return;
    window.NoberuFullscreenFrame(frameWrap);
  });

  // Browsers show their own wording; the page only gets to ask.
  window.addEventListener("beforeunload", (event) => {
    if (!playing() || setting("warnLeave", "1") !== "1") return;
    event.preventDefault();
    event.returnValue = "";
  });

  // --- continue ------------------------------------------------------------------

  function readLast() {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY));
    } catch (error) {
      return null;
    }
  }

  // Called by assets/library.js each time a game is handed to a runtime.
  function remember(entry, engine) {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({
        id: entry.id,
        name: entry.name,
        engine: engine || entry.engine,
        at: Date.now(),
      }));
    } catch (error) { /* private mode */ }
    showContinue();
  }

  const card = document.querySelector("#continue-card");

  async function lastEntry() {
    const last = readLast();
    if (!last || !window.NoberuLibrary) return null;
    const entries = await window.NoberuLibrary.list().catch(() => []);
    return entries.find((entry) => entry.id === last.id) ? last : null;
  }

  async function showContinue() {
    if (!card) return;
    const last = await lastEntry();
    card.classList.toggle("hidden", !last);
    if (last) card.querySelector("#continue-name").textContent = last.name;
  }

  async function resume() {
    const last = await lastEntry();
    if (!last) return showContinue();
    const button = card && card.querySelector("#continue-play");
    if (button) button.disabled = true;
    try {
      await window.NoberuLibrary.play(last.id, last.engine);
    } catch (error) {
      console.error(error);
      alert(String((error && error.message) || error));
    } finally {
      if (button) button.disabled = false;
    }
  }

  if (card) card.querySelector("#continue-play").addEventListener("click", resume);
  showContinue();

  // Straight back in on launch, if asked for - but not over the first-visit
  // popup, the tour or an incoming beam, and not into a linked folder the
  // browser would first have to ask permission for (that needs a tap).
  window.addEventListener("load", async () => {
    if (setting("openLast", "0") !== "1" || window.NoberuBeamLink) return;
    const welcome = document.querySelector("#welcome-backdrop");
    if (welcome && !welcome.classList.contains("hidden")) return;
    const last = await lastEntry();
    if (!last) return;
    const entry = (await window.NoberuLibrary.list()).find((e) => e.id === last.id);
    if (!entry || entry.kind === "linked") return;
    resume();
  });

  window.NoberuSession = { remember, resume };
})();
