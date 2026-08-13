import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/app/server.mjs", import.meta.url));

test("PostgreSQL bridge has a bounded child-process lifetime", async () => {
  const source = await readFile(serverPath, "utf8");
  assert.match(source, /const POSTGRES_COMMAND_TIMEOUT_MS = 10_000/);
  assert.match(source, /function terminateChildTree\(child\)/);
  assert.match(source, /execFile\("taskkill", \["\/PID", String\(child\.pid\), "\/T", "\/F"\]/);
  assert.match(source, /terminateChildTree\(child\);\s*reject\(new Error\(`\$\{operation\} timed out`\)\)/);
  assert.match(source, /error\?\.message === "REQUEST_TOO_LARGE" \? "REQUEST_TOO_LARGE" : "RPC_UNAVAILABLE"/);
});

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), ...env },
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

test("operator bootstrap reaches PostgreSQL through the existing ZH00 webhook", async () => {
  const operatorId = "11111111-1111-4111-8111-111111111111";
  const requests = [];
  const workflow = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, body: JSON.parse(body) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ route: "respond", result: { ok: true, local_operator_id: operatorId } }));
  });
  await new Promise((resolve) => workflow.listen(0, "127.0.0.1", resolve));
  const workflowPort = workflow.address().port;
  const port = 41_000 + Math.floor(Math.random() * 1_000);
  const child = await startServer(port, {
    WORKBENCH_WEBHOOK_URL: `http://127.0.0.1:${workflowPort}/webhook/workbench`,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/skill-library`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "operator" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, local_operator_id: operatorId });
    assert.deepEqual(requests, [{ method: "POST", url: "/webhook/workbench", body: { action: "operator" } }]);
  } finally {
    child.kill();
    await new Promise((resolve) => workflow.close(resolve));
  }
});

test("malformed deduction path returns 400 without terminating the server", async () => {
  const port = 42_000 + Math.floor(Math.random() * 1_000);
  const child = await startServer(port);
  try {
    const malformed = await fetch(`http://127.0.0.1:${port}/api/books/%E0%A4%A/deduction?local_operator_id=bad`);
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).redacted_error.code, "INVALID_BOOK_CONTEXT");

    const followUp = await fetch(`http://127.0.0.1:${port}/workbench`);
    assert.equal(followUp.status, 200);
  } finally {
    child.kill();
  }
});

test("malformed audit path returns 400 without reaching the PostgreSQL projection", async () => {
  const port = 43_100 + Math.floor(Math.random() * 1_000);
  const child = await startServer(port);
  try {
    const malformed = await fetch(`http://127.0.0.1:${port}/api/books/%E0%A4%A/audit?local_operator_id=bad&chapter_id=bad&chapter_version_id=bad`);
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).redacted_error.code, "INVALID_AUDIT_CONTEXT");

    const followUp = await fetch(`http://127.0.0.1:${port}/workbench`);
    assert.equal(followUp.status, 200);
  } finally {
    child.kill();
  }
});

test("canonical book routes deliver their page and ESM context gate without HTML fallback", async () => {
  const port = 43_000 + Math.floor(Math.random() * 1_000);
  const child = await startServer(port);
  try {
    for (const path of [
      "/books/new",
      "/books/00000000-0000-4000-8000-000000000000/world",
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
    }

    const module = await fetch(`http://127.0.0.1:${port}/pages/prototype/common/book-context.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get("content-type") || "", /application\/javascript/);
    assert.match(await module.text(), /readMatchingBookContext/);
  } finally {
    child.kill();
  }
});
