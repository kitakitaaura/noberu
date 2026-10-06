/**
 * noberu beam: send a game (and its saves) from one device to another,
 * browser to browser.
 *
 *   NoberuBeam.send(entry)    - the "beam" button on a downloads entry
 *   NoberuBeam.receive(code?) - downloads → "receive", or a ?beam=CODE link
 *
 * How a beam goes:
 *
 *   1. The sender picks a six-character code and opens a room for it on the
 *      matchmaker (beam-worker/), then shows the code and a QR of the link.
 *   2. The receiver joins that room, is told what is coming, and accepts.
 *   3. The two open a WebRTC data channel. Direct first, through Cloudflare's
 *      free STUN, with no size limit. If that cannot connect, and the game is
 *      small enough, both ask the matchmaker for relay (TURN) credentials and
 *      try again through the relay. The matchmaker caps the relay; see
 *      beam-worker/wrangler.jsonc.
 *   4. Over the channel: a JSON manifest, then every file's bytes in order,
 *      then each save set as a zip, then "done". The receiver writes straight
 *      into the downloads library's storage and acknowledges as it goes, so a
 *      phone that writes slowly holds back the sender instead of filling up
 *      its memory.
 *
 * The matchmaker only ever sees small setup messages. The game goes device to
 * device, encrypted by WebRTC itself (DTLS), relay or not.
 */
(function () {
  "use strict";

  // Saves travel with the game unless a setting says otherwise (a settings
  // tab will own this; for now it is a localStorage flag).
  function includeSaves() {
    try {
      return localStorage.getItem("noberu.beam.includeSaves") !== "0";
    } catch (error) {
      return true;
    }
  }

  const CHUNK = 64 * 1024;             // one data channel message
  const HIGH_WATER = 8 * 1024 * 1024;  // pause sending above this much buffered
  const LOW_WATER = 1024 * 1024;
  const WINDOW = 32 * 1024 * 1024;     // unacknowledged bytes allowed in flight
  const ACK_EVERY = 4 * 1024 * 1024;
  const WRITE_BATCH = 1024 * 1024;     // receiver writes in 1 MB pieces
  const DIRECT_TIMEOUT = 12000;
  const RELAY_TIMEOUT = 20000;
  const STUN = [{ urls: "stun:stun.cloudflare.com:3478" }];
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

  // The matchmaker. ?beam-server= overrides; locally it is `wrangler dev`.
  function server() {
    const override = new URLSearchParams(location.search).get("beam-server");
    if (override) return override.replace(/\/$/, "");
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      return `http://${location.hostname}:8787`;
    }
    return "https://beam.kitaaura.com";
  }

  // --- small helpers ------------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function newCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  }

  const pretty = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;
  const cleanCode = (text) => String(text || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);

  function bytesLabel(bytes) {
    return window.NoberuLibrary ? window.NoberuLibrary.bytesLabel(bytes) : `${bytes} B`;
  }

  // What the other device is told this one is called: the name set in
  // settings → beam, or one made up from the browser and the system.
  function deviceName() {
    const chosen = window.NoberuSettings ? window.NoberuSettings.get("deviceName").trim() : "";
    return chosen ? chosen.slice(0, 40) : autoDeviceName();
  }

  function autoDeviceName() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox"
      : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
    const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad"
      : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac"
        : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "a computer";
    return `${browser} on ${device}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    }[c]));
  }

  // A phone that locks mid-transfer stops it; hold the screen on meanwhile.
  const wake = {
    lock: null,
    wanted: false,
    async hold() {
      this.wanted = true;
      try {
        if ("wakeLock" in navigator && !this.lock) {
          this.lock = await navigator.wakeLock.request("screen");
          this.lock.addEventListener("release", () => { this.lock = null; });
        }
      } catch (error) { /* not allowed right now; the transfer still runs */ }
    },
    release() {
      this.wanted = false;
      if (this.lock) this.lock.release().catch(() => { });
      this.lock = null;
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wake.wanted) wake.hold();
  });

  // --- the matchmaker ---------------------------------------------------------------

  const ERRORS = {
    "no-such-code": "That code doesn't exist, or it has expired. Codes last 10 minutes.",
    "code-used": "That code has already been used. Ask for a new one.",
    "code-taken": "That code is busy.",
  };

  // A WebSocket into one room, with a queue so messages can be awaited.
  function signal(code, role) {
    return new Promise((resolve, reject) => {
      const url = `${server().replace(/^http/, "ws")}/room/${code}?role=${role}`;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (error) {
        reject(new Error("Could not reach the beam server."));
        return;
      }
      const handlers = new Set();
      const backlog = [];
      let settled = false;
      const sig = {
        send(message) {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        },
        on(fn) {
          handlers.add(fn);
          backlog.splice(0).forEach((m) => fn(m));
          return () => handlers.delete(fn);
        },
        // The next message of a type (or any of several).
        next(types, timeout = 0) {
          const wanted = [].concat(types);
          return new Promise((res, rej) => {
            let timer = null;
            const off = sig.on((m) => {
              if (m.type === "peer-left" && !wanted.includes("peer-left")) {
                off();
                clearTimeout(timer);
                rej(new Error("The other device left."));
              } else if (wanted.includes(m.type)) {
                off();
                clearTimeout(timer);
                res(m);
              }
            });
            if (timeout) timer = setTimeout(() => { off(); rej(new Error("timeout")); }, timeout);
          });
        },
        close() {
          try {
            ws.close();
          } catch (error) { /* closed */ }
        },
      };
      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        if (!settled) {
          settled = true;
          if (message.type === "error") {
            reject(Object.assign(new Error(ERRORS[message.error] || message.error), { code: message.error }));
            return;
          }
          resolve(sig);
        }
        if (handlers.size) handlers.forEach((fn) => fn(message));
        else backlog.push(message);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("Could not reach the beam server."));
        }
      };
      ws.onclose = () => {
        handlers.forEach((fn) => fn({ type: "peer-left", closed: true }));
      };
    });
  }

  async function relayServers(bytes) {
    let response;
    try {
      response = await fetch(`${server()}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bytes }),
      });
    } catch (error) {
      throw new Error("Could not reach the beam server for a relay.");
    }
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.iceServers) return body.iceServers;
    const direct = "These devices can't connect directly.";
    if (body.error === "too-big") {
      throw new Error(`${direct} Put both on the same Wi-Fi to beam games over ${bytesLabel(body.maxBeam)}.`);
    }
    if (body.error === "daily-limit") {
      throw new Error(`${direct} Today's relay allowance is used up; put both on the same Wi-Fi.`);
    }
    throw new Error(`${direct} Put both on the same Wi-Fi and try again.`);
  }

  // --- the peer connection --------------------------------------------------------------

  // One attempt at a connection. The sender makes the offer. Every signalling
  // message carries the attempt number, so a late candidate from a failed
  // direct attempt cannot confuse the relay attempt.
  function connect({ sig, role, iceServers, attempt, relayOnly, timeout }) {
    return new Promise((resolve, reject) => {
      const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: relayOnly ? "relay" : "all",
      });
      let channel = null;
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        if (error) {
          pc.close();
          reject(error);
        } else {
          resolve({ pc, channel });
        }
      };
      const timer = setTimeout(() => finish(new Error("no-connection")), timeout);

      pc.onicecandidate = (event) => {
        if (event.candidate) sig.send({ type: "candidate", attempt, candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") finish(new Error("no-connection"));
      };

      const ready = (dc) => {
        channel = dc;
        channel.binaryType = "arraybuffer";
        if (channel.readyState === "open") finish();
        else channel.onopen = () => finish();
      };

      // One message at a time, in order: a candidate that arrives while the
      // offer is still being applied must wait for it, or addIceCandidate
      // throws and that route is lost.
      let queue = Promise.resolve();
      const off = sig.on((m) => {
        if (m.attempt !== attempt) return;
        queue = queue.then(async () => {
          if (m.type === "offer" && role === "recv") {
            await pc.setRemoteDescription(m.description);
            await pc.setLocalDescription(await pc.createAnswer());
            sig.send({ type: "answer", attempt, description: pc.localDescription.toJSON() });
          } else if (m.type === "answer" && role === "send") {
            await pc.setRemoteDescription(m.description);
          } else if (m.type === "candidate") {
            await pc.addIceCandidate(m.candidate);
          }
        }).catch((error) => console.warn("beam signalling", error));
      });

      if (role === "send") {
        ready(pc.createDataChannel("beam", { ordered: true }));
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => sig.send({ type: "offer", attempt, description: pc.localDescription.toJSON() }))
          .catch((error) => finish(error));
      } else {
        pc.ondatachannel = (event) => ready(event.channel);
      }
    });
  }

  // Direct first; the relay only if that fails and the matchmaker allows it.
  // Returns { pc, channel, relayed }.
  async function establish(sig, role, bytes, say) {
    say("connecting…");
    // Testing: ?beam-force-relay skips the direct attempt (both sides need it).
    const forceRelay = new URLSearchParams(location.search).has("beam-force-relay");
    if (!forceRelay) {
      try {
        const link = await connect({ sig, role, iceServers: STUN, attempt: 1, timeout: DIRECT_TIMEOUT });
        return { ...link, relayed: false };
      } catch (error) {
        if (error.message !== "no-connection") throw error;
      }
    }

    say("no direct connection; trying the relay…");
    if (role === "send") {
      let iceServers;
      try {
        iceServers = await relayServers(bytes);
      } catch (error) {
        sig.send({ type: "relay-failed", reason: error.message });
        throw error;
      }
      sig.send({ type: "relay" });
      const reply = await sig.next(["relay-ready", "relay-failed"], RELAY_TIMEOUT);
      if (reply.type === "relay-failed") throw new Error(reply.reason);
      const link = await connect({ sig, role, iceServers, attempt: 2, relayOnly: true, timeout: RELAY_TIMEOUT });
      return { ...link, relayed: true };
    }
    const go = await sig.next(["relay", "relay-failed"], RELAY_TIMEOUT).catch(() => {
      throw new Error("These devices can't connect directly. Put both on the same Wi-Fi and try again.");
    });
    if (go.type === "relay-failed") throw new Error(go.reason);
    let iceServers;
    try {
      iceServers = await relayServers(bytes);
    } catch (error) {
      sig.send({ type: "relay-failed", reason: error.message });
      throw error;
    }
    const pending = connect({ sig, role, iceServers, attempt: 2, relayOnly: true, timeout: RELAY_TIMEOUT });
    sig.send({ type: "relay-ready" });
    const link = await pending;
    return { ...link, relayed: true };
  }

  // --- sending --------------------------------------------------------------------------

  // The names a game's saves can go by. The runtimes mostly name the save
  // folder after the game folder, but not all: rlvm uses the #REGNAME from
  // Gameexe.ini (Clannad's is KEY\CLANNAD_ENHD, saved as KEY_CLANNAD_ENHD),
  // and the onscripter runtime cleans the folder name up for a path.
  async function saveNamesFor(entry, files) {
    const names = new Set([entry.name]);
    names.add(entry.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64));
    const gameexe = files.find((file) => /^gameexe\.ini$/i.test(relativePath(file)));
    if (gameexe) {
      try {
        const text = new TextDecoder("shift_jis").decode(
          await gameexe.slice(0, 256 * 1024).arrayBuffer());
        const regname = text.match(/^#REGNAME\s*=\s*"([^"]*)"/m);
        if (regname) names.add(regname[1].replace(/\\/g, "_"));
      } catch (error) { /* no regname: the other names still apply */ }
    }
    return [...names];
  }

  function relativePath(file) {
    const path = file.webkitRelativePath || file.name;
    return path.slice(path.indexOf("/") + 1);
  }

  // Only a game's saves (the saves panel's beam button). The other device
  // does not need the game in its downloads to take them.
  async function sendSaves(set) {
    return send({ name: set.name, engine: set.runtime }, { saveSet: set });
  }

  async function send(entry, options = {}) {
    const onlySaves = !!options.saveSet;
    const ui = openDialog(onlySaves ? `beam ${entry.name}'s saves` : `beam ${entry.name}`);
    let sig = null;
    let link = null;
    ui.onCancel(() => {
      if (sig) sig.close();
      if (link) link.pc.close();
      wake.release();
    });

    try {
      let files = [];
      if (!onlySaves) {
        ui.status("reading the game…");
        files = await window.NoberuLibrary.getFiles(entry, (text) => ui.status(text));
      }
      const manifest = files.map((file) => ({ path: relativePath(file), size: file.size }));
      const gameBytes = manifest.reduce((sum, f) => sum + f.size, 0);
      let saves = [];
      if (onlySaves) {
        ui.status("packing saves…");
        saves = [await window.NoberuSaves.pack(options.saveSet)];
      } else if (includeSaves() && window.NoberuSaves) {
        ui.status("packing saves…");
        saves = await window.NoberuSaves.forGame(await saveNamesFor(entry, files)).catch(() => []);
      }
      const saveBytes = saves.reduce((sum, s) => sum + s.zip.length, 0);

      // A fresh code; retried in the (unlikely) case it is taken.
      let code = null;
      for (let i = 0; i < 4 && !sig; i++) {
        code = newCode();
        try {
          sig = await signal(code, "send");
        } catch (error) {
          if (error.code !== "code-taken") throw error;
        }
      }
      if (!sig) throw new Error("Could not get a code. Try again.");

      ui.showCode(code, `${bytesLabel(gameBytes)}${saves.length ? " + saves" : ""}`);
      ui.status("open this on the other device, or scan the code");
      await sig.next("peer-joined");
      ui.hideCode();
      ui.status("the other device is deciding…");
      sig.send({
        type: "hello",
        name: entry.name,
        engine: entry.engine,
        bytes: gameBytes,
        files: manifest.length,
        saves: saveBytes,
        savesOnly: onlySaves,
        from: deviceName(),
      });
      const answer = await sig.next(["accept", "decline"]);
      if (answer.type === "decline") throw new Error("The other device said no.");
      // The other device already has this game: just its saves.
      const savesOnly = onlySaves || answer.mode === "saves";
      const sending = savesOnly ? [] : files;
      const total = (savesOnly ? 0 : gameBytes) + saveBytes;

      await wake.hold();
      link = await establish(sig, "send", total, (text) => ui.status(text));
      const { channel } = link;

      // Acknowledgements from the receiver, and its final word.
      let acked = 0;
      let received = false;
      let wakeSender = null;
      channel.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        const m = JSON.parse(event.data);
        if (m.t === "ack") acked = m.bytes;
        if (m.t === "received") received = true;
        if (m.t === "error") received = new Error(m.message);
        if (wakeSender) wakeSender();
      };
      let closed = false;
      channel.onclose = () => {
        closed = true;
        if (wakeSender) wakeSender();
      };
      // Woken by an ack, the buffer draining, or the channel closing; and
      // at the latest after a moment, in case the buffer drained between the
      // check and the wait.
      const waitForRoom = () => new Promise((resolve) => {
        const timer = setTimeout(() => { if (wakeSender) wakeSender(); }, 250);
        wakeSender = () => { wakeSender = null; clearTimeout(timer); resolve(); };
        channel.bufferedAmountLowThreshold = LOW_WATER;
        channel.onbufferedamountlow = () => { if (wakeSender) wakeSender(); };
      });

      channel.send(JSON.stringify({
        t: "manifest",
        name: entry.name,
        engine: entry.engine,
        files: savesOnly ? [] : manifest,
        savesOnly,
        saves: saves.map((s) => ({ set: s.set, size: s.zip.length })),
      }));

      let sent = 0;
      const started = performance.now();
      const pushBytes = async (buffer) => {
        while (!closed && (channel.bufferedAmount > HIGH_WATER || sent - acked > WINDOW)) {
          await waitForRoom();
        }
        if (closed) throw new Error("The connection dropped.");
        channel.send(buffer);
        sent += buffer.byteLength;
        ui.progress(sent, total, started, link.relayed);
      };

      for (const file of sending) {
        for (let offset = 0; offset < file.size; offset += CHUNK) {
          await pushBytes(await file.slice(offset, offset + CHUNK).arrayBuffer());
        }
      }
      for (const save of saves) {
        for (let offset = 0; offset < save.zip.length; offset += CHUNK) {
          await pushBytes(save.zip.slice(offset, offset + CHUNK).buffer);
        }
      }
      channel.send(JSON.stringify({ t: "done" }));

      ui.status("finishing on the other device…");
      while (!received && !closed) await waitForRoom();
      if (received instanceof Error) throw received;
      if (!received) throw new Error("The connection dropped before the other device finished.");
      ui.done(savesOnly ? `The saves for ${entry.name} are on the other device.` : `${entry.name} is on the other device.`);
    } catch (error) {
      if (!ui.cancelled) ui.fail(error.message || String(error));
    } finally {
      wake.release();
      if (sig) sig.close();
      if (link) setTimeout(() => link.pc.close(), 1000);
    }
  }

  // --- receiving ---------------------------------------------------------------------------

  async function receive(initialCode) {
    const ui = openDialog("receive a beam");
    let sig = null;
    let link = null;
    let target = null;
    ui.onCancel(() => {
      if (sig) sig.close();
      if (link) link.pc.close();
      if (target) target.abort();
      wake.release();
    });

    try {
      const code = await ui.askCode(initialCode);
      ui.status("finding the other device…");
      sig = await signal(code, "recv");
      const hello = await sig.next("hello", 20000).catch(() => {
        throw new Error("The other device didn't answer.");
      });

      // Room for it? Browsers report an estimate; leave a little slack.
      const total = hello.bytes + (hello.saves || 0);
      let warning = "";
      if (navigator.storage && navigator.storage.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        if (quota && quota - usage < total * 1.05) {
          warning = `This browser has about ${bytesLabel(quota - usage)} free; that may not be enough.`;
        }
      }
      // Already here (same name and size)? Then the saves alone will do.
      // Same name is enough: a linked folder can hold more than the game
      // (a wrapper folder, patches), so its size need not match.
      const existing = window.NoberuLibrary && !hello.savesOnly
        ? (await window.NoberuLibrary.list()).find((e) => e.name.toLowerCase() === hello.name.toLowerCase())
        : null;
      const choice = await ui.confirm(hello, warning, !!existing);
      if (!choice) {
        sig.send({ type: "decline" });
        ui.close();
        return;
      }
      const savesOnly = hello.savesOnly || choice === "saves";
      sig.send({ type: "accept", mode: savesOnly ? "saves" : "all" });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
      await wake.hold();

      const expected = (savesOnly ? 0 : hello.bytes) + (hello.saves || 0);
      link = await establish(sig, "recv", expected, (text) => ui.status(text));
      const { channel } = link;
      const result = await takeTransfer(channel, (text) => ui.status(text),
        (got, started) => ui.progress(got, expected, started, link.relayed),
        (created) => { target = created; }, existing);
      target = null;
      if (window.NoberuLibrary) window.NoberuLibrary.refresh();
      const saveWord = result.saveError ? ` Its saves could not be added: ${result.saveError}`
        : result.saves ? (savesOnly ? "" : ", with its saves") : "";
      const gameName = result.entry ? result.entry.name : hello.name;
      ui.done(savesOnly
        ? (result.saveError ? `The saves could not be added: ${result.saveError}` : `${gameName}'s saves are updated. Start the game to see them.`)
        : `${gameName} is in downloads${saveWord}.`, result.entry);
    } catch (error) {
      if (target) target.abort();
      if (!ui.cancelled) ui.fail(error.message || String(error));
    } finally {
      wake.release();
      if (sig) sig.close();
      if (link) setTimeout(() => link.pc.close(), 1000);
    }
  }

  // A game running on this device keeps its saves in memory and writes them
  // back to storage every few seconds (rlvm, onscripter), and that write
  // deletes whatever it does not know about - saves that just arrived
  // included. So any running game is closed before saves are restored: its
  // frame is emptied, and its src removed so the tab loads it afresh on the
  // next boot. Emptying it first lets the game's own unload flush finish
  // before the new saves go in.
  const runningGames = () => [...document.querySelectorAll(".play-frame-wrap.active")];

  async function closeRunningGames() {
    for (const wrap of runningGames()) {
      const frame = wrap.querySelector("iframe");
      if (frame && frame.getAttribute("src")) {
        await new Promise((resolve) => {
          frame.addEventListener("load", resolve, { once: true });
          setTimeout(resolve, 2000);
          frame.src = "about:blank";
        });
        frame.removeAttribute("src");
      }
      wrap.classList.remove("emulator-maximized", "active");
    }
  }

  // Reads the channel into a new stored library entry (or, for a saves-only
  // beam, just the saves for |existing|). Resolves to { entry, saves,
  // saveError }.
  function takeTransfer(channel, say, progress, onTarget, existing) {
    return new Promise((resolve, reject) => {
      let manifest = null;
      let target = null;
      let fileIndex = 0;
      let fileLeft = 0;
      let writer = null;
      let pending = [];
      let pendingBytes = 0;
      let saveIndex = 0;
      let saveBuffer = null;
      let saveAt = 0;
      let got = 0;
      let lastAck = 0;
      let started = 0;
      let finished = false;
      let queue = Promise.resolve();

      const fail = (error) => {
        if (finished) return;
        finished = true;
        try {
          channel.send(JSON.stringify({ t: "error", message: error.message }));
        } catch (e) { /* closed */ }
        reject(error);
      };

      const flush = async () => {
        if (!pending.length) return;
        const block = new Blob(pending);
        pending = [];
        pendingBytes = 0;
        await writer.write(block);
      };

      // Moves to the next file with bytes still to come, closing finished
      // ones (and creating empty files on the way).
      const advance = async () => {
        while (fileIndex < manifest.files.length && fileLeft === 0) {
          if (writer) {
            await flush();
            await writer.close();
            writer = null;
            fileIndex++;
            continue;
          }
          const file = manifest.files[fileIndex];
          writer = await target.open(file.path);
          fileLeft = file.size;
          if (fileLeft === 0) continue;
        }
      };

      const takeBytes = async (bytes) => {
        let data = new Uint8Array(bytes);
        while (data.length) {
          if (fileIndex < manifest.files.length) {
            await advance();
          }
          if (fileIndex < manifest.files.length) {
            const n = Math.min(fileLeft, data.length);
            pending.push(data.subarray(0, n));
            pendingBytes += n;
            fileLeft -= n;
            data = data.subarray(n);
            if (pendingBytes >= WRITE_BATCH) await flush();
            if (fileLeft === 0) await advance();
            continue;
          }
          // Past the game files: save sets.
          const save = manifest.saves[saveIndex];
          if (!save) throw new Error("More data arrived than was announced.");
          if (!saveBuffer) {
            saveBuffer = new Uint8Array(save.size);
            saveAt = 0;
          }
          const n = Math.min(save.size - saveAt, data.length);
          saveBuffer.set(data.subarray(0, n), saveAt);
          saveAt += n;
          data = data.subarray(n);
          if (saveAt === save.size) {
            save.zip = saveBuffer;
            saveBuffer = null;
            saveIndex++;
          }
        }
        got += bytes.byteLength;
        progress(got, started);
        if (got - lastAck >= ACK_EVERY) {
          lastAck = got;
          channel.send(JSON.stringify({ t: "ack", bytes: got }));
        }
      };

      const complete = async () => {
        // Close out trailing files (including empty ones at the end).
        if (writer && fileLeft > 0) throw new Error("The transfer ended early.");
        if (writer) {
          await flush();
          await writer.close();
          writer = null;
          fileIndex++;
        }
        while (fileIndex < manifest.files.length) {
          const file = manifest.files[fileIndex];
          if (file.size !== 0) throw new Error("The transfer ended early.");
          await (await target.open(file.path)).close();
          fileIndex++;
        }
        let entry = existing;
        if (target) {
          say("adding to downloads…");
          entry = await target.commit({
            paths: manifest.files.map((f) => f.path),
            bytes: manifest.files.reduce((sum, f) => sum + f.size, 0),
            engine: manifest.engine,
          });
        }
        let saves = 0;
        let saveError = "";
        if (manifest.saves.some((save) => save.zip)) await closeRunningGames();
        for (const save of manifest.saves) {
          if (!save.zip) continue;
          try {
            await window.NoberuSaves.restore(save.set, save.zip);
            saves++;
          } catch (error) {
            saveError = error.message;
            console.warn("beam saves:", error);
          }
        }
        channel.send(JSON.stringify({ t: "received" }));
        finished = true;
        resolve({ entry, saves, saveError });
      };

      channel.onmessage = (event) => {
        const data = event.data;
        queue = queue.then(async () => {
          if (finished) return;
          if (typeof data === "string") {
            const m = JSON.parse(data);
            if (m.t === "manifest") {
              manifest = m;
              started = performance.now();
              if (!m.savesOnly) {
                target = await window.NoberuLibrary.createStored(m.name);
                onTarget(target);
              }
              say("receiving…");
            } else if (m.t === "done") {
              await complete();
            }
            return;
          }
          if (!manifest) throw new Error("Data arrived before the list of files.");
          await takeBytes(data);
        }).catch(fail);
      };
      channel.onclose = () => {
        queue.then(() => {
          if (!finished) fail(new Error("The connection dropped."));
        });
      };
    });
  }

  // --- the dialog ---------------------------------------------------------------------------

  const css = `
    .beam-backdrop { z-index: 60; }
    .beam-modal { width: min(26rem, 100%); }
    .beam-body { padding: 1rem; display: grid; gap: 0.8rem; justify-items: center; text-align: center; }
    .beam-code { font-size: 2rem; font-weight: 900; letter-spacing: 0.12em; }
    .beam-qr { width: min(13rem, 60vw); aspect-ratio: 1; background: #fff; border-radius: 10px; padding: 0.5rem; }
    .beam-qr svg { width: 100%; height: 100%; display: block; }
    .beam-note { margin: 0; color: var(--muted); font-size: 0.85rem; line-height: 1.45; }
    .beam-meter { width: 100%; height: 0.55rem; border-radius: 999px; background: var(--line); overflow: hidden; }
    .beam-meter span { display: block; height: 100%; width: 0; background: var(--gold, #f19a38); transition: width 0.2s; }
    .beam-input { width: 10.5ch; font: 900 1.8rem/1.2 inherit; letter-spacing: 0.15em; text-align: center;
      text-transform: uppercase; padding: 0.4rem; border: 1px solid var(--line-strong, var(--line));
      border-radius: 10px; background: var(--paper); color: var(--ink); }
    .beam-actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
    .beam-hint { margin: 0; padding-top: 0.6rem; border-top: 1px solid var(--line); width: 100%;
      color: var(--muted); font-size: 0.75rem; line-height: 1.45; }
    .beam-error { color: var(--red, #ed2236); }
    .beam-hidden { display: none !important; }
  `;

  function openDialog(title) {
    if (!document.querySelector("#beam-style")) {
      const style = document.createElement("style");
      style.id = "beam-style";
      style.textContent = css;
      document.head.appendChild(style);
    }
    const root = document.createElement("div");
    root.className = "library-backdrop beam-backdrop";
    root.innerHTML = `
      <div class="library-modal beam-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="library-bar">
          <b>${escapeHtml(title)}</b>
          <button class="tiny-button" type="button" data-beam="close">cancel</button>
        </div>
        <div class="beam-body">
          <div class="beam-code beam-hidden" data-beam="code"></div>
          <div class="beam-qr beam-hidden" data-beam="qr"></div>
          <form class="beam-actions beam-hidden" data-beam="ask">
            <input class="beam-input" data-beam="input" inputmode="text" autocomplete="off"
              autocapitalize="characters" spellcheck="false" maxlength="7" placeholder="ABC-123" aria-label="beam code" />
            <button class="retro-button" type="submit">join</button>
          </form>
          <p class="beam-note" data-beam="status"></p>
          <div class="beam-meter beam-hidden" data-beam="meter"><span></span></div>
          <div class="beam-actions beam-hidden" data-beam="choice">
            <button class="retro-button beam-hidden" type="button" data-beam="saves">saves only</button>
            <button class="retro-button" type="button" data-beam="yes">receive</button>
            <button class="retro-button secondary" type="button" data-beam="no">no thanks</button>
          </div>
          <div class="beam-actions beam-hidden" data-beam="after">
            <button class="retro-button" type="button" data-beam="play">play</button>
          </div>
          <p class="beam-hint" data-beam="hint"><span class="brief">No size limits with both devices on the same Wi-Fi and no VPN.</span><span class="verbose">No limits when both devices are on the same Wi-Fi with no VPN
            (WARP counts). Otherwise it may go through a relay, capped at 2 GB per game and 4 GB a day.</span></p>
        </div>
      </div>`;
    document.body.appendChild(root);
    const $ = (name) => root.querySelector(`[data-beam="${name}"]`);
    const show = (name, on = true) => $(name).classList.toggle("beam-hidden", !on);
    let cancelHandler = null;

    const ui = {
      cancelled: false,
      onCancel(fn) {
        cancelHandler = fn;
      },
      close() {
        root.remove();
      },
      status(text, error = false) {
        $("status").textContent = text;
        $("status").classList.toggle("beam-error", error);
      },
      showCode(code, what) {
        $("code").textContent = pretty(code);
        const link = `${location.origin}${location.pathname}?beam=${code}`;
        if (window.qrcode) {
          const qr = window.qrcode(0, "M");
          qr.addData(link);
          qr.make();
          $("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
          show("qr");
        }
        show("code");
        $("code").title = what;
      },
      hideCode() {
        show("code", false);
        show("qr", false);
      },
      askCode(initial) {
        return new Promise((resolve) => {
          const input = $("input");
          if (initial && cleanCode(initial).length === 6) {
            resolve(cleanCode(initial));
            return;
          }
          show("ask");
          ui.status("Type the code shown on the other device.");
          input.value = initial ? pretty(cleanCode(initial)) : "";
          input.addEventListener("input", () => {
            const code = cleanCode(input.value);
            input.value = code.length > 3 ? pretty(code) : code;
          });
          $("ask").addEventListener("submit", (event) => {
            event.preventDefault();
            const code = cleanCode(input.value);
            if (code.length !== 6) {
              ui.status("Codes are six characters.", true);
              return;
            }
            show("ask", false);
            resolve(code);
          });
          setTimeout(() => input.focus(), 50);
        });
      },
      // Resolves to "all", "saves" (only offered when the game is already
      // here and saves are coming) or false.
      confirm(hello, warning, haveGame) {
        return new Promise((resolve) => {
          const size = bytesLabel(hello.bytes) + (hello.saves ? " + saves" : "");
          const offerSaves = haveGame && hello.saves > 0;
          if (hello.savesOnly) {
            ui.status(`${String(hello.from).slice(0, 40)} wants to send the saves for ${hello.name} (${bytesLabel(hello.saves)}).` +
              (runningGames().length ? " The game running here will be closed first, so it can't overwrite them." : ""));
            show("choice");
            $("saves").classList.add("beam-hidden");
            $("yes").textContent = "receive";
            $("yes").onclick = () => { show("choice", false); resolve("saves"); };
            $("no").onclick = () => { show("choice", false); resolve(false); };
            return;
          }
          ui.status(`${String(hello.from).slice(0, 40)} wants to send ${hello.name} (${size}, ${hello.files} files).` +
            (offerSaves ? " You already have this game, so you can take just its saves." : "") +
            (hello.saves && runningGames().length ? " The game running here will be closed first, so it can't overwrite them." : "") +
            (warning && !offerSaves ? ` ${warning}` : ""), !!warning && !offerSaves);
          show("choice");
          $("saves").classList.toggle("beam-hidden", !offerSaves);
          $("yes").textContent = offerSaves ? "everything" : "receive";
          const pick = (value) => () => { show("choice", false); resolve(value); };
          $("saves").onclick = pick("saves");
          $("yes").onclick = pick("all");
          $("no").onclick = pick(false);
        });
      },
      progress(done, total, started, relayed) {
        show("meter");
        const fraction = total ? Math.min(1, done / total) : 1;
        $("meter").firstElementChild.style.width = `${(fraction * 100).toFixed(1)}%`;
        const seconds = (performance.now() - started) / 1000;
        const rate = seconds > 0.5 ? done / seconds : 0;
        const left = rate ? Math.max(0, (total - done) / rate) : 0;
        const eta = !rate ? "" : left < 60 ? ` · ${Math.ceil(left)} s left` : ` · ${Math.ceil(left / 60)} min left`;
        ui.status(`${bytesLabel(done)} of ${bytesLabel(total)}` +
          (rate ? ` · ${bytesLabel(rate)}/s` : "") + eta + (relayed ? " · via relay" : ""));
      },
      done(text, entry) {
        $("meter").firstElementChild.style.width = "100%";
        ui.status(text);
        $("close").textContent = "close";
        cancelHandler = null;
        if (entry) {
          show("after");
          $("play").onclick = async () => {
            ui.close();
            const tab = window.NoberuLibrary.tabFor(entry.engine);
            if (!tab) {
              window.NoberuLibrary.openManager();
              return;
            }
            const files = await window.NoberuLibrary.getFiles(entry);
            window.NoberuLibraryHandoff(tab, files);
          };
        }
      },
      fail(text) {
        show("meter", false);
        show("choice", false);
        ui.hideCode();
        ui.status(text, true);
        $("close").textContent = "close";
        cancelHandler = null;
      },
    };

    $("close").addEventListener("click", () => {
      if (cancelHandler) {
        ui.cancelled = true;
        cancelHandler();
      }
      ui.close();
    });
    return ui;
  }

  window.NoberuBeam = { send, sendSaves, receive, autoDeviceName };

  // A scanned QR code lands here as ?beam=CODE.
  const linked = new URLSearchParams(location.search).get("beam");
  // index.html and the tour hold their first-visit popups for this visit.
  window.NoberuBeamLink = !!linked;
  if (linked) {
    const start = () => receive(linked);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
    // Leave the address clean, so a reload does not try the used code again.
    const url = new URL(location.href);
    url.searchParams.delete("beam");
    history.replaceState(null, "", url);
  }
})();
