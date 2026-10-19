/**
 * Cover art for the game shelf (assets/shelf.js), found in a game's own files.
 *
 *   NoberuCovers.fromFiles(files, engine) -> { blob, source, fit } | null
 *   NoberuCovers.shrink(blob, maxWidth)   -> a JPEG no wider than maxWidth
 *   NoberuCovers.isBlank(blob)            -> true for an all-black/flat frame
 *
 * `files` is what every runtime is handed: File objects carrying
 * webkitRelativePath ("Game Name/path/inside"). Nothing is uploaded anywhere;
 * this only reads the files already picked.
 *
 * In order of preference:
 *   1. the engine's own title image: RPG Maker's title1 (decrypted when the
 *      game is encrypted), Ren'Py's gui/main_menu, Tyrano's title background,
 *      VNDS's thumbnail
 *   2. a loose image whose name says it is key art (cover, title, keyvisual...)
 *   3. the icon inside the game's .exe, shown on a blurred copy of itself
 * Engines that pack everything into archives (KiriKiri, Siglus, RealLive,
 * NScripter) usually have none of 1 or 2; the shelf captures their title
 * screen while they run instead.
 */
(function () {
  "use strict";

  const IMAGE = /\.(png|jpe?g|webp|bmp)$/i;

  // "Game Name/www/img/titles1/Book.png" -> "www/img/titles1/book.png"
  function index(files) {
    const map = new Map();
    for (const file of files) {
      const full = file.webkitRelativePath || file.name;
      const cut = full.indexOf("/");
      const path = (cut < 0 ? full : full.slice(cut + 1)).toLowerCase();
      map.set(path, file);
    }
    return map;
  }

  function findBySuffix(map, suffix) {
    suffix = suffix.toLowerCase();
    let best = null;
    for (const [path, file] of map) {
      if (path === suffix || path.endsWith("/" + suffix)) {
        if (!best || path.length < best[0].length) best = [path, file];
      }
    }
    return best ? best[1] : null;
  }

  async function readText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Tyrano and RPG Maker files are UTF-8, sometimes with a BOM.
    return new TextDecoder("utf-8").decode(bytes);
  }

  // --- 1. engine title images --------------------------------------------------

  // RPG Maker MV/MZ: data/System.json names the title picture. Encrypted games
  // (.rpgmvp / .png_) have a 16-byte header and their first 16 bytes XORed
  // with System.json's encryptionKey.
  async function rpgmaker(map) {
    const system = findBySuffix(map, "data/system.json");
    if (!system) return null;
    let json;
    try {
      json = JSON.parse((await readText(system)).replace(/^﻿/, ""));
    } catch (error) {
      return null;
    }
    const name = (json.title1Name || "").toLowerCase();
    if (!name) return null;
    const plain = findBySuffix(map, `img/titles1/${name}.png`);
    if (plain) return plain;
    const locked = findBySuffix(map, `img/titles1/${name}.rpgmvp`) ||
      findBySuffix(map, `img/titles1/${name}.png_`);
    if (!locked || !json.encryptionKey) return null;
    const key = json.encryptionKey.match(/../g).map((h) => parseInt(h, 16));
    const bytes = new Uint8Array(await locked.arrayBuffer());
    if (bytes.length < 33) return null;
    const out = bytes.slice(16);
    for (let i = 0; i < 16; i++) out[i] ^= key[i];
    return new Blob([out], { type: "image/png" });
  }

  // Ren'Py: the main menu background, when it is a loose file.
  function renpy(map) {
    return findBySuffix(map, "game/gui/main_menu.png") ||
      findBySuffix(map, "game/gui/main_menu.jpg") ||
      findBySuffix(map, "game/gui/main_menu.webp") ||
      findBySuffix(map, "gui/main_menu.png");
  }

  // TyranoScript: the first background title.ks shows.
  async function tyrano(map) {
    const title = findBySuffix(map, "data/scenario/title.ks") ||
      findBySuffix(map, "data/scenario/title_screen.ks");
    if (title) {
      const text = await readText(title);
      const match = text.match(/\[(?:bg|image)[^\]]*?storage\s*=\s*"?([^"\s\]]+)/i);
      if (match) {
        const name = match[1].toLowerCase();
        const found = findBySuffix(map, `data/bgimage/${name}`) ||
          findBySuffix(map, `data/fgimage/${name}`) ||
          findBySuffix(map, `data/image/${name}`);
        if (found) return found;
      }
    }
    for (const [path, file] of map) {
      if (/data\/(bgimage|image)\/[^/]*title[^/]*\.(png|jpe?g|webp)$/.test(path)) return file;
    }
    return null;
  }

  function vnds(map) {
    return findBySuffix(map, "thumbnail.png") || findBySuffix(map, "icon-high.png");
  }

  // --- 2. loose key art -----------------------------------------------------------

  const KEY_ART = /(^|[\/_\- ])(cover|title|key[_ -]?visual|keyart|kv|main[_ -]?menu|mainmenu|header|capsule|banner|package|jacket)[^\/]*\.(png|jpe?g|webp)$/;

  function looseArt(map) {
    let best = null;
    for (const [path, file] of map) {
      if (path.split("/").length > 3 || !KEY_ART.test(path)) continue;
      if (file.size < 20 * 1024) continue;
      if (!best || file.size > best.size) best = file;
    }
    return best;
  }

  // --- 3. the .exe's icon -----------------------------------------------------------

  const NOT_THE_GAME = /(unins|setup|install|config|launcher|crash|redist|dxsetup|notification_helper|unitycrashhandler|vc_?redist|dotnet|python|pythonw|zsync|update)/i;

  function pickExe(map) {
    const exes = [...map].filter(([path]) => /\.exe$/.test(path) &&
      path.split("/").length <= 2 && !NOT_THE_GAME.test(path.split("/").pop()));
    exes.sort((a, b) => a[0].split("/").length - b[0].split("/").length || b[1].size - a[1].size);
    return exes.length ? exes[0][1] : null;
  }

  async function exeIcon(file) {
    const head = new DataView(await file.slice(0, 4096).arrayBuffer());
    if (head.byteLength < 64 || head.getUint16(0, true) !== 0x5a4d) return null;
    const pe = head.getUint32(0x3c, true);
    if (pe + 24 > head.byteLength || head.getUint32(pe, true) !== 0x4550) return null;
    const sections = head.getUint16(pe + 6, true);
    const optSize = head.getUint16(pe + 20, true);
    const opt = pe + 24;
    const magic = head.getUint16(opt, true);
    const dirs = opt + (magic === 0x20b ? 112 : 96);
    if (dirs + 24 > head.byteLength) return null;
    const rsrcRva = head.getUint32(dirs + 16, true);
    if (!rsrcRva) return null;

    // The section holding the resources, read whole (icons are small, but the
    // directory points all over it).
    let section = null;
    for (let i = 0; i < sections; i++) {
      const at = opt + optSize + i * 40;
      if (at + 40 > head.byteLength) break;
      const va = head.getUint32(at + 12, true);
      const vsize = Math.max(head.getUint32(at + 8, true), head.getUint32(at + 16, true));
      if (rsrcRva >= va && rsrcRva < va + vsize) {
        section = { va, raw: head.getUint32(at + 20, true), size: head.getUint32(at + 16, true) };
        break;
      }
    }
    if (!section || section.size > 48 * 1024 * 1024) return null;
    const buf = new DataView(await file.slice(section.raw, section.raw + section.size).arrayBuffer());
    const base = rsrcRva - section.va;
    const at = (rva) => rva - section.va;

    const entries = (dirOffset) => {
      const off = base + dirOffset;
      const count = buf.getUint16(off + 12, true) + buf.getUint16(off + 14, true);
      const out = [];
      for (let i = 0; i < count; i++) {
        const e = off + 16 + i * 8;
        out.push({ id: buf.getUint32(e, true), to: buf.getUint32(e + 4, true) });
      }
      return out;
    };
    // type -> name/id -> first language -> data entry
    const leaf = (entry) => {
      let to = entry.to;
      while (to & 0x80000000) {
        const next = entries(to & 0x7fffffff)[0];
        if (!next) return null;
        to = next.to;
      }
      const d = base + to;
      return { offset: at(buf.getUint32(d, true)), size: buf.getUint32(d + 4, true) };
    };
    const byType = (type) => {
      const t = entries(0).find((e) => e.id === type);
      return t && (t.to & 0x80000000) ? entries(t.to & 0x7fffffff) : [];
    };

    const groups = byType(14);   // RT_GROUP_ICON
    const icons = byType(3);     // RT_ICON
    if (!groups.length || !icons.length) return null;
    const group = leaf(groups[0]);
    if (!group) return null;
    const count = buf.getUint16(group.offset + 4, true);
    let best = null;
    for (let i = 0; i < count; i++) {
      const e = group.offset + 6 + i * 14;
      const width = buf.getUint8(e) || 256;
      const bits = buf.getUint16(e + 6, true);
      const id = buf.getUint16(e + 12, true);
      if (!best || width > best.width || (width === best.width && bits > best.bits)) {
        best = { width, height: buf.getUint8(e + 1) || 256, bits, id, colors: buf.getUint8(e + 2) };
      }
    }
    const iconEntry = best && icons.find((e) => e.id === best.id);
    const data = iconEntry && leaf(iconEntry);
    if (!data) return null;
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset + data.offset, data.size).slice();
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return new Blob([bytes], { type: "image/png" });

    // A bare DIB: wrap it as a one-image .ico, which browsers can decode.
    const ico = new Uint8Array(22 + bytes.length);
    const v = new DataView(ico.buffer);
    v.setUint16(2, 1, true);
    v.setUint16(4, 1, true);
    ico[6] = best.width >= 256 ? 0 : best.width;
    ico[7] = best.height >= 256 ? 0 : best.height;
    ico[8] = best.colors;
    v.setUint16(10, 1, true);
    v.setUint16(12, best.bits, true);
    v.setUint32(14, bytes.length, true);
    v.setUint32(18, 22, true);
    ico.set(bytes, 22);
    return new Blob([ico], { type: "image/x-icon" });
  }

  // --- images ---------------------------------------------------------------------

  async function decode(blob) {
    try {
      return await createImageBitmap(blob);
    } catch (error) {
      // .ico and a few others only decode through an <img>.
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function shrink(blob, maxWidth = 640, type = "image/jpeg") {
    const image = await decode(blob);
    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w || !h) throw new Error("not an image");
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (image.close) image.close();
    return canvasToBlob(canvas, type, 0.86);
  }

  // A logo fade, a loading screen or a cleared WebGL buffer: nearly one flat
  // colour all over.
  async function isBlank(blob) {
    try {
      const image = await decode(blob);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      let sum = 0;
      let sq = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        sum += l;
        sq += l * l;
      }
      const mean = sum / n;
      const variance = sq / n - mean * mean;
      return variance < 60;
    } catch (error) {
      return true;
    }
  }

  async function fromFiles(files, engine) {
    const map = index(files);
    let found = null;
    try {
      if (engine === "rpgmaker") found = await rpgmaker(map);
      else if (engine === "renpy") found = renpy(map);
      else if (engine === "tyrano") found = await tyrano(map);
      else if (engine === "vnds") found = vnds(map);
      if (!found) found = looseArt(map);
      if (found) {
        const blob = await shrink(found, 640);
        if (blob && !(await isBlank(blob))) return { blob, source: "files", fit: "cover" };
      }
    } catch (error) {
      console.warn("noberu: no cover from the game's images", error);
    }
    try {
      const exe = pickExe(map);
      const icon = exe && await exeIcon(exe);
      if (icon) {
        const blob = await shrink(icon, 256, "image/png");
        if (blob) return { blob, source: "icon", fit: "icon" };
      }
    } catch (error) {
      console.warn("noberu: no icon in the game's .exe", error);
    }
    return null;
  }

  window.NoberuCovers = { fromFiles, shrink, isBlank, exeIcon };
})();
