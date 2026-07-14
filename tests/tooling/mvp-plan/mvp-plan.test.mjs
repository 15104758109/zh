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
  assert.deepEqual(result.high_code_tasks, ["S4-DEDUCTION-RUNTIME"]);
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
    "unknown-dependency"
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
