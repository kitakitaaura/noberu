// Writes offline.json: every engine's files and sizes, for assets/offline.js
// (the offline settings and "all engines now") and the sizes it shows.
//
//   node tools/offline-manifest.mjs [site dir]     # default: this repo
//
// tools/stage-deploy.sh runs it on the staged copy, so the deployed list
// always matches what was uploaded. Symlinks (dev links to local games) and
// dev-only files are skipped, the same as the deploy itself.
import { readdirSync, lstatSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] || new URL("..", import.meta.url).pathname;
const SKIP = /(^|\/)(README\.md|NOTICE[^/]*|[^/]*_filelist\.txt|\.DS_Store)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || name.startsWith(".")) continue;
    if (stat.isDirectory()) walk(path, out);
    else out.push([relative(root, path), stat.size]);
  }
  return out;
}

// The URLs the tabs load these pages by: Pages serves x.html as x (and
// d/index.html as d/), and a redirected page can't be stored for later.
function pageUrl(path) {
  if (path.endsWith("/index.html")) return path.slice(0, -"index.html".length);
  return path.slice(0, -".html".length);
}

const engines = {};
for (const name of readdirSync(root).sort()) {
  if (!name.endsWith("-runtime") || !lstatSync(join(root, name)).isDirectory()) continue;
  const files = walk(join(root, name)).filter(([path]) => !SKIP.test(path)).sort();
  engines[name] = {
    bytes: files.reduce((sum, [, size]) => sum + size, 0),
    files,
    pages: files.filter(([path]) => path.endsWith(".html")).map(([path]) => pageUrl(path)),
  };
}

const out = join(root, "offline.json");
writeFileSync(out, JSON.stringify({ engines }) + "\n");
const total = Object.values(engines).reduce((sum, e) => sum + e.bytes, 0);
console.log(`offline.json: ${Object.keys(engines).length} engines, ${(total / 1048576).toFixed(0)} MB`);
