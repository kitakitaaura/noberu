// Text from engines written in JavaScript, for the reading tools
// (assets/text.js). Loaded into every runtime frame by assets/runtime.js; it
// does nothing in a page whose engine it does not recognise.
//
//   TyranoScript  its tag handlers: [text] adds to the line, [l] / [p] end it,
//                 [chara_ptext] names the speaker, [glink] / [link] are choices
//   RPG Maker     Window_Message.startMessage (one message box at a time) and
//                 Window_ChoiceList.start
//
// Both are wrapped, never replaced: the original always runs, after.
(function () {
  "use strict";

  if (window.__noberuTextHooks) return;
  window.__noberuTextHooks = true;

  const say = (line) => window.NoberuSay && window.NoberuSay(line);

  function wrap(object, name, before) {
    const original = object && object[name];
    if (typeof original !== "function" || original.__noberu) return false;
    const wrapped = function (...args) {
      try {
        before.apply(this, args);
      } catch (error) { /* the game matters more than its text */ }
      return original.apply(this, args);
    };
    wrapped.__noberu = true;
    object[name] = wrapped;
    return true;
  }

  // --- TyranoScript ------------------------------------------------------------------

  function tyrano() {
    const kag = window.TYRANO && window.TYRANO.kag;
    const tags = kag && kag.ftag && kag.ftag.master_tag;
    if (!tags || !tags.text) return false;
    let text = "";
    let name = "";
    let choices = [];
    const flush = () => {
      if (text.trim()) say({ text, name, kind: "line" });
      text = "";
    };
    wrap(tags.text, "start", (pm) => { text += (pm && pm.val) || ""; });
    wrap(tags.r, "start", () => { text += "\n"; });
    wrap(tags.l, "start", flush);
    wrap(tags.p, "start", () => {
      flush();
      name = "";
    });
    wrap(tags.cm, "start", flush);
    wrap(tags.chara_ptext, "start", (pm) => {
      const id = (pm && pm.name) || "";
      const chara = kag.stat && kag.stat.charas && kag.stat.charas[id];
      name = (chara && chara.jname) || id;
    });
    const choice = (pm) => {
      if (pm && pm.text) choices.push(String(pm.text).replace(/<[^>]*>/g, ""));
    };
    wrap(tags.glink, "start", choice);
    wrap(tags.button, "start", (pm) => { if (pm && pm.text) choice(pm); });
    wrap(tags.s, "start", () => {
      flush();
      if (choices.length) say({ text: choices.join("\n"), kind: "choice" });
      choices = [];
    });
    return true;
  }

  // --- RPG Maker MV / MZ -----------------------------------------------------------------

  // What convertEscapeCharacters leaves: \x1b plus a code, maybe [n] or <..>.
  const strip = (s) => String(s || "")
    .replace(/\x1b[A-Za-z]+(\[[^\]]*\]|<[^>]*>)?/g, "")
    .replace(/\x1b./g, "")
    .replace(/\\[A-Za-z]+(\[[^\]]*\]|<[^>]*>)?/g, "")
    .trim();

  function rpgmaker() {
    if (typeof window.Window_Message !== "function" || !window.$gameMessage) return false;
    wrap(window.Window_Message.prototype, "startMessage", function () {
      const convert = (s) => (this.convertEscapeCharacters ? this.convertEscapeCharacters(s) : s);
      const text = strip(convert(window.$gameMessage.allText()));
      const speaker = window.$gameMessage.speakerName ? strip(convert(window.$gameMessage.speakerName())) : "";
      if (text) say({ text, name: speaker, kind: "line" });
    });
    if (typeof window.Window_ChoiceList === "function") {
      wrap(window.Window_ChoiceList.prototype, "start", function () {
        const convert = (s) => (this.convertEscapeCharacters ? this.convertEscapeCharacters(s) : s);
        const list = window.$gameMessage.choices().map((c) => strip(convert(c))).filter(Boolean);
        if (list.length) say({ text: list.join("\n"), kind: "choice" });
      });
    }
    return true;
  }

  // Engines finish loading at their own pace; look for a while.
  let tries = 0;
  const timer = setInterval(() => {
    let done = false;
    try {
      done = tyrano() || rpgmaker();
    } catch (error) { /* not ready */ }
    if (done || ++tries > 120) clearInterval(timer);
  }, 500);
})();
