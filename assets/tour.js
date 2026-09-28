/**
 * noberu demo tour: walks a first-time visitor through getting Narcissu from
 * a web link into the onscripter tab, using the real controls rather than a
 * shortcut, so they learn the flow the site actually has.
 *
 *   downloads button -> web link (typed for them) -> download -> unzip
 *   -> play -> boot local
 *
 * Each step rings the control to press and waits for the press itself. The
 * tour starts once, after the welcome notice's ok (index.html calls
 * NoberuTour.startIfNew), and ?tour in the URL replays it.
 *
 * Narcissu (stage-nana, English by insani) may be redistributed unmodified;
 * the zip is the Web Edition as released, readme/PFSL/GPL included. It is
 * too big for Pages (25 MiB per file), so it lives on Hugging Face, whose
 * downloads send CORS headers - which the web link feature needs, since the
 * browser fetches it directly.
 */
(function () {
  "use strict";

  const DEMO_URL = "https://huggingface.co/datasets/noberu/noberu-demo/resolve/main/Narcissu.zip";
  const DEMO_NAME = "Narcissu";
  const TOUR_KEY = "noberu.tour.narcissu.v1";

  // ?tour-url=... points the tour at another copy (a local server while
  // developing, say) without editing this file.
  const params = new URLSearchParams(location.search);
  const url = params.get("tour-url") || DEMO_URL;
  const zipName = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop());

  const css = `
    .tour-ring {
      position: fixed;
      z-index: 100000;
      pointer-events: none;
      border: 3px solid var(--gold);
      border-radius: 8px;
      box-shadow: 0 0 0 4px rgba(241, 154, 56, 0.25), 0 0 18px rgba(241, 154, 56, 0.55);
      transition: top 0.15s, left 0.15s, width 0.15s, height 0.15s;
      animation: tour-pulse 1.2s ease-in-out infinite;
    }
    .tour-ring.hidden, .tour-card.hidden { display: none; }
    @keyframes tour-pulse {
      50% { box-shadow: 0 0 0 9px rgba(241, 154, 56, 0.08), 0 0 26px rgba(241, 154, 56, 0.7); }
    }
    @media (prefers-reduced-motion: reduce) {
      .tour-ring { animation: none; transition: none; }
    }
    .tour-card {
      position: fixed;
      z-index: 100001;
      width: min(20rem, calc(100vw - 2rem));
      padding: 0.75rem 0.85rem;
      border: 2px solid var(--gold);
      border-radius: 8px;
      background: var(--cream);
      color: var(--ink);
      box-shadow: 0 10px 28px var(--drop-shadow), 0 0 0 1px rgba(128, 128, 128, 0.25);
      font-size: 0.92rem;
      line-height: 1.4;
    }
    .tour-card b { display: block; margin-bottom: 0.3rem; color: var(--gold); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.06em; }
    .tour-card p { margin: 0 0 0.6rem; }
    .tour-card .tour-actions { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
    .tour-card .tour-step { color: var(--muted, #8a8a8a); font-size: 0.8rem; }
  `;

  let ring = null;
  let card = null;
  let step = -1;
  let entryId = null;   // the library entry the download created
  let frame = 0;
  let typing = false;
  let cleanups = [];

  // The saves panel and the welcome notice share this popup's class, so find
  // it by the one thing only it has.
  const library = () => {
    const field = document.querySelector("#library-url");
    return field && field.closest(".library-backdrop");
  };
  const libraryOpen = () => {
    const el = library();
    return !!el && !el.classList.contains("hidden");
  };
  const item = () => entryId && document.querySelector(`.library-item[data-id="${entryId}"]`);

  // Each step: the control to ring, what to say, and when it is done. `done`
  // is polled, so it can watch for the result of a press (a download landing,
  // a tab opening) as well as the press.
  const STEPS = [
    {
      title: "try a demo",
      text: "Let's play <i>Narcissu</i>, a free visual novel, straight from a web link. " +
        "Start with the <b style='display:inline;color:inherit'>downloads</b> button.",
      target: () => document.querySelector("#downloads-button"),
      done: () => libraryOpen(),
    },
    {
      title: "web link",
      text: "This box takes a link to a game. Typing Narcissu's for you...",
      target: () => document.querySelector("#library-url"),
      needsLibrary: true,
      enter: () => typeLink(),
      done: () => !typing && document.querySelector("#library-url").value === url,
    },
    {
      title: "download",
      text: "Now press <b style='display:inline;color:inherit'>download</b>. " +
        "It's about 100 MB and lands in this browser's storage.",
      target: () => document.querySelector("#library-url-form button[type=submit]"),
      needsLibrary: true,
      enter: () => {
        const form = document.querySelector("#library-url-form");
        const onSubmit = () => { STEPS[2].pressed = true; };
        form.addEventListener("submit", onSubmit);
        cleanups.push(() => form.removeEventListener("submit", onSubmit));
      },
      done: () => STEPS[2].pressed,
    },
    {
      title: "downloading",
      text: "Downloading. The status line at the bottom shows how far along it is.",
      target: () => document.querySelector("#library-status"),
      needsLibrary: true,
      done: () => {
        // The newest entry named after the zip is ours.
        const match = [...document.querySelectorAll(".library-item")].find((el) =>
          el.querySelector("b").textContent === zipName && el.querySelector("[data-act=unzip]"));
        if (match) entryId = match.dataset.id;
        return !!match;
      },
      failed: () => {
        const status = document.querySelector("#library-status");
        const text = status ? status.textContent : "";
        return /blocked|answered|not a valid/i.test(text) ? text.replace(/^Status:\s*/, "") : null;
      },
    },
    {
      title: "unzip",
      text: "Downloaded. It's a .zip, so press <b style='display:inline;color:inherit'>unzip</b> to unpack it.",
      target: () => item() && item().querySelector("[data-act=unzip]"),
      needsLibrary: true,
      done: () => !!(item() && item().querySelector("[data-act=boot]")),
    },
    {
      title: "play",
      text: "Unpacked, and recognised as an NScripter game. Press <b style='display:inline;color:inherit'>play</b>.",
      target: () => item() && item().querySelector("[data-act=boot]"),
      needsLibrary: true,
      done: () => !libraryOpen() && isVisible(bootButton()),
    },
    {
      title: "boot local",
      text: "Narcissu is staged in the onscripter tab. Press <b style='display:inline;color:inherit'>boot local</b> to start it.",
      target: () => bootButton(),
      enter: () => {
        const onClick = () => { STEPS[6].pressed = true; };
        for (const button of BOOT_BUTTONS.map((id) => document.querySelector(id))) {
          button.addEventListener("click", onClick);
          cleanups.push(() => button.removeEventListener("click", onClick));
        }
      },
      done: () => STEPS[6].pressed,
    },
    {
      title: "fullscreen",
      text: "Press <b style='display:inline;color:inherit'>▣</b> up here to play fullscreen; Esc comes back. " +
        "Any game with a download link works the same way, and folders on this device go in with " +
        "<b style='display:inline;color:inherit'>add folder</b>. Right click opens the game's menu.",
      target: () => document.querySelector("#fullscreen-emulator"),
      last: true,
      // Going fullscreen hides the page, card and all, so that ends the tour.
      enter: () => {
        const button = document.querySelector("#fullscreen-emulator");
        button.addEventListener("click", finish);
        cleanups.push(() => button.removeEventListener("click", finish));
      },
    },
  ];

  // The onscripter tab has two: one on the staging card, one in the side
  // panel. Whichever is on screen gets the ring; either counts.
  const BOOT_BUTTONS = ["#ons-run", "#ons-boot"];

  function bootButton() {
    const buttons = BOOT_BUTTONS.map((id) => document.querySelector(id)).filter(isVisible);
    return buttons.find((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }) || buttons[0] || null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function seen() {
    try {
      return localStorage.getItem(TOUR_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch (error) { /* private mode: it may show again */ }
  }

  function typeLink() {
    const field = document.querySelector("#library-url");
    if (!field) return;
    typing = true;
    field.value = "";
    field.focus();
    let i = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      if (step !== 1 || !document.contains(field)) {
        typing = false;
        return;
      }
      i = reduced ? url.length : Math.min(url.length, i + 2);
      field.value = url.slice(0, i);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      if (i < url.length) setTimeout(tick, 22);
      else typing = false;
    };
    setTimeout(tick, 400);
  }

  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    ring = document.createElement("div");
    ring.className = "tour-ring hidden";
    card = document.createElement("div");
    card.className = "tour-card hidden";
    card.setAttribute("role", "status");
    card.innerHTML = `
      <b id="tour-title"></b>
      <p id="tour-text"></p>
      <div class="tour-actions">
        <span class="tour-step" id="tour-step"></span>
        <button class="tiny-button" type="button" id="tour-skip">skip tour</button>
      </div>`;
    document.body.append(ring, card);
    card.querySelector("#tour-skip").addEventListener("click", finish);
  }

  function show(index) {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    step = index;
    const s = STEPS[index];
    card.querySelector("#tour-title").textContent = s.title;
    card.querySelector("#tour-text").innerHTML = s.text;
    card.querySelector("#tour-step").textContent = s.last ? "" : `step ${index + 1} of ${STEPS.length - 1}`;
    card.querySelector("#tour-skip").textContent = s.last ? "done" : "skip tour";
    card.classList.remove("hidden");
    if (s.enter) s.enter();
    if (s.last) markSeen();
  }

  // One loop keeps the ring on its control (things scroll and reflow, the
  // library re-renders its list) and checks whether the step is done.
  function loop() {
    frame = requestAnimationFrame(loop);
    const s = STEPS[step];
    if (!s) return;

    // Checked first: "play" closes downloads on purpose.
    if (s.done && s.done()) {
      show(step + 1);
      return;
    }

    // Closing downloads mid-tour: point back at the button instead of at a
    // control that is no longer on screen.
    const lost = s.needsLibrary && !libraryOpen();
    const failure = !lost && s.failed && s.failed();
    let target = lost ? document.querySelector("#downloads-button") : s.target();
    if (lost) {
      setText("downloads closed", "Press the <b style='display:inline;color:inherit'>downloads</b> button to pick up where you left off.");
    } else if (failure) {
      setText("download failed", failure);
      target = null;
    } else {
      setText(s.title, s.text);
    }

    place(isVisible(target) ? target : null);
  }

  function setText(title, html) {
    const titleEl = card.querySelector("#tour-title");
    const textEl = card.querySelector("#tour-text");
    if (titleEl.textContent !== title) titleEl.textContent = title;
    if (textEl.dataset.html !== html) {
      textEl.innerHTML = html;
      textEl.dataset.html = html;
    }
  }

  function place(target) {
    const cardRect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    if (!target) {
      ring.classList.add("hidden");
      card.style.left = `${Math.max(margin, (vw - cardRect.width) / 2)}px`;
      card.style.top = `${Math.max(margin, vh - cardRect.height - 24)}px`;
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = 5;
    ring.classList.remove("hidden");
    ring.style.left = `${r.left - pad}px`;
    ring.style.top = `${r.top - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;

    // Below the control if it fits, otherwise above, otherwise the bottom edge.
    let top = r.bottom + pad + margin;
    if (top + cardRect.height > vh - margin) top = r.top - pad - margin - cardRect.height;
    if (top < margin) top = vh - cardRect.height - margin;
    let left = r.left + r.width / 2 - cardRect.width / 2;
    left = Math.min(Math.max(margin, left), vw - cardRect.width - margin);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function start() {
    if (!ring) build();
    STEPS.forEach((s) => { delete s.pressed; });
    entryId = null;
    show(0);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  }

  function finish() {
    markSeen();
    cancelAnimationFrame(frame);
    cleanups.forEach((fn) => fn());
    cleanups = [];
    step = -1;
    typing = false;
    ring.classList.add("hidden");
    card.classList.add("hidden");
  }

  window.NoberuTour = {
    start,
    // First visit only, or whenever the URL asks for it with ?tour.
    startIfNew() {
      if (params.has("tour") || !seen()) start();
    },
  };
})();
