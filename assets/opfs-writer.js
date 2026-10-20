/**
 * noberu's file writer for unpacking (assets/library.js), run as a worker.
 *
 * It writes through sync access handles, which only a worker can open, rather
 * than the page's createWritable(). WebKit stages every createWritable() in a
 * temporary file, copies it into place on close() and never deletes the
 * temporary one, so a 4 GB game unpacked that way leaves another 4 GB behind
 * in the browser's temp folder (WebKit's FileSystemStorageHandle.cpp; 45 GB
 * of them piled up while testing this). A sync access handle writes the file
 * itself.
 *
 * Messages, each answered with { id } or { id, error, name } once done:
 *   { op: "root", dir }                     - the directory to write under
 *   { op: "open", file, path }              - create path (and its folders)
 *   { op: "write", file, at, bytes }        - bytes spans its whole buffer
 *   { op: "close", file } / { op: "abort", file }
 */
"use strict";

let root = null;
const dirs = new Map();
const files = new Map();

async function folder(path) {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (!dirs.has(parent)) {
    let dir = root;
    for (const part of parent.split("/")) {
      if (part) dir = await dir.getDirectoryHandle(part, { create: true });
    }
    dirs.set(parent, dir);
  }
  return dirs.get(parent);
}

async function run(m) {
  if (m.op === "root") {
    // Only workers see this method, so the page can't check for it itself.
    if (!("createSyncAccessHandle" in FileSystemFileHandle.prototype)) throw new Error("no sync access handles");
    root = m.dir;
    dirs.clear();
  } else if (m.op === "open") {
    // Every handle stays referenced from here until its call returns. Without
    // that, Chrome now and then never finished opening a file, and
    // unpacking stopped dead a few thousand files in (5 runs in 16; 0 in 20
    // with it), seemingly because the handle was collected mid-call.
    const parent = await folder(m.path);
    const handle = await parent.getFileHandle(m.path.split("/").pop(), { create: true });
    files.set(m.file, { handle, access: null });
    const access = await handle.createSyncAccessHandle();
    access.truncate(0);
    files.get(m.file).access = access;
  } else if (m.op === "write") {
    const { access } = files.get(m.file);
    let done = 0;
    while (done < m.bytes.length) {
      const n = access.write(m.bytes.subarray(done), { at: m.at + done });
      if (n <= 0) throw new Error("The browser stopped writing (is storage full?).");
      done += n;
    }
  } else if (m.op === "close" || m.op === "abort") {
    const { access } = files.get(m.file) || {};
    files.delete(m.file);
    if (access) {
      if (m.op === "close") access.flush();
      access.close();
    }
  }
}

// One message at a time, in order: an open's awaits must not let a write to
// that file go first.
let queue = Promise.resolve();
self.onmessage = (event) => {
  const m = event.data;
  queue = queue.then(() => run(m)).then(
    () => self.postMessage({ id: m.id }),
    (error) => self.postMessage({ id: m.id, error: String((error && error.message) || error), name: error && error.name }),
  );
};
