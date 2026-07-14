import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const tool = join(root, "tools", "mvp-plan.mjs");
const baseCommit = "1a6ffbb965e76b2b4770b941397ab4c408fd336b";
const migrationScopeReplacements = new Map([
  ["pg-runtime-guards", "pg_runtime_guards"],
  ["runtime-seeds", "runtime_seeds"],
  ["new-book", "new_book"],
  ["production-stage", "production_stage"],
  ["multi-agent-deduction", "multi_agent_deduction"],
  ["audit-review", "audit_review"],
  ["audit-stage", "audit_stage"]
]);
const protectedInputs = [
  join(root, "docs", "MVP_IMPLEMENTATION_PLAN_R3.md"),
  join(root, "docs", "MVP_TASK_INDEX_R3.json"),
  join(root, "docs", "FEATURE_CANDIDATES.md"),
  join(root, "docs", "IMPLEMENTATION_CONTROL.md"),
  join(root, "docs", "R3_EXECUTION_HANDOFF.md")
];

function run(command) {
  return JSON.parse(execFileSync(process.execPath, [tool, command], { cwd: root, encoding: "utf8" }));
}

function digest(paths) {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(readFileSync(path));
  return hash.digest("hex");
}

function semanticDifferences(before, after, path = "$") {
  if (Array.isArray(before) || Array.isArray(after)) {
    assert.ok(Array.isArray(before) && Array.isArray(after), `array type changed at ${path}`);
    assert.equal(after.length, before.length, `array length changed at ${path}`);
    return before.flatMap((value, index) => semanticDifferences(value, after[index], `${path}[${index}]`));
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), `object keys changed at ${path}`);
    return Object.keys(before).flatMap((key) => semanticDifferences(before[key], after[key], `${path}.${key}`));
  }
  return before === after ? [] : [{ path, before, after }];
}

function protectedTaskContract(index) {
  return {
    dag: index.tasks.map((task) => ({ id: task.id, depends_on: task.depends_on })),
    statuses: index.tasks.map((task) => ({ id: task.id, status: task.status })),
    counts: index.counts,
    acceptance: index.tasks.map((task) => ({ id: task.id, acceptance: task.acceptance })),
    v7_anchors: index.tasks.map((task) => ({ id: task.id, v7_anchors: task.v7_anchors })),
    page_contracts: index.tasks.map((task) => ({ id: task.id, page_contract: task.page_contract })),
    task_models: index.tasks.map((task) => ({ id: task.id, model: task.model })),
    model_routing: index.model_routing
  };
}

test("check validates the exact active R3 plan and old 85 mapping", () => {
  const result = run("check");
  assert.equal(result.ok, true);
  assert.equal(result.task_count, 13);
  assert.equal(result.ready_count, 2);
  assert.equal(result.planned_count, 11);
  assert.equal(result.historical_task_count, 85);
  assert.equal(result.mapping_count, 85);
  assert.equal(result.candidate_count, 22);
  assert.deepEqual(result.high_code_tasks, ["S4-MULTI-AGENT-DEDUCTION-PAGE"]);
  assert.equal(result.page_task_count, 9);
  assert.equal(result.requested_model, "gpt-5.6-terra");
  const index = JSON.parse(readFileSync(join(root, "docs", "MVP_TASK_INDEX_R3.json"), "utf8"));
  assert.equal(index.resources.max_concurrent_delegated_tasks, 10);
  assert.equal(index.resources.max_disjoint_coders, 2);
});

test("page-owned R3 preserves FP005-01, FP013-01, and observability deferral semantics", () => {
  const index = JSON.parse(readFileSync(join(root, "docs", "MVP_TASK_INDEX_R3.json"), "utf8"));
  const taskById = new Map(index.tasks.map((task) => [task.id, task]));
  const production = taskById.get("S3-PRODUCTION-STAGE-PAGE").business_contracts.scene_condition_package;
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
  assert.deepEqual(taskById.get("S3-PRODUCTION-STAGE-PAGE").business_contracts.chapter_plan.consumes, ["scene_condition_package_version"]);

  const editor = taskById.get("S5-AUDIT-STAGE-PAGE").business_contracts.editor_release;
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

test("nine page Tasks have exclusive prototype ownership and terra audit routing", () => {
  const index = JSON.parse(readFileSync(join(root, "docs", "MVP_TASK_INDEX_R3.json"), "utf8"));
  const pageTasks = index.tasks.filter((task) => task.page_contract);
  assert.equal(pageTasks.length, 9);
  assert.equal(new Set(pageTasks.map((task) => task.page_contract.page_id)).size, 9);
  assert.equal(new Set(pageTasks.map((task) => task.page_contract.route)).size, 9);
  assert.equal(new Set(pageTasks.map((task) => task.page_contract.prototype)).size, 9);
  assert.ok(pageTasks.every((task) => task.page_contract.owns_page_exclusively));
  assert.ok(pageTasks.every((task) => task.acceptance.some((item) => item.includes("真实浏览器"))));
  assert.ok(Object.values(index.model_routing.roles).every((model) => model === "gpt-5.6-terra"));
  assert.ok(index.tasks.every((task) => task.model.requested_model === "gpt-5.6-terra"));
  const dispatched = index.tasks.filter((task) => task.status === "READY");
  assert.ok(dispatched.every((task) => task.model.actual_model === "gpt-5.6-terra"));
  assert.ok(dispatched.every((task) => task.model.actual_model_source.type === "PLATFORM_SESSION_TURN_CONTEXT"));
  assert.equal(new Set(dispatched.map((task) => task.model.actual_model_source.delegated_thread_id)).size, 2);
});

test("migration scopes use registered loader-safe slugs without changing R3 task semantics", () => {
  const indexPath = join(root, "docs", "MVP_TASK_INDEX_R3.json");
  const baseline = JSON.parse(execFileSync("git", ["show", `${baseCommit}:docs/MVP_TASK_INDEX_R3.json`], { cwd: root, encoding: "utf8" }));
  const current = JSON.parse(readFileSync(indexPath, "utf8"));
  const differences = semanticDifferences(baseline, current);
  assert.equal(differences.length, 7);
  assert.ok(differences.every((difference) => difference.path.includes(".write_scope[")));
  assert.deepEqual(
    differences.map(({ before, after }) => [before, after]).sort(),
    [...migrationScopeReplacements].map(([before, after]) => [
      `db/migrations/*__${before}__*.sql`,
      `db/migrations/*__${after}__*.sql`
    ]).sort()
  );
  assert.deepEqual(protectedTaskContract(current), protectedTaskContract(baseline));

  const loaderSource = readFileSync(join(root, "packages", "db", "src", "database.mjs"), "utf8");
  assert.ok(loaderSource.includes(String.raw`/^(\d{4})__([a-z0-9_]+)\.sql$/`));
  const loaderFilenamePattern = /^(\d{4})__([a-z0-9_]+)\.sql$/u;
  const migrationScopes = current.tasks.flatMap((task) => task.write_scope.filter((scope) => scope.startsWith("db/migrations/")));
  const slugs = migrationScopes.map((scope) => /^db\/migrations\/\*__([a-z0-9_]+)__\*\.sql$/u.exec(scope)?.[1]);
  assert.equal(slugs.length, 11);
  assert.ok(slugs.every((slug) => slug && !slug.includes("-") && loaderFilenamePattern.test(`0001__${slug}.sql`)));
  assert.deepEqual(
    slugs.filter((slug) => [...migrationScopeReplacements.values()].includes(slug)).sort(),
    [...migrationScopeReplacements.values()].sort()
  );
});

test("status reports the two initial READY tasks and no single selected task", () => {
  const result = run("status");
  assert.equal(result.execution_status, "ACTIVE");
  assert.deepEqual(result.counts, { ready: 2, planned: 11, total: 13 });
  assert.equal(result.selected_task, null);
  assert.deepEqual(result.ready_tasks, ["F0-05-PG-RUNTIME-GUARDS", "F0-06-N8N-PRODUCTION-BASE"]);
  assert.equal(result.may_start_product_task, true);
});

test("dry-run is read-only and cannot select work", () => {
  const before = digest(protectedInputs);
  const result = run("dry-run");
  const after = digest(protectedInputs);
  assert.equal(result.execution_status, "ACTIVE");
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
    "unexpected-ready-task",
    "mapping-duplicate",
    "missing-n8n-scope",
    "migration-scope-format",
    "migration-scope-mapping",
    "second-high-code-task",
    "native-client-scope",
    "unknown-dependency",
    "scene-package-source",
    "scene-package-rejection",
    "scene-package-consumer",
    "editor-release-order",
    "observability-mapping",
    "non-terra-role",
    "unbound-actual-model",
    "duplicate-page-owner",
    "prototype-hash-drift",
    "visual-audit-removed"
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
