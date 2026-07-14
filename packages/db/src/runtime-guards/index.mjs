import { Buffer } from "node:buffer";

import { sql } from "../database.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPERATOR = /^operator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

const messages = Object.freeze({
  INPUT_INVALID: "The request is invalid.",
  LOCK_CONFLICT: "The book is currently being written.",
  IDEMPOTENCY_CONFLICT: "The idempotency key conflicts with an earlier request.",
  STALE_VERSION: "The state version is no longer current.",
  INTERNAL_ERROR: "The guarded write could not be completed.",
});

function error(code) {
  return { ok: false, error: { code, message: messages[code] } };
}

function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validId(value, operator = false) {
  return typeof value === "string" && (operator ? OPERATOR : ID).test(value);
}

function validText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}

function validInteger(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= MAX_SAFE;
}

function scalarJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function jsonArgument(value) {
  return `convert_from(decode('${scalarJson(value)}', 'base64'), 'UTF8')::jsonb`;
}

function parseRows(statement) {
  try {
    return sql(statement).trim().split("\n").filter(Boolean).map((line) => line.split("|"));
  } catch {
    return null;
  }
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function lockRequest(value) {
  return exact(value, ["local_operator_id", "book_id", "ttl_seconds"])
    && validId(value.local_operator_id, true) && validId(value.book_id)
    && Number.isInteger(value.ttl_seconds) && value.ttl_seconds >= 1 && value.ttl_seconds <= 300;
}

function leaseRequest(value) {
  return exact(value, ["local_operator_id", "book_id", "holder_token", "fence_version"])
    && validId(value.local_operator_id, true) && validId(value.book_id)
    && typeof value.holder_token === "string" && TOKEN.test(value.holder_token)
    && validInteger(value.fence_version, 1);
}

function idempotencyRequest(value, finalize = false) {
  const keys = finalize
    ? ["local_operator_id", "book_id", "operation", "idempotency_key", "payload", "result"]
    : ["local_operator_id", "book_id", "operation", "idempotency_key", "payload"];
  return exact(value, keys) && validId(value.local_operator_id, true) && validId(value.book_id)
    && validId(value.operation) && validId(value.idempotency_key) && validText(value.payload)
    && (!finalize || validText(value.result));
}

function writeRequest(value) {
  const keys = ["local_operator_id", "book_id", "entity_id", "expected_version", "holder_token", "fence_version", "operation", "idempotency_key", "payload", "state", "result"];
  return exact(value, keys) && validId(value.local_operator_id, true) && validId(value.book_id)
    && validId(value.entity_id) && validInteger(value.expected_version, 0)
    && typeof value.holder_token === "string" && TOKEN.test(value.holder_token)
    && validInteger(value.fence_version, 1) && validId(value.operation) && validId(value.idempotency_key)
    && validText(value.payload) && validText(value.state) && validText(value.result);
}

function valueArgument(value) {
  return jsonArgument({ value });
}

export const pgRuntimeGuards = Object.freeze({
  acquire(request) {
    if (!lockRequest(request)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code, COALESCE(fence_version::text, ''), COALESCE(holder_token, '') FROM zhreplan.runtime_guard_acquire(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${request.ttl_seconds});`);
    const row = rows?.[0];
    if (!row || row[0] !== "LOCK_ACQUIRED" || !row[1] || !row[2]) return row?.[0] === "LOCK_CONFLICT" ? error("LOCK_CONFLICT") : error("INTERNAL_ERROR");
    return { ok: true, value: { fence_version: Number(row[1]), holder_token: row[2] } };
  },
  renew(request) {
    if (!leaseRequest(request)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code FROM zhreplan.runtime_guard_renew(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${jsonArgument(request.holder_token)} #>> '{}', ${request.fence_version}, 30);`);
    return rows?.[0]?.[0] === "LOCK_RENEWED" ? { ok: true, value: { renewed: true } } : error(rows?.[0]?.[0] === "LOCK_CONFLICT" ? "LOCK_CONFLICT" : "INTERNAL_ERROR");
  },
  validate(request) {
    if (!leaseRequest(request)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code FROM zhreplan.runtime_guard_validate(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${jsonArgument(request.holder_token)} #>> '{}', ${request.fence_version});`);
    return rows?.[0]?.[0] === "LOCK_VALID" ? { ok: true, value: { valid: true } } : error(rows?.[0]?.[0] === "LOCK_CONFLICT" ? "LOCK_CONFLICT" : "INTERNAL_ERROR");
  },
  release(request) {
    if (!leaseRequest(request)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code FROM zhreplan.runtime_guard_release(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${jsonArgument(request.holder_token)} #>> '{}', ${request.fence_version});`);
    return rows?.[0]?.[0] === "LOCK_RELEASED" ? { ok: true, value: { released: true } } : error(rows?.[0]?.[0] === "LOCK_CONFLICT" ? "LOCK_CONFLICT" : "INTERNAL_ERROR");
  },
  claim(request) {
    if (!idempotencyRequest(request)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code, COALESCE(encode(convert_to(result::text, 'UTF8'), 'base64'), '') FROM zhreplan.runtime_guard_claim(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${jsonArgument(request.operation)} #>> '{}', ${jsonArgument(request.idempotency_key)} #>> '{}', ${valueArgument(request.payload)});`);
    const row = rows?.[0];
    if (row?.[0] === "IDEMPOTENCY_CLAIMED" || row?.[0] === "IDEMPOTENCY_PENDING") return { ok: true, value: { status: row[0] } };
    if (row?.[0] === "IDEMPOTENCY_REPLAY" && row[1]) return { ok: true, value: { status: row[0], result: decodeJson(row[1]).value } };
    return error(row?.[0] === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INTERNAL_ERROR");
  },
  finalize(request) {
    if (!idempotencyRequest(request, true)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code, COALESCE(encode(convert_to(result::text, 'UTF8'), 'base64'), '') FROM zhreplan.runtime_guard_finalize(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${jsonArgument(request.operation)} #>> '{}', ${jsonArgument(request.idempotency_key)} #>> '{}', ${valueArgument(request.payload)}, ${valueArgument(request.result)});`);
    const row = rows?.[0];
    if ((row?.[0] === "IDEMPOTENCY_FINALIZED" || row?.[0] === "IDEMPOTENCY_REPLAY") && row[1]) return { ok: true, value: { status: row[0], result: decodeJson(row[1]).value } };
    return error(row?.[0] === "IDEMPOTENCY_CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INTERNAL_ERROR");
  },
  guardedWrite(request, options = {}) {
    if (!writeRequest(request) || !exact(options, ["fault_stage"]) && Object.keys(options).length !== 0) return error("INPUT_INVALID");
    const faultStage = Object.keys(options).length === 0 ? null : options.fault_stage;
    if (faultStage !== null && !["after_claim", "after_state", "after_audit", "after_finalize"].includes(faultStage)) return error("INPUT_INVALID");
    const rows = parseRows(`SELECT code, COALESCE(state_version::text, ''), COALESCE(encode(convert_to(result::text, 'UTF8'), 'base64'), '') FROM zhreplan.runtime_guarded_write(${jsonArgument(request.local_operator_id)} #>> '{}', ${jsonArgument(request.book_id)} #>> '{}', ${jsonArgument(request.entity_id)} #>> '{}', ${request.expected_version}, ${jsonArgument(request.holder_token)} #>> '{}', ${request.fence_version}, ${jsonArgument(request.operation)} #>> '{}', ${jsonArgument(request.idempotency_key)} #>> '{}', ${valueArgument(request.payload)}, ${valueArgument(request.state)}, ${valueArgument(request.result)}, ${faultStage === null ? "NULL" : `${jsonArgument(faultStage)} #>> '{}'`});`);
    const row = rows?.[0];
    if (row?.[0] === "CAS_APPLIED" && row[1] && row[2]) return { ok: true, value: { state_version: Number(row[1]), result: decodeJson(row[2]).value } };
    if (row?.[0] === "IDEMPOTENCY_REPLAY" && row[2]) return { ok: true, value: { replay: true, result: decodeJson(row[2]).value } };
    if (row?.[0] === "LOCK_CONFLICT") return error("LOCK_CONFLICT");
    if (row?.[0] === "IDEMPOTENCY_CONFLICT") return error("IDEMPOTENCY_CONFLICT");
    return error(rows === null ? "INTERNAL_ERROR" : "STALE_VERSION");
  },
});
