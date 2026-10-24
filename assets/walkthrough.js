/**
 * Walkthroughs: pick a route in the noberu menu, and at every choice the game
 * shows, noberu points at the option that keeps you on it (or picks it).
 *
 * A guide (assets/walkthroughs/<game>.json, built by
 * tools/walkthrough/build.py from the game's own script) lists each route's
 * choices by where they sit in the script ("scene:line") and which option to
 * take. The engine reports each choice as it comes up (only rlvm so far:
 * engine/long_operations/select_long_operation.cc) and takes picks back
 * through the frame's noberuSelect().
 *
 *   NoberuWalkthrough.choice(win, {seen, line, options})   from the engine
 *   NoberuWalkthrough.made(win, index)                     from the engine
 *   NoberuWalkthrough.panel(frameWrap, card, back)         the menu's page
 */
(function () {
  "use strict";

  // Which guide goes with which game: the frame it runs in and its name.
  const GUIDES = [
    { id: "clannad", frame: "rlvm-frame-wrap", name: /clannad/i, url: "assets/walkthroughs/clannad.json?v=20261023b" },
  ];

  const loaded = new Map();       // guide id -> Promise<data>
  const pending = new WeakMap();  // frameWrap -> { choice, timer }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function store(name, value) {
    try {
      if (value === undefined) return localStorage.getItem(name);
      if (value === null) localStorage.removeItem(name);
      else localStorage.setItem(name, value);
    } catch (error) { /* private mode: the walkthrough just forgets */ }
    return null;
  }

  function load(guide) {
    if (!loaded.has(guide.id)) {
      loaded.set(guide.id, fetch(guide.url).then((r) => r.json()).then((data) => {
        for (const route of data.routes) route.at = new Map(route.path.map(([key, option, matters]) => [key, { option, matters }]));
        return data;
      }).catch(() => null));
    }
    return loaded.get(guide.id);
  }

  function gameName() {
    const game = window.NoberuShelf && window.NoberuShelf.current();
    return game ? game.name : "";
  }

  // What the game calls itself: rlvm reads Gameexe.ini's #CAPTION and
  // #REGNAME, which are in the frame's file system. Played from the shelf,
  // its name there also counts.
  function gameLabel(frameWrap) {
    let label = gameName();
    try {
      const fs = frameWrap.querySelector("iframe").contentWindow.Module.FS;
      const ini = new TextDecoder("latin1").decode(fs.readFile("/game/Gameexe.ini")).slice(0, 4000);
      label += " " + (ini.match(/^#(CAPTION|REGNAME)\s*=.*$/gm) || []).join(" ");
    } catch (error) { /* not rlvm, or not booted yet */ }
    return label;
  }

  const found = new WeakMap();  // frameWrap -> guide data it was matched to

  // The guide for a frame: by the game's name, or by a choice it knows.
  async function guideFor(frameWrap, choice) {
    if (found.has(frameWrap)) return found.get(frameWrap);
    for (const guide of GUIDES) {
      if (guide.frame !== frameWrap.id) continue;
      const data = await load(guide);
      if (!data) continue;
      if (guide.name.test(gameLabel(frameWrap))) {
        found.set(frameWrap, data);
        return data;
      }
      const known = choice && data.choices[keyOf(data, choice)];
      if (known && known.join("\n") === choice.options.map((o) => bare(o.text)).join("\n")) {
        found.set(frameWrap, data);
        return data;
      }
    }
    return null;
  }

  function routeOf(data) {
    const id = store(`noberu.walkthrough.${data.id}`);
    return data.routes.find((r) => r.id === id) || null;
  }

  const autoPick = () => store("noberu.walkthrough.auto") === "1";

  // rlvm prints Clannad's options with the quote marks around them.
  const bare = (text) => String(text).replace(/^"(.*)"$/s, "$1");

  function frameOf(win) {
    for (const wrap of document.querySelectorAll(".play-frame-wrap")) {
      const iframe = wrap.querySelector("iframe");
      if (iframe && iframe.contentWindow === win) return wrap;
    }
    return null;
  }

  // "2416" -> "Apr 16": the script's scenes are numbered by route and date.
  function date(key) {
    const scene = Number(key.split(":")[0]) % 1000;
    const month = Math.floor(scene / 100);
    const day = scene % 100;
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${MONTHS[month - 1]} ${day}` : "";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  }

  // --- at a choice ---------------------------------------------------------------------

  // A new game in the frame may be another one.
  function forget(frameWrap) {
    found.delete(frameWrap);
    delete frameWrap.dataset.wtNudged;
    clear(frameWrap);
  }

  function clear(frameWrap) {
    const was = pending.get(frameWrap);
    if (was) clearTimeout(was.timer);
    pending.delete(frameWrap);
    frameWrap.querySelectorAll(".nb-wt-hint").forEach((el) => el.remove());
  }

  function pick(frameWrap, index) {
    const iframe = frameWrap.querySelector("iframe");
    const select = iframe && iframe.contentWindow && iframe.contentWindow.noberuSelect;
    if (select && select(index)) clear(frameWrap);
  }

  // The guide's key for a choice. rlvm reports the last line marker it ran,
  // which lags behind when the script jumps past some (it said 3422:727 for
  // the choice the script places at line 733), so when "scene:line" isn't in
  // the guide, the same scene's choice with the same options at or after that
  // line is.
  function keyOf(data, c) {
    const exact = `${c.seen}:${c.line}`;
    if (data.choices[exact]) return exact;
    const texts = c.options.map((o) => bare(o.text)).join("\n");
    const near = Object.keys(data.choices)
      .map((k) => k.split(":").map(Number))
      .filter(([seen, line]) => seen === c.seen && line >= c.line)
      .sort((a, b) => a[1] - b[1]);
    const same = near.find(([seen, line]) => data.choices[`${seen}:${line}`].join("\n") === texts);
    return same ? `${same[0]}:${same[1]}` : exact;
  }

  async function choice(win, c) {
    const frameWrap = frameOf(win);
    if (!frameWrap) return;
    clear(frameWrap);
    const data = await guideFor(frameWrap, c);
    if (!data) return;
    const route = routeOf(data);
    const key = keyOf(data, c);
    const hint = document.createElement("div");
    hint.className = "nb-wt-hint";
    hint.setAttribute("role", "status");

    if (!route) {
      // Only once a session: a reminder that a guide exists.
      if (frameWrap.dataset.wtNudged) return;
      frameWrap.dataset.wtNudged = "1";
      hint.innerHTML = `<span>A walkthrough is ready for this game.</span><button type="button" data-wt="routes">pick a route</button><button type="button" data-wt="hide" aria-label="hide">×</button>`;
    } else {
      const step = route.at.get(key);
      const shown = c.options.map((o, i) => ({ ...o, i })).filter((o) => o.shown);
      const want = step && shown.find((o) => o.i === step.option);
      if (step && want) {
        const label = step.matters ? "choose" : "either works · walkthrough took";
        hint.innerHTML = `<span><b>${escapeHtml(route.name)}</b> · ${label} “${escapeHtml(bare(want.text))}”</span><button type="button" data-wt="pick">choose it</button><button type="button" data-wt="hide" aria-label="hide">×</button>`;
        if (autoPick()) {
          pending.set(frameWrap, { choice: c, timer: setTimeout(() => pick(frameWrap, step.option), 900) });
        }
        hint.dataset.option = String(step.option);
      } else {
        hint.innerHTML = `<span><b>${escapeHtml(route.name)}</b> · this choice isn't on the route. An earlier choice went another way.</span><button type="button" data-wt="routes">routes</button><button type="button" data-wt="hide" aria-label="hide">×</button>`;
      }
    }
    hint.addEventListener("click", (event) => {
      const b = event.target.closest("[data-wt]");
      if (!b) return;
      if (b.dataset.wt === "pick") pick(frameWrap, Number(hint.dataset.option));
      else if (b.dataset.wt === "routes") window.NoberuMenu && window.NoberuMenu.open(frameWrap, "walkthrough");
      else clear(frameWrap);
    });
    frameWrap.appendChild(hint);
  }

  function made(win) {
    const frameWrap = frameOf(win);
    if (frameWrap) clear(frameWrap);
  }

  // --- the menu's page ---------------------------------------------------------------

  async function panel(frameWrap, card, back) {
    card.innerHTML = `<div class="nb-menu-head"><div><b>walkthrough</b><span>loading…</span></div><button type="button" class="nb-wt-back" data-wt="back">back</button></div>`;
    card.querySelector("[data-wt=back]").addEventListener("click", back);
    const data = await guideFor(frameWrap, null);
    const head = card.querySelector(".nb-menu-head span");
    if (!data) {
      head.textContent = "not for this game yet";
      card.insertAdjacentHTML("beforeend", `<p class="nb-wt-note">There's no walkthrough for this game yet. CLANNAD has one.</p>`);
      return;
    }
    const render = () => {
      const current = routeOf(data);
      head.textContent = current ? `following ${current.name}` : "pick a route";
      const groups = [...new Set(data.routes.map((r) => r.group))];
      const list = groups.map((group) => `
        <p class="nb-wt-group">${escapeHtml(group)}</p>
        <div class="nb-wt-routes">${data.routes.filter((r) => r.group === group).map((r) => `
          <button type="button" data-route="${r.id}" aria-pressed="${current === r}">
            <b>${escapeHtml(r.name)}</b>
            <small>${count(r.path.filter((p) => p[2]).length)}${r.light ? " · gives a light" : ""}</small>
          </button>`).join("")}</div>`).join("");
      const steps = current ? current.path.filter((p) => p[2]).map(([key, option]) => `
          <li><span>${escapeHtml(date(key))}</span>${escapeHtml(data.choices[key][option])}</li>`).join("") : "";
      card.querySelector(".nb-wt-body")?.remove();
      card.insertAdjacentHTML("beforeend", `
        <div class="nb-wt-body">
          ${data.note ? `<p class="nb-wt-note">${escapeHtml(data.note)}</p>` : ""}
          ${list}
          <label class="nb-wt-auto"><input type="checkbox" ${autoPick() ? "checked" : ""}> choose for me</label>
          ${current ? `
            ${current.note ? `<p class="nb-wt-note">${escapeHtml(current.note)}</p>` : ""}
            <details class="nb-wt-steps"><summary>${escapeHtml(current.name)}'s choices</summary><ol>${steps}</ol></details>
            <button type="button" class="nb-wt-off" data-route="">stop following</button>` : ""}
        </div>`);
      card.querySelectorAll("[data-route]").forEach((b) => b.addEventListener("click", () => {
        store(`noberu.walkthrough.${data.id}`, b.dataset.route || null);
        render();
      }));
      card.querySelector(".nb-wt-auto input").addEventListener("change", (event) => {
        store("noberu.walkthrough.auto", event.target.checked ? "1" : null);
      });
    };
    render();
  }

  function count(n) {
    if (n === 0) return "any choices work";
    return n === 1 ? "1 choice matters" : `${n} choices matter`;
  }

  // The label on the menu's button.
  async function summary(frameWrap) {
    const data = await guideFor(frameWrap, null);
    if (!data) return "";
    const route = routeOf(data);
    return route ? route.name : "pick a route";
  }

  window.NoberuWalkthrough = { choice, made, panel, summary, clear, forget };
})();
