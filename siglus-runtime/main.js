import init, { start_siglus_from_directory } from "./pkg/siglus_scene_vm.js";

const input = document.getElementById("game-dir");
const rescanButton = document.getElementById("rescan-button");
const statusLine = document.getElementById("status-line");
const errorBox = document.getElementById("error-box");
const grid = document.getElementById("game-grid");
const emptyCard = document.getElementById("empty-card");
const launchOverlay = document.getElementById("launch-overlay");
const launchText = document.getElementById("launch-text");
const libraryScreen = document.getElementById("library-screen");
const playerScreen = document.getElementById("player-screen");
const playerTitle = document.getElementById("player-title");
const exitButton = document.getElementById("exit-button");
const canvas = document.getElementById("siglus-canvas");

let wasmInitialized = false;
let selectedFileList = null;
let selectedRootName = "";
let games = [];
let running = false;

const filesByPath = new Map();
const filesByFoldedPath = new Map();
const dirChildren = new Map();
let filesMetadata = [];

function setStatus(text) {
  statusLine.textContent = text;
}

function setError(error) {
  const text = error && error.stack ? error.stack : String(error);
  console.error(error);
  errorBox.textContent = text;
  errorBox.style.display = "block";
}

function clearError() {
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

function showLaunching(text) {
  launchText.textContent = text;
  launchOverlay.style.display = "grid";
}

function hideLaunching() {
  launchOverlay.style.display = "none";
}

function normalizePath(path) {
  return String(path || "")
    .replaceAll("\\\\", "/")
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function foldWindowsAsciiPath(path) {
  let out = "";
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : path[i];
  }
  return out;
}

function splitPath(path) {
  const normalized = normalizePath(path);
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function rootNameFromFileList(fileList) {
  for (const file of fileList) {
    const rel = normalizePath(file.webkitRelativePath || file.name);
    const parts = splitPath(rel);
    if (parts.length > 0) return parts[0];
  }
  return "Selected Folder";
}

function relativeInsideSelectedRoot(file) {
  const rel = normalizePath(file.webkitRelativePath || file.name);
  const parts = splitPath(rel);
  if (parts.length <= 1) return file.name || rel;
  return parts.slice(1).join("/");
}

function hasRootFile(entries, fileName) {
  const needle = fileName.toLowerCase();
  return entries.some((entry) => {
    const parts = splitPath(entry.gamePath.toLowerCase());
    return parts.length === 1 && parts[0] === needle;
  });
}

function looksLikeGameRoot(entries) {
  return hasRootFile(entries, "Scene.pck") ||
    hasRootFile(entries, "Gameexe.ini") ||
    hasRootFile(entries, "Gameexe.dat");
}

function titleForGameRoot(fallback, entries) {
  if (hasRootFile(entries, "Gameexe.ini")) return fallback;
  if (hasRootFile(entries, "Gameexe.dat")) return fallback;
  if (hasRootFile(entries, "Scene.pck")) return fallback;
  return fallback;
}

function rememberLastPlayed(id) {
  try {
    localStorage.setItem(`siglus.lastPlayed.${id}`, String(Date.now()));
  } catch (_) {
    // best-effort
  }
}

function getLastPlayed(id) {
  try {
    return Number(localStorage.getItem(`siglus.lastPlayed.${id}`) || "0") || 0;
  } catch (_) {
    return 0;
  }
}

async function buildGamesFromFileList(fileList) {
  const rootName = rootNameFromFileList(fileList);
  selectedRootName = rootName;

  const rootEntries = [];
  for (const file of fileList) {
    const rootRelativePath = relativeInsideSelectedRoot(file);
    if (!rootRelativePath) continue;
    rootEntries.push({ file, gamePath: rootRelativePath });
  }

  if (looksLikeGameRoot(rootEntries)) {
    const id = hashString(`${rootName}:/`);
    const title = titleForGameRoot(rootName, rootEntries);
    return [{
      id,
      title,
      rootPath: rootName,
      entries: rootEntries,
      lastPlayed: getLastPlayed(id),
    }];
  }

  const groups = new Map();
  for (const entry of rootEntries) {
    const parts = splitPath(entry.gamePath);
    if (parts.length < 2) continue;
    const groupName = parts[0];
    const gamePath = parts.slice(1).join("/");
    if (!gamePath) continue;

    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push({ file: entry.file, gamePath });
  }

  const out = [];
  for (const [groupName, entries] of groups.entries()) {
    if (!looksLikeGameRoot(entries)) continue;

    const id = hashString(`${rootName}:${groupName}`);
    const title = titleForGameRoot(groupName, entries);

    out.push({
      id,
      title,
      rootPath: `${rootName}/${groupName}`,
      entries,
      lastPlayed: getLastPlayed(id),
    });
  }

  out.sort((a, b) => {
    if (a.lastPlayed !== b.lastPlayed) return b.lastPlayed - a.lastPlayed;
    return a.title.localeCompare(b.title);
  });

  return out;
}

function renderLibrary() {
  grid.innerHTML = "";
  emptyCard.style.display = games.length === 0 ? "block" : "none";

  for (const game of games) {
    const tile = document.createElement("article");
    tile.className = "game-tile";

    const poster = document.createElement("div");
    poster.className = "poster";

    const posterTitle = document.createElement("div");
    posterTitle.className = "poster-title";
    posterTitle.textContent = game.title;
    poster.append(posterTitle);

    const title = document.createElement("div");
    title.className = "game-title";
    title.textContent = game.title;

    const path = document.createElement("div");
    path.className = "game-path";
    path.textContent = game.rootPath;

    const meta = document.createElement("div");
    meta.className = "game-meta";
    meta.textContent = `${game.entries.length} file(s)`;

    const actions = document.createElement("div");
    actions.className = "tile-actions";

    const play = document.createElement("button");
    play.textContent = "Play";
    play.addEventListener("click", () => launchGame(game));

    const grow = document.createElement("div");
    grow.className = "grow";

    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      games = games.filter((x) => x.id !== game.id);
      renderLibrary();
      setStatus(games.length === 0 ? "No games in library." : `${games.length} game(s) in library.`);
    });

    actions.append(play, grow, remove);
    tile.append(poster, title, path, meta, actions);
    grid.append(tile);
  }
}

async function scanCurrentSelection() {
  clearError();

  if (!selectedFileList || selectedFileList.length === 0) {
    games = [];
    renderLibrary();
    setStatus("No folder selected.");
    rescanButton.disabled = true;
    return;
  }

  setStatus(`Scanning ${selectedFileList.length} file(s)...`);
  await new Promise((resolve) => setTimeout(resolve, 0));

  games = await buildGamesFromFileList(selectedFileList);
  renderLibrary();
  rescanButton.disabled = false;

  if (games.length === 0) {
    setStatus(`No valid Siglus game root found under ${selectedRootName}.`);
  } else {
    setStatus(`${games.length} game(s) found under ${selectedRootName}.`);
  }
}

function parentDirOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function baseNameOf(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function registerDir(path) {
  const parts = splitPath(path);
  let parent = "";

  for (let i = 0; i + 1 < parts.length; i += 1) {
    const child = parts[i];
    if (!dirChildren.has(parent)) {
      dirChildren.set(parent, new Set());
    }
    dirChildren.get(parent).add(child);
    parent = parent ? `${parent}/${child}` : child;
  }

  const fileParent = parentDirOf(path);
  const fileBase = baseNameOf(path);
  if (!dirChildren.has(fileParent)) {
    dirChildren.set(fileParent, new Set());
  }
  dirChildren.get(fileParent).add(fileBase);
}

function registerGameEntries(game) {
  filesByPath.clear();
  filesByFoldedPath.clear();
  dirChildren.clear();
  filesMetadata = [];

  for (const entry of game.entries) {
    const path = normalizePath(entry.gamePath);
    if (!path) continue;

    const folded = foldWindowsAsciiPath(path);
    if (filesByFoldedPath.has(folded)) {
      const other = filesByFoldedPath.get(folded).__siglusPath;
      throw new Error(`case-insensitive path conflict: ${other} vs ${path}`);
    }

    entry.file.__siglusPath = path;
    filesByPath.set(path, entry.file);
    filesByFoldedPath.set(folded, entry.file);
    registerDir(path);
    filesMetadata.push({ path, size: entry.file.size, lastModified: entry.file.lastModified || 0 });
  }

  console.log("siglus_rs wasm registered files:", filesMetadata.length);
  console.log("siglus_rs wasm file sample:", filesMetadata.slice(0, 50).map((f) => `${f.path} (${f.size})`));
  console.log("siglus_rs wasm has Scene.pck:", globalThis.siglusFileExists("Scene.pck"));
  console.log("siglus_rs wasm has Gameexe.ini:", globalThis.siglusFileExists("Gameexe.ini"));

  if (!globalThis.siglusFileExists("Scene.pck")) {
    throw new Error("Scene.pck was not found in the selected Siglus game root");
  }

  return filesMetadata;
}

function resolveSiglusFile(path) {
  const normalized = normalizePath(path);

  let file = filesByPath.get(normalized);
  if (file) return file;

  file = filesByFoldedPath.get(foldWindowsAsciiPath(normalized));
  return file || null;
}

function readFileSynchronously(file) {
  const url = URL.createObjectURL(file);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.overrideMimeType("text/plain; charset=x-user-defined");
    xhr.send(null);

    if (xhr.status !== 200 && xhr.status !== 0) {
      throw new Error(`Siglus wasm file read failed: HTTP ${xhr.status}`);
    }

    const text = xhr.responseText || "";
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      out[i] = text.charCodeAt(i) & 0xff;
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

globalThis.siglusFileExists = function siglusFileExists(path) {
  return resolveSiglusFile(path) !== null;
};

globalThis.siglusReadFile = function siglusReadFile(path) {
  const file = resolveSiglusFile(path);
  if (!file) {
    throw new Error(`Siglus file not found: ${path}`);
  }
  return readFileSynchronously(file);
};

globalThis.siglusListDir = function siglusListDir(path) {
  const normalized = normalizePath(path).replace(/\/$/, "");
  const children = dirChildren.get(normalized);
  return children ? Array.from(children) : [];
};

globalThis.siglusKnownFileCount = function siglusKnownFileCount() {
  return filesByPath.size;
};

async function ensureWasmInitialized() {
  if (wasmInitialized) return;
  showLaunching("Loading wasm…");
  await init();
  wasmInitialized = true;
}

async function launchGame(game) {
  if (running) return;

  try {
    clearError();
    running = true;
    showLaunching("Registering files…");

    await ensureWasmInitialized();
    const files = registerGameEntries(game);

    rememberLastPlayed(game.id);
    game.lastPlayed = Date.now();

    libraryScreen.style.display = "none";
    playerScreen.style.display = "block";
    playerTitle.textContent = game.title;
    canvas.focus();

    showLaunching("Launching…");
    await start_siglus_from_directory("siglus-canvas", JSON.stringify(files));

    hideLaunching();
    setStatus("Running.");
  } catch (error) {
    running = false;
    playerScreen.style.display = "none";
    libraryScreen.style.display = "flex";
    hideLaunching();
    setError(error);
    setStatus("siglus_rs failed to start.");
  }
}

function exitPlayer() {
  window.location.reload();
}

input.addEventListener("change", async () => {
  selectedFileList = input.files;
  await scanCurrentSelection();
});

rescanButton.addEventListener("click", async () => {
  await scanCurrentSelection();
});

exitButton.addEventListener("click", exitPlayer);

window.addEventListener("resize", () => {
  if (playerScreen.style.display === "block") {
    canvas.focus();
  }
});

renderLibrary();
