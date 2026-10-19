/**
 * Japanese deinflection for the reading tools' dictionary (assets/text.js):
 * turns what a game prints (食べさせられなかった) back into what a dictionary
 * lists (食べる), with the steps taken (causative, passive, negative, past).
 *
 *   NoberuDeinflect(text) -> [{ text, type, reasons }]
 *
 * `type` is a bit mask of the word classes the result can be (0 for the text
 * as given, which may be anything). A dictionary entry only counts if one of
 * its parts of speech is in the mask (see matches()). Rules chain: each rule
 * says what class the inflected form belongs to (in) and what class the base
 * has (out), in the manner of Yomichan's deinflector.
 */
(function () {
  "use strict";

  const V1 = 1;       // ichidan: 食べる, and every る-verb a rule makes (〜られる, 〜ている)
  const V5 = 2;       // godan: 書く
  const VK = 4;       // 来る
  const VS = 8;       // する
  const ADJ = 16;     // い-adjective, and 〜ない / 〜たい
  const TE = 32;      // a て-form
  const NOUN_VS = 64; // a noun that takes する: 勉強(する)
  const MASU = 128;   // a ます-stem form that inflects further (〜ます → 〜ません)
  const ANY = 0;

  const rules = [];
  const rule = (from, to, typeIn, typeOut, reason) => rules.push({ from, to, typeIn, typeOut, reason });

  // Godan endings and their rows: dictionary う-row, a-row (negative), i-row
  // (stem), e-row (potential, imperative), o-row (volitional), and the
  // て/た forms.
  const GODAN = [
    { u: "う", a: "わ", i: "い", e: "え", o: "お", te: "って", ta: "った" },
    { u: "く", a: "か", i: "き", e: "け", o: "こ", te: "いて", ta: "いた" },
    { u: "ぐ", a: "が", i: "ぎ", e: "げ", o: "ご", te: "いで", ta: "いだ" },
    { u: "す", a: "さ", i: "し", e: "せ", o: "そ", te: "して", ta: "した" },
    { u: "つ", a: "た", i: "ち", e: "て", o: "と", te: "って", ta: "った" },
    { u: "ぬ", a: "な", i: "に", e: "ね", o: "の", te: "んで", ta: "んだ" },
    { u: "ぶ", a: "ば", i: "び", e: "べ", o: "ぼ", te: "んで", ta: "んだ" },
    { u: "む", a: "ま", i: "み", e: "め", o: "も", te: "んで", ta: "んだ" },
    { u: "る", a: "ら", i: "り", e: "れ", o: "ろ", te: "って", ta: "った" },
  ];

  for (const g of GODAN) {
    rule(g.a + "ない", g.u, ADJ, V5, "negative");
    rule(g.a + "ず", g.u, ANY, V5, "negative (literary)");
    rule(g.a + "ずに", g.u, ANY, V5, "without doing");
    rule(g.a + "ぬ", g.u, ANY, V5, "negative (archaic)");
    rule(g.a + "ん", g.u, ANY, V5, "negative (colloquial)");
    rule(g.a + "ねえ", g.u, ANY, V5, "negative (colloquial)");
    rule(g.a + "ねぇ", g.u, ANY, V5, "negative (colloquial)");
    rule(g.a + "ねー", g.u, ANY, V5, "negative (colloquial)");
    rule(g.a + "なきゃ", g.u, ANY, V5, "must");
    rule(g.a + "なくちゃ", g.u, ANY, V5, "must");
    rule(g.a + "れる", g.u, V1, V5, "passive");
    rule(g.a + "せる", g.u, V1, V5, "causative");
    rule(g.a + "す", g.u, V5, V5, "causative");
    rule(g.a + "される", g.u, V1, V5, "causative passive");
    rule(g.i + "ます", g.u, MASU, V5, "polite");
    rule(g.i + "たい", g.u, ADJ, V5, "want to");
    rule(g.i + "たがる", g.u, V5, V5, "seems to want to");
    rule(g.i + "ながら", g.u, ANY, V5, "while");
    rule(g.i + "なさい", g.u, ANY, V5, "polite command");
    rule(g.i + "そう", g.u, ANY, V5, "looks like");
    rule(g.i + "すぎる", g.u, V1, V5, "too much");
    rule(g.i + "やすい", g.u, ADJ, V5, "easy to");
    rule(g.i + "にくい", g.u, ADJ, V5, "hard to");
    rule(g.e + "る", g.u, V1, V5, "potential");
    rule(g.e + "ば", g.u, ANY, V5, "if");
    rule(g.e, g.u, ANY, V5, "command");
    rule(g.o + "う", g.u, ANY, V5, "let's");
    rule(g.te, g.u, TE, V5, "て-form");
    rule(g.ta, g.u, ANY, V5, "past");
    rule(g.ta + "ら", g.u, ANY, V5, "if / when");
    rule(g.ta + "り", g.u, ANY, V5, "and so on");
  }
  // 行く is the one godan く-verb whose て-form is 行って.
  for (const base of ["行く", "いく", "逝く", "往く"]) {
    const stem = base.slice(0, -1);
    rule(stem + "って", base, TE, V5, "て-form");
    rule(stem + "った", base, ANY, V5, "past");
    rule(stem + "ったら", base, ANY, V5, "if / when");
    rule(stem + "ったり", base, ANY, V5, "and so on");
  }

  // Ichidan: drop る, add the ending.
  const ICHIDAN = [
    ["ない", ADJ, "negative"], ["ず", ANY, "negative (literary)"], ["ずに", ANY, "without doing"],
    ["ぬ", ANY, "negative (archaic)"], ["ん", ANY, "negative (colloquial)"], ["ねえ", ANY, "negative (colloquial)"],
    ["なきゃ", ANY, "must"],
    ["なくちゃ", ANY, "must"], ["られる", V1, "passive / potential"], ["れる", V1, "potential (colloquial)"],
    ["させる", V1, "causative"], ["さす", V5, "causative"], ["させられる", V1, "causative passive"],
    ["ます", MASU, "polite"], ["たい", ADJ, "want to"], ["たがる", V5, "seems to want to"],
    ["ながら", ANY, "while"], ["なさい", ANY, "polite command"], ["そう", ANY, "looks like"],
    ["すぎる", V1, "too much"], ["やすい", ADJ, "easy to"], ["にくい", ADJ, "hard to"],
    ["れば", ANY, "if"], ["ろ", ANY, "command"], ["よ", ANY, "command"], ["よう", ANY, "let's"],
    ["て", TE, "て-form"], ["た", ANY, "past"], ["たら", ANY, "if / when"], ["たり", ANY, "and so on"],
    ["", ANY, "stem"],
  ];
  for (const [ending, typeIn, reason] of ICHIDAN) rule(ending, "る", typeIn, V1, reason);

  // ます forms: the polite ending inflects too.
  rule("ません", "ます", ANY, MASU, "negative");
  rule("ませんでした", "ます", ANY, MASU, "past negative");
  rule("ました", "ます", ANY, MASU, "past");
  rule("ましょう", "ます", ANY, MASU, "let's");
  rule("まして", "ます", TE, MASU, "て-form");
  rule("ませ", "ます", ANY, MASU, "command");

  // する and 来る (in kana and kanji).
  const SURU = [
    ["しない", ADJ, "negative"], ["せず", ANY, "negative (literary)"], ["せずに", ANY, "without doing"],
    ["せぬ", ANY, "negative (archaic)"], ["せん", ANY, "negative (colloquial)"], ["される", V1, "passive"],
    ["させる", V1, "causative"], ["させられる", V1, "causative passive"], ["できる", V1, "potential"],
    ["します", MASU, "polite"], ["したい", ADJ, "want to"], ["しながら", ANY, "while"],
    ["しなさい", ANY, "polite command"], ["しそう", ANY, "looks like"], ["すれば", ANY, "if"],
    ["しろ", ANY, "command"], ["せよ", ANY, "command"], ["しよう", ANY, "let's"],
    ["して", TE, "て-form"], ["した", ANY, "past"], ["したら", ANY, "if / when"], ["したり", ANY, "and so on"],
    ["しなきゃ", ANY, "must"], ["すぎる", V1, "too much"],
  ];
  for (const [form, typeIn, reason] of SURU) rule(form, "する", typeIn, VS, reason);
  // 勉強する → 勉強 (filed as a noun that takes する).
  rule("する", "", VS, NOUN_VS, "+ する");

  const KURU = [
    ["こない", "きない", ADJ, "negative"], ["こず", "こず", ANY, "negative (literary)"],
    ["こられる", "こられる", V1, "passive / potential"], ["こさせる", "こさせる", V1, "causative"],
    ["きます", "きます", MASU, "polite"], ["きたい", "きたい", ADJ, "want to"], ["くれば", "くれば", ANY, "if"],
    ["こい", "こい", ANY, "command"], ["こよう", "こよう", ANY, "let's"], ["きて", "きて", TE, "て-form"],
    ["きた", "きた", ANY, "past"], ["きたら", "きたら", ANY, "if / when"], ["きたり", "きたり", ANY, "and so on"],
  ];
  for (const [kana, , typeIn, reason] of KURU) {
    rule(kana, "くる", typeIn, VK, reason);
    // 来 keeps its kanji whatever its reading: 来ない, 来た, 来れば.
    rule("来" + kana.slice(1), "来る", typeIn, VK, reason);
  }

  // い-adjectives (and every form that conjugates like one: 〜ない, 〜たい).
  const ADJECTIVE = [
    ["くない", ADJ, "negative"], ["かった", ANY, "past"], ["くなかった", ANY, "past negative"],
    ["くて", TE, "て-form"], ["く", ANY, "adverb"], ["ければ", ANY, "if"], ["かったら", ANY, "if / when"],
    ["さ", ANY, "-ness"], ["そう", ANY, "looks like"], ["すぎる", V1, "too much"], ["き", ANY, "attributive (literary)"],
    ["かろう", ANY, "probably"], ["くなる", V5, "becomes"], ["げ", ANY, "seeming"], ["ねえ", ANY, "colloquial"],
    ["ぇ", ANY, "colloquial"],
  ];
  for (const [ending, typeIn, reason] of ADJECTIVE) rule(ending, "い", typeIn, ADJ, reason);
  rule("なきゃ", "ない", ANY, ADJ, "must");

  // Spoken contractions of て-forms.
  rule("ちゃう", "て", V5, TE, "do completely");
  rule("じゃう", "で", V5, TE, "do completely");
  rule("ちまう", "て", V5, TE, "do completely");
  rule("ている", "て", V1, TE, "-ing");
  rule("でいる", "で", V1, TE, "-ing");
  rule("てる", "て", V1, TE, "-ing");
  rule("でる", "で", V1, TE, "-ing");
  rule("ておく", "て", V5, TE, "in advance");
  rule("とく", "て", V5, TE, "in advance");
  rule("どく", "で", V5, TE, "in advance");
  rule("てしまう", "て", V5, TE, "do completely");
  rule("でしまう", "で", V5, TE, "do completely");
  rule("てある", "て", V5, TE, "has been done");
  rule("てくる", "て", VK, TE, "come to");
  rule("ていく", "て", V5, TE, "go on");
  rule("てく", "て", V5, TE, "go on");
  rule("てくれる", "て", V1, TE, "for me");
  rule("てあげる", "て", V1, TE, "for you");
  rule("てもらう", "て", V5, TE, "have it done");
  rule("てみる", "て", V1, TE, "try");
  rule("ても", "て", ANY, TE, "even if");
  rule("では", "で", ANY, TE, "if");
  rule("ては", "て", ANY, TE, "if");
  rule("ちゃ", "ては", ANY, ANY, "if");
  rule("じゃ", "では", ANY, ANY, "if");

  // Longest endings first, so 〜させられる wins over 〜られる.
  rules.sort((a, b) => b.from.length - a.from.length);

  function deinflect(source) {
    const results = [{ text: source, type: ANY, reasons: [] }];
    const seen = new Set([source + ":0"]);
    for (let i = 0; i < results.length && results.length < 400; i++) {
      const { text, type, reasons } = results[i];
      for (const r of rules) {
        if (type !== ANY && !(type & r.typeIn)) continue;
        if (r.typeIn === ANY && type !== ANY) continue;
        if (!text.endsWith(r.from) || text.length - r.from.length + r.to.length < 1) continue;
        if (r.from === "" && type !== ANY) continue;
        const next = text.slice(0, text.length - r.from.length) + r.to;
        if (next === text) continue;
        const key = next + ":" + r.typeOut;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ text: next, type: r.typeOut, reasons: [r.reason, ...reasons] });
      }
    }
    return results;
  }

  // Does a dictionary entry's part of speech fit the class a rule produced?
  function matches(type, partsOfSpeech) {
    if (type === ANY) return true;
    for (const pos of partsOfSpeech) {
      if ((type & V1) && /^v1/.test(pos)) return true;
      if ((type & V5) && /^v5/.test(pos)) return true;
      if ((type & VK) && pos === "vk") return true;
      if ((type & VS) && /^vs-[is]$/.test(pos)) return true;
      if ((type & NOUN_VS) && pos === "vs") return true;
      if ((type & ADJ) && /^adj-ix?$/.test(pos)) return true;
    }
    return false;
  }

  window.NoberuDeinflect = deinflect;
  window.NoberuDeinflect.matches = matches;
})();
