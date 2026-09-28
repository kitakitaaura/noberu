// Split BoxedWine's root filesystem zip into pieces a static host will take.
//
// Cloudflare Pages refuses any single asset over 25 MiB and the zip is ~152 MiB,
// so it ships as numbered parts that boxedwine-shell.js stitches back together
// in the browser before handing the bytes to the emulator. Run this whenever the
// zip is rebuilt from upstream BoxedWine:
//
//   node tools/split-root-zip.mjs ~/Documents/noberu-assets/boxedwine.zip
//
// Writes boxedwine-runtime/root/: the parts plus parts.json (the manifest the
// loader reads). The whole directory is regenerated each run.
import { readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 20 MiB, comfortably under the 25 MiB per-asset limit with room for the limit
// being counted differently than we expect.
const PART_BYTES = 20 * 1024 * 1024;

const source = process.argv[2];
if (!source) {
  console.error("usage: node tools/split-root-zip.mjs <path to boxedwine.zip>");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "boxedwine-runtime", "root");
const size = statSync(source).size;
const data = readFileSync(source);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const parts = [];
for (let at = 0, i = 0; at < size; at += PART_BYTES, i++) {
  const name = `boxedwine.zip.${String(i).padStart(3, "0")}`;
  writeFileSync(join(out, name), data.subarray(at, Math.min(at + PART_BYTES, size)));
  parts.push(name);
}

writeFileSync(
  join(out, "parts.json"),
  JSON.stringify({ file: "boxedwine.zip", bytes: size, partBytes: PART_BYTES, parts }, null, 2)
);

const mib = (n) => (n / 1048576).toFixed(1);
console.log(`${source}: ${mib(size)} MiB -> ${parts.length} parts of at most ${mib(PART_BYTES)} MiB`);
console.log(`wrote ${out}`);
