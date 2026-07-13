import { randomUUID } from "node:crypto";

import { sql } from "../../../../../../packages/db/src/database.mjs";

const LOCAL_OPERATOR_ID = /^operator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ADVISORY_LOCK = 170004;

export const LOCAL_OPERATOR_ERRORS = Object.freeze({
  BOOTSTRAP_FAILED: "LOCAL_OPERATOR_BOOTSTRAP_FAILED",
  SCOPE_INVALID: "LOCAL_OPERATOR_SCOPE_INVALID",
  SCOPE_MISMATCH: "LOCAL_OPERATOR_SCOPE_MISMATCH",
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function quoted(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function validStableId(value) {
  return typeof value === "string" && STABLE_ID.test(value);
}

function closedObject(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

/** Loads the one local installation identity, creating it atomically when absent. */
export function loadOrCreateLocalOperator({ sqlExecutor = sql, createUuid = randomUUID } = {}) {
  let candidate;
  try {
    candidate = `operator:${createUuid()}`;
  } catch {
    fail(LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);
  }
  if (!LOCAL_OPERATOR_ID.test(candidate)) fail(LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);

  let output;
  try {
    output = sqlExecutor(`BEGIN;
SELECT pg_advisory_xact_lock(${ADVISORY_LOCK});
INSERT INTO zhreplan.local_operators (singleton_key, local_operator_id)
VALUES (true, ${quoted(candidate)})
ON CONFLICT (singleton_key) DO NOTHING;
SELECT local_operator_id FROM zhreplan.local_operators WHERE singleton_key = true;
COMMIT;`);
  } catch {
    fail(LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);
  }

  const rows = String(output).trim().split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1 || !LOCAL_OPERATOR_ID.test(rows[0])) fail(LOCAL_OPERATOR_ERRORS.BOOTSTRAP_FAILED);
  return Object.freeze({ local_operator_id: rows[0] });
}

/** Verifies object routing only; it deliberately provides no authentication or authorization. */
export function assertObjectScope({ expected, scope }) {
  if (!closedObject(expected, ["local_operator_id", "book_id"])
    || !validStableId(expected.local_operator_id)
    || ("book_id" in expected && !validStableId(expected.book_id))) {
    fail(LOCAL_OPERATOR_ERRORS.SCOPE_INVALID);
  }
  if (!closedObject(scope, ["object_type", "local_operator_id", "book_id"])
    || !["local_operator", "book", "chapter", "run"].includes(scope.object_type)
    || !validStableId(scope.local_operator_id)
    || ("book_id" in scope && !validStableId(scope.book_id))) {
    fail(LOCAL_OPERATOR_ERRORS.SCOPE_INVALID);
  }

  const localOnly = scope.object_type === "local_operator";
  if ((localOnly && ("book_id" in scope || "book_id" in expected))
    || (!localOnly && (!("book_id" in scope) || !("book_id" in expected)))
    || scope.local_operator_id !== expected.local_operator_id
    || (!localOnly && scope.book_id !== expected.book_id)) {
    fail(LOCAL_OPERATOR_ERRORS.SCOPE_MISMATCH);
  }
  return Object.freeze({ local_operator_id: scope.local_operator_id, ...(localOnly ? {} : { book_id: scope.book_id }) });
}
