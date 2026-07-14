import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const tool = join(root, "tools", "mvp-plan.mjs");
const protectedInputs = [
  join(root, "docs", "MVP_IMPLEMENTATION_PLAN_R3.md"),
  join(root, "docs", "MVP_TASK_INDEX_R3.json"),
  join(root, "docs", "FEATURE_CANDIDATES.md"),
  join(root, "docs", "IMPLEMENTATION_CONTROL.md")
];

function run(command) {
  return JSON.parse(execFileSync(process.execPath, [tool, command], { cwd: root, encoding: "utf8" }));
}

function digest(paths) {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(readFileSync(path));
  return hash.digest("hex");
}

test("check validates the exact paused R3 plan and old 85 mapping", () => {
  const result = run("check");
  assert.equal(result.ok, true);
  assert.equal(result.task_count, 19);
  assert.equal(result.ready_count, 0);
  assert.equal(result.planned_count, 19);
  assert.equal(result.historical_task_count, 85);
  assert.equal(result.mapping_count, 85);
  assert.equal(result.candidate_count, 22);
  assert.deepEqual(result.high_code_tasks, ["S4-DEDUCTION-RUNTIME"]);
});

test("Round 1 preserves FP005-01, FP013-01, and observability deferral semantics", () => {
  const index = JSON.parse(readFileSync(join(root, "docs", "MVP_TASK_INDEX_R3.json"), "utf8"));
  const taskById = new Map(index.tasks.map((task) => [task.id, task]));
  const production = taskById.get("S3-PRODUCTION-START").business_contract;
  assert.equal(production.output, "scene_condition_package_version");
  assert.deepEqual(production.materializes_on_start_from, [
    "formal_world_version",
    "formal_character_versions",
    "formal_relationship_versions",
    "valid_formal_memory_versions",
    "locked_l1a_version",
    "effective_config_version"
  ]);
  assert.deepEqual(production.rejects, [
    "future_state_leakage",
    "unavailable_resource",
    "character_knowledge_overreach",
    "missing_scene",
    "unresolved_data_debt"
  ]);
  assert.deepEqual(taskById.get("S3-CHAPTER-PLAN").business_contract.consumes, ["scene_condition_package_version"]);

  const editor = taskById.get("S5-EDITOR-REVISION").business_contract;
  assert.deepEqual(editor.y_release_sequence, [
    "FP013-01_FACT_PRESERVING_STYLE_ENHANCEMENT",
    "REQUIRE_NONEMPTY_FORMAL_SUMMARY",
    "ENFORCE_CHANGE_LIMIT",
    "MARK_RELEASED"
  ]);
  assert.equal(editor.invalid_enhancement, "DISCARD_AND_DO_NOT_RELEASE");
  assert.equal(editor.n3_terminal, "abandoned_by_user");

  assert.ok(index.feature_candidates.some((candidate) => candidate.id === "CAND-OUTSIDE-ADVANCED-OBSERVABILITY"));
  assert.deepEqual(
    index.old85_to_r3.find((mapping) => mapping.old_task_id === "F0-06-OBSERVABILITY"),
    {
      old_task_id: "F0-06-OBSERVABILITY",
      target_type: "FEATURE_CANDIDATE",
      target_id: "CAND-OUTSIDE-ADVANCED-OBSERVABILITY"
    }
  );
});

test("status reports creator pause and no selected task", () => {
  const result = run("status");
  assert.equal(result.execution_status, "PAUSED_BY_CREATOR");
  assert.deepEqual(result.counts, { ready: 0, planned: 19, total: 19 });
  assert.equal(result.selected_task, null);
  assert.deepEqual(result.ready_tasks, []);
  assert.equal(result.may_start_product_task, false);
});

test("dry-run is read-only and cannot select work", () => {
  const before = digest(protectedInputs);
  const result = run("dry-run");
  const after = digest(protectedInputs);
  assert.equal(result.execution_status, "PAUSED_BY_CREATOR");
  assert.equal(result.selected_task, null);
  assert.equal(result.side_effects, false);
  assert.equal(after, before);
});

test("self-test rejects unsafe mutations without writing state", () => {
  const before = digest(protectedInputs);
  const result = run("--self-test");
  const after = digest(protectedInputs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rejected_mutations, [
    "ready-task",
    "mapping-duplicate",
    "missing-n8n-scope",
    "second-high-code-task",
    "native-client-scope",
    "unknown-dependency",
    "scene-package-source",
    "scene-package-rejection",
    "scene-package-consumer",
    "editor-release-order",
    "observability-mapping"
  ]);
  assert.equal(after, before);
});

test("state-changing commands are not implemented", () => {
  for (const command of ["start", "lease", "transition"]) {
    const result = spawnSync(process.execPath, [tool, command], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported command/u);
  }
});
