/**
 * Free games: a list under the shelf of freeware visual novels that noberu can
 * play, each one click from being on the shelf.
 *
 * Every file comes from its makers' own site (or, for Narcissu, noberu's copy
 * on Hugging Face), through NoberuLibrary.addFromUrl - so through the relay
 * when the site sends no CORS headers. Nothing is hosted here. Only games that
 * were downloaded, unpacked and booted in noberu are listed, all ages only.
 *
 * Covers come from vndb through the cover route on the beam Worker; offline,
 * a card falls back to its letter.
 *
 * Loaded after shelf.js and library.js.
 */
(function () {
  "use strict";

  const MB = 1024 * 1024;

  const GAMES = [
    {
      id: "narcissu",
      title: "Narcissu",
      vndb: "v10",
      engine: "NScripter",
      lang: "English",
      minutes: 168,
      bytes: 105452448,
      url: "https://huggingface.co/datasets/noberu/noberu-demo/resolve/main/Narcissu.zip",
      site: "http://narcissu.insani.org/",
      host: "insani.org",
      cover: "https://t.vndb.org/cv/13/93313.jpg",
      blurb: "Two terminally ill patients leave the hospital for one last drive.",
    },
    {
      id: "may-sky",
      title: "May Sky",
      vndb: "v1371",
      engine: "NScripter",
      lang: "English",
      minutes: 270,
      bytes: 78748032,
      url: "http://www.insani.org/releases/MaySkyMac%5Binsani%5D%5BAT2008%5D.zip",
      site: "http://altogether.insani.org/2008/5.html",
      host: "insani.org",
      cover: "https://t.vndb.org/cv/99/147699.jpg",
      blurb: "A worn-out new office worker meets a shrine maiden just as tired of everyone.",
    },
    {
      id: "moonshine",
      title: "Moonshine",
      vndb: "v1296",
      engine: "NScripter",
      lang: "English",
      minutes: 61,
      bytes: 116613991,
      url: "http://www.insani.org/releases/MoonshineMac%5BAstCd2%5D%5BAT2008%5D.zip",
      site: "http://altogether.insani.org/2008/4.html",
      host: "insani.org",
      cover: "https://t.vndb.org/cv/38/83438.jpg",
      blurb: "Out of work and out of options, a young man finds a job at a bar, and a friend.",
    },
    {
      id: "the-letter",
      title: "The Letter",
      vndb: "v1298",
      engine: "NScripter",
      lang: "English",
      minutes: 53,
      bytes: 40488546,
      url: "http://www.insani.org/releases/TegamiMac%5Binsani%5D%5BAT2008%5D.zip",
      site: "http://altogether.insani.org/2008/3.html",
      host: "insani.org",
      cover: "https://t.vndb.org/cv/99/1599.jpg",
      blurb: "A college student goes home to the countryside and comes back changed.",
    },
    {
      id: "ripples",
      title: "Ripples",
      vndb: "v988",
      engine: "Ren'Py",
      lang: "English",
      minutes: 12,
      bytes: 47386307,
      url: "https://www.sakevisual.com/kurara/ripples-1.0-all.zip",
      site: "https://www.sakevisual.com/ripples.html",
      host: "sakevisual.com",
      cover: "https://t.vndb.org/cv/19/50219.jpg",
      blurb: "A photographer who dislikes people, a girl, and some cookies. Fully voiced.",
    },
    {
      id: "carrot-cake",
      title: "Carrot Cake Jinkaku Shuffle Jiken",
      vndb: "v24294",
      engine: "KiriKiri",
      lang: "English",
      minutes: 30,
      bytes: 128345584,
      url: "https://drive.usercontent.google.com/download?id=1x4KE6Q0jyqPfs-906k6BjpegcD_QYfEX&export=download&confirm=t",
      site: "http://novect.net/2015April_en/",
      host: "novect.net",
      cover: "https://t.vndb.org/cv/23/36723.jpg",
      blurb: "An April Fools' spin-off of The House in Fata Morgana: one cake swaps everyone's souls.",
    },
    {
      id: "seventh-coat",
      title: "Seventh Coat",
      vndb: "v14878",
      engine: "KiriKiri",
      lang: "Japanese",
      minutes: 249,
      bytes: 126824919,
      url: "https://drive.usercontent.google.com/download?id=1L4qi9_aZGPgz0tPSWKzVbGvpnkYelRMZ&export=download&confirm=t",
      site: "http://novect.net/april.html",
      host: "novect.net",
      cover: "https://t.vndb.org/cv/89/77789.jpg",
      blurb: "A struggling indie game developer hears from a very keen fan. Good practice with the dictionary.",
    },
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const section = $("#free-games");
  if (!section) return;
  const grid = $("#free-grid", section);
  const Library = () => window.NoberuLibrary;
  const Shelf = () => window.NoberuShelf;

  let busy = null; // the id of the game downloading now

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  const length = (minutes) => minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
  const size = (bytes) => bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;

  async function onShelf() {
    const byUrl = new Map();
    for (const entry of await Library().list()) if (entry.source) byUrl.set(entry.source, entry);
    return byUrl;
  }

  async function render() {
    const have = await onShelf();
    $("#free-count", section).textContent = `${GAMES.length} game${GAMES.length === 1 ? "" : "s"} · from their makers' own sites`;
    grid.innerHTML = GAMES.map((game) => {
      const entry = have.get(game.url);
      const ready = entry && entry.engine !== "archive";
      return `
        <article class="free-card" role="listitem" data-game="${game.id}">
          <span class="shelf-cover" data-fit="cover" style="--c:${color(game.id)}">
            <img src="${Shelf().coverLink(game.cover)}" alt="" loading="lazy" />
          </span>
          <span class="shelf-card-text">
            <span class="shelf-name">${escapeHtml(game.title)}</span>
            <span class="shelf-meta">${escapeHtml(game.engine)} · ${escapeHtml(game.lang)} · ${length(game.minutes)}</span>
          </span>
          <p class="free-blurb">${escapeHtml(game.blurb)}</p>
          <div class="free-actions">
            ${ready
              ? `<button class="retro-button" type="button" data-play="${entry.id}">play</button>`
              : `<button class="retro-button secondary" type="button" data-get${busy ? " disabled" : ""}>get · ${size(game.bytes)}</button>`}
            <a href="${escapeHtml(game.site)}" target="_blank" rel="noopener">${escapeHtml(game.host)}</a>
          </div>
          <p class="free-status" role="status"></p>
        </article>`;
    }).join("");
  }

  // The same colours as the shelf's letter covers, for when a cover can't load.
  const COLORS = ["#ff8a65", "#ffb74d", "#ffd54f", "#aed581", "#4dd0b4", "#4fc3f7", "#9fa8ff", "#ce93d8", "#f48fb1", "#ff9e9e"];
  function color(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.codePointAt(0)) % 360;
    return COLORS[h % COLORS.length];
  }

  grid.addEventListener("error", (event) => {
    const img = event.target;
    if (img.tagName !== "IMG") return;
    const cover = img.closest(".shelf-cover");
    const game = GAMES.find((g) => g.id === img.closest("[data-game]").dataset.game);
    cover.dataset.fit = "none";
    cover.innerHTML = `<span class="shelf-cover-initial" aria-hidden="true">${escapeHtml(game.title[0].toUpperCase())}</span>`;
  }, true);

  async function get(game, card) {
    const status = $(".free-status", card);
    const say = (text) => { status.textContent = text; };
    busy = game.id;
    grid.querySelectorAll("[data-get]").forEach((b) => { b.disabled = true; });
    try {
      const estimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      // The zip and what comes out of it are both on disk for a moment.
      if (estimate && estimate.quota && estimate.quota - estimate.usage < game.bytes * 2.2) {
        throw new Error(`Not enough room in this browser: it needs about ${size(game.bytes * 2.2)} free.`);
      }
      let entry = await Library().addFromUrl(game.url, say);
      if (entry.engine === "archive") entry = await Library().unzip(entry, say);
      entry = await Library().rename(entry, game.title);
      say("getting the cover...");
      try {
        const image = await fetch(Shelf().coverLink(game.cover));
        if (image.ok) {
          const blob = await window.NoberuCovers.shrink(await image.blob(), 720);
          await Shelf().putCover(entry.id, blob, "vndb", { vndb: game.vndb, title: game.title }, true);
        }
      } catch (error) { /* the letter cover will do */ }
      busy = null;
      await render();
      Shelf().select(entry.id);
      say("");
    } catch (error) {
      busy = null;
      await render();
      $(".free-status", grid.querySelector(`[data-game="${game.id}"]`)).textContent = String((error && error.message) || error);
    }
  }

  grid.addEventListener("click", (event) => {
    const play = event.target.closest("[data-play]");
    if (play) {
      Shelf().play(play.dataset.play);
      return;
    }
    const button = event.target.closest("[data-get]");
    if (!button || busy) return;
    const card = button.closest("[data-game]");
    get(GAMES.find((g) => g.id === card.dataset.game), card);
  });

  // While a download runs, the list keeps its buttons; otherwise it follows the shelf.
  window.addEventListener("noberu-library-change", () => {
    if (!busy) render();
  });

  function show() {
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    const first = grid.querySelector("[data-get], [data-play]");
    if (first) first.focus({ preventScroll: true });
  }

  render();
  window.NoberuFree = { games: GAMES, show, render };
})();
