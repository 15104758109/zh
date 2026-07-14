#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, "docs", "MVP_TASK_INDEX_R3.json");
const candidatesPath = join(root, "docs", "FEATURE_CANDIDATES.md");
const historicalControlPath = join(root, "docs", "IMPLEMENTATION_CONTROL.md");
const handoffPath = join(root, "docs", "R3_EXECUTION_HANDOFF.md");
const TERRA_MODEL = "gpt-5.6-terra";

const EXPECTED_TASKS = [
  "F0-05-PG-RUNTIME-GUARDS",
  "F0-06-N8N-PRODUCTION-BASE",
  "F0-07-RUNTIME-SEEDS",
  "S1-WORKBENCH-PAGE",
  "S1-NEW-BOOK-PAGE",
  "S2-WORLD-PAGE",
  "S2-CHARACTERS-PAGE",
  "S2-L1A-PAGE",
  "S3-PRODUCTION-STAGE-PAGE",
  "S4-MULTI-AGENT-DEDUCTION-PAGE",
  "S4-AUDIT-REVIEW-PAGE",
  "S5-AUDIT-STAGE-PAGE",
  "MVP-GATE"
];

const EXPECTED_PAGE_TASKS = {
  "S1-WORKBENCH-PAGE": ["workbench", "/workbench", "docs/前端原型_v2/pages/workbench.html"],
  "S1-NEW-BOOK-PAGE": ["new-book", "/books/new", "docs/前端原型_v2/pages/new_book.html"],
  "S2-WORLD-PAGE": ["world", "/books/:bookId/world", "docs/前端原型_v2/pages/world_creator.html"],
  "S2-CHARACTERS-PAGE": ["characters", "/books/:bookId/characters", "docs/前端原型_v2/pages/character_settings.html"],
  "S2-L1A-PAGE": ["l1a", "/books/:bookId/l1a", "docs/前端原型_v2/pages/l1a_settings.html"],
  "S3-PRODUCTION-STAGE-PAGE": ["production-stage", "/books/:bookId/production", "docs/前端原型_v2/pages/production_stage.html"],
  "S4-MULTI-AGENT-DEDUCTION-PAGE": ["multi-agent-deduction", "/books/:bookId/deduction", "docs/前端原型_v2/pages/multi_agent_deduction.html"],
  "S4-AUDIT-REVIEW-PAGE": ["audit-review", "/books/:bookId/deduction-review", "docs/前端原型_v2/pages/audit_review.html"],
  "S5-AUDIT-STAGE-PAGE": ["audit-stage", "/books/:bookId/audit", "docs/前端原型_v2/pages/audit_stage.html"]
};

const HIGH_REASONING_TASKS = [
  "F0-05-PG-RUNTIME-GUARDS",
  "S2-L1A-PAGE",
  "S3-PRODUCTION-STAGE-PAGE",
  "S4-MULTI-AGENT-DEDUCTION-PAGE",
  "S4-AUDIT-REVIEW-PAGE",
  "S5-AUDIT-STAGE-PAGE",
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
  "S4-MULTI-AGENT-DEDUCTION-PAGE",
  "S4-AUDIT-REVIEW-PAGE",
  "S5-AUDIT-STAGE-PAGE",
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
    historicalControl: readFileSync(historicalControlPath, "utf8"),
    handoff: readFileSync(handoffPath, "utf8")
  };
}

function normalizedFileSha256(relativePath) {
  const normalized = readFileSync(join(root, relativePath), "utf8").replace(/\r\n?/gu, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
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

export function validatePlan(index, candidatesMarkdown, historicalControl, handoffMarkdown) {
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
  if (index.tasks?.length !== 13) errors.push("Task count must be 13");
  if (index.tasks?.some((task) => task.status !== "PLANNED")) errors.push("all R3 Tasks must remain PLANNED");
  if (index.tasks?.some((task) => task.status === "READY")) errors.push("R3 candidate must contain zero READY Tasks");
  if (index.counts?.ready !== 0 || index.counts?.planned !== 13 || index.counts?.total !== 13) errors.push("declared counts must be 0 READY / 13 PLANNED");

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

  const pageTasks = (index.tasks ?? []).filter((task) => task.page_contract);
  if (pageTasks.length !== 9 || !sameSet(pageTasks.map((task) => task.id), Object.keys(EXPECTED_PAGE_TASKS))) {
    errors.push("R3 must contain the exact nine page-owner Tasks");
  }
  if (index.page_delivery_policy?.unit !== "ONE_PAGE_ONE_TASK"
    || index.page_delivery_policy?.page_task_count !== 9
    || !sameSet(index.page_delivery_policy?.page_task_ids ?? [], Object.keys(EXPECTED_PAGE_TASKS))) {
    errors.push("page delivery policy must bind exactly one Task to each of nine MVP pages");
  }
  if (index.page_delivery_policy?.shared_css_owner !== "S1-WORKBENCH-PAGE") {
    errors.push("S1-WORKBENCH-PAGE must be the only shared CSS owner");
  }
  const pageIds = pageTasks.map((task) => task.page_contract.page_id);
  const pageRoutes = pageTasks.map((task) => task.page_contract.route);
  const pagePrototypes = pageTasks.map((task) => task.page_contract.prototype);
  if (!unique(pageIds) || !unique(pageRoutes) || !unique(pagePrototypes)) {
    errors.push("page IDs, routes, and prototypes must each have one unique owner");
  }
  for (const task of pageTasks) {
    const [pageId, route, prototype] = EXPECTED_PAGE_TASKS[task.id] ?? [];
    if (task.page_contract.page_id !== pageId || task.page_contract.route !== route || task.page_contract.prototype !== prototype) {
      errors.push(`${task.id} page contract does not match its registered MVP page`);
      continue;
    }
    if (task.page_contract.prototype_sha256 !== normalizedFileSha256(prototype)) {
      errors.push(`${task.id} prototype hash mismatch`);
    }
    const requiredScopes = [
      `apps/web/src/pages/${pageId}/**`,
      `orchestration/workflows/${pageId}/**`,
      `db/migrations/*__${pageId}__*.sql`,
      `db/functions/${pageId}/**`,
      `packages/contracts/src/${pageId}/**`,
      `tests/pages/${pageId}/**`
    ];
    for (const scope of requiredScopes) {
      if (!task.write_scope.includes(scope)) errors.push(`${task.id} missing page stitch scope ${scope}`);
    }
    if (task.page_contract.owns_page_exclusively !== true
      || task.page_contract.visual_policy_ref !== "PAGE_DELIVERY::R3"
      || task.page_contract.prototype_function_filter !== "ONLY_V7_ANCHORS_AND_TASK_ACCEPTANCE") {
      errors.push(`${task.id} must bind exclusive page ownership and the R3 visual/function filter`);
    }
    const acceptanceText = task.acceptance.join(" ");
    if (!acceptanceText.includes("系统继承") || !acceptanceText.includes("真实浏览器") || !acceptanceText.includes("无重叠")) {
      errors.push(`${task.id} lacks required visual and interaction audit acceptance`);
    }
  }

  const sharedWebScopes = ["apps/web/src/app/**", "apps/web/src/styles/**", "apps/web/src/components/navigation/**"];
  for (const task of index.tasks ?? []) {
    for (const scope of sharedWebScopes) {
      if (task.id !== "S1-WORKBENCH-PAGE" && task.write_scope.includes(scope)) {
        errors.push(`${task.id} illegally shares Workbench-owned visual scope ${scope}`);
      }
    }
  }
  for (const source of index.page_delivery_policy?.shared_visual_sources ?? []) {
    if (source.sha256 !== normalizedFileSha256(source.path)) errors.push(`shared visual source hash mismatch: ${source.path}`);
  }

  const apiScopes = (index.tasks ?? []).flatMap((task) =>
    task.write_scope.filter((scope) => scope.startsWith("apps/api/")).map((scope) => ({ id: task.id, scope }))
  );
  if (apiScopes.some(({ id, scope }) => id !== "S4-MULTI-AGENT-DEDUCTION-PAGE" || !scope.startsWith("apps/api/src/glue/multi-agent-deduction/"))) {
    errors.push("apps/api scope is allowed only as deduction-runtime thin glue");
  }

  const highCode = (index.tasks ?? []).filter(
    (task) => task.model?.profile === "MODEL::CODE_HIGH" || task.implementation_mode === "HIGH_CODE_EXCEPTION"
  );
  if (highCode.length !== 1 || highCode[0]?.id !== "S4-MULTI-AGENT-DEDUCTION-PAGE") {
    errors.push("S4-MULTI-AGENT-DEDUCTION-PAGE must be the only high-code exception");
  }
  if ((index.tasks ?? []).some((task) => task.model?.actual_model !== null)) {
    errors.push("future Task actual_model must remain unresolved until Orchestrator dispatch");
  }
  if (index.model_routing?.required_family !== "terra"
    || index.model_routing?.requested_model !== TERRA_MODEL
    || index.model_routing?.fallback !== "TERRA_ONLY_ENVIRONMENT_APPROVAL_IF_UNAVAILABLE"
    || index.model_routing?.independent_sessions_required !== true
    || !Object.values(index.model_routing?.roles ?? {}).every((model) => model === TERRA_MODEL)
    || !sameSet(index.model_routing?.high_reasoning_task_ids ?? [], HIGH_REASONING_TASKS)) {
    errors.push("all implementation and audit roles must use the unique terra routing policy");
  }
  for (const task of index.tasks ?? []) {
    const expectedEffort = HIGH_REASONING_TASKS.includes(task.id) ? "high" : "medium";
    if (task.model?.preferred_family !== "terra"
      || task.model?.requested_model !== TERRA_MODEL
      || task.model?.reasoning_effort !== expectedEffort
      || task.model?.reasoning_may_raise_to !== "high"
      || task.model?.fallback !== "TERRA_ONLY_ENVIRONMENT_APPROVAL_IF_UNAVAILABLE") {
      errors.push(`${task.id} does not match terra/${expectedEffort} routing`);
    }
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
  const openBook = taskById.get("S1-NEW-BOOK-PAGE");
  const l1a = taskById.get("S2-L1A-PAGE");
  const productionBase = taskById.get("F0-06-N8N-PRODUCTION-BASE");
  const production = taskById.get("S3-PRODUCTION-STAGE-PAGE");
  const productionStart = production?.business_contracts?.scene_condition_package;
  const chapterPlan = production?.business_contracts?.chapter_plan;
  const runtime = taskById.get("S4-MULTI-AGENT-DEDUCTION-PAGE");
  const deductionReview = taskById.get("S4-AUDIT-REVIEW-PAGE");
  const auditStage = taskById.get("S5-AUDIT-STAGE-PAGE");
  const editor = auditStage?.business_contracts?.editor_release;
  if (openBook?.v7_anchors.includes("V7::FP001-05")) errors.push("FP001-05 must be post-MVP");
  if (l1a?.v7_anchors.includes("V7::FP004-05")) errors.push("FP004-05 must be post-MVP");
  if (!runtime?.acceptance.join(" ").includes("不预生成char_tasks")) errors.push("multi-agent page must forbid prebuilt char_tasks");
  if (!runtime?.acceptance.join(" ").includes("is_valid")) errors.push("FP008-02 must recheck recalled memory with PostgreSQL is_valid");
  if (!auditStage?.acceptance.join(" ").includes("abandoned_by_user")) errors.push("third N must end as abandoned_by_user");
  if (auditStage?.v7_anchors.includes("V7::FP012-03") || auditStage?.v7_anchors.some((anchor) => anchor.startsWith("V7::FP011"))) {
    errors.push("FP011 and FP012-03 must remain post-MVP");
  }
  if (!sameSet(auditStage?.depends_on ?? [], ["S4-AUDIT-REVIEW-PAGE"])) errors.push("audit-stage page must start after deduction review");
  if (!sameSet(productionBase?.business_contract?.minimum_observability ?? [], ["correlation_id", "redacted_error"])) {
    errors.push("F0-06 production base must keep only minimum correlation_id and redacted_error observability");
  }
  if (productionBase?.business_contract?.advanced_observability_candidate !== "CAND-OUTSIDE-ADVANCED-OBSERVABILITY") {
    errors.push("F0-06 production base must defer advanced observability");
  }
  if (productionStart?.output !== "scene_condition_package_version") {
    errors.push("S3 production start must output scene_condition_package_version");
  }
  if (!sameSet(productionStart?.materializes_on_start_from ?? [], SCENE_PACKAGE_SOURCES)) {
    errors.push("S3 production start must materialize the exact FP005-01 formal sources");
  }
  if (!sameSet(productionStart?.rejects ?? [], SCENE_PACKAGE_REJECTIONS)) {
    errors.push("S3 production start must reject the exact FP005-01 unsafe inputs");
  }
  if (index.architecture?.scene_condition_package_lineage?.producer !== "S3-PRODUCTION-STAGE-PAGE"
    || index.architecture?.scene_condition_package_lineage?.version_reference !== "scene_condition_package_version"
    || !sameSet(index.architecture?.scene_condition_package_lineage?.required_consumers ?? [], SCENE_PACKAGE_CONSUMERS)) {
    errors.push("scene_condition_package lineage must cover chapter planning and every downstream MVP Task");
  }
  if (!sameSet(chapterPlan?.consumes ?? [], ["scene_condition_package_version"])
    || chapterPlan?.preserve_lineage_downstream !== true) {
    errors.push("S3 chapter plan must consume and preserve scene_condition_package_version");
  }
  for (const taskId of SCENE_PACKAGE_CONSUMERS) {
    if (!taskById.get(taskId)?.acceptance.join(" ").includes("scene_condition_package_version")) {
      errors.push(taskId + " must explicitly preserve scene_condition_package_version");
    }
  }
  if (JSON.stringify(editor?.y_release_sequence) !== JSON.stringify(EDITOR_Y_RELEASE_SEQUENCE)) {
    errors.push("S5 editor Y path must enhance, require formal_summary, enforce change_limit, then release");
  }
  if (editor?.invalid_enhancement !== "DISCARD_AND_DO_NOT_RELEASE") {
    errors.push("invalid FP013-01 enhancement must be discarded without released");
  }
  if (editor?.n3_terminal !== "abandoned_by_user") {
    errors.push("S5 editor third N contract must remain abandoned_by_user");
  }
  const editorAcceptance = auditStage?.acceptance.join(" ") ?? "";
  if (!editorAcceptance.includes("formal_summary") || !editorAcceptance.includes("change_limit") || !editorAcceptance.includes("不得进入released")) {
    errors.push("S5 editor acceptance must reject empty summary, change-limit failure, or invented facts before released");
  }
  const writebackAcceptance = auditStage?.acceptance.join(" ") ?? "";
  if (!writebackAcceptance.includes("formal_summary") || !writebackAcceptance.includes("change_limit")) {
    errors.push("S5 formal writeback must consume the validated FP013-01 released candidate");
  }

  if (index.resources?.max_disjoint_coders !== 2 || index.resources?.integration_merge !== "SERIAL" || index.resources?.DB_WRITE !== 1 || index.resources?.N8N_RUNTIME_WRITE !== 1) {
    errors.push("resource policy must be 2 disjoint Coders, serial merge, DB_WRITE=1, N8N_RUNTIME_WRITE=1");
  }
  if (!deductionReview?.v7_anchors.includes("V7::FP009-00") || auditStage?.v7_anchors.includes("V7::FP009-00")) {
    errors.push("audit-review page must uniquely own the FP009-00 prose handoff");
  }
  if (!handoffMarkdown.includes("gpt-5.6-terra")
    || !handoffMarkdown.includes("13 Tasks")
    || !handoffMarkdown.includes("F0-05-PG-RUNTIME-GUARDS")
    || !handoffMarkdown.includes("F0-06-N8N-PRODUCTION-BASE")
    || index.handoff?.prompt_path !== "docs/R3_EXECUTION_HANDOFF.md"
    || index.handoff?.next_window_may_record_activation_without_reasking_creator !== true
    || index.handoff?.current_window_may_start_product_task !== false) {
    errors.push("new-window execution handoff is missing or inconsistent");
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
      high_code_tasks: highCode.map((task) => task.id),
      page_task_count: pageTasks.length,
      requested_model: index.model_routing?.requested_model ?? null,
      high_reasoning_tasks: index.model_routing?.high_reasoning_task_ids ?? []
    }
  };
}

function snapshot(inputs) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(inputs.index));
  hash.update(inputs.candidates);
  hash.update(inputs.historicalControl);
  hash.update(inputs.handoff);
  return hash.digest("hex");
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`);
}

function runSelfTest(inputs) {
  const base = validatePlan(inputs.index, inputs.candidates, inputs.historicalControl, inputs.handoff);
  assertSelfTest(base.ok, base.errors.join("; "));
  const mutations = [];

  function rejected(name, mutate) {
    const copy = structuredClone(inputs.index);
    mutate(copy);
    const result = validatePlan(copy, inputs.candidates, inputs.historicalControl, inputs.handoff);
    assertSelfTest(!result.ok, `${name} mutation was accepted`);
    mutations.push(name);
  }

  rejected("ready-task", (copy) => { copy.tasks[0].status = "READY"; });
  rejected("mapping-duplicate", (copy) => { copy.old85_to_r3[1].old_task_id = copy.old85_to_r3[0].old_task_id; });
  rejected("missing-n8n-scope", (copy) => {
    const task = copy.tasks.find((item) => item.id === "S1-NEW-BOOK-PAGE");
    task.write_scope = task.write_scope.filter((scope) => !scope.startsWith("orchestration/workflows/"));
  });
  rejected("second-high-code-task", (copy) => {
    copy.tasks.find((item) => item.id === "S1-WORKBENCH-PAGE").model.profile = "MODEL::CODE_HIGH";
  });
  rejected("native-client-scope", (copy) => { copy.tasks[0].write_scope.push("apps/native-desktop/**"); });
  rejected("unknown-dependency", (copy) => { copy.tasks[0].depends_on.push("UNKNOWN-TASK"); });
  rejected("scene-package-source", (copy) => {
    copy.tasks.find((item) => item.id === "S3-PRODUCTION-STAGE-PAGE").business_contracts.scene_condition_package.materializes_on_start_from.pop();
  });
  rejected("scene-package-rejection", (copy) => {
    copy.tasks.find((item) => item.id === "S3-PRODUCTION-STAGE-PAGE").business_contracts.scene_condition_package.rejects.pop();
  });
  rejected("scene-package-consumer", (copy) => {
    copy.architecture.scene_condition_package_lineage.required_consumers.pop();
  });
  rejected("editor-release-order", (copy) => {
    const sequence = copy.tasks.find((item) => item.id === "S5-AUDIT-STAGE-PAGE").business_contracts.editor_release.y_release_sequence;
    [sequence[1], sequence[3]] = [sequence[3], sequence[1]];
  });
  rejected("observability-mapping", (copy) => {
    const mapping = copy.old85_to_r3.find((item) => item.old_task_id === "F0-06-OBSERVABILITY");
    mapping.target_type = "TASK";
    mapping.target_id = "F0-06-N8N-PRODUCTION-BASE";
  });
  rejected("non-terra-role", (copy) => {
    copy.model_routing.roles.BUSINESS_AUDITOR = "another-model";
  });
  rejected("duplicate-page-owner", (copy) => {
    copy.tasks.find((item) => item.id === "S2-CHARACTERS-PAGE").page_contract.route = "/books/:bookId/world";
  });
  rejected("prototype-hash-drift", (copy) => {
    copy.tasks.find((item) => item.id === "S1-WORKBENCH-PAGE").page_contract.prototype_sha256 = "0".repeat(64);
  });
  rejected("visual-audit-removed", (copy) => {
    const task = copy.tasks.find((item) => item.id === "S1-NEW-BOOK-PAGE");
    task.acceptance = task.acceptance.filter((item) => !item.includes("真实浏览器"));
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

  const validation = validatePlan(inputs.index, inputs.candidates, inputs.historicalControl, inputs.handoff);
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
