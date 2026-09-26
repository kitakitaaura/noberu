// Dev only. Both Ren'Py runtime pages accept ?autoload=<name>, which boots the
// folder symlinked at ./<name> over plain HTTP using the "<size> <path>" lines
// in <name>_filelist.txt (paths relative to that folder) - the same convention
// the other runtimes use.
//
// Unlike a picked folder, this downloads every file up front, so it uses more
// memory than the real path does. Fine for a test game, not for a real one.

(function (global) {
  "use strict";

  async function load(name) {
    const list = await (await fetch(`${name}_filelist.txt`)).text();
    const base = new URL(`${name}/`, location.href);
    const files = [];

    for (const line of list.split("\n").filter(Boolean)) {
      const path = line.slice(line.indexOf(" ") + 1);
      const url = new URL(path.split("/").map(encodeURIComponent).join("/"), base).href;
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], path.split("/").pop());
      // The picker sets this; staging reads it to work out each file's path.
      Object.defineProperty(file, "webkitRelativePath", { value: `${name}/${path}` });
      files.push(file);
    }
    return files;
  }

  global.NoberuRenPyDev = { load: load };
})(window);
