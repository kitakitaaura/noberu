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
  async fetch(request, env) {
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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
