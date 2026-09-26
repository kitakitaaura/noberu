/**
 * noberu large assets: an R2 bucket, read-only, with the headers a
 * cross-origin-isolated page needs.
 *
 * Cloudflare Pages refuses any asset over 25 MiB, and BoxedWine's root
 * filesystem zip is ~152 MiB, so that file lives in R2 instead of the site. It
 * cannot simply be fetched from a public bucket URL: the site sends
 * `Cross-Origin-Embedder-Policy: require-corp` (it needs SharedArrayBuffer for
 * the kirikiri and Play! runtimes), and under that policy a
 * cross-origin response is blocked unless it carries
 * `Cross-Origin-Resource-Policy` or passes a CORS check. A public bucket sends
 * neither header, so this Worker adds both.
 *
 * GET and HEAD only, and nothing here can write: the bucket binding is the only
 * way in, and no branch calls put or delete.
 */

const ALLOWED_ORIGINS = [
  // The deployed site, and the local server used while developing it. A request
  // from anywhere else still gets the file (it is not a secret) but no CORS
  // headers, so a page on another origin cannot read it.
  "http://localhost:4175",
  "http://127.0.0.1:4175",
];

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = [...ALLOWED_ORIGINS, ...(env.SITE_ORIGIN ? [env.SITE_ORIGIN] : [])];
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request, env),
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
    }

    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));
    if (!key || key.includes("..")) return new Response("not found", { status: 404 });

    // `onlyIf` and `range` are handed the request's own headers, so a
    // conditional request answers 304 and a ranged one answers 206 without this
    // Worker parsing either.
    const object = await env.BUCKET.get(key, {
      onlyIf: request.headers,
      range: request.headers,
    });
    if (!object) return new Response("not found", { status: 404, headers: corsHeaders(request, env) });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // These files are build artifacts that change only when the runtime is
    // rebuilt, and a rebuild uploads under the same name, so revalidation is
    // what keeps a stale 152 MiB zip from being cached forever.
    headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
    // The point of the whole Worker.
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    for (const [name, value] of Object.entries(corsHeaders(request, env))) headers.set(name, value);

    // No body on a 304, or on a HEAD, or when the object was a conditional miss.
    const body = "body" in object && request.method === "GET" ? object.body : null;
    let status = body ? 200 : 304;
    // R2 reports a `range` even when none was asked for (the whole object), so
    // the REQUEST decides whether this is a 206: answering one to a plain GET
    // is a lie that some fetch consumers refuse.
    if (request.headers.has("Range") && object.range && body) {
      status = 206;
      const { offset = 0, length = 0 } = object.range;
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    }
    if (request.method === "HEAD") status = 200;
    headers.set("Accept-Ranges", "bytes");
    return new Response(body, { status, headers });
  },
};
