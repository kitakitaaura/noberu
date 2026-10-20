/**
 * Free games: a list under the shelf of freeware visual novels that noberu can
 * play, each one click from being on the shelf.
 *
 * Every file comes from its makers' own site (or, for Narcissu, noberu's copy
 * on Hugging Face), through NoberuLibrary.addFromUrl - so through the relay
 * when the site sends no CORS headers. Nothing is hosted here. Only games that
 * were downloaded, unpacked and booted in noberu are listed.
 *
 * A game with `ages` says so on its card; with `adult`, "get" first asks in a
 * popup whether the player is 18 or older. A game with `manual` has no link
 * that can be fetched (DDLC asks what you'd like to pay first), so its card
 * opens the makers' page and then takes the file the player downloaded there.
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
    {
      id: "katawa-shoujo",
      title: "Katawa Shoujo: Re-Engineered",
      vndb: "v945",
      engine: "Ren'Py",
      lang: "English",
      minutes: 2025,
      bytes: 1472512914,
      url: "https://github.com/fleetingheart/ksre/releases/download/v2.0.5/KSRE-win.zip",
      site: "https://github.com/fleetingheart/ksre",
      host: "github.com",
      cover: "https://t.vndb.org/cv/88/88188.jpg",
      blurb: "A new student at a school for the disabled, and the five girls he gets to know.",
      ages: "18+",
      adult: true,
    },
    {
      id: "ddlc",
      title: "Doki Doki Literature Club!",
      vndb: "v21905",
      engine: "Ren'Py",
      lang: "English",
      minutes: 390,
      bytes: 231593427,
      manual: /^ddlc-(win|mac)\.zip$/i,
      fileName: "ddlc-win.zip or ddlc-mac.zip",
      site: "https://ddlc.moe/",
      host: "ddlc.moe",
      cover: "https://t.vndb.org/cv/36/79136.jpg",
      blurb: "Join the literature club and write poems with four girls. Not for the easily disturbed.",
      ages: "13+",
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

  // Games on the shelf, by the link they came from or the list's id for them.
  async function onShelf() {
    const have = new Map();
    for (const entry of await Library().list()) {
      if (entry.source) have.set(entry.source, entry);
      if (entry.free) have.set(entry.free, entry);
    }
    return have;
  }

  function actions(game, entry) {
    if (entry && entry.engine !== "archive") {
      return `<button class="retro-button" type="button" data-play="${entry.id}">play</button>
        <a href="${escapeHtml(game.site)}" target="_blank" rel="noopener">${escapeHtml(game.host)}</a>`;
    }
    const off = busy ? " disabled" : "";
    if (game.manual) {
      return `<a class="retro-button secondary" href="${escapeHtml(game.site)}" target="_blank" rel="noopener">get it at ${escapeHtml(game.host)}</a>
        <button class="retro-button secondary" type="button" data-file${off}>then add the .zip</button>`;
    }
    return `<button class="retro-button secondary" type="button" data-get${off}>get · ${size(game.bytes)}</button>
      <a href="${escapeHtml(game.site)}" target="_blank" rel="noopener">${escapeHtml(game.host)}</a>`;
  }

  async function render() {
    const have = await onShelf();
    $("#free-count", section).textContent = `${GAMES.length} game${GAMES.length === 1 ? "" : "s"} · from their makers' own sites`;
    grid.innerHTML = GAMES.map((game) => `
        <article class="free-card" role="listitem" data-game="${game.id}">
          <span class="shelf-cover" data-fit="cover" style="--c:${color(game.id)}">
            <img src="${Shelf().coverLink(game.cover)}" alt="" loading="lazy" />
          </span>
          <span class="shelf-card-text">
            <span class="shelf-name">${escapeHtml(game.title)}</span>
            <span class="shelf-meta">${game.ages ? `<b class="free-ages">${escapeHtml(game.ages)}</b> ` : ""}${escapeHtml(game.engine)} · ${escapeHtml(game.lang)} · ${length(game.minutes)}</span>
          </span>
          <p class="free-blurb">${escapeHtml(game.blurb)}</p>
          <div class="free-actions">${actions(game, have.get(game.url) || have.get(game.id))}</div>
          <p class="free-status" role="status"></p>
        </article>`).join("");
  }

  // The same colours as the shelf's letter covers, for when a cover can't load.
  const COLORS = ["#ff8a65", "#ffb74d", "#ffd54f", "#ffcc80", "#b39ddb", "#4fc3f7", "#9fa8ff", "#ce93d8", "#f48fb1", "#ff9e9e"];
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

  // From the game's link, or from `file` for a game the player downloaded.
  async function get(game, card, file) {
    const status = $(".free-status", card);
    const say = (text) => { status.textContent = text; };
    busy = game.id;
    grid.querySelectorAll("[data-get], [data-file]").forEach((b) => { b.disabled = true; });
    try {
      const estimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      // The zip and what comes out of it are both on disk for a moment.
      if (!file && estimate && estimate.quota && estimate.quota - estimate.usage < game.bytes * 2.2) {
        throw new Error(`Not enough room in this browser: it needs about ${size(game.bytes * 2.2)} free.`);
      }
      let entry;
      if (file) {
        entry = await Library().addFiles([file], say);
      } else {
        entry = await Library().addFromUrl(game.url, say);
        if (entry.engine === "archive") entry = await Library().unzip(entry, say);
      }
      entry = await Library().rename(entry, game.title, { free: game.id });
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
    const fileButton = event.target.closest("[data-file]");
    if (fileButton && !busy) {
      picking = GAMES.find((g) => g.id === fileButton.closest("[data-game]").dataset.game);
      fileInput.click();
      return;
    }
    const button = event.target.closest("[data-get]");
    if (!button || busy) return;
    const card = button.closest("[data-game]");
    const game = GAMES.find((g) => g.id === card.dataset.game);
    if (!game.adult) return get(game, card);
    askAge(game).then((yes) => {
      if (yes) get(game, card);
      else button.focus();
    });
  });

  // --- 18+ ----------------------------------------------------------------------

  // Resolves true only for "yes"; "no", Escape and a click outside are a no.
  function askAge(game) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "library-backdrop";
      backdrop.innerHTML = `
        <div class="library-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="free-age-title">
          <div class="library-bar"><b id="free-age-title">are you 18 or older?</b></div>
          <div class="library-add">
            <p class="control-note">${escapeHtml(game.title)} has adult scenes. Only download it if you're 18 or older.</p>
          </div>
          <div class="library-foot install-foot">
            <button class="retro-button" type="button" data-age="yes">yes, I'm 18+ · get ${size(game.bytes)}</button>
            <button class="retro-button secondary" type="button" data-age="no">no</button>
          </div>
        </div>`;
      const done = (yes) => {
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(yes);
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          done(false);
        }
      };
      backdrop.addEventListener("click", (event) => {
        const choice = event.target.closest("[data-age]");
        if (choice) done(choice.dataset.age === "yes");
        else if (event.target === backdrop) done(false);
      });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-age="no"]').focus();
    });
  }

  // The file the player downloaded from a `manual` game's page.
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".zip";
  fileInput.hidden = true;
  section.appendChild(fileInput);
  let picking = null;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    const game = picking;
    fileInput.value = "";
    picking = null;
    if (!file || !game) return;
    const card = grid.querySelector(`[data-game="${game.id}"]`);
    if (!game.manual.test(file.name)) {
      $(".free-status", card).textContent = `That's ${file.name}; the file from ${game.host} is called ${game.fileName}.`;
      return;
    }
    get(game, card, file);
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
