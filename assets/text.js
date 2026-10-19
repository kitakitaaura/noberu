/**
 * Reading tools: a game's text, outside the game.
 *
 * Engines that share their text (see HOOKED) send every line they show here,
 * through NoberuSay in assets/runtime.js. With the reader open, the line sits
 * in a bar over the game where:
 *   - hovering (or tapping) a word looks it up in a Japanese-English
 *     dictionary (JMdict, built into dict/ by tools/build-dict.mjs), with
 *     inflections undone by assets/deinflect.js and each kanji explained
 *   - it can be translated on the device, by the browser's own translator
 *     (Chrome's Translator API); nothing is sent anywhere for that
 *   - words can be saved, with the sentence they came from, and exported for
 *     Anki or a spreadsheet
 *   - every line is kept in a backlog, and can be copied
 * For text-hooker setups, each line can also go to the clipboard or to a
 * WebSocket (settings → reading).
 *
 *   NoberuText.push({ text, name, kind, from })   from an engine
 *   NoberuText.toggle(frameWrap) / off / isOn     the in-game menu's button
 */
(function () {
  "use strict";

  const SHARDS = 1024;
  const KANJI_SHARDS = 64;
  const MAX_LINES = 1000;
  const WORDS_KEY = "noberu.words";

  // Engines whose text reaches this file; others get an honest note.
  const HOOKED = {
    "renpy-frame-wrap": "Ren'Py",
    "rpgmaker-frame-wrap": "RPG Maker",
    "tyrano-frame-wrap": "TyranoScript",
    "ons-frame-wrap": "NScripter",
    "pons-frame-wrap": "Ponscripter",
    "rlvm-frame-wrap": "RealLive",
    "onsru-frame-wrap": "Umineko",
    "kirikiri-frame-wrap": "KiriKiri",
    "siglus-frame-wrap": "Siglus",
    "vnds-frame-wrap": "VNDS",
  };

  function setting(name, fallback) {
    return window.NoberuSettings ? window.NoberuSettings.get(name) : fallback;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  // --- where a line came from ---------------------------------------------------------

  const state = new Map(); // frameWrap -> { lines, at, reader, popup }

  function stateFor(frameWrap) {
    if (!state.has(frameWrap)) state.set(frameWrap, { lines: [], at: -1, reader: null, hooked: false });
    return state.get(frameWrap);
  }

  function frameOf(win) {
    if (!win) return null;
    for (const wrap of document.querySelectorAll(".play-frame-wrap")) {
      const iframe = wrap.querySelector("iframe");
      if (!iframe) continue;
      try {
        let w = win;
        for (let depth = 0; depth < 4 && w; depth++) {
          if (w === iframe.contentWindow) return wrap;
          w = w.parent === w ? null : w.parent;
        }
      } catch (error) { /* another origin */ }
    }
    return null;
  }

  function clean(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/[ \t　]*\n[ \t　]*/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  // Japanese wraps without spaces; joining its lines with one would split words.
  function oneLine(text) {
    return text.replace(/\n+/g, (m, offset, all) => {
      const before = all[offset - 1] || "";
      const after = all[offset + m.length] || "";
      return isJapanese(before) || isJapanese(after) ? "" : " ";
    });
  }

  const JAPANESE = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ々〆ヵヶ]/;
  const KANA = /[぀-ヿｦ-ﾟ]/;
  const isJapanese = (c) => JAPANESE.test(c);

  function push(data) {
    if (!data || !data.text) return;
    const frameWrap = frameOf(data.from) || (window.NoberuInput && window.NoberuInput.activeFrame());
    if (!frameWrap) return;
    const s = stateFor(frameWrap);
    s.hooked = true;
    // A menu's choices stay one per line.
    const text = data.kind === "choice" ? clean(data.text) : oneLine(clean(data.text));
    if (!text) return;
    const name = clean(data.name || "").replace(/^[「『【]|[」』】]$/g, "");
    const last = s.lines[s.lines.length - 1];
    // Engines re-show a line on load and rollback; one copy is enough.
    if (last && last.text === text && last.name === name && Date.now() - last.t < 2500) return;
    const line = { text, name, kind: data.kind || "line", t: Date.now() };
    s.lines.push(line);
    if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
    s.at = s.lines.length - 1;
    if (s.reader) renderLine(frameWrap);
    hookers(line);
  }

  // --- out to text hookers -------------------------------------------------------------

  let socket = null;
  let socketUrl = "";

  function hookers(line) {
    const out = line.name ? `${line.name}「${line.text}」` : line.text;
    if (setting("textClipboard", "0") === "1" && navigator.clipboard && document.hasFocus()) {
      navigator.clipboard.writeText(out).catch(() => { });
    }
    const url = setting("textSocket", "").trim();
    if (!url) return;
    if (!socket || socketUrl !== url || socket.readyState > 1) {
      try {
        socketUrl = url;
        socket = new WebSocket(url);
      } catch (error) {
        socket = null;
        return;
      }
    }
    const send = () => {
      try {
        socket.send(out);
      } catch (error) { /* gone */ }
    };
    if (socket.readyState === 1) send();
    else socket.addEventListener("open", send, { once: true });
  }

  // --- dictionary -----------------------------------------------------------------------

  // FNV-1a of the first two characters; tools/build-dict.mjs files words the same way.
  function shardOf(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < Math.min(2, text.length); i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h % SHARDS;
  }

  const shards = new Map();
  function shard(n) {
    if (!shards.has(n)) {
      shards.set(n, fetch(`dict/ja-en/${n}.json`)
        .then((r) => (r.ok ? r.json() : { w: {}, i: {} }))
        .catch(() => {
          shards.delete(n);
          return { w: {}, i: {} };
        }));
    }
    return shards.get(n);
  }

  const kanjiShards = new Map();
  function kanjiInfo(ch) {
    const n = ch.codePointAt(0) % KANJI_SHARDS;
    if (!kanjiShards.has(n)) {
      kanjiShards.set(n, fetch(`dict/kanji/${n}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => {
        kanjiShards.delete(n);
        return {};
      }));
    }
    return kanjiShards.get(n).then((table) => table[ch] || null);
  }

  let tagNames = null;
  function tags() {
    if (!tagNames) {
      tagNames = fetch("dict/ja-en/meta.json").then((r) => r.json()).then((m) => m.tags || {}).catch(() => ({}));
    }
    return tagNames;
  }

  const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

  // Half-width katakana and full-width Latin, as some older games write them.
  function normalize(s) {
    return s.normalize("NFKC");
  }

  // Everything that starts at `start`: the longest match first.
  async function lookup(text, start) {
    let end = start;
    while (end < text.length && end - start < 18 && !/[\s、。！？!?…「」『』（）()【】・,.\-—:;"“”]/.test(text[end])) end++;
    if (end === start) return { length: 0, results: [] };
    const found = new Map();
    for (let len = end - start; len >= 1; len--) {
      const raw = normalize(text.slice(start, start + len));
      const variants = new Set([raw, toHiragana(raw), toKatakana(raw)]);
      for (const variant of variants) {
        for (const candidate of window.NoberuDeinflect(variant)) {
          const table = await shard(shardOf(candidate.text));
          for (const id of table.i[candidate.text] || []) {
            const entry = table.w[id];
            if (!entry) continue;
            const pos = entry.s.flatMap((sense) => sense[0]);
            if (!window.NoberuDeinflect.matches(candidate.type, pos)) continue;
            const previous = found.get(id);
            const score = len * 100 - candidate.reasons.length * 3 + (entry.c ? 2 : 0) + (variant === raw ? 1 : 0);
            if (!previous || previous.score < score) {
              found.set(id, { id, entry, len, reasons: candidate.reasons, form: candidate.text, score });
            }
          }
        }
      }
      // A long match settles it; shorter ones would only be its pieces.
      if (found.size && [...found.values()].some((f) => f.len === len) && len >= 2) break;
    }
    const results = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 6);
    return { length: results.length ? results[0].len : 0, results };
  }

  // --- saved words ------------------------------------------------------------------------

  function readWords() {
    try {
      return JSON.parse(localStorage.getItem(WORDS_KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  function writeWords(words) {
    try {
      localStorage.setItem(WORDS_KEY, JSON.stringify(words.slice(-5000)));
    } catch (error) { /* private mode */ }
  }

  function saveWord(found, sentence) {
    const words = readWords();
    const expression = (found.entry.k.find((k) => !k.startsWith("~")) || found.entry.r[0] || "").replace(/^~/, "");
    const reading = (found.entry.r[0] || "").replace(/^~/, "");
    if (words.some((w) => w.expression === expression && w.reading === reading)) return false;
    const game = window.NoberuShelf && window.NoberuShelf.current();
    words.push({
      expression,
      reading,
      meaning: found.entry.s.slice(0, 3).map((s, i) => `${i + 1}. ${s[1]}`).join(" "),
      sentence,
      game: game ? game.name : "",
      at: Date.now(),
    });
    writeWords(words);
    return true;
  }

  function exportWords(kind) {
    const words = readWords();
    const cell = (v) => (kind === "csv" ? `"${String(v).replace(/"/g, '""')}"` : String(v).replace(/[\t\n]/g, " "));
    const header = ["expression", "reading", "meaning", "sentence", "game", "saved"];
    const rows = words.map((w) => [w.expression, w.reading, w.meaning, w.sentence, w.game, new Date(w.at).toISOString().slice(0, 10)]);
    const sep = kind === "csv" ? "," : "\t";
    const body = (kind === "csv" ? [header, ...rows] : rows).map((r) => r.map(cell).join(sep)).join("\n");
    const blob = new Blob([kind === "csv" ? "﻿" + body : body], { type: kind === "csv" ? "text/csv" : "text/tab-separated-values" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `noberu-words.${kind === "csv" ? "csv" : "txt"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // --- translation ---------------------------------------------------------------------------

  function sourceLanguage(text) {
    if (KANA.test(text)) return "ja";
    if (/[가-힯]/.test(text)) return "ko";
    if (/[一-鿿]/.test(text)) return "ja";
    if (/[Ѐ-ӿ]/.test(text)) return "ru";
    return "en";
  }

  function targetLanguage() {
    return setting("textTarget", "") || (navigator.language || "en").split("-")[0];
  }

  const translators = new Map(); // "ja>en" -> Promise<Translator|null>
  const translated = new Map();  // "ja>en:text" -> string

  function translatorApi() {
    return typeof self.Translator === "function" || (self.Translator && self.Translator.create) ? self.Translator : null;
  }

  // Asked once per language pair. Some browsers (Electron shells among them)
  // have the API but never answer, so a silence counts as "no".
  const availabilityCache = new Map();
  function availability(source, target) {
    const api = translatorApi();
    if (!api) return Promise.resolve("missing");
    const key = `${source}>${target}`;
    const cached = availabilityCache.get(key);
    if (cached && cached !== "downloadable") return Promise.resolve(cached);
    const ask = Promise.race([
      api.availability({ sourceLanguage: source, targetLanguage: target }).catch(() => "unavailable"),
      new Promise((resolve) => setTimeout(() => resolve("missing"), 4000)),
    ]).then((answer) => {
      availabilityCache.set(key, answer);
      return answer;
    });
    return ask;
  }

  // Creating a translator that still has to download needs a click; `ready`
  // is false until then.
  function getTranslator(source, target, onProgress) {
    const key = `${source}>${target}`;
    if (!translators.has(key)) {
      const api = translatorApi();
      translators.set(key, api.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor(m) {
          m.addEventListener("downloadprogress", (event) => onProgress && onProgress(event.loaded));
        },
      }).catch((error) => {
        translators.delete(key);
        throw error;
      }));
    }
    return translators.get(key);
  }

  async function translate(text, onProgress) {
    const source = sourceLanguage(text);
    const target = targetLanguage();
    if (source === target) return { same: true };
    const key = `${source}>${target}:${text}`;
    if (translated.has(key)) return { text: translated.get(key) };
    const state = await availability(source, target);
    if (state === "missing") return { missing: true, source, target };
    if (state === "unavailable") return { unavailable: true, source, target };
    if (state !== "available" && !navigator.userActivation?.isActive && !translators.has(`${source}>${target}`)) {
      return { needsClick: true, source, target };
    }
    const translator = await getTranslator(source, target, onProgress);
    const out = await translator.translate(text);
    translated.set(key, out);
    return { text: out };
  }

  // --- the reader -------------------------------------------------------------------------------

  const ICON = {
    prev: '<path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    next: '<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    log: '<path d="M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    tr: '<path d="M2 3.5h7M5.5 2v1.5M3.5 3.5c.5 2.5 2 4.3 4.5 5.3M7.5 3.5c-.5 2.3-2 4.3-5 5.6M9 14l3-7 3 7M10 11.8h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 10.5V3.8C3 3.3 3.3 3 3.8 3h6.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    star: '<path d="m8 2 1.8 3.8 4.1.5-3 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1-3-2.9 4.1-.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    move: '<path d="M8 2v12M4.5 5.5 8 2l3.5 3.5M4.5 10.5 8 14l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

  function isOn(frameWrap) {
    return !!(frameWrap && state.has(frameWrap) && state.get(frameWrap).reader);
  }

  function toggle(frameWrap) {
    frameWrap = frameWrap || (window.NoberuInput && window.NoberuInput.activeFrame());
    if (!frameWrap) return;
    if (isOn(frameWrap)) off(frameWrap);
    else on(frameWrap);
  }

  function on(frameWrap) {
    const s = stateFor(frameWrap);
    if (s.reader) return;
    const reader = document.createElement("section");
    reader.className = "nb-reader";
    reader.dataset.pos = setting("textPos", "top");
    reader.dataset.size = setting("textSize", "medium");
    reader.setAttribute("aria-label", "reading tools");
    reader.innerHTML = `
      <div class="nb-reader-bar">
        <span class="nb-reader-name" data-name></span>
        <div class="nb-reader-tools">
          <button type="button" data-r="prev" aria-label="previous line">${icon("prev")}</button>
          <button type="button" data-r="next" aria-label="next line">${icon("next")}</button>
          <button type="button" data-r="log" aria-pressed="false" aria-label="backlog">${icon("log")}<span>backlog</span></button>
          <button type="button" data-r="tr" aria-pressed="${setting("textAuto", "1") === "1"}" aria-label="translate">${icon("tr")}<span>translate</span></button>
          <button type="button" data-r="copy" aria-label="copy line">${icon("copy")}</button>
          <button type="button" data-r="words" aria-label="saved words">${icon("star")}<span data-words></span></button>
          <button type="button" data-r="move" aria-label="move to the other edge">${icon("move")}</button>
          <button type="button" data-r="close" aria-label="close reading tools">${icon("close")}</button>
        </div>
      </div>
      <div class="nb-reader-body">
        <p class="nb-reader-text" data-text lang="ja"></p>
        <p class="nb-reader-tr" data-tr hidden></p>
      </div>
      <div class="nb-reader-log" data-log hidden></div>`;
    frameWrap.appendChild(reader);
    s.reader = reader;
    reader.addEventListener("click", (event) => {
      const b = event.target.closest("[data-r]");
      if (b) onTool(frameWrap, b.dataset.r, b);
    });
    bindText(frameWrap, reader.querySelector("[data-text]"));
    renderLine(frameWrap);
  }

  function off(frameWrap) {
    const s = state.get(frameWrap);
    if (!s || !s.reader) return;
    closePopup(frameWrap);
    s.reader.remove();
    s.reader = null;
  }

  function onTool(frameWrap, tool, button) {
    const s = stateFor(frameWrap);
    const line = s.lines[s.at];
    if (tool === "close") return off(frameWrap);
    if (tool === "prev" && s.at > 0) {
      s.at--;
      renderLine(frameWrap);
    }
    if (tool === "next" && s.at < s.lines.length - 1) {
      s.at++;
      renderLine(frameWrap);
    }
    if (tool === "copy" && line) {
      navigator.clipboard && navigator.clipboard.writeText(line.text).then(() => flashButton(button)).catch(() => { });
    }
    if (tool === "move") {
      const pos = s.reader.dataset.pos === "top" ? "bottom" : "top";
      s.reader.dataset.pos = pos;
      window.NoberuSettings && window.NoberuSettings.set("textPos", pos);
    }
    if (tool === "tr") {
      const onNow = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(onNow));
      window.NoberuSettings && window.NoberuSettings.set("textAuto", onNow ? "1" : "0");
      renderTranslation(frameWrap, true);
    }
    if (tool === "log") {
      const log = s.reader.querySelector("[data-log]");
      log.hidden = !log.hidden;
      button.setAttribute("aria-pressed", String(!log.hidden));
      if (!log.hidden) renderLog(frameWrap);
    }
    if (tool === "words") {
      const log = s.reader.querySelector("[data-log]");
      log.hidden = false;
      s.reader.querySelector('[data-r="log"]').setAttribute("aria-pressed", "false");
      renderWords(frameWrap);
    }
  }

  function flashButton(button) {
    button.classList.add("done");
    setTimeout(() => button.classList.remove("done"), 700);
  }

  function renderLine(frameWrap) {
    const s = stateFor(frameWrap);
    if (!s.reader) return;
    const line = s.lines[s.at];
    const textEl = s.reader.querySelector("[data-text]");
    const nameEl = s.reader.querySelector("[data-name]");
    s.reader.querySelector("[data-words]").textContent = readWords().length || "";
    closePopup(frameWrap);
    if (!line) {
      nameEl.textContent = "";
      const engine = HOOKED[frameWrap.id];
      textEl.innerHTML = `<span class="nb-reader-wait">${engine
        ? "Waiting for the next line..."
        : "This engine doesn't share its text yet."}</span>`;
      // Some games draw text their own way, past the engine's usual path.
      clearTimeout(s.quietTimer);
      if (engine) {
        s.quietTimer = setTimeout(() => {
          if (s.reader && !s.lines.length) {
            textEl.innerHTML = `<span class="nb-reader-wait">No text from this game yet. Some games draw their text in a way noberu can't read.</span>`;
          }
        }, 45000);
      }
      s.reader.querySelector("[data-tr]").hidden = true;
      return;
    }
    nameEl.textContent = line.name || (line.kind === "choice" ? "choice" : "");
    textEl.innerHTML = [...line.text].map((c, i) =>
      c === "\n" ? "<br>" : `<span data-i="${i}">${escapeHtml(c)}</span>`).join("");
    textEl.dataset.line = String(s.at);
    s.reader.querySelector('[data-r="prev"]').disabled = s.at <= 0;
    s.reader.querySelector('[data-r="next"]').disabled = s.at >= s.lines.length - 1;
    renderTranslation(frameWrap);
    const log = s.reader.querySelector("[data-log]");
    if (!log.hidden && log.dataset.mode === "log") renderLog(frameWrap);
  }

  let translateToken = 0;
  async function renderTranslation(frameWrap, clicked = false) {
    const s = stateFor(frameWrap);
    if (!s.reader) return;
    const out = s.reader.querySelector("[data-tr]");
    const line = s.lines[s.at];
    if (!line || setting("textAuto", "1") !== "1") {
      out.hidden = true;
      return;
    }
    const token = ++translateToken;
    out.hidden = false;
    out.classList.add("pending");
    out.textContent = "translating...";
    try {
      const result = await translate(line.text, (loaded) => {
        if (token === translateToken) out.textContent = `getting the translator... ${Math.round(loaded * 100)}%`;
      });
      if (token !== translateToken) return;
      out.classList.remove("pending");
      if (result.same) out.hidden = true;
      else if (result.text) out.textContent = result.text;
      else if (result.needsClick) {
        out.innerHTML = `<button type="button" class="nb-reader-link" data-get>Download the ${result.source}→${result.target} translator</button><small>Once, then it works offline. It runs on this device.</small>`;
        out.querySelector("[data-get]").addEventListener("click", async () => {
          out.textContent = "getting the translator...";
          try {
            await getTranslator(result.source, result.target, (loaded) => {
              out.textContent = `getting the translator... ${Math.round(loaded * 100)}%`;
            });
            renderTranslation(frameWrap);
          } catch (error) {
            out.textContent = "The translator could not be downloaded.";
          }
        });
      } else {
        const url = `https://translate.google.com/?sl=${result.source}&tl=${result.target}&text=${encodeURIComponent(line.text)}&op=translate`;
        out.innerHTML = `<span>${result.missing
          ? "This browser can't translate on the device (Chrome on a computer can)."
          : `No ${result.source}→${result.target} translator in this browser.`}</span>
          <a class="nb-reader-link" href="${url}" target="_blank" rel="noopener noreferrer">open in Google Translate</a>`;
      }
    } catch (error) {
      if (token !== translateToken) return;
      out.classList.remove("pending");
      out.textContent = "Translation failed.";
      console.warn("noberu: translation failed", error);
    }
  }

  function renderLog(frameWrap) {
    const s = stateFor(frameWrap);
    const log = s.reader.querySelector("[data-log]");
    log.dataset.mode = "log";
    if (!s.lines.length) {
      log.innerHTML = `<p class="nb-reader-empty">Nothing yet.</p>`;
      return;
    }
    log.innerHTML = `
      <div class="nb-log-head">
        <b>backlog</b><span>${s.lines.length} line${s.lines.length === 1 ? "" : "s"}</span>
        <button type="button" data-l="export">save as text</button>
      </div>
      <ol>${s.lines.map((line, i) => `
        <li class="${i === s.at ? "current" : ""}" data-at="${i}">
          ${line.name ? `<b>${escapeHtml(line.name)}</b>` : ""}<span lang="ja">${escapeHtml(line.text)}</span>
        </li>`).join("")}</ol>`;
    const current = log.querySelector("li.current");
    if (current) current.scrollIntoView({ block: "nearest" });
    log.querySelectorAll("li[data-at]").forEach((li) => li.addEventListener("click", () => {
      s.at = Number(li.dataset.at);
      renderLine(frameWrap);
    }));
    log.querySelector('[data-l="export"]').addEventListener("click", () => {
      const text = s.lines.map((l) => (l.name ? `${l.name}「${l.text}」` : l.text)).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      a.download = "noberu-backlog.txt";
      a.click();
    });
  }

  function renderWords(frameWrap) {
    const s = stateFor(frameWrap);
    const log = s.reader.querySelector("[data-log]");
    log.dataset.mode = "words";
    const words = readWords().slice().reverse();
    log.innerHTML = `
      <div class="nb-log-head">
        <b>saved words</b><span>${words.length}</span>
        ${words.length ? `<button type="button" data-w="anki">for Anki</button><button type="button" data-w="csv">as CSV</button>` : ""}
        <button type="button" data-w="back">backlog</button>
      </div>
      ${words.length ? `<ol class="nb-words">${words.slice(0, 200).map((w) => `
        <li><b lang="ja">${escapeHtml(w.expression)}</b><span lang="ja">${escapeHtml(w.reading)}</span><small>${escapeHtml(w.meaning)}</small></li>`).join("")}</ol>`
        : `<p class="nb-reader-empty">Save a word from its dictionary card (★).</p>`}`;
    log.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.w === "back") return renderLog(frameWrap);
      exportWords(b.dataset.w === "csv" ? "csv" : "tsv");
    }));
  }

  // --- word cards ---------------------------------------------------------------------------------

  function bindText(frameWrap, textEl) {
    let hoverTimer = 0;
    let lastIndex = -1;
    const hover = setting("textPopup", "hover") === "hover" && matchMedia("(hover: hover)").matches;

    const show = (span) => {
      const index = Number(span.dataset.i);
      if (index === lastIndex && stateFor(frameWrap).popup) return;
      lastIndex = index;
      openCard(frameWrap, textEl, index);
    };

    if (hover) {
      textEl.addEventListener("mousemove", (event) => {
        const span = event.target.closest("span[data-i]");
        clearTimeout(hoverTimer);
        if (!span) return;
        hoverTimer = setTimeout(() => show(span), 90);
      });
      textEl.addEventListener("mouseleave", () => clearTimeout(hoverTimer));
    }
    textEl.addEventListener("click", (event) => {
      const span = event.target.closest("span[data-i]");
      if (!span) return closePopup(frameWrap);
      lastIndex = -1;
      show(span);
    });
  }

  let cardToken = 0;
  async function openCard(frameWrap, textEl, index) {
    const s = stateFor(frameWrap);
    const line = s.lines[Number(textEl.dataset.line)];
    if (!line) return;
    const token = ++cardToken;
    if (!isJapanese(line.text[index]) && !/[A-Za-z０-９Ａ-Ｚａ-ｚ]/.test(line.text[index])) return closePopup(frameWrap);
    const { length, results } = await lookup(line.text, index);
    if (token !== cardToken) return;
    textEl.querySelectorAll("span.hit").forEach((sp) => sp.classList.remove("hit"));
    if (!results.length) return closePopup(frameWrap);
    for (let i = index; i < index + length; i++) {
      const sp = textEl.querySelector(`span[data-i="${i}"]`);
      if (sp) sp.classList.add("hit");
    }
    const tagTable = await tags();
    if (token !== cardToken) return;

    closePopup(frameWrap, false);
    const card = document.createElement("div");
    card.className = "nb-dict";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "dictionary");
    const headKanji = results[0].entry.k.filter((k) => !k.startsWith("~"));
    card.innerHTML = results.map((found, n) => {
      const e = found.entry;
      const written = e.k.filter((k) => !k.startsWith("~"));
      const readings = e.r.filter((r) => !r.startsWith("~"));
      const head = written[0] || readings[0] || e.r[0].replace(/^~/, "");
      const reading = written.length ? readings.slice(0, 3).join("、") : readings.slice(1, 3).join("、");
      const usuallyKana = e.s.some((sense) => (sense[2] || []).includes("uk"));
      return `
        <article class="nb-dict-entry" data-n="${n}">
          <header>
            <b lang="ja">${escapeHtml(usuallyKana && readings[0] ? readings[0] : head)}</b>
            ${usuallyKana && written[0] ? `<span lang="ja">${escapeHtml(written[0])}</span>` : reading ? `<span lang="ja">${escapeHtml(reading)}</span>` : ""}
            ${e.c ? `<i class="nb-common">common</i>` : ""}
            <button type="button" class="nb-save" data-save="${n}" aria-label="save this word">★</button>
          </header>
          ${found.reasons.length ? `<p class="nb-reasons">${escapeHtml(found.reasons.join(" › "))}</p>` : ""}
          <ol>${e.s.slice(0, n === 0 ? 6 : 3).map((sense) => `
            <li>${sense[0].length ? `<em title="${escapeHtml(sense[0].map((p) => tagTable[p] || p).join(", "))}">${escapeHtml(sense[0].slice(0, 2).join(", "))}</em>` : ""}
              ${escapeHtml(sense[1])}${sense[2] && sense[2].length ? ` <small>${escapeHtml(sense[2].map((t) => tagTable[t] || t).join(", "))}</small>` : ""}</li>`).join("")}</ol>
        </article>`;
    }).join("") + `<div class="nb-dict-kanji" data-kanji></div>
      <p class="nb-dict-credit">JMdict · EDRDG, CC BY-SA</p>`;
    frameWrap.appendChild(card);
    s.popup = card;

    // Beside the word, inside the game's frame.
    const anchor = textEl.querySelector(`span[data-i="${index}"]`).getBoundingClientRect();
    const box = frameWrap.getBoundingClientRect();
    const readerTop = s.reader.dataset.pos === "top";
    const width = Math.min(380, box.width - 16);
    card.style.width = `${width}px`;
    card.style.left = `${Math.max(8, Math.min(anchor.left - box.left - 12, box.width - width - 8))}px`;
    if (readerTop) {
      card.style.top = `${anchor.bottom - box.top + 8}px`;
      card.style.maxHeight = `${box.bottom - anchor.bottom - 20}px`;
    } else {
      card.style.bottom = `${box.bottom - anchor.top + 8}px`;
      card.style.maxHeight = `${anchor.top - box.top - 20}px`;
    }

    card.addEventListener("click", (event) => {
      const save = event.target.closest("[data-save]");
      if (!save) return;
      const ok = saveWord(results[Number(save.dataset.save)], line.text);
      save.classList.add("saved");
      save.textContent = ok ? "★ saved" : "★ already saved";
      const count = s.reader && s.reader.querySelector("[data-words]");
      if (count) count.textContent = readWords().length || "";
    });

    // Each kanji of the best match, explained.
    const kanji = [...(headKanji[0] || "")].filter((c) => /[一-鿿㐀-䶿]/.test(c));
    const infos = await Promise.all(kanji.map(async (c) => [c, await kanjiInfo(c)]));
    if (token !== cardToken) return;
    const box2 = card.querySelector("[data-kanji]");
    box2.innerHTML = infos.filter(([, info]) => info).map(([c, info]) => `
      <div><b lang="ja">${c}</b><span>${escapeHtml(info.m.slice(0, 3).join(", "))}</span>
      <small lang="ja">${escapeHtml([...info.on.slice(0, 2), ...info.kun.slice(0, 2)].join("、"))}${info.j ? ` · N${info.j}` : ""}${info.n ? ` · ${info.n} strokes` : ""}</small></div>`).join("");
  }

  function closePopup(frameWrap, clearHits = true) {
    const s = state.get(frameWrap);
    if (!s) return;
    if (s.popup) s.popup.remove();
    s.popup = null;
    if (clearHits && s.reader) s.reader.querySelectorAll("span.hit").forEach((sp) => sp.classList.remove("hit"));
  }

  // A click on the game, or Escape, puts the card away.
  document.addEventListener("pointerdown", (event) => {
    for (const [frameWrap, s] of state) {
      if (s.popup && !s.popup.contains(event.target) && !(s.reader && s.reader.contains(event.target))) closePopup(frameWrap);
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const [frameWrap, s] of state) if (s.popup) closePopup(frameWrap);
  });

  // A game that stops takes its reader with it; its backlog stays for the session.
  if (window.NoberuInput) {
    window.NoberuInput.onGameChange((frameWrap, started) => {
      if (!started) off(frameWrap);
      else {
        const s = stateFor(frameWrap);
        s.lines = [];
        s.at = -1;
        if (setting("textOpen", "0") === "1") on(frameWrap);
      }
    });
  }

  window.NoberuText = {
    push, toggle, on, off, isOn, lookup, translate,
    words: readWords, exportWords,
    clearWords() {
      writeWords([]);
    },
    hooked: (frameWrap) => !!HOOKED[frameWrap.id],
  };
})();
