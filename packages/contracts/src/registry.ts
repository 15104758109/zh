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
const RECORD_ENVELOPE_SCHEMA_URI = "urn:zhreplan:contract:record-envelope:1";

const SCHEMA_MAP_KEYWORDS = [
  "$defs",
  "definitions",
  "dependentSchemas",
  "patternProperties",
  "properties",
] as const;
const SCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const SCHEMA_SINGLE_KEYWORDS = [
  "additionalProperties",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedProperties",
] as const;

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

interface LoadedSchemaDocument {
  readonly schema: JsonSchema;
  readonly sha256: string;
}

function rawDocumentSha256(source: Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerPath(parent: string, segment: string): string {
  const escaped = segment.replaceAll("~", "~0").replaceAll("/", "~1");
  return `${parent}/${escaped}`;
}

function findOpenObjectSubschema(schema: JsonSchema, schemaUri: string): string | undefined {
  function visit(value: unknown, location: string): string | undefined {
    if (!isSchemaRecord(value)) return undefined;
    const declaredType = value.type;
    const declaresObject = declaredType === "object"
      || (Array.isArray(declaredType) && declaredType.includes("object"));
    const isEnvelopeData = schemaUri === RECORD_ENVELOPE_SCHEMA_URI
      && location === "/properties/data"
      && declaredType === "object"
      && value.additionalProperties === true;
    if (declaresObject && value.additionalProperties !== false && !isEnvelopeData) {
      return location || "/";
    }

    for (const keyword of SCHEMA_MAP_KEYWORDS) {
      const children = value[keyword];
      if (!isSchemaRecord(children)) continue;
      for (const [name, child] of Object.entries(children)) {
        const open = visit(child, pointerPath(pointerPath(location, keyword), name));
        if (open) return open;
      }
    }
    for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
      const children = value[keyword];
      if (!Array.isArray(children)) continue;
      for (const [index, child] of children.entries()) {
        const open = visit(child, pointerPath(pointerPath(location, keyword), String(index)));
        if (open) return open;
      }
    }
    for (const keyword of SCHEMA_SINGLE_KEYWORDS) {
      const open = visit(value[keyword], pointerPath(location, keyword));
      if (open) return open;
    }
    return undefined;
  }

  return visit(schema, "");
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function immutableEntry(descriptor: SchemaDescriptor, schema: JsonSchema): RegisteredContract {
  return deepFreeze({
    descriptor: structuredClone(descriptor),
    schema: structuredClone(schema),
  });
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

function loadSchema(packageRoot: string, schemaPath: string): ContractResult<LoadedSchemaDocument> {
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
    const source = readFileSync(absolutePath);
    const parsed = JSON.parse(source.toString("utf8")) as unknown;
    if (typeof parsed !== "boolean" && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
      return invalidSchemaResult("Schema file does not contain a JSON Schema.");
    }
    return {
      ok: true,
      value: {
        schema: parsed as JsonSchema,
        sha256: rawDocumentSha256(source),
      },
    };
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

  validateEnvelope<T extends object = Record<string, unknown>>(
    value: unknown,
  ): ContractResult<MinimalRecordEnvelope<T>> {
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
  const descriptorValidatorResult = ContractValidator.create([descriptorSchemaResult.value.schema]);
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
    const { schema, sha256 } = schemaResult.value;
    if (sha256 !== descriptor.sha256) {
      return invalidSchemaResult("Schema hash does not match its descriptor.");
    }
    if (typeof schema !== "object" || schema.$schema !== DRAFT_2020_12 || schema.$id !== descriptor.schema_uri) {
      return invalidSchemaResult("Schema identity does not match its descriptor.");
    }
    if (findOpenObjectSubschema(schema, descriptor.schema_uri)) {
      return invalidSchemaResult("Schema contains an object subschema that is not closed.");
    }
    const entry = immutableEntry(descriptor, schema);
    schemas.push(structuredClone(entry.schema));
    entries.set(schemaKey(descriptor.schema_id, descriptor.version), entry);
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
      sha256: schemaResult.value.sha256,
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
