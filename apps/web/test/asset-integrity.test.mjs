import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/app/server.mjs", import.meta.url));
const bookId = "00000000-0000-4000-8000-000000000001";
const routes = [
  "/workbench",
  "/skill_library.html",
  "/books/new",
  `/books/${bookId}/world`,
  `/books/${bookId}/characters`,
  `/books/${bookId}/l1a`,
  `/books/${bookId}/production`,
  `/books/${bookId}/deduction`,
  `/books/${bookId}/deduction-review`,
  `/books/${bookId}/audit`,
  `/books/${bookId}/iteration`,
];

function startServer(port) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("web server did not start")), 10_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`web server exited before startup (${code})`));
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("web server listening")) return;
      clearTimeout(timeout);
      resolve(child);
    });
  });
}

function resourceUrls(document, routeUrl) {
  const baseMatch = document.match(/<base\s+href="([^"]+)"/i);
  const baseUrl = new URL(baseMatch?.[1] || routeUrl, routeUrl);
  const values = [];
  for (const match of document.matchAll(/<(?:script|img)\b[^>]*\bsrc="([^"]+)"[^>]*>|<link\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
    const value = match[1] || match[2];
    if (!value || value.startsWith("data:") || value.startsWith("#")) continue;
    values.push(new URL(value.replaceAll("&amp;", "&"), baseUrl));
  }
  return values;
}

test("every canonical page loads all local CSS, script, image, and font entry assets", async () => {
  const port = 43_000 + Math.floor(Math.random() * 1_000);
  const child = await startServer(port);
  const origin = `http://127.0.0.1:${port}`;
  try {
    const failures = [];
    for (const route of routes) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, `${route} must load`);
      const document = await response.text();
      assert.match(document, /\/vendor\/font-fallback\.css/, `${route} must load the local icon font`);
      for (const resource of resourceUrls(document, `${origin}${route}`)) {
        if (resource.origin !== origin) {
          failures.push(`${route} retains remote resource ${resource.href}`);
          continue;
        }
        const assetResponse = await fetch(resource);
        if (assetResponse.status !== 200) failures.push(`${route} -> ${resource.pathname} returned ${assetResponse.status}`);
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    child.kill();
  }
});
