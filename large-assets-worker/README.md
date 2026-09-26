# noberu large assets (R2 + Worker)

Cloudflare Pages refuses any single asset over **25 MiB**, on every plan.
`boxedwine.zip` — BoxedWine's root filesystem, the Linux userland and Wine, always
fetched before the emulator can start — is ~152 MiB. So it is not a site asset any
more: it lives in an R2 bucket, and this Worker serves it.

A public R2 bucket URL is not enough on its own. The site sends
`Cross-Origin-Embedder-Policy: require-corp` (see `../_headers`) because the
kirikiri and Play! runtimes need SharedArrayBuffer, and under that policy
a cross-origin response is blocked unless it carries `Cross-Origin-Resource-Policy`
or passes a CORS check. A public bucket sends neither. This Worker adds both, and
nothing else: GET and HEAD only, no writes anywhere in the code.

The zip itself lives outside the site directory, in `../../noberu-assets/`, so a
Pages deploy cannot pick it up by accident. `serve-local.mjs` serves that folder at
`/large/`, which is what `../noberu-config.js` points at by default.

## Deploying it (needs your Cloudflare login)

```sh
cd ~/Documents/noberu-web/large-assets-worker
npx wrangler login
npx wrangler r2 bucket create noberu-large-assets
npx wrangler r2 object put noberu-large-assets/boxedwine.zip \
  --file ~/Documents/noberu-assets/boxedwine.zip --content-type application/zip
npx wrangler deploy
```

`wrangler deploy` prints the Worker's URL (`https://noberu-large-assets.<subdomain>.workers.dev`).
Two settings then have to agree with reality:

1. `wrangler.jsonc` → `vars.SITE_ORIGIN`: the deployed site's origin, e.g.
   `https://noberu.pages.dev` or the custom domain. It is the origin allowed to read
   these files cross-origin. Re-deploy after changing it.
2. `../noberu-config.js` → `NOBERU_LARGE_ASSET_BASE`: the Worker's URL **with a
   trailing slash**. Leave it as `/large/` for local work; set it before the Pages
   deploy.

To check a deployment without opening the site:

```sh
curl -sI -H "Origin: https://noberu.pages.dev" https://<worker-url>/boxedwine.zip
```

`cross-origin-resource-policy: cross-origin` and `access-control-allow-origin`
echoing your origin both have to be there, or the browser will block the fetch and
the boxedwine tab will sit at "working..." forever.

## Adding another file later

Put it in `~/Documents/noberu-assets/`, `wrangler r2 object put` it, and fetch it
through `window.NOBERU_LARGE_ASSET_BASE`. The Worker serves whatever the bucket
holds; it has no list of names. Keep in mind the two nearest ceilings on the site
itself: `kirikiri-runtime/index.wasm` is 21.6 MiB and `renpy-runtime/renpy.wasm` is
20.6 MiB, both under the 25 MiB cap but not by much, so a rebuild of either could
be the next thing that has to move here.

## Verified locally

`wrangler dev --local` with a seeded object: a plain GET answers 200 with
`Cross-Origin-Resource-Policy: cross-origin`, a `Range` request answers 206 with the
right bytes, a matching `If-None-Match` answers 304, an unknown origin gets the file
but no CORS headers, a PUT is refused with 405, and a missing key is a 404. The
boxedwine tab then booted Wine end to end with the zip coming from the configured
base rather than the site.
