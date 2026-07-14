import { Buffer } from "node:buffer";

import { sql } from "../database.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPERATOR = /^operator:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
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

function jsonArgument(value) {
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  return `convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb`;
}

function textArgument(value) {
  return `${jsonArgument(value)} #>> '{}'`;
}

function valueArgument(value) {
  return jsonArgument({ value });
}

function parseRows(statement) {
  try {
    const output = sql(statement).trim();
    return output === "" ? [] : output.split("\n").map((line) => line.split("|"));
  } catch {
    return null;
  }
}

function oneRow(rows, width) {
  return Array.isArray(rows) && rows.length === 1 && rows[0]?.length === width ? rows[0] : null;
}

function decodeValue(encoded) {
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return exact(value, ["value"]) && typeof value.value === "string" ? value.value : null;
  } catch {
    return null;
  }
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

function writeRequest(value) {
  const keys = ["local_operator_id", "book_id", "entity_id", "expected_version", "holder_token", "fence_version", "operation", "idempotency_key", "payload", "state", "result"];
  return exact(value, keys) && validId(value.local_operator_id, true) && validId(value.book_id)
    && validId(value.entity_id) && validInteger(value.expected_version, 0)
    && typeof value.holder_token === "string" && TOKEN.test(value.holder_token)
    && validInteger(value.fence_version, 1) && validId(value.operation) && validId(value.idempotency_key)
    && validText(value.payload) && validText(value.state) && validText(value.result);
}

function normalLeaseResult(rows, successCode, value) {
  const row = oneRow(rows, 1);
  if (row?.[0] === successCode) return { ok: true, value };
  return error(row?.[0] === "LOCK_CONFLICT" ? "LOCK_CONFLICT" : "INTERNAL_ERROR");
}

export const pgRuntimeGuards = Object.freeze({
  acquire(request) {
    if (!lockRequest(request)) return error("INPUT_INVALID");
    const row = oneRow(parseRows(`SELECT code, COALESCE(fence_version::text, ''), COALESCE(holder_token, '') FROM zhreplan.runtime_guard_acquire(${textArgument(request.local_operator_id)}, ${textArgument(request.book_id)}, ${request.ttl_seconds});`), 3);
    const fenceVersion = Number(row?.[1]);
    if (row?.[0] === "LOCK_ACQUIRED" && validInteger(fenceVersion, 1) && typeof row[2] === "string" && TOKEN.test(row[2])) {
      return { ok: true, value: { fence_version: fenceVersion, holder_token: row[2] } };
    }
    return error(row?.[0] === "LOCK_CONFLICT" ? "LOCK_CONFLICT" : "INTERNAL_ERROR");
  },
  renew(request) {
    if (!leaseRequest(request)) return error("INPUT_INVALID");
    return normalLeaseResult(parseRows(`SELECT code FROM zhreplan.runtime_guard_renew(${textArgument(request.local_operator_id)}, ${textArgument(request.book_id)}, ${textArgument(request.holder_token)}, ${request.fence_version}, 30);`), "LOCK_RENEWED", { renewed: true });
  },
  validate(request) {
    if (!leaseRequest(request)) return error("INPUT_INVALID");
    return normalLeaseResult(parseRows(`SELECT code FROM zhreplan.runtime_guard_validate(${textArgument(request.local_operator_id)}, ${textArgument(request.book_id)}, ${textArgument(request.holder_token)}, ${request.fence_version});`), "LOCK_VALID", { valid: true });
  },
  release(request) {
    if (!leaseRequest(request)) return error("INPUT_INVALID");
    return normalLeaseResult(parseRows(`SELECT code FROM zhreplan.runtime_guard_release(${textArgument(request.local_operator_id)}, ${textArgument(request.book_id)}, ${textArgument(request.holder_token)}, ${request.fence_version});`), "LOCK_RELEASED", { released: true });
  },
  guardedWrite(request) {
    if (!writeRequest(request)) return error("INPUT_INVALID");
    const row = oneRow(parseRows(`SELECT code, COALESCE(state_version::text, ''), COALESCE(encode(convert_to(result::text, 'UTF8'), 'base64'), '') FROM zhreplan.runtime_guarded_write(${textArgument(request.local_operator_id)}, ${textArgument(request.book_id)}, ${textArgument(request.entity_id)}, ${request.expected_version}, ${textArgument(request.holder_token)}, ${request.fence_version}, ${textArgument(request.operation)}, ${textArgument(request.idempotency_key)}, ${valueArgument(request.payload)}, ${valueArgument(request.state)}, ${valueArgument(request.result)});`), 3);
    if (row?.[0] === "CAS_APPLIED") {
      const stateVersion = Number(row[1]);
      const result = decodeValue(row[2]);
      if (validInteger(stateVersion, 1) && result !== null) return { ok: true, value: { state_version: stateVersion, result } };
      return error("INTERNAL_ERROR");
    }
    if (row?.[0] === "IDEMPOTENCY_REPLAY") {
      const result = decodeValue(row[2]);
      return result === null ? error("INTERNAL_ERROR") : { ok: true, value: { replay: true, result } };
    }
    if (row?.[0] === "LOCK_CONFLICT") return error("LOCK_CONFLICT");
    if (row?.[0] === "IDEMPOTENCY_CONFLICT") return error("IDEMPOTENCY_CONFLICT");
    if (row?.[0] === "STALE_VERSION") return error("STALE_VERSION");
    return error("INTERNAL_ERROR");
  },
});
