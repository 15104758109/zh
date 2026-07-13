import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_COVERAGE_MODEL, coverageReport, lintContract, parseInteractionYaml } from "../../../packages/interaction-contracts/dist/src/index.js";
import { runInteractionLint } from "../../../scripts/interaction-contract-lint/index.mjs";

const schema = { $id: "urn:zhreplan:interaction-contract:1" };
function validContract(overrides = {}) {
  return { version: 1, contract_id: "FP001-01", owner: "S1-FP001-01", object_scope: { local_operator_id: "required", book_id: "required" }, actions: [{ id: "create_draft", prerequisites: ["operator_ready"], backend_command: { registry_id: "RPC-001", command_id: "create_book" }, success: { result: "draft_created", state_change: true }, failure: { code: "duplicate", message: "Choose another title." }, recovery: { strategy: "correct_input" }, permission: { source: "object_scope", enforcement: "backend" }, projection: { mode: "readonly", fields: ["draft_id"] } }], ...overrides };
}
function yaml(contract) {
  const action = contract.actions[0];
  return `version: ${contract.version}\ncontract_id: ${contract.contract_id}\nowner: ${contract.owner}\nobject_scope:\n  local_operator_id: ${contract.object_scope.local_operator_id}\n  book_id: ${contract.object_scope.book_id}\nactions:\n  - id: ${action.id}\n    prerequisites:\n      - ${action.prerequisites[0]}\n    backend_command:\n      registry_id: ${action.backend_command.registry_id}\n      command_id: ${action.backend_command.command_id}\n    success:\n      result: ${action.success.result}\n      state_change: ${action.success.state_change}\n    failure:\n      code: ${action.failure.code}\n      message: ${action.failure.message}\n    recovery:\n      strategy: ${action.recovery.strategy}\n    permission:\n      source: ${action.permission.source}\n      enforcement: ${action.permission.enforcement}\n    projection:\n      mode: ${action.projection.mode}\n      fields:\n        - ${action.projection.fields[0]}\n`;
}

test("valid schema-backed contract passes and the default model has 50 owners", () => {
  assert.deepEqual(lintContract(validContract(), schema), []);
  assert.equal(DEFAULT_COVERAGE_MODEL.active.length, 50);
});

test("Reviewer malformed 50/50 counterexample cannot pass structural lint", () => {
  const malformed = Array.from({ length: 50 }, (_, index) => validContract({ contract_id: DEFAULT_COVERAGE_MODEL.active[index].id, owner: DEFAULT_COVERAGE_MODEL.active[index].owner }));
  malformed.forEach((contract, index) => { contract.actions[0] = { ...contract.actions[0], prerequisites: [index], backend_command: { registry_id: "RPC-999", command_id: "fake" }, success: {}, failure: {}, recovery: {}, permission: {}, projection: { mode: "mutable", fields: [] }, extra: true }; contract.object_scope = { local_operator_id: index, unknown: "required" }; });
  const issues = malformed.flatMap((contract) => lintContract(contract, schema));
  assert.ok(issues.length >= 50);
  assert.ok(issues.some((item) => item.code === "UNKNOWN_FIELD"));
  assert.ok(issues.some((item) => item.code === "BACKEND_COMMAND"));
  assert.ok(issues.some((item) => item.code === "READONLY_PROJECTION"));
});

test("wrong default Task Index owner and duplicate YAML keys fail", () => {
  assert.ok(lintContract(validContract({ owner: "S7-FP017-01" }), schema).some((item) => item.code === "OWNER_MISMATCH"));
  assert.throws(() => parseInteractionYaml(`${yaml(validContract())}owner: S1-FP001-01`), /Duplicate YAML key/);
});

test("coverage is reported but not enforced unless explicitly requested", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "interaction-contracts-"));
  const directory = path.join(root, "contracts");
  await mkdir(directory);
  const report = coverageReport([]);
  assert.equal(report.active_fp_count, 50);
  assert.equal(report.covered_active_fp_count, 0);
  assert.equal(report.merged_responsibilities[0].status, "merged");
  const result = await runInteractionLint({ contractsDirectory: directory });
  assert.equal(result.ok, true);
  assert.equal(result.coverage.missing_active_fp.length, 50);
  const enforced = await runInteractionLint({ contractsDirectory: directory, enforceCoverage: true });
  assert.equal(enforced.ok, false);
});
