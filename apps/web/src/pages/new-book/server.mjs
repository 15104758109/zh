import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4176);
const N8N_BASE_URL = process.env.N8N_BASE_URL || "http://127.0.0.1:5678";
const PAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const ASSETS = new Map([
  ["new_book_wizard_data.js", "application/javascript; charset=utf-8"],
  ["new-book-bridge.mjs", "application/javascript; charset=utf-8"],
]);

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function assetName(pathname) {
  const match = pathname.match(/^\/books(?:\/new)?\/([^/]+)$/);
  if (!match) return null;
  const name = decodeURIComponent(match[1]);
  return name === basename(name) && ASSETS.has(name) ? name : null;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyCreateBook(request, response) {
  try {
    const body = await readBody(request);
    const upstream = await fetch(new URL("/webhook/create_book", N8N_BASE_URL), {
      method: "POST",
      headers: {
        "content-type": request.headers["content-type"] || "application/json",
        accept: request.headers.accept || "application/json",
      },
      body,
    });
    const payload = Buffer.from(await upstream.arrayBuffer());
    send(response, upstream.status, payload, upstream.headers.get("content-type") || "application/json; charset=utf-8");
  } catch {
    send(response, 502, JSON.stringify({ error: { code: "CREATE_BOOK_UNAVAILABLE", message: "创建服务暂不可用。" } }));
  }
}

const server = createServer(async (request, response) => {
  const origin = `http://${request.headers.host || `${HOST}:${PORT}`}`;
  let pathname;
  try {
    pathname = new URL(request.url || "/", origin).pathname;
  } catch {
    send(response, 400, JSON.stringify({ error: { code: "BAD_REQUEST", message: "请求无效。" } }));
    return;
  }

  if (request.method === "POST" && pathname === "/webhook/create_book") {
    await proxyCreateBook(request, response);
    return;
  }
  if (request.method === "GET" && (pathname === "/books/new" || pathname === "/books/new/")) {
    send(response, 200, await readFile(join(PAGE_DIR, "index.html")), "text/html; charset=utf-8");
    return;
  }
  const asset = request.method === "GET" && assetName(pathname);
  if (asset) {
    send(response, 200, await readFile(join(PAGE_DIR, asset)), ASSETS.get(asset));
    return;
  }
  send(response, 404, JSON.stringify({ error: { code: "NOT_FOUND", message: "资源不存在。" } }));
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`new-book server listening on http://${HOST}:${PORT}/books/new\n`);
});
