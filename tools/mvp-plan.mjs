#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const paths = {
  active: join(root, "docs", "MVP_TASK_INDEX_R4.json"),
  historicalR3: join(root, "docs", "MVP_TASK_INDEX_R3.json"),
  plan: join(root, "docs", "MVP_IMPLEMENTATION_PLAN_R4.md"),
  handoff: join(root, "docs", "R4_EXECUTION_HANDOFF.md"),
  historicalPlan: join(root, "docs", "MVP_IMPLEMENTATION_PLAN_R3.md"),
  historicalHandoff: join(root, "docs", "R3_EXECUTION_HANDOFF.md"),
  historicalControl: join(root, "docs", "IMPLEMENTATION_CONTROL.md")
};

const EXPECTED_TASKS = [
  "WEB-STATIC-RESTORE",
  "B1-CREATE-DRAFT-BOOK",
  "B2-WORLD-SETTINGS",
  "B3-CHARACTER-SETTINGS",
  "B4-FINALIZE-BOOK-DESIGN",
  "B5-CHAPTER-PLAN",
  "B6-DEDUCTION",
  "B7-LITERARY-PRESENTATION",
  "B8-AUDIT-AND-COMMIT",
  "MVP-GATE"
];

const HIGH_TASKS = new Set([
  "B4-FINALIZE-BOOK-DESIGN",
  "B5-CHAPTER-PLAN",
  "B6-DEDUCTION",
  "B8-AUDIT-AND-COMMIT",
  "MVP-GATE"
]);

const REQUIRED_TASK_FIELDS = [
  "id",
  "kind",
  "outcome",
  "depends_on",
  "fp_scope",
  "risk",
  "model",
  "main_journey",
  "write_scope",
  "acceptance",
  "review_policy",
  "status"
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameSet(left, right) {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function hasCycle(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.depends_on ?? []) {
      if (byId.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return tasks.some((task) => visit(task.id));
}

function loadInputs() {
  return {
    index: readJson(paths.active),
    r3: readJson(paths.historicalR3),
    plan: readFileSync(paths.plan, "utf8"),
    handoff: readFileSync(paths.handoff, "utf8"),
    historicalPlan: readFileSync(paths.historicalPlan, "utf8"),
    historicalHandoff: readFileSync(paths.historicalHandoff, "utf8"),
    historicalControl: readFileSync(paths.historicalControl, "utf8")
  };
}

export function validatePlan(inputs) {
  const { index, r3, plan, handoff, historicalPlan, historicalHandoff, historicalControl } = inputs;
  const errors = [];
  const tasks = index.tasks ?? [];
  const ids = tasks.map((task) => task.id);
  const byId = new Map(tasks.map((task) => [task.id, task]));

  if (index.schema_version !== "mvp-task-index-r4/v1") errors.push("R4 schema_version mismatch");
  if (index.plan_revision !== 4) errors.push("R4 plan_revision must be 4");
  if (index.plan_status !== "APPROVED" || index.execution_status !== "ACTIVE" || index.active_task_index !== true) {
    errors.push("R4 must be the approved active Task Index");
  }
  if (!sameSet(ids, EXPECTED_TASKS) || !unique(ids)) errors.push("R4 must contain the exact ten top-level Task IDs once");
  if (tasks.filter((task) => task.kind === "BUSINESS_TASK").length !== 9 || tasks.filter((task) => task.kind === "GATE_TASK").length !== 1) {
    errors.push("R4 must contain nine business Tasks and one Gate");
  }
  if (tasks.some((task) => !["BUSINESS_TASK", "GATE_TASK"].includes(task.kind))) {
    errors.push("subagent, repair, contract, screenshot, lint, audit, and review work cannot be top-level Tasks");
  }

  const allowedStatuses = new Set(["READY", "IN_PROGRESS", "PLANNED", "COMPLETE", "BLOCKED"]);
  const statusCounts = Object.fromEntries([...allowedStatuses].map((status) => [status, tasks.filter((task) => task.status === status).length]));
  if (tasks.some((task) => !allowedStatuses.has(task.status))) errors.push("R4 contains an invalid top-level Task status");
  if (statusCounts.IN_PROGRESS > index.execution_policy?.max_concurrent_business_tasks) errors.push("too many business Tasks are IN_PROGRESS");
  if (index.counts?.ready !== statusCounts.READY
    || index.counts?.in_progress !== statusCounts.IN_PROGRESS
    || index.counts?.planned !== statusCounts.PLANNED
    || index.counts?.total !== tasks.length
    || index.counts?.business_tasks !== 9
    || index.counts?.gate_tasks !== 1) {
    errors.push("R4 declared counts must match top-level Task statuses");
  }

  for (const task of tasks) {
    for (const field of REQUIRED_TASK_FIELDS) if (!(field in task)) errors.push(`${task.id ?? "unknown"} missing ${field}`);
    if (!task.outcome || !task.main_journey || !task.write_scope?.length || !task.acceptance?.length) errors.push(`${task.id} must describe one demonstrable result`);
    for (const dependency of task.depends_on ?? []) if (!byId.has(dependency)) errors.push(`${task.id} has unknown dependency ${dependency}`);
    if (["IN_PROGRESS", "COMPLETE"].includes(task.status)) {
      for (const dependency of task.depends_on ?? []) {
        if (byId.get(dependency)?.status !== "COMPLETE") errors.push(`${task.id} cannot ${task.status.toLowerCase()} before ${dependency} is COMPLETE`);
      }
    }
    const effort = HIGH_TASKS.has(task.id) ? "high" : "medium";
    if (task.model?.requested_model !== "gpt-5.6-terra" || task.model?.reasoning_effort !== effort || task.model?.actual_model !== null) {
      errors.push(`${task.id} must remain unresolved on terra/${effort} until platform dispatch`);
    }
  }
  if (hasCycle(tasks)) errors.push("R4 Task dependency graph contains a cycle");

  const policy = index.execution_policy ?? {};
  if (policy.max_concurrent_business_tasks !== 2
    || policy.max_internal_subagents_per_task !== 4
    || policy.max_concurrent_internal_subagents_per_task !== 3
    || policy.max_total_concurrent_agents !== 10) {
    errors.push("R4 concurrency must be 2 business Tasks, 4 phased internal sessions, 3 concurrent internal subagents, and 10 total agents");
  }
  if (policy.main_task_owns_integration !== true || !policy.internal_subagent_rules?.some((rule) => rule.includes("not product tasks"))) {
    errors.push("internal subagents must remain work packages owned by the main business Task");
  }
  if (!sameSet(policy.deep_review_only ?? [], [
    "B4 formal design transaction",
    "B6 FP008 information isolation",
    "B8 P0 and formal chapter transaction",
    "MVP-GATE"
  ])) errors.push("deep review must be limited to B4, B6, B8, and MVP-GATE");

  const moduleProtocol = index.business_task_internal_protocol ?? {};
  const moduleRoles = moduleProtocol.distinct_internal_sessions?.map((session) => session.role) ?? [];
  if (!sameSet(moduleProtocol.applies_to ?? [], EXPECTED_TASKS.filter((id) => /^B[1-8]-/.test(id)))
    || !sameSet(moduleRoles, ["N8N_WORKFLOW_IMPLEMENTER", "DATA_INTEGRATION_IMPLEMENTER", "BUSINESS_ACCEPTANCE_AUDITOR", "USER_OPERATION_AUDITOR"])
    || moduleProtocol.completion_rule !== "all implementation results integrated and both required acceptance sessions PASS") {
    errors.push("B1-B8 must use distinct n8n, data, business-acceptance, and user-operation sessions inside each business Task");
  }

  const pages = index.static_pages ?? [];
  if (pages.length !== 9 || !unique(pages.map((page) => page.page_id)) || !unique(pages.map((page) => page.target_route))) {
    errors.push("WEB-STATIC-RESTORE must register nine unique pages and routes");
  }
  for (const page of pages) {
    if (!existsSync(join(root, page.source_prototype))) errors.push(`${page.page_id} prototype is missing`);
    if (!page.required_regions?.length || !page.interactions?.length) errors.push(`${page.page_id} lacks executable regions/interactions`);
  }
  const staticAcceptance = index.static_page_acceptance ?? {};
  if (!sameSet(staticAcceptance.viewports ?? [], ["1440x900", "1280x720"])
    || !sameSet(staticAcceptance.states ?? [], ["normal", "empty", "loading", "error"])
    || staticAcceptance.data_mode !== "static_mock"
    || !sameSet(staticAcceptance.out_of_scope ?? [], ["PostgreSQL", "n8n", "real model calls"])) {
    errors.push("static restore acceptance must use fixed viewports, four states, and static-only data scope");
  }
  if (staticAcceptance.visual_acceptance_protocol?.auditor_scope !== "READ_ONLY_NON_AUTHOR_INSIDE_PARENT_TASK"
    || !staticAcceptance.required?.some((rule) => rule.includes("did not edit that page"))) {
    errors.push("static visual acceptance must be fail-closed and come from a non-author internal subagent");
  }

  const web = byId.get("WEB-STATIC-RESTORE");
  if ((web?.internal_work_packages?.length ?? 0) !== 5 || web?.review_policy !== "ONE_INTEGRATED_VISUAL_ACCEPTANCE_INSIDE_PARENT_TASK") {
    errors.push("WEB-STATIC-RESTORE must use one parent, three page groups, and one integrated visual acceptance");
  }
  const b1 = byId.get("B1-CREATE-DRAFT-BOOK");
  if (!b1?.transaction_boundary.includes("draft") || !b1.transaction_boundary.includes("no world/character/L1A formalization")) {
    errors.push("B1 must create only a draft book shell");
  }
  const b4 = byId.get("B4-FINALIZE-BOOK-DESIGN");
  if (!sameSet(b4?.depends_on ?? [], ["B2-WORLD-SETTINGS", "B3-CHARACTER-SETTINGS"])
    || !b4?.transaction_boundary.includes("one PostgreSQL transaction")) {
    errors.push("B4 must be the separate atomic formal-design transition after B2 and B3");
  }
  const b6Text = byId.get("B6-DEDUCTION")?.acceptance.join(" ") ?? "";
  if (!b6Text.includes("physically isolated") || !b6Text.includes("pgvector") || !b6Text.includes("partial results cannot lock")) {
    errors.push("B6 must preserve FP008 information isolation, memory validation, and complete-only locking");
  }
  const b8 = byId.get("B8-AUDIT-AND-COMMIT");
  const b8Text = b8?.acceptance.join(" ") ?? "";
  if ((b8?.fp_scope ?? []).some((fp) => fp.startsWith("FP011") || fp === "FP012-03")
    || !b8Text.includes("abandoned_by_user")
    || !b8Text.includes("released")
    || !b8?.transaction_boundary.includes("one PostgreSQL transaction")) {
    errors.push("B8 must exclude FP011/FP012-03 and keep the released/P0/atomic-write boundary");
  }

  if (index.architecture?.surface !== "WEB_ONLY" || index.architecture?.truth_owner !== "PostgreSQL" || index.architecture?.orchestration_owner !== "n8n" || index.architecture?.new_containers !== false) {
    errors.push("R4 architecture must remain Web + existing n8n + PostgreSQL");
  }
  if (r3.plan_status !== "HISTORICAL_FROZEN" || r3.execution_status !== "CANCELLED_BY_REBASE" || r3.superseded_by !== "docs/MVP_TASK_INDEX_R4.json") {
    errors.push("R3 must be historical/frozen and superseded by R4");
  }
  if ((r3.tasks ?? []).some((task) => task.status !== "CANCELLED_BY_REBASE")) errors.push("every unfinished R3 Task must be CANCELLED_BY_REBASE");
  if (!historicalControl.includes("LEGACY_CONTROL_STATUS=HISTORICAL_FROZEN")
    || !historicalControl.includes("G07_CONTROL_STATUS=HISTORICAL_FROZEN")
    || !historicalControl.includes("ACTIVE_TASK_INDEX=docs/MVP_TASK_INDEX_R4.json")) {
    errors.push("85-task and G07 control must be historical/frozen");
  }
  if (!historicalPlan.includes("HISTORICAL / FROZEN") || !historicalHandoff.includes("HISTORICAL / FROZEN")) {
    errors.push("R3 plan and handoff must visibly reject active dispatch");
  }
  if (!plan.includes("Two-Level Execution") || !plan.includes("WEB-STATIC-RESTORE") || !handoff.includes("Internal subagents cannot create Tasks")) {
    errors.push("R4 plan/handoff must describe the two-level execution model");
  }

  return errors;
}

function summarize(index, command) {
  const ready = index.tasks.filter((task) => task.status === "READY").map((task) => task.id);
  const inProgress = index.tasks.filter((task) => task.status === "IN_PROGRESS").map((task) => task.id);
  return {
    ok: true,
    command,
    plan_revision: index.plan_revision,
    plan_status: index.plan_status,
    execution_status: index.execution_status,
    task_count: index.tasks.length,
    business_task_count: index.tasks.filter((task) => task.kind === "BUSINESS_TASK").length,
    ready_count: ready.length,
    in_progress_count: inProgress.length,
    planned_count: index.tasks.filter((task) => task.status === "PLANNED").length,
    ready_tasks: ready,
    in_progress_tasks: inProgress,
    requested_model: index.model_policy.requested_model,
    high_reasoning_tasks: index.model_policy.high_reasoning_tasks,
    side_effects: false
  };
}

function selfTest(inputs) {
  const failures = [];
  const cases = [
    ["micro-task", (x) => x.index.tasks.push({ id: "SCREENSHOT-AUDIT", kind: "AUDIT_TASK" })],
    ["r3-reactivation", (x) => { x.r3.plan_status = "APPROVED"; }],
    ["missing-page", (x) => { x.index.static_pages.pop(); }],
    ["lowered-high-reasoning", (x) => { x.index.tasks.find((task) => task.id === "B6-DEDUCTION").model.reasoning_effort = "medium"; }],
    ["draft-formalization", (x) => { x.index.tasks.find((task) => task.id === "B1-CREATE-DRAFT-BOOK").transaction_boundary = "formalize everything"; }],
    ["too-many-subagents", (x) => { x.index.execution_policy.max_internal_subagents_per_task = 5; }],
    ["merged-acceptance-role", (x) => { x.index.business_task_internal_protocol.distinct_internal_sessions[3].role = "BUSINESS_ACCEPTANCE_AUDITOR"; }],
    ["self-visual-acceptance", (x) => { x.index.static_page_acceptance.visual_acceptance_protocol.auditor_scope = "PARENT_SELF_REVIEW"; }]
  ];
  for (const [name, mutate] of cases) {
    const clone = structuredClone(inputs);
    mutate(clone);
    if (validatePlan(clone).length === 0) failures.push(name);
  }
  return failures;
}

function main() {
  const command = process.argv[2] ?? "check";
  const inputs = loadInputs();
  const errors = validatePlan(inputs);
  if (errors.length) {
    console.error(JSON.stringify({ ok: false, command, errors, side_effects: false }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (command === "--self-test") {
    const failures = selfTest(inputs);
    console.log(JSON.stringify({ ok: failures.length === 0, command, rejected_mutations: failures.length ? [] : ["micro-task", "r3-reactivation", "missing-page", "lowered-high-reasoning", "draft-formalization", "too-many-subagents", "merged-acceptance-role", "self-visual-acceptance"], failures, side_effects: false }, null, 2));
    if (failures.length) process.exitCode = 1;
    return;
  }

  if (command === "status" || command === "dry-run") {
    const inProgress = inputs.index.tasks.filter((task) => task.status === "IN_PROGRESS").map((task) => task.id);
    const ready = inputs.index.tasks.filter((task) => task.status === "READY").map((task) => task.id);
    console.log(JSON.stringify({
      ...summarize(inputs.index, command),
      selected_task: inProgress[0] ?? ready[0] ?? null,
      message: inProgress.length
        ? `ACTIVE: ${inProgress.join(", ")}; internal work packages are not product Tasks.`
        : ready.length
          ? `READY: ${ready.join(", ")}`
          : "No top-level Task is READY or IN_PROGRESS."
    }, null, 2));
    return;
  }

  if (command !== "check") {
    console.error(JSON.stringify({ ok: false, command, errors: ["expected check, status, dry-run, or --self-test"], side_effects: false }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(summarize(inputs.index, command), null, 2));
}

main();
