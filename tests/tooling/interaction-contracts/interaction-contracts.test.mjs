import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  coverageReport,
  lintContract,
  parseInteractionYaml,
} from "../../../packages/interaction-contracts/dist/src/index.js";
import { runInteractionLint } from "../../../scripts/interaction-contract-lint/index.mjs";

const OWNER = "S1-FP001-01";
const MODEL = { active: [{ id: "FP001-01", owner: OWNER }, { id: "FP007-01", owner: "S3-FP007-01" }] };

function validContract(overrides = {}) {
  return {
    version: 1,
    contract_id: "FP001-01",
    owner: OWNER,
    object_scope: { local_operator_id: "required", book_id: "new" },
    actions: [{
      id: "create_draft",
      prerequisites: ["local_operator_available"],
      backend_command: "rpc_create_book_draft",
      failure: { code: "duplicate_name" },
      recovery: { action: "correct_name" },
      projection: { mode: "readonly", fields: ["draft_id"] },
    }],
    ...overrides,
  };
}

test("valid interaction contract passes all required behavioral checks", () => {
  assert.deepEqual(lintContract(validContract(), "fp001-01.yaml", OWNER), []);
});

test("missing prerequisites, controlled command, failure, recovery, scope, owner and readonly projection fail", () => {
  const cases = [
    ["prerequisites", { prerequisites: [] }, "PREREQUISITES"],
    ["backend command", { backend_command: "display_success" }, "BACKEND_COMMAND"],
    ["failure", { failure: undefined }, "FAILURE"],
    ["recovery", { recovery: undefined }, "RECOVERY"],
    ["readonly projection", { projection: { mode: "mutable" } }, "READONLY_PROJECTION"],
  ];
  for (const [, actionOverride, code] of cases) {
    const action = { ...validContract().actions[0], ...actionOverride };
    assert.ok(lintContract(validContract({ actions: [action] }), "x.yaml", OWNER).some((item) => item.code === code));
  }
  assert.ok(lintContract(validContract({ object_scope: {} }), "x.yaml", OWNER).some((item) => item.code === "OBJECT_SCOPE"));
  assert.ok(lintContract(validContract({ owner: "S2-FP001-01" }), "x.yaml", OWNER).some((item) => item.code === "OWNER_MISMATCH"));
});

test("YAML parser accepts an authored contract without inferring any business action", () => {
  const parsed = parseInteractionYaml(`version: 1\ncontract_id: FP001-01\nowner: S1-FP001-01\nobject_scope:\n  local_operator_id: required\nactions:\n  - id: create_draft\n    prerequisites:\n      - local_operator_available\n    backend_command: rpc_create_book_draft\n    failure:\n      code: duplicate_name\n    recovery:\n      action: correct_name\n    projection:\n      mode: readonly\n`);
  assert.deepEqual(lintContract(parsed, "fp001-01.yaml", OWNER), []);
});

test("coverage reports real missing contracts and the merged FP007-02 responsibility", () => {
  const report = coverageReport([validContract()], MODEL);
  assert.equal(report.active_fp_count, 2);
  assert.deepEqual(report.missing_active_fp, ["FP007-01"]);
  assert.deepEqual(report.merged_responsibilities, [{ id: "FP007-02", owner: "S3-FP007-01", status: "merged", independent_contract_required: false }]);
});

test("CLI lint remains red for contract coverage gaps", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "interaction-contracts-"));
  const directory = path.join(root, "contracts");
  await mkdir(directory);
  await writeFile(path.join(directory, "fp001-01.yaml"), JSON.stringify(validContract()));
  const result = await runInteractionLint({ contractsDirectory: directory, coverageModel: MODEL });
  assert.equal(result.ok, false);
  assert.deepEqual(result.coverage.missing_active_fp, ["FP007-01"]);
});
