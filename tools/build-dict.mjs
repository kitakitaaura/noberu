// Builds the Japanese-English dictionary the reading tools look words up in
// (assets/text.js), from jmdict-simplified's JSON (github.com/scriptin/
// jmdict-simplified, made from EDRDG's JMdict and KANJIDIC2, CC BY-SA 4.0).
//
//   node tools/build-dict.mjs <jmdict-eng-x.json> <kanjidic2-en-x.json> [out dir]
//
// Writes dict/ja-en/<n>.json and dict/kanji/<n>.json plus a meta.json in each.
// A word is filed under every one of its spellings, in the shard for that
// spelling's first two characters, so a lookup fetches one small file and the
// whole dictionary (~200k words) never has to be downloaded at once.
//
// Keep SHARDS and shardOf() in step with assets/text.js.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [, , jmdictPath, kanjidicPath, outArg] = process.argv;
if (!jmdictPath || !kanjidicPath) {
  console.error("usage: node tools/build-dict.mjs <jmdict-eng.json> <kanjidic2-en.json> [out dir]");
  process.exit(1);
}
const out = outArg || new URL("../dict/", import.meta.url).pathname;

const SHARDS = 1024;
const KANJI_SHARDS = 64;

// FNV-1a over the first two UTF-16 code units: cheap, and the same in JS.
export function shardOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < Math.min(2, text.length); i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SHARDS;
}

const jmdict = JSON.parse(readFileSync(jmdictPath, "utf8"));
const kanjidic = JSON.parse(readFileSync(kanjidicPath, "utf8"));

// --- words ----------------------------------------------------------------------

// One word, compact:
//   k: kanji spellings (rarely used and search-only ones last, flagged with "~")
//   r: readings
//   c: 1 if any spelling is marked common
//   s: senses, each [partsOfSpeech, glosses ("; " joined), tags]
function compact(word) {
  const order = (forms) => [...forms].sort((a, b) =>
    (Number(b.common) - Number(a.common)) ||
    (Number(rare(a)) - Number(rare(b))));
  const rare = (form) => form.tags.some((t) => /^(rK|sK|iK|oK|ik|ok|rk|sk)$/.test(t));
  const k = order(word.kanji).map((f) => (rare(f) ? "~" : "") + f.text);
  const r = order(word.kana).map((f) => (rare(f) ? "~" : "") + f.text);
  const c = word.kanji.some((f) => f.common) || word.kana.some((f) => f.common) ? 1 : 0;
  let lastPos = [];
  const s = word.sense.map((sense) => {
    // jmdict-simplified leaves partOfSpeech empty when it repeats the sense
    // before it.
    const pos = sense.partOfSpeech.length ? sense.partOfSpeech : lastPos;
    lastPos = pos;
    const gloss = sense.gloss.map((g) => g.text).join("; ");
    const tags = [...sense.misc, ...sense.dialect, ...sense.field];
    const info = sense.info.length ? sense.info.join("; ") : "";
    return info ? [pos, gloss, tags, info] : tags.length ? [pos, gloss, tags] : [pos, gloss];
  });
  const entry = { k, r, s };
  if (c) entry.c = 1;
  return entry;
}

const shards = Array.from({ length: SHARDS }, () => ({ w: {}, i: {} }));
let filed = 0;
for (const word of jmdict.words) {
  const entry = compact(word);
  const spellings = new Set([...word.kanji.map((f) => f.text), ...word.kana.map((f) => f.text)]);
  for (const text of spellings) {
    const shard = shards[shardOf(text)];
    shard.w[word.id] = entry;
    (shard.i[text] = shard.i[text] || []).push(word.id);
    filed++;
  }
}

const wordsDir = join(out, "ja-en");
rmSync(wordsDir, { recursive: true, force: true });
mkdirSync(wordsDir, { recursive: true });
let bytes = 0;
let biggest = 0;
shards.forEach((shard, n) => {
  const json = JSON.stringify(shard);
  bytes += json.length;
  biggest = Math.max(biggest, json.length);
  writeFileSync(join(wordsDir, `${n}.json`), json);
});
writeFileSync(join(wordsDir, "meta.json"), JSON.stringify({
  shards: SHARDS,
  version: jmdict.version,
  date: jmdict.dictDate,
  words: jmdict.words.length,
  tags: jmdict.tags,
  source: "JMdict (EDRDG), via jmdict-simplified",
  license: "CC BY-SA 4.0 — https://www.edrdg.org/edrdg/licence.html",
}));

// --- kanji -------------------------------------------------------------------------

const kanjiShards = Array.from({ length: KANJI_SHARDS }, () => ({}));
for (const ch of kanjidic.characters) {
  const groups = (ch.readingMeaning && ch.readingMeaning.groups) || [];
  const readings = groups.flatMap((g) => g.readings || []);
  const meanings = groups.flatMap((g) => g.meanings || []).filter((m) => m.lang === "en").map((m) => m.value);
  const entry = {
    m: meanings,
    on: readings.filter((r) => r.type === "ja_on").map((r) => r.value),
    kun: readings.filter((r) => r.type === "ja_kun").map((r) => r.value),
  };
  const misc = ch.misc || {};
  if (misc.grade) entry.g = misc.grade;
  if (misc.strokeCounts && misc.strokeCounts.length) entry.n = misc.strokeCounts[0];
  if (misc.jlptLevel) entry.j = misc.jlptLevel;
  if (misc.frequency) entry.f = misc.frequency;
  kanjiShards[ch.literal.codePointAt(0) % KANJI_SHARDS][ch.literal] = entry;
}
const kanjiDir = join(out, "kanji");
rmSync(kanjiDir, { recursive: true, force: true });
mkdirSync(kanjiDir, { recursive: true });
let kanjiBytes = 0;
kanjiShards.forEach((shard, n) => {
  const json = JSON.stringify(shard);
  kanjiBytes += json.length;
  writeFileSync(join(kanjiDir, `${n}.json`), json);
});
writeFileSync(join(kanjiDir, "meta.json"), JSON.stringify({
  shards: KANJI_SHARDS,
  version: kanjidic.version,
  date: kanjidic.dictDate,
  kanji: kanjidic.characters.length,
  source: "KANJIDIC2 (EDRDG), via jmdict-simplified",
  license: "CC BY-SA 4.0 — https://www.edrdg.org/edrdg/licence.html",
}));

console.log(`${jmdict.words.length} words filed ${filed} times in ${SHARDS} shards: ` +
  `${(bytes / 1048576).toFixed(1)} MB, biggest ${(biggest / 1024).toFixed(0)} KB`);
console.log(`${kanjidic.characters.length} kanji in ${KANJI_SHARDS} shards: ${(kanjiBytes / 1048576).toFixed(1)} MB`);
