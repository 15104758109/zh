export const PG_RUNTIME_GUARD_ERROR_CODES = ["INPUT_INVALID", "LOCK_CONFLICT", "IDEMPOTENCY_CONFLICT", "STALE_VERSION", "INTERNAL_ERROR"] as const;
export type PgRuntimeGuardErrorCode = (typeof PG_RUNTIME_GUARD_ERROR_CODES)[number];
export interface PgRuntimeGuardError { readonly code: PgRuntimeGuardErrorCode; readonly message: string; }

const stableId = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } as const;
const operatorId = { type: "string", pattern: "^operator:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$" } as const;
const token = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const positiveInteger = { type: "integer", minimum: 1, maximum: 9007199254740991 } as const;
const textValue = { type: "string", minLength: 1, maxLength: 4096 } as const;

const leaseProperties = { local_operator_id: operatorId, book_id: stableId, holder_token: token, fence_version: positiveInteger } as const;
export const pgRuntimeGuardErrorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
  required: ["code", "message"], properties: { code: { enum: PG_RUNTIME_GUARD_ERROR_CODES }, message: { type: "string", minLength: 1, maxLength: 500 } },
} as const;

export const pgRuntimeGuardContracts = {
  acquire: {
    request: { type: "object", additionalProperties: false, required: ["local_operator_id", "book_id", "ttl_seconds"], properties: { local_operator_id: operatorId, book_id: stableId, ttl_seconds: { type: "integer", minimum: 1, maximum: 300 } } },
    response: { type: "object", additionalProperties: false, required: ["fence_version", "holder_token"], properties: { fence_version: positiveInteger, holder_token: token } },
  },
  renew: { request: { type: "object", additionalProperties: false, required: Object.keys(leaseProperties), properties: leaseProperties }, response: { type: "object", additionalProperties: false, required: ["renewed"], properties: { renewed: { const: true } } } },
  validate: { request: { type: "object", additionalProperties: false, required: Object.keys(leaseProperties), properties: leaseProperties }, response: { type: "object", additionalProperties: false, required: ["valid"], properties: { valid: { const: true } } } },
  release: { request: { type: "object", additionalProperties: false, required: Object.keys(leaseProperties), properties: leaseProperties }, response: { type: "object", additionalProperties: false, required: ["released"], properties: { released: { const: true } } } },
  guardedWrite: {
    request: { type: "object", additionalProperties: false, required: ["local_operator_id", "book_id", "entity_id", "expected_version", "holder_token", "fence_version", "operation", "idempotency_key", "payload", "state", "result"], properties: { ...leaseProperties, entity_id: stableId, expected_version: { type: "integer", minimum: 0, maximum: 9007199254740991 }, operation: stableId, idempotency_key: stableId, payload: textValue, state: textValue, result: textValue } },
    response: { oneOf: [
      { type: "object", additionalProperties: false, required: ["state_version", "result"], properties: { state_version: positiveInteger, result: textValue } },
      { type: "object", additionalProperties: false, required: ["replay", "result"], properties: { replay: { const: true }, result: textValue } },
    ] },
  },
} as const;

export type PgRuntimeGuardOperation = keyof typeof pgRuntimeGuardContracts;
