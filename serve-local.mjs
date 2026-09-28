import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const root = new URL(".", import.meta.url).pathname;
const preferredPort = Number(process.env.PORT || 4175);
const host = process.env.HOST || "0.0.0.0";

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface.address);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".zip": "application/zip",
};

function resolvePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath);
  if (filePath.endsWith("/")) filePath = join(filePath, "index.html");
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  return filePath;
}

function createPlayServer() {
  return createServer((request, response) => {
    const filePath = resolvePath(request.url || "/");
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Origin-Agent-Cluster": "?1",
    });
    createReadStream(filePath).pipe(response);
  });
}

function listen(port) {
  const server = createPlayServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      listen(port + 1);
      return;
    }
    throw error;
  });

  // Bound to every interface so a phone or tablet on the same network can
  // reach it, which is the only way to check the mobile layout on real
  // hardware. HOST overrides it (HOST=127.0.0.1 to keep it local-only).
  server.listen(port, host, () => {
    console.log(`noberu local server: http://localhost:${port}/`);
    if (host === "0.0.0.0") {
      for (const address of lanAddresses()) {
        console.log(`  on this network:      http://${address}:${port}/`);
      }
    }
  });
}

listen(preferredPort);
