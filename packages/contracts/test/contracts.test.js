import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as contracts from "@zh/contracts";

const {
  CONTRACT_ERROR_CODES,
  ContractValidator,
  DRAFT_2020_12,
  compareSchemaDescriptors,
  createBuiltinSchemaRegistry,
  createSchemaRegistry,
  isFactStateTransitionAllowed,
  loadBuiltinSchemaDescriptors,
} = contracts;

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DESCRIPTOR_SCHEMA_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "schemas",
  "schema-descriptor.schema.json",
);

function expectOk(result) {
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.errors));
  if (!result.ok) throw new Error("Expected contract operation to succeed.");
  return result.value;
}

function expectFailure(result, code) {
  assert.equal(result.ok, false, "Expected contract operation to fail.");
  if (result.ok) throw new Error("Expected contract operation to fail.");
  assert.ok(result.errors.length > 0, "A failed contract operation must return errors.");
  if (code !== undefined) {
    assert.ok(
      result.errors.some((error) => error.code === code),
      `Expected ${code}, received ${result.errors.map((error) => error.code).join(", ")}`,
    );
  }
  return result.errors;
}

function omit(value, key) {
  const result = { ...value };
  delete result[key];
  return result;
}

function fact(overrides = {}) {
  return {
    fact_id: "fact:001",
    fact_version: 1,
    state: "candidate",
    state_version: 0,
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    envelope_version: 1,
    record_id: "record:001",
    recorded_at: "2026-07-13T00:00:00Z",
    owner: "GLOBAL::CONTRACTS",
    local_operator_id: "operator:local",
    trace_id: "trace:001",
    data_schema_id: "fact-state",
    data_schema_version: 1,
    data: fact(),
    ...overrides,
  };
}

function schemaUri(schemaId, version) {
  return `urn:zhreplan:contract:${schemaId}:${version}`;
}

function rawSha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function closedValueSchema(schemaId, version, extra = {}) {
  return {
    $schema: DRAFT_2020_12,
    $id: schemaUri(schemaId, version),
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      value: { type: "string" },
    },
    ...extra,
  };
}

async function fixtureRoot(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "zh-contracts-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const schemaDirectory = path.join(root, "src", "schemas");
  if (options.copyBuiltins) {
    await mkdir(path.dirname(schemaDirectory), { recursive: true });
    await cp(path.join(PACKAGE_ROOT, "src", "schemas"), schemaDirectory, { recursive: true });
  } else {
    await mkdir(schemaDirectory, { recursive: true });
    await copyFile(DESCRIPTOR_SCHEMA_PATH, path.join(schemaDirectory, "schema-descriptor.schema.json"));
  }
  return root;
}

async function addFixtureSchema(root, schemaId, version, schema, overrides = {}, document) {
  const schemaPath = `src/schemas/${schemaId}.v${version}.schema.json`;
  const source = document ?? `${JSON.stringify(schema, null, 2)}\n`;
  await writeFile(path.join(root, ...schemaPath.split("/")), source, "utf8");
  const descriptor = {
    schema_id: schemaId,
    version,
    schema_uri: schemaUri(schemaId, version),
    draft: DRAFT_2020_12,
    owner: "GLOBAL::CONTRACTS",
    schema_path: schemaPath,
    sha256: rawSha256(source),
    status: "active",
    deprecated_fields: [],
  };
  if (version > 1) descriptor.replaces_version = version - 1;
  return { ...descriptor, ...overrides };
}

function builtinRegistry() {
  return expectOk(createBuiltinSchemaRegistry({ packageRoot: PACKAGE_ROOT }));
}

test("MCV1-T01 Draft 2020-12 schemas compile and invalid registrations fail", async (t) => {
  const valid = {
    $schema: DRAFT_2020_12,
    type: "object",
    additionalProperties: false,
  };
  expectOk(ContractValidator.checkSchema(valid));
  expectFailure(
    ContractValidator.checkSchema({ ...valid, type: "not-a-json-schema-type" }),
    "CONTRACT_INVALID",
  );
  builtinRegistry();

  const root = await fixtureRoot(t);
  const schemaId = "missing-ref-test";
  const unresolved = {
    $schema: DRAFT_2020_12,
    $id: schemaUri(schemaId, 1),
    $ref: "urn:zhreplan:contract:not-registered:1",
  };
  const descriptor = await addFixtureSchema(root, schemaId, 1, unresolved);
  expectFailure(createSchemaRegistry([descriptor], { packageRoot: root }), "CONTRACT_INVALID");
});

test("MCV1-T02 descriptors enforce required, conditional, pattern, path, and closed-object rules", async (t) => {
  const registry = builtinRegistry();
  const descriptors = expectOk(loadBuiltinSchemaDescriptors({ packageRoot: PACKAGE_ROOT }));
  const base = descriptors.find((descriptor) => descriptor.schema_id === "fact-state");
  assert.ok(base);
  expectOk(registry.validate("schema-descriptor", 1, base));

  const invalidDescriptors = [
    omit(base, "owner"),
    { ...base, schema_id: "Bad_ID" },
    { ...base, owner: "FP::FP12-01" },
    { ...base, version: 2, schema_uri: schemaUri("fact-state", 2) },
    { ...base, status: "deprecated" },
    { ...base, unexpected: true },
    { ...base, deprecated_fields: [{ path: "", since_version: 1 }] },
    { ...base, deprecated_fields: [{ path: "not-a-pointer", since_version: 1 }] },
    { ...base, deprecated_fields: [{ path: "/old", since_version: 1, extra: true }] },
  ];
  for (const descriptor of invalidDescriptors) {
    expectFailure(registry.validate("schema-descriptor", 1, descriptor));
  }

  const root = await fixtureRoot(t);
  const schema = closedValueSchema("path-test", 1);
  const descriptor = await addFixtureSchema(root, "path-test", 1, schema);
  expectFailure(
    createSchemaRegistry([{ ...descriptor, schema_uri: schemaUri("other-test", 1) }], { packageRoot: root }),
    "CONTRACT_INVALID",
  );

  const escapedPath = path.join(root, "src", "escape.schema.json");
  await writeFile(escapedPath, `${JSON.stringify(schema)}\n`, "utf8");
  expectFailure(
    createSchemaRegistry(
      [{ ...descriptor, schema_path: "src/schemas/../escape.schema.json" }],
      { packageRoot: root },
    ),
    "CONTRACT_INVALID",
  );
});

test("MCV1-T03 duplicate versions, changed hashes, and hash mismatches are rejected", async (t) => {
  const root = await fixtureRoot(t);
  const schema = closedValueSchema("duplicate-test", 1);
  const descriptor = await addFixtureSchema(root, "duplicate-test", 1, schema);

  expectFailure(createSchemaRegistry([descriptor, descriptor], { packageRoot: root }), "CONTRACT_INVALID");
  expectFailure(
    createSchemaRegistry(
      [descriptor, { ...descriptor, sha256: "0".repeat(64) }],
      { packageRoot: root },
    ),
    "CONTRACT_CHANGED",
  );
  expectFailure(
    createSchemaRegistry([{ ...descriptor, sha256: "f".repeat(64) }], { packageRoot: root }),
    "CONTRACT_INVALID",
  );

  const schemaFile = path.join(root, ...descriptor.schema_path.split("/"));
  const originalBytes = await readFile(schemaFile);
  const compactDocument = `${JSON.stringify(schema)}\n`;
  assert.equal(descriptor.sha256, rawSha256(originalBytes));
  assert.notEqual(descriptor.sha256, rawSha256(compactDocument));
  await writeFile(schemaFile, compactDocument, "utf8");
  assert.deepEqual(JSON.parse(originalBytes.toString("utf8")), JSON.parse(compactDocument));
  expectFailure(
    createSchemaRegistry([descriptor], { packageRoot: root }),
    "CONTRACT_INVALID",
  );
  expectOk(createSchemaRegistry(
    [{ ...descriptor, sha256: rawSha256(compactDocument) }],
    { packageRoot: root },
  ));

  const builtinDescriptors = expectOk(loadBuiltinSchemaDescriptors({ packageRoot: PACKAGE_ROOT }));
  for (const builtin of builtinDescriptors) {
    const bytes = await readFile(path.join(PACKAGE_ROOT, ...builtin.schema_path.split("/")));
    assert.equal(builtin.sha256, rawSha256(bytes));
  }
});

test("MCV1-T04 exactly one active version is current and deprecated writes fail", async (t) => {
  const root = await fixtureRoot(t);
  const schemaId = "status-test";
  const oldSchema = closedValueSchema(schemaId, 1);
  const currentSchema = closedValueSchema(schemaId, 2, {
    properties: {
      value: { type: "string" },
      old_value: { type: "string" },
    },
  });
  const oldDescriptor = await addFixtureSchema(root, schemaId, 1, oldSchema, {
    status: "deprecated",
    replacement_version: 2,
  });
  const currentDescriptor = await addFixtureSchema(root, schemaId, 2, currentSchema, {
    deprecated_fields: [{ path: "/old_value", since_version: 2, replacement_path: "/value" }],
  });

  expectFailure(createSchemaRegistry([oldDescriptor], { packageRoot: root }), "CONTRACT_INVALID");
  expectFailure(
    createSchemaRegistry(
      [omit({ ...oldDescriptor, status: "active" }, "replacement_version"), currentDescriptor],
      { packageRoot: root },
    ),
    "CONTRACT_INVALID",
  );

  const registry = expectOk(
    createSchemaRegistry([oldDescriptor, currentDescriptor], { packageRoot: root }),
  );
  assert.equal(expectOk(registry.getCurrent(schemaId)).descriptor.version, 2);
  expectFailure(registry.validate(schemaId, 1, { value: "old" }), "CONTRACT_DEPRECATED_FIELD");
  expectOk(registry.validate(schemaId, 2, { value: "current" }));
  expectFailure(
    registry.validate(schemaId, 2, { value: "current", old_value: "old" }),
    "CONTRACT_DEPRECATED_FIELD",
  );
});

test("MCV1-T05 descriptor comparison returns only SAME or CHANGED for the identity triple", () => {
  const base = expectOk(loadBuiltinSchemaDescriptors({ packageRoot: PACKAGE_ROOT }))[0];
  assert.ok(base);
  assert.equal(compareSchemaDescriptors(base, { ...base }), "SAME");
  assert.equal(compareSchemaDescriptors(base, { ...base, owner: "GLOBAL::OTHER" }), "SAME");
  assert.equal(compareSchemaDescriptors(base, { ...base, schema_id: "other-schema" }), "CHANGED");
  assert.equal(compareSchemaDescriptors(base, { ...base, version: base.version + 1 }), "CHANGED");
  assert.equal(compareSchemaDescriptors(base, { ...base, sha256: "0".repeat(64) }), "CHANGED");
  assert.deepEqual(
    new Set([
      compareSchemaDescriptors(base, base),
      compareSchemaDescriptors(base, { ...base, version: 2 }),
    ]),
    new Set(["SAME", "CHANGED"]),
  );
});

test("MCV1-T06 unknown fields at every object layer and deprecated pointers are rejected", async (t) => {
  const registry = builtinRegistry();
  expectFailure(registry.validateEnvelope({ ...envelope(), extra: true }), "CONTRACT_UNKNOWN_FIELD");
  expectFailure(
    registry.validateEnvelope({
      ...envelope(),
      config_ref: {
        config_id: "config:001",
        version: 1,
        domain: "prompt",
        source: "book",
        extra: true,
      },
    }),
    "CONTRACT_UNKNOWN_FIELD",
  );
  expectFailure(
    registry.validateEnvelope({ ...envelope(), data: fact({ extra: true }) }),
    "CONTRACT_UNKNOWN_FIELD",
  );
  expectFailure(
    registry.validate("fact-state", 1, fact({ is_finalized: false })),
    "CONTRACT_DEPRECATED_FIELD",
  );

  const root = await fixtureRoot(t);
  const openSchemas = [
    closedValueSchema("open-nested-test", 1, {
      properties: {
        value: {
          type: "object",
          properties: { child: { type: "string" } },
        },
      },
    }),
    closedValueSchema("open-array-test", 1, {
      properties: {
        value: {
          type: "array",
          items: {
            type: "object",
            properties: { child: { type: "string" } },
          },
        },
      },
    }),
    closedValueSchema("open-defs-test", 1, {
      properties: { value: { $ref: "#/$defs/entry" } },
      $defs: {
        entry: {
          type: "object",
          properties: { child: { type: "string" } },
        },
      },
    }),
    closedValueSchema("open-branch-test", 1, {
      properties: {
        value: {
          anyOf: [
            {
              type: "object",
              properties: { child: { type: "string" } },
            },
            { type: "string" },
          ],
        },
      },
    }),
  ];
  for (const openSchema of openSchemas) {
    const schemaId = openSchema.$id.split(":").at(-2);
    const openDescriptor = await addFixtureSchema(root, schemaId, 1, openSchema);
    expectFailure(
      createSchemaRegistry([openDescriptor], { packageRoot: root }),
      "CONTRACT_INVALID",
    );
  }

  const schemaId = "nested-test";
  const schema = closedValueSchema(schemaId, 1, {
    required: ["nested"],
    properties: {
      nested: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "string" },
          legacy: { type: "string" },
        },
      },
    },
  });
  const descriptor = await addFixtureSchema(root, schemaId, 1, schema, {
    deprecated_fields: [{ path: "/nested/legacy", since_version: 1 }],
  });
  const nestedRegistry = expectOk(createSchemaRegistry([descriptor], { packageRoot: root }));
  expectFailure(
    nestedRegistry.validate(schemaId, 1, { nested: { value: "ok", legacy: "old" } }),
    "CONTRACT_DEPRECATED_FIELD",
  );
  expectFailure(
    nestedRegistry.validate(schemaId, 1, { nested: { value: "ok", extra: true } }),
    "CONTRACT_UNKNOWN_FIELD",
  );
});

test("MCV1-T07 the technical error contract has exactly six codes and no sensitive extensions", () => {
  const registry = builtinRegistry();
  const expectedCodes = [
    "CONTRACT_NOT_FOUND",
    "CONTRACT_INVALID",
    "CONTRACT_CHANGED",
    "CONTRACT_PAYLOAD_INVALID",
    "CONTRACT_UNKNOWN_FIELD",
    "CONTRACT_DEPRECATED_FIELD",
  ];
  assert.deepEqual([...CONTRACT_ERROR_CODES], expectedCodes);

  for (const code of expectedCodes) {
    expectOk(registry.validate("validation-error", 1, {
      error_version: 1,
      code,
      message: "x".repeat(500),
      contract_id: "fact-state",
      contract_version: 1,
      path: "/state",
      field: "x".repeat(128),
    }));
  }

  const errorBase = {
    error_version: 1,
    code: "CONTRACT_PAYLOAD_INVALID",
    message: "Invalid payload.",
    contract_id: "fact-state",
    contract_version: 1,
    path: "/state",
  };
  expectFailure(registry.validate("validation-error", 1, { ...errorBase, code: "UNKNOWN" }));
  expectFailure(registry.validate("validation-error", 1, { ...errorBase, message: "" }));
  expectFailure(registry.validate("validation-error", 1, { ...errorBase, message: "x".repeat(501) }));
  expectFailure(registry.validate("validation-error", 1, { ...errorBase, field: "x".repeat(129) }));
  for (const field of [
    "details",
    "stack",
    "raw_payload",
    "credential",
    "prompt",
    "retryable",
    "severity",
    "p0",
  ]) {
    expectFailure(registry.validate("validation-error", 1, { ...errorBase, [field]: "forbidden" }));
  }

  const errors = expectFailure(
    registry.validate("fact-state", 1, fact({ state: "sensitive-input-value" })),
    "CONTRACT_PAYLOAD_INVALID",
  );
  assert.equal(JSON.stringify(errors).includes("sensitive-input-value"), false);
});

test("MCV1-T08 envelopes dispatch object payloads by exact current descriptor version", async (t) => {
  const registry = builtinRegistry();
  const validEnvelope = envelope({
    config_ref: {
      config_id: "config:001",
      version: 1,
      domain: "model",
      source: "run",
    },
    budget_ref: {
      budget_id: "budget:001",
      version: 2,
      source: "book",
    },
  });
  expectOk(registry.validateEnvelope(validEnvelope));
  expectOk(registry.validate("fact-state", 1, validEnvelope.data));
  expectFailure(
    registry.validateEnvelope({ ...validEnvelope, data_schema_id: "not-registered" }),
    "CONTRACT_NOT_FOUND",
  );
  expectFailure(
    registry.validateEnvelope({ ...validEnvelope, data_schema_version: 2 }),
    "CONTRACT_NOT_FOUND",
  );
  expectFailure(
    registry.validateEnvelope({ ...validEnvelope, data: fact({ state: "invalid-state" }) }),
    "CONTRACT_PAYLOAD_INVALID",
  );
  expectFailure(
    registry.validateEnvelope({
      ...validEnvelope,
      data_schema_id: "local-operator-ref",
      data: fact(),
    }),
  );

  const root = await fixtureRoot(t, { copyBuiltins: true });
  const builtinDescriptors = expectOk(loadBuiltinSchemaDescriptors({ packageRoot: root }));
  const stringSchema = {
    $schema: DRAFT_2020_12,
    $id: schemaUri("string-target", 1),
    type: "string",
  };
  const booleanSchema = {
    $schema: DRAFT_2020_12,
    $id: schemaUri("boolean-target", 1),
    type: "boolean",
  };
  const stringDescriptor = await addFixtureSchema(root, "string-target", 1, stringSchema);
  const booleanDescriptor = await addFixtureSchema(root, "boolean-target", 1, booleanSchema);
  const primitiveRegistry = expectOk(createSchemaRegistry(
    [...builtinDescriptors, stringDescriptor, booleanDescriptor],
    { packageRoot: root },
  ));
  expectOk(primitiveRegistry.validate("string-target", 1, "primitive"));
  expectOk(primitiveRegistry.validate("boolean-target", 1, true));
  expectFailure(
    primitiveRegistry.validateEnvelope(envelope({
      data_schema_id: "string-target",
      data: "primitive",
    })),
    "CONTRACT_PAYLOAD_INVALID",
  );
  expectFailure(
    primitiveRegistry.validateEnvelope(envelope({
      data_schema_id: "boolean-target",
      data: true,
    })),
    "CONTRACT_PAYLOAD_INVALID",
  );
});

test("MCV1-T09 retry_index requires model_attempt_id and a nonnegative integer", () => {
  const registry = builtinRegistry();
  expectOk(registry.validateEnvelope(envelope()));
  expectOk(registry.validateEnvelope(envelope({ model_attempt_id: "attempt:001" })));
  expectOk(registry.validateEnvelope(envelope({ model_attempt_id: "attempt:001", retry_index: 0 })));
  expectOk(registry.validateEnvelope(envelope({ model_attempt_id: "attempt:001", retry_index: 2 })));
  expectFailure(registry.validateEnvelope(envelope({ retry_index: 0 })), "CONTRACT_PAYLOAD_INVALID");
  expectFailure(
    registry.validateEnvelope(envelope({ model_attempt_id: "attempt:001", retry_index: -1 })),
    "CONTRACT_PAYLOAD_INVALID",
  );
  expectFailure(
    registry.validateEnvelope(envelope({ model_attempt_id: "attempt:001", retry_index: 1.5 })),
    "CONTRACT_PAYLOAD_INVALID",
  );
});

test("MCV1-T10 FactState shapes and candidate, shadow, formal transitions are deterministic", () => {
  const registry = builtinRegistry();
  for (const state of ["candidate", "shadow", "formal"]) {
    expectOk(registry.validate("fact-state", 1, fact({ state })));
  }
  expectOk(registry.validate("fact-state", 1, fact({
    fact_version: 2,
    replaces_version: 1,
    state_version: 3,
  })));
  expectFailure(registry.validate("fact-state", 1, fact({ fact_version: 2 })));
  expectFailure(registry.validate("fact-state", 1, fact({ replaces_version: 1 })));
  expectFailure(registry.validate("fact-state", 1, fact({ state_version: -1 })));
  expectFailure(registry.validate("fact-state", 1, fact({ state_version: 1.5 })));

  assert.equal(isFactStateTransitionAllowed(null, "candidate"), true);
  assert.equal(isFactStateTransitionAllowed(null, "shadow"), false);
  assert.equal(isFactStateTransitionAllowed(null, "formal"), false);
  assert.equal(isFactStateTransitionAllowed("candidate", "formal"), true);
  assert.equal(isFactStateTransitionAllowed("candidate", "shadow"), true);
  assert.equal(isFactStateTransitionAllowed("candidate", "candidate"), false);
  assert.equal(isFactStateTransitionAllowed("formal", "shadow"), false);
  assert.equal(isFactStateTransitionAllowed("formal", "shadow", true), true);
  assert.equal(isFactStateTransitionAllowed("formal", "candidate", true), false);
  assert.equal(isFactStateTransitionAllowed("formal", "formal", true), false);
  for (const state of ["candidate", "shadow", "formal"]) {
    assert.equal(isFactStateTransitionAllowed("shadow", state, true), false);
  }
});

test("MCV1-T11 legacy finalized and deduction fields plus unknown states are rejected", () => {
  const registry = builtinRegistry();
  expectFailure(
    registry.validate("fact-state", 1, fact({ state: "finalized" })),
    "CONTRACT_PAYLOAD_INVALID",
  );
  expectFailure(
    registry.validate("fact-state", 1, fact({ finalized: true })),
    "CONTRACT_UNKNOWN_FIELD",
  );
  expectFailure(
    registry.validate("fact-state", 1, fact({ is_finalized: true })),
    "CONTRACT_DEPRECATED_FIELD",
  );
  expectFailure(
    registry.validate("fact-state", 1, fact({ deduction_locked: true })),
    "CONTRACT_DEPRECATED_FIELD",
  );
  expectFailure(
    registry.validate("fact-state", 1, fact({ state: "archived" })),
    "CONTRACT_PAYLOAD_INVALID",
  );
});

test("MCV1-T12 all four version references enforce exact fields, enums, and closed objects", () => {
  const registry = builtinRegistry();
  const cases = [
    ["local-operator-ref", { local_operator_id: "operator:001" }],
    [
      "config-version-ref",
      { config_id: "config:001", version: 1, domain: "presentation", source: "local_operator" },
    ],
    ["budget-version-ref", { budget_id: "budget:001", version: 1, source: "system_default" }],
    ["skill-version-ref", { skill_id: "skill:001", version: 1, source: "system_builtin" }],
  ];

  for (const [schemaId, value] of cases) {
    expectOk(registry.validate(schemaId, 1, value));
    const firstKey = Object.keys(value)[0];
    expectFailure(registry.validate(schemaId, 1, omit(value, firstKey)));
    expectFailure(registry.validate(schemaId, 1, { ...value, owner: "GLOBAL::CONTRACTS" }));
    expectFailure(registry.validate(schemaId, 1, { ...value, lifecycle_state: "active" }));
  }

  for (const domain of ["prompt", "model", "budget", "automation", "presentation"]) {
    expectOk(registry.validate("config-version-ref", 1, {
      config_id: "config:001",
      version: 1,
      domain,
      source: "run",
    }));
  }
  for (const source of ["system_default", "local_operator", "book", "run"]) {
    expectOk(registry.validate("budget-version-ref", 1, {
      budget_id: "budget:001",
      version: 1,
      source,
    }));
  }
  expectFailure(registry.validate("config-version-ref", 1, {
    config_id: "config:001",
    version: 0,
    domain: "prompt",
    source: "book",
  }));
  expectFailure(registry.validate("config-version-ref", 1, {
    config_id: "config:001",
    version: 1,
    domain: "unknown",
    source: "book",
  }));
  expectFailure(registry.validate("skill-version-ref", 1, {
    skill_id: "skill:001",
    version: 1,
    source: "book",
  }));
});

test("MCV1-T13 public exports and schemas contain no superseded governance surface", async () => {
  assert.deepEqual(Object.keys(contracts).sort(), [
    "CONTRACT_ERROR_CODES",
    "ContractValidator",
    "DRAFT_2020_12",
    "OWNER_KEY_PATTERN",
    "PG_RUNTIME_GUARD_ERROR_CODES",
    "STABLE_ID_PATTERN",
    "SchemaRegistry",
    "compareSchemaDescriptors",
    "createBuiltinSchemaRegistry",
    "createSchemaRegistry",
    "isFactStateTransitionAllowed",
    "loadBuiltinSchemaDescriptors",
    "pgRuntimeGuardContracts",
    "pgRuntimeGuardErrorSchema",
  ]);

  const sourceFiles = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(entryPath);
      else sourceFiles.push(entryPath);
    }
  }
  await collect(path.join(PACKAGE_ROOT, "src"));
  const source = (await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))).join("\n");
  for (const banned of [
    /ProblemDetails/i,
    /CloudEvents?/i,
    /EventRegistry/i,
    /ErrorRegistry/i,
    /\bextensions?\b/i,
    /\bdelivery\b/i,
    /\bdedup(?:lication)?\b/i,
    /\bsemver\b/i,
    /\b(?:backward|forward)[_-]?compatible\b/i,
    /\bbreaking[_-]?change\b/i,
  ]) {
    assert.equal(banned.test(source), false, `Found banned source surface: ${banned}`);
  }

  const registry = builtinRegistry();
  for (const field of ["specversion", "detail", "extensions", "delivery", "dedup_key", "registry"] ) {
    expectFailure(registry.validateEnvelope({ ...envelope(), [field]: "forbidden" }), "CONTRACT_UNKNOWN_FIELD");
  }
});

test("MCV1-T15 package self-reference exports closed PostgreSQL runtime guard contracts", async () => {
  assert.deepEqual(Object.keys(contracts.pgRuntimeGuardContracts).sort(), [
    "acquire",
    "guardedWrite",
    "release",
    "renew",
    "validate",
  ]);
  assert.deepEqual(contracts.PG_RUNTIME_GUARD_ERROR_CODES, [
    "INPUT_INVALID",
    "LOCK_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "STALE_VERSION",
    "INTERNAL_ERROR",
  ]);
  assert.equal(contracts.pgRuntimeGuardErrorSchema.additionalProperties, false);
  assert.deepEqual(contracts.pgRuntimeGuardErrorSchema.required, ["code", "message"]);
  for (const contract of Object.values(contracts.pgRuntimeGuardContracts)) {
    assert.equal(contract.request.additionalProperties, false);
    assert.ok(contract.response);
  }
  const declarations = await readFile(path.join(PACKAGE_ROOT, "dist", "src", "index.d.ts"), "utf8");
  for (const typeName of ["PgRuntimeGuardError", "PgRuntimeGuardErrorCode", "PgRuntimeGuardOperation"]) {
    assert.match(declarations, new RegExp(`\\b${typeName}\\b`));
  }
});

test("MCV1-T14 package test entry is real and core validation is repeatable", async () => {
  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.test, "pnpm run build && node --test test/contracts.test.js");

  const inputDescriptors = expectOk(loadBuiltinSchemaDescriptors({ packageRoot: PACKAGE_ROOT }));
  const factInput = inputDescriptors.find((descriptor) => descriptor.schema_id === "fact-state");
  assert.ok(factInput);
  const originalHash = factInput.sha256;
  const immutableRegistry = expectOk(createSchemaRegistry(inputDescriptors, { packageRoot: PACKAGE_ROOT }));
  factInput.status = "deprecated";
  factInput.sha256 = "0".repeat(64);
  factInput.deprecated_fields.push({ path: "/state", since_version: 1 });

  expectOk(immutableRegistry.validate("fact-state", 1, fact()));
  const listedFact = immutableRegistry.listDescriptors()
    .find((descriptor) => descriptor.schema_id === "fact-state");
  assert.ok(listedFact);
  assert.equal(listedFact.status, "active");
  assert.equal(listedFact.sha256, originalHash);
  assert.equal(Object.isFrozen(listedFact), true);
  assert.equal(Object.isFrozen(listedFact.deprecated_fields), true);
  assert.throws(() => {
    listedFact.status = "deprecated";
  }, TypeError);

  const exact = expectOk(immutableRegistry.getExact("fact-state", 1));
  assert.equal(Object.isFrozen(exact), true);
  assert.equal(Object.isFrozen(exact.schema), true);
  assert.equal(Object.isFrozen(exact.descriptor), true);
  assert.equal(Object.isFrozen(exact.schema.properties.state.enum), true);
  assert.throws(() => {
    exact.schema.properties.state.enum.push("archived");
  }, TypeError);
  expectFailure(
    immutableRegistry.validate("fact-state", 1, fact({ state: "archived" })),
    "CONTRACT_PAYLOAD_INVALID",
  );
  assert.equal(expectOk(immutableRegistry.getCurrent("fact-state")).descriptor.status, "active");

  const snapshots = [];
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const registry = builtinRegistry();
    expectOk(registry.validateEnvelope(envelope()));
    snapshots.push(JSON.stringify(registry.listDescriptors()));
  }
  assert.equal(snapshots[0], snapshots[1]);
});
