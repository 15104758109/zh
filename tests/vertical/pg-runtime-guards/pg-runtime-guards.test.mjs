import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { databaseSchema, repositoryRoot, sql } from "../../../packages/db/src/database.mjs";
import { pgRuntimeGuards } from "../../../packages/db/src/runtime-guards/index.mjs";

const operator = "operator:11111111-1111-1111-1111-111111111111";
const tokenPattern = /^[0-9a-f]{64}$/;

function reset() {
  execFileSync(process.execPath, ["packages/db/src/reset.mjs"], { cwd: repositoryRoot, encoding: "utf8" });
}

function count(table, clause = "") {
  return Number(sql(`SELECT count(*) FROM ${databaseSchema}.${table} ${clause}`).trim());
}

function acquire(bookId, ttl = 30) {
  const result = pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: bookId, ttl_seconds: ttl });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

function write(lock, overrides = {}, options = {}) {
  return pgRuntimeGuards.guardedWrite({
    local_operator_id: operator,
    book_id: "book-write",
    entity_id: "run-main",
    expected_version: 0,
    holder_token: lock.holder_token,
    fence_version: lock.fence_version,
    operation: "formal-write",
    idempotency_key: "write-1",
    payload: "payload-one",
    state: "formal-one",
    result: "result-one",
    ...overrides,
  }, options);
}

function concurrentAcquire(bookId) {
  const worker = `import { pgRuntimeGuards } from ${JSON.stringify(new URL("../../../packages/db/src/runtime-guards/index.mjs", import.meta.url).href)}; process.stdout.write(JSON.stringify(pgRuntimeGuards.acquire({local_operator_id:${JSON.stringify(operator)},book_id:${JSON.stringify(bookId)},ttl_seconds:30})));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", worker], { cwd: repositoryRoot });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(error || `worker exited ${code}`));
      else resolve(JSON.parse(output));
    });
  });
}

before(() => {
  reset();
  sql(`INSERT INTO ${databaseSchema}.local_operators (local_operator_id) VALUES ('${operator}')`);
});

after(() => {
  reset();
  assert.equal(count("runtime_write_locks"), 0);
  assert.equal(count("runtime_idempotency_ledger"), 0);
  assert.equal(count("runtime_guarded_state"), 0);
  assert.equal(count("runtime_guard_audit_log"), 0);
});

test("first acquisition returns one opaque token and a positive fence", () => {
  const lock = acquire("book-first");
  assert.match(lock.holder_token, tokenPattern);
  assert.equal(lock.fence_version, 1);
});

test("eight concurrent writers for one book have one winner", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => concurrentAcquire("book-concurrent")));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.error.code === "LOCK_CONFLICT").length, 7);
});

test("different books acquire independently", () => {
  assert.equal(acquire("book-parallel-a").fence_version, 1);
  assert.equal(acquire("book-parallel-b").fence_version, 1);
});

test("renew validate and release use scope, token, and fence CAS", () => {
  const lock = acquire("book-lease");
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "book-lease", ...lock }).ok, true);
  assert.equal(pgRuntimeGuards.renew({ local_operator_id: operator, book_id: "book-lease", ...lock }).ok, true);
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "wrong-book", ...lock }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "book-lease", holder_token: "a".repeat(64), fence_version: lock.fence_version }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "book-lease", holder_token: lock.holder_token, fence_version: lock.fence_version + 1 }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.release({ local_operator_id: operator, book_id: "book-lease", ...lock }).ok, true);
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "book-lease", ...lock }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.release({ local_operator_id: operator, book_id: "book-lease", ...lock }).error.code, "LOCK_CONFLICT");
});

test("expired locks are fenced and stale holders remain rejected", async () => {
  const first = acquire("book-expiry", 1);
  await delay(1100);
  const second = acquire("book-expiry");
  assert.equal(second.fence_version, first.fence_version + 1);
  assert.equal(pgRuntimeGuards.renew({ local_operator_id: operator, book_id: "book-expiry", ...first }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "book-expiry", ...first }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.release({ local_operator_id: operator, book_id: "book-expiry", ...first }).error.code, "LOCK_CONFLICT");
  assert.equal(pgRuntimeGuards.validate({ local_operator_id: operator, book_id: "book-expiry", ...second }).ok, true);
});

test("idempotency stores one result and rejects payload or scope collisions", () => {
  const request = { local_operator_id: operator, book_id: "book-idempotent", operation: "formal-write", idempotency_key: "idem-key", payload: "request-one" };
  assert.equal(pgRuntimeGuards.claim(request).value.status, "IDEMPOTENCY_CLAIMED");
  assert.equal(pgRuntimeGuards.claim(request).value.status, "IDEMPOTENCY_PENDING");
  assert.equal(pgRuntimeGuards.finalize({ ...request, result: "the-result" }).value.status, "IDEMPOTENCY_FINALIZED");
  const replay = pgRuntimeGuards.claim(request);
  assert.equal(replay.value.status, "IDEMPOTENCY_REPLAY");
  assert.equal(replay.value.result, "the-result");
  assert.equal(pgRuntimeGuards.claim({ ...request, payload: "different" }).error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(pgRuntimeGuards.claim({ ...request, book_id: "other-book" }).error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(count("runtime_idempotency_ledger", "WHERE idempotency_key = 'idem-key'"), 1);
});

test("guarded write applies CAS once and stale versions leave zero partial rows", () => {
  const lock = acquire("book-write");
  const first = write(lock);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.state_version, 1);
  const replay = write(lock);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.replay, true);
  const stateBefore = count("runtime_guarded_state", "WHERE book_id = 'book-write'");
  const auditBefore = count("runtime_guard_audit_log", "WHERE book_id = 'book-write'");
  const stale = write(lock, { idempotency_key: "write-stale", payload: "payload-stale", expected_version: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "STALE_VERSION");
  assert.equal(count("runtime_guarded_state", "WHERE book_id = 'book-write'"), stateBefore);
  assert.equal(count("runtime_guard_audit_log", "WHERE book_id = 'book-write'"), auditBefore);
  assert.equal(count("runtime_idempotency_ledger", "WHERE idempotency_key = 'write-stale'"), 0);
});

test("every injected SQL failure rolls back state audit and result ledger, and errors are redacted", () => {
  const lock = acquire("book-failure");
  for (const stage of ["after_claim", "after_state", "after_audit", "after_finalize"]) {
    const key = `failure-${stage}`;
    const result = pgRuntimeGuards.guardedWrite({
      local_operator_id: operator, book_id: "book-failure", entity_id: `entity-${stage}`, expected_version: 0,
      holder_token: lock.holder_token, fence_version: lock.fence_version, operation: "formal-write",
      idempotency_key: key, payload: `payload-${stage}`, state: `state-${stage}`, result: `result-${stage}`,
    }, { fault_stage: stage });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INTERNAL_ERROR");
    assert.equal(result.error.message.includes("GUARD_"), false);
    assert.equal(result.error.message.includes(lock.holder_token), false);
    assert.equal(count("runtime_idempotency_ledger", `WHERE idempotency_key = '${key}'`), 0);
    assert.equal(count("runtime_guarded_state", `WHERE entity_id = 'entity-${stage}'`), 0);
    assert.equal(count("runtime_guard_audit_log", `WHERE idempotency_key = '${key}'`), 0);
  }
  const recovered = pgRuntimeGuards.guardedWrite({
    local_operator_id: operator, book_id: "book-failure", entity_id: "entity-recovered", expected_version: 0,
    holder_token: lock.holder_token, fence_version: lock.fence_version, operation: "formal-write",
    idempotency_key: "failure-recovered", payload: "payload-recovered", state: "state-recovered", result: "result-recovered",
  });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
});

test("unknown fields and malformed values fail closed", () => {
  assert.equal(pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: "book-invalid", ttl_seconds: 30, extra: true }).error.code, "INPUT_INVALID");
  assert.equal(pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: "book-invalid", ttl_seconds: 301 }).error.code, "INPUT_INVALID");
});
