import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import Ajv2020 from "../../../packages/contracts/node_modules/ajv/dist/2020.js";

import { databaseSchema, repositoryRoot, sql } from "../../../packages/db/src/database.mjs";
import { pgRuntimeGuards } from "../../../packages/db/src/runtime-guards/index.mjs";

const operator = "operator:11111111-1111-1111-1111-111111111111";
const tokenPattern = /^[0-9a-f]{64}$/;
const functionNames = ["runtime_guard_acquire", "runtime_guard_renew", "runtime_guard_validate", "runtime_guard_release", "runtime_guarded_write"];

function reset() {
  execFileSync(process.execPath, ["packages/db/src/reset.mjs"], { cwd: repositoryRoot, encoding: "utf8" });
}

function seedOperator() {
  sql(`INSERT INTO ${databaseSchema}.local_operators (local_operator_id) VALUES ('${operator}')`);
}

function count(table, clause = "") {
  return Number(sql(`SELECT count(*) FROM ${databaseSchema}.${table} ${clause}`).trim());
}

function acquire(bookId, ttl = 30) {
  const result = pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: bookId, ttl_seconds: ttl });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

function write(lock, overrides = {}) {
  return pgRuntimeGuards.guardedWrite({
    local_operator_id: operator, book_id: "book-write", entity_id: "run-main", expected_version: 0,
    holder_token: lock.holder_token, fence_version: lock.fence_version, operation: "formal-write",
    idempotency_key: "write-1", payload: "payload-one", state: "formal-one", result: "result-one", ...overrides,
  });
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
    child.on("close", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error || `worker exited ${code}`)));
  });
}

function temporaryFailure(stage, callback) {
  const names = {
    after_claim: ["runtime_idempotency_ledger", "BEFORE INSERT"],
    after_state: ["runtime_guarded_state", "BEFORE INSERT"],
    after_audit: ["runtime_guard_audit_log", "BEFORE INSERT"],
    after_finalize: ["runtime_idempotency_ledger", "BEFORE UPDATE OF result"],
  };
  const [table, timing] = names[stage];
  const functionName = `test_guard_fail_${stage}`;
  const triggerName = `test_guard_fail_trigger_${stage}`;
  sql(`CREATE FUNCTION ${databaseSchema}.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $test$ BEGIN RAISE EXCEPTION 'test guard failure'; END; $test$;
CREATE TRIGGER ${triggerName} ${timing} ON ${databaseSchema}.${table} FOR EACH ROW EXECUTE FUNCTION ${databaseSchema}.${functionName}();`);
  try {
    callback();
  } finally {
    sql(`DROP TRIGGER IF EXISTS ${triggerName} ON ${databaseSchema}.${table}; DROP FUNCTION IF EXISTS ${databaseSchema}.${functionName}();`);
  }
}

before(() => {
  reset();
  seedOperator();
});

after(() => {
  reset();
  assert.equal(count("runtime_write_locks"), 0);
  assert.equal(count("runtime_idempotency_ledger"), 0);
  assert.equal(count("runtime_guarded_state"), 0);
  assert.equal(count("runtime_guard_audit_log"), 0);
  assert.equal(Number(sql(`SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'test_guard_fail_%'`).trim()), 0);
  assert.equal(Number(sql(`SELECT count(*) FROM pg_proc WHERE proname LIKE 'test_guard_fail_%'`).trim()), 0);
});

test("only five production APIs are exported and invalid extra arguments fail closed", () => {
  assert.deepEqual(Object.keys(pgRuntimeGuards).sort(), ["acquire", "guardedWrite", "release", "renew", "validate"]);
  const lock = acquire("book-extra-argument");
  assert.equal(pgRuntimeGuards.guardedWrite({
    local_operator_id: operator, book_id: "book-extra-argument", entity_id: "extra-argument", expected_version: 0,
    holder_token: lock.holder_token, fence_version: lock.fence_version, operation: "formal-write",
    idempotency_key: "extra-argument", payload: "payload", state: "state", result: "result", fault_stage: "after_state",
  }).error.code, "INPUT_INVALID");
});

test("all five contracts are closed and match production request and response shapes", async () => {
  const { pgRuntimeGuardContracts, pgRuntimeGuardErrorSchema } = await import("../../../packages/contracts/dist/src/pg-runtime-guards/index.js");
  const ajv = new Ajv2020({ strict: true });
  const lockRequest = { local_operator_id: operator, book_id: "book-contract", ttl_seconds: 30 };
  const lockResponse = { fence_version: 1, holder_token: "a".repeat(64) };
  const leaseRequest = { local_operator_id: operator, book_id: "book-contract", holder_token: "a".repeat(64), fence_version: 1 };
  const writeRequest = { ...leaseRequest, entity_id: "run-contract", expected_version: 0, operation: "formal-write", idempotency_key: "contract-key", payload: "payload", state: "state", result: "result" };
  const cases = [
    ["acquire", lockRequest, lockResponse], ["renew", leaseRequest, { renewed: true }], ["validate", leaseRequest, { valid: true }], ["release", leaseRequest, { released: true }], ["guardedWrite", writeRequest, { state_version: 1, result: "result" }],
  ];
  for (const [operation, request, response] of cases) {
    const contract = pgRuntimeGuardContracts[operation];
    assert.equal(ajv.compile(contract.request)(request), true, operation);
    assert.equal(ajv.compile(contract.response)(response), true, operation);
    assert.equal(ajv.compile(contract.request)({ ...request, extra: true }), false, `${operation} request closure`);
    assert.equal(ajv.compile(contract.response)({ ...response, extra: true }), false, `${operation} response closure`);
  }
  assert.equal(ajv.compile(pgRuntimeGuardErrorSchema)({ code: "INTERNAL_ERROR", message: "The guarded write could not be completed." }), true);
  assert.equal(ajv.compile(pgRuntimeGuardErrorSchema)({ code: "INTERNAL_ERROR", message: "x", raw: "forbidden" }), false);
});

test("guard functions deny PUBLIC execution while the owner retains it", () => {
  const rows = sql(`SELECT proname, has_function_privilege('public', p.oid, 'EXECUTE'), has_function_privilege(current_user, p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'zhreplan' AND proname IN ('runtime_guard_acquire', 'runtime_guard_renew', 'runtime_guard_validate', 'runtime_guard_release', 'runtime_guarded_write') ORDER BY proname;`).trim().split("\n");
  assert.equal(rows.length, functionNames.length);
  for (const row of rows) {
    const [name, publicExecute, ownerExecute] = row.split("|");
    assert.ok(functionNames.includes(name));
    assert.equal(publicExecute, "f");
    assert.equal(ownerExecute, "t");
  }
  assert.equal(Number(sql(`SELECT count(*) FROM pg_proc WHERE pronamespace = '${databaseSchema}'::regnamespace AND proname IN ('runtime_guard_claim', 'runtime_guard_finalize')`).trim()), 0);
});

test("CSPRNG tokens are opaque, correctly shaped, and not deterministic", () => {
  const first = acquire("book-csprng-a");
  const second = acquire("book-csprng-b");
  assert.match(first.holder_token, tokenPattern);
  assert.match(second.holder_token, tokenPattern);
  assert.notEqual(first.holder_token, second.holder_token);
  const definitions = sql(`SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'zhreplan' AND proname IN ('runtime_guard_acquire', 'runtime_guarded_write')`).toLowerCase();
  assert.match(definitions, /gen_random_uuid/);
  assert.doesNotMatch(definitions, /md5\(random|clock_timestamp\(\)::text \|\| pg_backend_pid/);
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
  assert.equal(pgRuntimeGuards.release({ local_operator_id: operator, book_id: "book-lease", ...lock }).ok, true);
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

test("guarded write is idempotent and stale versions leave zero partial rows", () => {
  const lock = acquire("book-write");
  const first = write(lock);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.state_version, 1);
  const replay = write(lock);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.replay, true);
  const countsBeforeConflict = [
    count("runtime_idempotency_ledger", "WHERE idempotency_key = 'write-1'"),
    count("runtime_guarded_state", "WHERE book_id = 'book-write'"),
    count("runtime_guard_audit_log", "WHERE book_id = 'book-write'"),
  ];
  for (const [field, value] of [
    ["entity_id", "run-different"],
    ["expected_version", 1],
    ["payload", "different-payload"],
    ["state", "different-state"],
    ["result", "different-result"],
    ["operation", "other-operation"],
  ]) {
    const conflict = write(lock, { [field]: value });
    assert.equal(conflict.ok, false, field);
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT", field);
    assert.equal(Object.hasOwn(conflict.error, "result"), false, field);
    assert.deepEqual([
      count("runtime_idempotency_ledger", "WHERE idempotency_key = 'write-1'"),
      count("runtime_guarded_state", "WHERE book_id = 'book-write'"),
      count("runtime_guard_audit_log", "WHERE book_id = 'book-write'"),
    ], countsBeforeConflict, field);
  }
  const otherBookLock = acquire("other-book");
  const scopeConflict = write(otherBookLock, { book_id: "other-book", holder_token: otherBookLock.holder_token, fence_version: otherBookLock.fence_version });
  assert.equal(scopeConflict.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(Object.hasOwn(scopeConflict.error, "result"), false);
  const stateBefore = count("runtime_guarded_state", "WHERE book_id = 'book-write'");
  const auditBefore = count("runtime_guard_audit_log", "WHERE book_id = 'book-write'");
  const stale = write(lock, { idempotency_key: "write-stale", payload: "payload-stale", expected_version: 0 });
  assert.equal(stale.error.code, "STALE_VERSION");
  assert.equal(count("runtime_guarded_state", "WHERE book_id = 'book-write'"), stateBefore);
  assert.equal(count("runtime_guard_audit_log", "WHERE book_id = 'book-write'"), auditBefore);
  assert.equal(count("runtime_idempotency_ledger", "WHERE idempotency_key = 'write-stale'"), 0);
});

test("test-only triggers force each transactional stage to roll back and then recover", () => {
  const lock = acquire("book-failure");
  for (const stage of ["after_claim", "after_state", "after_audit", "after_finalize"]) {
    const key = `failure-${stage}`;
    temporaryFailure(stage, () => {
      const result = pgRuntimeGuards.guardedWrite({
        local_operator_id: operator, book_id: "book-failure", entity_id: `entity-${stage}`, expected_version: 0,
        holder_token: lock.holder_token, fence_version: lock.fence_version, operation: "formal-write",
        idempotency_key: key, payload: `payload-${stage}`, state: `state-${stage}`, result: `result-${stage}`,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "INTERNAL_ERROR");
      assert.equal(result.error.message.includes("test guard failure"), false);
      assert.equal(result.error.message.includes(lock.holder_token), false);
    });
    assert.equal(count("runtime_idempotency_ledger", `WHERE idempotency_key = '${key}'`), 0);
    assert.equal(count("runtime_guarded_state", `WHERE entity_id = 'entity-${stage}'`), 0);
    assert.equal(count("runtime_guard_audit_log", `WHERE idempotency_key = '${key}'`), 0);
  }
  assert.equal(write(lock, { book_id: "book-failure", entity_id: "entity-recovered", idempotency_key: "failure-recovered", payload: "payload-recovered", state: "state-recovered", result: "result-recovered" }).ok, true);
});

test("malformed PostgreSQL response wrappers are redacted", () => {
  try {
    sql(`CREATE OR REPLACE FUNCTION ${databaseSchema}.runtime_guard_acquire(p_local_operator_id text, p_book_id text, p_ttl_seconds integer) RETURNS TABLE(code text, fence_version bigint, holder_token text, lease_expires_at timestamptz) LANGUAGE sql AS $test$ SELECT 'LOCK_ACQUIRED'::text, 1::bigint, 'not-a-token'::text, clock_timestamp(); $test$;`);
    const result = pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: "book-malformed", ttl_seconds: 30 });
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { code: "INTERNAL_ERROR", message: "The guarded write could not be completed." });
  } finally {
    reset();
    seedOperator();
  }
});

test("unknown fields and malformed values fail closed", () => {
  assert.equal(pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: "book-invalid", ttl_seconds: 30, extra: true }).error.code, "INPUT_INVALID");
  assert.equal(pgRuntimeGuards.acquire({ local_operator_id: operator, book_id: "book-invalid", ttl_seconds: 301 }).error.code, "INPUT_INVALID");
});
