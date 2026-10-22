/*
 * A random visual novel quote from VNDB (the same pick as vndb.org's footer),
 * once per visit. On desktop it stands in for the about tab's caption line;
 * on phones it is a card under whichever tab is open (assets/mobile.css).
 * Offline or when VNDB is down, the caption keeps its own line and the card
 * stays hidden.
 */
(function () {
  "use strict";

  const API = "https://api.vndb.org/kana/quote";

  function render(box, data) {
    const quote = document.createElement("blockquote");
    quote.textContent = data.quote;
    const who = document.createElement("figcaption");
    who.append("— ");
    if (data.character && data.character.name) {
      const name = document.createElement("a");
      name.href = "https://vndb.org/" + data.character.id;
      name.textContent = data.character.name;
      who.append(name, ", ");
    }
    const vn = document.createElement("a");
    vn.href = "https://vndb.org/" + data.vn.id;
    vn.textContent = data.vn.title;
    who.append(vn);
    for (const link of who.querySelectorAll("a")) {
      link.target = "_blank";
      link.rel = "noopener";
    }
    const figure = document.createElement("figure");
    figure.className = "vn-quote";
    figure.append(quote, who);
    box.replaceChildren(figure);
    box.hidden = false;
  }

  async function load() {
    const boxes = document.querySelectorAll("[data-vn-quote]");
    if (!boxes.length || !navigator.onLine) return;
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: "vn{id,title},character{id,name},quote", filters: ["random", "=", 1] }),
      });
      if (!response.ok) return;
      const data = (await response.json()).results[0];
      if (!data || !data.quote || !data.vn) return;
      for (const box of boxes) render(box, data);
    } catch (error) {
      // No quote today; the caption's own line stays.
    }
  }

  window.NoberuQuote = { load };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
