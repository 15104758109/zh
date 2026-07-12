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
const INTEGRITY_KEY_FILE = "integrity.key";
const QUARANTINE_DIR = "quarantine";
const CONTROL_FILE = "docs/IMPLEMENTATION_CONTROL.md";
const ROUTER_FILE = "tools/project-context-loader.mjs";
const ORCHESTRATOR_FILE = "tools/project-orchestrator.mjs";
const SELF_TEST_AUTHORITY = Symbol("G07_INTERNAL_SELF_TEST_AUTHORITY");

const MANDATORY_HARD_STOP_ACTIONS = Object.freeze([
  "REAL_PROJECT_MODEL_CALL",
  "PAID_TEST",
  "PUSH",
  "DEPLOY",
  "PRODUCTION_WRITE",
  "CREDENTIAL_ACCESS",
]);

const MANDATORY_FORBIDDEN_AUTOMATIC_ACTIONS = Object.freeze([
  "MERGE_TO_MAIN",
  "WRITE_G07_GATE_APPROVED",
  "PUSH",
  "DEPLOY",
  "PRODUCTION_WRITE",
  "CREDENTIAL_ACCESS",
]);

const EVENT_TYPES = new Set([
  "TASK_UNLOCKED",
  "LEASE_ACQUIRED",
  "LEASE_EXPIRED",
  "ROLE_REPORT_RECORDED",
  "TASK_TRANSITION",
  "EVIDENCE_VERIFIED",
  "EVIDENCE_REJECTED",
  "USAGE_RECORDED",
  "HARD_STOP",
  "EVENT_LOG_TAIL_RECOVERED",
]);

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
  ["CREATOR_REQUIRED", new Set()],
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
  "integrity_algorithm",
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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function hashEvent(event, integrityKey) {
  const copy = { ...event };
  delete copy.event_hash;
  return crypto.createHmac("sha256", integrityKey).update(stableJson(copy)).digest("hex");
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

function sameStringSet(actual, expected) {
  return JSON.stringify(sortedUnique(actual ?? [])) === JSON.stringify(sortedUnique(expected));
}

function integerCounters(value) {
  return value && ["retry", "rework", "replan"].every((key) => Number.isInteger(value[key]) && value[key] >= 0);
}

function safeTimestampFragment(value) {
  return value.replaceAll(":", "-").replaceAll(".", "-");
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
    const output = this.run(["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=ACDMRTUXB", baseCommit, candidateCommit]).stdout;
    return sortedUnique(output.split(/\r?\n/).map(normalizePath).filter(Boolean));
  }

  diffPatch(baseCommit, candidateCommit) {
    return this.run(["diff", "--no-ext-diff", "--no-color", "--binary", baseCommit, candidateCommit]).stdout;
  }

  workspaceFiles() {
    const tracked = this.run(["-c", "core.quotepath=false", "ls-files", "--cached"]).stdout;
    const untracked = this.run(["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"]).stdout;
    return sortedUnique(`${tracked}\n${untracked}`.split(/\r?\n/).map(normalizePath).filter(Boolean));
  }
}

class EventStore {
  #transactionAuthority;

  constructor({ stateDir, policy, clock, idFactory, transactionAuthority, validateEvents }) {
    this.stateDir = stateDir;
    this.policy = policy;
    this.clock = clock;
    this.idFactory = idFactory;
    this.validateEvents = validateEvents;
    this.eventsPath = path.join(stateDir, EVENTS_FILE);
    this.lockPath = path.join(stateDir, LOCK_FILE);
    this.integrityKeyPath = path.join(stateDir, INTEGRITY_KEY_FILE);
    this.quarantinePath = path.join(stateDir, QUARANTINE_DIR);
    this.#transactionAuthority = transactionAuthority;
  }

  #integrityKey({ create = false } = {}) {
    if (fs.existsSync(this.integrityKeyPath)) {
      const key = fs.readFileSync(this.integrityKeyPath);
      invariant(key.length >= 32, "event integrity key is invalid", "EVENT_INTEGRITY_KEY_INVALID");
      return key;
    }
    invariant(create, "event log exists without its ignored local integrity key", "EVENT_INTEGRITY_KEY_MISSING");
    fs.mkdirSync(this.stateDir, { recursive: true });
    const key = crypto.randomBytes(32);
    try {
      const descriptor = fs.openSync(this.integrityKeyPath, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, key);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      return key;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return this.#integrityKey();
    }
  }

  parse(text) {
    if (!text.trim()) return [];
    const rawLines = text.split(/\r?\n/);
    while (rawLines.at(-1) === "") rawLines.pop();
    invariant(rawLines.every((line) => line.trim().length > 0), "event log contains a blank interior line", "EVENT_LOG_BLANK_LINE");
    const key = this.#integrityKey();
    const events = [];
    let previousHash = null;
    for (let index = 0; index < rawLines.length; index += 1) {
      let event;
      try {
        event = JSON.parse(rawLines[index]);
      } catch (error) {
        invariant(false, `invalid JSONL event at line ${index + 1}: ${error.message}`, "EVENT_LOG_INVALID_JSON", { line: index + 1 });
      }
      for (const field of REQUIRED_EVENT_FIELDS) {
        invariant(Object.hasOwn(event, field), `event ${index + 1} is missing ${field}`, "EVENT_SCHEMA_INVALID", { line: index + 1, field });
      }
      invariant(event.integrity_algorithm === "HMAC-SHA256", `event ${index + 1} does not use HMAC-SHA256`, "EVENT_INTEGRITY_ALGORITHM_INVALID");
      invariant(event.previous_event_hash === previousHash, `event hash chain breaks at line ${index + 1}`, "EVENT_HASH_CHAIN_INVALID");
      invariant(hashEvent(event, key) === event.event_hash, `event authentication failed at line ${index + 1}`, "EVENT_AUTHENTICATION_INVALID");
      events.push(event);
      previousHash = event.event_hash;
    }
    this.validateEvents(events);
    return events;
  }

  read() {
    if (!fs.existsSync(this.eventsPath)) return [];
    return this.parse(fs.readFileSync(this.eventsPath, "utf8"));
  }

  fileSnapshot() {
    const bytes = fs.existsSync(this.eventsPath) ? fs.readFileSync(this.eventsPath) : Buffer.alloc(0);
    return { exists: fs.existsSync(this.eventsPath), bytes: bytes.length, sha256: sha256(bytes) };
  }

  lockRecord() {
    try {
      return JSON.parse(fs.readFileSync(this.lockPath, "utf8"));
    } catch {
      return null;
    }
  }

  lockOwnerIsAlive(record) {
    if (!record || record.hostname !== os.hostname() || !Number.isInteger(record.pid) || record.pid <= 0) return true;
    try {
      process.kill(record.pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }

  acquireLock() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const staleMilliseconds = Number(this.policy.concurrency.lock_stale_ms ?? 30000);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const nonce = crypto.randomBytes(18).toString("hex");
      try {
        const descriptor = fs.openSync(this.lockPath, "wx", 0o600);
        const record = { nonce, pid: process.pid, hostname: os.hostname(), acquired_at: this.clock().toISOString() };
        fs.writeFileSync(descriptor, JSON.stringify(record));
        fs.fsyncSync(descriptor);
        return { descriptor, nonce };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let stats;
        try {
          stats = fs.statSync(this.lockPath);
        } catch (statError) {
          if (statError.code === "ENOENT") continue;
          throw statError;
        }
        const observed = this.lockRecord();
        if (Date.now() - stats.mtimeMs > staleMilliseconds && observed && !this.lockOwnerIsAlive(observed)) {
          const stalePath = `${this.lockPath}.stale.${observed.nonce}.${crypto.randomBytes(6).toString("hex")}`;
          try {
            fs.renameSync(this.lockPath, stalePath);
            const moved = JSON.parse(fs.readFileSync(stalePath, "utf8"));
            invariant(moved.nonce === observed.nonce, "stale lock ownership changed during recovery", "LOCK_OWNERSHIP_CHANGED");
            fs.unlinkSync(stalePath);
            continue;
          } catch (renameError) {
            if (["ENOENT", "EEXIST", "EPERM"].includes(renameError.code)) continue;
            throw renameError;
          }
        }
        sleepMilliseconds(20);
      }
    }
    invariant(false, "orchestrator event log is locked by another live or unverified writer", "EVENT_LOG_LOCKED");
  }

  releaseLock(owner) {
    try {
      fs.closeSync(owner.descriptor);
    } finally {
      const current = fs.existsSync(this.lockPath) ? this.lockRecord() : null;
      if (current?.nonce === owner.nonce) fs.unlinkSync(this.lockPath);
    }
  }

  recoverTruncatedTail(authority) {
    invariant(authority === this.#transactionAuthority, "only ProjectOrchestrator may recover the event log", "EVENT_WRITE_FORBIDDEN");
    const owner = this.acquireLock();
    try {
      if (!fs.existsSync(this.eventsPath)) return null;
      const bytes = fs.readFileSync(this.eventsPath);
      if (!bytes.length || bytes.at(-1) === 0x0a) return null;
      const text = bytes.toString("utf8");
      const lastNewline = text.lastIndexOf("\n");
      const prefix = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : "";
      const tail = lastNewline >= 0 ? text.slice(lastNewline + 1) : text;
      try {
        JSON.parse(tail);
        return null;
      } catch {
        if (prefix.trim()) this.parse(prefix);
        fs.mkdirSync(this.quarantinePath, { recursive: true });
        const tailHash = sha256(tail);
        const quarantineFile = path.join(this.quarantinePath, `events-tail-${safeTimestampFragment(this.clock().toISOString())}-${tailHash.slice(0, 16)}.jsonl`);
        fs.writeFileSync(quarantineFile, tail, { encoding: "utf8", flag: "wx", mode: 0o600 });
        fs.truncateSync(this.eventsPath, Buffer.byteLength(prefix, "utf8"));
        return {
          rejected_tail_sha256: tailHash,
          rejected_tail_bytes: Buffer.byteLength(tail, "utf8"),
          quarantine_path: normalizePath(path.relative(this.stateDir, quarantineFile)),
        };
      }
    } finally {
      this.releaseLock(owner);
    }
  }

  transact(authority, buildDrafts) {
    invariant(authority === this.#transactionAuthority, "only ProjectOrchestrator may append events", "EVENT_WRITE_FORBIDDEN");
    const owner = this.acquireLock();
    try {
      const existingNonEmpty = fs.existsSync(this.eventsPath) && fs.statSync(this.eventsPath).size > 0;
      const key = this.#integrityKey({ create: !existingNonEmpty });
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
          integrity_algorithm: "HMAC-SHA256",
          previous_event_hash: previousHash,
        };
        event.event_hash = hashEvent(event, key);
        previousHash = event.event_hash;
        return event;
      });
      this.validateEvents([...events, ...finalized]);
      fs.mkdirSync(this.stateDir, { recursive: true });
      const fileDescriptor = fs.openSync(this.eventsPath, "a", 0o600);
      try {
        for (const event of finalized) fs.writeSync(fileDescriptor, `${JSON.stringify(event)}\n`, null, "utf8");
        fs.fsyncSync(fileDescriptor);
      } finally {
        fs.closeSync(fileDescriptor);
      }
      return finalized;
    } finally {
      this.releaseLock(owner);
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
  #storeAuthority;

  #identityAttestor;

  #testControlOverrides;

  #internalTest;

  constructor({
    root = DEFAULT_ROOT,
    stateDir = null,
    policy = null,
    router = null,
    git = null,
    clock = null,
    idFactory = null,
    identityAttestor = null,
    testControlOverrides = null,
    authority = null,
  } = {}) {
    const internalTest = authority === SELF_TEST_AUTHORITY;
    const injected = policy || router || git || clock || idFactory || identityAttestor || testControlOverrides || stateDir;
    invariant(!injected || internalTest, "policy, state, Git, clock, identity, and router injection is reserved for internal self-test authority", "TEST_INJECTION_FORBIDDEN");
    const resolvedRoot = path.resolve(root);
    const resolvedStateDir = path.resolve(stateDir ?? path.join(resolvedRoot, DEFAULT_STATE_DIR));
    const policyPath = path.join(resolvedRoot, DEFAULT_STATE_DIR, POLICY_FILE);
    Object.defineProperty(this, "root", { value: resolvedRoot, writable: false, configurable: false, enumerable: true });
    Object.defineProperty(this, "stateDir", { value: resolvedStateDir, writable: false, configurable: false, enumerable: true });
    Object.defineProperty(this, "policyPath", { value: policyPath, writable: false, configurable: false, enumerable: true });
    const loadedPolicy = policy ? clone(policy) : readJsonFile(policyPath);
    Object.defineProperty(this, "policy", { value: deepFreeze(loadedPolicy), writable: false, configurable: false, enumerable: true });
    Object.defineProperty(this, "router", { value: router ?? new ProjectContextRouter(this.root), writable: false, configurable: false, enumerable: true });
    Object.defineProperty(this, "git", { value: git ?? new GitClient(this.root), writable: false, configurable: false, enumerable: true });
    this.clock = clock ?? (() => new Date());
    this.idFactory = idFactory ?? (() => crypto.randomUUID());
    Object.defineProperty(this, "policyHash", { value: policy ? sha256(stableJson(loadedPolicy)) : hashFile(policyPath), writable: false, configurable: false, enumerable: true });
    this.#identityAttestor = identityAttestor;
    this.#testControlOverrides = testControlOverrides;
    this.#internalTest = internalTest;
    this.#storeAuthority = Symbol("project-orchestrator-event-writer");
    this.validatePolicy();
    const store = new EventStore({
      stateDir: this.stateDir,
      policy: this.policy,
      clock: this.clock,
      idFactory: this.idFactory,
      transactionAuthority: this.#storeAuthority,
      validateEvents: (events) => this.validateEventLog(events),
    });
    Object.defineProperty(this, "store", { value: store, writable: false, configurable: false, enumerable: true });
  }

  validatePolicy() {
    invariant(this.policy.schema_version === "g07-autonomy-policy/v2", "unsupported autonomy policy", "POLICY_INVALID");
    invariant(this.policy.control_anchor === "G07::AUTONOMY", "policy is not bound to G07::AUTONOMY", "POLICY_INVALID");
    invariant(["G07_A_CONTROL_PLANE_ONLY", "G07_APPROVED_INTEGRATION"].includes(this.policy.phase), "unknown autonomy phase", "POLICY_PHASE_INVALID");
    invariant(this.policy.g07_gate_required === "APPROVED", "policy must require creator-approved G07", "POLICY_GATE_INVALID");
    invariant(this.policy.concurrency.max_writers === 1, "policy must allow exactly one writer", "POLICY_INVALID");
    invariant(this.policy.concurrency.max_read_only_reviewers === 2, "policy must allow exactly two read-only reviewers", "POLICY_INVALID");
    invariant(this.policy.retry_policy.max_rework === 3, "policy must use three rework attempts", "POLICY_INVALID");
    invariant(this.policy.retry_policy.max_replan === 2, "policy must use two Replan attempts", "POLICY_INVALID");
    invariant(this.policy.retry_policy.critical_path_on_exhaustion === "CREATOR_REQUIRED", "critical path exhaustion must require the creator", "POLICY_INVALID");
    invariant(this.policy.budget.notify_ratio === 0.8 && this.policy.budget.hard_stop_ratio === 1, "budget thresholds must be 80% and 100%", "POLICY_INVALID");
    invariant(sameStringSet(this.policy.hard_stop_actions, MANDATORY_HARD_STOP_ACTIONS), "policy hard-stop action set drifted", "POLICY_HARD_STOP_INVALID");
    invariant(sameStringSet(this.policy.forbidden_automatic_actions, MANDATORY_FORBIDDEN_AUTOMATIC_ACTIONS), "policy forbidden automatic action set drifted", "POLICY_HARD_STOP_INVALID");
    invariant(this.policy.event_integrity?.algorithm === "HMAC-SHA256"
      && this.policy.event_integrity?.key_file === INTEGRITY_KEY_FILE
      && this.policy.event_integrity?.key_must_be_ignored === true, "event integrity policy is incomplete", "POLICY_INTEGRITY_INVALID");
    invariant(this.policy.identity_attestation?.required === true, "trusted role identity attestation must be required", "POLICY_IDENTITY_INVALID");

    const gate = this.controlGateSnapshot();
    if (this.policy.phase === "G07_A_CONTROL_PLANE_ONLY") {
      invariant(gate.g07_gate === "PENDING", "G07-A control-plane-only phase requires G07_GATE=PENDING", "POLICY_GATE_INVALID");
      invariant(this.policy.product_task_execution_allowed === false, "G07-A phase cannot enable product Task execution", "POLICY_PHASE_INVALID");
    } else {
      invariant(gate.g07_gate === "APPROVED" && isSha256(gate.g07_approval_evidence_sha256), "approved integration phase requires registered creator Gate evidence hash", "POLICY_GATE_INVALID");
      invariant(this.policy.product_task_execution_allowed === true, "approved integration phase must explicitly enable product Task execution", "POLICY_PHASE_INVALID");
    }

    if (!this.#internalTest) {
      const gates = this.router.gates;
      invariant(hashFile(this.policyPath) === this.policyHash, "policy file drifted after process initialization", "POLICY_DISK_DRIFT");
      invariant(hashFile(path.join(this.root, ...CONTROL_FILE.split("/"))) === this.router.control.sha256, "implementation control document drifted after router initialization", "CONTROL_DOCUMENT_DRIFT");
      invariant(normalizePath(gates.G07_A_POLICY_PATH ?? "") === `${DEFAULT_STATE_DIR}/${POLICY_FILE}`, "registered policy path drifted", "POLICY_REGISTRATION_INVALID");
      invariant(String(gates.G07_A_POLICY_SHA256 ?? "").toLowerCase() === this.policyHash, "registered policy hash does not match disk", "POLICY_HASH_MISMATCH");
      invariant(gates.G07_POLICY_ANCHOR === this.policy.control_anchor, "registered policy anchor drifted", "POLICY_REGISTRATION_INVALID");
      invariant(gates.G07_A_BRANCH === this.policy.integration_branch, "registered integration branch drifted", "POLICY_REGISTRATION_INVALID");
      for (const [registeredPathKey, registeredHashKey, requiredPath] of [
        ["G07_A_ROUTER_PATH", "G07_A_ROUTER_SHA256", ROUTER_FILE],
        ["G07_A_ORCHESTRATOR_PATH", "G07_A_ORCHESTRATOR_SHA256", ORCHESTRATOR_FILE],
      ]) {
        const registeredPath = normalizePath(gates[registeredPathKey] ?? "");
        invariant(registeredPath === requiredPath, `${registeredPathKey} drifted`, "CONTROL_ARTIFACT_PATH_INVALID");
        invariant(hashFile(path.join(this.root, ...requiredPath.split("/"))) === String(gates[registeredHashKey] ?? "").toLowerCase(), `${registeredHashKey} does not match disk`, "CONTROL_ARTIFACT_HASH_MISMATCH");
      }
    }
  }

  controlGateSnapshot() {
    if (this.#testControlOverrides) return this.#testControlOverrides;
    return {
      g07_gate: this.router.gates.G07_GATE ?? "UNREGISTERED",
      g07_a_status: this.router.gates.G07_A_STATUS ?? "UNREGISTERED",
      g07_approval_evidence_sha256: this.router.gates.G07_APPROVAL_EVIDENCE_SHA256 ?? null,
    };
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
      event_version: "g07-autonomy-event/v2",
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
      integrity_algorithm: "HMAC-SHA256",
      previous_event_hash: null,
      event_hash: null,
    };
  }

  validateEventLog(events) {
    const states = new Map(this.router.tasks.map((task) => [task.id, {
      status: task.values["状态"],
      counters: emptyCounters(),
    }]));
    const leases = new Map();
    const eventIds = new Set();
    let previousTimestamp = null;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      for (const field of REQUIRED_EVENT_FIELDS) {
        invariant(Object.hasOwn(event, field), `event ${index + 1} is missing ${field}`, "EVENT_SCHEMA_INVALID", { line: index + 1, field });
      }
      invariant(event.event_version === "g07-autonomy-event/v2", `event ${index + 1} uses an unsupported version`, "EVENT_SCHEMA_INVALID");
      invariant(EVENT_TYPES.has(event.event_type), `event ${index + 1} uses unknown type ${event.event_type}`, "EVENT_TYPE_INVALID");
      invariant(!eventIds.has(event.event_id), `duplicate event_id ${event.event_id}`, "EVENT_ID_DUPLICATE");
      eventIds.add(event.event_id);
      invariant(ROLE_NAMES.has(event.role), `event ${event.event_id} has unknown role`, "EVENT_ROLE_INVALID");
      invariant(DECISION_LEVELS.has(event.decision_level), `event ${event.event_id} has unknown decision level`, "EVENT_DECISION_INVALID");
      invariant(integerCounters(event.counters), `event ${event.event_id} has invalid counters`, "EVENT_COUNTERS_INVALID");
      invariant(!Number.isNaN(Date.parse(event.timestamp)), `event ${event.event_id} has invalid timestamp`, "EVENT_TIMESTAMP_INVALID");
      if (previousTimestamp !== null) {
        invariant(Date.parse(event.timestamp) >= previousTimestamp, `event ${event.event_id} timestamp moved backwards`, "EVENT_TIMESTAMP_ORDER_INVALID");
      }
      previousTimestamp = Date.parse(event.timestamp);
      invariant(event.branch === this.policy.integration_branch, `event ${event.event_id} is on an unregistered branch`, "EVENT_BRANCH_INVALID");
      invariant(normalizePath(path.resolve(event.worktree)) === this.git.worktree(), `event ${event.event_id} worktree drifted`, "EVENT_WORKTREE_INVALID");

      if (!event.task_id) {
        invariant(["USAGE_RECORDED", "HARD_STOP", "EVENT_LOG_TAIL_RECOVERED"].includes(event.event_type), `taskless event type ${event.event_type} is forbidden`, "EVENT_TASK_REQUIRED");
        invariant(event.from_status === null && event.to_status === null && event.lease === null, `taskless event ${event.event_id} carries Task state`, "EVENT_STATE_INVALID");
        continue;
      }

      const state = states.get(event.task_id);
      invariant(state, `event references unknown Task ${event.task_id}`, "EVENT_TASK_UNKNOWN");
      invariant(TASK_STATUSES.has(event.from_status) && TASK_STATUSES.has(event.to_status), `event ${event.event_id} has invalid Task status`, "EVENT_STATE_INVALID");
      invariant(event.from_status === state.status, `event ${event.event_id} expected ${event.from_status} but semantic replay is ${state.status}`, "EVENT_STATUS_CHAIN_INVALID");
      invariant(event.counters.retry >= state.counters.retry && event.counters.replan >= state.counters.replan, `event ${event.event_id} counters moved backwards`, "EVENT_COUNTERS_INVALID");
      const reworkResetAllowed = event.event_type === "ROLE_REPORT_RECORDED"
        && event.role === "architect"
        && event.from_status === "REPLAN"
        && event.to_status === "READY";
      invariant(reworkResetAllowed || event.counters.rework >= state.counters.rework, `event ${event.event_id} rework counter moved backwards`, "EVENT_COUNTERS_INVALID");

      const leaseAction = event.lease?.action ?? null;
      if (event.event_type === "TASK_UNLOCKED") {
        invariant(event.from_status === "PLANNED" && event.to_status === "READY", "TASK_UNLOCKED must be PLANNED -> READY", "EVENT_SEMANTICS_INVALID");
        invariant(leaseAction === null, "TASK_UNLOCKED cannot carry a lease", "EVENT_SEMANTICS_INVALID");
      } else if (event.event_type === "LEASE_ACQUIRED") {
        invariant(leaseAction === "ACQUIRE" && event.lease?.lease_id, "LEASE_ACQUIRED requires an ACQUIRE record", "EVENT_LEASE_INVALID");
        invariant(!leases.has(event.lease.lease_id), `duplicate lease ${event.lease.lease_id}`, "EVENT_LEASE_INVALID");
        invariant(event.lease.role === event.role && event.lease.attempt_id === event.attempt_id, "lease identity does not match event", "EVENT_LEASE_INVALID");
        invariant(event.lease.context_hash === event.context_hash && event.lease.base_commit === event.base_commit, "lease version does not match event", "EVENT_LEASE_INVALID");
        if (event.lease.mode === "WRITE") {
          invariant(["coder", "prompt_editor"].includes(event.role), "write lease role is invalid", "EVENT_LEASE_INVALID");
          invariant(event.from_status === "READY" && event.to_status === "LEASED", "write lease must be READY -> LEASED", "EVENT_SEMANTICS_INVALID");
          invariant([...leases.values()].filter((lease) => lease.mode === "WRITE").length < 1, "semantic replay found two active writers", "EVENT_WRITER_CONCURRENCY_INVALID");
        } else {
          invariant(event.lease.mode === "READ_ONLY", "unknown lease mode", "EVENT_LEASE_INVALID");
          invariant(["auditor", "reviewer", "architect"].includes(event.role), "read-only lease role is invalid", "EVENT_LEASE_INVALID");
          invariant((event.from_status === "IMPLEMENTED" && event.to_status === "VERIFYING")
            || (event.from_status === "VERIFYING" && event.to_status === "VERIFYING")
            || (event.role === "architect" && event.from_status === "REPLAN" && event.to_status === "REPLAN"), "read-only lease status pair is invalid", "EVENT_SEMANTICS_INVALID");
          invariant([...leases.values()].filter((lease) => lease.mode === "READ_ONLY").length < 2, "semantic replay exceeded read-only review concurrency", "EVENT_REVIEW_CONCURRENCY_INVALID");
        }
        leases.set(event.lease.lease_id, { ...event.lease, task_id: event.task_id });
      } else if (event.event_type === "LEASE_EXPIRED") {
        invariant(leaseAction === "EXPIRE" && leases.has(event.lease?.lease_id), "LEASE_EXPIRED does not target an active lease", "EVENT_LEASE_INVALID");
        const expired = leases.get(event.lease.lease_id);
        invariant(expired.task_id === event.task_id, "expired lease Task mismatch", "EVENT_LEASE_INVALID");
        invariant((expired.mode === "WRITE" && ["LEASED", "IN_PROGRESS"].includes(event.from_status) && event.to_status === "READY")
          || (expired.mode === "READ_ONLY" && event.to_status === event.from_status), "expired lease transition is invalid", "EVENT_SEMANTICS_INVALID");
        leases.delete(event.lease.lease_id);
      } else if (event.event_type === "ROLE_REPORT_RECORDED") {
        const report = event.payload?.report;
        invariant(report && report.task_id === event.task_id && report.role === event.role, "role report payload does not match event", "EVENT_REPORT_INVALID");
        const activeForRole = [...leases.values()].find((lease) => lease.task_id === event.task_id
          && lease.role === event.role
          && lease.attempt_id === event.attempt_id);
        invariant(activeForRole, "role report has no matching active lease", "EVENT_REPORT_LEASE_INVALID");
        const allowedPair = (["coder", "prompt_editor"].includes(event.role)
          && event.from_status === "IN_PROGRESS"
          && ["IN_PROGRESS", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status))
          || (["auditor", "reviewer"].includes(event.role)
            && event.from_status === "VERIFYING"
            && ["VERIFYING", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status))
          || (event.role === "architect"
            && event.from_status === "REPLAN"
            && ["READY", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status));
        invariant(allowedPair, "role report status pair is invalid", "EVENT_SEMANTICS_INVALID");
      } else if (event.event_type === "TASK_TRANSITION") {
        invariant(TRANSITIONS.get(event.from_status)?.has(event.to_status), `illegal event transition ${event.from_status} -> ${event.to_status}`, "EVENT_SEMANTICS_INVALID");
        invariant(event.from_status !== "CREATOR_REQUIRED", "CREATOR_REQUIRED cannot be cleared by the Orchestrator", "EVENT_SEMANTICS_INVALID");
        invariant(!(event.from_status === "PLANNED" && event.to_status === "READY"), "unlock event is required", "EVENT_SEMANTICS_INVALID");
        invariant(!(event.from_status === "READY" && event.to_status === "LEASED"), "lease event is required", "EVENT_SEMANTICS_INVALID");
        invariant(!["VERIFIED", "REWORK", "REPLAN"].includes(event.to_status), "reserved transition event target", "EVENT_SEMANTICS_INVALID");
      } else if (event.event_type === "EVIDENCE_VERIFIED") {
        invariant(event.from_status === "VERIFYING" && event.to_status === "VERIFIED", "EVIDENCE_VERIFIED must be VERIFYING -> VERIFIED", "EVENT_SEMANTICS_INVALID");
        invariant(event.verdicts?.auditor === "PASS" && event.verdicts?.reviewer === "APPROVE", "verified event lacks both independent verdicts", "EVENT_SEMANTICS_INVALID");
        invariant(event.acceptance?.commands?.length > 0
          && isSha256(event.acceptance.diff_hash)
          && isSha256(event.acceptance.scope_evidence_hash)
          && isSha256(event.acceptance.secret_scan_evidence_hash), "verified event lacks mechanical evidence hashes", "EVENT_SEMANTICS_INVALID");
      } else if (event.event_type === "EVIDENCE_REJECTED") {
        invariant(event.from_status === "VERIFYING"
          && ["REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status)
          && isSha256(event.failure_fingerprint), "evidence rejection transition or fingerprint is invalid", "EVENT_SEMANTICS_INVALID");
      } else {
        invariant(false, `Task event type ${event.event_type} is not semantically registered`, "EVENT_SEMANTICS_INVALID");
      }

      if (leaseAction === "RELEASE") {
        invariant(leases.has(event.lease.lease_id), "lease release targets a missing lease", "EVENT_LEASE_INVALID");
        leases.delete(event.lease.lease_id);
      } else if (leaseAction === "RELEASE_ALL_TASK") {
        for (const [leaseId, lease] of leases) if (lease.task_id === event.task_id) leases.delete(leaseId);
      } else if (leaseAction && !["ACQUIRE", "EXPIRE"].includes(leaseAction)) {
        invariant(false, `unknown lease action ${leaseAction}`, "EVENT_LEASE_INVALID");
      }

      state.status = event.to_status;
      state.counters = { ...event.counters };
    }
    return true;
  }

  project(events = this.store.read(), { at = this.clock() } = {}) {
    this.validatePolicy();
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

  routeControlBlockers(route) {
    return route.conflicts_or_missing_references.filter((item) => item.level === "BLOCKING"
      && !["task_status", "task_dependencies"].includes(item.kind));
  }

  controlContext(taskId) {
    this.validatePolicy();
    const task = this.router.taskById.get(taskId);
    invariant(task, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
    const route = this.router.route({ role: "coder", taskId });
    const gate = this.router.gateSnapshot();
    const scopePatterns = this.router.expandWriteScope(task);
    const mutableScope = scopePatterns.map((pattern) => globToRegExp(pattern));
    const protectedVersions = route.file_versions
      .filter((version) => !mutableScope.some((pattern) => pattern.test(version.path)))
      .map((version) => ({ path: version.path, sha256: version.sha256, registered_sha256: version.registered_sha256 }));
    const facts = {
      schema_version: "g07-control-context/v1",
      control_anchor: this.policy.control_anchor,
      control_document_sha256: this.router.control.sha256,
      policy_sha256: this.policyHash,
      router_sha256: hashFile(path.join(this.root, ...ROUTER_FILE.split("/"))),
      orchestrator_sha256: hashFile(path.join(this.root, ...ORCHESTRATOR_FILE.split("/"))),
      phase: this.policy.phase,
      g07_gate: this.controlGateSnapshot().g07_gate,
      active_gates: {
        g04_gate: gate.values.G04_GATE ?? null,
        g04_revision: gate.values.G04_REVISION ?? null,
        g05_gate: gate.values.G05_GATE ?? null,
        g06_gate: gate.values.G06_GATE ?? null,
        g06_artifact_sha256: gate.values.G06_ARTIFACT_SHA256 ?? null,
      },
      integration_branch: this.policy.integration_branch,
      task_id: taskId,
      task_index_row_sha256: sha256(stableJson(task.values)),
      dependencies: this.router.taskGraph(task).upstream.map((item) => item.task_id),
      declared_write_scope: task.values.write_scope,
      expanded_write_scope: scopePatterns,
      exact_source_anchors: {
        control: route.anchors.control,
        v7: route.anchors.v7,
        prompt: route.anchors.prompt,
        prototype: route.anchors.prototype,
        n8n: route.anchors.n8n,
        rpc: route.anchors.rpc,
      },
      protected_versions: protectedVersions,
      control_blockers: this.routeControlBlockers(route).map((item) => ({ kind: item.kind, reason: item.reason, details: item.details ?? null })),
    };
    return {
      hash: sha256(stableJson(facts)),
      facts,
      router_context_hash: route.context_hash,
      route,
    };
  }

  criticalTaskIds() {
    const taskIdPattern = /\b(?:F0|W0|S[1-7])-[A-Z0-9-]+\b/g;
    const lines = this.router.control.lines;
    const start = lines.findIndex((line) => line.trim() === "### 关键路径与并行面");
    let end = start < 0 ? start : lines.length;
    if (start >= 0) {
      for (let index = start + 1; index < lines.length; index += 1) {
        if (/^###\s+/.test(lines[index])) {
          end = index;
          break;
        }
      }
    }
    const explicit = start < 0 ? [] : [...lines.slice(start, end).join("\n").matchAll(taskIdPattern)].map((match) => match[0]);
    const seeds = new Set([
      ...explicit.filter((taskId) => this.router.taskById.has(taskId)),
      ...this.router.tasks.filter((task) => task.values["风险"] === "CRITICAL").map((task) => task.id),
    ]);
    const critical = new Set(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const current = queue.shift();
      const task = this.router.taskById.get(current);
      if (!task) continue;
      for (const dependency of this.router.taskGraph(task).upstream) {
        if (critical.has(dependency.task_id)) continue;
        critical.add(dependency.task_id);
        queue.push(dependency.task_id);
      }
    }
    return critical;
  }

  isCriticalTask(taskId) {
    return this.criticalTaskIds().has(taskId);
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
    this.validatePolicy();
    const normalized = String(action).toUpperCase();
    const budget = this.budgetState(runId, projection);
    if (budget.hard_stop) {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "BUDGET_100_PERCENT_OR_UNKNOWN_COST", budget };
    }
    if (MANDATORY_HARD_STOP_ACTIONS.includes(normalized) || MANDATORY_FORBIDDEN_AUTOMATIC_ACTIONS.includes(normalized)) {
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
    if (normalized === "PRODUCT_TASK_WRITE" && this.policy.phase !== "G07_APPROVED_INTEGRATION") {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "G07_PHASE_PRODUCT_TASK_EXECUTION_DISABLED", budget };
    }
    const controlGate = this.controlGateSnapshot();
    if (normalized === "PRODUCT_TASK_WRITE"
      && (controlGate.g07_gate !== this.policy.g07_gate_required || !isSha256(controlGate.g07_approval_evidence_sha256))) {
      return { allowed: false, hard_stop: true, decision_level: "CREATOR_REQUIRED", reason: "G07_GATE_NOT_CREATOR_APPROVED", budget };
    }
    if (normalized === "PRODUCT_TASK_WRITE" && !this.policy.product_task_execution_allowed) {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "PRODUCT_TASK_EXECUTION_POLICY_DISABLED", budget };
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

  recordUsage({ runId, execution, limits = null }) {
    this.validatePolicy();
    invariant(runId, "usage record requires runId", "RUN_ID_REQUIRED");
    const normalized = { ...emptyExecution(), ...(execution ?? {}) };
    for (const [field, value] of [["tokens", normalized.tokens], ["time_ms", normalized.time_ms]]) {
      invariant(Number.isFinite(Number(value)) && Number(value) >= 0, `usage ${field} must be non-negative`, "USAGE_INVALID");
    }
    if (normalized.known_cost !== null) invariant(Number.isFinite(Number(normalized.known_cost)) && Number(normalized.known_cost) >= 0, "known cost must be null or non-negative", "USAGE_INVALID");
    const finalized = this.store.transact(this.#storeAuthority, () => [this.makeDraft({
      eventType: "USAGE_RECORDED",
      runId,
      role: "orchestrator",
      execution: normalized,
      payload: limits ? { run_budget_limits: limits } : {},
    })]);
    return finalized[0];
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

  taskProjectionSnapshot(projection) {
    const tasks = [...projection.taskStates.values()]
      .map((state) => ({
        task_id: state.task_id,
        status: state.status,
        counters: state.counters,
        candidate_commit: state.candidate_commit,
        context_hash: state.context_hash,
      }))
      .sort((left, right) => left.task_id.localeCompare(right.task_id, "en"));
    return { task_count: tasks.length, sha256: sha256(stableJson(tasks)) };
  }

  scopedTreeSnapshot(taskId) {
    if (!taskId) return { task_id: null, paths: [], sha256: sha256(stableJson([])) };
    const task = this.router.taskById.get(taskId);
    invariant(task, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
    const patterns = this.router.expandWriteScope(task);
    const regexes = patterns.map((pattern) => globToRegExp(pattern));
    const entries = [];
    for (const relativePath of this.git.workspaceFiles()) {
      if (!regexes.some((regex) => regex.test(relativePath))) continue;
      const basename = path.posix.basename(relativePath).toLowerCase();
      invariant(basename !== ".env" && !basename.startsWith(".env."), "dry-run scope snapshot refuses environment files", "CREDENTIAL_ACCESS");
      const absolutePath = path.join(this.root, ...relativePath.split("/"));
      if (!fs.existsSync(absolutePath)) continue;
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        entries.push({ path: relativePath, kind: "symlink", sha256: sha256(fs.readlinkSync(absolutePath)) });
      } else if (stats.isFile()) {
        entries.push({ path: relativePath, kind: "file", sha256: hashFile(absolutePath) });
      }
    }
    entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
    return { task_id: taskId, paths: entries, sha256: sha256(stableJson(entries)) };
  }

  drySnapshot(projection, taskId) {
    return {
      event_log: this.store.fileSnapshot(),
      task_projection: this.taskProjectionSnapshot(projection),
      scoped_product_tree: this.scopedTreeSnapshot(taskId),
    };
  }

  dryRun({ runId = "default" } = {}) {
    const beforeEvents = this.store.read();
    const projection = this.project(beforeEvents);
    const next = this.nextTask(projection);
    const before = this.drySnapshot(projection, next?.task_id ?? null);
    if (!next) {
      const afterProjection = this.project(this.store.read());
      const after = this.drySnapshot(afterProjection, null);
      return {
        schema_version: "project-orchestrator-dry-run/v1",
        autonomy_run_id: runId,
        next: null,
        reason: "NO_READY_OR_ACTIVE_TASK",
        snapshots: { before, after },
        event_log_unchanged: stableJson(before.event_log) === stableJson(after.event_log),
        product_files_written: before.scoped_product_tree.sha256 !== after.scoped_product_tree.sha256,
        task_status_changed: before.task_projection.sha256 !== after.task_projection.sha256,
        event_count: beforeEvents.length,
        g07_gate: this.router.gates.G07_GATE ?? "UNREGISTERED",
      };
    }
    const routeRole = ["coder", "auditor", "reviewer", "architect", "gap_auditor", "prompt_editor", "coordinator"].includes(next.role) ? next.role : "coordinator";
    const route = this.router.route({ role: routeRole, taskId: next.task_id });
    const action = this.evaluateAction("PRODUCT_TASK_WRITE", runId, projection);
    const afterEvents = this.store.read();
    const afterProjection = this.project(afterEvents);
    const after = this.drySnapshot(afterProjection, next.task_id);
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
      snapshots: { before, after },
      event_log_unchanged: stableJson(before.event_log) === stableJson(after.event_log),
      event_count: afterEvents.length,
      product_files_written: before.scoped_product_tree.sha256 !== after.scoped_product_tree.sha256,
      task_status_changed: before.task_projection.sha256 !== after.task_projection.sha256,
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

    const finalized = this.store.transact(this.#storeAuthority, (events) => {
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
        invariant(this.git.isClean(), "writer lease requires a clean worktree", "WORKTREE_DIRTY");
      } else if (["auditor", "reviewer"].includes(role)) {
        invariant(["IMPLEMENTED", "VERIFYING"].includes(state.status), `review lease requires IMPLEMENTED/VERIFYING, got ${state.status}`, "TASK_NOT_REVIEWABLE");
        invariant(candidateCommit && state.candidate_commit === candidateCommit, "review lease must bind the current candidate commit", "CANDIDATE_COMMIT_MISMATCH");
      } else if (role === "architect") {
        invariant(state.status === "REPLAN", `architect lease requires REPLAN, got ${state.status}`, "TASK_NOT_IN_REPLAN");
      }

      const routeRole = role === "architect" ? "architect" : role;
      const route = this.router.route({ role: routeRole, taskId: task.id });
      const controlContext = this.controlContext(task.id);
      invariant(this.routeControlBlockers(route).length === 0, "router has blocking control conflicts", "ROUTER_BLOCKING_CONFLICT", this.routeControlBlockers(route));
      const gate = this.router.gateSnapshot();
      invariant(gate.active_execution_gate_valid && gate.g05.valid && gate.g06.valid, "active Gate or registered router artifact is invalid", "GATE_INVALID");
      const latestCoderReport = this.latestReport(projection, task.id, "coder", state.candidate_commit);
      const expectedContextHash = mode === "READ_ONLY" ? state.context_hash : controlContext.hash;
      invariant(expectedContextHash && expectedContextHash === controlContext.hash, "frozen Task control context drifted", "STALE_CONTROL_CONTEXT", {
        frozen: expectedContextHash,
        current: controlContext.hash,
      });
      invariant(!contextHash || contextHash === expectedContextHash, "caller context hash does not match the Orchestrator control context", "LEASE_CONTEXT_MISMATCH");
      const expectedBaseCommit = mode === "READ_ONLY" ? latestCoderReport?.base_commit : this.git.head();
      invariant(expectedBaseCommit, "lease could not derive the base commit", "LEASE_BASE_COMMIT_MISSING");
      invariant(!baseCommit || baseCommit === expectedBaseCommit, "caller base commit does not match the Orchestrator-derived base", "LEASE_BASE_COMMIT_MISMATCH");
      if (mode === "READ_ONLY") invariant(candidateCommit === state.candidate_commit, "review candidate must equal the projected candidate", "CANDIDATE_COMMIT_MISMATCH");
      else invariant(!candidateCommit, "writer lease cannot accept a caller-supplied candidate commit", "LEASE_CANDIDATE_FORBIDDEN");
      const effectiveContextHash = expectedContextHash;
      const effectiveBaseCommit = expectedBaseCommit;
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
        payload: { actor_id: actorId, router_context_hash: controlContext.router_context_hash },
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
    for (const field of ["report_version", "task_id", "role", "actor_id", "session_id", "attempt_id", "base_commit", "candidate_commit", "context_hash", "verdict", "identity_attestation"]) {
      invariant(Object.hasOwn(report, field) && report[field] !== "", `report is missing ${field}`, "REPORT_SCHEMA_INVALID");
    }
    invariant(report.report_version === "g07-role-report/v2", "unsupported role report", "REPORT_SCHEMA_INVALID");
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

  attestIndependentReports(reports) {
    invariant(this.#identityAttestor && typeof this.#identityAttestor.verify === "function", "the current platform exposes no trusted role/session attestation provider", "ENVIRONMENT_APPROVAL_REQUIRED", {
      required_provider: this.policy.identity_attestation.provider,
      reason: "TRUSTED_SESSION_ATTESTATION_UNAVAILABLE",
    });
    const identities = reports.map((report) => {
      const expected = {
        role: report.role,
        task_id: report.task_id,
        attempt_id: report.attempt_id,
        base_commit: report.base_commit,
        candidate_commit: report.candidate_commit,
        context_hash: report.context_hash,
      };
      const result = this.#identityAttestor.verify(report.identity_attestation, expected);
      invariant(result?.trusted === true
        && result.provider
        && result.principal_id
        && result.session_id
        && isSha256(result.evidence_hash), `trusted identity attestation failed for ${report.role}`, "IDENTITY_ATTESTATION_INVALID");
      return { role: report.role, ...result };
    });
    invariant(new Set(identities.map((item) => item.principal_id)).size === identities.length
      && new Set(identities.map((item) => item.session_id)).size === identities.length, "trusted platform attestations do not prove independent principals and sessions", "SELF_REVIEW_BLOCKED");
    return identities;
  }

  record({ runId, report }) {
    this.validateReport(report);
    invariant(runId, "record requires runId", "RUN_ID_REQUIRED");
    const finalized = this.store.transact(this.#storeAuthority, (events) => {
      const projection = this.project(events);
      const state = projection.taskStates.get(report.task_id);
      const lease = projection.activeLeases.find((item) => item.task_id === report.task_id
        && item.role === report.role
        && item.actor_id === report.actor_id
        && item.attempt_id === report.attempt_id);
      invariant(lease, "report does not match an active independent role lease", "REPORT_LEASE_MISMATCH");
      invariant(report.context_hash === lease.context_hash, "report context_hash does not match lease", "REPORT_CONTEXT_MISMATCH");
      const currentControlContext = this.controlContext(report.task_id);
      invariant(report.context_hash === currentControlContext.hash, "report control context is stale", "STALE_CONTROL_CONTEXT", {
        report: report.context_hash,
        current: currentControlContext.hash,
      });
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

  transition({ runId, taskId, toStatus, attemptId, role = "orchestrator", candidateCommit = null, contextHash = null, decisionLevel = "TASK_AUTONOMOUS", resolutionEvidence = null }) {
    invariant(runId && taskId && toStatus, "transition requires runId, taskId and toStatus", "TRANSITION_INPUT_INVALID");
    invariant(TASK_STATUSES.has(toStatus), `unknown target status: ${toStatus}`, "STATUS_INVALID");
    invariant(toStatus !== "VERIFIED", "VERIFYING -> VERIFIED is reserved for verify-evidence", "EVIDENCE_REQUIRED");
    invariant(!["REWORK", "REPLAN"].includes(toStatus), `${toStatus} is reserved for structured failed role reports`, "ROLE_REPORT_REQUIRED");
    if (toStatus === "CREATOR_REQUIRED") invariant(decisionLevel === "CREATOR_REQUIRED", "CREATOR_REQUIRED status requires CREATOR_REQUIRED decision level", "DECISION_LEVEL_INVALID");
    if (toStatus === "BLOCKED") invariant(["BLOCKED_TECHNICAL", "ENVIRONMENT_APPROVAL_REQUIRED"].includes(decisionLevel), "BLOCKED status requires a technical/environment decision level", "DECISION_LEVEL_INVALID");
    const guard = this.evaluateAction("PRODUCT_TASK_WRITE", runId);
    invariant(guard.allowed, guard.reason, guard.decision_level, guard);

    const finalized = this.store.transact(this.#storeAuthority, (events) => {
      const projection = this.project(events);
      const state = projection.taskStates.get(taskId);
      invariant(state, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
      invariant(state.status !== "CREATOR_REQUIRED", "CREATOR_REQUIRED can only be cleared by a separately registered creator control-plane update", "CREATOR_CONTROL_UPDATE_REQUIRED");
      invariant(TRANSITIONS.get(state.status)?.has(toStatus), `illegal transition ${state.status} -> ${toStatus}`, "ILLEGAL_TRANSITION");
      invariant(!(state.status === "PLANNED" && toStatus === "READY"), "PLANNED -> READY is reserved for unlock", "UNLOCK_REQUIRED");
      invariant(!(state.status === "READY" && toStatus === "LEASED"), "READY -> LEASED is reserved for lease", "LEASE_REQUIRED");
      if (state.status === "BLOCKED" && toStatus === "READY") invariant(isSha256(resolutionEvidence), "technical resolution evidence hash is required", "RESOLUTION_EVIDENCE_REQUIRED");
      const currentControlContext = this.controlContext(taskId);
      invariant(!state.context_hash || state.context_hash === currentControlContext.hash, "Task control context drifted", "STALE_CONTROL_CONTEXT", {
        frozen: state.context_hash,
        current: currentControlContext.hash,
      });
      invariant(!contextHash || contextHash === currentControlContext.hash, "caller context hash does not match current control context", "TRANSITION_CONTEXT_MISMATCH");
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
        contextHash: currentControlContext.hash,
        lease: leaseAction,
        fromStatus: state.status,
        toStatus,
        decisionLevel,
        counters: state.counters,
        payload: { resolution_evidence_hash: resolutionEvidence, router_context_hash: currentControlContext.router_context_hash },
      })];
    });
    return finalized[0];
  }

  unlock({ runId }) {
    invariant(runId, "unlock requires runId", "RUN_ID_REQUIRED");
    const guard = this.evaluateAction("PRODUCT_TASK_WRITE", runId);
    invariant(guard.allowed, guard.reason, guard.decision_level, guard);
    const finalized = this.store.transact(this.#storeAuthority, (events) => {
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

  evidenceFailureState(taskId, state, error) {
    const counters = { ...state.counters, retry: state.counters.retry + 1 };
    if (error.code === "ENVIRONMENT_APPROVAL_REQUIRED") {
      return {
        toStatus: "BLOCKED",
        decisionLevel: "ENVIRONMENT_APPROVAL_REQUIRED",
        counters,
        creatorReason: null,
        environmentReason: error.details?.reason ?? "TRUSTED_SESSION_ATTESTATION_UNAVAILABLE",
      };
    }
    counters.rework += 1;
    if (counters.rework < this.policy.retry_policy.max_rework) {
      return { toStatus: "REWORK", decisionLevel: "TASK_AUTONOMOUS", counters, creatorReason: null, environmentReason: null };
    }
    counters.replan += 1;
    if (counters.replan < this.policy.retry_policy.max_replan) {
      return { toStatus: "REPLAN", decisionLevel: "ARCHITECT_AUTONOMOUS", counters, creatorReason: null, environmentReason: null };
    }
    if (this.isCriticalTask(taskId)) {
      return {
        toStatus: "CREATOR_REQUIRED",
        decisionLevel: "CREATOR_REQUIRED",
        counters,
        creatorReason: "CRITICAL_PATH_REPLAN_LIMIT_EXHAUSTED",
        environmentReason: null,
      };
    }
    return { toStatus: "BLOCKED", decisionLevel: "BLOCKED_TECHNICAL", counters, creatorReason: null, environmentReason: null };
  }

  recordEvidenceRejection({ runId, taskId, candidateCommit, attemptId, error }) {
    const finalized = this.store.transact(this.#storeAuthority, (events) => {
      const projection = this.project(events);
      const state = projection.taskStates.get(taskId);
      if (!state || state.status !== "VERIFYING") return [];
      const disposition = this.evidenceFailureState(taskId, state, error);
      const coder = this.latestReport(projection, taskId, "coder", state.candidate_commit);
      return [this.makeDraft({
        eventType: "EVIDENCE_REJECTED",
        runId,
        taskId,
        attemptId: attemptId ?? coder?.attempt_id ?? null,
        role: "orchestrator",
        baseCommit: coder?.base_commit ?? null,
        candidateCommit: state.candidate_commit ?? candidateCommit,
        contextHash: state.context_hash,
        lease: { action: "RELEASE_ALL_TASK", task_id: taskId, lease_id: null },
        fromStatus: "VERIFYING",
        toStatus: disposition.toStatus,
        decisionLevel: disposition.decisionLevel,
        fingerprint: failureFingerprint(stableJson({ code: error.code ?? "ORCHESTRATOR_ERROR", message: error.message, details: error.details ?? null })),
        counters: disposition.counters,
        creatorRequiredReason: disposition.creatorReason,
        environmentApprovalReason: disposition.environmentReason,
        payload: {
          rejection: {
            code: error.code ?? "ORCHESTRATOR_ERROR",
            message: error.message,
            details: error.details ?? null,
          },
        },
      })];
    });
    return finalized[0] ?? null;
  }

  verifyEvidence({ runId, taskId, candidateCommit, contextHash = null, attemptId = null }) {
    invariant(runId && taskId && candidateCommit, "verify-evidence requires runId, taskId and candidateCommit", "VERIFY_INPUT_INVALID");
    try {
      const finalized = this.store.transact(this.#storeAuthority, (events) => {
        const projection = this.project(events);
        const state = projection.taskStates.get(taskId);
        invariant(state?.status === "VERIFYING", `verify-evidence requires VERIFYING, got ${state?.status ?? "MISSING"}`, "TASK_NOT_VERIFYING");
        invariant(state.candidate_commit === candidateCommit, "candidate does not match the projected Task candidate", "CANDIDATE_COMMIT_MISMATCH");
        invariant(this.git.commitExists(candidateCommit), "candidate commit does not exist", "CANDIDATE_COMMIT_MISSING");
        invariant(this.git.head() === candidateCommit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
        invariant(this.git.isClean(), "evidence verification requires a clean worktree", "WORKTREE_DIRTY");

        const currentControlContext = this.controlContext(taskId);
        invariant(state.context_hash === currentControlContext.hash, "frozen Task control context differs from the current router control context", "STALE_CONTROL_CONTEXT", {
          frozen: state.context_hash,
          current: currentControlContext.hash,
        });
        invariant(!contextHash || contextHash === currentControlContext.hash, "caller context hash does not match the current router control context", "VERIFY_CONTEXT_MISMATCH");
        invariant(this.routeControlBlockers(currentControlContext.route).length === 0, "router control context contains blocking conflicts", "CONTEXT_CONTROL_DRIFT", this.routeControlBlockers(currentControlContext.route));

        const coder = this.latestReport(projection, taskId, "coder", candidateCommit);
        const auditor = this.latestReport(projection, taskId, "auditor", candidateCommit);
        const reviewer = this.latestReport(projection, taskId, "reviewer", candidateCommit);
        invariant(coder && auditor && reviewer, "coder, auditor and reviewer reports are all required for the same candidate commit", "INCOMPLETE_ROLE_EVIDENCE");
        invariant(coder.verdict === "IMPLEMENTED", "coder verdict must be IMPLEMENTED", "CODER_VERDICT_INVALID");
        invariant(auditor.verdict === "PASS", "auditor verdict must be PASS", "AUDITOR_VERDICT_INVALID");
        invariant(reviewer.verdict === "APPROVE", "reviewer verdict must be APPROVE", "REVIEWER_VERDICT_INVALID");
        invariant([coder, auditor, reviewer].every((report) => report.base_commit === coder.base_commit
          && report.candidate_commit === candidateCommit
          && report.context_hash === currentControlContext.hash), "all reports must bind the same base/candidate/control context", "EVIDENCE_VERSION_MISMATCH");
        invariant([coder, auditor, reviewer].every((report) => report.branch === this.policy.integration_branch
          && normalizePath(path.resolve(report.worktree)) === this.git.worktree()), "all reports must bind the integration branch and current worktree", "EVIDENCE_WORKTREE_MISMATCH");
        invariant(this.git.isAncestor(coder.base_commit, candidateCommit), "base commit is not an ancestor of candidate", "BASE_COMMIT_INVALID");
        const trustedIdentities = this.attestIndependentReports([coder, auditor, reviewer]);

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
        invariant(secretScan.passed, `secret scan failed: ${secretScan.hit_types.join(", ")}`, "SECRET_SCAN_FAILED", { hit_types: secretScan.hit_types });
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
          contextHash: currentControlContext.hash,
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
            trusted_identities: trustedIdentities,
            changed_paths: diffNames,
            router_context_hash: currentControlContext.router_context_hash,
          },
        })];
      });
      return finalized[0];
    } catch (error) {
      if (!["VERIFY_INPUT_INVALID", "TASK_NOT_VERIFYING"].includes(error.code) && !String(error.code ?? "").startsWith("EVENT_")) {
        const rejection = this.recordEvidenceRejection({ runId, taskId, candidateCommit, attemptId, error });
        if (rejection) error.details = { ...(error.details && typeof error.details === "object" ? error.details : {}), rejection_event_id: rejection.event_id, rejection_event_hash: rejection.event_hash, rejection_to_status: rejection.to_status };
      }
      throw error;
    }
  }

  resume({ runId }) {
    invariant(runId, "resume requires runId", "RUN_ID_REQUIRED");
    this.validatePolicy();
    const tailRecovery = this.store.recoverTruncatedTail(this.#storeAuthority);
    const recovered = this.store.transact(this.#storeAuthority, (events) => {
      const projection = this.project(events);
      const drafts = [];
      if (tailRecovery) {
        drafts.push(this.makeDraft({
          eventType: "EVENT_LOG_TAIL_RECOVERED",
          runId,
          role: "orchestrator",
          decisionLevel: "BLOCKED_TECHNICAL",
          fingerprint: failureFingerprint(tailRecovery.rejected_tail_sha256),
          payload: tailRecovery,
        }));
      }
      drafts.push(...this.expiredLeaseDrafts(projection, runId));
      return drafts;
    });
    const projection = this.project();
    const staleCandidates = [...projection.taskStates.values()]
      .filter((state) => state.candidate_commit && state.status !== "VERIFIED")
      .filter((state) => !this.git.commitExists(state.candidate_commit) || this.git.head() !== state.candidate_commit)
      .map((state) => ({ task_id: state.task_id, candidate_commit: state.candidate_commit, git_head: this.git.head() }));
    return {
      schema_version: "project-orchestrator-resume/v1",
      autonomy_run_id: runId,
      recovered_expired_leases: recovered.filter((event) => event.event_type === "LEASE_EXPIRED").map((event) => event.event_id),
      recovered_truncated_tail: tailRecovery,
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
        schema_version: "g07-role-prompt/v2",
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
    const route = this.router.route({ role, taskId });
    const state = projection.taskStates.get(taskId);
    const controlContext = this.controlContext(taskId);
    invariant(this.routeControlBlockers(route).length === 0, "router has blocking control conflicts", "ROUTER_BLOCKING_CONFLICT", this.routeControlBlockers(route));
    invariant(!state.context_hash || state.context_hash === controlContext.hash, "Task control context drifted before prompt generation", "STALE_CONTROL_CONTEXT");
    const latestCoderReport = this.latestReport(projection, taskId, "coder", state.candidate_commit);
    const isWriter = ["coder", "prompt_editor"].includes(role);
    if (isWriter) {
      invariant(state.status === "READY", `writer prompt requires READY, got ${state.status}`, "TASK_NOT_READY");
      invariant(this.dependenciesVerified(taskId, projection), "writer prompt requires all dependencies VERIFIED", "DEPENDENCIES_NOT_VERIFIED");
      invariant(task.values["角色"] === `VIEW::${role.toUpperCase()}`, `Task owner is ${task.values["角色"]}`, "TASK_ROLE_MISMATCH");
      const gate = this.router.gateSnapshot();
      invariant(gate.active_execution_gate_valid && gate.g05.valid && gate.g06.valid, "writer prompt requires valid G04/G05/G06 controls", "GATE_INVALID");
      const action = this.evaluateAction("PRODUCT_TASK_WRITE", runId, projection);
      invariant(action.allowed, action.reason, action.decision_level, action);
      invariant(this.git.isClean(), "writer prompt requires a clean worktree", "WORKTREE_DIRTY");
      if (role === "coder") invariant(route.access.execution_authorized, "router did not authorize coder execution", "ROUTER_EXECUTION_NOT_AUTHORIZED");
    } else if (["auditor", "reviewer"].includes(role)) {
      invariant(["IMPLEMENTED", "VERIFYING"].includes(state.status), `review prompt requires IMPLEMENTED/VERIFYING, got ${state.status}`, "TASK_NOT_REVIEWABLE");
      invariant(state.candidate_commit && (!candidateCommit || candidateCommit === state.candidate_commit), "review prompt candidate is stale", "CANDIDATE_COMMIT_MISMATCH");
    } else if (role === "architect") {
      invariant(state.status === "REPLAN", `architect prompt requires REPLAN, got ${state.status}`, "TASK_NOT_IN_REPLAN");
    }
    const common = {
      schema_version: "g07-role-prompt/v2",
      autonomy_run_id: runId,
      role,
      task_id: taskId,
      task_status: state.status,
      base_commit: isWriter ? this.git.head() : latestCoderReport?.base_commit ?? this.git.head(),
      candidate_commit: isWriter ? null : state.candidate_commit,
      context_hash: controlContext.hash,
      router_context_hash: controlContext.router_context_hash,
      fp_ids: route.input.fp_ids,
      exact_read_refs: route.access.effective_read_refs,
      business_result: task.values["业务结果"],
      depends_on: this.router.taskGraph(task).upstream,
      prohibited: task.values["禁止项"],
      acceptance_command: task.values["验收命令"],
      acceptance_scenario: task.values["业务验收场景"],
      replan_condition: task.values["Replan 条件"],
      report_schema: "g07-role-report/v2",
      trusted_identity_attestation_required: true,
      source_bodies_embedded: false,
    };
    if (role === "coder") return { ...common, exact_write_scope: route.access.expanded_write_patterns, instructions: "Implement exactly one Task. Do not change business intent. Return a structured report with trusted platform identity attestation; do not write Task state or the event log." };
    if (role === "auditor") return { ...common, read_only: true, required_evidence: ["normal", "exception", "recovery"], instructions: "Audit the exact candidate commit independently. Return evidence hashes and PASS/FAIL; do not modify implementation." };
    if (role === "reviewer") return { ...common, read_only: true, required_checks: ["contract", "diff", "write_channel", "cross_fp"], instructions: "Review the exact candidate commit independently. Return APPROVE/REQUEST_CHANGES; do not repair the diff." };
    if (role === "architect") return { ...common, read_only: true, replan_categories: this.policy.replan_categories, instructions: "Handle only Replan A/B/C/D. A/B stay inside approved technical boundaries, C is CREATOR_REQUIRED, and D is technical/environment blocking." };
    if (role === "prompt_editor") return { ...common, exact_write_scope: route.access.expanded_write_patterns, instructions: "Edit only an instantiated Prompt revision target anchor. Do not publish, activate, change code/Schema/business, or review your own revision." };
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
    this.clean = true;
    this.workspacePaths = ["package.json"];
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
    return this.clean;
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

  workspaceFiles() {
    return [...this.workspacePaths];
  }
}

class FakeIdentityAttestor {
  constructor(key = Buffer.from("g07-self-test-identity-attestor-key-32-bytes")) {
    this.key = key;
    this.provider = "SELF_TEST_HMAC";
  }

  issue(payload) {
    const body = { provider: this.provider, ...payload };
    return {
      body,
      signature: crypto.createHmac("sha256", this.key).update(stableJson(body)).digest("hex"),
    };
  }

  verify(attestation, expected) {
    if (!attestation?.body || !attestation.signature) return { trusted: false };
    const expectedSignature = crypto.createHmac("sha256", this.key).update(stableJson(attestation.body)).digest("hex");
    if (attestation.signature !== expectedSignature) return { trusted: false };
    if (Object.entries(expected).some(([key, value]) => attestation.body[key] !== value)) return { trusted: false };
    return {
      trusted: true,
      provider: this.provider,
      principal_id: attestation.body.principal_id,
      session_id: attestation.body.session_id,
      evidence_hash: sha256(stableJson(attestation)),
    };
  }
}

function selfTestReport({ orchestrator, fakeGit, attestor, role, actorId, sessionId, principalId = actorId, attestedSessionId = sessionId, attemptId, baseCommit, candidateCommit, contextHash, verdict, decision = null, evidence = null, checks = null }) {
  const patchText = fakeGit.diffPatch(baseCommit, candidateCommit);
  const diffHash = sha256(patchText);
  const task = orchestrator.router.taskById.get("F0-01-REPO");
  const identityPayload = {
    principal_id: principalId,
    session_id: attestedSessionId,
    role,
    task_id: "F0-01-REPO",
    attempt_id: attemptId,
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    context_hash: contextHash,
  };
  return {
    report_version: "g07-role-report/v2",
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
    identity_attestation: attestor.issue(identityPayload),
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
      return null;
    } catch (error) {
      checks.push({ id, passed: error.code === expectedCode, evidence: { expected: expectedCode, actual: error.code, message: error.message, details: error.details ?? null } });
      return error;
    }
  };
  const basePolicy = readJsonFile(path.join(root, DEFAULT_STATE_DIR, POLICY_FILE));
  const router = new ProjectContextRouter(root);
  let idCounter = 0;
  const mergeObjects = (target, changes) => {
    for (const [key, value] of Object.entries(changes ?? {})) {
      if (value && typeof value === "object" && !Array.isArray(value)
        && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) mergeObjects(target[key], value);
      else target[key] = clone(value);
    }
    return target;
  };
  const approvedControl = {
    g07_gate: "APPROVED",
    g07_a_status: "REWORK",
    g07_approval_evidence_sha256: "a".repeat(64),
  };
  const makeHarness = ({ policyChanges = {}, clock = () => new Date("2026-07-11T12:00:00.000Z"), withIdentity = true } = {}) => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "g07-orchestrator-v2-"));
    tempRoots.push(stateDir);
    const policy = mergeObjects(clone(basePolicy), {
      phase: "G07_APPROVED_INTEGRATION",
      product_task_execution_allowed: true,
      identity_attestation: { provider: withIdentity ? "SELF_TEST_HMAC" : "UNAVAILABLE" },
    });
    mergeObjects(policy, policyChanges);
    const fakeGit = new FakeGitClient(root);
    const attestor = new FakeIdentityAttestor();
    const orchestrator = new ProjectOrchestrator({
      root,
      stateDir,
      policy,
      router,
      git: fakeGit,
      clock,
      idFactory: () => `self-test-v2-${String(++idCounter).padStart(6, "0")}`,
      identityAttestor: withIdentity ? attestor : null,
      testControlOverrides: approvedControl,
      authority: SELF_TEST_AUTHORITY,
    });
    return { orchestrator, fakeGit, stateDir, policy, attestor, clock };
  };
  const contextHashFor = (harness) => harness.orchestrator.controlContext("F0-01-REPO").hash;
  const implement = ({ harness, runId, attempt, candidateCommit, paths = ["package.json"], patch = null, principalId = null, attestedSessionId = null }) => {
    const { orchestrator, fakeGit, attestor } = harness;
    let state = orchestrator.project().taskStates.get("F0-01-REPO");
    if (state.status === "REWORK") {
      orchestrator.transition({ runId, taskId: "F0-01-REPO", toStatus: "READY", attemptId: attempt, role: "orchestrator" });
      state = orchestrator.project().taskStates.get("F0-01-REPO");
    }
    invariant(state.status === "READY", `self-test implementation helper requires READY, got ${state.status}`);
    const contextHash = contextHashFor(harness);
    const baseCommit = fakeGit.head();
    const lease = orchestrator.lease({ runId, taskId: "F0-01-REPO", role: "coder", actorId: `declared-coder-${attempt}`, attemptId: attempt });
    orchestrator.transition({ runId, taskId: "F0-01-REPO", toStatus: "IN_PROGRESS", attemptId: attempt, role: "coder" });
    fakeGit.addCommit(candidateCommit, { baseCommit, paths, patch });
    const report = selfTestReport({
      orchestrator,
      fakeGit,
      attestor,
      role: "coder",
      actorId: `declared-coder-${attempt}`,
      sessionId: `declared-coder-session-${attempt}`,
      principalId: principalId ?? `attested-coder-${attempt}`,
      attestedSessionId: attestedSessionId ?? `attested-coder-session-${attempt}`,
      attemptId: attempt,
      baseCommit,
      candidateCommit,
      contextHash,
      verdict: "IMPLEMENTED",
    });
    orchestrator.record({ runId, report });
    invariant(orchestrator.project().taskStates.get("F0-01-REPO").status === "IN_PROGRESS", "coder report changed Task state directly");
    orchestrator.transition({ runId, taskId: "F0-01-REPO", toStatus: "IMPLEMENTED", attemptId: attempt, candidateCommit });
    return { baseCommit, candidateCommit, contextHash, lease, coderReport: report };
  };
  const review = ({ harness, runId, implementation, role, verdict, attempt, actorId = null, sessionId = null, principalId = null, attestedSessionId = null, record = true }) => {
    const { orchestrator, fakeGit, attestor } = harness;
    const declaredActor = actorId ?? `declared-${role}-${attempt}`;
    const declaredSession = sessionId ?? `declared-${role}-session-${attempt}`;
    const lease = orchestrator.lease({
      runId,
      taskId: "F0-01-REPO",
      role,
      actorId: declaredActor,
      attemptId: attempt,
      candidateCommit: implementation.candidateCommit,
    });
    const report = selfTestReport({
      orchestrator,
      fakeGit,
      attestor,
      role,
      actorId: declaredActor,
      sessionId: declaredSession,
      principalId: principalId ?? `attested-${role}-${attempt}`,
      attestedSessionId: attestedSessionId ?? `attested-${role}-session-${attempt}`,
      attemptId: attempt,
      baseCommit: implementation.baseCommit,
      candidateCommit: implementation.candidateCommit,
      contextHash: implementation.contextHash,
      verdict,
    });
    return { lease, report, event: record ? orchestrator.record({ runId, report }) : null };
  };
  const passReviews = ({ harness, runId, implementation, suffix = "pass", identity = {} }) => {
    const audit = review({
      harness,
      runId,
      implementation,
      role: "auditor",
      verdict: "PASS",
      attempt: `audit-${suffix}`,
      principalId: identity.auditorPrincipal,
      attestedSessionId: identity.auditorSession,
    });
    const reviewer = review({
      harness,
      runId,
      implementation,
      role: "reviewer",
      verdict: "APPROVE",
      attempt: `review-${suffix}`,
      principalId: identity.reviewerPrincipal,
      attestedSessionId: identity.reviewerSession,
    });
    return { audit, reviewer };
  };

  try {
    const production = new ProjectOrchestrator({ root });
    const productionEventsBefore = production.store.read();
    const productionFileBefore = production.store.fileSnapshot();
    const dryRun = production.dryRun({ runId: "g07-a-rework-dry" });
    const productionEventsAfter = production.store.read();
    const productionFileAfter = production.store.fileSnapshot();
    assertCheck("production:policy-hash-bound", production.policyHash === String(router.gates.G07_A_POLICY_SHA256).toLowerCase(), production.policyHash);
    assertCheck("production:phase-gate-bound", production.policy.phase === "G07_A_CONTROL_PLANE_ONLY"
      && production.controlGateSnapshot().g07_gate === "PENDING", production.controlGateSnapshot());
    assertCheck("dry-run:unique-f0-01", dryRun.selected_task_id === "F0-01-REPO"
      && dryRun.selection_reason === "UNIQUE_READY_TASK"
      && dryRun.ready_candidates.length === 1, dryRun);
    assertCheck("dry-run:global-empty-fp", dryRun.fp_ids.length === 0, dryRun.fp_ids);
    assertCheck("dry-run:event-snapshot-unchanged", dryRun.event_log_unchanged
      && stableJson(productionFileBefore) === stableJson(productionFileAfter)
      && productionEventsBefore.length === productionEventsAfter.length, dryRun.snapshots);
    assertCheck("dry-run:projection-snapshot-unchanged", dryRun.task_status_changed === false
      && dryRun.snapshots.before.task_projection.sha256 === dryRun.snapshots.after.task_projection.sha256, dryRun.snapshots);
    assertCheck("dry-run:product-tree-snapshot-unchanged", dryRun.product_files_written === false
      && dryRun.snapshots.before.scoped_product_tree.sha256 === dryRun.snapshots.after.scoped_product_tree.sha256, dryRun.snapshots);
    assertCheck("dry-run:g07-product-hard-stop", dryRun.policy_execution_allowed === false
      && dryRun.policy_stop_reason === "G07_PHASE_PRODUCT_TASK_EXECUTION_DISABLED", dryRun.policy_stop_reason);
    assertCheck("dry-run:g07-gate-pending", dryRun.g07_gate === "PENDING", dryRun.g07_gate);
    assertCheck("dry-run:no-integrity-key-created", !fs.existsSync(path.join(root, DEFAULT_STATE_DIR, INTEGRITY_KEY_FILE)), path.join(root, DEFAULT_STATE_DIR, INTEGRITY_KEY_FILE));
    expectError("production:coder-lease-hard-stop", () => production.lease({
      runId: "g07-no-product",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "declared-writer",
      attemptId: "attempt-1",
    }), "BLOCKED_TECHNICAL");
    expectError("production:coder-prompt-hard-stop", () => production.rolePrompt({ runId: "g07-no-product", taskId: "F0-01-REPO", role: "coder" }), "BLOCKED_TECHNICAL");
    assertCheck("production:hard-stop-does-not-append", production.store.read().length === productionEventsBefore.length, production.store.read().length);
    expectError("policy:external-injection-rejected", () => new ProjectOrchestrator({ root, policy: clone(basePolicy) }), "TEST_INJECTION_FORBIDDEN");
    let mutationBlocked = false;
    try {
      production.policy.hard_stop_actions.splice(0);
    } catch {
      mutationBlocked = true;
    }
    assertCheck("policy:in-memory-policy-is-deep-frozen", mutationBlocked && production.policy.hard_stop_actions.length === MANDATORY_HARD_STOP_ACTIONS.length, production.policy.hard_stop_actions);
    assertCheck("policy:compiled-hard-stop-survives-memory-attack", production.evaluateAction("PUSH", "run-policy").allowed === false, production.evaluateAction("PUSH", "run-policy"));
    expectError("policy:missing-hard-stop-array-rejected", () => makeHarness({ policyChanges: { hard_stop_actions: [] } }), "POLICY_HARD_STOP_INVALID");
    const ignoredRuntime = production.git.run(["check-ignore", "--quiet", ".autonomy/events.jsonl"], { allowFailure: true }).status === 0;
    const trackedRuntime = production.git.run(["ls-files", "--error-unmatch", ".autonomy/events.jsonl"], { allowFailure: true }).status === 0;
    assertCheck("runtime:event-log-ignored-untracked", ignoredRuntime && !trackedRuntime, { ignoredRuntime, trackedRuntime });

    const promptHarness = makeHarness();
    const coderPrompt = promptHarness.orchestrator.rolePrompt({ runId: "run-prompt", taskId: "F0-01-REPO", role: "coder" });
    assertCheck("prompt:ready-coder-exact-scope", coderPrompt.task_status === "READY"
      && coderPrompt.exact_write_scope.length > 0
      && coderPrompt.context_hash === contextHashFor(promptHarness), coderPrompt);
    assertCheck("prompt:trusted-attestation-required", coderPrompt.trusted_identity_attestation_required === true
      && coderPrompt.report_schema === "g07-role-report/v2", coderPrompt.report_schema);
    expectError("prompt:planned-coder-rejected", () => promptHarness.orchestrator.rolePrompt({ runId: "run-prompt", taskId: "F0-02-CONTRACTS", role: "coder" }), "TASK_NOT_READY");
    expectError("prompt:slice-before-verified-rejected", () => promptHarness.orchestrator.rolePrompt({ runId: "run-prompt", role: "slice_gate_runner", sliceId: "F0" }), "SLICE_NOT_VERIFIED");
    assertCheck("prompt:no-source-body", !stableJson(coderPrompt).includes("source_body"), coderPrompt.source_bodies_embedded);

    const leaseHarness = makeHarness();
    const leaseContext = contextHashFor(leaseHarness);
    const unlockBefore = leaseHarness.orchestrator.unlock({ runId: "run-lease" });
    assertCheck("unlock:dependency-not-verified", unlockBefore.unlocked.length === 0, unlockBefore);
    expectError("lease:non-ready-rejected", () => leaseHarness.orchestrator.lease({
      runId: "run-lease",
      taskId: "F0-02-CONTRACTS",
      role: "coder",
      actorId: "early",
      attemptId: "early",
    }), "TASK_NOT_READY");
    expectError("lease:caller-context-forgery-rejected", () => leaseHarness.orchestrator.lease({
      runId: "run-lease",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "forged",
      attemptId: "forged",
      contextHash: "f".repeat(64),
    }), "LEASE_CONTEXT_MISMATCH");
    const writerLease = leaseHarness.orchestrator.lease({ runId: "run-lease", taskId: "F0-01-REPO", role: "coder", actorId: "writer", attemptId: "writer" });
    assertCheck("lease:context-derived-by-orchestrator", writerLease.context_hash === leaseContext && writerLease.to_status === "LEASED", writerLease);
    expectError("lease:double-writer-rejected", () => leaseHarness.orchestrator.lease({ runId: "run-lease", taskId: "F0-01-REPO", role: "coder", actorId: "writer-2", attemptId: "writer-2" }), "TASK_NOT_READY");
    leaseHarness.orchestrator.transition({ runId: "run-lease", taskId: "F0-01-REPO", toStatus: "IN_PROGRESS", attemptId: "writer", role: "coder" });
    expectError("transition:verified-jump-rejected", () => leaseHarness.orchestrator.transition({ runId: "run-lease", taskId: "F0-01-REPO", toStatus: "VERIFIED", attemptId: "writer" }), "EVIDENCE_REQUIRED");

    const retryHarness = makeHarness();
    let firstImplementation = implement({ harness: retryHarness, runId: "run-retry", attempt: "attempt-1", candidateCommit: "b".repeat(40) });
    const auditFail = review({ harness: retryHarness, runId: "run-retry", implementation: firstImplementation, role: "auditor", verdict: "FAIL", attempt: "audit-fail-1" }).event;
    assertCheck("rework:auditor-fail", auditFail.to_status === "REWORK" && auditFail.counters.rework === 1, auditFail);
    let secondImplementation = implement({ harness: retryHarness, runId: "run-retry", attempt: "attempt-2", candidateCommit: "c".repeat(40) });
    const reviewerFail = review({ harness: retryHarness, runId: "run-retry", implementation: secondImplementation, role: "reviewer", verdict: "REQUEST_CHANGES", attempt: "review-fail-2" }).event;
    assertCheck("rework:reviewer-request-changes", reviewerFail.to_status === "REWORK" && reviewerFail.counters.rework === 2, reviewerFail);
    let thirdImplementation = implement({ harness: retryHarness, runId: "run-retry", attempt: "attempt-3", candidateCommit: "d".repeat(40) });
    const thirdFailure = review({ harness: retryHarness, runId: "run-retry", implementation: thirdImplementation, role: "auditor", verdict: "FAIL", attempt: "audit-fail-3" }).event;
    assertCheck("replan:three-reworks", thirdFailure.to_status === "REPLAN"
      && thirdFailure.counters.rework === 3
      && thirdFailure.counters.replan === 1, thirdFailure);
    const architectPrompt = retryHarness.orchestrator.rolePrompt({ runId: "run-retry", taskId: "F0-01-REPO", role: "architect", candidateCommit: thirdImplementation.candidateCommit });
    assertCheck("prompt:architect-only-in-replan", architectPrompt.task_status === "REPLAN" && architectPrompt.replan_categories.C.includes("business"), architectPrompt);
    const architectLease = retryHarness.orchestrator.lease({ runId: "run-retry", taskId: "F0-01-REPO", role: "architect", actorId: "architect", attemptId: "architect-1", candidateCommit: thirdImplementation.candidateCommit });
    const architectReport = selfTestReport({
      orchestrator: retryHarness.orchestrator,
      fakeGit: retryHarness.fakeGit,
      attestor: retryHarness.attestor,
      role: "architect",
      actorId: "architect",
      sessionId: "architect-declared-session",
      attemptId: "architect-1",
      baseCommit: architectLease.base_commit,
      candidateCommit: thirdImplementation.candidateCommit,
      contextHash: thirdImplementation.contextHash,
      verdict: "REPLAN",
      decision: { category: "A", reason: "same-scope alternative" },
    });
    const architectDecision = retryHarness.orchestrator.record({ runId: "run-retry", report: architectReport });
    assertCheck("replan:architect-a-resumes", architectDecision.to_status === "READY" && architectDecision.counters.rework === 0, architectDecision);
    let exhausted = null;
    for (let number = 4; number <= 6; number += 1) {
      const implementation = implement({ harness: retryHarness, runId: "run-retry", attempt: `attempt-${number}`, candidateCommit: String.fromCharCode(97 + number).repeat(40) });
      exhausted = review({ harness: retryHarness, runId: "run-retry", implementation, role: "auditor", verdict: "FAIL", attempt: `audit-fail-${number}` }).event;
    }
    assertCheck("critical:path-derived-through-dependency-ancestry", retryHarness.orchestrator.isCriticalTask("S1-FP001-03") === true, [...retryHarness.orchestrator.criticalTaskIds()].includes("S1-FP001-03"));
    assertCheck("replan:two-replans-require-creator", exhausted.to_status === "CREATOR_REQUIRED"
      && exhausted.creator_required_reason === "CRITICAL_PATH_REPLAN_LIMIT_EXHAUSTED", exhausted);
    expectError("creator-required:forged-string-cannot-clear", () => retryHarness.orchestrator.transition({
      runId: "run-retry",
      taskId: "F0-01-REPO",
      toStatus: "READY",
      attemptId: "forged-creator",
      creatorApprovalEvidence: "CREATOR_EXPLICIT_FAKE",
    }), "CREATOR_CONTROL_UPDATE_REQUIRED");

    const goodHarness = makeHarness();
    const goodImplementation = implement({ harness: goodHarness, runId: "run-good", attempt: "good-1", candidateCommit: "1".repeat(40) });
    const goodReviews = passReviews({ harness: goodHarness, runId: "run-good", implementation: goodImplementation, suffix: "good" });
    assertCheck("record:pass-reports-do-not-directly-verify", goodHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "VERIFYING", goodHarness.orchestrator.project().taskStates.get("F0-01-REPO"));
    const auditorPrompt = goodHarness.orchestrator.rolePrompt({ runId: "run-good", taskId: "F0-01-REPO", role: "auditor", candidateCommit: goodImplementation.candidateCommit });
    const reviewerPrompt = goodHarness.orchestrator.rolePrompt({ runId: "run-good", taskId: "F0-01-REPO", role: "reviewer", candidateCommit: goodImplementation.candidateCommit });
    assertCheck("prompt:auditor-evidence-shape", stableJson(auditorPrompt.required_evidence) === stableJson(["normal", "exception", "recovery"]), auditorPrompt.required_evidence);
    assertCheck("prompt:reviewer-check-shape", stableJson(reviewerPrompt.required_checks) === stableJson(["contract", "diff", "write_channel", "cross_fp"]), reviewerPrompt.required_checks);
    const verified = goodHarness.orchestrator.verifyEvidence({ runId: "run-good", taskId: "F0-01-REPO", candidateCommit: goodImplementation.candidateCommit });
    assertCheck("evidence:mechanical-verification", verified.to_status === "VERIFIED"
      && verified.verdicts.auditor === "PASS"
      && verified.verdicts.reviewer === "APPROVE"
      && verified.payload.trusted_identities.length === 3, verified);
    const unlocked = goodHarness.orchestrator.unlock({ runId: "run-good" });
    assertCheck("unlock:only-after-dependency-verified", unlocked.unlocked.includes("F0-02-CONTRACTS"), unlocked.unlocked);
    assertCheck("events:hmac-authenticated", goodHarness.orchestrator.store.read().every((event) => event.integrity_algorithm === "HMAC-SHA256" && isSha256(event.event_hash)), goodHarness.orchestrator.store.read().length);
    assertCheck("events:required-fields", goodHarness.orchestrator.store.read().every((event) => REQUIRED_EVENT_FIELDS.every((field) => Object.hasOwn(event, field))), REQUIRED_EVENT_FIELDS);
    assertCheck("events:runtime-key-created-only-on-write", fs.existsSync(path.join(goodHarness.stateDir, INTEGRITY_KEY_FILE)), goodHarness.stateDir);
    assertCheck("evidence:reports-bound-same-context", [goodImplementation.coderReport, goodReviews.audit.report, goodReviews.reviewer.report].every((report) => report.context_hash === goodImplementation.contextHash), goodImplementation.contextHash);

    const concurrencyHarness = makeHarness();
    const concurrencyImplementation = implement({ harness: concurrencyHarness, runId: "run-concurrency", attempt: "concurrency-1", candidateCommit: "2".repeat(40) });
    const heldAudit = review({ harness: concurrencyHarness, runId: "run-concurrency", implementation: concurrencyImplementation, role: "auditor", verdict: "PASS", attempt: "held-audit", record: false });
    const heldReview = review({ harness: concurrencyHarness, runId: "run-concurrency", implementation: concurrencyImplementation, role: "reviewer", verdict: "APPROVE", attempt: "held-review", record: false });
    expectError("lease:third-read-only-reviewer-rejected", () => concurrencyHarness.orchestrator.lease({
      runId: "run-concurrency",
      taskId: "F0-01-REPO",
      role: "reviewer",
      actorId: "third",
      attemptId: "third",
      candidateCommit: concurrencyImplementation.candidateCommit,
    }), "REVIEW_CONCURRENCY_BLOCKED");
    concurrencyHarness.orchestrator.record({ runId: "run-concurrency", report: heldAudit.report });
    concurrencyHarness.orchestrator.record({ runId: "run-concurrency", report: heldReview.report });

    const missingIdentityHarness = makeHarness({ withIdentity: false });
    const missingIdentityImplementation = implement({ harness: missingIdentityHarness, runId: "run-no-identity", attempt: "no-identity-1", candidateCommit: "3".repeat(40) });
    passReviews({ harness: missingIdentityHarness, runId: "run-no-identity", implementation: missingIdentityImplementation, suffix: "no-identity" });
    const missingIdentityError = expectError("identity:unavailable-platform-hard-stops", () => missingIdentityHarness.orchestrator.verifyEvidence({
      runId: "run-no-identity",
      taskId: "F0-01-REPO",
      candidateCommit: missingIdentityImplementation.candidateCommit,
    }), "ENVIRONMENT_APPROVAL_REQUIRED");
    const missingIdentityState = missingIdentityHarness.orchestrator.project().taskStates.get("F0-01-REPO");
    assertCheck("identity:unavailable-recorded-as-blocked", missingIdentityState.status === "BLOCKED"
      && missingIdentityError?.details?.rejection_to_status === "BLOCKED", missingIdentityError?.details);

    const selfReviewHarness = makeHarness();
    const selfReviewImplementation = implement({
      harness: selfReviewHarness,
      runId: "run-self-review",
      attempt: "self-review-1",
      candidateCommit: "4".repeat(40),
      principalId: "attested-shared-principal",
      attestedSessionId: "attested-shared-session",
    });
    passReviews({
      harness: selfReviewHarness,
      runId: "run-self-review",
      implementation: selfReviewImplementation,
      suffix: "self-review",
      identity: {
        auditorPrincipal: "attested-shared-principal",
        auditorSession: "attested-shared-session",
        reviewerPrincipal: "attested-reviewer-distinct",
        reviewerSession: "attested-reviewer-session-distinct",
      },
    });
    expectError("identity:caller-strings-cannot-fake-independence", () => selfReviewHarness.orchestrator.verifyEvidence({
      runId: "run-self-review",
      taskId: "F0-01-REPO",
      candidateCommit: selfReviewImplementation.candidateCommit,
    }), "SELF_REVIEW_BLOCKED");
    assertCheck("identity:self-review-failure-enters-rework", selfReviewHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", selfReviewHarness.orchestrator.project().taskStates.get("F0-01-REPO"));

    const dirtyHarness = makeHarness();
    const dirtyImplementation = implement({ harness: dirtyHarness, runId: "run-dirty", attempt: "dirty-1", candidateCommit: "5".repeat(40) });
    passReviews({ harness: dirtyHarness, runId: "run-dirty", implementation: dirtyImplementation, suffix: "dirty" });
    dirtyHarness.fakeGit.clean = false;
    const dirtyError = expectError("evidence:dirty-worktree-rejected", () => dirtyHarness.orchestrator.verifyEvidence({
      runId: "run-dirty",
      taskId: "F0-01-REPO",
      candidateCommit: dirtyImplementation.candidateCommit,
    }), "WORKTREE_DIRTY");
    assertCheck("evidence:dirty-failure-recorded", dirtyHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK"
      && isSha256(dirtyHarness.orchestrator.store.read().at(-1).failure_fingerprint), dirtyError?.details);

    const contextHarness = makeHarness();
    const contextImplementation = implement({ harness: contextHarness, runId: "run-context", attempt: "context-1", candidateCommit: "6".repeat(40) });
    passReviews({ harness: contextHarness, runId: "run-context", implementation: contextImplementation, suffix: "context" });
    expectError("evidence:caller-context-forgery-rejected", () => contextHarness.orchestrator.verifyEvidence({
      runId: "run-context",
      taskId: "F0-01-REPO",
      candidateCommit: contextImplementation.candidateCommit,
      contextHash: "e".repeat(64),
    }), "VERIFY_CONTEXT_MISMATCH");
    assertCheck("evidence:context-failure-enters-rework", contextHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", contextHarness.orchestrator.project().taskStates.get("F0-01-REPO"));

    const staleHarness = makeHarness();
    const staleImplementation = implement({ harness: staleHarness, runId: "run-stale", attempt: "stale-1", candidateCommit: "7".repeat(40) });
    passReviews({ harness: staleHarness, runId: "run-stale", implementation: staleImplementation, suffix: "stale" });
    staleHarness.fakeGit.commits.add("8".repeat(40));
    staleHarness.fakeGit.headCommit = "8".repeat(40);
    expectError("evidence:new-commit-invalidates-old-audit", () => staleHarness.orchestrator.verifyEvidence({
      runId: "run-stale",
      taskId: "F0-01-REPO",
      candidateCommit: staleImplementation.candidateCommit,
    }), "STALE_CANDIDATE_COMMIT");
    assertCheck("evidence:stale-failure-recorded", staleHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", staleHarness.orchestrator.store.read().at(-1));

    const scopeHarness = makeHarness();
    const scopeImplementation = implement({ harness: scopeHarness, runId: "run-scope", attempt: "scope-1", candidateCommit: "9".repeat(40) });
    passReviews({ harness: scopeHarness, runId: "run-scope", implementation: scopeImplementation, suffix: "scope" });
    const originalPatch = scopeHarness.fakeGit.diffPatch(scopeImplementation.baseCommit, scopeImplementation.candidateCommit);
    scopeHarness.fakeGit.setDiff(scopeImplementation.baseCommit, scopeImplementation.candidateCommit, ["outside-product-scope.txt"], originalPatch);
    expectError("evidence:scope-overflow-rejected", () => scopeHarness.orchestrator.verifyEvidence({
      runId: "run-scope",
      taskId: "F0-01-REPO",
      candidateCommit: scopeImplementation.candidateCommit,
    }), "SCOPE_VIOLATION");
    assertCheck("evidence:scope-failure-recorded", scopeHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK"
      && scopeHarness.orchestrator.store.read().at(-1).payload.rejection.code === "SCOPE_VIOLATION", scopeHarness.orchestrator.store.read().at(-1));

    const secretHarness = makeHarness();
    const secretPatch = `diff --git a/package.json b/package.json\n+token=${["sk", "proj", "x".repeat(40)].join("-")}\n`;
    const secretImplementation = implement({ harness: secretHarness, runId: "run-secret", attempt: "secret-1", candidateCommit: "a".repeat(40), patch: secretPatch });
    passReviews({ harness: secretHarness, runId: "run-secret", implementation: secretImplementation, suffix: "secret" });
    expectError("evidence:secret-rejected", () => secretHarness.orchestrator.verifyEvidence({
      runId: "run-secret",
      taskId: "F0-01-REPO",
      candidateCommit: secretImplementation.candidateCommit,
    }), "SECRET_SCAN_FAILED");
    assertCheck("evidence:secret-failure-recorded", secretHarness.orchestrator.store.read().at(-1).payload.rejection.code === "SECRET_SCAN_FAILED"
      && secretHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", secretHarness.orchestrator.store.read().at(-1));

    const semanticHarness = makeHarness();
    expectError("events:private-writer-authority", () => semanticHarness.orchestrator.store.transact(Symbol("fake"), () => []), "EVENT_WRITE_FORBIDDEN");
    const seedEvent = semanticHarness.orchestrator.recordUsage({ runId: "run-forged-event", execution: { tokens: 0, time_ms: 0, known_cost: null } });
    const forgedKey = fs.readFileSync(path.join(semanticHarness.stateDir, INTEGRITY_KEY_FILE));
    const forgedDraft = semanticHarness.orchestrator.makeDraft({
      eventType: "EVIDENCE_VERIFIED",
      runId: "run-forged-event",
      taskId: "F0-01-REPO",
      role: "orchestrator",
      baseCommit: semanticHarness.fakeGit.head(),
      candidateCommit: semanticHarness.fakeGit.head(),
      contextHash: contextHashFor(semanticHarness),
      lease: { action: "RELEASE_ALL_TASK", task_id: "F0-01-REPO", lease_id: null },
      fromStatus: "READY",
      toStatus: "VERIFIED",
      acceptance: {
        commands: [{ command: "forged", exit_code: 0, evidence_hash: "1".repeat(64) }],
        diff_hash: "2".repeat(64),
        scope_evidence_hash: "3".repeat(64),
        secret_scan_evidence_hash: "4".repeat(64),
      },
      verdicts: { auditor: "PASS", reviewer: "APPROVE" },
    });
    forgedDraft.previous_event_hash = seedEvent.event_hash;
    forgedDraft.event_hash = hashEvent(forgedDraft, forgedKey);
    fs.appendFileSync(semanticHarness.orchestrator.store.eventsPath, `${JSON.stringify(forgedDraft)}\n`, "utf8");
    expectError("events:signed-ready-to-verified-forgery-rejected", () => semanticHarness.orchestrator.store.read(), "EVENT_SEMANTICS_INVALID");

    const tamperHarness = makeHarness();
    tamperHarness.orchestrator.recordUsage({ runId: "run-tamper", execution: { tokens: 1, time_ms: 1, known_cost: null } });
    const tamperedEvent = JSON.parse(fs.readFileSync(tamperHarness.orchestrator.store.eventsPath, "utf8").trim());
    tamperedEvent.payload = { forged: true };
    fs.writeFileSync(tamperHarness.orchestrator.store.eventsPath, `${JSON.stringify(tamperedEvent)}\n`, "utf8");
    expectError("events:hmac-tamper-rejected", () => tamperHarness.orchestrator.store.read(), "EVENT_AUTHENTICATION_INVALID");

    const tailHarness = makeHarness();
    tailHarness.orchestrator.recordUsage({ runId: "run-tail", execution: { tokens: 1, time_ms: 1, known_cost: null } });
    fs.appendFileSync(tailHarness.orchestrator.store.eventsPath, "{\"partial\":", "utf8");
    const tailResume = tailHarness.orchestrator.resume({ runId: "run-tail" });
    assertCheck("resume:truncated-tail-recovered", tailResume.recovered_truncated_tail?.rejected_tail_bytes > 0
      && fs.existsSync(path.join(tailHarness.stateDir, tailResume.recovered_truncated_tail.quarantine_path)), tailResume.recovered_truncated_tail);
    assertCheck("resume:recovered-log-valid", tailHarness.orchestrator.store.read().at(-1).event_type === "EVENT_LOG_TAIL_RECOVERED", tailHarness.orchestrator.store.read().at(-1));

    const lockHarness = makeHarness();
    const oldOwner = lockHarness.orchestrator.store.acquireLock();
    fs.closeSync(oldOwner.descriptor);
    oldOwner.descriptor = fs.openSync(os.devNull, "r");
    const replacement = { nonce: "replacement-owner", pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString() };
    fs.writeFileSync(lockHarness.orchestrator.store.lockPath, JSON.stringify(replacement), "utf8");
    lockHarness.orchestrator.store.releaseLock(oldOwner);
    const replacementSurvived = fs.existsSync(lockHarness.orchestrator.store.lockPath)
      && JSON.parse(fs.readFileSync(lockHarness.orchestrator.store.lockPath, "utf8")).nonce === replacement.nonce;
    assertCheck("lock:old-owner-cannot-delete-replacement", replacementSurvived, replacement);
    if (fs.existsSync(lockHarness.orchestrator.store.lockPath)) fs.unlinkSync(lockHarness.orchestrator.store.lockPath);

    let resumeClock = new Date("2026-07-11T12:00:00.000Z");
    const resumeHarness = makeHarness({ clock: () => new Date(resumeClock) });
    resumeHarness.orchestrator.lease({ runId: "run-resume", taskId: "F0-01-REPO", role: "coder", actorId: "resume-writer", attemptId: "resume-1", ttlSeconds: 1 });
    resumeClock = new Date("2026-07-11T12:00:02.000Z");
    const firstResume = resumeHarness.orchestrator.resume({ runId: "run-resume" });
    const reopened = new ProjectOrchestrator({
      root,
      stateDir: resumeHarness.stateDir,
      policy: resumeHarness.policy,
      router,
      git: resumeHarness.fakeGit,
      clock: () => new Date(resumeClock),
      idFactory: () => `self-test-v2-${String(++idCounter).padStart(6, "0")}`,
      identityAttestor: resumeHarness.attestor,
      testControlOverrides: approvedControl,
      authority: SELF_TEST_AUTHORITY,
    });
    const secondResume = reopened.resume({ runId: "run-resume" });
    assertCheck("resume:expired-lease-recovered", firstResume.recovered_expired_leases.length === 1
      && firstResume.next.task_id === "F0-01-REPO", firstResume);
    assertCheck("resume:deterministic-replay", secondResume.recovered_expired_leases.length === 0
      && secondResume.replay_hash === firstResume.replay_hash
      && secondResume.next.task_id === firstResume.next.task_id, { first: firstResume.replay_hash, second: secondResume.replay_hash });

    const diffRoot = fs.mkdtempSync(path.join(os.tmpdir(), "g07-delete-diff-"));
    tempRoots.push(diffRoot);
    const runFixtureGit = (args) => {
      const result = spawnSync("git", args, { cwd: diffRoot, encoding: "utf8", windowsHide: true });
      invariant(result.status === 0, `fixture git ${args.join(" ")} failed: ${result.stderr}`);
      return result.stdout.trim();
    };
    runFixtureGit(["init", "--quiet"]);
    runFixtureGit(["config", "user.email", "g07-self-test@example.invalid"]);
    runFixtureGit(["config", "user.name", "G07 Self Test"]);
    fs.writeFileSync(path.join(diffRoot, "deleted-scope.txt"), "fixture\n", "utf8");
    runFixtureGit(["add", "deleted-scope.txt"]);
    runFixtureGit(["commit", "--quiet", "-m", "base"]);
    const deletionBase = runFixtureGit(["rev-parse", "HEAD"]);
    fs.unlinkSync(path.join(diffRoot, "deleted-scope.txt"));
    runFixtureGit(["add", "-u"]);
    runFixtureGit(["commit", "--quiet", "-m", "delete"]);
    const deletionCandidate = runFixtureGit(["rev-parse", "HEAD"]);
    assertCheck("scope:deleted-path-included", new GitClient(diffRoot).diffNames(deletionBase, deletionCandidate).includes("deleted-scope.txt"), new GitClient(diffRoot).diffNames(deletionBase, deletionCandidate));

    const actionHarness = makeHarness();
    for (const action of MANDATORY_HARD_STOP_ACTIONS) {
      const result = actionHarness.orchestrator.evaluateAction(action, "run-actions");
      assertCheck(`hard-stop:${action.toLowerCase()}`, result.allowed === false
        && result.hard_stop === true
        && result.decision_level === "ENVIRONMENT_APPROVAL_REQUIRED", result);
    }
    for (const action of ["MERGE_TO_MAIN", "WRITE_G07_GATE_APPROVED"]) {
      const result = actionHarness.orchestrator.evaluateAction(action, "run-actions");
      assertCheck(`hard-stop:${action.toLowerCase()}`, result.allowed === false
        && result.hard_stop === true
        && result.decision_level === "CREATOR_REQUIRED", result);
    }

    const budgetHarness = makeHarness({ policyChanges: { budget: { limits: { tokens: 100, elapsed_ms: null, known_cost: null } } } });
    budgetHarness.orchestrator.recordUsage({ runId: "run-budget", execution: { tokens: 80, time_ms: 0, known_cost: null } });
    assertCheck("budget:80-percent-notify", budgetHarness.orchestrator.budgetState("run-budget").state === "NOTIFY_80_PERCENT", budgetHarness.orchestrator.budgetState("run-budget"));
    budgetHarness.orchestrator.recordUsage({ runId: "run-budget", execution: { tokens: 20, time_ms: 0, known_cost: null } });
    const budgetStop = budgetHarness.orchestrator.evaluateAction("PRODUCT_TASK_WRITE", "run-budget");
    assertCheck("budget:100-percent-hard-stop", budgetStop.allowed === false
      && budgetStop.hard_stop === true
      && budgetStop.reason === "BUDGET_100_PERCENT_OR_UNKNOWN_COST", budgetStop);

    const reportBefore = promptHarness.orchestrator.store.read().length;
    const businessReport = promptHarness.orchestrator.projectReport({ runId: "run-prompt", sliceId: "F0" });
    const reportAfter = promptHarness.orchestrator.store.read().length;
    assertCheck("report:no-gate-or-state-change", businessReport.g07_gate_unchanged === "PENDING"
      && reportBefore === reportAfter, businessReport.g07_gate_unchanged);
    assertCheck("projection:not-manually-maintained", !fs.existsSync(path.join(goodHarness.stateDir, "projection.json")), goodHarness.stateDir);
  } finally {
    for (const tempRoot of tempRoots) {
      const resolved = path.resolve(tempRoot);
      if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
    }
  }

  const passed = checks.filter((check) => check.passed).length;
  return {
    schema_version: "project-orchestrator-self-test/v2",
    passed: passed === checks.length,
    assertions: { passed, failed: checks.length - passed, total: checks.length },
    failed_checks: checks.filter((check) => !check.passed),
    coverage: {
      dry_run: ["unique F0-01", "empty GLOBAL FP set", "event/projection/product snapshots"],
      policy: ["registered hash", "phase/Gate", "compiled hard stops", "deep freeze", "injection refusal"],
      evidence: ["current control context", "clean worktree", "trusted identity", "scope including deletion", "secret", "same commit"],
      event_log: ["HMAC", "private writer authority", "semantic replay", "truncated-tail recovery", "nonce lock ownership"],
      recovery: ["failed evidence events", "three reworks", "two Replans", "critical ancestry", "deterministic resume"],
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
    "  node tools/project-orchestrator.mjs verify-evidence --run-id ID --task-id ID --candidate-commit SHA [--context-hash SHA256]",
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
  FakeGitClient,
  GitClient,
  ProjectOrchestrator,
  TASK_STATUSES,
  TRANSITIONS,
  runOrchestratorSelfTest,
};
