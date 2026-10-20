/**
 * The dock: games and about, plus one "more engines" button holding the
 * twelve engine tabs in a menu.
 *
 * The engine tabs are the same .tab-button elements as before, moved into the
 * menu, so everything that switches tabs (setTab in index.html, the shelf, the
 * noberu menu) works unchanged. The button names itself after the engine whose
 * tab is open, or whose game is running, and says "more engines" otherwise.
 *
 * Loaded after index.html's own script, which has already wired each tab.
 */
(function () {
  "use strict";

  const nav = document.querySelector(".bottom-tabs");
  if (!nav || nav.querySelector(".dock-more")) return;

  const KEEP = new Set(["shelf", "about"]);
  const engineTabs = [...nav.querySelectorAll(".tab-button")].filter((tab) => !KEEP.has(tab.dataset.tab));

  const MORE_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 9.5v4M9.5 11.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const CARET = '<svg class="dock-caret" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const wrap = document.createElement("div");
  wrap.className = "dock-more";
  wrap.innerHTML = `
    <button type="button" class="dock-button" aria-haspopup="menu" aria-expanded="false" aria-controls="engines-menu">
      <span class="tab-icon" aria-hidden="true" data-dock-icon>${MORE_ICON}</span>
      <span class="tab-label"><span data-dock-label>more engines</span>${CARET}</span>
      <span class="dock-playing" hidden aria-hidden="true"></span>
    </button>
    <div class="engines-menu" id="engines-menu" role="menu" aria-label="engines" hidden>
      <p class="engines-menu-title">engines</p>
    </div>`;
  nav.appendChild(wrap);

  const button = wrap.querySelector(".dock-button");
  const menu = wrap.querySelector(".engines-menu");
  const labelEl = wrap.querySelector("[data-dock-label]");
  const iconEl = wrap.querySelector("[data-dock-icon]");
  const playingEl = wrap.querySelector(".dock-playing");

  for (const tab of engineTabs) {
    tab.setAttribute("role", "menuitem");
    menu.appendChild(tab);
  }

  // --- naming the button --------------------------------------------------------

  // The engine whose game is running, from its frame's view.
  function runningTab() {
    const frame = document.querySelector(".play-frame-wrap.active");
    const view = frame && frame.closest(".view");
    return view ? view.id.replace(/-view$/, "") : null;
  }

  function tabEl(name) {
    return engineTabs.find((tab) => tab.dataset.tab === name) || null;
  }

  function update() {
    const selected = engineTabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    const running = tabEl(runningTab());
    const shown = selected || running;
    if (shown) {
      labelEl.textContent = shown.querySelector(".tab-label").textContent.trim();
      iconEl.innerHTML = shown.querySelector(".tab-icon").innerHTML;
    } else {
      labelEl.textContent = "more engines";
      iconEl.innerHTML = MORE_ICON;
    }
    button.classList.toggle("selected", !!selected);
    button.setAttribute("aria-label", shown ? `engine: ${labelEl.textContent}` : "more engines");
    playingEl.hidden = !running || running !== shown;
    engineTabs.forEach((tab) => tab.classList.toggle("running", tab === running));
  }

  new MutationObserver(update).observe(menu, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] });
  for (const tab of nav.querySelectorAll(".tab-button")) {
    new MutationObserver(update).observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
  }
  if (window.NoberuInput) window.NoberuInput.onGameChange(update);

  // --- opening and closing --------------------------------------------------------

  function open(focusFirst) {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const target = engineTabs.find((tab) => tab.getAttribute("aria-selected") === "true") ||
      engineTabs.find((tab) => getComputedStyle(tab).display !== "none");
    if (focusFirst && target) target.focus();
  }

  function close(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) open(event.detail === 0);
    else close(false);
  });

  // index.html switches the tab; the menu just goes away.
  menu.addEventListener("click", (event) => {
    if (event.target.closest(".tab-button")) close(false);
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !wrap.contains(event.target)) close(false);
  });

  wrap.addEventListener("keydown", (event) => {
    if (menu.hidden) return;
    const items = engineTabs.filter((tab) => getComputedStyle(tab).display !== "none");
    const i = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = i < 0 ? 0 : (i + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  });

  update();
  window.NoberuDock = { update, open, close };
})();
