/**
 * Report a problem: a short note from the player plus what noberu knows (the
 * browser, the engine, the game, and the errors every runtime frame logged
 * through NoberuLog in assets/runtime.js), as a GitHub issue ready to send
 * or as text to paste anywhere.
 *
 * Nothing is sent by noberu itself. "open a GitHub issue" opens GitHub's own
 * new-issue page with the text filled in, where the player reads it and
 * decides; "copy" only puts it on the clipboard.
 *
 *   NoberuReport.open({ game, engine, frame })
 */
(function () {
  "use strict";

  const ISSUES = "https://github.com/kitakitaaura/noberu/issues/new";
  const VERSION = "v0.4 beta";
  // GitHub refuses very long URLs; the rest can be pasted from the clipboard.
  const URL_BODY_MAX = 6000;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  function browser() {
    const ua = navigator.userAgent;
    const name = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
      : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "unknown";
    const version = (ua.match(/(?:Edg|OPR|Firefox|CriOS|Chrome|Version)\/([\d.]+)/) || [])[1] || "";
    const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS"
      : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "unknown";
    return `${name} ${version.split(".")[0]} on ${os}`;
  }

  async function details(context, withGame) {
    let space = "";
    try {
      const { usage, quota } = await navigator.storage.estimate();
      space = `${Math.round(usage / 1048576)} MB of ${Math.round(quota / 1048576)} MB`;
    } catch (error) { /* not reported */ }
    const tab = document.querySelector(".tab-button[aria-selected=true]");
    const lines = [
      `noberu ${VERSION} · ${location.host}`,
      `browser: ${browser()}`,
      `screen: ${screen.width}x${screen.height} @${window.devicePixelRatio}x` +
        `${document.documentElement.dataset.touch === "1" ? " · touch" : ""}` +
        `${matchMedia("(display-mode: standalone)").matches ? " · installed app" : ""}`,
      `cross-origin isolated: ${self.crossOriginIsolated ? "yes" : "no"}` + (space ? ` · storage: ${space}` : ""),
      `tab: ${tab ? tab.dataset.tab : "?"}` + (context.engine ? ` · engine: ${context.engine}` : ""),
    ];
    if (withGame && context.game) lines.push(`game: ${context.game}`);
    const log = (window.NoberuLog && window.NoberuLog.lines) || [];
    const recent = log.slice(-40).map((l) =>
      `${new Date(l.t).toISOString().slice(11, 19)} ${l.level === "error" ? "E" : "W"} [${l.where}] ${l.text}`);
    return { summary: lines.join("\n"), log: recent.join("\n") };
  }

  function compose(note, info) {
    return [
      "**What happened**",
      note.trim() || "_(not described)_",
      "",
      "**Details**",
      "```",
      info.summary,
      "```",
      info.log ? "**Recent errors and warnings**\n```\n" + info.log + "\n```" : "_No errors were logged._",
    ].join("\n");
  }

  let box = null;

  async function open(context = {}) {
    if (box) box.remove();
    box = document.createElement("div");
    box.className = "library-backdrop report-backdrop";
    box.innerHTML = `
      <div class="library-modal report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div class="library-bar">
          <b id="report-title">report a problem</b>
          <button class="tiny-button" type="button" data-r="close">close</button>
        </div>
        <div class="library-add">
          <label class="report-field">
            <span>What happened?</span>
            <textarea rows="4" data-r="note" placeholder="The game froze after the opening movie..."></textarea>
          </label>
          ${context.game ? `<label class="report-check"><input type="checkbox" data-r="game" checked /> include the game's name (${escapeHtml(context.game)})</label>` : ""}
          <details class="report-details">
            <summary>what gets included</summary>
            <pre data-r="preview">...</pre>
          </details>
          <p class="control-note">Nothing is sent from here. GitHub opens with this filled in, and you post it there. No GitHub account? Copy it and send it to <b>farisnyanyann</b> on Discord.</p>
        </div>
        <div class="library-foot report-foot">
          <span data-r="status" role="status"></span>
          <button class="retro-button secondary" type="button" data-r="copy">copy</button>
          <button class="retro-button" type="button" data-r="github">open a GitHub issue</button>
        </div>
      </div>`;
    document.body.appendChild(box);

    const $ = (name) => box.querySelector(`[data-r="${name}"]`);
    const withGame = () => !$("game") || $("game").checked;
    let info = await details(context, withGame());
    const refresh = async () => {
      info = await details(context, withGame());
      $("preview").textContent = compose($("note").value, info);
    };
    refresh();
    $("note").addEventListener("input", () => {
      $("preview").textContent = compose($("note").value, info);
    });
    if ($("game")) $("game").addEventListener("change", refresh);

    const close = () => {
      box.remove();
      box = null;
    };
    $("close").addEventListener("click", close);
    box.addEventListener("click", (event) => {
      if (event.target === box) close();
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });

    $("copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(compose($("note").value, info));
        $("status").textContent = "Copied.";
      } catch (error) {
        $("status").textContent = "Couldn't copy; select the text under “what gets included”.";
        box.querySelector(".report-details").open = true;
      }
    });

    $("github").addEventListener("click", async () => {
      const note = $("note").value;
      let body = compose(note, info);
      if (body.length > URL_BODY_MAX) {
        body = body.slice(0, URL_BODY_MAX) + "\n```\n_(cut short; the rest was copied to the clipboard)_";
        navigator.clipboard && navigator.clipboard.writeText(compose(note, info)).catch(() => { });
      }
      const title = (note.trim().split("\n")[0] || "Problem report").slice(0, 80) +
        (withGame() && context.game ? ` (${context.game})` : "");
      const url = `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=report`;
      window.open(url, "_blank", "noopener,noreferrer");
      $("status").textContent = "Opened on GitHub.";
    });

    $("note").focus();
  }

  window.NoberuReport = { open };
})();
