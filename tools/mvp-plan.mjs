#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, "docs", "MVP_TASK_INDEX_R3.json");
const candidatesPath = join(root, "docs", "FEATURE_CANDIDATES.md");
const historicalControlPath = join(root, "docs", "IMPLEMENTATION_CONTROL.md");

const EXPECTED_TASKS = [
  "F0-05-PG-RUNTIME-GUARDS",
  "F0-06-N8N-PRODUCTION-BASE",
  "F0-07-RUNTIME-SEEDS",
  "S1-CONFIG",
  "S1-OPEN-BOOK",
  "S2-WORLD",
  "S2-CHARACTERS",
  "S2-L1A",
  "S3-PRODUCTION-START",
  "S3-CHAPTER-PLAN",
  "S3-EXECUTION-PLAN",
  "S4-INFO-PACKAGE",
  "S4-DEDUCTION-RUNTIME",
  "S4-DEDUCTION-REVIEW",
  "S5-PROSE",
  "S5-OBJECTIVE-AUDIT",
  "S5-EDITOR-REVISION",
  "S5-FORMAL-WRITEBACK",
  "MVP-GATE"
];

const SCENE_PACKAGE_SOURCES = [
  "formal_world_version",
  "formal_character_versions",
  "formal_relationship_versions",
  "valid_formal_memory_versions",
  "locked_l1a_version",
  "effective_config_version"
];

const SCENE_PACKAGE_REJECTIONS = [
  "future_state_leakage",
  "unavailable_resource",
  "character_knowledge_overreach",
  "missing_scene",
  "unresolved_data_debt"
];

const SCENE_PACKAGE_CONSUMERS = [
  "S3-CHAPTER-PLAN",
  "S3-EXECUTION-PLAN",
  "S4-INFO-PACKAGE",
  "S4-DEDUCTION-RUNTIME",
  "S4-DEDUCTION-REVIEW",
  "S5-PROSE",
  "S5-OBJECTIVE-AUDIT",
  "S5-EDITOR-REVISION",
  "S5-FORMAL-WRITEBACK",
  "MVP-GATE"
];

const EDITOR_Y_RELEASE_SEQUENCE = [
  "FP013-01_FACT_PRESERVING_STYLE_ENHANCEMENT",
  "REQUIRE_NONEMPTY_FORMAL_SUMMARY",
  "ENFORCE_CHANGE_LIMIT",
  "MARK_RELEASED"
];

const REQUIRED_TASK_FIELDS = [
  "id",
  "layer",
  "business_outcome",
  "depends_on",
  "risk",
  "model",
  "v7_anchors",
  "write_scope",
  "acceptance",
  "audit_policy",
  "implementation_mode",
  "status"
];

function loadInputs() {
  return {
    index: JSON.parse(readFileSync(indexPath, "utf8")),
    candidates: readFileSync(candidatesPath, "utf8"),
    historicalControl: readFileSync(historicalControlPath, "utf8")
  };
}

function unique(values) {
  return new Set(values).size === values.length;
}

function sameSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function historicalTaskIds(markdown) {
  const ids = [];
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(/^\| `((?:F0|W0|S[1-7])-[A-Z0-9-]+)` \|/u);
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

function hasCycle(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = tasks.find((candidate) => candidate.id === id);
    for (const dependency of task.depends_on.filter((value) => ids.has(value))) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return tasks.some((task) => visit(task.id));
}

export function validatePlan(index, candidatesMarkdown, historicalControl) {
  const errors = [];
  const taskIds = index.tasks?.map((task) => task.id) ?? [];
  const baselineIds = index.baseline_capabilities?.map((item) => item.id) ?? [];
  const candidateIds = index.feature_candidates?.map((item) => item.id) ?? [];
  const validDependencyIds = new Set([...taskIds, ...baselineIds]);
  const validTargets = {
    TASK: new Set(taskIds),
    BASELINE_CAPABILITY: new Set(baselineIds),
    FEATURE_CANDIDATE: new Set(candidateIds)
  };

  if (index.schema_version !== "mvp-task-index-r3/v1") errors.push("schema_version must be mvp-task-index-r3/v1");
  if (index.plan_revision !== 3) errors.push("plan_revision must be 3");
  if (index.base_commit !== "5e7e4caa2d4bf20d098bc44f80c9678cf1715a89") errors.push("base_commit mismatch");
  if (index.plan_status !== "CANDIDATE_PAUSED") errors.push("plan_status must be CANDIDATE_PAUSED");
  if (index.execution_status !== "PAUSED_BY_CREATOR") errors.push("execution_status must be PAUSED_BY_CREATOR");
  if (index.selected_task !== null) errors.push("selected_task must be null");
  if (index.authority?.formal_gate_approved !== false || index.authority?.may_start_product_task !== false) {
    errors.push("R3 candidate must not claim approval or execution authority");
  }
  if (!sameSet(taskIds, EXPECTED_TASKS) || !unique(taskIds)) errors.push("Task Index must contain the exact 19 R3 Task IDs once");
  if (index.tasks?.length !== 19) errors.push("Task count must be 19");
  if (index.tasks?.some((task) => task.status !== "PLANNED")) errors.push("all R3 Tasks must remain PLANNED");
  if (index.tasks?.some((task) => task.status === "READY")) errors.push("R3 candidate must contain zero READY Tasks");
  if (index.counts?.ready !== 0 || index.counts?.planned !== 19 || index.counts?.total !== 19) errors.push("declared counts must be 0 READY / 19 PLANNED");

  for (const task of index.tasks ?? []) {
    for (const field of REQUIRED_TASK_FIELDS) {
      if (!(field in task)) errors.push(`${task.id ?? "unknown"} missing field ${field}`);
    }
    if (!Array.isArray(task.depends_on) || !task.depends_on.length) errors.push(`${task.id} must declare dependencies`);
    if (!Array.isArray(task.v7_anchors) || !task.v7_anchors.length) errors.push(`${task.id} must declare V7 anchors`);
    if (!Array.isArray(task.write_scope) || !task.write_scope.length) errors.push(`${task.id} must declare exact write_scope`);
    if (!Array.isArray(task.acceptance) || !task.acceptance.length) errors.push(`${task.id} must declare business acceptance`);
    for (const dependency of task.depends_on ?? []) {
      if (!validDependencyIds.has(dependency)) errors.push(`${task.id} references unknown dependency ${dependency}`);
      if (dependency === task.id) errors.push(`${task.id} depends on itself`);
    }
  }
  if (hasCycle(index.tasks ?? [])) errors.push("R3 Task DAG contains a cycle");

  const verticals = (index.tasks ?? []).filter((task) => /^S[1-5]$/u.test(task.layer));
  for (const task of verticals) {
    const name = task.id.replace(/^S[1-5]-/u, "").toLowerCase();
    const requiredScopes = [
      `apps/web/src/features/${name}/**`,
      `orchestration/workflows/${name}/**`,
      `db/migrations/*__${name}__*.sql`,
      `db/functions/${name}/**`,
      `packages/contracts/src/${name}/**`,
      `tests/vertical/${name}/**`
    ];
    for (const scope of requiredScopes) {
      if (!task.write_scope.includes(scope)) errors.push(`${task.id} missing production vertical scope ${scope}`);
    }
  }

  const apiScopes = (index.tasks ?? []).flatMap((task) =>
    task.write_scope.filter((scope) => scope.startsWith("apps/api/")).map((scope) => ({ id: task.id, scope }))
  );
  if (apiScopes.some(({ id, scope }) => id !== "S4-DEDUCTION-RUNTIME" || !scope.startsWith("apps/api/src/glue/deduction-runtime/"))) {
    errors.push("apps/api scope is allowed only as deduction-runtime thin glue");
  }

  const highCode = (index.tasks ?? []).filter(
    (task) => task.model?.profile === "MODEL::CODE_HIGH" || task.implementation_mode === "HIGH_CODE_EXCEPTION"
  );
  if (highCode.length !== 1 || highCode[0]?.id !== "S4-DEDUCTION-RUNTIME") {
    errors.push("S4-DEDUCTION-RUNTIME must be the only high-code exception");
  }
  if ((index.tasks ?? []).some((task) => task.model?.actual_model !== null)) {
    errors.push("future Task actual_model must remain unresolved until Orchestrator dispatch");
  }

  const allScopes = (index.tasks ?? []).flatMap((task) => task.write_scope).join("\n").toLowerCase();
  if (/(^|[/\\-])(android|ios|electron|native-mobile|native-desktop)([/\\*.-]|$)/u.test(allScopes)) {
    errors.push("native mobile or desktop scope is forbidden");
  }
  if (index.architecture?.product_surface !== "WEB_ONLY" || index.architecture?.native_mobile_in_scope !== false || index.architecture?.native_desktop_in_scope !== false) {
    errors.push("architecture must be Web-only with native mobile/desktop excluded");
  }
  if (index.architecture?.orchestration_owner !== "n8n" || index.architecture?.truth_and_transaction_owner !== "PostgreSQL") {
    errors.push("architecture ownership must remain n8n + PostgreSQL");
  }
  if (index.architecture?.api_business_state_machine_allowed !== false) errors.push("apps/api business state machines must be forbidden");
  if (!sameSet(index.architecture?.forbidden_mvp_physical_tables ?? [], ["world_binding", "world_knowledge_entry"])) {
    errors.push("MVP forbidden physical table list must name world_binding and world_knowledge_entry");
  }

  const taskById = new Map((index.tasks ?? []).map((task) => [task.id, task]));
  const openBook = taskById.get("S1-OPEN-BOOK");
  const l1a = taskById.get("S2-L1A");
  const productionBase = taskById.get("F0-06-N8N-PRODUCTION-BASE");
  const productionStart = taskById.get("S3-PRODUCTION-START");
  const chapterPlan = taskById.get("S3-CHAPTER-PLAN");
  const info = taskById.get("S4-INFO-PACKAGE");
  const runtime = taskById.get("S4-DEDUCTION-RUNTIME");
  const editor = taskById.get("S5-EDITOR-REVISION");
  if (openBook?.v7_anchors.includes("V7::FP001-05")) errors.push("FP001-05 must be post-MVP");
  if (l1a?.v7_anchors.includes("V7::FP004-05")) errors.push("FP004-05 must be post-MVP");
  if (!info?.acceptance.join(" ").includes("不预生成char_tasks")) errors.push("S4-INFO-PACKAGE must forbid prebuilt char_tasks");
  if (!runtime?.acceptance.join(" ").includes("is_valid")) errors.push("FP008-02 must recheck recalled memory with PostgreSQL is_valid");
  if (!editor?.acceptance.join(" ").includes("abandoned_by_user")) errors.push("third N must end as abandoned_by_user");
  if (editor?.v7_anchors.includes("V7::FP012-03")) errors.push("FP012-03 enhancement must be post-MVP");
  if (!sameSet(taskById.get("S5-OBJECTIVE-AUDIT")?.depends_on ?? [], ["S5-PROSE"])) errors.push("S5 objective audit must not wait for FP011");
  if (!sameSet(productionBase?.business_contract?.minimum_observability ?? [], ["correlation_id", "redacted_error"])) {
    errors.push("F0-06 production base must keep only minimum correlation_id and redacted_error observability");
  }
  if (productionBase?.business_contract?.advanced_observability_candidate !== "CAND-OUTSIDE-ADVANCED-OBSERVABILITY") {
    errors.push("F0-06 production base must defer advanced observability");
  }
  if (productionStart?.business_contract?.output !== "scene_condition_package_version") {
    errors.push("S3 production start must output scene_condition_package_version");
  }
  if (!sameSet(productionStart?.business_contract?.materializes_on_start_from ?? [], SCENE_PACKAGE_SOURCES)) {
    errors.push("S3 production start must materialize the exact FP005-01 formal sources");
  }
  if (!sameSet(productionStart?.business_contract?.rejects ?? [], SCENE_PACKAGE_REJECTIONS)) {
    errors.push("S3 production start must reject the exact FP005-01 unsafe inputs");
  }
  if (index.architecture?.scene_condition_package_lineage?.producer !== "S3-PRODUCTION-START"
    || index.architecture?.scene_condition_package_lineage?.version_reference !== "scene_condition_package_version"
    || !sameSet(index.architecture?.scene_condition_package_lineage?.required_consumers ?? [], SCENE_PACKAGE_CONSUMERS)) {
    errors.push("scene_condition_package lineage must cover chapter planning and every downstream MVP Task");
  }
  if (!sameSet(chapterPlan?.business_contract?.consumes ?? [], ["scene_condition_package_version"])
    || chapterPlan?.business_contract?.preserve_lineage_downstream !== true) {
    errors.push("S3 chapter plan must consume and preserve scene_condition_package_version");
  }
  for (const taskId of SCENE_PACKAGE_CONSUMERS) {
    if (!taskById.get(taskId)?.acceptance.join(" ").includes("scene_condition_package_version")) {
      errors.push(taskId + " must explicitly preserve scene_condition_package_version");
    }
  }
  if (JSON.stringify(editor?.business_contract?.y_release_sequence) !== JSON.stringify(EDITOR_Y_RELEASE_SEQUENCE)) {
    errors.push("S5 editor Y path must enhance, require formal_summary, enforce change_limit, then release");
  }
  if (editor?.business_contract?.invalid_enhancement !== "DISCARD_AND_DO_NOT_RELEASE") {
    errors.push("invalid FP013-01 enhancement must be discarded without released");
  }
  if (editor?.business_contract?.n3_terminal !== "abandoned_by_user") {
    errors.push("S5 editor third N contract must remain abandoned_by_user");
  }
  const editorAcceptance = editor?.acceptance.join(" ") ?? "";
  if (!editorAcceptance.includes("formal_summary") || !editorAcceptance.includes("change_limit") || !editorAcceptance.includes("不得进入released")) {
    errors.push("S5 editor acceptance must reject empty summary, change-limit failure, or invented facts before released");
  }
  const writebackAcceptance = taskById.get("S5-FORMAL-WRITEBACK")?.acceptance.join(" ") ?? "";
  if (!writebackAcceptance.includes("formal_summary") || !writebackAcceptance.includes("change_limit")) {
    errors.push("S5 formal writeback must consume the validated FP013-01 released candidate");
  }

  if (index.resources?.max_disjoint_coders !== 2 || index.resources?.integration_merge !== "SERIAL" || index.resources?.DB_WRITE !== 1 || index.resources?.N8N_RUNTIME_WRITE !== 1) {
    errors.push("resource policy must be 2 disjoint Coders, serial merge, DB_WRITE=1, N8N_RUNTIME_WRITE=1");
  }

  if (!unique(candidateIds)) errors.push("feature candidate IDs must be unique");
  if (candidateIds.length !== 22 || !candidateIds.includes("CAND-OUTSIDE-ADVANCED-OBSERVABILITY")) {
    errors.push("feature candidate catalog must contain the 22-entry R3 Round 1 set");
  }
  for (const candidate of index.feature_candidates ?? []) {
    if (!["V7_POST_MVP", "OUTSIDE_V7"].includes(candidate.category)) errors.push(`${candidate.id} has invalid category`);
    if (!candidatesMarkdown.includes(`### ${candidate.id}`)) errors.push(`${candidate.id} missing from FEATURE_CANDIDATES.md`);
  }

  const oldIds = historicalTaskIds(historicalControl);
  const mappings = index.old85_to_r3 ?? [];
  const mappedOldIds = mappings.map((mapping) => mapping.old_task_id);
  if (oldIds.length !== 85) errors.push(`historical source extraction expected 85 Tasks, found ${oldIds.length}`);
  if (mappings.length !== 85 || !unique(mappedOldIds) || !sameSet(mappedOldIds, oldIds)) {
    errors.push("old85_to_r3 must cover every historical Task exactly once");
  }
  for (const mapping of mappings) {
    if (!validTargets[mapping.target_type]?.has(mapping.target_id)) {
      errors.push(`${mapping.old_task_id} has invalid ${mapping.target_type} target ${mapping.target_id}`);
    }
  }
  const oldF006 = mappings.find((mapping) => mapping.old_task_id === "F0-06-OBSERVABILITY");
  if (oldF006?.target_type !== "FEATURE_CANDIDATE" || oldF006?.target_id !== "CAND-OUTSIDE-ADVANCED-OBSERVABILITY") {
    errors.push("historical F0-06 observability must map to the advanced observability candidate");
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      task_count: index.tasks?.length ?? 0,
      ready_count: index.tasks?.filter((task) => task.status === "READY").length ?? 0,
      planned_count: index.tasks?.filter((task) => task.status === "PLANNED").length ?? 0,
      historical_task_count: oldIds.length,
      mapping_count: mappings.length,
      candidate_count: candidateIds.length,
      high_code_tasks: highCode.map((task) => task.id)
    }
  };
}

function snapshot(inputs) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(inputs.index));
  hash.update(inputs.candidates);
  hash.update(inputs.historicalControl);
  return hash.digest("hex");
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`);
}

function runSelfTest(inputs) {
  const base = validatePlan(inputs.index, inputs.candidates, inputs.historicalControl);
  assertSelfTest(base.ok, base.errors.join("; "));
  const mutations = [];

  function rejected(name, mutate) {
    const copy = structuredClone(inputs.index);
    mutate(copy);
    const result = validatePlan(copy, inputs.candidates, inputs.historicalControl);
    assertSelfTest(!result.ok, `${name} mutation was accepted`);
    mutations.push(name);
  }

  rejected("ready-task", (copy) => { copy.tasks[0].status = "READY"; });
  rejected("mapping-duplicate", (copy) => { copy.old85_to_r3[1].old_task_id = copy.old85_to_r3[0].old_task_id; });
  rejected("missing-n8n-scope", (copy) => {
    const task = copy.tasks.find((item) => item.id === "S1-OPEN-BOOK");
    task.write_scope = task.write_scope.filter((scope) => !scope.startsWith("orchestration/workflows/"));
  });
  rejected("second-high-code-task", (copy) => {
    copy.tasks.find((item) => item.id === "S1-CONFIG").model.profile = "MODEL::CODE_HIGH";
  });
  rejected("native-client-scope", (copy) => { copy.tasks[0].write_scope.push("apps/native-desktop/**"); });
  rejected("unknown-dependency", (copy) => { copy.tasks[0].depends_on.push("UNKNOWN-TASK"); });
  rejected("scene-package-source", (copy) => {
    copy.tasks.find((item) => item.id === "S3-PRODUCTION-START").business_contract.materializes_on_start_from.pop();
  });
  rejected("scene-package-rejection", (copy) => {
    copy.tasks.find((item) => item.id === "S3-PRODUCTION-START").business_contract.rejects.pop();
  });
  rejected("scene-package-consumer", (copy) => {
    copy.tasks.find((item) => item.id === "S3-CHAPTER-PLAN").business_contract.consumes = [];
  });
  rejected("editor-release-order", (copy) => {
    const sequence = copy.tasks.find((item) => item.id === "S5-EDITOR-REVISION").business_contract.y_release_sequence;
    [sequence[1], sequence[3]] = [sequence[3], sequence[1]];
  });
  rejected("observability-mapping", (copy) => {
    const mapping = copy.old85_to_r3.find((item) => item.old_task_id === "F0-06-OBSERVABILITY");
    mapping.target_type = "TASK";
    mapping.target_id = "F0-06-N8N-PRODUCTION-BASE";
  });

  const before = snapshot(inputs);
  const afterInputs = loadInputs();
  assertSelfTest(before === snapshot(afterInputs), "self-test changed plan inputs");
  return {
    ok: true,
    command: "--self-test",
    checks: base.summary,
    rejected_mutations: mutations,
    side_effects: false
  };
}

function statusPayload(index, command) {
  return {
    ok: true,
    command,
    plan_revision: index.plan_revision,
    plan_status: index.plan_status,
    execution_status: index.execution_status,
    counts: index.counts,
    selected_task: null,
    ready_tasks: [],
    may_start_product_task: false,
    side_effects: false,
    message: "PAUSED_BY_CREATOR: R3 is a candidate plan and no product Task may start."
  };
}

function main() {
  const [command = "check", ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("mvp-plan accepts exactly one read-only command");
  const inputs = loadInputs();

  if (command === "--self-test") {
    console.log(JSON.stringify(runSelfTest(inputs), null, 2));
    return;
  }

  if (!["check", "status", "dry-run"].includes(command)) {
    throw new Error(`unsupported command ${command}; allowed read-only commands: check, status, dry-run, --self-test`);
  }

  const validation = validatePlan(inputs.index, inputs.candidates, inputs.historicalControl);
  if (!validation.ok) {
    console.error(JSON.stringify(validation, null, 2));
    process.exitCode = 1;
    return;
  }

  if (command === "check") {
    console.log(JSON.stringify({ ok: true, command, ...validation.summary, side_effects: false }, null, 2));
    return;
  }
  console.log(JSON.stringify(statusPayload(inputs.index, command), null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
