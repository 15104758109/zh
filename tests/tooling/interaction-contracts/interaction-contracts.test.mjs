import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as interactionContracts from "../../../packages/interaction-contracts/dist/src/index.js";
import { DEFAULT_COVERAGE_MODEL, lintContract, parseInteractionYaml } from "../../../packages/interaction-contracts/dist/src/index.js";
import { runInteractionLint } from "../../../scripts/interaction-contract-lint/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(await readFile(path.join(ROOT, "contracts/interactions/schema/interaction-contract.schema.json"), "utf8"));
const ACTIVE_COMMANDS = [
  ["RPC-001", "rpc_create_book_project"], ["RPC-002", "rpc_commit_world_settings"], ["RPC-003", "rpc_commit_character_settings"], ["RPC-004", "rpc_generate_l1a_conflicts"], ["RPC-005", "rpc_finalize_l1a"], ["RPC-007", "rpc_persist_chapter_execution_plan"], ["RPC-009", "rpc_finalize_deduction_snapshot"], ["RPC-010", "rpc_persist_candidate_text"], ["RPC-011", "rpc_execute_audit"], ["RPC-012", "rpc_confirm_audit_result"], ["RPC-013", "rpc_archive_shadow_version"], ["RPC-014", "rpc_enhance_prose"], ["RPC-015", "rpc_commit_chapter"], ["RPC-016", "rpc_promote_prompt_config"],
];

function validContract(overrides = {}) {
  return { version: 1, contract_id: "FP001-01", owner: "S1-FP001-01", object_scope: { local_operator_id: "required", book_id: "required" }, actions: [{ id: "create_project", prerequisites: ["operator_ready"], backend_command: { registry_id: "RPC-001", command_id: "rpc_create_book_project" }, success: { result: "project_created", state_change: true }, failure: { code: "duplicate", message: "Choose another title." }, recovery: { strategy: "correct_input" }, permission: { source: "object_scope", enforcement: "backend" }, projection: { mode: "readonly", fields: ["project_id"] } }], ...overrides };
}
function yaml(contract) {
  const action = contract.actions[0];
  return `version: ${contract.version}\ncontract_id: ${contract.contract_id}\nowner: ${contract.owner}\nobject_scope:\n  local_operator_id: ${contract.object_scope.local_operator_id}\n  book_id: ${contract.object_scope.book_id}\nactions:\n  - id: ${action.id}\n    prerequisites:\n      - ${action.prerequisites[0]}\n    backend_command:\n      registry_id: ${action.backend_command.registry_id}\n      command_id: ${action.backend_command.command_id}\n    success:\n      result: ${action.success.result}\n      state_change: ${action.success.state_change}\n    failure:\n      code: ${action.failure.code}\n      message: ${action.failure.message}\n    recovery:\n      strategy: ${action.recovery.strategy}\n    permission:\n      source: ${action.permission.source}\n      enforcement: ${action.permission.enforcement}\n    projection:\n      mode: ${action.projection.mode}\n      fields:\n        - ${action.projection.fields[0]}\n`;
}

test("active registry pairs pass; deprecated and fake command names fail", () => {
  for (const [registry_id, command_id] of ACTIVE_COMMANDS) assert.deepEqual(lintContract(validContract({ actions: [{ ...validContract().actions[0], backend_command: { registry_id, command_id } }] }), schema), []);
  for (const backend_command of [{ registry_id: "RPC-006", command_id: "rpc_create_chapter_target" }, { registry_id: "RPC-008", command_id: "rpc_persist_deduction_draft" }, { registry_id: "RPC-001", command_id: "rpc_fake" }]) assert.ok(lintContract(validContract({ actions: [{ ...validContract().actions[0], backend_command }] }), schema).length > 0);
});

test("loaded Draft 2020-12 schema, not only its id, controls validation", () => {
  assert.deepEqual(lintContract(validContract(), schema), []);
  assert.ok(lintContract(validContract(), { $id: schema.$id, not: {} }, "x.yaml").length > 0);
  assert.equal(DEFAULT_COVERAGE_MODEL.active.length, 50);
});

test("Reviewer malformed 50/50 counterexample cannot become covered", () => {
  const malformed = Array.from({ length: 50 }, (_, index) => validContract({ contract_id: DEFAULT_COVERAGE_MODEL.active[index].id, owner: DEFAULT_COVERAGE_MODEL.active[index].owner, actions: [{ ...validContract().actions[0], prerequisites: [index], backend_command: { registry_id: "RPC-001", command_id: "rpc_fake" }, success: {}, failure: {}, recovery: {}, permission: {}, projection: { mode: "mutable", fields: [] }, extra: true }], object_scope: { local_operator_id: index, unknown: "required" } }));
  assert.ok(malformed.flatMap((contract) => lintContract(contract, schema)).length >= 50);
});

test("tab-indented YAML is rejected and 50 invalid files cannot report coverage", async () => {
  const single = yaml(validContract()).replace("\n  local_operator_id", "\n\tlocal_operator_id");
  assert.throws(() => parseInteractionYaml(single), /Tab indentation/);
  const quotedTab = yaml(validContract()).replace("Choose another title.", '"Choose\tanother title."');
  assert.deepEqual(lintContract(parseInteractionYaml(quotedTab), schema), []);
  const root = await mkdtemp(path.join(tmpdir(), "interaction-contract-tabs-"));
  for (const item of DEFAULT_COVERAGE_MODEL.active) {
    const contract = validContract({ contract_id: item.id, owner: item.owner });
    await writeFile(path.join(root, `${item.id.toLowerCase()}.yaml`), yaml(contract).replace("\n  local_operator_id", "\n\tlocal_operator_id"));
  }
  const result = await runInteractionLint({ contractsDirectory: root, enforceCoverage: true });
  assert.equal(result.files, 50);
  assert.equal(result.ok, false);
  assert.equal(result.coverage.covered_active_fp_count, 0);
  assert.equal(result.coverage.missing_active_fp.length, 50);
});

test("file identity, duplicate ids, and invalid records do not count as coverage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "interaction-contracts-"));
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "fp001-01.yaml"), yaml(validContract({ actions: [{ ...validContract().actions[0], backend_command: { registry_id: "RPC-001", command_id: "rpc_fake" } }] })));
  await writeFile(path.join(root, "fp001-02.yaml"), yaml(validContract()));
  const result = await runInteractionLint({ contractsDirectory: root });
  assert.equal(result.ok, false);
  assert.equal(result.coverage.covered_active_fp_count, 0);
  assert.ok(result.issues.some((item) => item.code === "FILE_IDENTITY"));
  assert.ok(result.issues.some((item) => item.code === "DUPLICATE_CONTRACT_ID"));
});

test("owner, duplicate YAML keys, and 0/50 reporting remain explicit", async () => {
  assert.ok(lintContract(validContract({ owner: "S7-FP017-01" }), schema).some((item) => item.code === "OWNER_MISMATCH"));
  assert.throws(() => parseInteractionYaml(`${yaml(validContract())}owner: S1-FP001-01`), /Duplicate YAML key/);
  const root = await mkdtemp(path.join(tmpdir(), "interaction-contracts-"));
  assert.equal("coverageReport" in interactionContracts, false);
  assert.throws(() => interactionContracts.coverageReport([{ contract_id: "FP001-01" }]));
  const report = await runInteractionLint({ contractsDirectory: root });
  assert.equal(report.coverage.active_fp_count, 50);
  assert.equal(report.coverage.covered_active_fp_count, 0);
  assert.equal(report.coverage.merged_responsibilities[0].status, "merged");
  assert.equal(report.ok, true);
  assert.equal((await runInteractionLint({ contractsDirectory: root, enforceCoverage: true })).ok, false);
});
