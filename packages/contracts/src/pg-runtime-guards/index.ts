export const PG_RUNTIME_GUARD_ERROR_CODES = [
  "INPUT_INVALID",
  "LOCK_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "STALE_VERSION",
  "INTERNAL_ERROR",
] as const;

export type PgRuntimeGuardErrorCode = (typeof PG_RUNTIME_GUARD_ERROR_CODES)[number];

export interface PgRuntimeGuardError {
  readonly code: PgRuntimeGuardErrorCode;
  readonly message: string;
}

export const pgRuntimeGuardLockRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["local_operator_id", "book_id", "ttl_seconds"],
  properties: {
    local_operator_id: { type: "string", pattern: "^operator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
    book_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    ttl_seconds: { type: "integer", minimum: 1, maximum: 300 },
  },
} as const;

export const pgRuntimeGuardWriteRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["local_operator_id", "book_id", "entity_id", "expected_version", "holder_token", "fence_version", "operation", "idempotency_key", "payload", "state", "result"],
  properties: {
    local_operator_id: { type: "string", pattern: "^operator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
    book_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    entity_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    expected_version: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    holder_token: { type: "string", pattern: "^[0-9a-f]{64}$" },
    fence_version: { type: "integer", minimum: 1, maximum: 9007199254740991 },
    operation: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    idempotency_key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    payload: { type: "string", minLength: 1, maxLength: 4096 },
    state: { type: "string", minLength: 1, maxLength: 4096 },
    result: { type: "string", minLength: 1, maxLength: 4096 },
  },
} as const;
