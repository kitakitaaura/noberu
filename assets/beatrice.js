/**
 * Talk to Beatrice: a small chat dialog opened from the About tab.
 *
 * Messages go to the beatrice-bot Worker (POST /chat), which holds the persona prompt and the
 * model; nothing about the games a visitor has leaves the page. The Worker allows noberu's
 * origins only, and rate limits per visitor.
 *
 *   ?beatrice-server=URL   overrides the Worker (locally it is `wrangler dev` on :8787)
 *
 * The conversation lives in this tab (sessionStorage) and the last few turns are sent along.
 */
(function () {
  "use strict";

  const MAX_SENT = 8;
  const MAX_CHARS = 500;
  const GREETING = "……Hoh? A visitor to the Golden Witch's board? Speak, furniture. Do try to be entertaining!";
  const SPOILER_KEY = "noberu.beatrice.spoilers";
  const LOG_KEY = "noberu.beatrice.log";

  function server() {
    const override = new URLSearchParams(location.search).get("beatrice-server");
    if (override) return override.replace(/\/$/, "");
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      return `http://${location.hostname}:8787`;
    }
    return "https://beatrice.kitaaura.com";
  }

  function store(storage, key, value) {
    try {
      if (value === undefined) return storage.getItem(key);
      storage.setItem(key, value);
    } catch (error) {
      /* private window or blocked storage: the chat still works, it just forgets */
    }
    return null;
  }

  let log = [];
  try {
    log = JSON.parse(store(sessionStorage, LOG_KEY) || "[]").filter((m) => m && typeof m.content === "string");
  } catch (error) {
    log = [];
  }

  let root = null;
  let opener = null;
  let busy = false;

  // Beatrice writes an absolute statement as a ```diff block so Discord shows it red.
  // Here that becomes a red line; everything else is plain text (never HTML).
  function render(el, text) {
    el.textContent = "";
    text.split("```").forEach((part, index) => {
      if (!part) return;
      if (index % 2 === 0) {
        el.append(document.createTextNode(part));
        return;
      }
      const span = document.createElement("span");
      span.className = "bt-red";
      span.textContent = part.replace(/^diff\n/, "").replace(/^[-+] ?/gm, "").trim();
      el.append(span);
    });
  }

  function bubble(role, text, extra) {
    const el = document.createElement("div");
    el.className = `bt-msg bt-${role}${extra ? ` ${extra}` : ""}`;
    render(el, text);
    root.querySelector(".bt-log").append(el);
    el.scrollIntoView({ block: "end" });
    return el;
  }

  function save() {
    store(sessionStorage, LOG_KEY, JSON.stringify(log.slice(-40)));
  }

  function build() {
    root = document.createElement("div");
    root.className = "bt-backdrop";
    root.hidden = true;
    root.innerHTML = `
      <div class="bt-card" role="dialog" aria-modal="true" aria-labelledby="bt-title">
        <header class="bt-head">
          <b id="bt-title">Beatrice</b>
          <label class="bt-spoilers">
            <span>spoilers</span>
            <select aria-label="how much she may spoil">
              <option value="none">none</option>
              <option value="ep4">episodes 1-4</option>
              <option value="all">everything</option>
            </select>
          </label>
          <button type="button" class="bt-close" aria-label="close">×</button>
        </header>
        <div class="bt-log" role="log" aria-live="polite"></div>
        <form class="bt-form" autocomplete="off">
          <input type="text" maxlength="${MAX_CHARS}" placeholder="say something to the witch" aria-label="message" />
          <button type="submit" class="retro-button">send</button>
        </form>
        <p class="bt-note">An AI character bot, not the real Beatrice. It can be wrong about the story.</p>
      </div>`;
    document.body.append(root);

    const select = root.querySelector("select");
    select.value = store(localStorage, SPOILER_KEY) || "none";
    select.addEventListener("change", () => store(localStorage, SPOILER_KEY, select.value));

    root.querySelector(".bt-close").addEventListener("click", close);
    root.addEventListener("mousedown", (event) => {
      if (event.target === root) close();
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    root.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      send();
    });

    bubble("bot", GREETING);
    for (const m of log) bubble(m.role === "user" ? "me" : "bot", m.content);
  }

  async function send() {
    const input = root.querySelector("input");
    const text = input.value.trim().slice(0, MAX_CHARS);
    if (!text || busy) return;
    busy = true;
    input.value = "";
    log.push({ role: "user", content: text });
    bubble("me", text);
    const wait = bubble("bot", "……", "bt-wait");
    root.querySelector(".bt-form").classList.add("busy");

    let reply = null;
    let failed = false;
    let resetAt = 0;
    try {
      const res = await fetch(`${server()}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: log.slice(-MAX_SENT), spoilers: root.querySelector("select").value }),
      });
      const data = await res.json().catch(() => ({}));
      reply = data.reply || null;
      resetAt = Number(data.resetAt) || 0;
      failed = !res.ok;
    } catch (error) {
      failed = true;
    }

    wait.remove();
    if (reply && !failed) {
      log.push({ role: "assistant", content: reply });
      bubble("bot", reply);
    } else {
      // When she is out of replies or free magic, say when it comes back in the reader's own timezone.
      const back = resetAt > Date.now()
        ? ` She is back at ${new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} your time.`
        : "";
      bubble("bot", (reply || "The Golden Witch cannot be reached right now. Try again in a moment.") + back, "bt-error");
      log.pop(); // a failed turn is not part of the conversation
    }
    save();
    busy = false;
    root.querySelector(".bt-form").classList.remove("busy");
    input.focus();
  }

  function open(from) {
    if (!root) build();
    opener = from || document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add("bt-open");
    root.querySelector("input").focus();
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove("bt-open");
    if (opener && opener.focus) opener.focus();
  }

  window.NoberuBeatrice = { open, close };
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-beatrice]");
    if (trigger) open(trigger);
  });
})();
