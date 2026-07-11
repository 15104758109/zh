#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProjectContextRouter,
  globToRegExp,
  normalizePath,
  sha256,
  stableJson,
} from "./project-context-loader.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_STATE_DIR = ".autonomy";
const POLICY_FILE = "policy.json";
const EVENTS_FILE = "events.jsonl";
const LOCK_FILE = "orchestrator.lock";

const TASK_STATUSES = new Set([
  "PLANNED",
  "READY",
  "LEASED",
  "IN_PROGRESS",
  "IMPLEMENTED",
  "VERIFYING",
  "VERIFIED",
  "REWORK",
  "REPLAN",
  "BLOCKED",
  "CREATOR_REQUIRED",
]);

const DECISION_LEVELS = new Set([
  "CREATOR_REQUIRED",
  "TASK_AUTONOMOUS",
  "ARCHITECT_AUTONOMOUS",
  "P2_TECH_DEBT",
  "BLOCKED_TECHNICAL",
  "ENVIRONMENT_APPROVAL_REQUIRED",
]);

const ROLE_NAMES = new Set([
  "coordinator",
  "gap_auditor",
  "coder",
  "prompt_editor",
  "auditor",
  "reviewer",
  "architect",
  "slice_gate_runner",
  "orchestrator",
]);

const REPORT_ROLES = new Set([
  "coder",
  "prompt_editor",
  "auditor",
  "reviewer",
  "architect",
  "slice_gate_runner",
]);

const TRANSITIONS = new Map([
  ["PLANNED", new Set(["READY", "BLOCKED", "CREATOR_REQUIRED"])],
  ["READY", new Set(["LEASED", "BLOCKED", "CREATOR_REQUIRED"])],
  ["LEASED", new Set(["IN_PROGRESS", "READY", "BLOCKED", "CREATOR_REQUIRED"])],
  ["IN_PROGRESS", new Set(["IMPLEMENTED", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"])],
  ["IMPLEMENTED", new Set(["VERIFYING", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"])],
  ["VERIFYING", new Set(["VERIFIED", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"])],
  ["REWORK", new Set(["READY", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"])],
  ["REPLAN", new Set(["READY", "BLOCKED", "CREATOR_REQUIRED"])],
  ["BLOCKED", new Set(["READY", "REPLAN", "CREATOR_REQUIRED"])],
  ["CREATOR_REQUIRED", new Set(["READY", "BLOCKED"])],
  ["VERIFIED", new Set()],
]);

const REQUIRED_EVENT_FIELDS = [
  "event_version",
  "event_id",
  "event_type",
  "autonomy_run_id",
  "slice_id",
  "task_id",
  "attempt_id",
  "role",
  "base_commit",
  "candidate_commit",
  "context_hash",
  "branch",
  "worktree",
  "lease",
  "from_status",
  "to_status",
  "timestamp",
  "acceptance",
  "verdicts",
  "decision_level",
  "failure_fingerprint",
  "counters",
  "execution",
  "creator_required_reason",
  "environment_approval_reason",
  "payload",
  "previous_event_hash",
  "event_hash",
];

function invariant(condition, message, code = "ORCHESTRATOR_ERROR", details = null) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashEvent(event) {
  const copy = { ...event };
  delete copy.event_hash;
  return sha256(stableJson(copy));
}

function failureFingerprint(value) {
  return value ? sha256(String(value).trim().toLowerCase()) : null;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ""));
}

function sleepMilliseconds(milliseconds) {
  const array = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(array, 0, 0, milliseconds);
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  invariant(Number.isFinite(number) && number >= 0, `invalid non-negative number: ${value}`, "INVALID_NUMBER");
  return number;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

class GitClient {
  constructor(root) {
    this.root = root;
  }

  run(args, { allowFailure = false } = {}) {
    const result = spawnSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!allowFailure && result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  head() {
    return this.run(["rev-parse", "HEAD"]).stdout.trim();
  }

  branch() {
    return this.run(["branch", "--show-current"]).stdout.trim() || "DETACHED";
  }

  worktree() {
    return normalizePath(path.resolve(this.root));
  }

  isClean() {
    return this.run(["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trim().length === 0;
  }

  commitExists(commit) {
    if (!commit) return false;
    return this.run(["rev-parse", "--verify", `${commit}^{commit}`], { allowFailure: true }).status === 0;
  }

  isAncestor(baseCommit, candidateCommit) {
    if (!baseCommit || !candidateCommit) return false;
    return this.run(["merge-base", "--is-ancestor", baseCommit, candidateCommit], { allowFailure: true }).status === 0;
  }

  diffNames(baseCommit, candidateCommit) {
    const output = this.run(["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=ACMRTUXB", baseCommit, candidateCommit]).stdout;
    return sortedUnique(output.split(/\r?\n/).map(normalizePath).filter(Boolean));
  }

  diffPatch(baseCommit, candidateCommit) {
    return this.run(["diff", "--no-ext-diff", "--no-color", "--binary", baseCommit, candidateCommit]).stdout;
  }
}

class EventStore {
  constructor({ stateDir, policy, clock, idFactory }) {
    this.stateDir = stateDir;
    this.policy = policy;
    this.clock = clock;
    this.idFactory = idFactory;
    this.eventsPath = path.join(stateDir, EVENTS_FILE);
    this.lockPath = path.join(stateDir, LOCK_FILE);
  }

  read() {
    if (!fs.existsSync(this.eventsPath)) return [];
    const lines = fs.readFileSync(this.eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
    const events = [];
    let previousHash = null;
    for (let index = 0; index < lines.length; index += 1) {
      let event;
      try {
        event = JSON.parse(lines[index]);
      } catch (error) {
        invariant(false, `invalid JSONL event at line ${index + 1}: ${error.message}`, "EVENT_LOG_INVALID_JSON");
      }
      for (const field of REQUIRED_EVENT_FIELDS) {
        invariant(Object.hasOwn(event, field), `event ${index + 1} is missing ${field}`, "EVENT_SCHEMA_INVALID");
      }
      invariant(event.previous_event_hash === previousHash, `event hash chain breaks at line ${index + 1}`, "EVENT_HASH_CHAIN_INVALID");
      invariant(hashEvent(event) === event.event_hash, `event hash mismatch at line ${index + 1}`, "EVENT_HASH_INVALID");
      events.push(event);
      previousHash = event.event_hash;
    }
    return events;
  }

  acquireLock() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const staleMilliseconds = Number(this.policy.concurrency.lock_stale_ms ?? 30000);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const descriptor = fs.openSync(this.lockPath, "wx");
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquired_at: this.clock().toISOString() }));
        return descriptor;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const stats = fs.statSync(this.lockPath);
        if (Date.now() - stats.mtimeMs > staleMilliseconds) {
          fs.unlinkSync(this.lockPath);
          continue;
        }
        sleepMilliseconds(20);
      }
    }
    invariant(false, "orchestrator event log is locked by another writer", "EVENT_LOG_LOCKED");
  }

  releaseLock(descriptor) {
    try {
      fs.closeSync(descriptor);
    } finally {
      if (fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);
    }
  }

  transact(buildDrafts) {
    const descriptor = this.acquireLock();
    try {
      const events = this.read();
      const drafts = buildDrafts(events) ?? [];
      invariant(Array.isArray(drafts), "event transaction must return an array", "EVENT_TRANSACTION_INVALID");
      if (!drafts.length) return [];
      let previousHash = events.at(-1)?.event_hash ?? null;
      const finalized = drafts.map((draft) => {
        const event = {
          ...draft,
          event_id: draft.event_id ?? this.idFactory(),
          timestamp: draft.timestamp ?? this.clock().toISOString(),
          previous_event_hash: previousHash,
        };
        event.event_hash = hashEvent(event);
        previousHash = event.event_hash;
        return event;
      });
      fs.mkdirSync(this.stateDir, { recursive: true });
      const fileDescriptor = fs.openSync(this.eventsPath, "a");
      try {
        for (const event of finalized) fs.writeSync(fileDescriptor, `${JSON.stringify(event)}\n`, null, "utf8");
        fs.fsyncSync(fileDescriptor);
      } finally {
        fs.closeSync(fileDescriptor);
      }
      return finalized;
    } finally {
      this.releaseLock(descriptor);
    }
  }
}

function emptyCounters() {
  return { retry: 0, rework: 0, replan: 0 };
}

function emptyAcceptance() {
  return {
    commands: [],
    diff_hash: null,
    scope_evidence_hash: null,
    secret_scan_evidence_hash: null,
  };
}

function emptyExecution() {
  return {
    model_tier: null,
    actual_model: null,
    tokens: 0,
    time_ms: 0,
    known_cost: null,
  };
}

class ProjectOrchestrator {
  constructor({
    root = DEFAULT_ROOT,
    stateDir = null,
    policy = null,
    router = null,
    git = null,
    clock = () => new Date(),
    idFactory = () => crypto.randomUUID(),
  } = {}) {
    this.root = path.resolve(root);
    this.stateDir = path.resolve(stateDir ?? path.join(this.root, DEFAULT_STATE_DIR));
    this.policy = policy ? clone(policy) : readJsonFile(path.join(this.stateDir, POLICY_FILE));
    this.router = router ?? new ProjectContextRouter(this.root);
    this.git = git ?? new GitClient(this.root);
    this.clock = clock;
    this.idFactory = idFactory;
    this.validatePolicy();
    this.store = new EventStore({ stateDir: this.stateDir, policy: this.policy, clock, idFactory });
  }

  validatePolicy() {
    invariant(this.policy.schema_version === "g07-autonomy-policy/v1", "unsupported autonomy policy", "POLICY_INVALID");
    invariant(this.policy.control_anchor === "G07::AUTONOMY", "policy is not bound to G07::AUTONOMY", "POLICY_INVALID");
    invariant(this.policy.concurrency.max_writers === 1, "policy must allow exactly one writer", "POLICY_INVALID");
    invariant(this.policy.concurrency.max_read_only_reviewers === 2, "policy must allow exactly two read-only reviewers", "POLICY_INVALID");
    invariant(this.policy.retry_policy.max_rework === 3, "policy must use three rework attempts", "POLICY_INVALID");
    invariant(this.policy.retry_policy.max_replan === 2, "policy must use two Replan attempts", "POLICY_INVALID");
    invariant(this.policy.budget.notify_ratio === 0.8 && this.policy.budget.hard_stop_ratio === 1, "budget thresholds must be 80% and 100%", "POLICY_INVALID");
  }

  makeDraft({
    eventType,
    runId,
    taskId = null,
    attemptId = null,
    role = "orchestrator",
    baseCommit = null,
    candidateCommit = null,
    contextHash = null,
    lease = null,
    fromStatus = null,
    toStatus = null,
    acceptance = null,
    verdicts = null,
    decisionLevel = "TASK_AUTONOMOUS",
    fingerprint = null,
    counters = null,
    execution = null,
    creatorRequiredReason = null,
    environmentApprovalReason = null,
    payload = {},
  }) {
    invariant(runId, "autonomy_run_id is required", "RUN_ID_REQUIRED");
    invariant(ROLE_NAMES.has(role), `unknown role: ${role}`, "ROLE_INVALID");
    invariant(DECISION_LEVELS.has(decisionLevel), `unknown decision level: ${decisionLevel}`, "DECISION_LEVEL_INVALID");
    if (fromStatus !== null) invariant(TASK_STATUSES.has(fromStatus), `unknown from_status: ${fromStatus}`, "STATUS_INVALID");
    if (toStatus !== null) invariant(TASK_STATUSES.has(toStatus), `unknown to_status: ${toStatus}`, "STATUS_INVALID");
    const task = taskId ? this.router.taskById.get(taskId) : null;
    if (taskId) invariant(task, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
    return {
      event_version: "g07-autonomy-event/v1",
      event_id: this.idFactory(),
      event_type: eventType,
      autonomy_run_id: runId,
      slice_id: task?.values["切片"] ?? payload.slice_id ?? null,
      task_id: taskId,
      attempt_id: attemptId,
      role,
      base_commit: baseCommit,
      candidate_commit: candidateCommit,
      context_hash: contextHash,
      branch: this.git.branch(),
      worktree: this.git.worktree(),
      lease,
      from_status: fromStatus,
      to_status: toStatus,
      timestamp: this.clock().toISOString(),
      acceptance: { ...emptyAcceptance(), ...(acceptance ?? {}) },
      verdicts: { auditor: null, reviewer: null, ...(verdicts ?? {}) },
      decision_level: decisionLevel,
      failure_fingerprint: fingerprint,
      counters: { ...emptyCounters(), ...(counters ?? {}) },
      execution: { ...emptyExecution(), ...(execution ?? {}) },
      creator_required_reason: creatorRequiredReason,
      environment_approval_reason: environmentApprovalReason,
      payload,
      previous_event_hash: null,
      event_hash: null,
    };
  }

  project(events = this.store.read(), { at = this.clock() } = {}) {
    const taskStates = new Map(this.router.tasks.map((task) => [task.id, {
      task_id: task.id,
      slice_id: task.values["切片"],
      status: task.values["状态"],
      counters: emptyCounters(),
      candidate_commit: null,
      context_hash: null,
      last_event_id: null,
      last_evidence: null,
    }]));
    const leases = new Map();
    const reports = new Map();
    const usageByRun = new Map();
    const runBudgetLimits = new Map();
    const stopsByRun = new Map();

    for (const event of events) {
      if (event.task_id) {
        const state = taskStates.get(event.task_id);
        invariant(state, `event references unknown Task ${event.task_id}`, "EVENT_TASK_UNKNOWN");
        invariant(event.from_status === state.status, `event ${event.event_id} expected ${event.from_status} but projection is ${state.status}`, "EVENT_STATUS_CHAIN_INVALID");
        state.status = event.to_status;
        state.counters = { ...event.counters };
        if (event.candidate_commit) state.candidate_commit = event.candidate_commit;
        if (event.context_hash) state.context_hash = event.context_hash;
        state.last_event_id = event.event_id;
        if (event.event_type === "EVIDENCE_VERIFIED") state.last_evidence = event.event_hash;
      }

      const leaseAction = event.lease?.action;
      if (leaseAction === "ACQUIRE") leases.set(event.lease.lease_id, { ...event.lease, task_id: event.task_id, run_id: event.autonomy_run_id });
      if (["RELEASE", "EXPIRE"].includes(leaseAction)) leases.delete(event.lease.lease_id);
      if (leaseAction === "RELEASE_ALL_TASK") {
        for (const [leaseId, lease] of leases) if (lease.task_id === event.task_id) leases.delete(leaseId);
      }

      if (event.payload?.report) {
        if (!reports.has(event.task_id)) reports.set(event.task_id, []);
        reports.get(event.task_id).push(event.payload.report);
      }
      if (event.payload?.run_budget_limits) runBudgetLimits.set(event.autonomy_run_id, event.payload.run_budget_limits);
      if (event.event_type === "HARD_STOP") stopsByRun.set(event.autonomy_run_id, event);

      const usage = usageByRun.get(event.autonomy_run_id) ?? { tokens: 0, elapsed_ms: 0, known_cost: null, has_unknown_cost: false };
      usage.tokens += Number(event.execution.tokens ?? 0);
      usage.elapsed_ms += Number(event.execution.time_ms ?? 0);
      if (event.execution.known_cost === null || event.execution.known_cost === undefined) usage.has_unknown_cost = true;
      else usage.known_cost = Number(usage.known_cost ?? 0) + Number(event.execution.known_cost);
      usageByRun.set(event.autonomy_run_id, usage);
    }

    const activeLeases = [];
    const expiredLeases = [];
    for (const lease of leases.values()) {
      if (new Date(lease.expires_at).getTime() <= at.getTime()) expiredLeases.push(lease);
      else activeLeases.push(lease);
    }

    const slices = new Map();
    for (const sliceRow of this.router.sliceRows) {
      const sliceId = sliceRow.values["切片"];
      const states = [...taskStates.values()].filter((state) => state.slice_id === sliceId);
      let status = "PLANNED";
      if (states.some((state) => state.status === "CREATOR_REQUIRED")) status = "CREATOR_REQUIRED";
      else if (states.some((state) => ["BLOCKED", "REPLAN"].includes(state.status))) status = "BLOCKED";
      else if (states.length && states.every((state) => state.status === "VERIFIED")) status = "VERIFIED";
      else if (states.some((state) => ["LEASED", "IN_PROGRESS", "IMPLEMENTED", "VERIFYING", "REWORK"].includes(state.status))) status = "IN_PROGRESS";
      else if (states.some((state) => state.status === "READY")) status = "READY";
      slices.set(sliceId, { slice_id: sliceId, status, task_count: states.length });
    }

    return {
      events,
      taskStates,
      slices,
      activeLeases,
      expiredLeases,
      reports,
      usageByRun,
      runBudgetLimits,
      stopsByRun,
    };
  }

  dependenciesVerified(taskId, projection) {
    const task = this.router.taskById.get(taskId);
    return this.router.taskGraph(task).upstream.every((dependency) => projection.taskStates.get(dependency.task_id)?.status === "VERIFIED");
  }

  isCriticalTask(taskId) {
    const lines = this.router.control.lines;
    const start = lines.findIndex((line) => line.trim() === "### 关键路径与并行面");
    if (start < 0) return false;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^###\s+/.test(lines[index])) {
        end = index;
        break;
      }
    }
    return lines.slice(start, end).some((line) => line.includes(taskId));
  }

  budgetState(runId, projection = this.project()) {
    const usage = projection.usageByRun.get(runId) ?? { tokens: 0, elapsed_ms: 0, known_cost: null, has_unknown_cost: false };
    const limits = {
      ...this.policy.budget.limits,
      ...(projection.runBudgetLimits.get(runId) ?? {}),
    };
    const dimensions = [
      ["tokens", usage.tokens, limits.tokens],
      ["elapsed_ms", usage.elapsed_ms, limits.elapsed_ms],
      ["known_cost", usage.known_cost, limits.known_cost],
    ].map(([name, used, limit]) => {
      if (limit === null || limit === undefined) return { name, used, limit: null, ratio: null, state: "UNCONFIGURED" };
      if (name === "known_cost" && (used === null || usage.has_unknown_cost)) return { name, used: null, limit, ratio: null, state: "UNKNOWN_USAGE" };
      const ratio = Number(limit) === 0 ? (Number(used) === 0 ? 0 : Number.POSITIVE_INFINITY) : Number(used) / Number(limit);
      return { name, used, limit: Number(limit), ratio, state: ratio >= 1 ? "HARD_STOP" : ratio >= 0.8 ? "NOTIFY" : "OK" };
    });
    const hardStop = dimensions.some((item) => item.state === "HARD_STOP" || item.state === "UNKNOWN_USAGE");
    const notify = !hardStop && dimensions.some((item) => item.state === "NOTIFY");
    const configured = dimensions.some((item) => item.limit !== null);
    return {
      notify_ratio: this.policy.budget.notify_ratio,
      hard_stop_ratio: this.policy.budget.hard_stop_ratio,
      dimensions,
      notify,
      hard_stop: hardStop,
      state: hardStop ? "HARD_STOP" : notify ? "NOTIFY_80_PERCENT" : configured ? "OK" : "UNCONFIGURED",
    };
  }

  evaluateAction(action, runId, projection = this.project()) {
    const normalized = String(action).toUpperCase();
    const budget = this.budgetState(runId, projection);
    if (budget.hard_stop) {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "BUDGET_100_PERCENT_OR_UNKNOWN_COST", budget };
    }
    if (this.policy.hard_stop_actions.includes(normalized) || this.policy.forbidden_automatic_actions.includes(normalized)) {
      return {
        allowed: false,
        hard_stop: true,
        decision_level: ["WRITE_G07_GATE_APPROVED", "MERGE_TO_MAIN"].includes(normalized)
          ? "CREATOR_REQUIRED"
          : "ENVIRONMENT_APPROVAL_REQUIRED",
        reason: `ACTION_${normalized}_FORBIDDEN_IN_G07`,
        budget,
      };
    }
    if (normalized === "PRODUCT_TASK_WRITE" && !this.policy.product_task_execution_allowed) {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "G07_PHASE_PRODUCT_TASK_EXECUTION_DISABLED", budget };
    }
    if (normalized === "PRODUCT_TASK_WRITE" && this.git.branch() !== this.policy.integration_branch) {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "NOT_ON_AUTONOMY_INTEGRATION_BRANCH", budget };
    }
    return { allowed: true, hard_stop: false, decision_level: "TASK_AUTONOMOUS", reason: null, budget };
  }

  status({ runId = "default" } = {}) {
    const projection = this.project();
    const counts = {};
    for (const state of projection.taskStates.values()) counts[state.status] = (counts[state.status] ?? 0) + 1;
    const currentSlice = [...projection.slices.values()].find((slice) => slice.status !== "VERIFIED") ?? null;
    const recentEvidence = projection.events
      .filter((event) => event.acceptance.commands.length || event.verdicts.auditor || event.verdicts.reviewer || event.event_type === "EVIDENCE_VERIFIED")
      .slice(-10)
      .map((event) => ({ event_id: event.event_id, event_type: event.event_type, task_id: event.task_id, event_hash: event.event_hash, candidate_commit: event.candidate_commit }));
    return {
      schema_version: "project-orchestrator-status/v1",
      autonomy_run_id: runId,
      branch: this.git.branch(),
      current_slice: currentSlice,
      counts,
      ready: [...projection.taskStates.values()].filter((state) => state.status === "READY").map((state) => state.task_id),
      in_progress: [...projection.taskStates.values()].filter((state) => ["LEASED", "IN_PROGRESS", "IMPLEMENTED", "VERIFYING", "REWORK"].includes(state.status)).map((state) => ({ task_id: state.task_id, status: state.status })),
      blocked: [...projection.taskStates.values()].filter((state) => ["BLOCKED", "REPLAN", "CREATOR_REQUIRED"].includes(state.status)).map((state) => ({ task_id: state.task_id, status: state.status })),
      active_leases: projection.activeLeases,
      expired_leases: projection.expiredLeases,
      budget: this.budgetState(runId, projection),
      recent_evidence: recentEvidence,
      event_count: projection.events.length,
      last_event_hash: projection.events.at(-1)?.event_hash ?? null,
      g07_gate: this.router.gates.G07_GATE ?? "UNREGISTERED",
    };
  }

  nextTask(projection) {
    const activeWriter = projection.activeLeases.find((lease) => lease.mode === "WRITE");
    if (activeWriter) return { task_id: activeWriter.task_id, role: activeWriter.role, reason: "ACTIVE_WRITER_LEASE" };
    const replan = [...projection.taskStates.values()].find((state) => state.status === "REPLAN");
    if (replan) return { task_id: replan.task_id, role: "architect", reason: "REPLAN_REQUIRED" };
    const rework = [...projection.taskStates.values()].find((state) => state.status === "REWORK");
    if (rework) return { task_id: rework.task_id, role: "coder", reason: "REWORK_REQUIRED" };
    const verifying = [...projection.taskStates.values()].find((state) => state.status === "VERIFYING");
    if (verifying) return { task_id: verifying.task_id, role: "auditor", reason: "INDEPENDENT_EVIDENCE_REQUIRED" };
    const implemented = [...projection.taskStates.values()].find((state) => state.status === "IMPLEMENTED");
    if (implemented) return { task_id: implemented.task_id, role: "auditor", reason: "AUDIT_REQUIRED" };
    const ready = this.router.tasks.filter((task) => projection.taskStates.get(task.id).status === "READY" && this.dependenciesVerified(task.id, projection));
    if (!ready.length) return null;
    const task = ready[0];
    return {
      task_id: task.id,
      role: task.values["角色"].replace("VIEW::", "").toLowerCase(),
      reason: ready.length === 1 ? "UNIQUE_READY_TASK" : "TASK_INDEX_PRIORITY",
      ready_candidates: ready.map((candidate) => candidate.id),
    };
  }

  dryRun({ runId = "default" } = {}) {
    const before = this.store.read();
    const projection = this.project(before);
    const next = this.nextTask(projection);
    if (!next) {
      return {
        schema_version: "project-orchestrator-dry-run/v1",
        autonomy_run_id: runId,
        next: null,
        reason: "NO_READY_OR_ACTIVE_TASK",
        event_log_unchanged: true,
        event_count: before.length,
        g07_gate: this.router.gates.G07_GATE ?? "UNREGISTERED",
      };
    }
    const routeRole = ["coder", "auditor", "reviewer", "architect", "gap_auditor", "prompt_editor", "coordinator"].includes(next.role) ? next.role : "coordinator";
    const route = this.router.route({ role: routeRole, taskId: next.task_id });
    const action = this.evaluateAction("PRODUCT_TASK_WRITE", runId, projection);
    const after = this.store.read();
    return {
      schema_version: "project-orchestrator-dry-run/v1",
      autonomy_run_id: runId,
      selected_task_id: next.task_id,
      selected_role: next.role,
      selection_reason: next.reason,
      ready_candidates: next.ready_candidates ?? [next.task_id],
      task_status: projection.taskStates.get(next.task_id).status,
      fp_ids: route.input.fp_ids,
      declared_write_scope: route.access.declared_write_scope,
      effective_write_scope: route.access.expanded_write_patterns,
      context_hash: route.context_hash,
      base_commit: this.git.head(),
      router_execution_authorized: route.access.execution_authorized,
      policy_execution_allowed: action.allowed,
      policy_stop_reason: action.reason,
      decision_level: action.allowed ? route.decision.level : action.decision_level,
      budget: action.budget,
      event_log_unchanged: before.length === after.length
        && (before.at(-1)?.event_hash ?? null) === (after.at(-1)?.event_hash ?? null),
      event_count: after.length,
      product_files_written: false,
      task_status_changed: false,
      g07_gate: this.router.gates.G07_GATE ?? "UNREGISTERED",
    };
  }

  expiredLeaseDrafts(projection, runId) {
    const drafts = [];
    for (const lease of projection.expiredLeases.filter((item) => item.run_id === runId)) {
      const state = projection.taskStates.get(lease.task_id);
      const writer = lease.mode === "WRITE";
      const toStatus = writer && ["LEASED", "IN_PROGRESS"].includes(state.status) ? "READY" : state.status;
      const counters = { ...state.counters, retry: state.counters.retry + (writer ? 1 : 0) };
      drafts.push(this.makeDraft({
        eventType: "LEASE_EXPIRED",
        runId,
        taskId: lease.task_id,
        attemptId: lease.attempt_id,
        role: "orchestrator",
        baseCommit: lease.base_commit,
        candidateCommit: lease.candidate_commit,
        contextHash: lease.context_hash,
        lease: { ...lease, action: "EXPIRE" },
        fromStatus: state.status,
        toStatus,
        decisionLevel: "BLOCKED_TECHNICAL",
        fingerprint: failureFingerprint("LEASE_EXPIRED"),
        counters,
        payload: { reason: "LEASE_EXPIRED_RECOVERED" },
      }));
      state.status = toStatus;
      state.counters = counters;
    }
    return drafts;
  }

  lease({ runId, taskId = null, role, actorId, attemptId, ttlSeconds = null, contextHash = null, baseCommit = null, candidateCommit = null }) {
    invariant(runId && role && actorId && attemptId, "lease requires runId, role, actorId and attemptId", "LEASE_INPUT_INVALID");
    invariant(["coder", "prompt_editor", "auditor", "reviewer", "architect"].includes(role), `role cannot lease: ${role}`, "LEASE_ROLE_INVALID");
    const guard = this.evaluateAction(role === "coder" || role === "prompt_editor" ? "PRODUCT_TASK_WRITE" : "READ_ONLY_REVIEW", runId);
    invariant(guard.allowed, guard.reason, guard.decision_level, guard);
    const ttl = Number(ttlSeconds ?? this.policy.concurrency.default_lease_seconds);
    invariant(Number.isFinite(ttl) && ttl > 0, "lease ttl must be positive", "LEASE_TTL_INVALID");

    const finalized = this.store.transact((events) => {
      let projection = this.project(events);
      const drafts = this.expiredLeaseDrafts(projection, runId);
      projection = this.project([...events, ...drafts]);
      const selected = taskId ? { task_id: taskId, role } : this.nextTask(projection);
      invariant(selected?.task_id, "no Task is available to lease", "NO_LEASABLE_TASK");
      invariant(!taskId || selected.task_id === taskId, "selected Task does not match requested Task", "LEASE_TASK_MISMATCH");
      const task = this.router.taskById.get(selected.task_id);
      invariant(task, `unknown Task: ${selected.task_id}`, "TASK_NOT_FOUND");
      const state = projection.taskStates.get(task.id);
      const mode = ["coder", "prompt_editor"].includes(role) ? "WRITE" : "READ_ONLY";
      if (mode === "READ_ONLY") {
        invariant(projection.activeLeases.filter((item) => item.mode === "READ_ONLY").length < this.policy.concurrency.max_read_only_reviewers, "read-only review concurrency limit reached", "REVIEW_CONCURRENCY_BLOCKED");
      }
      if (mode === "WRITE") {
        invariant(state.status === "READY", `writer lease requires READY, got ${state.status}`, "TASK_NOT_READY");
        invariant(this.dependenciesVerified(task.id, projection), "Task dependencies are not VERIFIED", "DEPENDENCIES_NOT_VERIFIED");
        invariant(task.values["角色"] === `VIEW::${role.toUpperCase()}`, `Task owner is ${task.values["角色"]}`, "TASK_ROLE_MISMATCH");
        invariant(projection.activeLeases.filter((item) => item.mode === "WRITE").length < this.policy.concurrency.max_writers, "another writer lease is active", "DOUBLE_WRITER_BLOCKED");
      } else if (["auditor", "reviewer"].includes(role)) {
        invariant(["IMPLEMENTED", "VERIFYING"].includes(state.status), `review lease requires IMPLEMENTED/VERIFYING, got ${state.status}`, "TASK_NOT_REVIEWABLE");
        invariant(candidateCommit && state.candidate_commit === candidateCommit, "review lease must bind the current candidate commit", "CANDIDATE_COMMIT_MISMATCH");
      } else if (role === "architect") {
        invariant(state.status === "REPLAN", `architect lease requires REPLAN, got ${state.status}`, "TASK_NOT_IN_REPLAN");
      }

      const routeRole = role === "architect" ? "architect" : role;
      const route = this.router.route({ role: routeRole, taskId: task.id });
      const latestCoderReport = this.latestReport(projection, task.id, "coder", state.candidate_commit);
      const effectiveContextHash = contextHash ?? (mode === "READ_ONLY" ? state.context_hash : null) ?? route.context_hash;
      const effectiveBaseCommit = baseCommit ?? (mode === "READ_ONLY" ? latestCoderReport?.base_commit : null) ?? this.git.head();
      const leaseId = this.idFactory();
      const acquiredAt = this.clock();
      const leaseRecord = {
        action: "ACQUIRE",
        lease_id: leaseId,
        mode,
        role,
        actor_id: actorId,
        attempt_id: attemptId,
        acquired_at: acquiredAt.toISOString(),
        expires_at: new Date(acquiredAt.getTime() + ttl * 1000).toISOString(),
        base_commit: effectiveBaseCommit,
        candidate_commit: candidateCommit,
        context_hash: effectiveContextHash,
      };
      const toStatus = mode === "WRITE" ? "LEASED" : state.status === "IMPLEMENTED" ? "VERIFYING" : state.status;
      drafts.push(this.makeDraft({
        eventType: "LEASE_ACQUIRED",
        runId,
        taskId: task.id,
        attemptId,
        role,
        baseCommit: effectiveBaseCommit,
        candidateCommit,
        contextHash: effectiveContextHash,
        lease: leaseRecord,
        fromStatus: state.status,
        toStatus,
        counters: state.counters,
        decisionLevel: role === "architect" ? "ARCHITECT_AUTONOMOUS" : "TASK_AUTONOMOUS",
        payload: { actor_id: actorId },
      }));
      return drafts;
    });
    return finalized.at(-1);
  }

  latestReport(projection, taskId, role, candidateCommit = null) {
    return [...(projection.reports.get(taskId) ?? [])]
      .reverse()
      .find((report) => report.role === role && (!candidateCommit || report.candidate_commit === candidateCommit)) ?? null;
  }

  validateReport(report) {
    invariant(report && typeof report === "object", "report must be a JSON object", "REPORT_INVALID");
    for (const field of ["report_version", "task_id", "role", "actor_id", "session_id", "attempt_id", "base_commit", "candidate_commit", "context_hash", "verdict"]) {
      invariant(Object.hasOwn(report, field) && report[field] !== "", `report is missing ${field}`, "REPORT_SCHEMA_INVALID");
    }
    invariant(report.report_version === "g07-role-report/v1", "unsupported role report", "REPORT_SCHEMA_INVALID");
    invariant(REPORT_ROLES.has(report.role), `invalid report role: ${report.role}`, "REPORT_ROLE_INVALID");
    invariant(this.router.taskById.has(report.task_id), `unknown report Task: ${report.task_id}`, "TASK_NOT_FOUND");
    invariant(isSha256(report.context_hash), "report context_hash must be SHA-256", "REPORT_CONTEXT_INVALID");
    for (const [field, value] of [["tokens", report.execution?.tokens ?? 0], ["time_ms", report.execution?.time_ms ?? 0]]) {
      invariant(Number.isFinite(Number(value)) && Number(value) >= 0, `report execution.${field} must be non-negative`, "REPORT_USAGE_INVALID");
    }
    if (report.execution?.known_cost !== null && report.execution?.known_cost !== undefined) {
      invariant(Number.isFinite(Number(report.execution.known_cost)) && Number(report.execution.known_cost) >= 0, "report execution.known_cost must be null or non-negative", "REPORT_USAGE_INVALID");
    }
    return report;
  }

  record({ runId, report }) {
    this.validateReport(report);
    invariant(runId, "record requires runId", "RUN_ID_REQUIRED");
    const finalized = this.store.transact((events) => {
      const projection = this.project(events);
      const state = projection.taskStates.get(report.task_id);
      const lease = projection.activeLeases.find((item) => item.task_id === report.task_id
        && item.role === report.role
        && item.actor_id === report.actor_id
        && item.attempt_id === report.attempt_id);
      invariant(lease, "report does not match an active independent role lease", "REPORT_LEASE_MISMATCH");
      invariant(report.context_hash === lease.context_hash, "report context_hash does not match lease", "REPORT_CONTEXT_MISMATCH");
      invariant(report.base_commit === lease.base_commit, "report base_commit does not match lease", "REPORT_BASE_COMMIT_MISMATCH");
      if (report.role !== "architect") {
        invariant(report.candidate_commit && this.git.commitExists(report.candidate_commit), "candidate commit does not exist", "CANDIDATE_COMMIT_MISSING");
        invariant(this.git.head() === report.candidate_commit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
        invariant(this.git.commitExists(report.base_commit) && this.git.isAncestor(report.base_commit, report.candidate_commit), "report base commit is missing or not an ancestor", "BASE_COMMIT_INVALID");
      }
      invariant(report.branch === this.git.branch() && report.branch === this.policy.integration_branch, "report is not bound to the autonomy integration branch", "REPORT_BRANCH_MISMATCH");
      invariant(normalizePath(path.resolve(report.worktree)) === this.git.worktree(), "report worktree does not match the orchestrator worktree", "REPORT_WORKTREE_MISMATCH");
      if (["coder", "prompt_editor"].includes(report.role)) {
        invariant(state.status === "IN_PROGRESS", `${report.role} report requires IN_PROGRESS, got ${state.status}`, "REPORT_STATE_INVALID");
      }
      if (["auditor", "reviewer"].includes(report.role)) {
        invariant(state.candidate_commit === report.candidate_commit, "review targets a stale candidate commit", "STALE_REVIEW_COMMIT");
      }

      let toStatus = state.status;
      let decisionLevel = "TASK_AUTONOMOUS";
      let fingerprint = null;
      let creatorReason = null;
      let environmentReason = null;
      let counters = { ...state.counters };
      let leaseAction = { ...lease, action: "RELEASE" };
      const auditorVerdict = report.role === "auditor" ? report.verdict : null;
      const reviewerVerdict = report.role === "reviewer" ? report.verdict : null;

      const reviewFailed = (report.role === "auditor" && report.verdict === "FAIL")
        || (report.role === "reviewer" && report.verdict === "REQUEST_CHANGES");
      if (reviewFailed) {
        invariant(state.status === "VERIFYING", `review failure requires VERIFYING, got ${state.status}`, "REPORT_STATE_INVALID");
        counters.rework += 1;
        fingerprint = failureFingerprint(report.failure_fingerprint ?? `${report.role}:${report.verdict}:${report.summary ?? ""}`);
        if (counters.rework >= this.policy.retry_policy.max_rework) {
          counters.replan += 1;
          if (counters.replan >= this.policy.retry_policy.max_replan) {
            if (this.isCriticalTask(report.task_id)) {
              toStatus = "CREATOR_REQUIRED";
              decisionLevel = "CREATOR_REQUIRED";
              creatorReason = "CRITICAL_PATH_REPLAN_LIMIT_EXHAUSTED";
            } else {
              toStatus = "BLOCKED";
              decisionLevel = "BLOCKED_TECHNICAL";
            }
          } else {
            toStatus = "REPLAN";
            decisionLevel = "ARCHITECT_AUTONOMOUS";
          }
        } else {
          toStatus = "REWORK";
        }
        leaseAction = { action: "RELEASE_ALL_TASK", lease_id: lease.lease_id, task_id: report.task_id };
      } else if (report.role === "architect") {
        invariant(state.status === "REPLAN", `architect report requires REPLAN, got ${state.status}`, "REPORT_STATE_INVALID");
        const category = report.decision?.category;
        invariant(["A", "B", "C", "D"].includes(category), "architect report must use Replan A/B/C/D", "REPLAN_CATEGORY_INVALID");
        if (["A", "B"].includes(category)) {
          toStatus = "READY";
          counters.rework = 0;
          decisionLevel = "ARCHITECT_AUTONOMOUS";
        } else if (category === "C") {
          toStatus = "CREATOR_REQUIRED";
          decisionLevel = "CREATOR_REQUIRED";
          creatorReason = report.decision.reason ?? "REPLAN_C_REQUIRES_CREATOR";
        } else {
          toStatus = "BLOCKED";
          decisionLevel = report.decision.environment_approval_required ? "ENVIRONMENT_APPROVAL_REQUIRED" : "BLOCKED_TECHNICAL";
          environmentReason = report.decision.environment_approval_required ? report.decision.reason ?? "REPLAN_D_ENVIRONMENT" : null;
        }
      } else if (report.role === "coder" && ["BLOCKED", "CREATOR_REQUIRED"].includes(report.verdict)) {
        toStatus = report.verdict;
        decisionLevel = report.verdict === "CREATOR_REQUIRED" ? "CREATOR_REQUIRED" : "BLOCKED_TECHNICAL";
        creatorReason = report.verdict === "CREATOR_REQUIRED" ? report.summary ?? "CODER_ESCALATION" : null;
      }

      return [this.makeDraft({
        eventType: "ROLE_REPORT_RECORDED",
        runId,
        taskId: report.task_id,
        attemptId: report.attempt_id,
        role: report.role,
        baseCommit: report.base_commit,
        candidateCommit: report.candidate_commit,
        contextHash: report.context_hash,
        lease: leaseAction,
        fromStatus: state.status,
        toStatus,
        acceptance: report.acceptance,
        verdicts: { auditor: auditorVerdict, reviewer: reviewerVerdict },
        decisionLevel,
        fingerprint,
        counters,
        execution: report.execution,
        creatorRequiredReason: creatorReason,
        environmentApprovalReason: environmentReason,
        payload: { report },
      })];
    });
    return finalized[0];
  }

  transition({ runId, taskId, toStatus, attemptId, role = "orchestrator", candidateCommit = null, contextHash = null, decisionLevel = "TASK_AUTONOMOUS", creatorApprovalEvidence = null, resolutionEvidence = null }) {
    invariant(runId && taskId && toStatus, "transition requires runId, taskId and toStatus", "TRANSITION_INPUT_INVALID");
    invariant(TASK_STATUSES.has(toStatus), `unknown target status: ${toStatus}`, "STATUS_INVALID");
    invariant(toStatus !== "VERIFIED", "VERIFYING -> VERIFIED is reserved for verify-evidence", "EVIDENCE_REQUIRED");
    invariant(!["REWORK", "REPLAN"].includes(toStatus), `${toStatus} is reserved for structured failed role reports`, "ROLE_REPORT_REQUIRED");
    if (toStatus === "CREATOR_REQUIRED") invariant(decisionLevel === "CREATOR_REQUIRED", "CREATOR_REQUIRED status requires CREATOR_REQUIRED decision level", "DECISION_LEVEL_INVALID");
    if (toStatus === "BLOCKED") invariant(["BLOCKED_TECHNICAL", "ENVIRONMENT_APPROVAL_REQUIRED"].includes(decisionLevel), "BLOCKED status requires a technical/environment decision level", "DECISION_LEVEL_INVALID");
    const guard = this.evaluateAction("PRODUCT_TASK_WRITE", runId);
    invariant(guard.allowed, guard.reason, guard.decision_level, guard);

    const finalized = this.store.transact((events) => {
      const projection = this.project(events);
      const state = projection.taskStates.get(taskId);
      invariant(state, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
      invariant(TRANSITIONS.get(state.status)?.has(toStatus), `illegal transition ${state.status} -> ${toStatus}`, "ILLEGAL_TRANSITION");
      invariant(!(state.status === "PLANNED" && toStatus === "READY"), "PLANNED -> READY is reserved for unlock", "UNLOCK_REQUIRED");
      invariant(!(state.status === "READY" && toStatus === "LEASED"), "READY -> LEASED is reserved for lease", "LEASE_REQUIRED");
      if (state.status === "CREATOR_REQUIRED") invariant(String(creatorApprovalEvidence ?? "").startsWith("CREATOR_EXPLICIT_"), "creator approval evidence is required", "CREATOR_APPROVAL_REQUIRED");
      if (state.status === "BLOCKED" && toStatus === "READY") invariant(resolutionEvidence, "technical resolution evidence is required", "RESOLUTION_EVIDENCE_REQUIRED");
      if (state.status === "LEASED" && toStatus === "IN_PROGRESS") {
        invariant(projection.activeLeases.some((lease) => lease.task_id === taskId && lease.mode === "WRITE"), "active writer lease required", "LEASE_REQUIRED");
      }
      if (toStatus === "IMPLEMENTED") {
        const report = this.latestReport(projection, taskId, "coder", candidateCommit);
        invariant(report && report.verdict === "IMPLEMENTED", "structured coder IMPLEMENTED report is required", "CODER_REPORT_REQUIRED");
        invariant(candidateCommit && this.git.commitExists(candidateCommit), "candidate commit does not exist", "CANDIDATE_COMMIT_MISSING");
        invariant(this.git.head() === candidateCommit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
      }
      const leaseAction = ["IMPLEMENTED", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(toStatus)
        ? { action: "RELEASE_ALL_TASK", task_id: taskId, lease_id: null }
        : null;
      return [this.makeDraft({
        eventType: "TASK_TRANSITION",
        runId,
        taskId,
        attemptId,
        role,
        baseCommit: this.latestReport(projection, taskId, "coder", candidateCommit)?.base_commit ?? this.git.head(),
        candidateCommit: candidateCommit ?? state.candidate_commit,
        contextHash: contextHash ?? state.context_hash,
        lease: leaseAction,
        fromStatus: state.status,
        toStatus,
        decisionLevel,
        counters: state.counters,
        payload: { creator_approval_evidence: creatorApprovalEvidence, resolution_evidence: resolutionEvidence },
      })];
    });
    return finalized[0];
  }

  unlock({ runId }) {
    invariant(runId, "unlock requires runId", "RUN_ID_REQUIRED");
    const guard = this.evaluateAction("PRODUCT_TASK_WRITE", runId);
    invariant(guard.allowed, guard.reason, guard.decision_level, guard);
    const finalized = this.store.transact((events) => {
      const projection = this.project(events);
      const gate = this.router.gateSnapshot();
      invariant(gate.active_execution_gate_valid && gate.g05.valid && gate.g06.valid, "active Gate or router artifact is invalid", "GATE_INVALID");
      const drafts = [];
      for (const task of this.router.tasks) {
        const state = projection.taskStates.get(task.id);
        if (state.status !== "PLANNED" || !this.dependenciesVerified(task.id, projection)) continue;
        drafts.push(this.makeDraft({
          eventType: "TASK_UNLOCKED",
          runId,
          taskId: task.id,
          role: "orchestrator",
          baseCommit: this.git.head(),
          fromStatus: "PLANNED",
          toStatus: "READY",
          counters: state.counters,
          payload: { dependency_evidence: this.router.taskGraph(task).upstream.map((item) => ({ task_id: item.task_id, status: projection.taskStates.get(item.task_id).status })) },
        }));
        state.status = "READY";
      }
      return drafts;
    });
    return { unlocked: finalized.map((event) => event.task_id), events: finalized };
  }

  scanSecrets(patchText) {
    const patterns = new Map([
      ["AWS_ACCESS_KEY", /AKIA[0-9A-Z]{16}/],
      ["OPENAI_KEY", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
      ["GITHUB_TOKEN", /gh[pousr]_[A-Za-z0-9]{30,}/],
      ["ANTHROPIC_KEY", /sk-ant-[A-Za-z0-9_-]{20,}/],
      ["GOOGLE_API_KEY", /AIza[0-9A-Za-z_-]{30,}/],
      ["SLACK_TOKEN", /xox[baprs]-[0-9A-Za-z-]{20,}/],
      ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ]);
    const hits = [...patterns.entries()].filter(([, pattern]) => pattern.test(patchText)).map(([name]) => name);
    return { passed: hits.length === 0, hit_types: hits, evidence_hash: sha256(patchText) };
  }

  verifyEvidence({ runId, taskId, candidateCommit, contextHash, attemptId = null }) {
    invariant(runId && taskId && candidateCommit && contextHash, "verify-evidence requires runId, taskId, candidateCommit and contextHash", "VERIFY_INPUT_INVALID");
    const finalized = this.store.transact((events) => {
      const projection = this.project(events);
      const state = projection.taskStates.get(taskId);
      invariant(state.status === "VERIFYING", `verify-evidence requires VERIFYING, got ${state.status}`, "TASK_NOT_VERIFYING");
      invariant(this.git.commitExists(candidateCommit), "candidate commit does not exist", "CANDIDATE_COMMIT_MISSING");
      invariant(this.git.head() === candidateCommit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");

      const coder = this.latestReport(projection, taskId, "coder", candidateCommit);
      const auditor = this.latestReport(projection, taskId, "auditor", candidateCommit);
      const reviewer = this.latestReport(projection, taskId, "reviewer", candidateCommit);
      invariant(coder && auditor && reviewer, "coder, auditor and reviewer reports are all required for the same candidate commit", "INCOMPLETE_ROLE_EVIDENCE");
      invariant(coder.verdict === "IMPLEMENTED", "coder verdict must be IMPLEMENTED", "CODER_VERDICT_INVALID");
      invariant(auditor.verdict === "PASS", "auditor verdict must be PASS", "AUDITOR_VERDICT_INVALID");
      invariant(reviewer.verdict === "APPROVE", "reviewer verdict must be APPROVE", "REVIEWER_VERDICT_INVALID");
      invariant([coder, auditor, reviewer].every((report) => report.base_commit === coder.base_commit
        && report.candidate_commit === candidateCommit
        && report.context_hash === contextHash), "all reports must bind the same base/candidate/context", "EVIDENCE_VERSION_MISMATCH");
      invariant([coder, auditor, reviewer].every((report) => report.branch === this.policy.integration_branch
        && normalizePath(path.resolve(report.worktree)) === this.git.worktree()), "all reports must bind the integration branch and current worktree", "EVIDENCE_WORKTREE_MISMATCH");
      invariant(state.context_hash === contextHash, "Task projection context hash differs from the evidence set", "EVIDENCE_VERSION_MISMATCH");
      invariant(new Set([coder.actor_id, auditor.actor_id, reviewer.actor_id]).size === 3
        && new Set([coder.session_id, auditor.session_id, reviewer.session_id]).size === 3, "coder, auditor and reviewer must be independent actors and sessions", "SELF_REVIEW_BLOCKED");
      invariant(this.git.isAncestor(coder.base_commit, candidateCommit), "base commit is not an ancestor of candidate", "BASE_COMMIT_INVALID");

      const currentContext = this.router.route({ role: "coder", taskId });
      const blockingControlDrift = currentContext.conflicts_or_missing_references.filter((item) => item.level === "BLOCKING"
        && ["active_gate", "g05_registration", "g06_artifact", "protected_hash_drift", "control_status_narrative_drift", "control_anchor"].includes(item.kind));
      invariant(blockingControlDrift.length === 0, "Gate, protected source, router artifact, or control anchor drifted", "CONTEXT_CONTROL_DRIFT", blockingControlDrift);
      const task = this.router.taskById.get(taskId);
      const expectedCommand = task.values["验收命令"];
      invariant(coder.acceptance?.commands?.some((entry) => entry.command === expectedCommand && entry.exit_code === 0 && isSha256(entry.evidence_hash)), "acceptance command evidence is missing or failed", "ACCEPTANCE_EVIDENCE_INVALID");
      const auditorKinds = new Set((auditor.evidence ?? []).filter((item) => item.passed && isSha256(item.evidence_hash)).map((item) => item.kind));
      invariant(["normal", "exception", "recovery"].every((kind) => auditorKinds.has(kind)), "auditor must provide normal, exception and recovery evidence", "AUDITOR_EVIDENCE_INCOMPLETE");
      invariant(["contract", "diff", "write_channel", "cross_fp"].every((key) => reviewer.checks?.[key] === true), "reviewer contract/diff/write-channel/cross-FP checks must pass", "REVIEWER_EVIDENCE_INCOMPLETE");

      const diffNames = this.git.diffNames(coder.base_commit, candidateCommit);
      const allowedPatterns = this.router.expandWriteScope(task);
      const outOfScope = diffNames.filter((file) => !allowedPatterns.some((pattern) => globToRegExp(pattern).test(file)));
      invariant(outOfScope.length === 0, `diff exceeds Task write_scope: ${outOfScope.join(", ")}`, "SCOPE_VIOLATION", { out_of_scope: outOfScope });
      const diffPatch = this.git.diffPatch(coder.base_commit, candidateCommit);
      const diffHash = sha256(diffPatch);
      invariant(coder.scope?.diff_hash === diffHash && reviewer.scope?.diff_hash === diffHash, "coder/reviewer diff hash does not match candidate diff", "DIFF_HASH_MISMATCH");
      invariant(JSON.stringify(sortedUnique(coder.scope?.changed_paths ?? [])) === JSON.stringify(diffNames), "coder changed path evidence does not match Git", "DIFF_PATH_MISMATCH");
      const secretScan = this.scanSecrets(diffPatch);
      invariant(secretScan.passed, `secret scan failed: ${secretScan.hit_types.join(", ")}`, "SECRET_SCAN_FAILED");
      invariant(coder.secret_scan?.passed === true && reviewer.secret_scan?.passed === true
        && coder.secret_scan.evidence_hash === secretScan.evidence_hash
        && reviewer.secret_scan.evidence_hash === secretScan.evidence_hash, "role secret scan evidence does not match Git diff", "SECRET_EVIDENCE_MISMATCH");

      return [this.makeDraft({
        eventType: "EVIDENCE_VERIFIED",
        runId,
        taskId,
        attemptId: attemptId ?? coder.attempt_id,
        role: "orchestrator",
        baseCommit: coder.base_commit,
        candidateCommit,
        contextHash,
        lease: { action: "RELEASE_ALL_TASK", task_id: taskId, lease_id: null },
        fromStatus: "VERIFYING",
        toStatus: "VERIFIED",
        acceptance: {
          commands: coder.acceptance.commands,
          diff_hash: diffHash,
          scope_evidence_hash: sha256(stableJson({ allowedPatterns, diffNames })),
          secret_scan_evidence_hash: secretScan.evidence_hash,
        },
        verdicts: { auditor: "PASS", reviewer: "APPROVE" },
        counters: state.counters,
        payload: {
          actors: { coder: coder.actor_id, auditor: auditor.actor_id, reviewer: reviewer.actor_id },
          sessions: { coder: coder.session_id, auditor: auditor.session_id, reviewer: reviewer.session_id },
          changed_paths: diffNames,
        },
      })];
    });
    return finalized[0];
  }

  resume({ runId }) {
    invariant(runId, "resume requires runId", "RUN_ID_REQUIRED");
    const recovered = this.store.transact((events) => {
      const projection = this.project(events);
      return this.expiredLeaseDrafts(projection, runId);
    });
    const projection = this.project();
    const staleCandidates = [...projection.taskStates.values()]
      .filter((state) => state.candidate_commit && state.status !== "VERIFIED")
      .filter((state) => !this.git.commitExists(state.candidate_commit) || this.git.head() !== state.candidate_commit)
      .map((state) => ({ task_id: state.task_id, candidate_commit: state.candidate_commit, git_head: this.git.head() }));
    return {
      schema_version: "project-orchestrator-resume/v1",
      autonomy_run_id: runId,
      recovered_expired_leases: recovered.map((event) => event.event_id),
      stale_candidates: staleCandidates,
      next: this.nextTask(projection),
      event_count: projection.events.length,
      last_event_hash: projection.events.at(-1)?.event_hash ?? null,
      replay_hash: sha256(stableJson({
        tasks: [...projection.taskStates.values()].map((state) => ({ task_id: state.task_id, status: state.status, counters: state.counters })),
        leases: projection.activeLeases,
        next: this.nextTask(projection),
      })),
    };
  }

  rolePrompt({ runId = "default", taskId = null, role, sliceId = null, candidateCommit = null }) {
    invariant(role, "prompt requires role", "PROMPT_ROLE_REQUIRED");
    const projection = this.project();
    if (role === "slice_gate_runner") {
      invariant(sliceId, "slice gate prompt requires sliceId", "SLICE_ID_REQUIRED");
      const slice = projection.slices.get(sliceId);
      invariant(slice, `unknown slice: ${sliceId}`, "SLICE_NOT_FOUND");
      const tasks = [...projection.taskStates.values()].filter((state) => state.slice_id === sliceId);
      invariant(tasks.length > 0 && tasks.every((state) => state.status === "VERIFIED"), "slice gate requires every necessary Task VERIFIED", "SLICE_NOT_VERIFIED");
      const row = this.router.sliceRows.find((item) => item.values["切片"] === sliceId);
      return {
        schema_version: "g07-role-prompt/v1",
        role,
        autonomy_run_id: runId,
        slice_id: sliceId,
        read_only: true,
        task_evidence: tasks.map((state) => ({ task_id: state.task_id, evidence_hash: state.last_evidence })),
        user_entry_acceptance: row?.values["创作者可演示验收"] ?? null,
        completion_boundary: row?.values["完成边界"] ?? null,
        instructions: "Start from the registered user entry, run the slice acceptance only, return a structured PASS/FAIL report, and do not modify implementation or any Gate.",
      };
    }
    invariant(taskId && REPORT_ROLES.has(role), "prompt requires a Task role and taskId", "PROMPT_INPUT_INVALID");
    const task = this.router.taskById.get(taskId);
    invariant(task, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
    const routeRole = role === "slice_gate_runner" ? "coordinator" : role;
    const route = this.router.route({ role: routeRole, taskId });
    const state = projection.taskStates.get(taskId);
    const latestCoderReport = this.latestReport(projection, taskId, "coder", state.candidate_commit);
    const common = {
      schema_version: "g07-role-prompt/v1",
      autonomy_run_id: runId,
      role,
      task_id: taskId,
      task_status: state.status,
      base_commit: role === "coder" ? this.git.head() : latestCoderReport?.base_commit ?? this.git.head(),
      candidate_commit: candidateCommit ?? state.candidate_commit,
      context_hash: role === "coder" ? route.context_hash : state.context_hash ?? route.context_hash,
      fp_ids: route.input.fp_ids,
      exact_read_refs: route.access.effective_read_refs,
      business_result: task.values["业务结果"],
      depends_on: this.router.taskGraph(task).upstream,
      prohibited: task.values["禁止项"],
      acceptance_command: task.values["验收命令"],
      acceptance_scenario: task.values["业务验收场景"],
      replan_condition: task.values["Replan 条件"],
      report_schema: "g07-role-report/v1",
      source_bodies_embedded: false,
    };
    if (role === "coder") return { ...common, exact_write_scope: route.access.expanded_write_patterns, instructions: "Implement exactly one Task. Do not change business intent. Return a structured report; do not write Task state or the event log." };
    if (role === "auditor") return { ...common, read_only: true, required_evidence: ["normal", "exception", "recovery"], instructions: "Audit the exact candidate commit independently. Return evidence hashes and PASS/FAIL; do not modify implementation." };
    if (role === "reviewer") return { ...common, read_only: true, required_checks: ["contract", "diff", "write_channel", "cross_fp"], instructions: "Review the exact candidate commit independently. Return APPROVE/REQUEST_CHANGES; do not repair the diff." };
    if (role === "architect") return { ...common, read_only: true, replan_categories: this.policy.replan_categories, instructions: "Handle only Replan A/B/C/D. A/B stay inside approved technical boundaries, C is CREATOR_REQUIRED, and D is technical/environment blocking." };
    if (role === "prompt_editor") return { ...common, instructions: "Edit only an instantiated Prompt revision target anchor. Do not publish, activate, change code/Schema/business, or review your own revision." };
    return { ...common, read_only: true, instructions: "Return a structured gap report only. Do not modify implementation or infer missing facts." };
  }

  projectReport({ runId = "default", sliceId = null } = {}) {
    const projection = this.project();
    const selectedSlices = [...projection.slices.values()].filter((slice) => !sliceId || slice.slice_id === sliceId);
    invariant(selectedSlices.length > 0, `unknown slice: ${sliceId}`, "SLICE_NOT_FOUND");
    return {
      schema_version: "project-orchestrator-report/v1",
      autonomy_run_id: runId,
      generated_from_event_hash: projection.events.at(-1)?.event_hash ?? null,
      g07_gate_unchanged: this.router.gates.G07_GATE ?? "UNREGISTERED",
      slices: selectedSlices.map((slice) => ({
        ...slice,
        business_result: this.router.sliceRows.find((row) => row.values["切片"] === slice.slice_id)?.values["业务结果"] ?? null,
        tasks: [...projection.taskStates.values()].filter((state) => state.slice_id === slice.slice_id).map((state) => ({ task_id: state.task_id, status: state.status, evidence_hash: state.last_evidence })),
      })),
      budget: this.budgetState(runId, projection),
      blockers: [...projection.taskStates.values()].filter((state) => ["BLOCKED", "REPLAN", "CREATOR_REQUIRED"].includes(state.status)),
    };
  }
}

class FakeGitClient {
  constructor(root, headCommit = "a".repeat(40)) {
    this.root = root;
    this.headCommit = headCommit;
    this.branchName = "autonomy/integration";
    this.commits = new Set([headCommit]);
    this.diffs = new Map();
  }

  head() {
    return this.headCommit;
  }

  branch() {
    return this.branchName;
  }

  worktree() {
    return normalizePath(path.resolve(this.root));
  }

  isClean() {
    return true;
  }

  commitExists(commit) {
    return this.commits.has(commit);
  }

  isAncestor(baseCommit, candidateCommit) {
    return this.commits.has(baseCommit) && this.commits.has(candidateCommit);
  }

  addCommit(commit, { baseCommit = this.headCommit, paths = ["package.json"], patch = null } = {}) {
    this.commits.add(baseCommit);
    this.commits.add(commit);
    this.diffs.set(`${baseCommit}..${commit}`, {
      paths: sortedUnique(paths.map(normalizePath)),
      patch: patch ?? `diff --git a/${paths[0]} b/${paths[0]}\n+fixture-${commit.slice(0, 8)}\n`,
    });
    this.headCommit = commit;
  }

  setDiff(baseCommit, candidateCommit, paths, patch) {
    this.diffs.set(`${baseCommit}..${candidateCommit}`, { paths: sortedUnique(paths.map(normalizePath)), patch });
  }

  diffNames(baseCommit, candidateCommit) {
    return this.diffs.get(`${baseCommit}..${candidateCommit}`)?.paths ?? [];
  }

  diffPatch(baseCommit, candidateCommit) {
    return this.diffs.get(`${baseCommit}..${candidateCommit}`)?.patch ?? "";
  }
}

function selfTestReport({ orchestrator, fakeGit, role, actorId, sessionId, attemptId, baseCommit, candidateCommit, contextHash, verdict, decision = null, evidence = null, checks = null }) {
  const patchText = fakeGit.diffPatch(baseCommit, candidateCommit);
  const diffHash = sha256(patchText);
  const task = orchestrator.router.taskById.get("F0-01-REPO");
  return {
    report_version: "g07-role-report/v1",
    task_id: "F0-01-REPO",
    role,
    actor_id: actorId,
    session_id: sessionId,
    attempt_id: attemptId,
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    context_hash: contextHash,
    branch: fakeGit.branch(),
    worktree: fakeGit.worktree(),
    verdict,
    summary: `${role}:${verdict}`,
    acceptance: {
      commands: role === "coder" ? [{ command: task.values["验收命令"], exit_code: 0, evidence_hash: "1".repeat(64) }] : [],
      diff_hash: diffHash,
      scope_evidence_hash: "2".repeat(64),
      secret_scan_evidence_hash: sha256(patchText),
    },
    evidence: evidence ?? (role === "auditor" ? [
      { kind: "normal", passed: true, evidence_hash: "3".repeat(64) },
      { kind: "exception", passed: true, evidence_hash: "4".repeat(64) },
      { kind: "recovery", passed: true, evidence_hash: "5".repeat(64) },
    ] : []),
    checks: checks ?? (role === "reviewer" ? { contract: true, diff: true, write_channel: true, cross_fp: true } : {}),
    scope: { changed_paths: fakeGit.diffNames(baseCommit, candidateCommit), diff_hash: diffHash },
    secret_scan: { passed: true, evidence_hash: sha256(patchText) },
    decision,
    execution: { model_tier: "MODEL::CODE_HIGH", actual_model: "self-test-model", tokens: 0, time_ms: 1, known_cost: null },
  };
}

function runOrchestratorSelfTest(root = DEFAULT_ROOT) {
  const checks = [];
  const tempRoots = [];
  const assertCheck = (id, condition, evidence = null) => checks.push({ id, passed: Boolean(condition), evidence });
  const expectError = (id, callback, expectedCode) => {
    try {
      callback();
      checks.push({ id, passed: false, evidence: "no error was thrown" });
    } catch (error) {
      checks.push({ id, passed: error.code === expectedCode, evidence: { expected: expectedCode, actual: error.code, message: error.message } });
    }
  };
  const basePolicy = readJsonFile(path.join(root, DEFAULT_STATE_DIR, POLICY_FILE));
  const router = new ProjectContextRouter(root);
  let idCounter = 0;
  const makeHarness = ({ policyChanges = {}, clock = () => new Date("2026-07-11T12:00:00.000Z") } = {}) => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "g07-orchestrator-"));
    tempRoots.push(stateDir);
    const policy = clone(basePolicy);
    Object.assign(policy, policyChanges);
    policy.product_task_execution_allowed = policyChanges.product_task_execution_allowed ?? true;
    const fakeGit = new FakeGitClient(root);
    const orchestrator = new ProjectOrchestrator({
      root,
      stateDir,
      policy,
      router,
      git: fakeGit,
      clock,
      idFactory: () => `self-test-${String(++idCounter).padStart(5, "0")}`,
    });
    return { orchestrator, fakeGit, stateDir, policy };
  };

  const contextHash = router.route({ role: "coder", taskId: "F0-01-REPO" }).context_hash;

  try {
    const production = new ProjectOrchestrator({ root, router });
    const productionEventsBefore = production.store.read();
    const dryRun = production.dryRun({ runId: "g07-self-test-dry" });
    const productionEventsAfter = production.store.read();
    assertCheck("dry-run:unique-f0-01", dryRun.selected_task_id === "F0-01-REPO"
      && dryRun.selection_reason === "UNIQUE_READY_TASK"
      && dryRun.ready_candidates.length === 1, dryRun);
    assertCheck("dry-run:global-empty-fp", dryRun.fp_ids.length === 0, dryRun.fp_ids);
    assertCheck("dry-run:no-event-write", dryRun.event_log_unchanged
      && productionEventsBefore.length === productionEventsAfter.length, { before: productionEventsBefore.length, after: productionEventsAfter.length });
    assertCheck("dry-run:no-product-or-status-write", dryRun.product_files_written === false
      && dryRun.task_status_changed === false, dryRun);
    assertCheck("dry-run:g07-does-not-execute-product-task", dryRun.policy_execution_allowed === false
      && dryRun.policy_stop_reason === "G07_PHASE_PRODUCT_TASK_EXECUTION_DISABLED", dryRun.policy_stop_reason);
    assertCheck("dry-run:g07-gate-stays-pending", dryRun.g07_gate === "PENDING", dryRun.g07_gate);
    expectError("g07:real-policy-lease-hard-stop", () => production.lease({
      runId: "g07-no-product",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "writer",
      attemptId: "attempt-1",
    }), "BLOCKED_TECHNICAL");
    assertCheck("g07:hard-stop-does-not-write", production.store.read().length === productionEventsBefore.length, production.store.read().length);

    const harness = makeHarness();
    const { orchestrator, fakeGit } = harness;
    const unlockBefore = orchestrator.unlock({ runId: "run-main" });
    assertCheck("unlock:dependency-not-verified", unlockBefore.unlocked.length === 0, unlockBefore);
    expectError("lease:non-ready-rejected", () => orchestrator.lease({
      runId: "run-main",
      taskId: "F0-02-CONTRACTS",
      role: "coder",
      actorId: "writer-early",
      attemptId: "attempt-early",
    }), "TASK_NOT_READY");

    const writerLease = orchestrator.lease({
      runId: "run-main",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "writer-1",
      attemptId: "attempt-1",
      contextHash,
    });
    assertCheck("lease:ready-to-leased", writerLease.from_status === "READY" && writerLease.to_status === "LEASED", writerLease);
    expectError("lease:double-writer-rejected", () => orchestrator.lease({
      runId: "run-main",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "writer-2",
      attemptId: "attempt-2",
      contextHash,
    }), "TASK_NOT_READY");
    orchestrator.transition({ runId: "run-main", taskId: "F0-01-REPO", toStatus: "IN_PROGRESS", attemptId: "attempt-1", role: "coder", contextHash });
    expectError("transition:illegal-jump-rejected", () => orchestrator.transition({
      runId: "run-main",
      taskId: "F0-01-REPO",
      toStatus: "VERIFIED",
      attemptId: "attempt-1",
    }), "EVIDENCE_REQUIRED");

    const completeImplementation = ({ targetOrchestrator, targetGit, runId, attemptNumber, candidateCommit }) => {
      const state = targetOrchestrator.project().taskStates.get("F0-01-REPO");
      if (state.status === "REWORK") targetOrchestrator.transition({ runId, taskId: "F0-01-REPO", toStatus: "READY", attemptId: `attempt-${attemptNumber}`, role: "orchestrator", contextHash });
      const baseCommit = targetGit.head();
      const lease = targetOrchestrator.lease({
        runId,
        taskId: "F0-01-REPO",
        role: "coder",
        actorId: `writer-${attemptNumber}`,
        attemptId: `attempt-${attemptNumber}`,
        contextHash,
        baseCommit,
      });
      targetOrchestrator.transition({ runId, taskId: "F0-01-REPO", toStatus: "IN_PROGRESS", attemptId: `attempt-${attemptNumber}`, role: "coder", contextHash });
      targetGit.addCommit(candidateCommit, { baseCommit, paths: ["package.json"] });
      const report = selfTestReport({
        orchestrator: targetOrchestrator,
        fakeGit: targetGit,
        role: "coder",
        actorId: `writer-${attemptNumber}`,
        sessionId: `coder-session-${attemptNumber}`,
        attemptId: `attempt-${attemptNumber}`,
        baseCommit,
        candidateCommit,
        contextHash,
        verdict: "IMPLEMENTED",
      });
      targetOrchestrator.record({ runId, report });
      const afterReport = targetOrchestrator.project().taskStates.get("F0-01-REPO");
      assertCheck(`record:coder-report-does-not-pass-${attemptNumber}`, afterReport.status === "IN_PROGRESS", afterReport);
      targetOrchestrator.transition({ runId, taskId: "F0-01-REPO", toStatus: "IMPLEMENTED", attemptId: `attempt-${attemptNumber}`, role: "orchestrator", candidateCommit, contextHash });
      return { baseCommit, candidateCommit, contextHash, lease };
    };

    const reviewFailure = ({ targetOrchestrator, targetGit, runId, implementation, role, verdict, attemptNumber }) => {
      const actorId = `${role}-${attemptNumber}`;
      targetOrchestrator.lease({
        runId,
        taskId: "F0-01-REPO",
        role,
        actorId,
        attemptId: `review-${attemptNumber}`,
        contextHash: implementation.contextHash,
        baseCommit: implementation.baseCommit,
        candidateCommit: implementation.candidateCommit,
      });
      const report = selfTestReport({
        orchestrator: targetOrchestrator,
        fakeGit: targetGit,
        role,
        actorId,
        sessionId: `${role}-session-${attemptNumber}`,
        attemptId: `review-${attemptNumber}`,
        baseCommit: implementation.baseCommit,
        candidateCommit: implementation.candidateCommit,
        contextHash: implementation.contextHash,
        verdict,
      });
      return targetOrchestrator.record({ runId, report });
    };

    const candidate1 = "b".repeat(40);
    fakeGit.addCommit(candidate1, { baseCommit: writerLease.base_commit, paths: ["package.json"] });
    const firstCoderReport = selfTestReport({
      orchestrator,
      fakeGit,
      role: "coder",
      actorId: "writer-1",
      sessionId: "coder-session-1",
      attemptId: "attempt-1",
      baseCommit: writerLease.base_commit,
      candidateCommit: candidate1,
      contextHash,
      verdict: "IMPLEMENTED",
    });
    orchestrator.record({ runId: "run-main", report: firstCoderReport });
    assertCheck("record:text-does-not-directly-pass", orchestrator.project().taskStates.get("F0-01-REPO").status === "IN_PROGRESS", orchestrator.project().taskStates.get("F0-01-REPO"));
    orchestrator.transition({ runId: "run-main", taskId: "F0-01-REPO", toStatus: "IMPLEMENTED", attemptId: "attempt-1", candidateCommit: candidate1, contextHash });
    const implementation1 = { baseCommit: writerLease.base_commit, candidateCommit: candidate1, contextHash };
    const auditFailure = reviewFailure({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", implementation: implementation1, role: "auditor", verdict: "FAIL", attemptNumber: 1 });
    assertCheck("rework:auditor-fail", auditFailure.to_status === "REWORK" && auditFailure.counters.rework === 1, auditFailure);

    const implementation2 = completeImplementation({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", attemptNumber: 2, candidateCommit: "c".repeat(40) });
    const reviewerFailure = reviewFailure({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", implementation: implementation2, role: "reviewer", verdict: "REQUEST_CHANGES", attemptNumber: 2 });
    assertCheck("rework:reviewer-request-changes", reviewerFailure.to_status === "REWORK" && reviewerFailure.counters.rework === 2, reviewerFailure);

    const implementation3 = completeImplementation({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", attemptNumber: 3, candidateCommit: "d".repeat(40) });
    const thirdFailure = reviewFailure({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", implementation: implementation3, role: "auditor", verdict: "FAIL", attemptNumber: 3 });
    assertCheck("replan:three-reworks", thirdFailure.to_status === "REPLAN"
      && thirdFailure.counters.rework === 3
      && thirdFailure.counters.replan === 1, thirdFailure);

    const architectLease = orchestrator.lease({
      runId: "run-main",
      taskId: "F0-01-REPO",
      role: "architect",
      actorId: "architect-1",
      attemptId: "replan-1",
      contextHash,
      baseCommit: fakeGit.head(),
      candidateCommit: fakeGit.head(),
    });
    const architectReport = selfTestReport({
      orchestrator,
      fakeGit,
      role: "architect",
      actorId: "architect-1",
      sessionId: "architect-session-1",
      attemptId: "replan-1",
      baseCommit: architectLease.base_commit,
      candidateCommit: fakeGit.head(),
      contextHash,
      verdict: "REPLAN",
      decision: { category: "A", reason: "alternate implementation inside scope" },
    });
    const architectDecision = orchestrator.record({ runId: "run-main", report: architectReport });
    assertCheck("replan:architect-a-resumes", architectDecision.to_status === "READY"
      && architectDecision.decision_level === "ARCHITECT_AUTONOMOUS"
      && architectDecision.counters.rework === 0, architectDecision);

    let exhaustedEvent = null;
    for (let attemptNumber = 4; attemptNumber <= 6; attemptNumber += 1) {
      const candidate = String.fromCharCode(97 + attemptNumber).repeat(40);
      const implementation = completeImplementation({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", attemptNumber, candidateCommit: candidate });
      exhaustedEvent = reviewFailure({ targetOrchestrator: orchestrator, targetGit: fakeGit, runId: "run-main", implementation, role: "auditor", verdict: "FAIL", attemptNumber });
    }
    assertCheck("replan:two-replans-pause-critical-path", exhaustedEvent.to_status === "CREATOR_REQUIRED"
      && exhaustedEvent.counters.replan === 2
      && exhaustedEvent.creator_required_reason === "CRITICAL_PATH_REPLAN_LIMIT_EXHAUSTED", exhaustedEvent);
    assertCheck("creator-required:critical-task-paused", orchestrator.project().taskStates.get("F0-01-REPO").status === "CREATOR_REQUIRED", orchestrator.project().taskStates.get("F0-01-REPO"));

    const evidenceHarness = makeHarness();
    const evidenceImplementation = completeImplementation({
      targetOrchestrator: evidenceHarness.orchestrator,
      targetGit: evidenceHarness.fakeGit,
      runId: "run-evidence",
      attemptNumber: 10,
      candidateCommit: "1".repeat(40),
    });
    const auditorLease = evidenceHarness.orchestrator.lease({
      runId: "run-evidence",
      taskId: "F0-01-REPO",
      role: "auditor",
      actorId: "auditor-independent",
      attemptId: "audit-10",
      baseCommit: evidenceImplementation.baseCommit,
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
    });
    const reviewerLease = evidenceHarness.orchestrator.lease({
      runId: "run-evidence",
      taskId: "F0-01-REPO",
      role: "reviewer",
      actorId: "reviewer-independent",
      attemptId: "review-10",
      baseCommit: evidenceImplementation.baseCommit,
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
    });
    expectError("lease:third-read-only-reviewer-rejected", () => evidenceHarness.orchestrator.lease({
      runId: "run-evidence",
      taskId: "F0-01-REPO",
      role: "reviewer",
      actorId: "reviewer-third",
      attemptId: "review-third",
      baseCommit: evidenceImplementation.baseCommit,
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
    }), "REVIEW_CONCURRENCY_BLOCKED");
    const auditorPass = selfTestReport({
      orchestrator: evidenceHarness.orchestrator,
      fakeGit: evidenceHarness.fakeGit,
      role: "auditor",
      actorId: "auditor-independent",
      sessionId: "auditor-session-independent",
      attemptId: "audit-10",
      baseCommit: auditorLease.base_commit,
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
      verdict: "PASS",
    });
    const reviewerApprove = selfTestReport({
      orchestrator: evidenceHarness.orchestrator,
      fakeGit: evidenceHarness.fakeGit,
      role: "reviewer",
      actorId: "reviewer-independent",
      sessionId: "reviewer-session-independent",
      attemptId: "review-10",
      baseCommit: reviewerLease.base_commit,
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
      verdict: "APPROVE",
    });
    evidenceHarness.orchestrator.record({ runId: "run-evidence", report: auditorPass });
    evidenceHarness.orchestrator.record({ runId: "run-evidence", report: reviewerApprove });
    assertCheck("record:pass-reports-do-not-directly-verify", evidenceHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "VERIFYING", evidenceHarness.orchestrator.project().taskStates.get("F0-01-REPO"));

    const newerCommit = "2".repeat(40);
    evidenceHarness.fakeGit.commits.add(newerCommit);
    evidenceHarness.fakeGit.headCommit = newerCommit;
    expectError("evidence:new-commit-invalidates-old-audit", () => evidenceHarness.orchestrator.verifyEvidence({
      runId: "run-evidence",
      taskId: "F0-01-REPO",
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
    }), "STALE_CANDIDATE_COMMIT");
    evidenceHarness.fakeGit.headCommit = evidenceImplementation.candidateCommit;
    const originalDiff = evidenceHarness.fakeGit.diffPatch(evidenceImplementation.baseCommit, evidenceImplementation.candidateCommit);
    evidenceHarness.fakeGit.setDiff(evidenceImplementation.baseCommit, evidenceImplementation.candidateCommit, ["outside-product-scope.txt"], originalDiff);
    expectError("evidence:scope-overflow-rejected", () => evidenceHarness.orchestrator.verifyEvidence({
      runId: "run-evidence",
      taskId: "F0-01-REPO",
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
    }), "SCOPE_VIOLATION");
    evidenceHarness.fakeGit.setDiff(evidenceImplementation.baseCommit, evidenceImplementation.candidateCommit, ["package.json"], originalDiff);
    const verified = evidenceHarness.orchestrator.verifyEvidence({
      runId: "run-evidence",
      taskId: "F0-01-REPO",
      candidateCommit: evidenceImplementation.candidateCommit,
      contextHash,
    });
    assertCheck("evidence:mechanical-verification", verified.to_status === "VERIFIED"
      && verified.verdicts.auditor === "PASS"
      && verified.verdicts.reviewer === "APPROVE", verified);
    const unlocked = evidenceHarness.orchestrator.unlock({ runId: "run-evidence" });
    assertCheck("unlock:only-after-dependency-verified", unlocked.unlocked.includes("F0-02-CONTRACTS"), unlocked.unlocked);

    const selfReviewHarness = makeHarness();
    const selfReviewImplementation = completeImplementation({
      targetOrchestrator: selfReviewHarness.orchestrator,
      targetGit: selfReviewHarness.fakeGit,
      runId: "run-self-review",
      attemptNumber: 20,
      candidateCommit: "3".repeat(40),
    });
    for (const [role, actorId, sessionId, verdict] of [
      ["auditor", "writer-20", "auditor-self-session", "PASS"],
      ["reviewer", "reviewer-20", "reviewer-20-session", "APPROVE"],
    ]) {
      selfReviewHarness.orchestrator.lease({
        runId: "run-self-review",
        taskId: "F0-01-REPO",
        role,
        actorId,
        attemptId: `${role}-20`,
        baseCommit: selfReviewImplementation.baseCommit,
        candidateCommit: selfReviewImplementation.candidateCommit,
        contextHash,
      });
      selfReviewHarness.orchestrator.record({
        runId: "run-self-review",
        report: selfTestReport({
          orchestrator: selfReviewHarness.orchestrator,
          fakeGit: selfReviewHarness.fakeGit,
          role,
          actorId,
          sessionId,
          attemptId: `${role}-20`,
          baseCommit: selfReviewImplementation.baseCommit,
          candidateCommit: selfReviewImplementation.candidateCommit,
          contextHash,
          verdict,
        }),
      });
    }
    expectError("evidence:self-review-rejected", () => selfReviewHarness.orchestrator.verifyEvidence({
      runId: "run-self-review",
      taskId: "F0-01-REPO",
      candidateCommit: selfReviewImplementation.candidateCommit,
      contextHash,
    }), "SELF_REVIEW_BLOCKED");

    const secretResult = selfReviewHarness.orchestrator.scanSecrets(`+api_key=${["sk", "proj", "x".repeat(40)].join("-")}`);
    assertCheck("evidence:secret-scan-rejects-key", secretResult.passed === false && secretResult.hit_types.includes("OPENAI_KEY"), secretResult);

    let resumeClock = new Date("2026-07-11T12:00:00.000Z");
    const resumeHarness = makeHarness({ clock: () => new Date(resumeClock) });
    resumeHarness.orchestrator.lease({
      runId: "run-resume",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "writer-resume",
      attemptId: "attempt-resume",
      ttlSeconds: 1,
      contextHash,
    });
    resumeClock = new Date("2026-07-11T12:00:02.000Z");
    const resumed = resumeHarness.orchestrator.resume({ runId: "run-resume" });
    const replayed = new ProjectOrchestrator({
      root,
      stateDir: resumeHarness.stateDir,
      policy: resumeHarness.policy,
      router,
      git: resumeHarness.fakeGit,
      clock: () => new Date(resumeClock),
      idFactory: () => `self-test-${String(++idCounter).padStart(5, "0")}`,
    }).resume({ runId: "run-resume" });
    assertCheck("resume:expired-lease-recovered", resumed.recovered_expired_leases.length === 1
      && resumed.next.task_id === "F0-01-REPO", resumed);
    assertCheck("resume:deterministic-replay", replayed.recovered_expired_leases.length === 0
      && replayed.replay_hash === resumed.replay_hash
      && replayed.next.task_id === resumed.next.task_id, { first: resumed.replay_hash, second: replayed.replay_hash });

    const actionHarness = makeHarness();
    for (const action of ["PUSH", "DEPLOY", "PRODUCTION_WRITE", "CREDENTIAL_ACCESS", "REAL_PROJECT_MODEL_CALL", "PAID_TEST"]) {
      const result = actionHarness.orchestrator.evaluateAction(action, "run-actions");
      assertCheck(`hard-stop:${action.toLowerCase()}`, !result.allowed && result.hard_stop
        && result.decision_level === "ENVIRONMENT_APPROVAL_REQUIRED", result);
    }
    const gateAction = actionHarness.orchestrator.evaluateAction("WRITE_G07_GATE_APPROVED", "run-actions");
    assertCheck("hard-stop:g07-gate-creator-required", !gateAction.allowed
      && gateAction.decision_level === "CREATOR_REQUIRED", gateAction);

    const budgetHarness = makeHarness({ policyChanges: { budget: { ...basePolicy.budget, limits: { tokens: 100, elapsed_ms: null, known_cost: null } } } });
    budgetHarness.orchestrator.store.transact(() => [budgetHarness.orchestrator.makeDraft({
      eventType: "USAGE_RECORDED",
      runId: "run-budget",
      role: "orchestrator",
      decisionLevel: "TASK_AUTONOMOUS",
      execution: { tokens: 80, time_ms: 0, known_cost: null },
    })]);
    assertCheck("budget:80-percent-notify", budgetHarness.orchestrator.budgetState("run-budget").state === "NOTIFY_80_PERCENT", budgetHarness.orchestrator.budgetState("run-budget"));
    budgetHarness.orchestrator.store.transact(() => [budgetHarness.orchestrator.makeDraft({
      eventType: "USAGE_RECORDED",
      runId: "run-budget",
      role: "orchestrator",
      decisionLevel: "TASK_AUTONOMOUS",
      execution: { tokens: 20, time_ms: 0, known_cost: null },
    })]);
    const budgetStop = budgetHarness.orchestrator.evaluateAction("PRODUCT_TASK_WRITE", "run-budget");
    assertCheck("budget:100-percent-hard-stop", !budgetStop.allowed
      && budgetStop.hard_stop
      && budgetStop.reason === "BUDGET_100_PERCENT_OR_UNKNOWN_COST", budgetStop);

    const promptHarness = makeHarness();
    const coderPrompt = promptHarness.orchestrator.rolePrompt({ runId: "run-prompts", taskId: "F0-01-REPO", role: "coder" });
    const auditorPrompt = promptHarness.orchestrator.rolePrompt({ runId: "run-prompts", taskId: "F0-01-REPO", role: "auditor" });
    const reviewerPrompt = promptHarness.orchestrator.rolePrompt({ runId: "run-prompts", taskId: "F0-01-REPO", role: "reviewer" });
    const architectPrompt = promptHarness.orchestrator.rolePrompt({ runId: "run-prompts", taskId: "F0-01-REPO", role: "architect" });
    assertCheck("prompt:coder-self-contained-scope", coderPrompt.exact_write_scope.length === 10
      && coderPrompt.source_bodies_embedded === false, coderPrompt);
    assertCheck("prompt:auditor-normal-exception-recovery", JSON.stringify(auditorPrompt.required_evidence) === JSON.stringify(["normal", "exception", "recovery"]), auditorPrompt);
    assertCheck("prompt:reviewer-contract-diff-channel-impact", reviewerPrompt.required_checks.length === 4, reviewerPrompt);
    assertCheck("prompt:architect-c-creator-required", architectPrompt.replan_categories.C.includes("business"), architectPrompt.replan_categories);
    expectError("prompt:slice-gate-before-all-verified", () => promptHarness.orchestrator.rolePrompt({ runId: "run-prompts", role: "slice_gate_runner", sliceId: "F0" }), "SLICE_NOT_VERIFIED");
    assertCheck("prompt:no-v7-or-prompt-body", !stableJson([coderPrompt, auditorPrompt, reviewerPrompt, architectPrompt]).includes("source_body"), "role prompts carry refs and hashes only");

    const reportBefore = promptHarness.orchestrator.store.read().length;
    const businessReport = promptHarness.orchestrator.projectReport({ runId: "run-prompts", sliceId: "F0" });
    const reportAfter = promptHarness.orchestrator.store.read().length;
    assertCheck("report:no-gate-or-state-change", businessReport.g07_gate_unchanged === "PENDING"
      && reportBefore === reportAfter, businessReport.g07_gate_unchanged);

    const allEvents = orchestrator.store.read();
    assertCheck("events:append-only-hash-chain", allEvents.length > 0
      && allEvents.every((event) => isSha256(event.event_hash)), { event_count: allEvents.length, last_hash: allEvents.at(-1)?.event_hash });
    assertCheck("events:required-fields", allEvents.every((event) => REQUIRED_EVENT_FIELDS.every((field) => Object.hasOwn(event, field))), REQUIRED_EVENT_FIELDS);
    assertCheck("events:projection-not-manual-file", !fs.existsSync(path.join(harness.stateDir, "projection.json")), harness.stateDir);
  } finally {
    for (const tempRoot of tempRoots) {
      const resolved = path.resolve(tempRoot);
      if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
    }
  }

  const passed = checks.filter((check) => check.passed).length;
  return {
    schema_version: "project-orchestrator-self-test/v1",
    passed: passed === checks.length,
    assertions: { passed, failed: checks.length - passed, total: checks.length },
    failed_checks: checks.filter((check) => !check.passed),
    coverage: {
      dry_run: ["unique F0-01", "no FP fabrication", "no state/product writes"],
      refusals: ["non-ready", "dependency", "double writer", "third reviewer", "stale commit", "scope", "self-review", "secret", "budget", "push/deploy/production/credential"],
      recovery: ["auditor/reviewer rework", "three reworks", "two replans", "expired lease resume", "deterministic replay"],
      roles: ["coder", "auditor", "reviewer", "architect", "slice_gate_runner"],
    },
  };
}

function parseCli(argv) {
  const options = {};
  const booleans = new Set(["--self-test", "--json"]);
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") && !command) {
      command = argument;
      continue;
    }
    if (booleans.has(argument)) {
      options[argument.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    invariant(argument.startsWith("--"), `unexpected argument: ${argument}`, "CLI_ARGUMENT_INVALID");
    const value = argv[++index];
    invariant(value !== undefined, `missing value for ${argument}`, "CLI_ARGUMENT_INVALID");
    options[argument.slice(2).replaceAll("-", "_")] = value;
  }
  return { command, options };
}

function usage() {
  return [
    "Usage:",
    "  node tools/project-orchestrator.mjs status [--run-id ID]",
    "  node tools/project-orchestrator.mjs dry-run [--run-id ID]",
    "  node tools/project-orchestrator.mjs lease --run-id ID [--task-id ID] --role ROLE --actor-id ID --attempt-id ID [--ttl-seconds N]",
    "  node tools/project-orchestrator.mjs record --run-id ID --report-file PATH",
    "  node tools/project-orchestrator.mjs verify-evidence --run-id ID --task-id ID --candidate-commit SHA --context-hash SHA256",
    "  node tools/project-orchestrator.mjs transition --run-id ID --task-id ID --to-status STATUS [--candidate-commit SHA]",
    "  node tools/project-orchestrator.mjs unlock --run-id ID",
    "  node tools/project-orchestrator.mjs resume --run-id ID",
    "  node tools/project-orchestrator.mjs report [--run-id ID] [--slice-id ID]",
    "  node tools/project-orchestrator.mjs prompt --role ROLE [--task-id ID] [--slice-id ID] [--candidate-commit SHA]",
    "  node tools/project-orchestrator.mjs guard --run-id ID --action ACTION",
    "  node tools/project-orchestrator.mjs --self-test",
  ].join("\n");
}

function main() {
  try {
    const { command, options } = parseCli(process.argv.slice(2));
    if (options.self_test) {
      const report = runOrchestratorSelfTest(options.root ? path.resolve(options.root) : DEFAULT_ROOT);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) process.exitCode = 1;
      return;
    }
    invariant(command, usage(), "CLI_USAGE");
    const root = options.root ? path.resolve(options.root) : DEFAULT_ROOT;
    const stateDir = options.state_dir ? path.resolve(options.state_dir) : null;
    const orchestrator = new ProjectOrchestrator({ root, stateDir });
    const common = { runId: options.run_id ?? "default" };
    let output;
    if (command === "status") output = orchestrator.status(common);
    else if (command === "dry-run") output = orchestrator.dryRun(common);
    else if (command === "lease") output = orchestrator.lease({
      ...common,
      taskId: options.task_id ?? null,
      role: options.role,
      actorId: options.actor_id,
      attemptId: options.attempt_id,
      ttlSeconds: options.ttl_seconds,
      contextHash: options.context_hash,
      baseCommit: options.base_commit,
      candidateCommit: options.candidate_commit,
    });
    else if (command === "record") output = orchestrator.record({ ...common, report: readJsonFile(path.resolve(options.report_file)) });
    else if (command === "verify-evidence") output = orchestrator.verifyEvidence({
      ...common,
      taskId: options.task_id,
      candidateCommit: options.candidate_commit,
      contextHash: options.context_hash,
      attemptId: options.attempt_id,
    });
    else if (command === "transition") output = orchestrator.transition({
      ...common,
      taskId: options.task_id,
      toStatus: options.to_status,
      attemptId: options.attempt_id,
      role: options.role ?? "orchestrator",
      candidateCommit: options.candidate_commit,
      contextHash: options.context_hash,
      decisionLevel: options.decision_level ?? "TASK_AUTONOMOUS",
      creatorApprovalEvidence: options.creator_approval_evidence,
      resolutionEvidence: options.resolution_evidence,
    });
    else if (command === "unlock") output = orchestrator.unlock(common);
    else if (command === "resume") output = orchestrator.resume(common);
    else if (command === "report") output = orchestrator.projectReport({ ...common, sliceId: options.slice_id ?? null });
    else if (command === "prompt") output = orchestrator.rolePrompt({
      ...common,
      taskId: options.task_id ?? null,
      role: options.role,
      sliceId: options.slice_id ?? null,
      candidateCommit: options.candidate_commit ?? null,
    });
    else if (command === "guard") output = orchestrator.evaluateAction(options.action, common.runId);
    else invariant(false, usage(), "CLI_USAGE");
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: error.message,
      code: error.code ?? "ORCHESTRATOR_ERROR",
      details: error.details ?? null,
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) main();

export {
  EventStore,
  FakeGitClient,
  GitClient,
  ProjectOrchestrator,
  TASK_STATUSES,
  TRANSITIONS,
  runOrchestratorSelfTest,
};
