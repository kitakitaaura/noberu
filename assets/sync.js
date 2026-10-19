/**
 * Save sync: the same saves on every device, without accounts.
 *
 * Turning it on makes a sync key (eight groups of four letters). Entering that
 * key on another device puts it in the same sync. Everything that leaves the
 * browser is encrypted with the key first (AES-GCM, key from HKDF): the server
 * (the beam Worker, /sync) stores opaque blobs under a room named by a hash of
 * the key, and never sees a game's name or a single save.
 *
 * What a sync does, per save set (assets/saves.js):
 *   only here             -> sent up
 *   only there            -> brought down and restored
 *   same on both          -> nothing
 *   changed here since the last sync -> sent up (the latest play wins)
 *   changed only there    -> brought down
 * Nothing is ever deleted by a sync. Bringing saves down waits while a game is
 * running (it would overwrite them from memory); they come in once it stops.
 *
 *   NoberuSync.renderInto(el)   settings → sync
 *   NoberuSync.run()            a sync now
 */
(function () {
  "use strict";

  const STATE_KEY = "noberu.sync";
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
  const AUTO_EVERY = 10 * 60 * 1000;

  // --- state -------------------------------------------------------------------

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (error) { /* private mode: off again next visit */ }
    window.dispatchEvent(new CustomEvent("noberu-sync"));
  }

  function server() {
    const override = new URLSearchParams(location.search).get("beam-server");
    if (override) return override.replace(/\/$/, "");
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      return `http://${location.hostname}:8787`;
    }
    return "https://beam.kitaaura.com";
  }

  // --- the key ----------------------------------------------------------------

  function newKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    return chars.match(/.{4}/g).join("-");
  }

  function normalize(key) {
    return String(key || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function valid(key) {
    const k = normalize(key);
    return k.length === 32 && [...k].every((c) => ALPHABET.includes(c));
  }

  const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha256 = (data) => crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data);

  let derived = null; // { key, room, aes }
  async function secrets() {
    const key = normalize(readState().key);
    if (!valid(key)) throw new Error("no sync key");
    if (derived && derived.key === key) return derived;
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), "HKDF", false, ["deriveKey"]);
    const aes = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("noberu-sync"), info: new TextEncoder().encode("saves") },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const room = hex(await sha256(`noberu-sync-room|${key}`));
    derived = { key, room, aes };
    return derived;
  }

  async function encrypt(bytes) {
    const { aes } = await secrets();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, bytes));
    const out = new Uint8Array(12 + sealed.length);
    out.set(iv);
    out.set(sealed, 12);
    return out;
  }

  async function decrypt(bytes) {
    const { aes } = await secrets();
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, aes, bytes.subarray(12)));
  }

  const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  async function sealMeta(meta) {
    return toBase64(await encrypt(new TextEncoder().encode(JSON.stringify(meta))));
  }

  async function openMeta(text) {
    try {
      return JSON.parse(new TextDecoder().decode(await decrypt(fromBase64(text))));
    } catch (error) {
      return null; // another key's, or damaged
    }
  }

  // --- save sets ----------------------------------------------------------------

  // The same save set gets the same id on every device: it is named by where
  // it lives and what it is called, which a game keeps wherever it runs.
  async function setId(set) {
    const { key } = await secrets();
    const p = [set.kind, set.db, set.group, set.prefix, set.keyPrefix, set.spacesKey, set.name, set.runtime]
      .map((v) => (v == null ? "" : String(v))).join("|");
    return hex(await sha256(`${key}|${p}`)).slice(0, 32);
  }

  // A fingerprint of a set's contents (the zip itself carries times, so it is
  // taken from the files inside).
  async function fingerprint(zip) {
    const files = window.fflate.unzipSync(zip);
    const parts = [];
    for (const path of Object.keys(files).sort()) {
      parts.push(new TextEncoder().encode(path + "\0"), files[path]);
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return hex(await sha256(all));
  }

  // --- talking to the server ------------------------------------------------------

  async function request(path, options = {}) {
    const { room } = await secrets();
    const response = await fetch(`${server()}/sync/${room}${path}`, options);
    if (!response.ok) {
      let body = {};
      try {
        body = await response.json();
      } catch (error) { /* not JSON */ }
      const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
      const reason = body.error || "";
      throw new Error(reason === "room-full" ? `Your synced saves are full (${mb(body.maxRoom)}).`
        : reason === "too-big" ? `One game's saves are too big to sync (over ${mb(body.maxObject)}).`
        : reason === "sync-unavailable" ? "Sync isn't set up on the server yet."
        : response.status >= 500 ? "The sync server is busy or full right now. noberu will try again later."
        : `The sync server answered ${response.status}${reason ? ` (${reason})` : ""}.`);
    }
    return response;
  }

  // --- a sync ---------------------------------------------------------------------------

  let running = null;
  let pendingRestore = false;

  function run(options = {}) {
    if (!running) {
      running = sync(options).finally(() => {
        running = null;
      });
    }
    return running;
  }

  async function sync({ say = () => { } } = {}) {
    const state = readState();
    if (!valid(state.key) || !window.NoberuSaves) return null;
    const last = state.last || {};
    say("checking...");

    const listing = await (await request("")).json();
    const remote = new Map();
    for (const item of listing.items || []) {
      const meta = await openMeta(item.meta);
      if (meta) remote.set(item.id, { ...item, meta });
    }

    const sets = (await window.NoberuSaves.list()).filter((set) => !set.system);
    const gameRunning = !!document.querySelector(".play-frame-wrap.active");
    let sent = 0;
    let received = 0;
    let waiting = 0;
    const seen = new Set();

    for (const set of sets) {
      const id = await setId(set);
      seen.add(id);
      const { set: portable, zip } = await window.NoberuSaves.pack(set);
      if (!zip || !zip.length) continue;
      const hash = await fingerprint(zip);
      const there = remote.get(id);
      if (there && there.meta.hash === hash) {
        last[id] = hash;
        continue;
      }
      if (!there || hash !== last[id]) {
        say(`sending ${set.name}...`);
        const body = await encrypt(zip);
        await request(`/${id}`, {
          method: "PUT",
          headers: { "X-Noberu-Meta": await sealMeta({ set: portable, hash, at: Date.now() }) },
          body,
        });
        last[id] = hash;
        sent++;
        continue;
      }
      // Changed only on the other device.
      if (gameRunning) {
        waiting++;
        continue;
      }
      await bringDown(id, there, say);
      last[id] = there.meta.hash;
      received++;
    }

    for (const [id, there] of remote) {
      if (seen.has(id)) continue;
      if (gameRunning) {
        waiting++;
        continue;
      }
      await bringDown(id, there, say);
      last[id] = there.meta.hash;
      received++;
    }

    pendingRestore = waiting > 0;
    writeState({ ...readState(), last, at: Date.now(), error: "" });
    const parts = [];
    if (sent) parts.push(`${sent} sent`);
    if (received) parts.push(`${received} brought over`);
    if (waiting) parts.push(`${waiting} waiting for the game to close`);
    say(parts.length ? parts.join(", ") + "." : "Everything is in step.");
    return { sent, received, waiting };
  }

  async function bringDown(id, there, say) {
    say(`bringing over ${there.meta.set.name}...`);
    const sealed = new Uint8Array(await (await request(`/${id}`)).arrayBuffer());
    const zip = await decrypt(sealed);
    await window.NoberuSaves.restore(there.meta.set, zip);
  }

  // --- when ------------------------------------------------------------------------------

  function auto(reason) {
    if (!valid(readState().key) || document.hidden || !navigator.onLine) return;
    run().catch((error) => {
      writeState({ ...readState(), error: String(error.message || error) });
      console.warn(`noberu: sync (${reason}) failed`, error);
    });
  }

  window.addEventListener("load", () => setTimeout(() => auto("start"), 5000));
  setInterval(() => auto("timer"), AUTO_EVERY);
  window.addEventListener("online", () => auto("online"));
  if (window.NoberuInput) {
    // A game that stops has just saved, and anything held back can come in.
    window.NoberuInput.onGameChange((frameWrap, started) => {
      if (!started) setTimeout(() => auto("game closed"), 2500);
    });
  }

  // --- settings → sync ----------------------------------------------------------------

  function ago(time) {
    if (!time) return "never";
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(time).toLocaleDateString();
  }

  function renderInto(el) {
    const state = readState();
    if (!valid(state.key)) {
      el.innerHTML = `
        <p class="settings-note">Keep your saves the same on every device. They're locked with a key only your devices have: not even noberu's server can read them.</p>
        <div class="settings-row settings-wide">
          <span class="settings-text"><b>start syncing</b><small>Makes a key for this device. Then enter it on the others.</small></span>
          <button class="retro-button" type="button" data-s="new">turn on</button>
        </div>
        <form class="settings-row settings-wide sync-join" data-s="join">
          <span class="settings-text"><b>I have a key</b><small>From another device's settings → sync.</small></span>
          <span class="sync-join-field">
            <input class="settings-input" type="text" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-..." aria-label="sync key" />
            <button class="retro-button secondary" type="submit">join</button>
          </span>
        </form>
        <p class="settings-note" data-s="say" role="status"></p>`;
      el.querySelector('[data-s="new"]').addEventListener("click", () => {
        writeState({ key: newKey(), last: {}, at: 0 });
        renderInto(el);
        start(el);
      });
      el.querySelector('[data-s="join"]').addEventListener("submit", (event) => {
        event.preventDefault();
        const value = el.querySelector(".sync-join input").value;
        if (!valid(value)) {
          el.querySelector('[data-s="say"]').textContent = "That doesn't look like a sync key (8 groups of 4).";
          return;
        }
        writeState({ key: normalize(value).match(/.{4}/g).join("-"), last: {}, at: 0 });
        renderInto(el);
        start(el);
      });
      return;
    }

    el.innerHTML = `
      <div class="settings-row settings-wide">
        <span class="settings-text"><b>sync is on</b><small data-s="when">last synced ${ago(state.at)}${state.error ? ` · ${state.error}` : ""}</small></span>
        <button class="retro-button" type="button" data-s="now">sync now</button>
      </div>
      <div class="settings-row settings-wide sync-key-row">
        <span class="settings-text"><b>your sync key</b><small>Enter it on another device to share saves with it. Anyone with it can read your saves, so keep it to yourself.</small></span>
        <span class="sync-key">
          <code data-s="key">${"••••-".repeat(7)}••••</code>
          <button class="tiny-button" type="button" data-s="show">show</button>
          <button class="tiny-button" type="button" data-s="copy">copy</button>
        </span>
      </div>
      <div class="sync-qr" data-s="qr" hidden></div>
      <div class="settings-row settings-wide settings-danger">
        <span class="settings-text"><b>stop syncing here</b><small>This device keeps its saves. The others keep syncing.</small></span>
        <button class="retro-button secondary" type="button" data-s="off">turn off</button>
      </div>
      <p class="settings-note" data-s="say" role="status"></p>`;

    const say = (text) => {
      el.querySelector('[data-s="say"]').textContent = text;
    };
    el.querySelector('[data-s="now"]').addEventListener("click", () => start(el));
    el.querySelector('[data-s="show"]').addEventListener("click", (event) => {
      const code = el.querySelector('[data-s="key"]');
      const shown = event.target.textContent === "hide";
      code.textContent = shown ? `${"••••-".repeat(7)}••••` : readState().key;
      event.target.textContent = shown ? "show" : "hide";
      const qr = el.querySelector('[data-s="qr"]');
      qr.hidden = shown;
      if (!shown && window.qrcode) {
        const q = window.qrcode(0, "M");
        q.addData(readState().key);
        q.make();
        qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      }
    });
    el.querySelector('[data-s="copy"]').addEventListener("click", () => {
      navigator.clipboard.writeText(readState().key).then(() => say("Copied.")).catch(() => say("Couldn't copy; use show."));
    });
    el.querySelector('[data-s="off"]').addEventListener("click", () => {
      if (!confirm("Stop syncing on this device?\n\nYour saves here stay. To join again, you'll need the key.")) return;
      writeState({});
      derived = null;
      renderInto(el);
    });
  }

  function start(el) {
    const say = (text) => {
      const status = el.querySelector('[data-s="say"]');
      if (status) status.textContent = text;
    };
    run({ say }).then(() => {
      const when = el.querySelector('[data-s="when"]');
      if (when) when.textContent = `last synced ${ago(readState().at)}`;
    }).catch((error) => {
      writeState({ ...readState(), error: String(error.message || error) });
      say(String(error.message || error));
    });
  }

  window.NoberuSync = {
    renderInto,
    run,
    isOn: () => valid(readState().key),
    pendingRestore: () => pendingRestore,
  };
})();
