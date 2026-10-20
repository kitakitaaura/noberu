/**
 * The game shelf: noberu's home screen.
 *
 * Every game in downloads (assets/library.js) as a cover on a grid, with what
 * matters at a glance: how long it has been played, when last, and one play
 * button. The engine tabs are still there for anyone who wants them; the shelf
 * picks the right one by itself.
 *
 * Covers, best first (a better one replaces a worse one, never the reverse):
 *   custom   an image the player chose                     rank 5
 *   vndb     picked from vndb.org search results            rank 4
 *   files    the game's own title image (assets/covers.js) rank 3
 *   capture  its title screen, captured while it runs      rank 2
 *   icon     the icon inside its .exe                       rank 1
 * With none, the card draws the name on a colour of its own.
 *
 * Kept in this browser: covers and screenshots in IndexedDB "noberu-shelf",
 * play time in localStorage (noberu.stats). Nothing leaves the device unless
 * "find a cover online" is pressed, which sends the game's name to vndb.org.
 */
(function () {
  "use strict";

  const Library = () => window.NoberuLibrary;
  const RANK = { custom: 5, vndb: 4, files: 3, capture: 2, icon: 1 };
  const STATS_KEY = "noberu.stats";
  const TICK_MS = 10000;
  const DEMO_URL = "https://huggingface.co/datasets/noberu/noberu-demo/resolve/main/Narcissu.zip";

  const $ = (selector, root = document) => root.querySelector(selector);
  const grid = $("#shelf-grid");
  const empty = $("#shelf-empty");
  const detail = $("#shelf-detail");
  const count = $("#shelf-count");
  const search = $("#shelf-search");
  const sort = $("#shelf-sort");
  const progress = $("#shelf-progress");
  const addButton = $("#shelf-add");
  const addMenu = $("#shelf-add-menu");
  const folderInput = $("#shelf-folder-input");
  const fileInput = $("#shelf-file-input");
  if (!grid) return;

  // --- storage ---------------------------------------------------------------------

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("noberu-shelf", 1);
        request.onupgradeneeded = () => {
          const d = request.result;
          d.createObjectStore("covers", { keyPath: "id" });
          const shots = d.createObjectStore("shots", { keyPath: "id" });
          shots.createIndex("game", "game");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result && "result" in result ? result.result : result);
      t.onerror = () => reject(t.error);
    });
  }

  const getCover = (id) => tx("covers", "readonly", (s) => s.get(id)).catch(() => null);
  const allCovers = () => tx("covers", "readonly", (s) => s.getAll()).catch(() => []);
  const deleteCover = (id) => tx("covers", "readwrite", (s) => s.delete(id)).catch(() => { });

  // Keeps the better of the two: a captured frame never replaces chosen art.
  async function putCover(id, blob, source, extra = {}, force = false) {
    const current = await getCover(id);
    if (!force && current && (RANK[current.source] || 0) > (RANK[source] || 0)) return false;
    await tx("covers", "readwrite", (s) => s.put({
      ...(current || {}), id, blob, source, at: Date.now(), ...extra,
    }));
    coverUrls.delete(id);
    render();
    return true;
  }

  async function addShot(game, blob) {
    const shot = { id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), game, blob, at: Date.now() };
    await tx("shots", "readwrite", (s) => s.put(shot));
    return shot;
  }

  async function shotsFor(game) {
    const d = await db();
    return new Promise((resolve) => {
      const request = d.transaction("shots").objectStore("shots").index("game").getAll(game);
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.at - a.at));
      request.onerror = () => resolve([]);
    });
  }

  const deleteShot = (id) => tx("shots", "readwrite", (s) => s.delete(id)).catch(() => { });

  function readStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (error) { /* private mode: this visit only */ }
  }

  function bump(id, changes) {
    const stats = readStats();
    const now = stats[id] || { playMs: 0, sessions: 0 };
    stats[id] = changes(now) || now;
    writeStats(stats);
  }

  // --- formatting ------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  function played(ms) {
    if (!ms || ms < 60000) return ms ? "under a minute" : "not yet";
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  function shortPlayed(ms) {
    if (!ms || ms < 60000) return "";
    const minutes = Math.round(ms / 60000);
    return minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0).replace(/\.0$/, "")} h`;
  }

  function ago(time) {
    if (!time) return "never";
    const days = Math.floor((startOfDay(Date.now()) - startOfDay(time)) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
  }

  function startOfDay(time) {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // A colour of its own for a game with no cover, from its name.
  function hue(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
    return h;
  }

  // A cover with no art is one of these, picked by the same hash.
  const COLORS = ["#ff8a65", "#ffb74d", "#ffd54f", "#aed581", "#4dd0b4", "#4fc3f7", "#9fa8ff", "#ce93d8", "#f48fb1", "#ff9e9e"];

  // "Ciconia_When_They_Cry" reads better as words.
  function prettyName(name) {
    return String(name).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // --- state -----------------------------------------------------------------------

  let entries = [];
  let covers = new Map();
  const coverUrls = new Map();   // id -> { url, at }
  let selected = null;
  let current = null;            // the game last started from the library
  let rendering = false;
  let renderAgain = false;

  function coverUrl(cover) {
    if (!cover || !cover.blob) return null;
    const cached = coverUrls.get(cover.id);
    if (cached && cached.at === cover.at) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(cover.blob);
    coverUrls.set(cover.id, { url, at: cover.at });
    return url;
  }

  function runningFrame() {
    return document.querySelector(".play-frame-wrap.active");
  }

  function isRunning(id) {
    return !!(current && current.id === id && runningFrame());
  }

  function sorted(list) {
    const stats = readStats();
    const mode = sort.value;
    const by = {
      recent: (a, b) => ((stats[b.id] || {}).lastPlayed || b.addedAt) - ((stats[a.id] || {}).lastPlayed || a.addedAt),
      name: (a, b) => prettyName(a.name).localeCompare(prettyName(b.name), undefined, { sensitivity: "base" }),
      played: (a, b) => ((stats[b.id] || {}).playMs || 0) - ((stats[a.id] || {}).playMs || 0),
      added: (a, b) => b.addedAt - a.addedAt,
    }[mode] || (() => 0);
    return [...list].sort(by);
  }

  // --- the grid --------------------------------------------------------------------

  function coverMarkup(entry, cover, big = false) {
    const url = coverUrl(cover);
    const fit = cover ? (cover.source === "icon" ? "icon" : "cover") : "none";
    const name = prettyName((cover && cover.title) || entry.name);
    const inner = url
      ? (fit === "icon"
        ? `<img class="shelf-cover-blur" src="${url}" alt="" /><img class="shelf-cover-icon" src="${url}" alt="" />`
        : `<img src="${url}" alt="" loading="lazy" />`)
      : `<span class="shelf-cover-initial" aria-hidden="true">${escapeHtml(([...name.replace(/^(the|a)\s+/i, "")][0] || "?").toUpperCase())}</span>`;
    const h = hue(entry.name);
    return `<span class="shelf-cover${big ? " big" : ""}" data-fit="${url ? fit : "none"}" style="--h:${h};--c:${COLORS[h % COLORS.length]}">${inner}</span>`;
  }

  async function render() {
    if (rendering) {
      renderAgain = true;
      return;
    }
    rendering = true;
    try {
      if (!Library()) return;
      entries = await Library().list().catch(() => []);
      covers = new Map((await allCovers()).map((c) => [c.id, c]));
      const stats = readStats();
      const query = search.value.trim().toLowerCase();
      const shown = sorted(entries).filter((e) => e.engine !== "archive" || !query)
        .filter((e) => !query || prettyName(e.name).toLowerCase().includes(query) ||
          ((covers.get(e.id) || {}).title || "").toLowerCase().includes(query));

      const total = (Object.entries(stats)
        .filter(([id]) => entries.some((e) => e.id === id))
        .reduce((sum, [, s]) => sum + (s.playMs || 0), 0));
      count.textContent = entries.length
        ? `${entries.length} game${entries.length === 1 ? "" : "s"}${total >= 60000 ? ` · ${played(total)} played` : ""}`
        : "";

      empty.hidden = entries.length > 0;
      grid.hidden = entries.length === 0;

      grid.innerHTML = shown.map((entry) => {
        const cover = covers.get(entry.id);
        const s = stats[entry.id] || {};
        const label = entry.engine === "archive" ? "archive · unzip first" : Library().engineLabel(entry.engine);
        const time = shortPlayed(s.playMs);
        return `
          <button type="button" class="shelf-card${selected === entry.id ? " selected" : ""}" role="listitem"
            data-id="${entry.id}" aria-label="${escapeHtml(prettyName(entry.name))}">
            ${coverMarkup(entry, cover)}
            ${isRunning(entry.id) ? `<span class="shelf-badge">playing</span>` : ""}
            <span class="shelf-card-text">
              <span class="shelf-name">${escapeHtml(prettyName((cover && cover.title) || entry.name))}</span>
              <span class="shelf-meta">${escapeHtml(label)}${time ? ` · ${time}` : ""}</span>
            </span>
          </button>`;
      }).join("") || (query ? `<p class="shelf-none">Nothing called “${escapeHtml(search.value.trim())}”.</p>` : "");

      if (selected && !entries.some((e) => e.id === selected)) selected = null;
      if (!selected && entries.length && !phone()) selected = sorted(entries)[0].id;
      renderDetail();
    } finally {
      rendering = false;
      if (renderAgain) {
        renderAgain = false;
        render();
      }
    }
  }

  const phoneQuery = matchMedia("(max-width: 760px), (max-height: 520px) and (pointer: coarse)");
  const phone = () => phoneQuery.matches;

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".shelf-card");
    if (!card) return;
    select(card.dataset.id);
  });

  grid.addEventListener("dblclick", (event) => {
    const card = event.target.closest(".shelf-card");
    if (card) play(card.dataset.id);
  });

  // Arrow keys move between covers, Enter plays.
  grid.addEventListener("keydown", (event) => {
    const card = event.target.closest(".shelf-card");
    if (!card) return;
    const cards = [...grid.querySelectorAll(".shelf-card")];
    const i = cards.indexOf(card);
    const perRow = Math.max(1, Math.round(grid.clientWidth / card.offsetWidth));
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow }[event.key];
    if (move) {
      event.preventDefault();
      const next = cards[Math.min(cards.length - 1, Math.max(0, i + move))];
      next.focus();
      select(next.dataset.id, false);
    } else if (event.key === "Enter" && selected === card.dataset.id) {
      event.preventDefault();
      play(card.dataset.id);
    }
  });

  function select(id, scroll = true) {
    selected = id;
    grid.querySelectorAll(".shelf-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.id === id);
    });
    renderDetail();
    if (phone()) {
      detail.dataset.open = "1";
      document.documentElement.dataset.sheet = "1";
    } else if (scroll) {
      detail.scrollTop = 0;
    }
  }

  function closeSheet() {
    delete detail.dataset.open;
    delete document.documentElement.dataset.sheet;
  }

  // --- the detail panel ----------------------------------------------------------

  let detailToken = 0;

  async function renderDetail() {
    const token = ++detailToken;
    const entry = entries.find((e) => e.id === selected);
    if (!entry) {
      detail.innerHTML = summaryMarkup();
      bindSummary();
      return;
    }
    const cover = covers.get(entry.id);
    const s = readStats()[entry.id] || {};
    const runtimes = Library().runtimes();
    const engineLabel = Library().engineLabel(entry.engine);
    const shots = await shotsFor(entry.id);
    if (token !== detailToken) return;
    const title = prettyName((cover && cover.title) || entry.name);
    const sub = cover && cover.alttitle && cover.alttitle !== cover.title ? cover.alttitle : "";
    const running = isRunning(entry.id);

    detail.innerHTML = `
      <div class="shelf-detail-scroll">
        <button type="button" class="shelf-sheet-close" data-act="close-sheet" aria-label="close">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
        ${coverMarkup(entry, cover, true)}
        <div class="shelf-detail-head">
          <h2>${escapeHtml(title)}</h2>
          ${sub ? `<p class="shelf-alt" lang="ja">${escapeHtml(sub)}</p>` : ""}
          <p class="shelf-sub">${escapeHtml(entry.engine === "archive" ? "archive" : engineLabel)} · ${Library().bytesLabel(entry.bytes)}${entry.kind === "linked" ? " · linked folder" : ""}</p>
        </div>
        <dl class="shelf-stats">
          <div><dt>played</dt><dd>${played(s.playMs)}</dd></div>
          <div><dt>last played</dt><dd>${ago(s.lastPlayed)}</dd></div>
          <div><dt>added</dt><dd>${ago(entry.addedAt)}</dd></div>
        </dl>
        <div class="shelf-play-row">
          ${entry.engine === "archive"
            ? `<button class="retro-button shelf-play" type="button" data-act="unzip">unzip to play</button>`
            : running
              ? `<button class="retro-button shelf-play" type="button" data-act="resume">back to the game</button>`
              : `<button class="retro-button shelf-play" type="button" data-act="play">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>
                  play</button>`}
        </div>
        ${entry.engine === "archive" ? "" : `
        <label class="shelf-field">
          <span>runs on</span>
          <select data-act="engine" aria-label="engine for ${escapeHtml(title)}">
            ${runtimes.map((r) => `<option value="${r.id}"${r.id === entry.engine ? " selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}
            ${runtimes.some((r) => r.id === entry.engine) ? "" : `<option value="" selected disabled>${escapeHtml(engineLabel)}</option>`}
          </select>
        </label>`}
        <div class="shelf-actions">
          <button class="retro-button secondary" type="button" data-act="beam">beam</button>
          <button class="retro-button secondary" type="button" data-act="saves">saves</button>
          <button class="retro-button secondary" type="button" data-act="cover" aria-expanded="false">cover</button>
          <button class="retro-button secondary" type="button" data-act="more" aria-expanded="false">more</button>
        </div>
        <div class="shelf-drawer" data-drawer="cover" hidden>
          <button class="tiny-button" type="button" data-act="cover-online">find it online</button>
          <button class="tiny-button" type="button" data-act="cover-pick">choose an image</button>
          ${shots.length ? `<button class="tiny-button" type="button" data-act="cover-shot">use the last screenshot</button>` : ""}
          ${cover ? `<button class="tiny-button" type="button" data-act="cover-reset">remove cover</button>` : ""}
          <p class="shelf-hint">“find it online” searches vndb.org for this game's name.</p>
          <div class="shelf-vndb" data-vndb></div>
        </div>
        <div class="shelf-drawer" data-drawer="more" hidden>
          <button class="tiny-button" type="button" data-act="rename">rename</button>
          ${entry.kind === "linked" ? `<button class="tiny-button" type="button" data-act="copy">keep a copy in this browser</button>` : ""}
          ${entry.engine === "archive" ? "" : `<button class="tiny-button" type="button" data-act="patch">fix missing files</button>`}
          <button class="tiny-button" type="button" data-act="report">report a problem</button>
          <button class="tiny-button danger" type="button" data-act="remove">remove from shelf</button>
        </div>
        ${shots.length ? `
        <div class="shelf-shots">
          <h3>screenshots <span>${shots.length}</span></h3>
          <div class="shelf-shot-strip">
            ${shots.slice(0, 12).map((shot) => `
              <button type="button" class="shelf-shot" data-shot="${shot.id}" aria-label="screenshot from ${ago(shot.at)}">
                <img src="${shotUrl(shot)}" alt="" loading="lazy" />
              </button>`).join("")}
          </div>
        </div>` : ""}
      </div>
      <p class="shelf-status" data-status role="status"></p>`;
    bindDetail(entry, shots);
  }

  const shotUrls = new Map();
  function shotUrl(shot) {
    if (!shotUrls.has(shot.id)) shotUrls.set(shot.id, URL.createObjectURL(shot.blob));
    return shotUrls.get(shot.id);
  }

  function summaryMarkup() {
    const stats = readStats();
    const total = entries.reduce((sum, e) => sum + ((stats[e.id] || {}).playMs || 0), 0);
    return `
      <div class="panel-header">
        <h2>games</h2>
        <p>${entries.length ? "Pick a cover to see it here." : "Games you add show up here, with their covers and play time."}</p>
      </div>
      <div class="panel-body shelf-summary">
        <div class="mini-row"><div class="mini-icon" aria-hidden="true">01</div><div><b>Add a game</b><span>A folder, a .zip, or a link. noberu works out which engine plays it.</span></div></div>
        <div class="mini-row"><div class="mini-icon" aria-hidden="true">02</div><div><b>Press play</b><span>It opens in the right engine, full of your saves.</span></div></div>
        <div class="mini-row"><div class="mini-icon" aria-hidden="true">03</div><div><b>Read it your way</b><span>The in-game menu has screenshots, text, a dictionary and translation.</span></div></div>
        ${total ? `<p class="control-note">${played(total)} played in total.</p>` : ""}
      </div>
      <div class="panel-footer"><p>Status: shelf.</p></div>`;
  }

  function bindSummary() { /* nothing interactive yet */ }

  function say(text) {
    const status = $("[data-status]", detail);
    if (status) status.textContent = text || "";
  }

  function bindDetail(entry, shots) {
    detail.querySelectorAll("[data-act]").forEach((el) => {
      const act = el.dataset.act;
      if (el.tagName === "SELECT") {
        el.addEventListener("change", async () => {
          await Library().update(entry.id, { engine: el.value });
          say(`Will run on ${Library().engineLabel(el.value)}.`);
        });
        return;
      }
      el.addEventListener("click", () => onDetailAction(act, entry, shots, el));
    });
    detail.querySelectorAll("[data-shot]").forEach((button) => {
      button.addEventListener("click", () => openShot(entry, shots.find((s) => s.id === button.dataset.shot)));
    });
  }

  function toggleDrawer(name, button) {
    detail.querySelectorAll("[data-drawer]").forEach((drawer) => {
      const open = drawer.dataset.drawer === name && drawer.hidden;
      drawer.hidden = !open;
      // It opens below the fold of a short panel; bring it up.
      if (open) requestAnimationFrame(() => drawer.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    });
    detail.querySelectorAll('[data-act="cover"], [data-act="more"]').forEach((b) => {
      b.setAttribute("aria-expanded", String(b === button && !$(`[data-drawer="${name}"]`, detail).hidden));
    });
  }

  async function onDetailAction(act, entry, shots, el) {
    try {
      if (act === "play") await play(entry.id);
      else if (act === "resume") resume();
      else if (act === "close-sheet") closeSheet();
      else if (act === "beam") window.NoberuBeam && window.NoberuBeam.send(entry);
      else if (act === "saves") window.NoberuSaves && window.NoberuSaves.open();
      else if (act === "cover" || act === "more") toggleDrawer(act, el);
      else if (act === "cover-online") await vndbSearch(entry);
      else if (act === "cover-pick") pickCover(entry);
      else if (act === "cover-shot" && shots[0]) {
        await putCover(entry.id, await window.NoberuCovers.shrink(shots[0].blob, 640), "custom", {}, true);
        say("Cover set.");
      } else if (act === "cover-reset") {
        await deleteCover(entry.id);
        coverUrls.delete(entry.id);
        render();
      } else if (act === "rename") {
        const name = prompt("Name for this game:", prettyName(entry.name));
        if (name && name.trim()) await Library().update(entry.id, { name: name.trim().slice(0, 120) });
      } else if (act === "copy") {
        say("Copying into this browser...");
        await Library().copyToStorage(entry, say);
        say("Copied.");
      } else if (act === "unzip") {
        say("Unpacking...");
        await Library().unzip(entry, say);
        say("Unpacked.");
      } else if (act === "patch") Library().fixMissing(entry);
      else if (act === "report") window.NoberuReport && window.NoberuReport.open({ game: entry.name, engine: entry.engine });
      else if (act === "remove") {
        if (!confirm(`Remove "${prettyName(entry.name)}" from your games?` +
          (entry.kind === "stored" ? "\n\nIts copy in this browser is deleted. Saves are kept." : "\n\nThe folder on your device is left alone. Saves are kept."))) return;
        await Library().remove(entry);
        await deleteCover(entry.id);
        const stats = readStats();
        delete stats[entry.id];
        writeStats(stats);
        closeSheet();
        selected = null;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
      console.error(error);
      say(String((error && error.message) || error));
    }
  }

  function pickCover(entry) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        await putCover(entry.id, await window.NoberuCovers.shrink(file, 720), "custom", {}, true);
        say("Cover set.");
      } catch (error) {
        say("That image could not be read.");
      }
    });
    input.click();
  }

  // A screenshot, bigger, with what can be done with it.
  function openShot(entry, shot) {
    if (!shot) return;
    const box = document.createElement("div");
    box.className = "library-backdrop shelf-shot-view";
    box.innerHTML = `
      <div class="library-modal" role="dialog" aria-modal="true" aria-label="screenshot">
        <div class="library-bar"><b>screenshot · ${ago(shot.at)}</b><button class="tiny-button" type="button" data-x="close">close</button></div>
        <img src="${shotUrl(shot)}" alt="screenshot of ${escapeHtml(prettyName(entry.name))}" />
        <div class="library-foot button-row">
          <button class="retro-button" type="button" data-x="save">save image</button>
          <button class="retro-button secondary" type="button" data-x="cover">use as cover</button>
          <button class="retro-button secondary" type="button" data-x="delete">delete</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener("click", async (event) => {
      if (event.target === box) return close();
      const x = event.target.closest("[data-x]");
      if (!x) return;
      if (x.dataset.x === "close") close();
      if (x.dataset.x === "save") {
        const a = document.createElement("a");
        a.href = shotUrl(shot);
        a.download = `${prettyName(entry.name)} ${new Date(shot.at).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.jpg`;
        a.click();
      }
      if (x.dataset.x === "cover") {
        await putCover(entry.id, await window.NoberuCovers.shrink(shot.blob, 640), "custom", {}, true);
        close();
      }
      if (x.dataset.x === "delete") {
        await deleteShot(shot.id);
        close();
        renderDetail();
      }
    });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key !== "Escape") return;
      document.removeEventListener("keydown", onKey);
      close();
    });
  }

  // --- vndb ----------------------------------------------------------------------------

  // The Worker behind beam also passes vndb's cover images through, since
  // vndb's image server sends no CORS headers and this page is cross-origin
  // isolated (it could not show them otherwise).
  function server() {
    const params = new URLSearchParams(location.search);
    const override = params.get("beam-server");
    if (override) return override.replace(/\/$/, "");
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      return `http://${location.hostname}:8787`;
    }
    return "https://beam.kitaaura.com";
  }

  const proxied = (url) => `${server()}/cover?u=${encodeURIComponent(url)}`;

  // "KEY_CLANNAD_ENHD" or "Ciconia_When_They_Cry_v1.2" -> something vndb finds.
  function searchName(name) {
    return prettyName(name)
      .replace(/\b(v?\d+(\.\d+)+|steam|gog|en(g|glish)?|jp|hd|enhd|full|voice|edition|win(dows)?|x64|x86)\b/gi, " ")
      .replace(/^key\s+/i, "")
      .replace(/[\[\](){}]/g, " ")
      .replace(/\s+/g, " ").trim() || prettyName(name);
  }

  async function vndbSearch(entry, query) {
    const box = $("[data-vndb]", detail);
    if (!box) return;
    query = query || searchName(entry.name);
    box.innerHTML = `<p class="shelf-hint">Searching for “${escapeHtml(query)}”...</p>`;
    let results;
    try {
      const response = await fetch("https://api.vndb.org/kana/vn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: ["search", "=", query],
          fields: "title,alttitle,released,image.url,image.thumbnail,image.sexual,image.violence",
          sort: "searchrank",
          results: 8,
        }),
      });
      if (!response.ok) throw new Error(`vndb answered ${response.status}`);
      results = (await response.json()).results || [];
    } catch (error) {
      box.innerHTML = `<p class="shelf-hint">vndb.org could not be reached. ${navigator.onLine ? "" : "You're offline."}</p>`;
      return;
    }
    // Covers rated as anything but safe stay out of the shelf.
    const safe = results.filter((r) => r.image && r.image.sexual < 0.5 && r.image.violence < 1);
    box.innerHTML = `
      <form class="shelf-vndb-search">
        <input type="search" value="${escapeHtml(query)}" aria-label="search vndb" />
        <button class="tiny-button" type="submit">search</button>
      </form>
      ${safe.length ? `<div class="shelf-vndb-grid">
        ${safe.map((r) => `
          <button type="button" class="shelf-vndb-pick" data-vn="${r.id}">
            <img src="${proxied(r.image.thumbnail || r.image.url)}" alt="" loading="lazy" />
            <span>${escapeHtml(r.title)}</span>
            <small>${escapeHtml((r.released || "").slice(0, 4))}</small>
          </button>`).join("")}
      </div>` : `<p class="shelf-hint">Nothing found. Try a shorter name.</p>`}`;
    $("form", box).addEventListener("submit", (event) => {
      event.preventDefault();
      const q = $("input", box).value.trim();
      if (q) vndbSearch(entry, q);
    });
    box.querySelectorAll("[data-vn]").forEach((button) => {
      button.addEventListener("click", async () => {
        const r = safe.find((x) => x.id === button.dataset.vn);
        say("Getting the cover...");
        try {
          const image = await fetch(proxied(r.image.url));
          if (!image.ok) throw new Error(String(image.status));
          const blob = await window.NoberuCovers.shrink(await image.blob(), 720);
          await putCover(entry.id, blob, "vndb", {
            vndb: r.id, title: r.title, alttitle: r.alttitle || "", released: r.released || "",
          }, true);
          say(`Cover from vndb.org (${r.id}).`);
        } catch (error) {
          say("That cover could not be downloaded.");
        }
      });
    });
  }

  // --- playing -----------------------------------------------------------------------

  async function play(id) {
    const entry = entries.find((e) => e.id === id) || (await Library().list()).find((e) => e.id === id);
    if (!entry) return;
    if (entry.engine === "archive") {
      select(id);
      return;
    }
    closeSheet();
    say("Opening...");
    try {
      await Library().play(id, entry.engine);
    } catch (error) {
      say(String((error && error.message) || error));
      throw error;
    }
  }

  function resume() {
    closeSheet();
    const frame = runningFrame();
    const view = frame && frame.closest(".view");
    const tab = view && view.id.replace(/-view$/, "");
    if (tab) document.querySelector(`.tab-button[data-tab="${tab}"]`).click();
  }

  // --- play time, and the cover from the title screen ------------------------------

  window.addEventListener("noberu-game-start", (event) => {
    current = event.detail;
    bump(current.id, (s) => ({ ...s, lastPlayed: Date.now(), sessions: (s.sessions || 0) + 1 }));
    render();
  });

  // The files a game was handed to its engine with: the moment there is
  // permission to read them, so it is when a missing cover is looked for.
  window.addEventListener("noberu-handoff", async (event) => {
    if (!current || !window.NoberuCovers) return;
    const id = current.id;
    const existing = await getCover(id);
    if (existing && (RANK[existing.source] || 0) >= RANK.files) return;
    const found = await window.NoberuCovers.fromFiles(event.detail.files, current.engine).catch(() => null);
    if (found) putCover(id, found.blob, found.source);
  });

  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const step = Math.min(now - lastTick, TICK_MS * 2);
    lastTick = now;
    if (!current || document.hidden || !runningFrame()) return;
    bump(current.id, (s) => ({ ...s, playMs: (s.playMs || 0) + step, lastPlayed: now }));
  }, TICK_MS);

  // Captures a running frame. Runtime pages carry NoberuCapture
  // (assets/runtime.js); tyrano's game is a frame deeper.
  async function capture(frameWrap, maxWidth = 1280) {
    const windows = [];
    const iframe = frameWrap.querySelector("iframe");
    if (iframe) {
      try {
        let win = iframe.contentWindow;
        for (let depth = 0; depth < 3 && win; depth++) {
          windows.unshift(win);
          const inner = win.document.querySelector("iframe");
          win = inner && inner.contentWindow;
        }
      } catch (error) { /* another origin */ }
    } else {
      windows.push(window);
    }
    for (const win of windows) {
      try {
        if (!win.NoberuCapture) continue;
        const blob = await win.NoberuCapture.grab(maxWidth);
        if (blob) return blob;
      } catch (error) { /* try the next */ }
    }
    return null;
  }

  // The title screen makes a fair cover until a better one turns up. Logos
  // and warnings come first, so it waits a while, and tries again later if
  // all it caught was a fade.
  const CAPTURE_AT = [45000, 90000, 180000];
  window.NoberuInput && window.NoberuInput.onGameChange((frameWrap, started) => {
    render();
    if (!started || !current) return;
    const id = current.id;
    CAPTURE_AT.forEach((delay) => setTimeout(async () => {
      if (!current || current.id !== id || !frameWrap.classList.contains("active") || document.hidden) return;
      const existing = await getCover(id);
      if (existing && (RANK[existing.source] || 0) >= RANK.capture) return;
      const blob = await capture(frameWrap, 960);
      if (!blob || await window.NoberuCovers.isBlank(blob)) return;
      putCover(id, await window.NoberuCovers.shrink(blob, 640), "capture");
    }, delay));
  });

  // --- adding games ------------------------------------------------------------------

  let adding = false;

  function showProgress(text) {
    progress.hidden = !text;
    progress.textContent = text || "";
  }

  async function addWith(task) {
    if (adding) return;
    adding = true;
    addButton.disabled = true;
    try {
      const entry = await task(showProgress);
      if (!entry) return;
      showProgress(`Added ${prettyName(entry.name)}.`);
      selected = entry.id;
      await render();
      // While permission to read it is fresh: look for its cover now.
      if (entry.engine !== "archive" && window.NoberuCovers) {
        try {
          const files = await Library().getFiles(entry);
          const found = await window.NoberuCovers.fromFiles(files, entry.engine);
          if (found) await putCover(entry.id, found.blob, found.source);
        } catch (error) { /* it gets one when it is played */ }
      }
      if (entry.engine === "archive") showProgress(`${prettyName(entry.name)} is an archive: press “unzip to play”.`);
      else if (!Library().tabFor(entry.engine)) showProgress(`Added, but no engine here plays it (it looks like ${Library().engineLabel(entry.engine)}).`);
      else setTimeout(() => showProgress(""), 4000);
      select(entry.id);
    } catch (error) {
      if (error && error.name === "AbortError") showProgress("");
      else showProgress(String((error && error.message) || error));
    } finally {
      adding = false;
      addButton.disabled = false;
    }
  }

  function openAddMenu(open) {
    addMenu.hidden = !open;
    addButton.setAttribute("aria-expanded", String(open));
    if (open) addMenu.querySelector("button").focus();
  }

  function addFolder() {
    if (window.showDirectoryPicker) addWith((say) => Library().addFolder(say));
    else folderInput.click();
  }

  function onAdd(kind) {
    openAddMenu(false);
    if (kind === "folder") addFolder();
    else if (kind === "file") fileInput.click();
    else if (kind === "link") {
      Library().openManager();
      setTimeout(() => {
        const field = document.querySelector("#library-url");
        if (field) field.focus();
      }, 50);
    } else if (kind === "beam") window.NoberuBeam && window.NoberuBeam.receive();
    else if (kind === "demo") addWith((say) => Library().addFromUrl(DEMO_URL, say).then(async (entry) => {
      // The demo arrives zipped; unpack it so it is ready to play.
      if (entry.engine === "archive") return Library().unzip(entry, say);
      return entry;
    }));
  }

  addButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openAddMenu(addMenu.hidden);
  });
  addMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-add]");
    if (item) onAdd(item.dataset.add);
  });
  empty.addEventListener("click", (event) => {
    const item = event.target.closest("[data-add]");
    if (item) onAdd(item.dataset.add);
  });
  document.addEventListener("click", (event) => {
    if (!addMenu.hidden && !event.target.closest(".shelf-add-wrap")) openAddMenu(false);
  });
  addMenu.addEventListener("keydown", (event) => {
    const items = [...addMenu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      openAddMenu(false);
      addButton.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(i + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  });

  folderInput.addEventListener("change", () => {
    const files = folderInput.files;
    if (files && files.length) addWith((say) => Library().addFiles(files, say));
    folderInput.value = "";
  });
  fileInput.addEventListener("change", () => {
    const files = fileInput.files;
    if (files && files.length) addWith((say) => Library().addFiles(files, say));
    fileInput.value = "";
  });

  // --- drop anywhere ----------------------------------------------------------------

  // A folder or a .zip dropped anywhere on the page goes on the shelf. The
  // engine tabs' own drop areas still take what is dropped on them.
  const dropHint = document.createElement("div");
  dropHint.className = "shelf-drop";
  dropHint.innerHTML = `<div><b>Drop to add it to your games</b><span>a game's folder, or a .zip / .7z</span></div>`;
  dropHint.hidden = true;
  document.body.appendChild(dropHint);

  let dragDepth = 0;
  const carriesFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes("Files");
  const ownDropArea = (target) => target && target.closest &&
    target.closest(".upload-zone, [id$='drop-surface'], .library-modal, .play-frame-wrap");

  document.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    dragDepth++;
    if (!ownDropArea(event.target)) dropHint.hidden = false;
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint.hidden = true;
  });
  document.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || ownDropArea(event.target)) {
      dropHint.hidden = true;
      return;
    }
    dropHint.hidden = false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("drop", async (event) => {
    dragDepth = 0;
    dropHint.hidden = true;
    if (event.defaultPrevented || !carriesFiles(event) || ownDropArea(event.target)) return;
    event.preventDefault();
    const items = [...event.dataTransfer.items].filter((item) => item.kind === "file");
    if (!items.length) return;
    // Taken synchronously: the list is emptied once this handler returns.
    const handles = items.map((item) => item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null);
    const entriesApi = items.map((item) => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null);
    const files = items.map((item) => item.getAsFile());
    setTabShelf();

    addWith(async (say) => {
      // Chrome and Edge: a folder handle, linked like "add folder".
      const handle = handles[0] && await handles[0].catch(() => null);
      if (handle && handle.kind === "directory") return Library().addHandle(handle, say);
      // Elsewhere: read the dropped folder's files, which are then copied in.
      const entry = entriesApi[0];
      if (entry && entry.isDirectory) {
        say("reading the folder...");
        const all = await readDropped(entry);
        return Library().addFiles(all, say);
      }
      if (files[0]) return Library().addFiles([files[0]], say);
      return null;
    });
  });

  // A dropped folder's files, carrying webkitRelativePath like a folder input.
  async function readDropped(root) {
    const out = [];
    // readEntries hands out a batch at a time, until an empty one.
    async function children(dir) {
      const reader = dir.createReader();
      const all = [];
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) return all;
        all.push(...batch);
      }
    }
    async function walk(entry, path) {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        Object.defineProperty(file, "webkitRelativePath", { value: path + entry.name });
        out.push(file);
        return;
      }
      for (const child of await children(entry)) await walk(child, `${path}${entry.name}/`);
    }
    for (const child of await children(root)) await walk(child, `${root.name}/`);
    return out;
  }

  function setTabShelf() {
    const tab = document.querySelector('.tab-button[data-tab="shelf"]');
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  }

  // --- wiring ---------------------------------------------------------------------------

  search.addEventListener("input", render);
  sort.addEventListener("change", () => {
    try {
      localStorage.setItem("noberu.shelf.sort", sort.value);
    } catch (error) { /* private mode */ }
    render();
  });
  try {
    const saved = localStorage.getItem("noberu.shelf.sort");
    if (saved) sort.value = saved;
  } catch (error) { /* default order */ }

  window.addEventListener("noberu-library-change", render);
  phoneQuery.addEventListener("change", render);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && detail.dataset.open) closeSheet();
  });
  // On a phone the sheet covers the shelf: a tap anywhere else puts it away.
  document.addEventListener("pointerdown", (event) => {
    if (!detail.dataset.open || detail.contains(event.target)) return;
    if (event.target.closest(".shelf-card, .library-backdrop, .shelf-shot-view")) return;
    closeSheet();
  });
  // "/" jumps to search, as on most sites with one.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (!document.querySelector("#shelf-view.active")) return;
    event.preventDefault();
    search.focus();
  });

  render();

  window.NoberuShelf = {
    render,
    capture,
    addShot,
    putCover,
    current: () => current,
    play,
    select,
  };
})();
