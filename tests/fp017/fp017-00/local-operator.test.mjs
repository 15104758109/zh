import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { databaseSchema, repositoryRoot, sql } from "../../../packages/db/src/database.mjs";
import {
  LOCAL_OPERATOR_ERRORS,
  assertObjectScope,
  loadOrCreateLocalOperator,
} from "../../../apps/api/src/features/fp017/fp017-00/local-operator.mjs";

const moduleUrl = pathToFileURL(path.join(repositoryRoot, "apps/api/src/features/fp017/fp017-00/local-operator.mjs")).href;
const OPERATOR = `operator:${randomUUID()}`;
const BOOK = "book:fp017-test";

function reset() {
  execFileSync(process.execPath, ["packages/db/src/reset.mjs"], { cwd: repositoryRoot, encoding: "utf8" });
}

function count() {
  return Number(sql(`SELECT count(*) FROM ${databaseSchema}.local_operators`).trim());
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code && error.message === code);
}

async function createEightWayBarrier() {
  const waiting = [];
  let readyCount = 0;
  const server = http.createServer((request, response) => {
    if (request.url !== "/ready") {
      response.writeHead(404).end();
      return;
    }
    readyCount += 1;
    waiting.push(response);
    if (readyCount === 8) {
      for (const pending of waiting) pending.end("release");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    readyUrl: `http://127.0.0.1:${address.port}/ready`,
    readyCount: () => readyCount,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function spawnBarrierWorker(script, events) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let pending = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) if (line) events.push(line);
  });
  return {
    child,
    complete: new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`worker failed: ${code}`)));
    }),
  };
}

before(() => reset());

test("01 first bootstrap creates one stable local operator", () => {
  const result = loadOrCreateLocalOperator();
  assert.match(result.local_operator_id, /^operator:[0-9a-f-]{36}$/);
  assert.equal(count(), 1);
});

test("02 restart loads the same local operator", () => {
  const first = loadOrCreateLocalOperator();
  const second = loadOrCreateLocalOperator();
  assert.deepEqual(second, first);
  assert.equal(count(), 1);
});

test("03 eight concurrent production-service subprocesses converge on one id", async (t) => {
  reset();
  const barrier = await createEightWayBarrier();
  t.after(async () => {
    await barrier.close();
  });
  const events = [];
  const script = `import { loadOrCreateLocalOperator } from ${JSON.stringify(moduleUrl)};
await fetch(${JSON.stringify(barrier.readyUrl)});
process.stdout.write("START\\n");
const result = loadOrCreateLocalOperator();
process.stdout.write(\`DONE \${result.local_operator_id}\\n\`);`;
  const workers = Array.from({ length: 8 }, () => spawnBarrierWorker(script, events));
  t.after(() => workers.forEach(({ child }) => child.kill()));
  let timer;
  try {
    await Promise.race([
      Promise.all(workers.map(({ complete }) => complete)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("eight-way barrier did not release")), 10_000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(barrier.readyCount(), 8, "all workers must wait before any production call is released");
  assert.deepEqual(events.slice(0, 8), Array(8).fill("START"), "every worker must enter the production call before any worker completes");
  const ids = events.filter((event) => event.startsWith("DONE ")).map((event) => event.slice("DONE ".length));
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 1);
  assert.equal(count(), 1);
});

test("04 SQL failure exposes only the stable bootstrap error", () => {
  reset();
  expectCode(() => loadOrCreateLocalOperator({
    sqlExecutor: (statement) => sql(statement.replace("COMMIT;", "SELECT 1 / 0;\nCOMMIT;")),
  }), LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);
  assert.equal(count(), 0);
});

test("05 SQL failure recovers on a later real call", () => {
  expectCode(() => loadOrCreateLocalOperator({ sqlExecutor: () => { throw new Error("failed"); } }), LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);
  assert.match(loadOrCreateLocalOperator().local_operator_id, /^operator:/);
  assert.equal(count(), 1);
});

test("06 UUID generation failure writes nothing and later recovers", () => {
  reset();
  expectCode(() => loadOrCreateLocalOperator({ createUuid: () => { throw new Error("failed"); } }), LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);
  assert.equal(count(), 0);
  assert.match(loadOrCreateLocalOperator().local_operator_id, /^operator:/);
  assert.equal(count(), 1);
});

test("07 updates are rejected by the database", () => {
  assert.throws(() => sql(`UPDATE ${databaseSchema}.local_operators SET local_operator_id = '${OPERATOR}'`), /local operator is immutable/);
});

test("08 deletes are rejected by the database", () => {
  assert.throws(() => sql(`DELETE FROM ${databaseSchema}.local_operators`), /local operator is immutable/);
  assert.equal(count(), 1);
});

test("09 local default scope has no book id", () => {
  assert.deepEqual(assertObjectScope({ expected: { local_operator_id: OPERATOR }, scope: { object_type: "local_operator", local_operator_id: OPERATOR } }), { local_operator_id: OPERATOR });
});

test("10 book scope matches its operator and book", () => {
  assert.deepEqual(assertObjectScope({ expected: { local_operator_id: OPERATOR, book_id: BOOK }, scope: { object_type: "book", local_operator_id: OPERATOR, book_id: BOOK } }), { local_operator_id: OPERATOR, book_id: BOOK });
});

test("11 chapter and run scopes match their operator and book", () => {
  for (const object_type of ["chapter", "run"]) {
    assert.deepEqual(assertObjectScope({ expected: { local_operator_id: OPERATOR, book_id: BOOK }, scope: { object_type, local_operator_id: OPERATOR, book_id: BOOK } }), { local_operator_id: OPERATOR, book_id: BOOK });
  }
});

test("12 malformed and unknown scope fields reject with zero writes", () => {
  const beforeCount = count();
  expectCode(() => assertObjectScope({ expected: { local_operator_id: OPERATOR }, scope: { object_type: "local_operator", local_operator_id: "not a stable id" } }), LOCAL_OPERATOR_ERRORS.SCOPE_INVALID);
  expectCode(() => assertObjectScope({ expected: { local_operator_id: OPERATOR }, scope: { object_type: "local_operator", local_operator_id: OPERATOR, token: "no" } }), LOCAL_OPERATOR_ERRORS.SCOPE_INVALID);
  assert.equal(count(), beforeCount);
});

test("13 missing book and wrong operator or book reject with zero writes", () => {
  const beforeCount = count();
  const expected = { local_operator_id: OPERATOR, book_id: BOOK };
  expectCode(() => assertObjectScope({ expected, scope: { object_type: "book", local_operator_id: OPERATOR } }), LOCAL_OPERATOR_ERRORS.SCOPE_MISMATCH);
  expectCode(() => assertObjectScope({ expected, scope: { object_type: "book", local_operator_id: "operator:other", book_id: BOOK } }), LOCAL_OPERATOR_ERRORS.SCOPE_MISMATCH);
  expectCode(() => assertObjectScope({ expected, scope: { object_type: "book", local_operator_id: OPERATOR, book_id: "book:other" } }), LOCAL_OPERATOR_ERRORS.SCOPE_MISMATCH);
  assert.equal(count(), beforeCount);
});

test("14 interaction contract covers bootstrap, recovery, and scope cases", () => {
  const source = readFileSync(path.join(repositoryRoot, "contracts/interactions/fp017-00.yaml"), "utf8");
  for (const caseId of ["first_bootstrap_create", "restart_load", "bootstrap_failure_retry_recovery", "scope_shape_invalid", "scope_mismatch"]) assert.match(source, new RegExp(`id: ${caseId}`));
  assert.match(source, /id: restart_load[\s\S]*?state_change: false/);
  assert.doesNotMatch(source, /RPC-001|\*/);
});
