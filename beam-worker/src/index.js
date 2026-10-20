/**
 * noberu beam: the matchmaker behind device-to-device transfers.
 *
 * Two browsers want to open a WebRTC connection to each other. Before they
 * can, they have to swap a handful of small messages (an offer, an answer,
 * network candidates). This Worker is only that meeting point. The game itself
 * never passes through here: it goes browser to browser, encrypted.
 *
 *   GET  /room/<CODE>?role=send|recv   WebSocket into the room for a code.
 *                                      One Durable Object per code relays
 *                                      each side's messages to the other.
 *   POST /turn  { bytes }              Relay (TURN) credentials, for when a
 *                                      direct connection is impossible. Capped:
 *                                      see RELAY_* in wrangler.jsonc.
 *   GET  /fetch?u=<url>                A download for the downloads tab, passed
 *                                      through when the file's own server
 *                                      refuses other sites (no CORS). Only for
 *                                      noberu's sites; streamed, never stored
 *                                      or cached; DOWNLOAD_DAILY_BYTES per
 *                                      address a day.
 *   GET  /cover?u=<vndb image url>     A vndb.org cover image, passed through
 *                                      with the headers the cross-origin
 *                                      isolated site needs (the shelf's
 *                                      "find it online").
 *   GET|PUT|DELETE /sync/<room>[/<id>] Save sync (assets/sync.js): encrypted
 *                                      blobs, kept in one SyncRoom Durable
 *                                      Object per room. The room is a hash of
 *                                      a key only the player's devices hold;
 *                                      names and saves are encrypted in the
 *                                      browser, so this sees sizes and times.
 *
 * Direct connections use Cloudflare's free, unlimited STUN and are never
 * capped. The relay costs money past Cloudflare's free allowance, so it is
 * only handed out for beams under RELAY_MAX_BEAM_BYTES, and each IP address
 * gets RELAY_DAILY_BYTES of relay a day.
 */

import { DurableObject } from "cloudflare:workers";

const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const ROOM_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = originAllowed(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors(origin, allowed) });
    }

    const room = url.pathname.match(/^\/room\/([^/]+)$/);
    if (room) {
      if (!allowed) return new Response("origin not allowed", { status: 403 });
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a WebSocket", { status: 426 });
      }
      const code = room[1].toUpperCase();
      if (!CODE.test(code)) return new Response("bad code", { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname === "/turn" && request.method === "POST") {
      if (!allowed) return json({ error: "origin not allowed" }, 403, origin, false);
      return relayCredentials(request, env, origin);
    }

    if (url.pathname === "/fetch" && request.method === "GET") {
      if (!allowed) return json({ error: "origin not allowed" }, 403, origin, false);
      return downloadRelay(request, env, ctx, url, origin);
    }

    if (url.pathname === "/cover" && request.method === "GET") {
      return cover(url, origin, allowed);
    }

    const sync = url.pathname.match(/^\/sync\/([0-9a-f]{64})(?:\/([0-9a-f]{32}))?$/);
    if (sync) {
      if (!allowed) return json({ error: "origin not allowed" }, 403, origin, false);
      if (!env.SYNC_ROOMS) return json({ error: "sync-unavailable" }, 503, origin);
      const stub = env.SYNC_ROOMS.get(env.SYNC_ROOMS.idFromName(sync[1]));
      const response = await stub.fetch(new Request(`https://sync/${sync[2] || ""}`, request));
      // CORS is this Worker's job; the room only answers.
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(cors(origin, true))) headers.set(name, value);
      return new Response(response.body, { status: response.status, headers });
    }

    if (url.pathname === "/") {
      return new Response("noberu beam matchmaker\n", { headers: { "Content-Type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  },
};

// --- origins ----------------------------------------------------------------

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  let host;
  try {
    host = new URL(origin).hostname;
  } catch (error) {
    return false;
  }
  // Local development, and quick tunnels for testing on a phone.
  if (host === "localhost" || host === "127.0.0.1") return true;
  return env.ALLOW_DEV_TUNNELS === "true" && host.endsWith(".trycloudflare.com");
}

function cors(origin, allowed) {
  // The site is cross-origin isolated (COEP: require-corp), so a response it
  // reads must pass a CORS check; CORP covers it either way.
  return allowed
    ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Noberu-Meta",
      "Access-Control-Expose-Headers": "X-Noberu-Meta",
      "Access-Control-Max-Age": "86400",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Vary": "Origin",
    }
    : { "Vary": "Origin" };
}

function json(body, status, origin, allowed = true) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin, allowed) },
  });
}

// --- covers -------------------------------------------------------------------

// Only vndb's own cover images, so this is no general-purpose proxy. An <img>
// sends no Origin, so the path is the check; Cloudflare's cache keeps the
// load off vndb.
const COVER = /^https:\/\/t\.vndb\.org\/cv(\.t)?\/\d{1,3}\/\d{1,9}\.(jpg|webp|png)$/;

async function cover(url, origin, allowed) {
  const target = url.searchParams.get("u") || "";
  if (!COVER.test(target)) return new Response("not a vndb cover", { status: 400 });
  const upstream = await fetch(target, { cf: { cacheEverything: true, cacheTtl: 7 * 86400 } });
  if (!upstream.ok) return new Response("cover not found", { status: upstream.status });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=604800",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": allowed ? origin : "*",
      "Vary": "Origin",
    },
  });
}

// --- download relay -------------------------------------------------------------

// Hosts a relay must never be pointed at: this machine's own names and
// private address ranges. (A Worker cannot reach a private network anyway;
// this keeps it obvious.)
function privateHost(host) {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^\[?[0-9a-f:]+\]?$/i.test(host) && host.includes(":")) return true; // IPv6 literal
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function downloadRelay(request, env, ctx, url, origin) {
  let target;
  try {
    target = new URL(url.searchParams.get("u") || "");
  } catch (error) {
    return json({ error: "bad-url" }, 400, origin);
  }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password || privateHost(target.hostname)) {
    return json({ error: "bad-url" }, 400, origin);
  }

  const daily = Number(env.DOWNLOAD_DAILY_BYTES || 10 * 1073741824);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const day = Math.floor(Date.now() / DAY_MS);
  const quota = env.QUOTAS.get(env.QUOTAS.idFromName(`download:${ip}:${day}`));
  const before = await quota.take(0, daily);
  if (!before.ok || before.used >= daily) return json({ error: "daily-limit", daily }, 429, origin);

  let upstream;
  try {
    upstream = await fetch(target.href, {
      headers: { "User-Agent": "noberu-download-relay (+https://noberu.kitaaura.com)" },
      redirect: "follow",
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (error) {
    return json({ error: "unreachable" }, 502, origin);
  }
  if (!upstream.ok) return json({ error: "upstream", status: upstream.status }, 502, origin);

  const length = Number(upstream.headers.get("Content-Length")) || 0;
  if (length && before.used + length > daily) {
    upstream.body && upstream.body.cancel();
    return json({ error: "daily-limit", daily }, 429, origin);
  }

  // A stated size is counted up front and the body passes straight through,
  // keeping its length (the browser shows progress against it). With no
  // stated size it is counted as it streams.
  const knownLength = length && !upstream.headers.get("Content-Encoding");
  if (knownLength) ctx.waitUntil(quota.take(length, Number.MAX_SAFE_INTEGER));
  let counted = 0;
  const meter = new TransformStream({
    transform(chunk, controller) {
      counted += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      ctx.waitUntil(quota.take(counted, Number.MAX_SAFE_INTEGER));
    },
  });

  const headers = {
    "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
    "Cache-Control": "no-store",
    ...cors(origin, true),
    "Access-Control-Expose-Headers": "Content-Length, Content-Disposition, X-Noberu-Final-Url",
    "X-Noberu-Final-Url": upstream.url,
  };
  // A compressed response arrives here decoded, so its stated length is wrong.
  if (knownLength) headers["Content-Length"] = String(length);
  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers["Content-Disposition"] = disposition;
  const body = !upstream.body ? null : knownLength ? upstream.body : upstream.body.pipeThrough(meter);
  return new Response(body, { headers });
}

// --- save sync --------------------------------------------------------------------

// One per player (all their devices share a room). Each save set is one row in
// `sets` and its encrypted bytes are split into 1 MB rows in `chunks`, since a
// SQLite row in a Durable Object holds at most 2 MB. Limits per room come from
// SYNC_MAX_OBJECT and SYNC_MAX_ROOM; the account as a whole has 5 GB on the
// Workers Free plan, shared with everything else here.
const CHUNK = 1024 * 1024;

export class SyncRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sets (
      id TEXT PRIMARY KEY, meta TEXT NOT NULL, size INTEGER NOT NULL,
      uploaded INTEGER NOT NULL, chunks INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chunks (
      id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n))`);
  }

  async fetch(request) {
    const id = new URL(request.url).pathname.slice(1);
    const maxObject = Number(this.env.SYNC_MAX_OBJECT || 32 * 1048576);
    const maxRoom = Number(this.env.SYNC_MAX_ROOM || 256 * 1048576);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });

    if (!id) {
      if (request.method !== "GET") return reply({ error: "method" }, 405);
      const items = this.sql.exec("SELECT id, size, uploaded, meta FROM sets").toArray();
      return reply({ items });
    }

    if (request.method === "GET") {
      const set = this.sql.exec("SELECT meta, size, chunks FROM sets WHERE id = ?", id).toArray()[0];
      if (!set) return reply({ error: "not-found" }, 404);
      const out = new Uint8Array(set.size);
      let at = 0;
      for (const row of this.sql.exec("SELECT data FROM chunks WHERE id = ? ORDER BY n", id)) {
        const piece = new Uint8Array(row.data);
        out.set(piece, at);
        at += piece.length;
      }
      return new Response(out, {
        headers: { "Content-Type": "application/octet-stream", "X-Noberu-Meta": set.meta, "Cache-Control": "no-store" },
      });
    }

    if (request.method === "DELETE") {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM chunks WHERE id = ?", id);
        this.sql.exec("DELETE FROM sets WHERE id = ?", id);
      });
      return reply({ ok: true });
    }

    if (request.method === "PUT") {
      const meta = request.headers.get("X-Noberu-Meta") || "";
      if (meta.length > 4096) return reply({ error: "meta-too-big" }, 413);
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > maxObject) return reply({ error: "too-big", maxObject }, 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length) return reply({ error: "empty" }, 400);
      if (bytes.length > maxObject) return reply({ error: "too-big", maxObject }, 413);
      const used = this.sql.exec("SELECT COALESCE(SUM(size), 0) AS used FROM sets WHERE id != ?", id).one().used;
      if (used + bytes.length > maxRoom) return reply({ error: "room-full", maxRoom, used }, 413);
      const count = Math.ceil(bytes.length / CHUNK);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM chunks WHERE id = ?", id);
        for (let n = 0; n < count; n++) {
          this.sql.exec("INSERT INTO chunks (id, n, data) VALUES (?, ?, ?)",
            id, n, bytes.subarray(n * CHUNK, Math.min(bytes.length, (n + 1) * CHUNK)));
        }
        this.sql.exec(`INSERT INTO sets (id, meta, size, uploaded, chunks) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, size = excluded.size,
          uploaded = excluded.uploaded, chunks = excluded.chunks`, id, meta, bytes.length, Date.now(), count);
      });
      return reply({ ok: true });
    }
    return reply({ error: "method" }, 405);
  }
}

// --- relay ------------------------------------------------------------------

async function relayCredentials(request, env, origin) {
  let bytes = 0;
  try {
    bytes = Number((await request.json()).bytes) || 0;
  } catch (error) { /* treated as 0 */ }

  const maxBeam = Number(env.RELAY_MAX_BEAM_BYTES);
  const daily = Number(env.RELAY_DAILY_BYTES);
  if (bytes > maxBeam) {
    return json({ error: "too-big", maxBeam }, 413, origin);
  }
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return json({ error: "relay-unavailable" }, 503, origin);
  }

  // Both sides of a beam ask, so each counts the beam against its own IP.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const day = Math.floor(Date.now() / DAY_MS);
  const quota = env.QUOTAS.get(env.QUOTAS.idFromName(`${ip}:${day}`));
  const granted = await quota.take(bytes, daily);
  if (!granted.ok) {
    return json({ error: "daily-limit", daily, used: granted.used }, 429, origin);
  }

  // Short-lived: long enough for one transfer at relay speed, not a stash of
  // credentials to reuse later. A 2 GB beam at the relay's ~50 Mbps floor is
  // about six minutes.
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 3600 }),
    });
  if (!response.ok) {
    return json({ error: "relay-unavailable", status: response.status }, 502, origin);
  }
  const data = await response.json();
  const iceServers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  return json({ iceServers }, 200, origin);
}

// Relay bytes granted to one IP on one day.
export class Quota extends DurableObject {

  async take(bytes, daily) {
    const used = (await this.ctx.storage.get("used")) || 0;
    if (used + bytes > daily) return { ok: false, used };
    await this.ctx.storage.put("used", used + bytes);
    if (!(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm(Date.now() + 2 * DAY_MS);
    }
    return { ok: true, used: used + bytes };
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

// --- rooms ------------------------------------------------------------------

// One per code. Holds at most a sender and a receiver, relays every message
// from one to the other, and forgets everything after ROOM_TTL_MS. A code
// can be received once: after a receiver has joined, nobody else can.
//
// Uses the hibernation API, so an idle room costs nothing while two people
// are still walking over to their phones.
export class Room extends DurableObject {

  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "send" && role !== "recv") return new Response("bad role", { status: 400 });

    const sockets = (r) => this.ctx.getWebSockets(r);
    const created = await this.ctx.storage.get("created");
    const expired = created && Date.now() - created > ROOM_TTL_MS;

    let refuse = null;
    if (role === "send") {
      if (sockets("send").length || (created && !expired)) refuse = "code-taken";
    } else {
      if (!created || expired || !sockets("send").length) refuse = "no-such-code";
      else if (sockets("recv").length || (await this.ctx.storage.get("received"))) refuse = "code-used";
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (refuse) {
      // Said over the socket rather than as an HTTP error: a browser's
      // WebSocket never exposes the status of a refused upgrade. Accepted
      // outside the room, so its closing tells the others nothing.
      server.accept();
      server.send(JSON.stringify({ type: "error", error: refuse }));
      server.close(4000, refuse);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [role]);

    if (role === "send") {
      if (expired) await this.ctx.storage.deleteAll();
      await this.ctx.storage.put("created", Date.now());
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    } else {
      await this.ctx.storage.put("received", true);
      for (const ws of sockets("send")) ws.send(JSON.stringify({ type: "peer-joined" }));
    }
    server.send(JSON.stringify({ type: "joined", role }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    // Small signalling messages only; anything big is not signalling.
    if (typeof message !== "string" || message.length > 64 * 1024) return;
    const [role] = this.ctx.getTags(ws);
    const other = role === "send" ? "recv" : "send";
    for (const peer of this.ctx.getWebSockets(other)) peer.send(message);
  }

  webSocketClose(ws) {
    const [role] = this.ctx.getTags(ws);
    const other = role === "send" ? "recv" : "send";
    for (const peer of this.ctx.getWebSockets(other)) {
      try {
        peer.send(JSON.stringify({ type: "peer-left" }));
      } catch (error) { /* already gone */ }
    }
  }

  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4001, "expired");
      } catch (error) { /* already gone */ }
    }
    await this.ctx.storage.deleteAll();
  }
}
