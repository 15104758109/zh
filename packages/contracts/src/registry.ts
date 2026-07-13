// @ts-ignore -- Node 24 is a package runtime requirement; @types/node is not a package dependency.
import { createHash } from "node:crypto";
// @ts-ignore -- Node 24 is a package runtime requirement; @types/node is not a package dependency.
import { readFileSync } from "node:fs";
// @ts-ignore -- Node 24 is a package runtime requirement; @types/node is not a package dependency.
import path from "node:path";
// @ts-ignore -- Node 24 is a package runtime requirement; @types/node is not a package dependency.
import { fileURLToPath } from "node:url";

import {
  DRAFT_2020_12,
  type ContractResult,
  type JsonSchema,
  type MinimalRecordEnvelope,
  type RegisteredContract,
  type RegistryOptions,
  type SchemaDescriptor,
} from "./common-types.js";
import { compareSchemaDescriptors } from "./compare.js";
import { ContractValidator, createTechnicalValidationError } from "./validator.js";

const DESCRIPTOR_SCHEMA_PATH = "src/schemas/schema-descriptor.schema.json";
const SCHEMA_PATH_PATTERN = /^src\/schemas\/.+\.schema\.json$/;

const BUILTIN_SCHEMAS = [
  ["schema-descriptor", "src/schemas/schema-descriptor.schema.json"],
  ["validation-error", "src/schemas/validation-error.schema.json"],
  ["record-envelope", "src/schemas/record-envelope.schema.json"],
  ["fact-state", "src/schemas/fact-state.schema.json"],
  ["local-operator-ref", "src/schemas/refs/local-operator-ref.schema.json"],
  ["config-version-ref", "src/schemas/refs/config-version-ref.schema.json"],
  ["budget-version-ref", "src/schemas/refs/budget-version-ref.schema.json"],
  ["skill-version-ref", "src/schemas/refs/skill-version-ref.schema.json"],
] as const;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("Value is not JSON.");
}

export function canonicalizeJson(value: unknown): string {
  return canonicalize(value);
}

export function schemaDocumentSha256(schema: JsonSchema): string {
  return createHash("sha256").update(canonicalizeJson(schema), "utf8").digest("hex");
}

function defaultPackageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function schemaKey(schemaId: string, version: number): string {
  return `${schemaId}:${version}`;
}

function derivedSchemaUri(schemaId: string, version: number): string {
  return `urn:zhreplan:contract:${schemaId}:${version}`;
}

function loadSchema(packageRoot: string, schemaPath: string): ContractResult<JsonSchema> {
  const segments = schemaPath.split("/");
  if (
    !SCHEMA_PATH_PATTERN.test(schemaPath)
    || schemaPath.includes("\\")
    || path.isAbsolute(schemaPath)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return invalidSchemaResult("Schema path is outside the approved package directory.");
  }
  const absolutePath = path.resolve(packageRoot, ...schemaPath.split("/"));
  const schemaRoot = path.resolve(packageRoot, "src", "schemas");
  const relative = path.relative(schemaRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return invalidSchemaResult("Schema path is outside the approved package directory.");
  }
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    if (typeof parsed !== "boolean" && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
      return invalidSchemaResult("Schema file does not contain a JSON Schema.");
    }
    return { ok: true, value: parsed as JsonSchema };
  } catch {
    return invalidSchemaResult("Schema file could not be loaded.");
  }
}

function invalidSchemaResult(message: string): ContractResult<never> {
  return {
    ok: false,
    errors: [createTechnicalValidationError("CONTRACT_INVALID", message, "schema-registry", 1, "")],
  };
}

function duplicateResult(descriptor: SchemaDescriptor, changed: boolean): ContractResult<never> {
  return {
    ok: false,
    errors: [createTechnicalValidationError(
      changed ? "CONTRACT_CHANGED" : "CONTRACT_INVALID",
      changed ? "A contract version cannot be replaced with changed content." : "Contract ID and version must be unique.",
      descriptor.schema_id,
      descriptor.version,
      "",
    )],
  };
}

export class SchemaRegistry {
  readonly #entries: ReadonlyMap<string, RegisteredContract>;
  readonly #current: ReadonlyMap<string, RegisteredContract>;
  readonly #validator: ContractValidator;

  constructor(
    entries: ReadonlyMap<string, RegisteredContract>,
    current: ReadonlyMap<string, RegisteredContract>,
    validator: ContractValidator,
  ) {
    this.#entries = entries;
    this.#current = current;
    this.#validator = validator;
  }

  listDescriptors(): readonly SchemaDescriptor[] {
    return [...this.#entries.values()].map((entry) => entry.descriptor);
  }

  getExact(schemaId: string, version: number): ContractResult<RegisteredContract> {
    const entry = this.#entries.get(schemaKey(schemaId, version));
    return entry
      ? { ok: true, value: entry }
      : {
          ok: false,
          errors: [createTechnicalValidationError(
            "CONTRACT_NOT_FOUND",
            "The requested contract was not found.",
            schemaId,
            version,
            "",
          )],
        };
  }

  getCurrent(schemaId: string): ContractResult<RegisteredContract> {
    const entry = this.#current.get(schemaId);
    return entry
      ? { ok: true, value: entry }
      : {
          ok: false,
          errors: [createTechnicalValidationError(
            "CONTRACT_NOT_FOUND",
            "The current contract was not found.",
            schemaId,
            1,
            "",
          )],
        };
  }

  validate<T>(schemaId: string, version: number, value: unknown): ContractResult<T> {
    const found = this.getExact(schemaId, version);
    if (!found.ok) return found;
    return this.#validator.validate<T>(found.value.descriptor, value);
  }

  validateEnvelope<T>(value: unknown): ContractResult<MinimalRecordEnvelope<T>> {
    const envelopeResult = this.validate<MinimalRecordEnvelope<T>>("record-envelope", 1, value);
    if (!envelopeResult.ok) return envelopeResult;
    const envelope = envelopeResult.value;
    const target = this.getExact(envelope.data_schema_id, envelope.data_schema_version);
    if (!target.ok) return target;
    const current = this.#current.get(envelope.data_schema_id);
    if (!current || current.descriptor.version !== envelope.data_schema_version) {
      return {
        ok: false,
        errors: [createTechnicalValidationError(
          "CONTRACT_DEPRECATED_FIELD",
          "Record data must use the current active contract version.",
          envelope.data_schema_id,
          envelope.data_schema_version,
          "/data_schema_version",
          "data_schema_version",
        )],
      };
    }
    const payloadResult = this.#validator.validate<T>(target.value.descriptor, envelope.data);
    return payloadResult.ok ? { ok: true, value: envelope } : payloadResult;
  }
}

export function createSchemaRegistry(
  descriptors: readonly SchemaDescriptor[],
  options: RegistryOptions = {},
): ContractResult<SchemaRegistry> {
  const packageRoot = options.packageRoot ?? defaultPackageRoot();
  const descriptorSchemaResult = loadSchema(packageRoot, DESCRIPTOR_SCHEMA_PATH);
  if (!descriptorSchemaResult.ok) return descriptorSchemaResult;
  const descriptorValidatorResult = ContractValidator.create([descriptorSchemaResult.value]);
  if (!descriptorValidatorResult.ok) return descriptorValidatorResult;

  for (const descriptor of descriptors) {
    const validation = descriptorValidatorResult.value.validateRaw<SchemaDescriptor>(
      "urn:zhreplan:contract:schema-descriptor:1",
      "schema-descriptor",
      1,
      descriptor,
    );
    if (!validation.ok) return validation;
    if (descriptor.schema_uri !== derivedSchemaUri(descriptor.schema_id, descriptor.version)) {
      return invalidSchemaResult("Schema URI does not match the descriptor ID and version.");
    }
  }

  const descriptorsByKey = new Map<string, SchemaDescriptor>();
  for (const descriptor of descriptors) {
    const key = schemaKey(descriptor.schema_id, descriptor.version);
    const existing = descriptorsByKey.get(key);
    if (existing) return duplicateResult(descriptor, compareSchemaDescriptors(existing, descriptor) === "CHANGED");
    descriptorsByKey.set(key, descriptor);
  }

  const byId = new Map<string, SchemaDescriptor[]>();
  for (const descriptor of descriptors) {
    const versions = byId.get(descriptor.schema_id) ?? [];
    versions.push(descriptor);
    byId.set(descriptor.schema_id, versions);
  }
  for (const [schemaId, versions] of byId) {
    if (versions.filter((descriptor) => descriptor.status === "active").length !== 1) {
      return invalidSchemaResult(`Contract ${schemaId} must have exactly one current active version.`);
    }
  }

  const entries = new Map<string, RegisteredContract>();
  const schemas: JsonSchema[] = [];
  for (const descriptor of descriptors) {
    const schemaResult = loadSchema(packageRoot, descriptor.schema_path);
    if (!schemaResult.ok) return schemaResult;
    const schema = schemaResult.value;
    if (schemaDocumentSha256(schema) !== descriptor.sha256) {
      return invalidSchemaResult("Schema hash does not match its descriptor.");
    }
    if (typeof schema !== "object" || schema.$schema !== DRAFT_2020_12 || schema.$id !== descriptor.schema_uri) {
      return invalidSchemaResult("Schema identity does not match its descriptor.");
    }
    schemas.push(schema);
    entries.set(schemaKey(descriptor.schema_id, descriptor.version), { descriptor, schema });
  }

  const validatorResult = ContractValidator.create(schemas);
  if (!validatorResult.ok) return validatorResult;
  const current = new Map<string, RegisteredContract>();
  for (const entry of entries.values()) {
    if (entry.descriptor.status === "active") current.set(entry.descriptor.schema_id, entry);
  }
  return { ok: true, value: new SchemaRegistry(entries, current, validatorResult.value) };
}

export function loadBuiltinSchemaDescriptors(options: RegistryOptions = {}): ContractResult<readonly SchemaDescriptor[]> {
  const packageRoot = options.packageRoot ?? defaultPackageRoot();
  const descriptors: SchemaDescriptor[] = [];
  for (const [schemaId, schemaPath] of BUILTIN_SCHEMAS) {
    const schemaResult = loadSchema(packageRoot, schemaPath);
    if (!schemaResult.ok) return schemaResult;
    const deprecatedFields = schemaId === "fact-state"
      ? [
          { path: "/is_finalized", since_version: 1, replacement_path: "/state" },
          { path: "/deduction_locked", since_version: 1 },
        ]
      : [];
    descriptors.push({
      schema_id: schemaId,
      version: 1,
      schema_uri: derivedSchemaUri(schemaId, 1),
      draft: DRAFT_2020_12,
      owner: "GLOBAL::CONTRACTS",
      schema_path: schemaPath,
      sha256: schemaDocumentSha256(schemaResult.value),
      status: "active",
      deprecated_fields: deprecatedFields,
    });
  }
  return { ok: true, value: descriptors };
}

export function createBuiltinSchemaRegistry(options: RegistryOptions = {}): ContractResult<SchemaRegistry> {
  const descriptors = loadBuiltinSchemaDescriptors(options);
  return descriptors.ok ? createSchemaRegistry(descriptors.value, options) : descriptors;
}
