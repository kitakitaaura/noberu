class DiscImageDevice {
  constructor(module) {
    this.module = module;
    this.doneFlag = false;
    this.file = null;
  }

  read(dstPtr, offset, size) {
    if (!this.file) {
      throw new Error("No disc image file set.");
    }

    this.doneFlag = false;
    const subsection = this.file.slice(offset, offset + size);
    subsection.arrayBuffer().then((value) => {
      this.module.HEAPU8.set(new Uint8Array(value), dstPtr);
      this.doneFlag = true;
    });
  }

  getFileSize() {
    if (!this.file) {
      throw new Error("No disc image file set.");
    }

    return this.file.size;
  }

  isDone() {
    return this.doneFlag;
  }

  setFile(file) {
    this.file = file;
  }
}

let playModule = null;
let initPromise = null;

function localUrl(path) {
  return new URL(path, import.meta.url).href;
}

async function assetExists(path) {
  try {
    const response = await fetch(localUrl(path), {
      method: "HEAD",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getRuntimeStatus() {
  const [hasJs, hasWasm] = await Promise.all([
    assetExists("Play.js"),
    assetExists("Play.wasm"),
  ]);

  return {
    hasJs,
    hasWasm,
    ready: Boolean(playModule),
    crossOriginIsolated: window.crossOriginIsolated,
  };
}

export async function initPlayRuntime({ onStatus = () => { } } = {}) {
  if (playModule) {
    return playModule;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const status = await getRuntimeStatus();
    if (!status.hasJs || !status.hasWasm) {
      throw new Error("Missing local Play.js/Play.wasm artifacts in outputs/play-runtime/.");
    }

    if (!window.crossOriginIsolated) {
      throw new Error("Play! requires cross-origin isolation. Start this site with: node outputs/serve-local.mjs");
    }

    onStatus("loading Play.js module");
    const playFactoryModule = await import(localUrl("Play.js"));
    const Play = playFactoryModule.default || playFactoryModule.Play || playFactoryModule;

    onStatus("initializing Play! VM");
    const moduleOverrides = {
      locateFile(path) {
        return localUrl(path);
      },
      mainScriptUrlOrBlob: localUrl("Play.js"),
    };

    playModule = await Play(moduleOverrides);
    try {
      playModule.FS.mkdir("/work");
    } catch {
      // The directory can already exist after a hot reload or repeated init.
    }
    playModule.discImageDevice = new DiscImageDevice(playModule);
    playModule.ccall("initVm", "", [], []);

    // --- persistence for PS2 memory cards / states / input profiles ---
    // Must run AFTER initVm(), which is what creates this directory tree in
    // the first place (mc0/mc1/states/inputprofiles all live under here).
    const DATA_ROOT = "/home/web_user/.local/share/Play Data Files";
    try {
      playModule.FS.mount(playModule.IDBFS, {}, DATA_ROOT);
      await new Promise((resolve, reject) => {
        playModule.FS.syncfs(true, (err) => (err ? reject(err) : resolve()));
        console.log("Post-mount check:", playModule.FS.readdir(DATA_ROOT));
        try {
          console.log("vfs check:", playModule.FS.readdir(`${DATA_ROOT}/vfs`));
        } catch (e) {
          console.log("vfs missing:", e.message);
        }
      });

      for (const sub of ["vfs/mc0", "vfs/mc1", "vfs/states", "vfs/inputprofiles"]) {
        try {
          playModule.FS.mkdirTree(`${DATA_ROOT}/${sub}`);
        } catch {
          // already exists — fine
        }
      }

      onStatus("loaded saved data from IndexedDB");
    } catch (e) {
      console.error("Failed to mount/sync IDBFS:", e);
    }
    // --- end persistence setup ---

    onStatus("Play! VM initialized");
    return playModule;
  })();

  return initPromise;
}

export async function bootFile(file, { onStatus = () => { } } = {}) {
  const module = await initPlayRuntime({ onStatus });
  const fileName = file.name;
  const fileDotPos = fileName.lastIndexOf(".");

  if (fileDotPos === -1) {
    throw new Error("File name must have an extension.");
  }

  const fileExtension = fileName.substring(fileDotPos).toLowerCase();
  if (fileExtension === ".elf") {
    onStatus(`copying ${fileName} into Play! filesystem`);
    const data = new Uint8Array(await file.arrayBuffer());
    const path = `/work/${fileName}`;
    const stream = module.FS.open(path, "w+");
    module.FS.write(stream, data, 0, data.length, 0);
    module.FS.close(stream);
    module.bootElf(path);
    onStatus(`booted ELF: ${fileName}`);
    return;
  }

  onStatus(`mounting disc image: ${fileName}`);
  module.discImageDevice.setFile(file);
  module.bootDiscImage(fileName);
  onStatus(`booted disc image: ${fileName}`);
}

export async function flushSaves() {
  if (!playModule) return;
  await new Promise((resolve, reject) => {
    playModule.FS.syncfs(false, (err) => (err ? reject(err) : resolve()));
  });
}

export function pulseKey(code) {
  const keyMap = {
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    KeyA: "a",
    KeyS: "s",
    KeyX: "x",
    KeyZ: "z",
    KeyF: "f",
    KeyH: "h",
    KeyT: "t",
    KeyG: "g",
    KeyJ: "j",
    KeyL: "l",
    KeyI: "i",
    KeyK: "k",
    Enter: "Enter",
    Backspace: "Backspace",
    Key1: "1",
    Key2: "2",
    Key3: "3",
    Key8: "8",
    Key9: "9",
    Key0: "0",
  };
  const key = keyMap[code] || code;
  const canvas = document.querySelector("#outputCanvas");
  canvas?.focus();

  ["keydown", "keyup"].forEach((type, index) => {
    window.setTimeout(() => {
      const event = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
      });
      canvas?.dispatchEvent(event);
      window.dispatchEvent(event);
      document.dispatchEvent(event);
    }, index * 90);
  });
}