import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4176);
const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8" };

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, { "cache-control": "no-store", "content-type": type });
  response.end(body);
}

async function serveFile(response, relative) {
  const file = join(root, relative);
  try {
    send(response, 200, await readFile(file), types[extname(file)] || "application/octet-stream");
  } catch {
    send(response, 404, JSON.stringify({ error: "NOT_FOUND" }));
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
  const pathname = url.pathname;
  if (request.method !== "GET") return send(response, 405, JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
  if (pathname.startsWith("/assets/") || pathname.startsWith("/app/") || pathname.startsWith("/components/") || pathname.startsWith("/pages/")) {
    const relative = normalize(`.${pathname}`).replace(/^\.?[\\/]+/, "");
    if (relative.includes("..")) return send(response, 400, JSON.stringify({ error: "BAD_PATH" }));
    return serveFile(response, relative);
  }
  return serveFile(response, "app/index.html");
}).listen(port, host, () => process.stdout.write(`web server listening on http://${host}:${port}/workbench\n`));
