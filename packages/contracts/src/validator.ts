import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import type {
  ContractErrorCode,
  ContractResult,
  JsonSchema,
  SchemaDescriptor,
  TechnicalValidationError,
} from "./common-types.js";

const SCHEMA_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

function safeContractId(value: string): string {
  return SCHEMA_ID_PATTERN.test(value) ? value : "schema-registry";
}

export function createTechnicalValidationError(
  code: ContractErrorCode,
  message: string,
  contractId: string,
  contractVersion: number,
  path: string,
  field?: string,
): TechnicalValidationError {
  const base = {
    error_version: 1 as const,
    code,
    message: message.slice(0, 500) || "Contract validation failed.",
    contract_id: safeContractId(contractId),
    contract_version: Number.isInteger(contractVersion) && contractVersion >= 1 ? contractVersion : 1,
    path,
  };
  const normalizedField = field?.slice(0, 128);
  return normalizedField ? { ...base, field: normalizedField } : base;
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerSegments(pointer: string): readonly string[] {
  if (!pointer.startsWith("/")) return [];
  return pointer.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function hasJsonPointer(value: unknown, pointer: string): boolean {
  let cursor: unknown = value;
  for (const segment of pointerSegments(pointer)) {
    if (typeof cursor !== "object" || cursor === null || !Object.hasOwn(cursor, segment)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return pointer.startsWith("/");
}

function ajvErrorToContractError(
  error: ErrorObject,
  contractId: string,
  contractVersion: number,
): TechnicalValidationError {
  if (error.keyword === "additionalProperties") {
    const field = String(error.params.additionalProperty ?? "");
    const path = `${error.instancePath}/${escapeJsonPointer(field)}`;
    return createTechnicalValidationError(
      "CONTRACT_UNKNOWN_FIELD",
      "Payload contains an unknown field.",
      contractId,
      contractVersion,
      path,
      field,
    );
  }
  return createTechnicalValidationError(
    "CONTRACT_PAYLOAD_INVALID",
    "Payload does not match the registered contract.",
    contractId,
    contractVersion,
    error.instancePath,
  );
}

function createAjv(): InstanceType<typeof Ajv2020> {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv;
}

export class ContractValidator {
  readonly #ajv: InstanceType<typeof Ajv2020>;

  private constructor(ajv: InstanceType<typeof Ajv2020>) {
    this.#ajv = ajv;
  }

  static create(schemas: readonly JsonSchema[]): ContractResult<ContractValidator> {
    try {
      const ajv = createAjv();
      for (const schema of schemas) ajv.addSchema(schema);
      for (const schema of schemas) {
        if (typeof schema === "object" && typeof schema.$id === "string") {
          if (!ajv.getSchema(schema.$id)) throw new Error("Registered schema could not be resolved.");
        } else {
          ajv.compile(schema);
        }
      }
      return { ok: true, value: new ContractValidator(ajv) };
    } catch {
      return {
        ok: false,
        errors: [createTechnicalValidationError(
          "CONTRACT_INVALID",
          "A registered schema could not be compiled.",
          "schema-registry",
          1,
          "",
        )],
      };
    }
  }

  static checkSchema(schema: JsonSchema): ContractResult<true> {
    try {
      const ajv = createAjv();
      ajv.compile(schema);
      return { ok: true, value: true };
    } catch {
      return {
        ok: false,
        errors: [createTechnicalValidationError(
          "CONTRACT_INVALID",
          "Schema definition is invalid.",
          "schema-registry",
          1,
          "",
        )],
      };
    }
  }

  validateRaw<T>(
    schemaUri: string,
    contractId: string,
    contractVersion: number,
    value: unknown,
  ): ContractResult<T> {
    const validate = this.#ajv.getSchema(schemaUri) as ValidateFunction | undefined;
    if (!validate) {
      return {
        ok: false,
        errors: [createTechnicalValidationError(
          "CONTRACT_NOT_FOUND",
          "The requested contract was not found.",
          contractId,
          contractVersion,
          "",
        )],
      };
    }
    if (validate(value)) return { ok: true, value: value as T };
    return {
      ok: false,
      errors: (validate.errors ?? []).map((error) => ajvErrorToContractError(error, contractId, contractVersion)),
    };
  }

  validate<T>(descriptor: SchemaDescriptor, value: unknown): ContractResult<T> {
    if (descriptor.status === "deprecated") {
      return {
        ok: false,
        errors: [createTechnicalValidationError(
          "CONTRACT_DEPRECATED_FIELD",
          "Deprecated contract versions reject new payloads.",
          descriptor.schema_id,
          descriptor.version,
          "",
        )],
      };
    }
    const deprecated = descriptor.deprecated_fields.find((item) => hasJsonPointer(value, item.path));
    if (deprecated) {
      const segments = pointerSegments(deprecated.path);
      return {
        ok: false,
        errors: [createTechnicalValidationError(
          "CONTRACT_DEPRECATED_FIELD",
          "Payload contains a deprecated field.",
          descriptor.schema_id,
          descriptor.version,
          deprecated.path,
          segments.at(-1),
        )],
      };
    }
    return this.validateRaw<T>(descriptor.schema_uri, descriptor.schema_id, descriptor.version, value);
  }
}
