// noberu's loading screen for both Ren'Py runtime pages.
//
// Ren'Py's web shells come with their own: a grey log box pinned to the top
// with a browser <progress> bar (and, on 7.x, a green spinner), which shows
// every line the engine prints, Python's import log included. Inside noberu
// the frame should look like the other runtimes (kirikiri-runtime's
// noberu-skin.css): a black stage, a hairline bar in the middle and one quiet
// line of status, with the same layout on a phone.
//
// While the game loads this overlay covers the stage and the shells' own
// status boxes are hidden (html.noberu-loading-on). Once the game has drawn its
// first frame it fades out; whatever the engine prints after that shows as a
// small card at the bottom instead of the top bar. Errors become a card in the
// middle.
//
//   NoberuLoading.say(text)            one line; "N of M" in it fills the bar
//   NoberuLoading.progress(done, total) a known amount; null total = unknown
//   NoberuLoading.error(text)          the error card (stays up)
//   NoberuLoading.done()               fade out once the game is on screen
(function (global) {
  "use strict";

  const CSS = `
    :root {
      --nb-stage: #000;
      --nb-panel: #0b0b0b;
      --nb-ink: #e4e4e4;
      --nb-muted: #8b8b93;
      --nb-line: rgba(255, 255, 255, 0.09);
      --nb-line-strong: rgba(255, 255, 255, 0.16);
      --nb-accent: #2f8af9;
      --nb-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
        "IBM Plex Mono", "Courier New", monospace;
    }

    #noberu-loading {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 16px;
      box-sizing: border-box;
      background: var(--nb-stage);
      color: var(--nb-muted);
      font: 12px/1.5 var(--nb-mono);
      letter-spacing: 0.02em;
      text-align: center;
      transition: opacity 0.3s ease;
    }

    #noberu-loading.leaving {
      opacity: 0;
      pointer-events: none;
    }

    #noberu-loading .nb-bar {
      position: relative;
      width: min(240px, 60vw);
      height: 2px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--nb-line-strong);
    }

    #noberu-loading .nb-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0;
      border-radius: 999px;
      background: var(--nb-accent);
      transition: width 0.2s ease;
    }

    /* Nothing to measure: a short segment sliding across. */
    #noberu-loading .nb-bar.unknown .nb-fill {
      width: 30%;
      transition: none;
      animation: nb-slide 1.4s ease-in-out infinite;
    }

    @keyframes nb-slide {
      from { transform: translateX(-100%); }
      to { transform: translateX(340%); }
    }

    @media (prefers-reduced-motion: reduce) {
      #noberu-loading .nb-bar.unknown .nb-fill {
        animation: none;
        width: 100%;
        opacity: 0.4;
      }
    }

    #noberu-loading .nb-line {
      max-width: min(420px, 90vw);
      min-height: 1.5em;
      overflow-wrap: anywhere;
    }

    #noberu-loading .nb-card {
      display: none;
      max-width: min(440px, 100%);
      padding: 20px 22px;
      box-sizing: border-box;
      border: 1px solid var(--nb-line-strong);
      border-radius: 12px;
      background: var(--nb-panel);
      text-align: left;
    }

    #noberu-loading.failed .nb-bar,
    #noberu-loading.failed .nb-line {
      display: none;
    }

    #noberu-loading.failed .nb-card {
      display: block;
    }

    #noberu-loading .nb-card h2 {
      margin: 0 0 8px;
      color: var(--nb-ink);
      font: 600 15px/1.4 var(--nb-mono);
    }

    #noberu-loading .nb-card p {
      margin: 0;
      max-height: 40vh;
      overflow: auto;
      color: var(--nb-muted);
      font-size: 13px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    /* The shells' own status boxes: hidden while loading, then a small card
       at the bottom for anything the engine prints during play. */
    html.noberu-loading-on #statusDiv,
    html.noberu-loading-on #statusbar_container,
    html.noberu-loading-on #presplash {
      display: none !important;
    }

    #statusDiv,
    #statusbar_container #statusbar {
      top: auto !important;
      bottom: max(12px, env(safe-area-inset-bottom)) !important;
      width: auto !important;
      min-width: 0 !important;
      max-width: min(560px, calc(100% - 32px));
      height: auto !important;
      margin: 0 auto !important;
      padding: 8px 12px !important;
      border: 1px solid var(--nb-line);
      border-radius: 10px !important;
      background: rgba(11, 11, 11, 0.88) !important;
      color: var(--nb-muted) !important;
      font: 12px/1.5 var(--nb-mono) !important;
      pointer-events: none;
    }

    #statusbar_container {
      top: auto !important;
      bottom: 0;
      left: 0;
      right: 0;
      pointer-events: none;
    }

    #statusbar_container #statusbar {
      position: relative;
      bottom: auto !important;
      margin: 0 auto max(12px, env(safe-area-inset-bottom)) !important;
    }

    #statusbar_container #statusbar > div {
      margin-left: 0 !important;
    }

    #statusbar_container #status {
      color: var(--nb-muted) !important;
      font-weight: normal !important;
      text-align: center !important;
      padding: 0 !important;
    }

    #statusbar_container #spinner,
    #statusbar_container #progress,
    #statusProgress {
      display: none !important;
    }

    #statusTextDiv {
      max-height: 6em !important;
    }
  `;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  document.documentElement.classList.add("noberu-loading-on");

  const root = document.createElement("div");
  root.id = "noberu-loading";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.innerHTML =
    '<div class="nb-bar unknown"><div class="nb-fill"></div></div>' +
    '<div class="nb-line">loading...</div>' +
    '<div class="nb-card" role="alert"><h2>The game stopped</h2><p></p></div>';

  const bar = root.querySelector(".nb-bar");
  const fill = root.querySelector(".nb-fill");
  const line = root.querySelector(".nb-line");
  const detail = root.querySelector(".nb-card p");
  let finished = false;

  function attach() {
    if (!root.isConnected && document.body) document.body.appendChild(root);
  }
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach);

  function progress(done, total) {
    if (finished) return;
    if (!total || !(done >= 0)) {
      bar.classList.add("unknown");
      fill.style.width = "";
      return;
    }
    bar.classList.remove("unknown");
    fill.style.width = Math.max(0, Math.min(100, (done / total) * 100)) + "%";
  }

  function say(text) {
    if (finished || !text) return;
    line.textContent = String(text);
    const amount = /(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?)/.exec(text);
    progress(amount ? Number(amount[1]) : null, amount ? Number(amount[2]) : null);
  }

  function error(text) {
    attach();
    finished = true;
    document.documentElement.classList.add("noberu-loading-on");
    root.classList.remove("leaving");
    root.classList.add("failed");
    detail.textContent = String(text || "Something went wrong.");
  }

  function done() {
    if (finished) return;
    finished = true;
    document.documentElement.classList.remove("noberu-loading-on");
    root.classList.add("leaving");
    setTimeout(() => root.remove(), 400);
  }

  global.NoberuLoading = { say: say, progress: progress, error: error, done: done };
})(window);
