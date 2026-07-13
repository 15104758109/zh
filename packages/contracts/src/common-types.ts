export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema" as const;
export const STABLE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" as const;
export const OWNER_KEY_PATTERN = "^(?:FP::FP[0-9]{3}-[0-9]{2}|GLOBAL::[A-Z][A-Z0-9_]*)$" as const;

export const CONTRACT_ERROR_CODES = [
  "CONTRACT_NOT_FOUND",
  "CONTRACT_INVALID",
  "CONTRACT_CHANGED",
  "CONTRACT_PAYLOAD_INVALID",
  "CONTRACT_UNKNOWN_FIELD",
  "CONTRACT_DEPRECATED_FIELD",
] as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];
export type ComparisonResult = "SAME" | "CHANGED";
export type FactStateName = "candidate" | "shadow" | "formal";
export type JsonSchema = boolean | Record<string, unknown>;

export interface DeprecatedField {
  readonly path: string;
  readonly since_version: number;
  readonly replacement_path?: string;
}

export interface SchemaDescriptor {
  readonly schema_id: string;
  readonly version: number;
  readonly schema_uri: string;
  readonly draft: typeof DRAFT_2020_12;
  readonly owner: string;
  readonly schema_path: string;
  readonly sha256: string;
  readonly status: "active" | "deprecated";
  readonly replaces_version?: number;
  readonly replacement_version?: number;
  readonly deprecated_fields: readonly DeprecatedField[];
}

export interface TechnicalValidationError {
  readonly error_version: 1;
  readonly code: ContractErrorCode;
  readonly message: string;
  readonly contract_id: string;
  readonly contract_version: number;
  readonly path: string;
  readonly field?: string;
}

export interface LocalOperatorRef {
  readonly local_operator_id: string;
}

export type ConfigDomain = "prompt" | "model" | "budget" | "automation" | "presentation";
export type ConfigSource = "system_default" | "local_operator" | "book" | "run";

export interface ConfigVersionRef {
  readonly config_id: string;
  readonly version: number;
  readonly domain: ConfigDomain;
  readonly source: ConfigSource;
}

export interface BudgetVersionRef {
  readonly budget_id: string;
  readonly version: number;
  readonly source: ConfigSource;
}

export interface SkillVersionRef {
  readonly skill_id: string;
  readonly version: number;
  readonly source: "system_builtin" | "user_managed";
}

export interface MinimalRecordEnvelope<T extends object = Record<string, unknown>> {
  readonly envelope_version: 1;
  readonly record_id: string;
  readonly recorded_at: string;
  readonly owner: string;
  readonly local_operator_id: string;
  readonly book_id?: string;
  readonly run_id?: string;
  readonly chapter_id?: string;
  readonly candidate_id?: string;
  readonly audit_attempt_id?: string;
  readonly model_attempt_id?: string;
  readonly retry_index?: number;
  readonly trace_id: string;
  readonly config_ref?: ConfigVersionRef;
  readonly budget_ref?: BudgetVersionRef;
  readonly data_schema_id: string;
  readonly data_schema_version: number;
  readonly data: T;
}

export interface FactState {
  readonly fact_id: string;
  readonly fact_version: number;
  readonly state: FactStateName;
  readonly state_version: number;
  readonly replaces_version?: number;
}

export type ContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly TechnicalValidationError[] };

export interface RegisteredContract {
  readonly descriptor: SchemaDescriptor;
  readonly schema: JsonSchema;
}

export interface RegistryOptions {
  readonly packageRoot?: string;
}
