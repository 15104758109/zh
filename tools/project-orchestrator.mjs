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
const QUARANTINE_DIR = "quarantine";
const CONTROL_FILE = "docs/IMPLEMENTATION_CONTROL.md";
const ROUTER_FILE = "tools/project-context-loader.mjs";
const ORCHESTRATOR_FILE = "tools/project-orchestrator.mjs";
const SELF_TEST_AUTHORITY = Symbol("G07_INTERNAL_SELF_TEST_AUTHORITY");
const PLATFORM_RECEIPT_VERSION = "g07-platform-receipt/v1";

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

const KNOWN_ACTIONS = new Set([
  "CONTROL_PLANE_READ",
  "READ_ONLY_REVIEW",
  "PRODUCT_TASK_WRITE",
  ...MANDATORY_HARD_STOP_ACTIONS,
  ...MANDATORY_FORBIDDEN_AUTOMATIC_ACTIONS,
]);

const EVENT_TYPES = new Set([
  "TASK_UNLOCKED",
  "LEASE_ACQUIRED",
  "LEASE_EXPIRED",
  "ROLE_REPORT_RECORDED",
  "TASK_TRANSITION",
  "EVIDENCE_VERIFIED",
  "EVIDENCE_REJECTED",
  "CANDIDATE_INVALIDATED",
  "USAGE_RECORDED",
  "HARD_STOP",
  "EVENT_LOG_TAIL_RECOVERED",
  "SLICE_GATE_LEASE_ACQUIRED",
  "SLICE_GATE_LEASE_EXPIRED",
  "SLICE_GATE_REPORT_RECORDED",
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
  "platform_receipts",
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

function pathInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRegularFileWithoutLinks(filePath, { boundaryRoot = null, maxBytes = 16 * 1024 * 1024, purpose = "registered file" } = {}) {
  const absolute = path.resolve(filePath);
  if (boundaryRoot) invariant(pathInside(boundaryRoot, absolute), `${purpose} escapes its registered directory`, "TRUSTED_FILE_BOUNDARY_VIOLATION");
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = fs.lstatSync(current);
    invariant(!stats.isSymbolicLink(), `${purpose} contains a symbolic link or junction`, "TRUSTED_FILE_SYMLINK_FORBIDDEN", { path: normalizePath(current) });
  }
  const stats = fs.statSync(absolute);
  invariant(stats.isFile(), `${purpose} must be a regular file`, "TRUSTED_FILE_TYPE_INVALID");
  invariant(stats.nlink === 1, `${purpose} cannot be a hard-linked alias`, "TRUSTED_FILE_HARDLINK_FORBIDDEN", { links: stats.nlink });
  invariant(stats.size <= maxBytes, `${purpose} exceeds the registered size limit`, "TRUSTED_FILE_TOO_LARGE", { bytes: stats.size, max_bytes: maxBytes });
  return { absolute, stats };
}

function normalizedHead(value, streamId) {
  const count = Number(value?.event_count ?? 0);
  const eventHash = value?.event_hash ?? null;
  invariant(value?.stream_id === streamId && Number.isInteger(count) && count >= 0
    && ((count === 0 && eventHash === null) || (count > 0 && isSha256(eventHash))), "external monotonic head is invalid", "EVENT_HEAD_INVALID");
  return { stream_id: streamId, event_count: count, event_hash: eventHash };
}

class ExternalCommandMonotonicHead {
  constructor({ commandPath, commandSha256, streamId, workspaceRoot, timeoutMs = 5000 }) {
    const basename = path.basename(commandPath ?? "").toLowerCase();
    invariant(basename !== ".env" && !basename.startsWith(".env."), "monotonic head command cannot be an environment file", "CREDENTIAL_ACCESS");
    const checked = assertRegularFileWithoutLinks(commandPath, { maxBytes: 64 * 1024 * 1024, purpose: "monotonic head command" });
    invariant(!pathInside(workspaceRoot, checked.absolute), "monotonic head command must be outside the role-writable workspace", "EVENT_HEAD_COMMAND_BOUNDARY_INVALID");
    invariant(hashFile(checked.absolute) === commandSha256, "monotonic head command hash drifted", "EVENT_HEAD_COMMAND_HASH_MISMATCH");
    this.commandPath = checked.absolute;
    this.commandSha256 = commandSha256;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.streamId = streamId;
    this.timeoutMs = Number(timeoutMs);
  }

  run(args) {
    const checked = assertRegularFileWithoutLinks(this.commandPath, { maxBytes: 64 * 1024 * 1024, purpose: "monotonic head command" });
    invariant(checked.absolute === this.commandPath && !pathInside(this.workspaceRoot, checked.absolute), "monotonic head command boundary drifted", "EVENT_HEAD_COMMAND_BOUNDARY_INVALID");
    invariant(hashFile(checked.absolute) === this.commandSha256, "monotonic head command hash drifted before execution", "EVENT_HEAD_COMMAND_HASH_MISMATCH");
    const result = spawnSync(this.commandPath, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: this.timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    invariant(result.status === 0, "external monotonic head command failed", "ENVIRONMENT_APPROVAL_REQUIRED", {
      reason: "MONOTONIC_HEAD_COMMAND_FAILED",
      exit_code: result.status,
      stderr_sha256: sha256(result.stderr ?? ""),
    });
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      invariant(false, "external monotonic head command returned invalid JSON", "EVENT_HEAD_INVALID");
    }
    return parsed;
  }

  read() {
    return normalizedHead(this.run(["get", "--stream-id", this.streamId]), this.streamId);
  }

  compareAndSet(expected, next) {
    const output = this.run([
      "compare-and-set",
      "--stream-id", this.streamId,
      "--expected-count", String(expected.event_count),
      "--expected-hash", expected.event_hash ?? "NULL",
      "--next-count", String(next.event_count),
      "--next-hash", next.event_hash ?? "NULL",
    ]);
    const actual = normalizedHead(output, this.streamId);
    invariant(actual.event_count === next.event_count && actual.event_hash === next.event_hash, "external monotonic head compare-and-set did not commit the requested head", "EVENT_HEAD_CAS_FAILED", { expected, next, actual });
    return actual;
  }
}

function monotonicHeadFromPolicy(policy, workspaceRoot) {
  const config = policy.monotonic_head;
  if (config?.provider === "UNAVAILABLE") return null;
  invariant(config?.provider === "EXTERNAL_COMMAND", "unsupported monotonic head provider", "EVENT_HEAD_PROVIDER_INVALID");
  return new ExternalCommandMonotonicHead({
    commandPath: config.command_path,
    commandSha256: config.command_sha256,
    streamId: config.stream_id,
    workspaceRoot,
    timeoutMs: config.timeout_ms,
  });
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

function sameStringSet(actual, expected) {
  return JSON.stringify(sortedUnique(actual ?? [])) === JSON.stringify(sortedUnique(expected));
}

function integerCounters(value) {
  return value && ["retry", "rework", "replan"].every((key) => Number.isInteger(value[key]) && value[key] >= 0);
}

function safeTimestampFragment(value) {
  return value.replaceAll(":", "-").replaceAll(".", "-");
}

function receiptBody(receipt) {
  const copy = { ...receipt };
  delete copy.signature;
  return copy;
}

class Ed25519PlatformTrust {
  constructor({ providerId, keyId, publicKey, clock }) {
    this.providerId = providerId;
    this.keyId = keyId;
    this.publicKey = publicKey?.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
    this.clock = clock;
    invariant(this.publicKey.asymmetricKeyType === "ed25519", "platform trust key must be Ed25519", "PLATFORM_TRUST_KEY_INVALID");
  }

  verify(receipt, kind, expectedClaims, { at = this.clock() } = {}) {
    invariant(receipt && typeof receipt === "object", `${kind} requires a platform receipt`, "PLATFORM_RECEIPT_REQUIRED");
    invariant(receipt.receipt_version === PLATFORM_RECEIPT_VERSION
      && receipt.provider_id === this.providerId
      && receipt.key_id === this.keyId
      && receipt.kind === kind, `platform receipt identity/kind mismatch for ${kind}`, "PLATFORM_RECEIPT_INVALID");
    invariant(typeof receipt.receipt_id === "string" && receipt.receipt_id.length >= 12, "platform receipt_id is invalid", "PLATFORM_RECEIPT_INVALID");
    invariant(!Number.isNaN(Date.parse(receipt.issued_at)) && !Number.isNaN(Date.parse(receipt.expires_at)), "platform receipt time window is invalid", "PLATFORM_RECEIPT_INVALID");
    const reference = at instanceof Date ? at.getTime() : new Date(at).getTime();
    invariant(reference >= Date.parse(receipt.issued_at) && reference <= Date.parse(receipt.expires_at), "platform receipt is not valid at the event time", "PLATFORM_RECEIPT_EXPIRED");
    invariant(stableJson(receipt.claims) === stableJson(expectedClaims), `platform receipt claims mismatch for ${kind}`, "PLATFORM_RECEIPT_CLAIMS_MISMATCH", {
      expected_sha256: sha256(stableJson(expectedClaims)),
      actual_sha256: sha256(stableJson(receipt.claims)),
    });
    let signature;
    try {
      signature = Buffer.from(receipt.signature, "base64");
    } catch {
      invariant(false, "platform receipt signature encoding is invalid", "PLATFORM_RECEIPT_INVALID");
    }
    invariant(signature.length > 0 && crypto.verify(null, Buffer.from(stableJson(receiptBody(receipt))), this.publicKey, signature), "platform receipt signature is invalid", "PLATFORM_RECEIPT_SIGNATURE_INVALID");
    return {
      trusted: true,
      provider: receipt.provider_id,
      key_id: receipt.key_id,
      receipt_id: receipt.receipt_id,
      evidence_hash: sha256(stableJson(receipt)),
      claims: receipt.claims,
    };
  }
}

function platformTrustFromPolicy(policy, root, clock) {
  const config = policy.platform_trust;
  if (config?.provider === "UNAVAILABLE") return null;
  invariant(config?.provider === "ED25519_FILE", "unsupported platform trust provider", "PLATFORM_TRUST_PROVIDER_INVALID");
  const relativePath = normalizePath(config.public_key_path ?? "");
  invariant(relativePath && !path.isAbsolute(relativePath) && !relativePath.startsWith("../") && !relativePath.includes("/../"), "platform public key path must be a workspace-relative registered path", "PLATFORM_TRUST_KEY_INVALID");
  const basename = path.posix.basename(relativePath).toLowerCase();
  invariant(basename !== ".env" && !basename.startsWith(".env."), "platform trust cannot load an environment file", "CREDENTIAL_ACCESS");
  const absolutePath = path.join(root, ...relativePath.split("/"));
  let checked;
  try {
    checked = assertRegularFileWithoutLinks(absolutePath, { boundaryRoot: root, maxBytes: 64 * 1024, purpose: "platform public key" });
  } catch (error) {
    if (error.code) throw error;
    invariant(false, "registered platform public key is missing", "PLATFORM_TRUST_KEY_MISSING");
  }
  invariant(hashFile(checked.absolute) === config.public_key_sha256, "platform public key hash drifted", "PLATFORM_TRUST_KEY_HASH_MISMATCH");
  invariant(config.private_key_path === null && config.private_key_material_in_workspace === false, "platform private signing material must not be configured in the workspace", "PLATFORM_PRIVATE_KEY_FORBIDDEN");
  return new Ed25519PlatformTrust({
    providerId: config.provider_id,
    keyId: config.key_id,
    publicKey: fs.readFileSync(checked.absolute),
    clock,
  });
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

  runBuffer(args, { allowFailure = false, maxBuffer = 128 * 1024 * 1024 } = {}) {
    const result = spawnSync("git", args, {
      cwd: this.root,
      encoding: null,
      windowsHide: true,
      maxBuffer,
    });
    if (!allowFailure && result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed with exit ${result.status}`);
    }
    return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr ?? Buffer.alloc(0) };
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

  changedBlobs(baseCommit, candidateCommit) {
    const blobs = [];
    for (const relativePath of this.diffNames(baseCommit, candidateCommit)) {
      const tree = this.runBuffer(["ls-tree", "-z", candidateCommit, "--", relativePath]).stdout;
      if (!tree.length) continue;
      const tabIndex = tree.indexOf(0x09);
      invariant(tabIndex > 0, `Git tree entry is malformed: ${relativePath}`, "CANDIDATE_BLOB_UNSCANNABLE");
      const header = tree.subarray(0, tabIndex).toString("utf8");
      const [mode, type, oid] = header.split(" ");
      invariant(type === "blob" && /^[a-f0-9]{40,64}$/.test(oid), `changed path is not a scannable Git blob: ${relativePath}`, "CANDIDATE_BLOB_UNSCANNABLE", { path: relativePath, mode, type });
      const bytes = this.runBuffer(["cat-file", "blob", oid], { maxBuffer: 256 * 1024 * 1024 }).stdout;
      blobs.push({ path: relativePath, mode, oid, bytes });
    }
    return blobs;
  }

  ignoredPaths() {
    const output = this.run(["-c", "core.quotepath=false", "ls-files", "--others", "--ignored", "--exclude-standard"]).stdout;
    return sortedUnique(output.split(/\r?\n/).map(normalizePath).filter(Boolean));
  }

  workspaceFiles() {
    const tracked = this.run(["-c", "core.quotepath=false", "ls-files", "--cached"]).stdout;
    const untracked = this.run(["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"]).stdout;
    const ignored = this.run(["-c", "core.quotepath=false", "ls-files", "--others", "--ignored", "--exclude-standard"]).stdout;
    return sortedUnique(`${tracked}\n${untracked}\n${ignored}`.split(/\r?\n/).map(normalizePath).filter(Boolean));
  }
}

class EventStore {
  #transactionAuthority;

  constructor({ stateDir, policy, clock, idFactory, transactionAuthority, validateEvents, monotonicHead }) {
    this.stateDir = stateDir;
    this.policy = policy;
    this.clock = clock;
    this.idFactory = idFactory;
    this.validateEvents = validateEvents;
    this.monotonicHead = monotonicHead;
    this.eventsPath = path.join(stateDir, EVENTS_FILE);
    this.lockPath = path.join(stateDir, LOCK_FILE);
    this.quarantinePath = path.join(stateDir, QUARANTINE_DIR);
    this.#transactionAuthority = transactionAuthority;
  }

  parse(text, { validateSemantics = true } = {}) {
    if (!text.trim()) return [];
    const rawLines = text.split(/\r?\n/);
    while (rawLines.at(-1) === "") rawLines.pop();
    invariant(rawLines.every((line) => line.trim().length > 0), "event log contains a blank interior line", "EVENT_LOG_BLANK_LINE");
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
      invariant(event.integrity_algorithm === "SHA256_CHAIN+ED25519_RECEIPTS+EXTERNAL_MONOTONIC_HEAD", `event ${index + 1} uses an unsupported integrity model`, "EVENT_INTEGRITY_ALGORITHM_INVALID");
      invariant(event.previous_event_hash === previousHash, `event hash chain breaks at line ${index + 1}`, "EVENT_HASH_CHAIN_INVALID");
      invariant(hashEvent(event) === event.event_hash, `event hash mismatch at line ${index + 1}`, "EVENT_HASH_INVALID");
      events.push(event);
      previousHash = event.event_hash;
    }
    if (validateSemantics) this.validateEvents(events);
    return events;
  }

  localHead(events) {
    return {
      stream_id: this.policy.monotonic_head.stream_id,
      event_count: events.length,
      event_hash: events.at(-1)?.event_hash ?? null,
    };
  }

  verifyMonotonicHead(events, { allowLocalAhead = false } = {}) {
    const local = this.localHead(events);
    if (!this.monotonicHead) {
      invariant(events.length === 0, "a non-empty event log requires the registered external monotonic head provider", "ENVIRONMENT_APPROVAL_REQUIRED", { reason: "MONOTONIC_HEAD_PROVIDER_UNAVAILABLE" });
      return { local, external: null, synchronized: true };
    }
    const external = this.monotonicHead.read();
    invariant(local.event_count >= external.event_count, "local event log was truncated behind the external monotonic head", "EVENT_LOG_ROLLBACK_DETECTED", { local, external });
    if (local.event_count === external.event_count) {
      invariant(local.event_hash === external.event_hash, "local event log head differs from the external monotonic head", "EVENT_HEAD_MISMATCH", { local, external });
      return { local, external, synchronized: true };
    }
    const anchoredPrefixHash = external.event_count === 0 ? null : events[external.event_count - 1]?.event_hash;
    invariant(anchoredPrefixHash === external.event_hash, "external monotonic head is not a prefix of the local log", "EVENT_HEAD_MISMATCH", { local, external, anchored_prefix_hash: anchoredPrefixHash });
    invariant(allowLocalAhead, "local event log is ahead of the external monotonic head and requires resume reconciliation", "EVENT_HEAD_RECONCILIATION_REQUIRED", { local, external });
    return { local, external, synchronized: false, reconcilable: true };
  }

  read({ verifyExternalHead = true } = {}) {
    const events = fs.existsSync(this.eventsPath) ? this.parse(fs.readFileSync(this.eventsPath, "utf8"), { validateSemantics: false }) : [];
    if (verifyExternalHead) this.verifyMonotonicHead(events);
    this.validateEvents(events);
    return events;
  }

  reconcileMonotonicHead(authority) {
    invariant(authority === this.#transactionAuthority, "only ProjectOrchestrator may reconcile the event head", "EVENT_WRITE_FORBIDDEN");
    const events = this.read({ verifyExternalHead: false });
    if (!events.length && !this.monotonicHead) return null;
    invariant(this.monotonicHead, "external monotonic head provider is unavailable", "ENVIRONMENT_APPROVAL_REQUIRED", { reason: "MONOTONIC_HEAD_PROVIDER_UNAVAILABLE" });
    const local = this.localHead(events);
    const external = this.monotonicHead.read();
    invariant(local.event_count >= external.event_count, "local event log was truncated behind the external monotonic head", "EVENT_LOG_ROLLBACK_DETECTED", { local, external });
    if (local.event_count === external.event_count) {
      invariant(local.event_hash === external.event_hash, "local event log head differs from the external monotonic head", "EVENT_HEAD_MISMATCH", { local, external });
      return null;
    }
    const anchoredPrefixHash = external.event_count === 0 ? null : events[external.event_count - 1]?.event_hash;
    invariant(anchoredPrefixHash === external.event_hash, "external monotonic head is not a prefix of the local log", "EVENT_HEAD_MISMATCH", { local, external, anchored_prefix_hash: anchoredPrefixHash });
    this.monotonicHead.compareAndSet(external, local);
    return { from: external, to: local };
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
        if (Date.now() - stats.mtimeMs > staleMilliseconds && (!observed || !this.lockOwnerIsAlive(observed))) {
          const observedToken = observed?.nonce ?? "corrupt";
          const stalePath = `${this.lockPath}.stale.${observedToken}.${crypto.randomBytes(6).toString("hex")}`;
          try {
            fs.renameSync(this.lockPath, stalePath);
            const movedStats = fs.statSync(stalePath);
            let moved = null;
            try {
              moved = JSON.parse(fs.readFileSync(stalePath, "utf8"));
            } catch {
              moved = null;
            }
            const replacementIsLive = moved && (Date.now() - movedStats.mtimeMs <= staleMilliseconds || this.lockOwnerIsAlive(moved));
            if ((observed && moved?.nonce !== observed.nonce) || (!observed && replacementIsLive)) {
              if (!fs.existsSync(this.lockPath)) fs.renameSync(stalePath, this.lockPath);
              invariant(false, "stale lock ownership changed during recovery", "LOCK_OWNERSHIP_CHANGED");
            }
            if (!moved) {
              fs.mkdirSync(this.quarantinePath, { recursive: true });
              fs.renameSync(stalePath, path.join(this.quarantinePath, path.basename(stalePath)));
            } else {
              fs.unlinkSync(stalePath);
            }
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
      let completeJson = true;
      try {
        JSON.parse(tail);
      } catch {
        completeJson = false;
      }
      if (completeJson) {
        const events = this.parse(text);
        this.verifyMonotonicHead(events, { allowLocalAhead: true });
        const descriptor = fs.openSync(this.eventsPath, "a");
        try {
          fs.writeSync(descriptor, "\n", null, "utf8");
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
        return {
          complete_tail_newline_added: true,
          complete_tail_sha256: sha256(tail),
          complete_tail_bytes: Buffer.byteLength(tail, "utf8"),
        };
      }
      if (prefix.trim()) this.verifyMonotonicHead(this.parse(prefix), { allowLocalAhead: true });
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
    } finally {
      this.releaseLock(owner);
    }
  }

  transact(authority, buildDrafts) {
    invariant(authority === this.#transactionAuthority, "only ProjectOrchestrator may append events", "EVENT_WRITE_FORBIDDEN");
    const owner = this.acquireLock();
    try {
      const existingBytes = fs.existsSync(this.eventsPath) ? fs.readFileSync(this.eventsPath) : Buffer.alloc(0);
      const needsSeparator = existingBytes.length > 0 && existingBytes.at(-1) !== 0x0a;
      const events = this.read();
      const drafts = buildDrafts(events) ?? [];
      invariant(Array.isArray(drafts), "event transaction must return an array", "EVENT_TRANSACTION_INVALID");
      if (!drafts.length) return [];
      invariant(this.monotonicHead, "event append requires the registered external monotonic head provider", "ENVIRONMENT_APPROVAL_REQUIRED", { reason: "MONOTONIC_HEAD_PROVIDER_UNAVAILABLE" });
      let previousHash = events.at(-1)?.event_hash ?? null;
      const finalized = drafts.map((draft) => {
        const event = {
          ...draft,
          event_id: draft.event_id ?? this.idFactory(),
          timestamp: draft.timestamp ?? this.clock().toISOString(),
          integrity_algorithm: "SHA256_CHAIN+ED25519_RECEIPTS+EXTERNAL_MONOTONIC_HEAD",
          previous_event_hash: previousHash,
        };
        event.event_hash = hashEvent(event);
        previousHash = event.event_hash;
        return event;
      });
      this.validateEvents([...events, ...finalized]);
      fs.mkdirSync(this.stateDir, { recursive: true });
      const fileDescriptor = fs.openSync(this.eventsPath, "a", 0o600);
      try {
        if (needsSeparator) fs.writeSync(fileDescriptor, "\n", null, "utf8");
        for (const event of finalized) fs.writeSync(fileDescriptor, `${JSON.stringify(event)}\n`, null, "utf8");
        fs.fsyncSync(fileDescriptor);
      } finally {
        fs.closeSync(fileDescriptor);
      }
      this.monotonicHead.compareAndSet(this.localHead(events), this.localHead([...events, ...finalized]));
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

  #platformTrust;

  #monotonicHead;

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
    platformTrust = null,
    monotonicHead = null,
    testControlOverrides = null,
    authority = null,
  } = {}) {
    const internalTest = authority === SELF_TEST_AUTHORITY;
    const injected = policy || router || git || clock || idFactory || platformTrust || monotonicHead || testControlOverrides || stateDir;
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
    this.#testControlOverrides = testControlOverrides;
    this.#internalTest = internalTest;
    this.#platformTrust = platformTrust ?? platformTrustFromPolicy(this.policy, this.root, this.clock);
    this.#monotonicHead = monotonicHead ?? monotonicHeadFromPolicy(this.policy, this.root);
    this.#storeAuthority = Symbol("project-orchestrator-event-writer");
    this.validatePolicy();
    const store = new EventStore({
      stateDir: this.stateDir,
      policy: this.policy,
      clock: this.clock,
      idFactory: this.idFactory,
      transactionAuthority: this.#storeAuthority,
      validateEvents: (events) => this.validateEventLog(events),
      monotonicHead: this.#monotonicHead,
    });
    Object.defineProperty(this, "store", { value: store, writable: false, configurable: false, enumerable: true });
  }

  validatePolicy() {
    invariant(this.policy.schema_version === "g07-autonomy-policy/v4", "unsupported autonomy policy", "POLICY_INVALID");
    invariant(this.policy.control_anchor === "G07::AUTONOMY", "policy is not bound to G07::AUTONOMY", "POLICY_INVALID");
    invariant(["G07_A_CONTROL_PLANE_ONLY", "G07_APPROVED_INTEGRATION"].includes(this.policy.phase), "unknown autonomy phase", "POLICY_PHASE_INVALID");
    invariant(this.policy.g07_gate_required === "APPROVED", "policy must require creator-approved G07", "POLICY_GATE_INVALID");
    invariant(this.policy.concurrency.max_writers === 1, "policy must allow exactly one writer", "POLICY_INVALID");
    invariant(this.policy.concurrency.max_read_only_reviewers === 2, "policy must allow exactly two read-only reviewers", "POLICY_INVALID");
    invariant(this.policy.retry_policy.max_rework === 3, "policy must use three rework attempts", "POLICY_INVALID");
    invariant(this.policy.retry_policy.max_replan === 2, "policy must use two Replan attempts", "POLICY_INVALID");
    invariant(this.policy.retry_policy.critical_path_on_exhaustion === "CREATOR_REQUIRED", "critical path exhaustion must require the creator", "POLICY_INVALID");
    invariant(this.policy.budget.notify_ratio === 0.8 && this.policy.budget.hard_stop_ratio === 1, "budget thresholds must be 80% and 100%", "POLICY_INVALID");
    invariant(this.policy.budget.limits_source === "REGISTERED_POLICY"
      && this.policy.budget.usage_source === "PLATFORM_METERING_RECEIPT"
      && this.policy.budget.run_override_allowed === false, "budget authority must come only from registered policy and platform metering", "POLICY_BUDGET_AUTHORITY_INVALID");
    invariant(sameStringSet(this.policy.hard_stop_actions, MANDATORY_HARD_STOP_ACTIONS), "policy hard-stop action set drifted", "POLICY_HARD_STOP_INVALID");
    invariant(sameStringSet(this.policy.forbidden_automatic_actions, MANDATORY_FORBIDDEN_AUTOMATIC_ACTIONS), "policy forbidden automatic action set drifted", "POLICY_HARD_STOP_INVALID");
    invariant(this.policy.event_integrity?.chain_algorithm === "SHA-256"
      && this.policy.event_integrity?.authority === "ED25519_PLATFORM_RECEIPTS"
      && this.policy.event_integrity?.local_symmetric_key_is_authority === false
      && this.policy.event_integrity?.external_monotonic_head_required === true, "event integrity policy is incomplete", "POLICY_INTEGRITY_INVALID");
    invariant(["UNAVAILABLE", "ED25519_FILE"].includes(this.policy.platform_trust?.provider)
      && this.policy.platform_trust?.receipt_version === PLATFORM_RECEIPT_VERSION
      && this.policy.platform_trust?.private_key_material_in_workspace === false, "platform trust policy is invalid", "POLICY_PLATFORM_TRUST_INVALID");
    invariant(["UNAVAILABLE", "EXTERNAL_COMMAND"].includes(this.policy.monotonic_head?.provider)
      && typeof this.policy.monotonic_head?.stream_id === "string"
      && this.policy.monotonic_head.stream_id.length >= 8
      && this.policy.monotonic_head.command_outside_workspace_required === true
      && this.policy.monotonic_head.command_hash_rechecked_before_each_spawn === true, "external monotonic head policy is invalid", "POLICY_MONOTONIC_HEAD_INVALID");
    if (this.policy.monotonic_head.provider === "EXTERNAL_COMMAND") {
      invariant(path.isAbsolute(this.policy.monotonic_head.command_path ?? "")
        && isSha256(this.policy.monotonic_head.command_sha256), "external monotonic head command registration is incomplete", "POLICY_MONOTONIC_HEAD_INVALID");
      invariant(!pathInside(this.root, this.policy.monotonic_head.command_path), "external monotonic head command must be outside the role-writable workspace", "POLICY_MONOTONIC_HEAD_INVALID");
    }
    invariant(["UNAVAILABLE", "PLATFORM_DIRECTORY"].includes(this.policy.receipt_inbox?.provider)
      && Number.isInteger(this.policy.receipt_inbox?.max_file_bytes)
      && this.policy.receipt_inbox.max_file_bytes > 0, "trusted receipt inbox policy is invalid", "POLICY_RECEIPT_INBOX_INVALID");
    if (this.policy.receipt_inbox.provider === "PLATFORM_DIRECTORY") {
      invariant(path.isAbsolute(this.policy.receipt_inbox.directory ?? ""), "trusted receipt inbox must be an absolute external directory", "POLICY_RECEIPT_INBOX_INVALID");
    }
    invariant(this.policy.workspace_capability?.required_for_writer === true
      && this.policy.workspace_capability?.receipt_kind === "WORKSPACE_CAPABILITY"
      && this.policy.workspace_capability?.enforcement === "PLATFORM_SANDBOX"
      && Array.isArray(this.policy.workspace_capability?.denied_patterns)
      && this.policy.workspace_capability.denied_patterns.includes(".autonomy/**")
      && this.policy.workspace_capability.denied_patterns.includes(".env"), "workspace capability policy is incomplete", "POLICY_WORKSPACE_CAPABILITY_INVALID");
    invariant(sameStringSet(this.policy.role_lifecycle?.primary_task_writer_roles, ["coder", "prompt_editor", "auditor"])
      && this.policy.role_lifecycle.auditor_owner_requires_independent_auditor_and_reviewer === true
      && this.policy.role_lifecycle.slice_gate_requires_read_only_lease === true
      && this.policy.role_lifecycle.slice_gate_report_must_enter_event_chain === true
      && this.policy.role_lifecycle.slice_gate_execution_receipt_required === true, "role lifecycle policy is incomplete", "POLICY_ROLE_LIFECYCLE_INVALID");
    invariant(this.policy.secret_scan?.version === "G07_CANDIDATE_BLOBS_V1"
      && this.policy.secret_scan?.scan_binary_blobs === true
      && this.policy.secret_scan?.oversize_result === "BLOCKING"
      && Number.isInteger(this.policy.secret_scan?.max_blob_bytes)
      && this.policy.secret_scan.max_blob_bytes > 0, "candidate blob secret scan policy is invalid", "POLICY_SECRET_SCAN_INVALID");

    const gate = this.controlGateSnapshot();
    if (this.policy.phase === "G07_A_CONTROL_PLANE_ONLY") {
      invariant(gate.g07_gate === "PENDING", "G07-A control-plane-only phase requires G07_GATE=PENDING", "POLICY_GATE_INVALID");
      invariant(this.policy.product_task_execution_allowed === false, "G07-A phase cannot enable product Task execution", "POLICY_PHASE_INVALID");
    } else {
      invariant(gate.g07_gate === "APPROVED" && isSha256(gate.g07_approval_evidence_sha256), "approved integration phase requires registered creator Gate evidence hash", "POLICY_GATE_INVALID");
      invariant(this.policy.product_task_execution_allowed === true, "approved integration phase must explicitly enable product Task execution", "POLICY_PHASE_INVALID");
      invariant(this.#platformTrust, "approved integration requires an available registered platform trust provider", "ENVIRONMENT_APPROVAL_REQUIRED");
      invariant(this.#monotonicHead, "approved integration requires an external monotonic event head provider", "ENVIRONMENT_APPROVAL_REQUIRED", { reason: "MONOTONIC_HEAD_PROVIDER_UNAVAILABLE" });
      invariant(this.policy.receipt_inbox.provider === "PLATFORM_DIRECTORY", "approved integration requires a trusted external receipt inbox", "ENVIRONMENT_APPROVAL_REQUIRED", { reason: "TRUSTED_RECEIPT_INBOX_UNAVAILABLE" });
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
    platformReceipts = [],
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
      event_version: "g07-autonomy-event/v4",
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
      platform_receipts: platformReceipts,
      integrity_algorithm: "SHA256_CHAIN+ED25519_RECEIPTS+EXTERNAL_MONOTONIC_HEAD",
      previous_event_hash: null,
      event_hash: null,
    };
  }

  initialVerifiedEvidence(task) {
    if (!this.#internalTest || task.values["状态"] !== "VERIFIED") return null;
    const evidence = this.#testControlOverrides?.bootstrap_verified_evidence?.[task.id] ?? null;
    return isSha256(evidence) ? evidence : null;
  }

  requirePlatformTrust(reason = "PLATFORM_TRUST_PROVIDER_UNAVAILABLE") {
    invariant(this.#platformTrust, "the registered platform trust provider is unavailable", "ENVIRONMENT_APPROVAL_REQUIRED", { reason });
    return this.#platformTrust;
  }

  readTrustedJson(fileArgument, flag) {
    invariant(fileArgument, `${flag} is required`, "CLI_ARGUMENT_INVALID");
    const inbox = this.policy.receipt_inbox;
    invariant(inbox.provider === "PLATFORM_DIRECTORY", "the trusted platform receipt inbox is unavailable", "ENVIRONMENT_APPROVAL_REQUIRED", { reason: "TRUSTED_RECEIPT_INBOX_UNAVAILABLE" });
    const inboxRoot = path.resolve(inbox.directory);
    const candidate = path.isAbsolute(fileArgument) ? path.resolve(fileArgument) : path.resolve(inboxRoot, fileArgument);
    invariant(pathInside(inboxRoot, candidate), `${flag} must resolve inside the registered receipt inbox`, "TRUSTED_FILE_BOUNDARY_VIOLATION");
    if (!inbox.allow_subdirectories) invariant(path.dirname(candidate) === inboxRoot, `${flag} cannot use a receipt subdirectory`, "TRUSTED_FILE_BOUNDARY_VIOLATION");
    const basename = path.basename(candidate).toLowerCase();
    invariant(basename.endsWith(".json") && basename !== ".env" && !basename.startsWith(".env."), `${flag} must reference a receipt JSON file`, "CREDENTIAL_ACCESS");
    let checked;
    try {
      checked = assertRegularFileWithoutLinks(candidate, { boundaryRoot: inboxRoot, maxBytes: inbox.max_file_bytes, purpose: flag });
    } catch (error) {
      if (error.code) throw error;
      invariant(false, `${flag} receipt file is unavailable`, "TRUSTED_FILE_UNAVAILABLE");
    }
    const realInbox = fs.realpathSync.native(inboxRoot);
    const realFile = fs.realpathSync.native(checked.absolute);
    invariant(pathInside(realInbox, realFile), `${flag} realpath escapes the registered receipt inbox`, "TRUSTED_FILE_BOUNDARY_VIOLATION");
    return readJsonFile(realFile);
  }

  verifyPlatformReceipt(receipt, kind, claims, { at = this.clock() } = {}) {
    return this.requirePlatformTrust().verify(receipt, kind, claims, { at });
  }

  reportCore(report) {
    const core = clone(report);
    delete core.identity_attestation;
    delete core.report_receipt;
    return core;
  }

  roleIdentityClaims(report) {
    const signed = report.identity_attestation?.claims ?? {};
    return {
      principal_id: signed.principal_id,
      session_id: signed.session_id,
      role: report.role,
      task_id: report.task_id,
      slice_id: report.slice_id ?? null,
      attempt_id: report.attempt_id,
      base_commit: report.base_commit,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
    };
  }

  verifyReportTrust(report, { at = this.clock() } = {}) {
    const identityClaims = this.roleIdentityClaims(report);
    invariant(typeof identityClaims.principal_id === "string" && identityClaims.principal_id.length > 0
      && typeof identityClaims.session_id === "string" && identityClaims.session_id.length > 0, "role identity receipt lacks a trusted principal/session", "IDENTITY_ATTESTATION_INVALID");
    const identity = this.verifyPlatformReceipt(report.identity_attestation, "ROLE_IDENTITY", identityClaims, { at });
    const reportClaims = {
      role: report.role,
      task_id: report.task_id,
      slice_id: report.slice_id ?? null,
      attempt_id: report.attempt_id,
      base_commit: report.base_commit,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
      report_sha256: sha256(stableJson(this.reportCore(report))),
    };
    const signedReport = this.verifyPlatformReceipt(report.report_receipt, "ROLE_REPORT", reportClaims, { at });
    return {
      role: report.role,
      principal_id: identityClaims.principal_id,
      session_id: identityClaims.session_id,
      identity_receipt_id: identity.receipt_id,
      report_receipt_id: signedReport.receipt_id,
      evidence_hash: sha256(stableJson([identity.evidence_hash, signedReport.evidence_hash])),
    };
  }

  leaseReceiptClaims({ runId, taskId, sliceId = null, attemptId, role, actorId, mode, leaseId, acquiredAt, expiresAt, baseCommit, candidateCommit, contextHash, fromStatus, toStatus, workspaceCapabilityReceiptId = null }) {
    return {
      autonomy_run_id: runId,
      task_id: taskId,
      slice_id: sliceId,
      attempt_id: attemptId,
      role,
      actor_id: actorId,
      mode,
      lease_id: leaseId,
      acquired_at: acquiredAt,
      expires_at: expiresAt,
      base_commit: baseCommit,
      candidate_commit: candidateCommit,
      context_hash: contextHash,
      from_status: fromStatus,
      to_status: toStatus,
      workspace_capability_receipt_id: workspaceCapabilityReceiptId,
      branch: this.git.branch(),
      worktree: this.git.worktree(),
    };
  }

  workspaceCapabilityClaims({ runId, taskId, attemptId, role, actorId, principalId, sessionId, capabilityId, sandboxId, sandboxInstanceSha256, baseCommit, contextHash, writeScopeSha256 }) {
    return {
      autonomy_run_id: runId,
      task_id: taskId,
      attempt_id: attemptId,
      role,
      actor_id: actorId,
      principal_id: principalId,
      session_id: sessionId,
      capability_id: capabilityId,
      sandbox_id: sandboxId,
      sandbox_instance_sha256: sandboxInstanceSha256,
      base_commit: baseCommit,
      context_hash: contextHash,
      branch: this.git.branch(),
      worktree: this.git.worktree(),
      write_scope_sha256: writeScopeSha256,
      denied_patterns_sha256: sha256(stableJson(this.policy.workspace_capability.denied_patterns)),
      enforcement: this.policy.workspace_capability.enforcement,
      ignored_paths_unchanged: true,
      state_directory_denied: true,
      receipt_inbox_denied: true,
    };
  }

  transitionReceiptClaims({ runId, taskId, attemptId, role, baseCommit, candidateCommit, contextHash, fromStatus, toStatus }) {
    return {
      autonomy_run_id: runId,
      task_id: taskId,
      attempt_id: attemptId,
      role,
      base_commit: baseCommit,
      candidate_commit: candidateCommit,
      context_hash: contextHash,
      from_status: fromStatus,
      to_status: toStatus,
    };
  }

  taskBoundaryClaims(report) {
    const task = this.router.taskById.get(report.task_id);
    return {
      task_id: report.task_id,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
      category: report.decision?.category,
      proposal_sha256: report.decision?.proposal_sha256,
      classification: "TECHNICAL_ONLY",
      business_result_sha256: sha256(task.values["业务结果"]),
      depends_on_sha256: sha256(task.values.depends_on),
      owner_sha256: sha256(task.values["角色"]),
      write_scope_sha256: sha256(task.values.write_scope),
      gate_snapshot_sha256: sha256(stableJson({
        g04_gate: this.router.gates.G04_GATE,
        g04_revision: this.router.gates.G04_REVISION,
        g07_gate: this.router.gates.G07_GATE,
      })),
    };
  }

  verifyHistoricalTaskBoundary(report, at) {
    const receipt = report.decision?.boundary_receipt;
    const claims = receipt?.claims;
    invariant(claims
      && claims.task_id === report.task_id
      && claims.candidate_commit === report.candidate_commit
      && claims.context_hash === report.context_hash
      && claims.category === report.decision?.category
      && claims.proposal_sha256 === report.decision?.proposal_sha256
      && claims.classification === "TECHNICAL_ONLY"
      && ["business_result_sha256", "depends_on_sha256", "owner_sha256", "write_scope_sha256", "gate_snapshot_sha256"].every((field) => isSha256(claims[field])), "historical Architect boundary receipt is malformed", "EVENT_ARCHITECT_BOUNDARY_INVALID");
    return this.verifyPlatformReceipt(receipt, "ARCHITECT_BOUNDARY", claims, { at });
  }

  commandReceiptClaims(report, entry) {
    return {
      task_id: report.task_id,
      attempt_id: report.attempt_id,
      candidate_commit: report.candidate_commit,
      command: entry.command,
      exit_code: entry.exit_code,
      stdout_sha256: entry.stdout_sha256,
      regression_artifact_sha256: entry.regression_artifact_sha256,
    };
  }

  sliceGateCommand(contextFacts) {
    return `SLICE_GATE_USER_ENTRY:${contextFacts.slice_id}:${contextFacts.user_entry_acceptance_sha256}:${contextFacts.completion_boundary_sha256}`;
  }

  sliceGateExecutionClaims(report, entry, contextFacts) {
    return {
      slice_id: report.slice_id,
      attempt_id: report.attempt_id,
      base_commit: report.base_commit,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
      command: entry.command,
      user_entry_acceptance_sha256: contextFacts.user_entry_acceptance_sha256,
      completion_boundary_sha256: contextFacts.completion_boundary_sha256,
      task_evidence_sha256: sha256(stableJson(contextFacts.task_evidence)),
      exit_code: entry.exit_code,
      stdout_sha256: entry.stdout_sha256,
      regression_artifact_sha256: entry.regression_artifact_sha256,
      read_only: true,
    };
  }

  verifySliceGateAcceptance(report, contextFacts, { at = this.clock() } = {}) {
    const commands = report.acceptance?.commands ?? [];
    invariant(commands.length === 1, "slice gate requires exactly one platform-executed user-entry acceptance", "SLICE_GATE_EVIDENCE_INCOMPLETE");
    const entry = commands[0];
    invariant(entry.command === this.sliceGateCommand(contextFacts)
      && Number.isInteger(entry.exit_code)
      && isSha256(entry.stdout_sha256)
      && isSha256(entry.regression_artifact_sha256), "slice gate execution evidence is malformed or does not target the registered user entry", "SLICE_GATE_EVIDENCE_INVALID");
    invariant((report.acceptance?.diff_hash ?? null) === null
      && (report.acceptance?.scope_evidence_hash ?? null) === null
      && (report.acceptance?.secret_scan_evidence_hash ?? null) === null, "read-only slice gate cannot claim implementation diff/scope/secret evidence", "SLICE_GATE_EVIDENCE_INVALID");
    const receipt = this.verifyPlatformReceipt(entry.receipt, "SLICE_GATE_EXECUTION", this.sliceGateExecutionClaims(report, entry, contextFacts), { at });
    if (report.verdict === "PASS") invariant(entry.exit_code === 0, "slice gate PASS requires a successful platform execution", "SLICE_GATE_ACCEPTANCE_FAILED", { exit_code: entry.exit_code });
    return {
      receipt,
      summary: {
        command: entry.command,
        exit_code: entry.exit_code,
        stdout_sha256: entry.stdout_sha256,
        regression_artifact_sha256: entry.regression_artifact_sha256,
        receipt_id: receipt.receipt_id,
      },
    };
  }

  auditReceiptClaims(report, entry) {
    return {
      task_id: report.task_id,
      attempt_id: report.attempt_id,
      candidate_commit: report.candidate_commit,
      kind: entry.kind,
      passed: entry.passed,
      evidence_hash: entry.evidence_hash,
    };
  }

  reviewReceiptClaims(report) {
    return {
      task_id: report.task_id,
      attempt_id: report.attempt_id,
      candidate_commit: report.candidate_commit,
      checks_sha256: sha256(stableJson(report.checks ?? {})),
      diff_hash: report.scope?.diff_hash ?? null,
      secret_scan_evidence_hash: report.secret_scan?.evidence_hash ?? null,
    };
  }

  validateEventLog(events) {
    const states = new Map(this.router.tasks.map((task) => [task.id, {
      status: task.values["状态"],
      counters: emptyCounters(),
      failure_fingerprint: null,
      candidate_commit: null,
      context_hash: null,
      last_event_id: null,
      last_evidence: this.initialVerifiedEvidence(task),
    }]));
    const leases = new Map();
    const reports = new Map();
    const sliceGateReports = new Map();
    const eventIds = new Set();
    const receiptIds = new Set();
    let previousTimestamp = null;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      for (const field of REQUIRED_EVENT_FIELDS) {
        invariant(Object.hasOwn(event, field), `event ${index + 1} is missing ${field}`, "EVENT_SCHEMA_INVALID", { line: index + 1, field });
      }
      invariant(event.event_version === "g07-autonomy-event/v4", `event ${index + 1} uses an unsupported version`, "EVENT_SCHEMA_INVALID");
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
      invariant(Array.isArray(event.platform_receipts), `event ${event.event_id} platform_receipts must be an array`, "EVENT_SCHEMA_INVALID");
      const trackReceipt = (receipt) => {
        invariant(receipt?.receipt_id && !receiptIds.has(receipt.receipt_id), `platform receipt ${receipt?.receipt_id ?? "MISSING"} was reused`, "PLATFORM_RECEIPT_REUSED");
        receiptIds.add(receipt.receipt_id);
      };
      for (const receipt of event.platform_receipts) trackReceipt(receipt);

      if (!event.task_id && event.role === "slice_gate_runner") {
        invariant(event.slice_id && this.router.sliceRows.some((row) => row.values["切片"] === event.slice_id), "slice gate event has an unknown slice", "EVENT_SLICE_INVALID");
        invariant(event.from_status === null && event.to_status === null, "slice gate event cannot carry Task status", "EVENT_STATE_INVALID");
        if (event.event_type === "SLICE_GATE_LEASE_ACQUIRED") {
          invariant(event.lease?.action === "ACQUIRE" && event.lease.mode === "READ_ONLY"
            && event.lease.role === "slice_gate_runner" && event.lease.slice_id === event.slice_id, "slice gate lease is malformed", "EVENT_LEASE_INVALID");
          invariant(!leases.has(event.lease.lease_id)
            && [...leases.values()].filter((lease) => lease.mode === "READ_ONLY").length < this.policy.concurrency.max_read_only_reviewers, "slice gate lease exceeds independent reviewer concurrency", "EVENT_REVIEW_CONCURRENCY_INVALID");
          const facts = event.payload?.slice_context;
          const expectedEvidence = this.router.tasks
            .filter((task) => task.values["切片"] === event.slice_id)
            .sort((left, right) => left.id.localeCompare(right.id, "en"))
            .map((task) => {
              const taskState = states.get(task.id);
              return { task_id: task.id, status: taskState.status, evidence_hash: taskState.last_evidence, candidate_commit: taskState.candidate_commit };
            });
          invariant(facts?.schema_version === "g07-slice-gate-context/v1"
            && facts.slice_id === event.slice_id
            && facts.branch === this.policy.integration_branch
            && stableJson(facts.task_evidence) === stableJson(expectedEvidence)
            && expectedEvidence.length > 0
            && expectedEvidence.every((item) => item.status === "VERIFIED" && isSha256(item.evidence_hash))
            && sha256(stableJson(facts)) === event.context_hash, "slice gate lease is not bound to the full VERIFIED Task evidence set", "EVENT_SLICE_CONTEXT_INVALID");
          const receipt = event.platform_receipts.find((item) => item.kind === "LEASE_GRANT");
          this.verifyPlatformReceipt(receipt, "LEASE_GRANT", this.leaseReceiptClaims({
            runId: event.autonomy_run_id,
            taskId: null,
            sliceId: event.slice_id,
            attemptId: event.attempt_id,
            role: event.role,
            actorId: event.lease.actor_id,
            mode: event.lease.mode,
            leaseId: event.lease.lease_id,
            acquiredAt: event.lease.acquired_at,
            expiresAt: event.lease.expires_at,
            baseCommit: event.base_commit,
            candidateCommit: event.candidate_commit,
            contextHash: event.context_hash,
            fromStatus: null,
            toStatus: null,
          }), { at: event.timestamp });
          leases.set(event.lease.lease_id, { ...event.lease, task_id: null, slice_id: event.slice_id });
        } else if (event.event_type === "SLICE_GATE_REPORT_RECORDED") {
          const report = event.payload?.report;
          const active = [...leases.values()].find((lease) => lease.slice_id === event.slice_id
            && lease.role === "slice_gate_runner"
            && lease.actor_id === report?.actor_id
            && lease.attempt_id === report?.attempt_id);
          invariant(active && event.lease?.action === "RELEASE" && event.lease.lease_id === active.lease_id, "slice gate report has no matching active lease", "EVENT_REPORT_LEASE_INVALID");
          invariant(report.task_id === null && report.slice_id === event.slice_id
            && report.role === "slice_gate_runner"
            && ["PASS", "FAIL"].includes(report.verdict)
            && report.base_commit === active.base_commit
            && report.candidate_commit === active.candidate_commit
            && report.context_hash === active.context_hash
            && event.base_commit === active.base_commit
            && event.candidate_commit === active.candidate_commit
            && event.context_hash === active.context_hash, "slice gate report is detached from its lease/context", "EVENT_REPORT_INVALID");
          const acquiredEvent = [...events.slice(0, index)].reverse().find((prior) => prior.event_type === "SLICE_GATE_LEASE_ACQUIRED"
            && prior.lease?.lease_id === active.lease_id);
          const contextFacts = acquiredEvent?.payload?.slice_context;
          invariant(contextFacts && sha256(stableJson(contextFacts)) === event.context_hash, "slice gate report lost its signed lease context", "EVENT_SLICE_CONTEXT_INVALID");
          const gateEvidence = this.verifySliceGateAcceptance(report, contextFacts, { at: event.timestamp });
          const eventExecutionReceipt = event.platform_receipts.find((receipt) => receipt.kind === "SLICE_GATE_EXECUTION");
          invariant(stableJson(eventExecutionReceipt) === stableJson(report.acceptance.commands[0].receipt)
            && event.payload?.slice_gate_execution_receipt_id === gateEvidence.receipt.receipt_id
            && stableJson(event.acceptance) === stableJson({ ...emptyAcceptance(), commands: [gateEvidence.summary] }), "slice gate event does not preserve its mechanical execution evidence", "EVENT_SLICE_EVIDENCE_INVALID");
          trackReceipt(report.identity_attestation);
          trackReceipt(report.report_receipt);
          const trustedReport = this.verifyReportTrust(report, { at: event.timestamp });
          invariant(stableJson(event.payload?.trusted_report) === stableJson(trustedReport), "slice gate trusted-report projection was tampered", "EVENT_REPORT_TRUST_INVALID");
          const priorIdentities = events.slice(0, index)
            .filter((prior) => prior.task_id && prior.slice_id === event.slice_id && prior.event_type === "ROLE_REPORT_RECORDED")
            .map((prior) => prior.payload?.trusted_report)
            .filter(Boolean);
          invariant(priorIdentities.every((identity) => identity.principal_id !== trustedReport.principal_id
            && identity.session_id !== trustedReport.session_id)
            && stableJson(event.payload?.independent_from ?? []) === stableJson(priorIdentities), "slice gate runner independence evidence is invalid", "SELF_REVIEW_BLOCKED");
          leases.delete(active.lease_id);
        } else if (event.event_type === "SLICE_GATE_LEASE_EXPIRED") {
          const active = leases.get(event.lease?.lease_id);
          invariant(active?.slice_id === event.slice_id && event.lease.action === "EXPIRE"
            && Date.parse(event.timestamp) >= Date.parse(active.expires_at), "slice gate expiration does not target an expired active lease", "EVENT_LEASE_INVALID");
          leases.delete(active.lease_id);
        } else {
          invariant(false, `taskless slice gate event type ${event.event_type} is forbidden`, "EVENT_TYPE_INVALID");
        }
        continue;
      }

      if (!event.task_id) {
        invariant(["USAGE_RECORDED", "HARD_STOP", "EVENT_LOG_TAIL_RECOVERED"].includes(event.event_type), `taskless event type ${event.event_type} is forbidden`, "EVENT_TASK_REQUIRED");
        invariant(event.from_status === null && event.to_status === null && event.lease === null, `taskless event ${event.event_id} carries Task state`, "EVENT_STATE_INVALID");
        if (event.event_type === "USAGE_RECORDED") {
          const meter = event.platform_receipts.find((receipt) => receipt.kind === "USAGE_METER");
          this.verifyPlatformReceipt(meter, "USAGE_METER", {
            autonomy_run_id: event.autonomy_run_id,
            tokens: event.execution.tokens,
            time_ms: event.execution.time_ms,
            known_cost: event.execution.known_cost,
          }, { at: event.timestamp });
        }
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
        const expectedDependencies = this.router.taskGraph(this.router.taskById.get(event.task_id)).upstream
          .map((item) => ({ task_id: item.task_id, status: states.get(item.task_id)?.status }));
        invariant(expectedDependencies.every((item) => item.status === "VERIFIED")
          && stableJson(event.payload?.dependency_evidence ?? []) === stableJson(expectedDependencies), "TASK_UNLOCKED dependency evidence is not the live VERIFIED closure", "EVENT_DEPENDENCIES_INVALID");
        const receipt = event.platform_receipts.find((item) => item.kind === "TASK_UNLOCK");
        this.verifyPlatformReceipt(receipt, "TASK_UNLOCK", {
          autonomy_run_id: event.autonomy_run_id,
          task_id: event.task_id,
          from_status: event.from_status,
          to_status: event.to_status,
          context_hash: event.context_hash,
          dependency_evidence_sha256: sha256(stableJson(event.payload?.dependency_evidence ?? [])),
        }, { at: event.timestamp });
      } else if (event.event_type === "LEASE_ACQUIRED") {
        invariant(leaseAction === "ACQUIRE" && event.lease?.lease_id, "LEASE_ACQUIRED requires an ACQUIRE record", "EVENT_LEASE_INVALID");
        invariant(!leases.has(event.lease.lease_id), `duplicate lease ${event.lease.lease_id}`, "EVENT_LEASE_INVALID");
        invariant(event.lease.role === event.role && event.lease.attempt_id === event.attempt_id, "lease identity does not match event", "EVENT_LEASE_INVALID");
        invariant(event.lease.context_hash === event.context_hash && event.lease.base_commit === event.base_commit, "lease version does not match event", "EVENT_LEASE_INVALID");
        if (event.lease.mode === "WRITE") {
          invariant(["coder", "prompt_editor", "auditor"].includes(event.role)
            && this.taskOwnerRole(event.task_id) === event.role, "write lease role is not the registered Task owner", "EVENT_LEASE_INVALID");
          invariant(event.from_status === "READY" && event.to_status === "LEASED", "write lease must be READY -> LEASED", "EVENT_SEMANTICS_INVALID");
          invariant([...leases.values()].filter((lease) => lease.mode === "WRITE").length < 1, "semantic replay found two active writers", "EVENT_WRITER_CONCURRENCY_INVALID");
          const capability = event.platform_receipts.find((item) => item.kind === "WORKSPACE_CAPABILITY");
          const capabilityClaims = event.payload?.workspace_capability;
          invariant(capabilityClaims && capability?.receipt_id === event.lease.workspace_capability_receipt_id
            && capabilityClaims.task_id === event.task_id
            && capabilityClaims.attempt_id === event.attempt_id
            && capabilityClaims.context_hash === event.context_hash
            && capabilityClaims.base_commit === event.base_commit
            && capabilityClaims.branch === event.branch
            && capabilityClaims.worktree === event.worktree
            && capabilityClaims.enforcement === "PLATFORM_SANDBOX"
            && capabilityClaims.ignored_paths_unchanged === true
            && capabilityClaims.state_directory_denied === true
            && capabilityClaims.receipt_inbox_denied === true
            && typeof capabilityClaims.capability_id === "string"
            && capabilityClaims.capability_id.length >= 12
            && typeof capabilityClaims.sandbox_id === "string"
            && capabilityClaims.sandbox_id.length >= 8
            && isSha256(capabilityClaims.sandbox_instance_sha256)
            && event.lease.capability_principal_id === capabilityClaims.principal_id
            && event.lease.capability_session_id === capabilityClaims.session_id
            && isSha256(capabilityClaims.write_scope_sha256)
            && isSha256(capabilityClaims.denied_patterns_sha256), "writer lease lacks an exact platform workspace capability", "EVENT_WORKSPACE_CAPABILITY_INVALID");
          this.verifyPlatformReceipt(capability, "WORKSPACE_CAPABILITY", capabilityClaims, { at: event.timestamp });
        } else {
          invariant(event.lease.mode === "READ_ONLY", "unknown lease mode", "EVENT_LEASE_INVALID");
          invariant(["auditor", "reviewer", "architect"].includes(event.role), "read-only lease role is invalid", "EVENT_LEASE_INVALID");
          invariant(event.candidate_commit && event.candidate_commit === state.candidate_commit
            && event.lease.candidate_commit === state.candidate_commit, "read-only lease is detached from the projected candidate", "EVENT_LEASE_CANDIDATE_INVALID");
          invariant((event.from_status === "IMPLEMENTED" && event.to_status === "VERIFYING")
            || (event.from_status === "VERIFYING" && event.to_status === "VERIFYING")
            || (event.role === "architect" && event.from_status === "REPLAN" && event.to_status === "REPLAN"), "read-only lease status pair is invalid", "EVENT_SEMANTICS_INVALID");
          invariant([...leases.values()].filter((lease) => lease.mode === "READ_ONLY").length < 2, "semantic replay exceeded read-only review concurrency", "EVENT_REVIEW_CONCURRENCY_INVALID");
        }
        const receipt = event.platform_receipts.find((item) => item.kind === "LEASE_GRANT");
        this.verifyPlatformReceipt(receipt, "LEASE_GRANT", this.leaseReceiptClaims({
          runId: event.autonomy_run_id,
          taskId: event.task_id,
          attemptId: event.attempt_id,
          role: event.role,
          actorId: event.lease.actor_id,
          mode: event.lease.mode,
          leaseId: event.lease.lease_id,
          acquiredAt: event.lease.acquired_at,
          expiresAt: event.lease.expires_at,
          baseCommit: event.base_commit,
          candidateCommit: event.candidate_commit,
          contextHash: event.context_hash,
          fromStatus: event.from_status,
          toStatus: event.to_status,
          workspaceCapabilityReceiptId: event.lease.workspace_capability_receipt_id ?? null,
        }), { at: event.timestamp });
        leases.set(event.lease.lease_id, { ...event.lease, task_id: event.task_id });
      } else if (event.event_type === "LEASE_EXPIRED") {
        invariant(leaseAction === "EXPIRE" && leases.has(event.lease?.lease_id), "LEASE_EXPIRED does not target an active lease", "EVENT_LEASE_INVALID");
        const expired = leases.get(event.lease.lease_id);
        invariant(expired.task_id === event.task_id, "expired lease Task mismatch", "EVENT_LEASE_INVALID");
        invariant(Date.parse(event.timestamp) >= Date.parse(expired.expires_at), "lease was expired before its signed lifetime ended", "EVENT_LEASE_NOT_EXPIRED");
        invariant((expired.mode === "WRITE" && ["LEASED", "IN_PROGRESS"].includes(event.from_status) && event.to_status === "READY")
          || (expired.mode === "READ_ONLY" && event.to_status === event.from_status), "expired lease transition is invalid", "EVENT_SEMANTICS_INVALID");
        leases.delete(event.lease.lease_id);
      } else if (event.event_type === "ROLE_REPORT_RECORDED") {
        const report = event.payload?.report;
        invariant(report && report.task_id === event.task_id && report.role === event.role, "role report payload does not match event", "EVENT_REPORT_INVALID");
        trackReceipt(report.identity_attestation);
        trackReceipt(report.report_receipt);
        for (const command of report.acceptance?.commands ?? []) if (command.receipt) trackReceipt(command.receipt);
        for (const evidence of report.evidence ?? []) if (evidence.receipt) trackReceipt(evidence.receipt);
        if (report.review_receipt) trackReceipt(report.review_receipt);
        const trustedReport = this.verifyReportTrust(report, { at: event.timestamp });
        invariant(stableJson(event.payload?.trusted_report) === stableJson(trustedReport), "role event trusted-report projection was tampered", "EVENT_REPORT_TRUST_INVALID");
        if (event.role === "architect") {
          const priorIdentities = ["coder", "auditor", "reviewer"]
            .map((role) => [...events.slice(0, index)].reverse().find((priorEvent) => priorEvent.event_type === "ROLE_REPORT_RECORDED"
              && priorEvent.task_id === event.task_id
              && priorEvent.role === role
              && priorEvent.candidate_commit === state.candidate_commit)?.payload?.trusted_report)
            .filter(Boolean);
          this.assertIndependentIdentities([...priorIdentities, trustedReport]);
          invariant(stableJson(event.payload?.architect_independent_from ?? []) === stableJson(priorIdentities), "Architect independence projection was tampered", "EVENT_REPORT_TRUST_INVALID");
        }
        if (!reports.has(event.task_id)) reports.set(event.task_id, []);
        reports.get(event.task_id).push(report);
        const activeForRole = [...leases.values()].find((lease) => lease.task_id === event.task_id
          && lease.role === event.role
          && lease.attempt_id === event.attempt_id);
        invariant(activeForRole, "role report has no matching active lease", "EVENT_REPORT_LEASE_INVALID");
        if (activeForRole.mode === "READ_ONLY") {
          invariant(report.candidate_commit === activeForRole.candidate_commit
            && event.candidate_commit === activeForRole.candidate_commit
            && state.candidate_commit === activeForRole.candidate_commit, "role report is detached from the active projected candidate", "EVENT_REPORT_CANDIDATE_INVALID");
        } else {
          invariant(report.candidate_commit && event.candidate_commit === report.candidate_commit
            && activeForRole.candidate_commit === null, "writer report must introduce exactly one candidate commit", "EVENT_REPORT_CANDIDATE_INVALID");
        }
        if (activeForRole.mode === "WRITE") {
          invariant(report.workspace_capability_receipt_id === activeForRole.workspace_capability_receipt_id
            && trustedReport.principal_id === activeForRole.capability_principal_id
            && trustedReport.session_id === activeForRole.capability_session_id, "writer report is not bound to its platform workspace capability", "EVENT_WORKSPACE_CAPABILITY_INVALID");
        }
        const allowedPair = (activeForRole.mode === "WRITE"
          && event.from_status === "IN_PROGRESS"
          && ["IN_PROGRESS", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status))
          || (activeForRole.mode === "READ_ONLY" && ["auditor", "reviewer"].includes(event.role)
            && event.from_status === "VERIFYING"
            && ["VERIFYING", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status))
          || (event.role === "architect"
            && event.from_status === "REPLAN"
            && ["READY", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status));
        invariant(allowedPair, "role report status pair is invalid", "EVENT_SEMANTICS_INVALID");
        if (event.role === "architect" && ["A", "B"].includes(report.decision?.category)) {
          trackReceipt(report.decision.boundary_receipt);
          this.verifyHistoricalTaskBoundary(report, event.timestamp);
        }
        if (event.role === "architect") {
          const category = report.decision?.category;
          invariant(["A", "B", "C", "D"].includes(category), "Architect event must carry Replan A/B/C/D", "EVENT_ARCHITECT_DECISION_INVALID");
          if (["A", "B"].includes(category)) {
            invariant(event.to_status === "READY" && event.decision_level === "ARCHITECT_AUTONOMOUS"
              && event.counters.rework === 0 && event.counters.replan === state.counters.replan, "Architect A/B event did not preserve the signed technical boundary", "EVENT_ARCHITECT_DECISION_INVALID");
          } else if (category === "C") {
            invariant(event.to_status === "CREATOR_REQUIRED" && event.decision_level === "CREATOR_REQUIRED"
              && Boolean(event.creator_required_reason), "Architect C must hard-stop at CREATOR_REQUIRED", "EVENT_ARCHITECT_DECISION_INVALID");
          } else {
            const expectedLevel = report.decision.environment_approval_required ? "ENVIRONMENT_APPROVAL_REQUIRED" : "BLOCKED_TECHNICAL";
            invariant(event.to_status === "BLOCKED" && event.decision_level === expectedLevel
              && isSha256(event.failure_fingerprint), "Architect D must remain technically/environment blocked with a failure fingerprint", "EVENT_ARCHITECT_DECISION_INVALID");
          }
        }
        if (activeForRole.mode === "WRITE") {
          if (report.verdict === "CREATOR_REQUIRED") {
            invariant(event.to_status === "CREATOR_REQUIRED" && event.decision_level === "CREATOR_REQUIRED"
              && Boolean(event.creator_required_reason), "writer CREATOR_REQUIRED report was remapped", "EVENT_WRITER_DECISION_INVALID");
          } else if (report.verdict === "BLOCKED") {
            invariant(event.to_status === "BLOCKED" && event.decision_level === "BLOCKED_TECHNICAL"
              && isSha256(event.failure_fingerprint), "writer BLOCKED report was remapped or lacks a fingerprint", "EVENT_WRITER_DECISION_INVALID");
          } else {
            invariant(event.to_status === event.from_status, "writer informational/implemented report cannot directly change Task state", "EVENT_WRITER_DECISION_INVALID");
          }
        }
      } else if (event.event_type === "TASK_TRANSITION") {
        invariant(TRANSITIONS.get(event.from_status)?.has(event.to_status), `illegal event transition ${event.from_status} -> ${event.to_status}`, "EVENT_SEMANTICS_INVALID");
        invariant(event.from_status !== "CREATOR_REQUIRED", "CREATOR_REQUIRED cannot be cleared by the Orchestrator", "EVENT_SEMANTICS_INVALID");
        invariant(!(event.from_status === "PLANNED" && event.to_status === "READY"), "unlock event is required", "EVENT_SEMANTICS_INVALID");
        invariant(!(event.from_status === "READY" && event.to_status === "LEASED"), "lease event is required", "EVENT_SEMANTICS_INVALID");
        invariant(!["VERIFIED", "REWORK", "REPLAN"].includes(event.to_status), "reserved transition event target", "EVENT_SEMANTICS_INVALID");
        if (event.to_status === "IMPLEMENTED") {
          const producerRole = this.taskOwnerRole(event.task_id);
          const producer = [...(reports.get(event.task_id) ?? [])].reverse().find((report) => report.role === producerRole
            && report.verdict === "IMPLEMENTED"
            && report.candidate_commit === event.candidate_commit);
          invariant(producer, "IMPLEMENTED transition has no structured primary executor report", "EVENT_PRIMARY_REPORT_MISSING");
        }
        if (event.from_status === "BLOCKED" && event.to_status === "READY") {
          invariant(event.payload?.failed_event_id === state.last_event_id
            && event.payload?.failure_fingerprint === state.failure_fingerprint
            && event.candidate_commit === state.candidate_commit
            && event.context_hash === state.context_hash, "BLOCK resolution does not close the current failed event/fingerprint/version", "EVENT_BLOCK_RESOLUTION_INVALID");
          const receipt = event.platform_receipts.find((item) => item.kind === "BLOCK_RESOLUTION");
          this.verifyPlatformReceipt(receipt, "BLOCK_RESOLUTION", {
            autonomy_run_id: event.autonomy_run_id,
            task_id: event.task_id,
            failed_event_id: event.payload?.failed_event_id,
            failure_fingerprint: event.payload?.failure_fingerprint,
            resolution_artifact_sha256: event.payload?.resolution_artifact_sha256,
            candidate_commit: event.candidate_commit,
            context_hash: event.context_hash,
          }, { at: event.timestamp });
        } else {
          const receipt = event.platform_receipts.find((item) => item.kind === "STATE_TRANSITION");
          this.verifyPlatformReceipt(receipt, "STATE_TRANSITION", this.transitionReceiptClaims({
            runId: event.autonomy_run_id,
            taskId: event.task_id,
            attemptId: event.attempt_id,
            role: event.role,
            baseCommit: event.base_commit,
            candidateCommit: event.candidate_commit,
            contextHash: event.context_hash,
            fromStatus: event.from_status,
            toStatus: event.to_status,
          }), { at: event.timestamp });
        }
      } else if (event.event_type === "EVIDENCE_VERIFIED") {
        invariant(event.from_status === "VERIFYING" && event.to_status === "VERIFIED", "EVIDENCE_VERIFIED must be VERIFYING -> VERIFIED", "EVENT_SEMANTICS_INVALID");
        invariant(event.verdicts?.auditor === "PASS" && event.verdicts?.reviewer === "APPROVE", "verified event lacks both independent verdicts", "EVENT_SEMANTICS_INVALID");
        invariant(event.acceptance?.commands?.length > 0
          && isSha256(event.acceptance.diff_hash)
          && isSha256(event.acceptance.scope_evidence_hash)
          && isSha256(event.acceptance.secret_scan_evidence_hash), "verified event lacks mechanical evidence hashes", "EVENT_SEMANTICS_INVALID");
        const history = reports.get(event.task_id) ?? [];
        this.verifyRecordedEvidenceEvent(event, history);
      } else if (event.event_type === "EVIDENCE_REJECTED") {
        invariant(event.from_status === "VERIFYING"
          && ["REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status)
          && isSha256(event.failure_fingerprint), "evidence rejection transition or fingerprint is invalid", "EVENT_SEMANTICS_INVALID");
      } else if (event.event_type === "CANDIDATE_INVALIDATED") {
        invariant(["IN_PROGRESS", "IMPLEMENTED", "VERIFYING"].includes(event.from_status)
          && ["REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(event.to_status)
          && isSha256(event.failure_fingerprint), "candidate invalidation transition or fingerprint is invalid", "EVENT_SEMANTICS_INVALID");
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
      if (event.failure_fingerprint) state.failure_fingerprint = event.failure_fingerprint;
      if (event.candidate_commit) state.candidate_commit = event.candidate_commit;
      if (event.context_hash) state.context_hash = event.context_hash;
      if (event.event_type === "EVIDENCE_VERIFIED") state.last_evidence = event.event_hash;
      state.last_event_id = event.event_id;
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
      last_evidence: this.initialVerifiedEvidence(task),
      failure_fingerprint: null,
    }]));
    const leases = new Map();
    const reports = new Map();
    const sliceGateReports = new Map();
    const usageByRun = new Map();
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
        if (event.failure_fingerprint) state.failure_fingerprint = event.failure_fingerprint;
        if (event.event_type === "EVIDENCE_VERIFIED") state.last_evidence = event.event_hash;
      }

      const leaseAction = event.lease?.action;
      if (leaseAction === "ACQUIRE") leases.set(event.lease.lease_id, { ...event.lease, task_id: event.task_id, run_id: event.autonomy_run_id });
      if (["RELEASE", "EXPIRE"].includes(leaseAction)) leases.delete(event.lease.lease_id);
      if (leaseAction === "RELEASE_ALL_TASK") {
        for (const [leaseId, lease] of leases) if (lease.task_id === event.task_id) leases.delete(leaseId);
      }

      if (event.payload?.report) {
        if (event.task_id) {
          if (!reports.has(event.task_id)) reports.set(event.task_id, []);
          reports.get(event.task_id).push(event.payload.report);
        } else if (event.role === "slice_gate_runner") {
          if (!sliceGateReports.has(event.slice_id)) sliceGateReports.set(event.slice_id, []);
          sliceGateReports.get(event.slice_id).push(event.payload.report);
        }
      }
      if (event.event_type === "HARD_STOP") stopsByRun.set(event.autonomy_run_id, event);

      if (event.event_type === "USAGE_RECORDED") {
        const usage = usageByRun.get(event.autonomy_run_id) ?? { tokens: 0, elapsed_ms: 0, known_cost: null, has_unknown_cost: false };
        usage.tokens += Number(event.execution.tokens ?? 0);
        usage.elapsed_ms += Number(event.execution.time_ms ?? 0);
        if (event.execution.known_cost === null || event.execution.known_cost === undefined) usage.has_unknown_cost = true;
        else usage.known_cost = Number(usage.known_cost ?? 0) + Number(event.execution.known_cost);
        usageByRun.set(event.autonomy_run_id, usage);
      }
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
      const gateReport = sliceGateReports.get(sliceId)?.at(-1) ?? null;
      slices.set(sliceId, { slice_id: sliceId, status, task_count: states.length, gate_verdict: gateReport?.verdict ?? null });
    }

    return {
      events,
      taskStates,
      slices,
      activeLeases,
      expiredLeases,
      reports,
      sliceGateReports,
      usageByRun,
      stopsByRun,
    };
  }

  dependenciesVerified(taskId, projection) {
    const task = this.router.taskById.get(taskId);
    return this.router.taskGraph(task).upstream.every((dependency) => projection.taskStates.get(dependency.task_id)?.status === "VERIFIED");
  }

  taskOwnerRole(taskId) {
    const task = this.router.taskById.get(taskId);
    invariant(task, `unknown Task: ${taskId}`, "TASK_NOT_FOUND");
    return task.values["角色"].replace("VIEW::", "").toLowerCase();
  }

  isPrimaryExecutor(taskId, role, state) {
    return state.status === "READY"
      && ["coder", "prompt_editor", "auditor"].includes(role)
      && this.taskOwnerRole(taskId) === role;
  }

  requestsPrimaryWrite(taskId, role, state) {
    if (this.taskOwnerRole(taskId) !== role || !["coder", "prompt_editor", "auditor"].includes(role)) return false;
    if (["coder", "prompt_editor"].includes(role)) return true;
    return !["IMPLEMENTED", "VERIFYING", "REPLAN", "BLOCKED", "CREATOR_REQUIRED", "VERIFIED"].includes(state.status);
  }

  latestProducerReport(projection, taskId, candidateCommit = null) {
    const producerRole = this.taskOwnerRole(taskId);
    return [...(projection.reports.get(taskId) ?? [])]
      .reverse()
      .find((report) => report.role === producerRole
        && report.verdict === "IMPLEMENTED"
        && (!candidateCommit || report.candidate_commit === candidateCommit)) ?? null;
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
      task_owner: task.values["角色"],
      acceptance_command: task.values["验收命令"],
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
      router_context_hash: route.context_hash,
      secret_scan_version: this.policy.secret_scan.version,
      secret_scan_max_blob_bytes: this.policy.secret_scan.max_blob_bytes,
      control_blockers: this.routeControlBlockers(route).map((item) => ({ kind: item.kind, reason: item.reason, details: item.details ?? null })),
    };
    return {
      hash: sha256(stableJson(facts)),
      facts,
      router_context_hash: route.context_hash,
      route,
    };
  }

  sliceGateContext(sliceId, projection) {
    const slice = projection.slices.get(sliceId);
    invariant(slice, `unknown slice: ${sliceId}`, "SLICE_NOT_FOUND");
    const taskEvidence = [...projection.taskStates.values()]
      .filter((state) => state.slice_id === sliceId)
      .sort((left, right) => left.task_id.localeCompare(right.task_id, "en"))
      .map((state) => ({
        task_id: state.task_id,
        status: state.status,
        evidence_hash: state.last_evidence,
        candidate_commit: state.candidate_commit,
      }));
    invariant(taskEvidence.length > 0 && taskEvidence.every((item) => item.status === "VERIFIED" && isSha256(item.evidence_hash)), "slice gate requires every necessary Task VERIFIED with evidence", "SLICE_NOT_VERIFIED");
    const row = this.router.sliceRows.find((item) => item.values["切片"] === sliceId);
    const facts = {
      schema_version: "g07-slice-gate-context/v1",
      slice_id: sliceId,
      branch: this.policy.integration_branch,
      control_document_sha256: this.router.control.sha256,
      policy_sha256: this.policyHash,
      router_sha256: hashFile(path.join(this.root, ...ROUTER_FILE.split("/"))),
      orchestrator_sha256: hashFile(path.join(this.root, ...ORCHESTRATOR_FILE.split("/"))),
      g07_gate: this.controlGateSnapshot().g07_gate,
      task_evidence: taskEvidence,
      user_entry_acceptance_sha256: sha256(row?.values["创作者可演示验收"] ?? ""),
      completion_boundary_sha256: sha256(row?.values["完成边界"] ?? ""),
    };
    return { facts, hash: sha256(stableJson(facts)), taskEvidence, row };
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
    const limits = { ...this.policy.budget.limits };
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
    const normalized = String(action ?? "").trim().toUpperCase();
    const budget = this.budgetState(runId, projection);
    if (!KNOWN_ACTIONS.has(normalized)) {
      return { allowed: false, hard_stop: true, decision_level: "BLOCKED_TECHNICAL", reason: "UNKNOWN_ACTION_DENY_BY_DEFAULT", normalized_action: normalized, budget };
    }
    if (budget.hard_stop && !["CONTROL_PLANE_READ", "READ_ONLY_REVIEW"].includes(normalized)) {
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

  recordUsage({ runId, meterReceipt }) {
    this.validatePolicy();
    invariant(runId, "usage record requires runId", "RUN_ID_REQUIRED");
    invariant(meterReceipt && typeof meterReceipt === "object", "usage record requires a platform metering receipt", "PLATFORM_RECEIPT_REQUIRED");
    const claims = meterReceipt?.claims ?? {};
    const normalized = {
      ...emptyExecution(),
      tokens: claims.tokens,
      time_ms: claims.time_ms,
      known_cost: claims.known_cost,
    };
    for (const [field, value] of [["tokens", normalized.tokens], ["time_ms", normalized.time_ms]]) {
      invariant(Number.isFinite(Number(value)) && Number(value) >= 0, `usage ${field} must be non-negative`, "USAGE_INVALID");
    }
    if (normalized.known_cost !== null) invariant(Number.isFinite(Number(normalized.known_cost)) && Number(normalized.known_cost) >= 0, "known cost must be null or non-negative", "USAGE_INVALID");
    this.verifyPlatformReceipt(meterReceipt, "USAGE_METER", {
      autonomy_run_id: runId,
      tokens: normalized.tokens,
      time_ms: normalized.time_ms,
      known_cost: normalized.known_cost,
    });
    const finalized = this.store.transact(this.#storeAuthority, () => [this.makeDraft({
      eventType: "USAGE_RECORDED",
      runId,
      role: "orchestrator",
      execution: normalized,
      platformReceipts: [meterReceipt],
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
    const ignoredPaths = this.git.ignoredPaths();
    return {
      event_log: this.store.fileSnapshot(),
      task_projection: this.taskProjectionSnapshot(projection),
      scoped_product_tree: this.scopedTreeSnapshot(taskId),
      ignored_path_names: { paths: ignoredPaths, sha256: sha256(stableJson(ignoredPaths)) },
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
    for (const lease of projection.expiredLeases) {
      if (!lease.task_id && lease.role === "slice_gate_runner" && lease.slice_id) {
        drafts.push(this.makeDraft({
          eventType: "SLICE_GATE_LEASE_EXPIRED",
          runId,
          attemptId: lease.attempt_id,
          role: "slice_gate_runner",
          baseCommit: lease.base_commit,
          candidateCommit: lease.candidate_commit,
          contextHash: lease.context_hash,
          lease: { ...lease, action: "EXPIRE" },
          decisionLevel: "BLOCKED_TECHNICAL",
          fingerprint: failureFingerprint("SLICE_GATE_LEASE_EXPIRED"),
          payload: { slice_id: lease.slice_id, reason: "SLICE_GATE_LEASE_EXPIRED_RECOVERED", original_run_id: lease.run_id, recovery_run_id: runId },
        }));
        continue;
      }
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
        payload: { reason: "LEASE_EXPIRED_RECOVERED", original_run_id: lease.run_id, recovery_run_id: runId },
      }));
      state.status = toStatus;
      state.counters = counters;
    }
    return drafts;
  }

  leaseSliceGate({ runId, sliceId, actorId, attemptId, ttlSeconds = null, contextHash = null, baseCommit = null, candidateCommit = null, platformReceipt = null }) {
    invariant(runId && sliceId && actorId && attemptId, "slice gate lease requires runId, sliceId, actorId and attemptId", "LEASE_INPUT_INVALID");
    const guard = this.evaluateAction("READ_ONLY_REVIEW", runId);
    invariant(guard.allowed, guard.reason, guard.decision_level, guard);
    this.requirePlatformTrust();
    invariant(platformReceipt && typeof platformReceipt === "object", "slice gate lease requires a platform grant receipt", "PLATFORM_RECEIPT_REQUIRED");
    const ttl = Number(ttlSeconds ?? this.policy.concurrency.default_lease_seconds);
    invariant(Number.isFinite(ttl) && ttl > 0, "lease ttl must be positive", "LEASE_TTL_INVALID");
    const finalized = this.store.transact(this.#storeAuthority, (events) => {
      let projection = this.project(events);
      const drafts = this.expiredLeaseDrafts(projection, runId);
      projection = this.project([...events, ...drafts]);
      invariant(projection.activeLeases.filter((item) => item.mode === "READ_ONLY").length < this.policy.concurrency.max_read_only_reviewers, "read-only review concurrency limit reached", "REVIEW_CONCURRENCY_BLOCKED");
      const context = this.sliceGateContext(sliceId, projection);
      const effectiveCommit = this.git.head();
      invariant(this.git.commitExists(effectiveCommit) && this.git.isClean(), "slice gate lease requires a clean committed candidate", "WORKTREE_DIRTY");
      invariant(!contextHash || contextHash === context.hash, "slice gate caller context does not match the VERIFIED slice projection", "LEASE_CONTEXT_MISMATCH");
      invariant(!baseCommit || baseCommit === effectiveCommit, "slice gate base commit must equal current HEAD", "LEASE_BASE_COMMIT_MISMATCH");
      invariant(!candidateCommit || candidateCommit === effectiveCommit, "slice gate candidate commit must equal current HEAD", "CANDIDATE_COMMIT_MISMATCH");
      const signed = platformReceipt.claims ?? {};
      const leaseId = signed.lease_id;
      const acquiredAt = new Date(signed.acquired_at);
      const expiresAt = new Date(signed.expires_at);
      const now = this.clock();
      invariant(typeof leaseId === "string" && leaseId.length >= 12
        && !Number.isNaN(acquiredAt.getTime()) && !Number.isNaN(expiresAt.getTime())
        && acquiredAt.getTime() <= now.getTime() && expiresAt.getTime() > now.getTime()
        && expiresAt.getTime() - acquiredAt.getTime() <= ttl * 1000, "slice gate platform lease lifetime is invalid", "LEASE_RECEIPT_INVALID");
      const claims = this.leaseReceiptClaims({
        runId,
        taskId: null,
        sliceId,
        attemptId,
        role: "slice_gate_runner",
        actorId,
        mode: "READ_ONLY",
        leaseId,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        baseCommit: effectiveCommit,
        candidateCommit: effectiveCommit,
        contextHash: context.hash,
        fromStatus: null,
        toStatus: null,
      });
      this.verifyPlatformReceipt(platformReceipt, "LEASE_GRANT", claims);
      const lease = {
        action: "ACQUIRE",
        lease_id: leaseId,
        mode: "READ_ONLY",
        role: "slice_gate_runner",
        actor_id: actorId,
        attempt_id: attemptId,
        slice_id: sliceId,
        acquired_at: acquiredAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        base_commit: effectiveCommit,
        candidate_commit: effectiveCommit,
        context_hash: context.hash,
        workspace_capability_receipt_id: null,
        capability_principal_id: null,
        capability_session_id: null,
      };
      drafts.push(this.makeDraft({
        eventType: "SLICE_GATE_LEASE_ACQUIRED",
        runId,
        attemptId,
        role: "slice_gate_runner",
        baseCommit: effectiveCommit,
        candidateCommit: effectiveCommit,
        contextHash: context.hash,
        lease,
        platformReceipts: [platformReceipt],
        payload: { slice_id: sliceId, actor_id: actorId, slice_context: context.facts },
      }));
      return drafts;
    });
    return finalized.at(-1);
  }

  recordSliceGate({ runId, report }) {
    const finalized = this.store.transact(this.#storeAuthority, (events) => {
      const projection = this.project(events);
      const lease = projection.activeLeases.find((item) => item.role === "slice_gate_runner"
        && item.slice_id === report.slice_id
        && item.actor_id === report.actor_id
        && item.attempt_id === report.attempt_id);
      invariant(lease, "slice gate report does not match an active lease", "REPORT_LEASE_MISMATCH");
      const context = this.sliceGateContext(report.slice_id, projection);
      invariant(report.context_hash === lease.context_hash && report.context_hash === context.hash, "slice gate report context is stale", "STALE_CONTROL_CONTEXT");
      invariant(report.base_commit === lease.base_commit && report.candidate_commit === lease.candidate_commit
        && this.git.head() === lease.candidate_commit && this.git.commitExists(lease.candidate_commit)
        && this.git.isClean(), "slice gate report is detached from the current clean candidate", "STALE_CANDIDATE_COMMIT");
      invariant(report.branch === this.git.branch() && report.branch === this.policy.integration_branch, "slice gate report branch mismatch", "REPORT_BRANCH_MISMATCH");
      invariant(normalizePath(path.resolve(report.worktree)) === this.git.worktree(), "slice gate report worktree mismatch", "REPORT_WORKTREE_MISMATCH");
      invariant(["PASS", "FAIL"].includes(report.verdict), "slice gate verdict must be PASS or FAIL", "REPORT_VERDICT_INVALID");
      const gateEvidence = this.verifySliceGateAcceptance(report, context.facts);
      const trustedReport = this.verifyReportTrust(report);
      const priorIdentities = projection.events
        .filter((event) => event.task_id && event.slice_id === report.slice_id && event.event_type === "ROLE_REPORT_RECORDED")
        .map((event) => event.payload?.trusted_report)
        .filter(Boolean);
      invariant(priorIdentities.every((identity) => identity.principal_id !== trustedReport.principal_id
        && identity.session_id !== trustedReport.session_id), "slice gate runner is not independent from a Task role in the slice", "SELF_REVIEW_BLOCKED");
      return [this.makeDraft({
        eventType: "SLICE_GATE_REPORT_RECORDED",
        runId,
        attemptId: report.attempt_id,
        role: "slice_gate_runner",
        baseCommit: report.base_commit,
        candidateCommit: report.candidate_commit,
        contextHash: report.context_hash,
        lease: { ...lease, action: "RELEASE" },
        acceptance: { commands: [gateEvidence.summary] },
        decisionLevel: "TASK_AUTONOMOUS",
        execution: report.execution,
        fingerprint: report.verdict === "FAIL" ? failureFingerprint(report.failure_fingerprint ?? report.summary ?? "SLICE_GATE_FAIL") : null,
        platformReceipts: [report.acceptance.commands[0].receipt],
        payload: { slice_id: report.slice_id, report, trusted_report: trustedReport, independent_from: priorIdentities, slice_gate_execution_receipt_id: gateEvidence.receipt.receipt_id },
      })];
    });
    return finalized[0];
  }

  lease({ runId, taskId = null, sliceId = null, role, actorId, attemptId, ttlSeconds = null, contextHash = null, baseCommit = null, candidateCommit = null, platformReceipt = null, workspaceCapabilityReceipt = null }) {
    invariant(runId && role && actorId && attemptId, "lease requires runId, role, actorId and attemptId", "LEASE_INPUT_INVALID");
    invariant(["coder", "prompt_editor", "auditor", "reviewer", "architect", "slice_gate_runner"].includes(role), `role cannot lease: ${role}`, "LEASE_ROLE_INVALID");
    if (role === "slice_gate_runner") {
      invariant(!taskId, "slice gate runner leases a slice, not a Task", "LEASE_TASK_MISMATCH");
      return this.leaseSliceGate({ runId, sliceId, actorId, attemptId, ttlSeconds, contextHash, baseCommit, candidateCommit, platformReceipt });
    }
    this.requirePlatformTrust();
    invariant(platformReceipt && typeof platformReceipt === "object", "lease requires a platform grant receipt", "PLATFORM_RECEIPT_REQUIRED");
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
      const mode = this.requestsPrimaryWrite(task.id, role, state) ? "WRITE" : "READ_ONLY";
      const guard = this.evaluateAction(mode === "WRITE" ? "PRODUCT_TASK_WRITE" : "READ_ONLY_REVIEW", runId, projection);
      invariant(guard.allowed, guard.reason, guard.decision_level, guard);
      if (mode === "READ_ONLY") {
        invariant(projection.activeLeases.filter((item) => item.mode === "READ_ONLY").length < this.policy.concurrency.max_read_only_reviewers, "read-only review concurrency limit reached", "REVIEW_CONCURRENCY_BLOCKED");
      }
      if (mode === "WRITE") {
        invariant(state.status === "READY", `writer lease requires READY, got ${state.status}`, "TASK_NOT_READY");
        invariant(this.dependenciesVerified(task.id, projection), "Task dependencies are not VERIFIED", "DEPENDENCIES_NOT_VERIFIED");
        invariant(this.taskOwnerRole(task.id) === role, `Task owner is ${task.values["角色"]}`, "TASK_ROLE_MISMATCH");
        invariant(projection.activeLeases.filter((item) => item.mode === "WRITE").length < this.policy.concurrency.max_writers, "another writer lease is active", "DOUBLE_WRITER_BLOCKED");
        invariant(this.git.isClean(), "writer lease requires a clean worktree", "WORKTREE_DIRTY");
      } else if (["auditor", "reviewer"].includes(role)) {
        invariant(["IMPLEMENTED", "VERIFYING"].includes(state.status), `review lease requires IMPLEMENTED/VERIFYING, got ${state.status}`, "TASK_NOT_REVIEWABLE");
        invariant(candidateCommit && state.candidate_commit === candidateCommit, "review lease must bind the current candidate commit", "CANDIDATE_COMMIT_MISMATCH");
      } else if (role === "architect") {
        invariant(state.status === "REPLAN", `architect lease requires REPLAN, got ${state.status}`, "TASK_NOT_IN_REPLAN");
        invariant(state.candidate_commit && candidateCommit === state.candidate_commit, "architect lease must bind the projected Replan candidate", "CANDIDATE_COMMIT_MISMATCH");
        invariant(this.git.commitExists(state.candidate_commit) && this.git.head() === state.candidate_commit, "architect candidate is missing or stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
      }

      const routeRole = role === "architect" ? "architect" : role;
      const route = this.router.route({ role: routeRole, taskId: task.id });
      const controlContext = this.controlContext(task.id);
      invariant(this.routeControlBlockers(route).length === 0, "router has blocking control conflicts", "ROUTER_BLOCKING_CONFLICT", this.routeControlBlockers(route));
      const gate = this.router.gateSnapshot();
      invariant(gate.active_execution_gate_valid && gate.g05.valid && gate.g06.valid, "active Gate or registered router artifact is invalid", "GATE_INVALID");
      const latestProducerReport = this.latestProducerReport(projection, task.id, state.candidate_commit);
      const expectedContextHash = mode === "READ_ONLY" ? state.context_hash : controlContext.hash;
      invariant(expectedContextHash && expectedContextHash === controlContext.hash, "frozen Task control context drifted", "STALE_CONTROL_CONTEXT", {
        frozen: expectedContextHash,
        current: controlContext.hash,
      });
      invariant(!contextHash || contextHash === expectedContextHash, "caller context hash does not match the Orchestrator control context", "LEASE_CONTEXT_MISMATCH");
      const expectedBaseCommit = mode === "READ_ONLY" ? latestProducerReport?.base_commit : this.git.head();
      invariant(expectedBaseCommit, "lease could not derive the base commit", "LEASE_BASE_COMMIT_MISSING");
      invariant(!baseCommit || baseCommit === expectedBaseCommit, "caller base commit does not match the Orchestrator-derived base", "LEASE_BASE_COMMIT_MISMATCH");
      if (mode === "READ_ONLY") invariant(candidateCommit === state.candidate_commit, "review candidate must equal the projected candidate", "CANDIDATE_COMMIT_MISMATCH");
      else invariant(!candidateCommit, "writer lease cannot accept a caller-supplied candidate commit", "LEASE_CANDIDATE_FORBIDDEN");
      const effectiveContextHash = expectedContextHash;
      const effectiveBaseCommit = expectedBaseCommit;
      let workspaceCapability = null;
      if (mode === "WRITE") {
        const signedCapability = workspaceCapabilityReceipt?.claims ?? {};
        invariant(typeof signedCapability.principal_id === "string" && signedCapability.principal_id.length > 0
          && typeof signedCapability.session_id === "string" && signedCapability.session_id.length > 0
          && typeof signedCapability.capability_id === "string" && signedCapability.capability_id.length >= 12
          && typeof signedCapability.sandbox_id === "string" && signedCapability.sandbox_id.length >= 8
          && isSha256(signedCapability.sandbox_instance_sha256), "writer capability lacks a trusted principal/session/sandbox instance", "WORKSPACE_CAPABILITY_INVALID");
        const capabilityClaims = this.workspaceCapabilityClaims({
          runId,
          taskId: task.id,
          attemptId,
          role,
          actorId,
          principalId: signedCapability.principal_id,
          sessionId: signedCapability.session_id,
          capabilityId: signedCapability.capability_id,
          sandboxId: signedCapability.sandbox_id,
          sandboxInstanceSha256: signedCapability.sandbox_instance_sha256,
          baseCommit: effectiveBaseCommit,
          contextHash: effectiveContextHash,
          writeScopeSha256: sha256(stableJson(route.access.expanded_write_patterns)),
        });
        this.verifyPlatformReceipt(workspaceCapabilityReceipt, "WORKSPACE_CAPABILITY", capabilityClaims);
        workspaceCapability = { receipt: workspaceCapabilityReceipt, claims: capabilityClaims };
      }
      const signedLeaseClaims = platformReceipt?.claims ?? {};
      const leaseId = signedLeaseClaims.lease_id;
      const acquiredAt = new Date(signedLeaseClaims.acquired_at);
      const expiresAt = new Date(signedLeaseClaims.expires_at);
      const now = this.clock();
      invariant(typeof leaseId === "string" && leaseId.length >= 12, "platform lease_id is invalid", "LEASE_RECEIPT_INVALID");
      invariant(signedLeaseClaims.actor_id === actorId, "platform lease actor does not match the requested actor", "LEASE_RECEIPT_INVALID");
      invariant(!Number.isNaN(acquiredAt.getTime()) && !Number.isNaN(expiresAt.getTime())
        && acquiredAt.getTime() <= now.getTime()
        && expiresAt.getTime() > now.getTime()
        && expiresAt.getTime() - acquiredAt.getTime() <= ttl * 1000, "platform lease lifetime is invalid or exceeds the requested TTL", "LEASE_RECEIPT_INVALID");
      const leaseRecord = {
        action: "ACQUIRE",
        lease_id: leaseId,
        mode,
        role,
        actor_id: actorId,
        attempt_id: attemptId,
        acquired_at: acquiredAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        base_commit: effectiveBaseCommit,
        candidate_commit: candidateCommit,
        context_hash: effectiveContextHash,
        workspace_capability_receipt_id: workspaceCapability?.receipt.receipt_id ?? null,
        capability_principal_id: workspaceCapability?.claims.principal_id ?? null,
        capability_session_id: workspaceCapability?.claims.session_id ?? null,
      };
      const toStatus = mode === "WRITE" ? "LEASED" : state.status === "IMPLEMENTED" ? "VERIFYING" : state.status;
      this.verifyPlatformReceipt(platformReceipt, "LEASE_GRANT", this.leaseReceiptClaims({
        runId,
        taskId: task.id,
        attemptId,
        role,
        actorId,
        mode,
        leaseId,
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        baseCommit: effectiveBaseCommit,
        candidateCommit,
        contextHash: effectiveContextHash,
        fromStatus: state.status,
        toStatus,
        workspaceCapabilityReceiptId: workspaceCapability?.receipt.receipt_id ?? null,
      }));
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
        platformReceipts: [platformReceipt, ...(workspaceCapability ? [workspaceCapability.receipt] : [])],
        decisionLevel: role === "architect" ? "ARCHITECT_AUTONOMOUS" : "TASK_AUTONOMOUS",
        payload: {
          actor_id: actorId,
          router_context_hash: controlContext.router_context_hash,
          workspace_capability: workspaceCapability?.claims ?? null,
        },
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
    for (const field of ["report_version", "role", "actor_id", "session_id", "attempt_id", "base_commit", "candidate_commit", "context_hash", "verdict", "identity_attestation", "report_receipt"]) {
      invariant(Object.hasOwn(report, field) && report[field] !== "", `report is missing ${field}`, "REPORT_SCHEMA_INVALID");
    }
    invariant(Object.hasOwn(report, "task_id"), "report is missing task_id", "REPORT_SCHEMA_INVALID");
    invariant(report.report_version === "g07-role-report/v4", "unsupported role report", "REPORT_SCHEMA_INVALID");
    invariant(REPORT_ROLES.has(report.role), `invalid report role: ${report.role}`, "REPORT_ROLE_INVALID");
    if (report.role === "slice_gate_runner") {
      invariant(report.task_id === null && typeof report.slice_id === "string"
        && this.router.sliceRows.some((row) => row.values["切片"] === report.slice_id), "slice gate report must identify one registered slice and no Task", "REPORT_SLICE_INVALID");
    } else {
      invariant(this.router.taskById.has(report.task_id), `unknown report Task: ${report.task_id}`, "TASK_NOT_FOUND");
    }
    invariant(isSha256(report.context_hash), "report context_hash must be SHA-256", "REPORT_CONTEXT_INVALID");
    const ownerRole = report.task_id ? this.taskOwnerRole(report.task_id) : null;
    const primaryVerdict = ["IMPLEMENTED", "BLOCKED", "CREATOR_REQUIRED"].includes(report.verdict);
    if (report.role === ownerRole && primaryVerdict) {
      invariant(typeof report.workspace_capability_receipt_id === "string" && report.workspace_capability_receipt_id.length >= 12, "writer report must bind its platform workspace capability", "WORKSPACE_CAPABILITY_INVALID");
    }
    for (const [field, value] of [["tokens", report.execution?.tokens ?? 0], ["time_ms", report.execution?.time_ms ?? 0]]) {
      invariant(Number.isFinite(Number(value)) && Number(value) >= 0, `report execution.${field} must be non-negative`, "REPORT_USAGE_INVALID");
    }
    if (report.execution?.known_cost !== null && report.execution?.known_cost !== undefined) {
      invariant(Number.isFinite(Number(report.execution.known_cost)) && Number(report.execution.known_cost) >= 0, "report execution.known_cost must be null or non-negative", "REPORT_USAGE_INVALID");
    }
    return report;
  }

  attestIndependentReports(reports, { at = this.clock() } = {}) {
    const identities = reports.map((report) => this.verifyReportTrust(report, { at }));
    return this.assertIndependentIdentities(identities);
  }

  assertIndependentIdentities(identities) {
    invariant(new Set(identities.map((item) => item.principal_id)).size === identities.length
      && new Set(identities.map((item) => item.session_id)).size === identities.length, "trusted platform attestations do not prove independent principals and sessions", "SELF_REVIEW_BLOCKED");
    return identities;
  }

  record({ runId, report }) {
    this.validateReport(report);
    invariant(runId, "record requires runId", "RUN_ID_REQUIRED");
    if (report.role === "slice_gate_runner") return this.recordSliceGate({ runId, report });
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
      const trustedReport = this.verifyReportTrust(report);
      if (lease.mode === "READ_ONLY") {
        invariant(report.candidate_commit === lease.candidate_commit
          && report.candidate_commit === state.candidate_commit, "report candidate does not match its active lease and projected Task", "REPORT_CANDIDATE_MISMATCH");
      } else {
        invariant(lease.candidate_commit === null, "writer lease must not carry a preselected candidate", "REPORT_CANDIDATE_MISMATCH");
      }
      invariant(report.candidate_commit && this.git.commitExists(report.candidate_commit), "candidate commit does not exist", "CANDIDATE_COMMIT_MISSING");
      invariant(this.git.head() === report.candidate_commit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
      invariant(this.git.commitExists(report.base_commit) && this.git.isAncestor(report.base_commit, report.candidate_commit), "report base commit is missing or not an ancestor", "BASE_COMMIT_INVALID");
      invariant(report.branch === this.git.branch() && report.branch === this.policy.integration_branch, "report is not bound to the autonomy integration branch", "REPORT_BRANCH_MISMATCH");
      invariant(normalizePath(path.resolve(report.worktree)) === this.git.worktree(), "report worktree does not match the orchestrator worktree", "REPORT_WORKTREE_MISMATCH");
      if (lease.mode === "WRITE") {
        invariant(state.status === "IN_PROGRESS", `primary ${report.role} report requires IN_PROGRESS, got ${state.status}`, "REPORT_STATE_INVALID");
        invariant(report.workspace_capability_receipt_id === lease.workspace_capability_receipt_id
          && trustedReport.principal_id === lease.capability_principal_id
          && trustedReport.session_id === lease.capability_session_id, "writer report identity does not match the platform-enforced workspace capability", "WORKSPACE_CAPABILITY_IDENTITY_MISMATCH");
      }
      if (lease.mode === "READ_ONLY" && ["auditor", "reviewer"].includes(report.role)) {
        invariant(state.candidate_commit === report.candidate_commit, "review targets a stale candidate commit", "STALE_REVIEW_COMMIT");
      }
      if (report.role === "architect" && ["A", "B"].includes(report.decision?.category)) {
        invariant(isSha256(report.decision?.proposal_sha256), "Architect A/B requires a proposal hash", "ARCHITECT_BOUNDARY_INVALID");
        this.verifyPlatformReceipt(report.decision.boundary_receipt, "ARCHITECT_BOUNDARY", this.taskBoundaryClaims(report));
      }
      let architectIndependentFrom = [];
      if (report.role === "architect") {
        architectIndependentFrom = ["coder", "auditor", "reviewer"]
          .map((role) => [...projection.events].reverse().find((event) => event.event_type === "ROLE_REPORT_RECORDED"
            && event.task_id === report.task_id
            && event.role === role
            && event.candidate_commit === state.candidate_commit)?.payload?.trusted_report)
          .filter(Boolean);
        this.assertIndependentIdentities([...architectIndependentFrom, trustedReport]);
      }

      let toStatus = state.status;
      let decisionLevel = "TASK_AUTONOMOUS";
      let fingerprint = null;
      let creatorReason = null;
      let environmentReason = null;
      let counters = { ...state.counters };
      let leaseAction = { ...lease, action: "RELEASE" };
      const auditorVerdict = lease.mode === "READ_ONLY" && report.role === "auditor" ? report.verdict : null;
      const reviewerVerdict = lease.mode === "READ_ONLY" && report.role === "reviewer" ? report.verdict : null;

      const reviewFailed = lease.mode === "READ_ONLY" && ((report.role === "auditor" && report.verdict === "FAIL")
        || (report.role === "reviewer" && report.verdict === "REQUEST_CHANGES"));
      if (reviewFailed) {
        invariant(state.status === "VERIFYING", `review failure requires VERIFYING, got ${state.status}`, "REPORT_STATE_INVALID");
        counters.rework += 1;
        fingerprint = failureFingerprint(report.failure_fingerprint ?? `${report.role}:${report.verdict}:${report.summary ?? ""}`);
        if (counters.rework >= this.policy.retry_policy.max_rework) {
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
            counters.replan += 1;
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
          fingerprint = failureFingerprint(report.failure_fingerprint ?? `architect:D:${report.decision.reason ?? "blocked"}`);
        }
      } else if (lease.mode === "WRITE" && ["BLOCKED", "CREATOR_REQUIRED"].includes(report.verdict)) {
        toStatus = report.verdict;
        decisionLevel = report.verdict === "CREATOR_REQUIRED" ? "CREATOR_REQUIRED" : "BLOCKED_TECHNICAL";
        creatorReason = report.verdict === "CREATOR_REQUIRED" ? report.summary ?? "CODER_ESCALATION" : null;
        fingerprint = failureFingerprint(report.failure_fingerprint ?? `${report.role}:${report.verdict}:${report.summary ?? ""}`);
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
        payload: { report, trusted_report: trustedReport, architect_independent_from: architectIndependentFrom },
      })];
    });
    return finalized[0];
  }

  transition({ runId, taskId, toStatus, attemptId, role = "orchestrator", candidateCommit = null, contextHash = null, decisionLevel = "TASK_AUTONOMOUS", platformReceipt = null, resolutionReceipt = null }) {
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
        const report = this.latestProducerReport(projection, taskId, candidateCommit);
        invariant(report, "structured primary executor IMPLEMENTED report is required", "PRIMARY_REPORT_REQUIRED");
        invariant(candidateCommit && this.git.commitExists(candidateCommit), "candidate commit does not exist", "CANDIDATE_COMMIT_MISSING");
        invariant(this.git.head() === candidateCommit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
      }
      const leaseAction = ["IMPLEMENTED", "REWORK", "REPLAN", "BLOCKED", "CREATOR_REQUIRED"].includes(toStatus)
        ? { action: "RELEASE_ALL_TASK", task_id: taskId, lease_id: null }
        : null;
      const effectiveBaseCommit = this.latestProducerReport(projection, taskId, candidateCommit)?.base_commit ?? this.git.head();
      const effectiveCandidateCommit = candidateCommit ?? state.candidate_commit;
      let receipts;
      let resolutionPayload = {};
      if (state.status === "BLOCKED" && toStatus === "READY") {
        invariant(state.failure_fingerprint && state.last_event_id, "BLOCKED state has no original failure evidence", "RESOLUTION_EVIDENCE_REQUIRED");
        const resolutionArtifact = resolutionReceipt?.claims?.resolution_artifact_sha256;
        invariant(isSha256(resolutionArtifact), "BLOCK resolution artifact hash is missing", "RESOLUTION_EVIDENCE_REQUIRED");
        const claims = {
          autonomy_run_id: runId,
          task_id: taskId,
          failed_event_id: state.last_event_id,
          failure_fingerprint: state.failure_fingerprint,
          resolution_artifact_sha256: resolutionArtifact,
          candidate_commit: effectiveCandidateCommit,
          context_hash: currentControlContext.hash,
        };
        this.verifyPlatformReceipt(resolutionReceipt, "BLOCK_RESOLUTION", claims);
        receipts = [resolutionReceipt];
        resolutionPayload = {
          failed_event_id: state.last_event_id,
          failure_fingerprint: state.failure_fingerprint,
          resolution_artifact_sha256: resolutionArtifact,
        };
      } else {
        const claims = this.transitionReceiptClaims({
          runId,
          taskId,
          attemptId,
          role,
          baseCommit: effectiveBaseCommit,
          candidateCommit: effectiveCandidateCommit,
          contextHash: currentControlContext.hash,
          fromStatus: state.status,
          toStatus,
        });
        this.verifyPlatformReceipt(platformReceipt, "STATE_TRANSITION", claims);
        receipts = [platformReceipt];
      }
      return [this.makeDraft({
        eventType: "TASK_TRANSITION",
        runId,
        taskId,
        attemptId,
        role,
        baseCommit: effectiveBaseCommit,
        candidateCommit: effectiveCandidateCommit,
        contextHash: currentControlContext.hash,
        lease: leaseAction,
        fromStatus: state.status,
        toStatus,
        decisionLevel,
        counters: state.counters,
        platformReceipts: receipts,
        payload: { ...resolutionPayload, router_context_hash: currentControlContext.router_context_hash },
      })];
    });
    return finalized[0];
  }

  unlock({ runId, receiptsByTask = {} }) {
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
        const context = this.controlContext(task.id);
        const dependencyEvidence = this.router.taskGraph(task).upstream.map((item) => ({ task_id: item.task_id, status: projection.taskStates.get(item.task_id).status }));
        const receipt = receiptsByTask[task.id];
        this.verifyPlatformReceipt(receipt, "TASK_UNLOCK", {
          autonomy_run_id: runId,
          task_id: task.id,
          from_status: "PLANNED",
          to_status: "READY",
          context_hash: context.hash,
          dependency_evidence_sha256: sha256(stableJson(dependencyEvidence)),
        });
        drafts.push(this.makeDraft({
          eventType: "TASK_UNLOCKED",
          runId,
          taskId: task.id,
          role: "orchestrator",
          baseCommit: this.git.head(),
          contextHash: context.hash,
          fromStatus: "PLANNED",
          toStatus: "READY",
          counters: state.counters,
          platformReceipts: [receipt],
          payload: { dependency_evidence: dependencyEvidence },
        }));
        state.status = "READY";
      }
      return drafts;
    });
    return { unlocked: finalized.map((event) => event.task_id), events: finalized };
  }

  secretPatterns() {
    return new Map([
      ["AWS_ACCESS_KEY", /AKIA[0-9A-Z]{16}/],
      ["OPENAI_KEY", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
      ["GITHUB_TOKEN", /gh[pousr]_[A-Za-z0-9]{30,}/],
      ["ANTHROPIC_KEY", /sk-ant-[A-Za-z0-9_-]{20,}/],
      ["GOOGLE_API_KEY", /AIza[0-9A-Za-z_-]{30,}/],
      ["SLACK_TOKEN", /xox[baprs]-[0-9A-Za-z-]{20,}/],
      ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ]);
  }

  scanSecretBytes(bytes) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const byteText = buffer.toString("latin1");
    return [...this.secretPatterns().entries()].filter(([, pattern]) => pattern.test(byteText)).map(([name]) => name);
  }

  scanCandidateSecrets(baseCommit, candidateCommit, { version = this.policy.secret_scan.version, maxBlobBytes = this.policy.secret_scan.max_blob_bytes } = {}) {
    invariant(version === "G07_CANDIDATE_BLOBS_V1", `unsupported historical secret scan version: ${version}`, "SECRET_SCAN_VERSION_UNAVAILABLE");
    const maxBytes = maxBlobBytes;
    const blobs = this.git.changedBlobs(baseCommit, candidateCommit);
    const scanned = [];
    const hitTypes = new Set();
    const hitPaths = new Set();
    let oversize = false;
    for (const blob of blobs) {
      const size = blob.bytes.length;
      const tooLarge = size > maxBytes;
      const hits = tooLarge ? ["OVERSIZE_BLOB_UNSCANNED"] : this.scanSecretBytes(blob.bytes);
      if (tooLarge) oversize = true;
      for (const hit of hits) hitTypes.add(hit);
      if (hits.length) hitPaths.add(blob.path);
      scanned.push({
        path: blob.path,
        mode: blob.mode,
        oid: blob.oid,
        bytes: size,
        binary: blob.bytes.includes(0),
        blob_sha256: sha256(blob.bytes),
        hit_types: hits,
      });
    }
    const ignoredPaths = this.git.ignoredPaths();
    const summary = {
      version,
      base_commit: baseCommit,
      candidate_commit: candidateCommit,
      max_blob_bytes: maxBytes,
      scanned_blobs: scanned,
      ignored_paths_sha256: sha256(stableJson(ignoredPaths)),
    };
    return {
      passed: hitTypes.size === 0 && !oversize,
      hit_types: sortedUnique([...hitTypes]),
      hit_paths: sortedUnique([...hitPaths]),
      scanned_blob_count: scanned.length,
      binary_blob_count: scanned.filter((item) => item.binary).length,
      ignored_paths: ignoredPaths,
      ignored_paths_sha256: summary.ignored_paths_sha256,
      evidence_hash: sha256(stableJson(summary)),
      blobs: scanned,
    };
  }

  evidenceFailureState(taskId, state, error) {
    const counters = { ...state.counters, retry: state.counters.retry + 1 };
    if (error.code === "ENVIRONMENT_APPROVAL_REQUIRED") {
      return {
        toStatus: "BLOCKED",
        decisionLevel: "ENVIRONMENT_APPROVAL_REQUIRED",
        counters,
        creatorReason: null,
        environmentReason: error.details?.reason ?? "PLATFORM_TRUST_PROVIDER_UNAVAILABLE",
      };
    }
    counters.rework += 1;
    if (counters.rework < this.policy.retry_policy.max_rework) {
      return { toStatus: "REWORK", decisionLevel: "TASK_AUTONOMOUS", counters, creatorReason: null, environmentReason: null };
    }
    if (counters.replan < this.policy.retry_policy.max_replan) {
      counters.replan += 1;
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
      const producer = this.latestProducerReport(projection, taskId, state.candidate_commit);
      return [this.makeDraft({
        eventType: "EVIDENCE_REJECTED",
        runId,
        taskId,
        attemptId: attemptId ?? producer?.attempt_id ?? null,
        role: "orchestrator",
        baseCommit: producer?.base_commit ?? null,
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

  verificationGateClaims({ taskId, producer, auditor, reviewer, diffHash, scopeEvidenceHash, secretEvidenceHash }) {
    return {
      task_id: taskId,
      attempt_id: producer.attempt_id,
      base_commit: producer.base_commit,
      candidate_commit: producer.candidate_commit,
      context_hash: producer.context_hash,
      producer_role: producer.role,
      producer_report_receipt_id: producer.report_receipt.receipt_id,
      auditor_report_receipt_id: auditor.report_receipt.receipt_id,
      reviewer_report_receipt_id: reviewer.report_receipt.receipt_id,
      command_receipts_sha256: sha256(stableJson((producer.acceptance?.commands ?? []).map((entry) => entry.receipt?.receipt_id ?? null))),
      auditor_receipts_sha256: sha256(stableJson((auditor.evidence ?? []).map((entry) => entry.receipt?.receipt_id ?? null))),
      reviewer_receipt_id: reviewer.review_receipt?.receipt_id ?? null,
      diff_hash: diffHash,
      scope_evidence_hash: scopeEvidenceHash,
      secret_scan_evidence_hash: secretEvidenceHash,
    };
  }

  mechanicallyVerifyEvidence({ taskId, candidateCommit, contextHash, reports, verificationReceipt, controlContextFacts = null, at = this.clock(), requireCurrent = false }) {
    const latest = (role) => [...reports].reverse().find((report) => report.role === role && report.candidate_commit === candidateCommit) ?? null;
    const producerRole = this.taskOwnerRole(taskId);
    const producer = [...reports].reverse().find((report) => report.role === producerRole
      && report.verdict === "IMPLEMENTED"
      && report.candidate_commit === candidateCommit) ?? null;
    const auditor = latest("auditor");
    const reviewer = latest("reviewer");
    invariant(producer && auditor && reviewer, "primary executor, auditor and reviewer reports are all required for the same candidate commit", "INCOMPLETE_ROLE_EVIDENCE");
    invariant(typeof producer.workspace_capability_receipt_id === "string" && producer.workspace_capability_receipt_id.length >= 12, "primary executor evidence is missing its platform workspace capability", "WORKSPACE_CAPABILITY_INVALID");
    invariant(auditor.verdict === "PASS", "auditor verdict must be PASS", "AUDITOR_VERDICT_INVALID");
    invariant(reviewer.verdict === "APPROVE", "reviewer verdict must be APPROVE", "REVIEWER_VERDICT_INVALID");
    invariant([producer, auditor, reviewer].every((report) => report.base_commit === producer.base_commit
      && report.candidate_commit === candidateCommit
      && report.context_hash === contextHash), "all reports must bind the same base/candidate/control context", "EVIDENCE_VERSION_MISMATCH");
    invariant([producer, auditor, reviewer].every((report) => report.branch === this.policy.integration_branch
      && normalizePath(path.resolve(report.worktree)) === this.git.worktree()), "all reports must bind the integration branch and current worktree", "EVIDENCE_WORKTREE_MISMATCH");
    invariant(this.git.commitExists(candidateCommit) && this.git.commitExists(producer.base_commit)
      && this.git.isAncestor(producer.base_commit, candidateCommit), "base/candidate commit evidence is invalid", "BASE_COMMIT_INVALID");
    if (requireCurrent) {
      invariant(this.git.head() === candidateCommit, "candidate commit is stale relative to HEAD", "STALE_CANDIDATE_COMMIT");
      invariant(this.git.isClean(), "evidence verification requires a clean worktree", "WORKTREE_DIRTY");
    }
    let effectiveControlFacts;
    if (requireCurrent) {
      const currentControlContext = this.controlContext(taskId);
      invariant(contextHash === currentControlContext.hash, "frozen Task control context differs from the current router control context", "STALE_CONTROL_CONTEXT", {
        frozen: contextHash,
        current: currentControlContext.hash,
      });
      invariant(this.routeControlBlockers(currentControlContext.route).length === 0, "router control context contains blocking conflicts", "CONTEXT_CONTROL_DRIFT", this.routeControlBlockers(currentControlContext.route));
      effectiveControlFacts = currentControlContext.facts;
    } else {
      invariant(controlContextFacts && sha256(stableJson(controlContextFacts)) === contextHash
        && controlContextFacts.task_id === taskId
        && controlContextFacts.integration_branch === this.policy.integration_branch
        && Array.isArray(controlContextFacts.expanded_write_scope)
        && typeof controlContextFacts.acceptance_command === "string"
        && isSha256(controlContextFacts.router_context_hash)
        && controlContextFacts.secret_scan_version === "G07_CANDIDATE_BLOBS_V1"
        && Number.isInteger(controlContextFacts.secret_scan_max_blob_bytes), "historical VERIFIED event lacks its immutable control-context snapshot", "EVENT_HISTORICAL_CONTEXT_INVALID");
      effectiveControlFacts = controlContextFacts;
    }
    const trustedIdentities = this.attestIndependentReports([producer, auditor, reviewer], { at });

    const expectedCommand = effectiveControlFacts.acceptance_command;
    const matchingCommands = (producer.acceptance?.commands ?? []).filter((entry) => entry.command === expectedCommand);
    invariant(matchingCommands.length === 1, "exactly one platform command result is required for the registered acceptance command", "ACCEPTANCE_EVIDENCE_INVALID");
    const command = matchingCommands[0];
    invariant(Number.isInteger(command.exit_code)
      && isSha256(command.stdout_sha256)
      && isSha256(command.regression_artifact_sha256), "acceptance command lacks exit/stdout/regression evidence", "ACCEPTANCE_EVIDENCE_INVALID");
    this.verifyPlatformReceipt(command.receipt, "COMMAND_EXECUTION", this.commandReceiptClaims(producer, command), { at });
    invariant(command.exit_code === 0, "registered acceptance command failed", "ACCEPTANCE_COMMAND_FAILED", { exit_code: command.exit_code });

    const auditorEvidence = auditor.evidence ?? [];
    for (const entry of auditorEvidence) {
      invariant(isSha256(entry.evidence_hash), "auditor evidence hash is invalid", "AUDITOR_EVIDENCE_INCOMPLETE");
      this.verifyPlatformReceipt(entry.receipt, "AUDIT_EVIDENCE", this.auditReceiptClaims(auditor, entry), { at });
    }
    const auditorKinds = new Set(auditorEvidence.filter((entry) => entry.passed).map((entry) => entry.kind));
    invariant(["normal", "exception", "recovery"].every((kind) => auditorKinds.has(kind)), "auditor must provide signed normal, exception and recovery evidence", "AUDITOR_EVIDENCE_INCOMPLETE");
    invariant(["contract", "diff", "write_channel", "cross_fp"].every((key) => reviewer.checks?.[key] === true), "reviewer contract/diff/write-channel/cross-FP checks must pass", "REVIEWER_EVIDENCE_INCOMPLETE");
    this.verifyPlatformReceipt(reviewer.review_receipt, "REVIEW_EVIDENCE", this.reviewReceiptClaims(reviewer), { at });

    const diffNames = this.git.diffNames(producer.base_commit, candidateCommit);
    const allowedPatterns = effectiveControlFacts.expanded_write_scope;
    const outOfScope = diffNames.filter((file) => !allowedPatterns.some((pattern) => globToRegExp(pattern).test(file)));
    invariant(outOfScope.length === 0, `diff exceeds Task write_scope: ${outOfScope.join(", ")}`, "SCOPE_VIOLATION", { out_of_scope: outOfScope });
    const diffPatch = this.git.diffPatch(producer.base_commit, candidateCommit);
    const diffHash = sha256(diffPatch);
    invariant(producer.scope?.diff_hash === diffHash && reviewer.scope?.diff_hash === diffHash, "primary executor/reviewer diff hash does not match candidate diff", "DIFF_HASH_MISMATCH");
    invariant(stableJson(sortedUnique(producer.scope?.changed_paths ?? [])) === stableJson(diffNames), "primary executor changed path evidence does not match Git", "DIFF_PATH_MISMATCH");
    const secretScan = this.scanCandidateSecrets(producer.base_commit, candidateCommit, {
      version: effectiveControlFacts.secret_scan_version,
      maxBlobBytes: effectiveControlFacts.secret_scan_max_blob_bytes,
    });
    invariant(secretScan.passed, `secret scan failed: ${secretScan.hit_types.join(", ")}`, "SECRET_SCAN_FAILED", { hit_types: secretScan.hit_types });
    invariant(producer.secret_scan?.passed === true && reviewer.secret_scan?.passed === true
      && producer.secret_scan.evidence_hash === secretScan.evidence_hash
      && reviewer.secret_scan.evidence_hash === secretScan.evidence_hash, "role secret scan evidence does not match Git diff", "SECRET_EVIDENCE_MISMATCH");
    invariant(producer.workspace_guard?.capability_enforced === true
      && producer.workspace_guard?.ignored_paths_sha256 === secretScan.ignored_paths_sha256, "primary executor did not bind the ignored-path snapshot to its platform workspace capability", "WORKSPACE_CAPABILITY_EVIDENCE_MISMATCH");
    const scopeEvidenceHash = sha256(stableJson({ allowedPatterns, diffNames }));
    const gateClaims = this.verificationGateClaims({
      taskId,
      producer,
      auditor,
      reviewer,
      diffHash,
      scopeEvidenceHash,
      secretEvidenceHash: secretScan.evidence_hash,
    });
    const gate = this.verifyPlatformReceipt(verificationReceipt, "VERIFICATION_GATE", gateClaims, { at });
    const commandSummary = (producer.acceptance?.commands ?? []).map((entry) => ({
      command: entry.command,
      exit_code: entry.exit_code,
      stdout_sha256: entry.stdout_sha256,
      regression_artifact_sha256: entry.regression_artifact_sha256,
      receipt_id: entry.receipt.receipt_id,
    }));
    return {
      producer,
      coder: producer,
      auditor,
      reviewer,
      trustedIdentities,
      diffNames,
      diffHash,
      scopeEvidenceHash,
      secretScan,
      gate,
      commandSummary,
      routerContextHash: effectiveControlFacts.router_context_hash,
      controlContextFacts: effectiveControlFacts,
    };
  }

  verifyRecordedEvidenceEvent(event, reports) {
    const verificationReceipt = event.platform_receipts.find((receipt) => receipt.kind === "VERIFICATION_GATE");
    const result = this.mechanicallyVerifyEvidence({
      taskId: event.task_id,
      candidateCommit: event.candidate_commit,
      contextHash: event.context_hash,
      reports,
      verificationReceipt,
      controlContextFacts: event.payload?.control_context,
      at: event.timestamp,
      requireCurrent: false,
    });
    invariant(stableJson(event.acceptance.commands) === stableJson(result.commandSummary)
      && event.acceptance.diff_hash === result.diffHash
      && event.acceptance.scope_evidence_hash === result.scopeEvidenceHash
      && event.acceptance.secret_scan_evidence_hash === result.secretScan.evidence_hash, "recorded VERIFIED evidence no longer matches Git/platform sources", "EVENT_VERIFIED_EVIDENCE_INVALID");
    return result;
  }

  verifyEvidence({ runId, taskId, candidateCommit, contextHash = null, attemptId = null, verificationReceipt = null }) {
    invariant(runId && taskId && candidateCommit, "verify-evidence requires runId, taskId and candidateCommit", "VERIFY_INPUT_INVALID");
    try {
      const finalized = this.store.transact(this.#storeAuthority, (events) => {
        const projection = this.project(events);
        const state = projection.taskStates.get(taskId);
        invariant(state?.status === "VERIFYING", `verify-evidence requires VERIFYING, got ${state?.status ?? "MISSING"}`, "TASK_NOT_VERIFYING");
        invariant(state.candidate_commit === candidateCommit, "candidate does not match the projected Task candidate", "CANDIDATE_COMMIT_MISMATCH");
        invariant(!contextHash || contextHash === state.context_hash, "caller context hash does not match the frozen Task control context", "VERIFY_CONTEXT_MISMATCH");
        const evidence = this.mechanicallyVerifyEvidence({
          taskId,
          candidateCommit,
          contextHash: state.context_hash,
          reports: projection.reports.get(taskId) ?? [],
          verificationReceipt,
          requireCurrent: true,
        });
        return [this.makeDraft({
          eventType: "EVIDENCE_VERIFIED",
          runId,
          taskId,
          attemptId: attemptId ?? evidence.coder.attempt_id,
          role: "orchestrator",
          baseCommit: evidence.coder.base_commit,
          candidateCommit,
          contextHash: state.context_hash,
          lease: { action: "RELEASE_ALL_TASK", task_id: taskId, lease_id: null },
          fromStatus: "VERIFYING",
          toStatus: "VERIFIED",
          acceptance: {
            commands: evidence.commandSummary,
            diff_hash: evidence.diffHash,
            scope_evidence_hash: evidence.scopeEvidenceHash,
            secret_scan_evidence_hash: evidence.secretScan.evidence_hash,
          },
          verdicts: { auditor: "PASS", reviewer: "APPROVE" },
          counters: state.counters,
          platformReceipts: [verificationReceipt],
          payload: {
            trusted_identities: evidence.trustedIdentities,
            changed_paths: evidence.diffNames,
            verification_receipt_id: evidence.gate.receipt_id,
            router_context_hash: evidence.routerContextHash,
            control_context: evidence.controlContextFacts,
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

  staleCandidateDrafts(projection, runId) {
    const drafts = [];
    for (const state of projection.taskStates.values()) {
      if (!state.candidate_commit || !["IN_PROGRESS", "IMPLEMENTED", "VERIFYING"].includes(state.status)) continue;
      if (this.git.commitExists(state.candidate_commit) && this.git.head() === state.candidate_commit) continue;
      const error = Object.assign(new Error("candidate commit became stale during resume"), {
        code: "STALE_CANDIDATE_COMMIT",
        details: { candidate_commit: state.candidate_commit, git_head: this.git.head() },
      });
      const disposition = this.evidenceFailureState(state.task_id, state, error);
      const producer = this.latestProducerReport(projection, state.task_id, state.candidate_commit);
      drafts.push(this.makeDraft({
        eventType: "CANDIDATE_INVALIDATED",
        runId,
        taskId: state.task_id,
        attemptId: producer?.attempt_id ?? null,
        role: "orchestrator",
        baseCommit: producer?.base_commit ?? null,
        candidateCommit: state.candidate_commit,
        contextHash: state.context_hash,
        lease: { action: "RELEASE_ALL_TASK", task_id: state.task_id, lease_id: null },
        fromStatus: state.status,
        toStatus: disposition.toStatus,
        decisionLevel: disposition.decisionLevel,
        fingerprint: failureFingerprint(stableJson({ code: error.code, details: error.details })),
        counters: disposition.counters,
        creatorRequiredReason: disposition.creatorReason,
        environmentApprovalReason: disposition.environmentReason,
        payload: { reason: "STALE_CANDIDATE_RECOVERED", ...error.details },
      }));
      state.status = disposition.toStatus;
      state.counters = disposition.counters;
    }
    return drafts;
  }

  resume({ runId }) {
    invariant(runId, "resume requires runId", "RUN_ID_REQUIRED");
    this.validatePolicy();
    const tailRecovery = this.store.recoverTruncatedTail(this.#storeAuthority);
    const headReconciliation = this.store.reconcileMonotonicHead(this.#storeAuthority);
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
      const recoveredProjection = this.project([...events, ...drafts]);
      drafts.push(...this.staleCandidateDrafts(recoveredProjection, runId));
      return drafts;
    });
    const projection = this.project();
    const staleCandidates = [...projection.taskStates.values()]
      .filter((state) => state.candidate_commit && ["IN_PROGRESS", "IMPLEMENTED", "VERIFYING"].includes(state.status))
      .filter((state) => !this.git.commitExists(state.candidate_commit) || this.git.head() !== state.candidate_commit)
      .map((state) => ({ task_id: state.task_id, candidate_commit: state.candidate_commit, git_head: this.git.head() }));
    return {
      schema_version: "project-orchestrator-resume/v1",
      autonomy_run_id: runId,
      recovered_expired_leases: recovered.filter((event) => ["LEASE_EXPIRED", "SLICE_GATE_LEASE_EXPIRED"].includes(event.event_type)).map((event) => event.event_id),
      recovered_stale_candidates: recovered.filter((event) => event.event_type === "CANDIDATE_INVALIDATED").map((event) => event.event_id),
      recovered_truncated_tail: tailRecovery,
      external_head_reconciled: headReconciliation,
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
      const context = this.sliceGateContext(sliceId, projection);
      return {
        schema_version: "g07-role-prompt/v4",
        role,
        autonomy_run_id: runId,
        slice_id: sliceId,
        read_only: true,
        base_commit: this.git.head(),
        candidate_commit: this.git.head(),
        context_hash: context.hash,
        task_evidence: context.taskEvidence,
        user_entry_acceptance: context.row?.values["创作者可演示验收"] ?? null,
        completion_boundary: context.row?.values["完成边界"] ?? null,
        report_schema: "g07-role-report/v4",
        acceptance_command: this.sliceGateCommand(context.facts),
        platform_receipts_required: ["LEASE_GRANT", "SLICE_GATE_EXECUTION", "ROLE_IDENTITY", "ROLE_REPORT"],
        source_bodies_embedded: false,
        instructions: "Acquire the slice_gate_runner lease, start from the registered user entry, run the exact slice acceptance command through the platform, and return its signed exit/stdout/regression evidence with PASS/FAIL for this exact context. Do not modify implementation, Task status, or any Gate.",
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
    const latestProducerReport = this.latestProducerReport(projection, taskId, state.candidate_commit);
    const isWriter = this.isPrimaryExecutor(taskId, role, state);
    if (["coder", "prompt_editor"].includes(role) && !isWriter) {
      invariant(false, `${role} prompt requires its owned Task READY, got ${state.status}`, "TASK_NOT_READY");
    }
    if (isWriter) {
      invariant(state.status === "READY", `writer prompt requires READY, got ${state.status}`, "TASK_NOT_READY");
      invariant(this.dependenciesVerified(taskId, projection), "writer prompt requires all dependencies VERIFIED", "DEPENDENCIES_NOT_VERIFIED");
      invariant(this.taskOwnerRole(taskId) === role, `Task owner is ${task.values["角色"]}`, "TASK_ROLE_MISMATCH");
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
      schema_version: "g07-role-prompt/v4",
      autonomy_run_id: runId,
      role,
      task_id: taskId,
      task_status: state.status,
      base_commit: isWriter ? this.git.head() : latestProducerReport?.base_commit ?? this.git.head(),
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
      report_schema: "g07-role-report/v4",
      platform_receipts_required: ["ROLE_IDENTITY", "ROLE_REPORT"],
      source_bodies_embedded: false,
    };
    if (role === "coder" && isWriter) return {
      ...common,
      exact_write_scope: route.access.expanded_write_patterns,
      required_command_receipt: "COMMAND_EXECUTION",
      required_workspace_capability_receipt: "WORKSPACE_CAPABILITY",
      platform_denied_write_patterns: this.policy.workspace_capability.denied_patterns,
      instructions: "Implement exactly one Task inside the platform-enforced capability. Do not change business intent or write .git/.autonomy/.env/receipt paths. Return a platform-signed role report and command result; do not write Task state or the event log.",
    };
    if (role === "auditor" && isWriter) return {
      ...common,
      exact_write_scope: route.access.expanded_write_patterns,
      required_command_receipt: "COMMAND_EXECUTION",
      required_workspace_capability_receipt: "WORKSPACE_CAPABILITY",
      platform_denied_write_patterns: this.policy.workspace_capability.denied_patterns,
      instructions: "Execute this Auditor-owned Task as its primary evidence producer inside the platform-enforced capability. Write only the registered fixtures/evidence scope, do not modify product implementation to manufacture PASS, and return IMPLEMENTED with signed command evidence.",
    };
    if (role === "auditor") return { ...common, read_only: true, required_evidence: ["normal", "exception", "recovery"], required_evidence_receipt: "AUDIT_EVIDENCE", instructions: "Audit the exact candidate commit independently. Return platform-signed evidence and PASS/FAIL; do not modify implementation." };
    if (role === "reviewer") return { ...common, read_only: true, required_checks: ["contract", "diff", "write_channel", "cross_fp"], required_review_receipt: "REVIEW_EVIDENCE", instructions: "Review the exact candidate commit independently. Return a platform-signed APPROVE/REQUEST_CHANGES report; do not repair the diff." };
    if (role === "architect") return { ...common, read_only: true, replan_categories: this.policy.replan_categories, required_boundary_receipt: "ARCHITECT_BOUNDARY_FOR_A_OR_B", instructions: "Handle only Replan A/B/C/D. A/B require a platform-signed unchanged-boundary receipt, C is CREATOR_REQUIRED, and D is technical/environment blocking." };
    if (role === "prompt_editor" && isWriter) return { ...common, exact_write_scope: route.access.expanded_write_patterns, required_workspace_capability_receipt: "WORKSPACE_CAPABILITY", platform_denied_write_patterns: this.policy.workspace_capability.denied_patterns, instructions: "Edit only an instantiated Prompt revision target anchor inside the platform-enforced capability. Do not write .git/.autonomy/.env/receipt paths, publish, activate, change code/Schema/business, or review your own revision." };
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
    this.ignoredWorkspacePaths = [];
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

  addCommit(commit, { baseCommit = this.headCommit, paths = ["package.json"], patch = null, blobs = null } = {}) {
    this.commits.add(baseCommit);
    this.commits.add(commit);
    const patchText = patch ?? `diff --git a/${paths[0]} b/${paths[0]}\n+fixture-${commit.slice(0, 8)}\n`;
    this.diffs.set(`${baseCommit}..${commit}`, {
      paths: sortedUnique(paths.map(normalizePath)),
      patch: patchText,
      blobs: new Map(paths.map((item) => [normalizePath(item), Buffer.from(blobs?.[item] ?? patchText)])),
    });
    this.headCommit = commit;
  }

  setDiff(baseCommit, candidateCommit, paths, patch, blobs = null) {
    this.diffs.set(`${baseCommit}..${candidateCommit}`, {
      paths: sortedUnique(paths.map(normalizePath)),
      patch,
      blobs: new Map(paths.map((item) => [normalizePath(item), Buffer.from(blobs?.[item] ?? patch)])),
    });
  }

  diffNames(baseCommit, candidateCommit) {
    return this.diffs.get(`${baseCommit}..${candidateCommit}`)?.paths ?? [];
  }

  diffPatch(baseCommit, candidateCommit) {
    return this.diffs.get(`${baseCommit}..${candidateCommit}`)?.patch ?? "";
  }

  changedBlobs(baseCommit, candidateCommit) {
    const diff = this.diffs.get(`${baseCommit}..${candidateCommit}`);
    return [...(diff?.blobs ?? new Map()).entries()].map(([blobPath, bytes]) => ({
      path: blobPath,
      mode: "100644",
      oid: sha256(bytes).slice(0, 40),
      bytes: Buffer.from(bytes),
    }));
  }

  ignoredPaths() {
    return sortedUnique(this.ignoredWorkspacePaths.map(normalizePath));
  }

  workspaceFiles() {
    return sortedUnique([...this.workspacePaths, ...this.ignoredWorkspacePaths]);
  }
}

class FakePlatformTrust extends Ed25519PlatformTrust {
  constructor(clock) {
    const pair = crypto.generateKeyPairSync("ed25519");
    super({ providerId: "SELF_TEST_PLATFORM", keyId: "self-test-ed25519-1", publicKey: pair.publicKey, clock });
    this.privateKey = pair.privateKey;
    this.publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" });
    this.receiptCounter = 0;
  }

  issue(kind, claims, { at = this.clock() } = {}) {
    const issued = at instanceof Date ? at : new Date(at);
    const body = {
      receipt_version: PLATFORM_RECEIPT_VERSION,
      receipt_id: `self-test-receipt-${String(++this.receiptCounter).padStart(6, "0")}`,
      provider_id: this.providerId,
      key_id: this.keyId,
      kind,
      issued_at: new Date(issued.getTime() - 60_000).toISOString(),
      expires_at: new Date(issued.getTime() + 60 * 60_000).toISOString(),
      claims: clone(claims),
    };
    return {
      ...body,
      signature: crypto.sign(null, Buffer.from(stableJson(body)), this.privateKey).toString("base64"),
    };
  }
}

class FakeMonotonicHead {
  constructor(streamId) {
    this.streamId = streamId;
    this.head = { stream_id: streamId, event_count: 0, event_hash: null };
  }

  read() {
    return clone(this.head);
  }

  compareAndSet(expected, next) {
    invariant(stableJson(this.head) === stableJson(expected), "self-test monotonic head compare-and-set conflict", "EVENT_HEAD_CAS_FAILED", { expected, actual: this.head });
    invariant(next.event_count > expected.event_count, "self-test monotonic head cannot move backwards or stay flat", "EVENT_HEAD_NON_MONOTONIC");
    this.head = clone(next);
    return this.read();
  }

  forceForSemanticTest(events) {
    this.head = {
      stream_id: this.streamId,
      event_count: events.length,
      event_hash: events.at(-1)?.event_hash ?? null,
    };
  }
}

function selfTestReport({ orchestrator, fakeGit, platform, taskId = "F0-01-REPO", role, actorId, sessionId, principalId = actorId, attestedSessionId = sessionId, attemptId, baseCommit, candidateCommit, contextHash, verdict, decision = null, evidence = null, checks = null, commandExitCode = 0 }) {
  const patchText = fakeGit.diffPatch(baseCommit, candidateCommit);
  const diffHash = sha256(patchText);
  const secretScan = orchestrator.scanCandidateSecrets(baseCommit, candidateCommit);
  const task = orchestrator.router.taskById.get(taskId);
  const report = {
    report_version: "g07-role-report/v4",
    task_id: taskId,
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
    identity_attestation: null,
    report_receipt: null,
    summary: `${role}:${verdict}`,
    acceptance: {
      commands: [],
      diff_hash: diffHash,
      scope_evidence_hash: sha256(stableJson({ changed_paths: fakeGit.diffNames(baseCommit, candidateCommit) })),
      secret_scan_evidence_hash: secretScan.evidence_hash,
    },
    evidence: evidence ?? (role === "auditor" && verdict !== "IMPLEMENTED" ? ["normal", "exception", "recovery"].map((kind) => ({
      kind,
      passed: true,
      evidence_hash: sha256(`self-test-audit:${kind}:${candidateCommit}:${attemptId}`),
    })) : []),
    checks: checks ?? (role === "reviewer" ? { contract: true, diff: true, write_channel: true, cross_fp: true } : {}),
    scope: { changed_paths: fakeGit.diffNames(baseCommit, candidateCommit), diff_hash: diffHash },
    secret_scan: { passed: secretScan.passed, evidence_hash: secretScan.evidence_hash },
    workspace_guard: { capability_enforced: verdict === "IMPLEMENTED", ignored_paths_sha256: secretScan.ignored_paths_sha256 },
    decision,
    review_receipt: null,
    execution: { model_tier: "MODEL::CODE_HIGH", actual_model: "self-test-model", tokens: 0, time_ms: 1, known_cost: null },
    workspace_capability_receipt_id: null,
  };
  if (verdict === "IMPLEMENTED") {
    const command = {
      command: task.values["验收命令"],
      exit_code: commandExitCode,
      stdout_sha256: sha256(`self-test-command-stdout:${candidateCommit}:${attemptId}:${commandExitCode}`),
      regression_artifact_sha256: sha256(stableJson({ candidateCommit, attemptId, commandExitCode, suite: "g07-self-test" })),
      receipt: null,
    };
    command.receipt = platform.issue("COMMAND_EXECUTION", orchestrator.commandReceiptClaims(report, command));
    report.acceptance.commands = [command];
  }
  if (role === "auditor" && verdict !== "IMPLEMENTED") {
    report.evidence = report.evidence.map((entry) => ({
      ...entry,
      receipt: entry.receipt ?? platform.issue("AUDIT_EVIDENCE", orchestrator.auditReceiptClaims(report, entry)),
    }));
  }
  if (role === "reviewer") {
    report.review_receipt = platform.issue("REVIEW_EVIDENCE", orchestrator.reviewReceiptClaims(report));
  }
  if (role === "architect" && ["A", "B"].includes(report.decision?.category)) {
    report.decision.proposal_sha256 ??= sha256(stableJson({ category: report.decision.category, reason: report.decision.reason ?? null }));
    report.decision.boundary_receipt ??= platform.issue("ARCHITECT_BOUNDARY", orchestrator.taskBoundaryClaims(report));
  }
  report.identity_attestation = platform.issue("ROLE_IDENTITY", {
    principal_id: principalId,
    session_id: attestedSessionId,
    role,
    task_id: report.task_id,
    slice_id: null,
    attempt_id: attemptId,
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    context_hash: contextHash,
  });
  report.report_receipt = platform.issue("ROLE_REPORT", {
    role,
    task_id: report.task_id,
    slice_id: null,
    attempt_id: attemptId,
    base_commit: baseCommit,
    candidate_commit: candidateCommit,
    context_hash: contextHash,
    report_sha256: sha256(stableJson(orchestrator.reportCore(report))),
  });
  return report;
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
  const makeHarness = ({ policyChanges = {}, clock = () => new Date("2026-07-11T12:00:00.000Z"), withPlatform = true, readyTaskId = null, verifiedSliceId = null } = {}) => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "g07-orchestrator-v3-"));
    tempRoots.push(stateDir);
    const receiptInbox = path.join(stateDir, "receipt-inbox");
    fs.mkdirSync(receiptInbox);
    const platform = new FakePlatformTrust(clock);
    const policy = mergeObjects(clone(basePolicy), {
      phase: "G07_APPROVED_INTEGRATION",
      product_task_execution_allowed: true,
      platform_trust: {
        provider: "ED25519_FILE",
        provider_id: platform.providerId,
        key_id: platform.keyId,
        public_key_path: "self-test-platform-public.pem",
        public_key_sha256: sha256(platform.publicKeyPem),
        private_key_path: null,
        private_key_material_in_workspace: false,
        receipt_version: PLATFORM_RECEIPT_VERSION,
      },
      receipt_inbox: {
        provider: "PLATFORM_DIRECTORY",
        directory: receiptInbox,
      },
    });
    mergeObjects(policy, policyChanges);
    const fakeGit = new FakeGitClient(root);
    const monotonicHead = new FakeMonotonicHead(policy.monotonic_head.stream_id);
    let harnessRouter = router;
    if ((readyTaskId && readyTaskId !== "F0-01-REPO") || verifiedSliceId) {
      harnessRouter = new ProjectContextRouter(root);
      if (verifiedSliceId) {
        invariant(harnessRouter.sliceRows.some((row) => row.values["切片"] === verifiedSliceId), `unknown self-test slice: ${verifiedSliceId}`);
        for (const task of harnessRouter.tasks) task.values["状态"] = task.values["切片"] === verifiedSliceId ? "VERIFIED" : "PLANNED";
      } else {
        const target = harnessRouter.taskById.get(readyTaskId);
        invariant(target, `unknown self-test ready Task: ${readyTaskId}`);
        const dependencies = new Set(harnessRouter.taskGraph(target).upstream.map((item) => item.task_id));
        for (const task of harnessRouter.tasks) {
          task.values["状态"] = task.id === readyTaskId ? "READY" : dependencies.has(task.id) ? "VERIFIED" : "PLANNED";
        }
      }
    }
    const bootstrapVerifiedEvidence = Object.fromEntries((harnessRouter?.tasks ?? [])
      .filter((task) => task.values["状态"] === "VERIFIED")
      .map((task) => [task.id, sha256(`self-test-bootstrap-evidence:${task.id}`)]));
    const orchestrator = new ProjectOrchestrator({
      root,
      stateDir,
      policy,
      router: harnessRouter,
      git: fakeGit,
      clock,
      idFactory: () => `self-test-v3-${String(++idCounter).padStart(6, "0")}`,
      platformTrust: withPlatform ? platform : null,
      monotonicHead,
      testControlOverrides: { ...approvedControl, bootstrap_verified_evidence: bootstrapVerifiedEvidence },
      authority: SELF_TEST_AUTHORITY,
    });
    return { orchestrator, fakeGit, stateDir, policy, platform, monotonicHead, clock };
  };
  const contextHashFor = (harness, taskId = "F0-01-REPO") => harness.orchestrator.controlContext(taskId).hash;
  const signedLease = (harness, { runId, taskId = "F0-01-REPO", role, actorId, attemptId, ttlSeconds = null, candidateCommit = null, principalId = null, sessionId = null }) => {
    const { orchestrator, platform } = harness;
    const projection = orchestrator.project();
    const state = projection.taskStates.get(taskId);
    const mode = orchestrator.requestsPrimaryWrite(taskId, role, state) ? "WRITE" : "READ_ONLY";
    const latestProducer = orchestrator.latestProducerReport(projection, taskId, state.candidate_commit);
    const baseCommit = mode === "READ_ONLY" ? latestProducer?.base_commit : harness.fakeGit.head();
    const contextHash = mode === "READ_ONLY" ? state.context_hash : contextHashFor(harness, taskId);
    const toStatus = mode === "WRITE" ? "LEASED" : state.status === "IMPLEMENTED" ? "VERIFYING" : state.status;
    const ttl = Number(ttlSeconds ?? harness.policy.concurrency.default_lease_seconds);
    const acquiredAt = harness.clock();
    const expiresAt = new Date(acquiredAt.getTime() + ttl * 1000);
    const leaseId = `self-test-lease-${sha256(stableJson({ runId, taskId, role, actorId, attemptId })).slice(0, 24)}`;
    let workspaceCapabilityReceipt = null;
    if (mode === "WRITE") {
      const capabilityClaims = orchestrator.workspaceCapabilityClaims({
        runId,
        taskId,
        attemptId,
        role,
        actorId,
        principalId: principalId ?? `attested-${role}-${attemptId}`,
        sessionId: sessionId ?? `attested-${role}-session-${attemptId}`,
        capabilityId: `self-test-capability-${sha256(`${runId}:${taskId}:${attemptId}`).slice(0, 20)}`,
        sandboxId: `sandbox-${sha256(`${actorId}:${attemptId}`).slice(0, 16)}`,
        sandboxInstanceSha256: sha256(stableJson({ runId, taskId, attemptId, actorId, enforcement: "PLATFORM_SANDBOX" })),
        baseCommit,
        contextHash,
        writeScopeSha256: sha256(stableJson(orchestrator.router.route({ role, taskId }).access.expanded_write_patterns)),
      });
      workspaceCapabilityReceipt = platform.issue("WORKSPACE_CAPABILITY", capabilityClaims);
    }
    const receipt = platform.issue("LEASE_GRANT", orchestrator.leaseReceiptClaims({
      runId,
      taskId,
      attemptId,
      role,
      actorId,
      mode,
      leaseId,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      baseCommit,
      candidateCommit,
      contextHash,
      fromStatus: state.status,
      toStatus,
      workspaceCapabilityReceiptId: workspaceCapabilityReceipt?.receipt_id ?? null,
    }));
    return orchestrator.lease({ runId, taskId, role, actorId, attemptId, ttlSeconds, candidateCommit, platformReceipt: receipt, workspaceCapabilityReceipt });
  };
  const signedSliceGateLease = (harness, { runId, sliceId, actorId, attemptId, ttlSeconds = null }) => {
    const { orchestrator, platform, fakeGit } = harness;
    const context = orchestrator.sliceGateContext(sliceId, orchestrator.project());
    const ttl = Number(ttlSeconds ?? harness.policy.concurrency.default_lease_seconds);
    const acquiredAt = harness.clock();
    const expiresAt = new Date(acquiredAt.getTime() + ttl * 1000);
    const leaseId = `self-test-slice-lease-${sha256(stableJson({ runId, sliceId, actorId, attemptId })).slice(0, 20)}`;
    const commit = fakeGit.head();
    const receipt = platform.issue("LEASE_GRANT", orchestrator.leaseReceiptClaims({
      runId,
      taskId: null,
      sliceId,
      attemptId,
      role: "slice_gate_runner",
      actorId,
      mode: "READ_ONLY",
      leaseId,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      baseCommit: commit,
      candidateCommit: commit,
      contextHash: context.hash,
      fromStatus: null,
      toStatus: null,
    }));
    return orchestrator.lease({ runId, sliceId, role: "slice_gate_runner", actorId, attemptId, ttlSeconds, candidateCommit: commit, platformReceipt: receipt });
  };
  const signedSliceGateReport = (harness, { runId, sliceId, actorId, attemptId, verdict = "PASS", principalId = null, sessionId = null, withEvidence = true, commandExitCode = 0 }) => {
    const { orchestrator, platform, fakeGit } = harness;
    const lease = orchestrator.project().activeLeases.find((item) => item.role === "slice_gate_runner" && item.slice_id === sliceId && item.attempt_id === attemptId);
    invariant(lease, "self-test slice report requires an active lease");
    const report = {
      report_version: "g07-role-report/v4",
      task_id: null,
      slice_id: sliceId,
      role: "slice_gate_runner",
      actor_id: actorId,
      session_id: `declared-slice-session-${attemptId}`,
      attempt_id: attemptId,
      base_commit: lease.base_commit,
      candidate_commit: lease.candidate_commit,
      context_hash: lease.context_hash,
      branch: fakeGit.branch(),
      worktree: fakeGit.worktree(),
      verdict,
      identity_attestation: null,
      report_receipt: null,
      summary: `slice_gate_runner:${verdict}`,
      acceptance: emptyAcceptance(),
      execution: emptyExecution(),
    };
    if (withEvidence) {
      const context = orchestrator.sliceGateContext(sliceId, orchestrator.project());
      const entry = {
        command: orchestrator.sliceGateCommand(context.facts),
        exit_code: commandExitCode,
        stdout_sha256: sha256(`self-test-slice-stdout:${sliceId}:${attemptId}:${commandExitCode}`),
        regression_artifact_sha256: sha256(stableJson({ sliceId, attemptId, candidateCommit: report.candidate_commit, commandExitCode })),
        receipt: null,
      };
      entry.receipt = platform.issue("SLICE_GATE_EXECUTION", orchestrator.sliceGateExecutionClaims(report, entry, context.facts));
      report.acceptance.commands = [entry];
    }
    report.identity_attestation = platform.issue("ROLE_IDENTITY", {
      principal_id: principalId ?? `attested-slice-${attemptId}`,
      session_id: sessionId ?? `attested-slice-session-${attemptId}`,
      role: report.role,
      task_id: null,
      slice_id: sliceId,
      attempt_id: attemptId,
      base_commit: report.base_commit,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
    });
    report.report_receipt = platform.issue("ROLE_REPORT", {
      role: report.role,
      task_id: null,
      slice_id: sliceId,
      attempt_id: attemptId,
      base_commit: report.base_commit,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
      report_sha256: sha256(stableJson(orchestrator.reportCore(report))),
    });
    return orchestrator.record({ runId, report });
  };
  const signedTransition = (harness, { runId, taskId = "F0-01-REPO", toStatus, attemptId, role = "orchestrator", candidateCommit = null, decisionLevel = "TASK_AUTONOMOUS" }) => {
    const { orchestrator, platform, fakeGit } = harness;
    const projection = orchestrator.project();
    const state = projection.taskStates.get(taskId);
    const contextHash = contextHashFor(harness, taskId);
    const baseCommit = orchestrator.latestProducerReport(projection, taskId, candidateCommit)?.base_commit ?? fakeGit.head();
    const effectiveCandidate = candidateCommit ?? state.candidate_commit;
    const receipt = platform.issue("STATE_TRANSITION", orchestrator.transitionReceiptClaims({
      runId,
      taskId,
      attemptId,
      role,
      baseCommit,
      candidateCommit: effectiveCandidate,
      contextHash,
      fromStatus: state.status,
      toStatus,
    }));
    return orchestrator.transition({ runId, taskId, toStatus, attemptId, role, candidateCommit, decisionLevel, platformReceipt: receipt });
  };
  const resignReport = (harness, report) => {
    report.report_receipt = harness.platform.issue("ROLE_REPORT", {
      role: report.role,
      task_id: report.task_id,
      slice_id: report.slice_id ?? null,
      attempt_id: report.attempt_id,
      base_commit: report.base_commit,
      candidate_commit: report.candidate_commit,
      context_hash: report.context_hash,
      report_sha256: sha256(stableJson(harness.orchestrator.reportCore(report))),
    });
    return report;
  };
  const implement = ({ harness, runId, attempt, candidateCommit, taskId = "F0-01-REPO", paths = ["package.json"], patch = null, blobs = null, principalId = null, attestedSessionId = null, commandExitCode = 0, mutateReport = null }) => {
    const { orchestrator, fakeGit, platform } = harness;
    let state = orchestrator.project().taskStates.get(taskId);
    if (state.status === "REWORK") {
      signedTransition(harness, { runId, taskId, toStatus: "READY", attemptId: attempt });
      state = orchestrator.project().taskStates.get(taskId);
    }
    invariant(state.status === "READY", `self-test implementation helper requires READY, got ${state.status}`);
    const contextHash = contextHashFor(harness, taskId);
    const baseCommit = fakeGit.head();
    const producerRole = orchestrator.taskOwnerRole(taskId);
    const effectivePrincipalId = principalId ?? `attested-${producerRole}-${attempt}`;
    const effectiveSessionId = attestedSessionId ?? `attested-${producerRole}-session-${attempt}`;
    const lease = signedLease(harness, {
      runId,
      taskId,
      role: producerRole,
      actorId: `declared-${producerRole}-${attempt}`,
      attemptId: attempt,
      principalId: effectivePrincipalId,
      sessionId: effectiveSessionId,
    });
    signedTransition(harness, { runId, taskId, toStatus: "IN_PROGRESS", attemptId: attempt, role: producerRole });
    fakeGit.addCommit(candidateCommit, { baseCommit, paths, patch, blobs });
    const report = selfTestReport({
      orchestrator,
      fakeGit,
      platform,
      taskId,
      role: producerRole,
      actorId: `declared-${producerRole}-${attempt}`,
      sessionId: `declared-${producerRole}-session-${attempt}`,
      principalId: effectivePrincipalId,
      attestedSessionId: effectiveSessionId,
      attemptId: attempt,
      baseCommit,
      candidateCommit,
      contextHash,
      verdict: "IMPLEMENTED",
      commandExitCode,
    });
    report.workspace_capability_receipt_id = lease.lease.workspace_capability_receipt_id;
    resignReport(harness, report);
    if (mutateReport) {
      mutateReport(report);
      resignReport(harness, report);
    }
    orchestrator.record({ runId, report });
    signedTransition(harness, { runId, taskId, toStatus: "IMPLEMENTED", attemptId: attempt, candidateCommit });
    return { taskId, baseCommit, candidateCommit, contextHash, lease, producerReport: report, coderReport: report };
  };
  const review = ({ harness, runId, implementation, role, verdict, attempt, principalId = null, attestedSessionId = null, record = true }) => {
    const actorId = `declared-${role}-${attempt}`;
    const lease = signedLease(harness, { runId, taskId: implementation.taskId, role, actorId, attemptId: attempt, candidateCommit: implementation.candidateCommit });
    const report = selfTestReport({
      orchestrator: harness.orchestrator,
      fakeGit: harness.fakeGit,
      platform: harness.platform,
      taskId: implementation.taskId,
      role,
      actorId,
      sessionId: `declared-${role}-session-${attempt}`,
      principalId: principalId ?? `attested-${role}-${attempt}`,
      attestedSessionId: attestedSessionId ?? `attested-${role}-session-${attempt}`,
      attemptId: attempt,
      baseCommit: implementation.baseCommit,
      candidateCommit: implementation.candidateCommit,
      contextHash: implementation.contextHash,
      verdict,
    });
    return { lease, report, event: record ? harness.orchestrator.record({ runId, report }) : null };
  };
  const passReviews = ({ harness, runId, implementation, suffix, identities = {} }) => ({
    auditor: review({
      harness,
      runId,
      implementation,
      role: "auditor",
      verdict: "PASS",
      attempt: `audit-${suffix}`,
      principalId: identities.auditorPrincipal,
      attestedSessionId: identities.auditorSession,
    }),
    reviewer: review({
      harness,
      runId,
      implementation,
      role: "reviewer",
      verdict: "APPROVE",
      attempt: `review-${suffix}`,
      principalId: identities.reviewerPrincipal,
      attestedSessionId: identities.reviewerSession,
    }),
  });
  const verificationReceipt = (harness, taskId = "F0-01-REPO") => {
    const projection = harness.orchestrator.project();
    const state = projection.taskStates.get(taskId);
    const reports = projection.reports.get(taskId) ?? [];
    const latest = (role) => [...reports].reverse().find((report) => report.role === role && report.candidate_commit === state.candidate_commit);
    const producerRole = harness.orchestrator.taskOwnerRole(taskId);
    const producer = [...reports].reverse().find((report) => report.role === producerRole
      && report.verdict === "IMPLEMENTED" && report.candidate_commit === state.candidate_commit);
    const auditor = latest("auditor");
    const reviewer = latest("reviewer");
    const diffNames = harness.fakeGit.diffNames(producer.base_commit, state.candidate_commit);
    const diffHash = sha256(harness.fakeGit.diffPatch(producer.base_commit, state.candidate_commit));
    const scopeEvidenceHash = sha256(stableJson({ allowedPatterns: harness.orchestrator.router.expandWriteScope(harness.orchestrator.router.taskById.get(taskId)), diffNames }));
    const secretEvidenceHash = harness.orchestrator.scanCandidateSecrets(producer.base_commit, state.candidate_commit).evidence_hash;
    return harness.platform.issue("VERIFICATION_GATE", harness.orchestrator.verificationGateClaims({ taskId, producer, auditor, reviewer, diffHash, scopeEvidenceHash, secretEvidenceHash }));
  };
  const verifySigned = (harness, runId, implementation) => harness.orchestrator.verifyEvidence({
    runId,
    taskId: implementation.taskId,
    candidateCommit: implementation.candidateCommit,
    verificationReceipt: verificationReceipt(harness, implementation.taskId),
  });
  const architectDecision = ({ harness, runId, implementation, category, attempt }) => {
    const lease = signedLease(harness, { runId, taskId: implementation.taskId, role: "architect", actorId: `architect-${attempt}`, attemptId: attempt, candidateCommit: implementation.candidateCommit });
    const report = selfTestReport({
      orchestrator: harness.orchestrator,
      fakeGit: harness.fakeGit,
      platform: harness.platform,
      taskId: implementation.taskId,
      role: "architect",
      actorId: `architect-${attempt}`,
      sessionId: `architect-declared-session-${attempt}`,
      attemptId: attempt,
      baseCommit: lease.base_commit,
      candidateCommit: implementation.candidateCommit,
      contextHash: implementation.contextHash,
      verdict: "REPLAN",
      decision: { category, reason: `self-test-${category}` },
    });
    return { lease, report, event: harness.orchestrator.record({ runId, report }) };
  };
  const signedMeter = (harness, runId, { tokens, timeMs, knownCost }) => harness.platform.issue("USAGE_METER", {
    autonomy_run_id: runId,
    tokens,
    time_ms: timeMs,
    known_cost: knownCost,
  });

  try {
    const production = new ProjectOrchestrator({ root });
    const dryRun = production.dryRun({ runId: "g07-v3-production-dry" });
    assertCheck("production:policy-v4-hash-bound", production.policy.schema_version === "g07-autonomy-policy/v4"
      && production.policyHash === String(router.gates.G07_A_POLICY_SHA256).toLowerCase(), production.policyHash);
    assertCheck("production:platform-unavailable-is-explicit", production.policy.platform_trust.provider === "UNAVAILABLE", production.policy.platform_trust);
    assertCheck("production:monotonic-head-unavailable-is-explicit", production.policy.monotonic_head.provider === "UNAVAILABLE", production.policy.monotonic_head);
    expectError("production:trusted-receipt-inbox-required", () => production.readTrustedJson("receipt.json", "--test-receipt"), "ENVIRONMENT_APPROVAL_REQUIRED");
    assertCheck("dry-run:unique-f0-01", dryRun.selected_task_id === "F0-01-REPO" && dryRun.ready_candidates.length === 1, dryRun);
    assertCheck("dry-run:no-fp-fabrication", dryRun.fp_ids.length === 0, dryRun.fp_ids);
    assertCheck("dry-run:three-snapshots-unchanged", dryRun.event_log_unchanged && !dryRun.product_files_written && !dryRun.task_status_changed, dryRun.snapshots);
    assertCheck("dry-run:g07-phase-hard-stop", !dryRun.policy_execution_allowed && dryRun.policy_stop_reason === "G07_PHASE_PRODUCT_TASK_EXECUTION_DISABLED", dryRun.policy_stop_reason);
    for (const action of ["DESTRUCTIVE_DATA", "UNAUTHORIZED_PAID_OPERATION", "EXTERNAL_OPERATION", "", "UNKNOWN_FUTURE_ACTION"]) {
      const result = production.evaluateAction(action, "guard-default-deny");
      assertCheck(`guard:unknown:${action || "empty"}`, !result.allowed && result.reason === "UNKNOWN_ACTION_DENY_BY_DEFAULT", result);
    }
    const trailingPush = production.evaluateAction("PUSH  ", "guard-trim");
    assertCheck("guard:trailing-space-push-blocked", !trailingPush.allowed && trailingPush.reason === "ACTION_PUSH_FORBIDDEN_IN_G07", trailingPush);
    assertCheck("guard:control-read-known", production.evaluateAction(" control_plane_read ", "guard-read").allowed === true, production.evaluateAction(" control_plane_read ", "guard-read"));
    expectError("platform:production-provider-required", () => production.verifyPlatformReceipt({}, "ROLE_IDENTITY", {}), "ENVIRONMENT_APPROVAL_REQUIRED");
    expectError("production:writer-prompt-hard-stop", () => production.rolePrompt({ runId: "g07-no-product", taskId: "F0-01-REPO", role: "coder" }), "BLOCKED_TECHNICAL");
    expectError("policy:external-injection-rejected", () => new ProjectOrchestrator({ root, policy: clone(basePolicy) }), "TEST_INJECTION_FORBIDDEN");
    assertCheck("runtime:no-local-signing-key", !fs.existsSync(path.join(root, DEFAULT_STATE_DIR, "integrity.key")), path.join(root, DEFAULT_STATE_DIR));

    const providerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "g07-platform-provider-"));
    tempRoots.push(providerRoot);
    const providerClock = () => new Date("2026-07-11T12:00:00.000Z");
    const issuer = new FakePlatformTrust(providerClock);
    fs.writeFileSync(path.join(providerRoot, "platform-public.pem"), issuer.publicKeyPem, "utf8");
    const providerPolicy = {
      platform_trust: {
        provider: "ED25519_FILE",
        provider_id: issuer.providerId,
        key_id: issuer.keyId,
        public_key_path: "platform-public.pem",
        public_key_sha256: hashFile(path.join(providerRoot, "platform-public.pem")),
        private_key_path: null,
        private_key_material_in_workspace: false,
      },
    };
    const loadedProvider = platformTrustFromPolicy(providerPolicy, providerRoot, providerClock);
    const providerReceipt = issuer.issue("PROVIDER_TEST", { value: 1 });
    assertCheck("platform:production-ed25519-provider-path", loadedProvider.verify(providerReceipt, "PROVIDER_TEST", { value: 1 }).trusted === true, providerPolicy.platform_trust);
    assertCheck("platform:private-key-not-in-workspace", fs.readdirSync(providerRoot).every((name) => !name.toLowerCase().includes("private")), fs.readdirSync(providerRoot));
    expectError("platform:public-key-hash-drift", () => platformTrustFromPolicy(mergeObjects(clone(providerPolicy), { platform_trust: { public_key_sha256: "0".repeat(64) } }), providerRoot, providerClock), "PLATFORM_TRUST_KEY_HASH_MISMATCH");
    fs.writeFileSync(path.join(providerRoot, "public-key-source.pem"), issuer.publicKeyPem, "utf8");
    fs.linkSync(path.join(providerRoot, "public-key-source.pem"), path.join(providerRoot, "public-key-alias.pem"));
    const hardlinkProviderPolicy = mergeObjects(clone(providerPolicy), { platform_trust: {
      public_key_path: "public-key-alias.pem",
      public_key_sha256: hashFile(path.join(providerRoot, "public-key-alias.pem")),
    } });
    expectError("platform:public-key-hardlink-alias-rejected", () => platformTrustFromPolicy(hardlinkProviderPolicy, providerRoot, providerClock), "TRUSTED_FILE_HARDLINK_FORBIDDEN");
    const headCommandPath = path.join(providerRoot, "monotonic-head-provider.cmd");
    fs.writeFileSync(headCommandPath, "@echo off\r\nexit /b 0\r\n", "utf8");
    const headCommandHash = hashFile(headCommandPath);
    expectError("monotonic-head:workspace-provider-rejected", () => new ExternalCommandMonotonicHead({
      commandPath: path.join(root, ORCHESTRATOR_FILE),
      commandSha256: hashFile(path.join(root, ORCHESTRATOR_FILE)),
      streamId: "self-test-workspace-head",
      workspaceRoot: root,
    }), "EVENT_HEAD_COMMAND_BOUNDARY_INVALID");
    const externalHeadProvider = new ExternalCommandMonotonicHead({
      commandPath: headCommandPath,
      commandSha256: headCommandHash,
      streamId: "self-test-external-head",
      workspaceRoot: root,
    });
    fs.writeFileSync(headCommandPath, "@echo off\r\nrem replaced\r\nexit /b 0\r\n", "utf8");
    expectError("monotonic-head:hash-rechecked-before-every-spawn", () => externalHeadProvider.read(), "EVENT_HEAD_COMMAND_HASH_MISMATCH");

    const inboxParent = fs.mkdtempSync(path.join(os.tmpdir(), "g07-receipt-inbox-"));
    tempRoots.push(inboxParent);
    const inboxRoot = path.join(inboxParent, "inbox");
    fs.mkdirSync(inboxRoot);
    fs.writeFileSync(path.join(inboxRoot, "receipt.json"), JSON.stringify({ receipt: "trusted" }), "utf8");
    fs.writeFileSync(path.join(inboxParent, "outside.json"), JSON.stringify({ receipt: "outside" }), "utf8");
    const inboxHarness = makeHarness({ policyChanges: { receipt_inbox: { provider: "PLATFORM_DIRECTORY", directory: inboxRoot } } });
    assertCheck("receipt-inbox:regular-json-inside-boundary", inboxHarness.orchestrator.readTrustedJson("receipt.json", "--test-receipt").receipt === "trusted", inboxRoot);
    expectError("receipt-inbox:path-traversal-rejected-before-read", () => inboxHarness.orchestrator.readTrustedJson(path.join("..", "outside.json"), "--test-receipt"), "TRUSTED_FILE_BOUNDARY_VIOLATION");
    fs.linkSync(path.join(inboxParent, "outside.json"), path.join(inboxRoot, "hardlink.json"));
    expectError("receipt-inbox:hardlink-alias-rejected", () => inboxHarness.orchestrator.readTrustedJson("hardlink.json", "--test-receipt"), "TRUSTED_FILE_HARDLINK_FORBIDDEN");

    const promptHarness = makeHarness();
    const prompt = promptHarness.orchestrator.rolePrompt({ runId: "prompt", taskId: "F0-01-REPO", role: "coder" });
    assertCheck("prompt:v4-platform-receipts", prompt.report_schema === "g07-role-report/v4"
      && prompt.required_command_receipt === "COMMAND_EXECUTION"
      && prompt.required_workspace_capability_receipt === "WORKSPACE_CAPABILITY"
      && prompt.platform_denied_write_patterns.includes(".autonomy/**")
      && prompt.platform_receipts_required.includes("ROLE_REPORT"), prompt);
    expectError("prompt:planned-coder-rejected", () => promptHarness.orchestrator.rolePrompt({ runId: "prompt", taskId: "F0-02-CONTRACTS", role: "coder" }), "TASK_NOT_READY");
    expectError("prompt:slice-before-verified", () => promptHarness.orchestrator.rolePrompt({ runId: "prompt", role: "slice_gate_runner", sliceId: "F0" }), "SLICE_NOT_VERIFIED");

    const auditorTaskHarness = makeHarness({ readyTaskId: "S7-FULL-BOOK-FAULT-CAMPAIGN" });
    const auditorTaskPrompt = auditorTaskHarness.orchestrator.rolePrompt({ runId: "auditor-owner", taskId: "S7-FULL-BOOK-FAULT-CAMPAIGN", role: "auditor" });
    assertCheck("auditor-owner:ready-prompt-has-exact-write-scope", auditorTaskPrompt.read_only !== true
      && auditorTaskPrompt.exact_write_scope.includes("fixtures/full-book/**")
      && auditorTaskPrompt.required_workspace_capability_receipt === "WORKSPACE_CAPABILITY", auditorTaskPrompt);
    const auditorTaskImplementation = implement({
      harness: auditorTaskHarness,
      runId: "auditor-owner",
      taskId: "S7-FULL-BOOK-FAULT-CAMPAIGN",
      attempt: "auditor-owner-1",
      candidateCommit: sha256("auditor-owner-candidate").slice(0, 40),
      paths: ["fixtures/full-book/fault-case.json"],
    });
    assertCheck("auditor-owner:primary-lease-is-single-writer", auditorTaskImplementation.lease.lease.mode === "WRITE"
      && auditorTaskImplementation.producerReport.role === "auditor", auditorTaskImplementation.lease.lease);
    passReviews({ harness: auditorTaskHarness, runId: "auditor-owner", implementation: auditorTaskImplementation, suffix: "auditor-owner" });
    const auditorTaskVerified = verifySigned(auditorTaskHarness, "auditor-owner", auditorTaskImplementation);
    assertCheck("auditor-owner:full-lifecycle-verifies-independently", auditorTaskVerified.to_status === "VERIFIED", auditorTaskVerified);

    const sliceGateHarness = makeHarness({ verifiedSliceId: "S6" });
    const slicePrompt = sliceGateHarness.orchestrator.rolePrompt({ runId: "slice-gate", role: "slice_gate_runner", sliceId: "S6" });
    assertCheck("slice-gate:prompt-binds-complete-verified-context", slicePrompt.task_evidence.length === 3
      && slicePrompt.task_evidence.every((item) => item.status === "VERIFIED" && isSha256(item.evidence_hash))
      && isSha256(slicePrompt.context_hash)
      && slicePrompt.acceptance_command.startsWith("SLICE_GATE_USER_ENTRY:S6:")
      && slicePrompt.platform_receipts_required.includes("SLICE_GATE_EXECUTION"), slicePrompt);
    const sliceLease = signedSliceGateLease(sliceGateHarness, { runId: "slice-gate", sliceId: "S6", actorId: "slice-runner", attemptId: "slice-gate-1" });
    expectError("slice-gate:pass-with-empty-acceptance-rejected", () => signedSliceGateReport(sliceGateHarness, {
      runId: "slice-gate",
      sliceId: "S6",
      actorId: "slice-runner",
      attemptId: "slice-gate-1",
      verdict: "PASS",
      withEvidence: false,
    }), "SLICE_GATE_EVIDENCE_INCOMPLETE");
    expectError("slice-gate:pass-with-failed-platform-execution-rejected", () => signedSliceGateReport(sliceGateHarness, {
      runId: "slice-gate",
      sliceId: "S6",
      actorId: "slice-runner",
      attemptId: "slice-gate-1",
      verdict: "PASS",
      commandExitCode: 1,
    }), "SLICE_GATE_ACCEPTANCE_FAILED");
    const sliceReportEvent = signedSliceGateReport(sliceGateHarness, { runId: "slice-gate", sliceId: "S6", actorId: "slice-runner", attemptId: "slice-gate-1", verdict: "PASS" });
    assertCheck("slice-gate:lease-and-report-enter-trusted-event-chain", sliceLease.event_type === "SLICE_GATE_LEASE_ACQUIRED"
      && sliceReportEvent.event_type === "SLICE_GATE_REPORT_RECORDED"
      && sliceReportEvent.acceptance.commands.length === 1
      && sliceReportEvent.platform_receipts.some((receipt) => receipt.kind === "SLICE_GATE_EXECUTION")
      && sliceGateHarness.orchestrator.project().slices.get("S6").gate_verdict === "PASS", sliceReportEvent);

    const leaseHarness = makeHarness();
    expectError("lease:missing-platform-receipt", () => leaseHarness.orchestrator.lease({ runId: "lease", taskId: "F0-01-REPO", role: "coder", actorId: "writer", attemptId: "lease-1" }), "PLATFORM_RECEIPT_REQUIRED");
    const noCapabilityHarness = makeHarness();
    const noCapabilityContext = contextHashFor(noCapabilityHarness);
    const noCapabilityAt = noCapabilityHarness.clock();
    const noCapabilityGrant = noCapabilityHarness.platform.issue("LEASE_GRANT", noCapabilityHarness.orchestrator.leaseReceiptClaims({
      runId: "no-capability",
      taskId: "F0-01-REPO",
      attemptId: "no-capability-1",
      role: "coder",
      actorId: "writer-no-capability",
      mode: "WRITE",
      leaseId: "no-capability-lease-0001",
      acquiredAt: noCapabilityAt.toISOString(),
      expiresAt: new Date(noCapabilityAt.getTime() + 900_000).toISOString(),
      baseCommit: noCapabilityHarness.fakeGit.head(),
      candidateCommit: null,
      contextHash: noCapabilityContext,
      fromStatus: "READY",
      toStatus: "LEASED",
      workspaceCapabilityReceiptId: null,
    }));
    expectError("lease:writer-without-workspace-capability-rejected", () => noCapabilityHarness.orchestrator.lease({
      runId: "no-capability",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "writer-no-capability",
      attemptId: "no-capability-1",
      platformReceipt: noCapabilityGrant,
    }), "WORKSPACE_CAPABILITY_INVALID");
    const lease = signedLease(leaseHarness, { runId: "lease", role: "coder", actorId: "writer", attemptId: "lease-1" });
    assertCheck("lease:signed-ready-to-leased", lease.to_status === "LEASED" && lease.platform_receipts[0].kind === "LEASE_GRANT", lease);
    expectError("lease:double-writer-rejected", () => signedLease(leaseHarness, { runId: "lease", role: "coder", actorId: "writer-2", attemptId: "lease-2" }), "TASK_NOT_READY");
    expectError("transition:missing-platform-receipt", () => leaseHarness.orchestrator.transition({ runId: "lease", taskId: "F0-01-REPO", toStatus: "IN_PROGRESS", attemptId: "lease-1", role: "coder" }), "PLATFORM_RECEIPT_REQUIRED");
    const inProgress = signedTransition(leaseHarness, { runId: "lease", toStatus: "IN_PROGRESS", attemptId: "lease-1", role: "coder" });
    assertCheck("transition:signed-leased-to-in-progress", inProgress.to_status === "IN_PROGRESS", inProgress);

    const leaseTamperHarness = makeHarness();
    signedLease(leaseTamperHarness, { runId: "lease-tamper", role: "coder", actorId: "lease-tamper-writer", attemptId: "lease-tamper-1" });
    const leaseTamperLines = fs.readFileSync(leaseTamperHarness.orchestrator.store.eventsPath, "utf8").trimEnd().split(/\r?\n/);
    const forgedLease = JSON.parse(leaseTamperLines.at(-1));
    forgedLease.lease.expires_at = new Date(Date.parse(forgedLease.lease.expires_at) + 60_000).toISOString();
    forgedLease.event_hash = hashEvent(forgedLease);
    leaseTamperLines[leaseTamperLines.length - 1] = JSON.stringify(forgedLease);
    fs.writeFileSync(leaseTamperHarness.orchestrator.store.eventsPath, `${leaseTamperLines.join("\n")}\n`, "utf8");
    expectError("lease:external-head-detects-event-tamper", () => leaseTamperHarness.orchestrator.store.read(), "EVENT_HEAD_MISMATCH");
    leaseTamperHarness.monotonicHead.forceForSemanticTest(leaseTamperLines.map((line) => JSON.parse(line)));
    expectError("lease:signed-lifetime-cannot-be-tampered", () => leaseTamperHarness.orchestrator.store.read(), "PLATFORM_RECEIPT_CLAIMS_MISMATCH");

    const contextHarness = makeHarness();
    const actualContextHash = contextHashFor(contextHarness);
    const contextState = contextHarness.orchestrator.project().taskStates.get("F0-01-REPO");
    const contextReceipt = contextHarness.platform.issue("LEASE_GRANT", contextHarness.orchestrator.leaseReceiptClaims({
      runId: "context-forgery",
      taskId: "F0-01-REPO",
      attemptId: "context-forgery-1",
      role: "coder",
      actorId: "context-forger",
      mode: "WRITE",
      leaseId: "context-forgery-lease-0001",
      acquiredAt: contextHarness.clock().toISOString(),
      expiresAt: new Date(contextHarness.clock().getTime() + contextHarness.policy.concurrency.default_lease_seconds * 1000).toISOString(),
      baseCommit: contextHarness.fakeGit.head(),
      candidateCommit: null,
      contextHash: actualContextHash,
      fromStatus: contextState.status,
      toStatus: "LEASED",
    }));
    expectError("context:caller-forged-hash-rejected", () => contextHarness.orchestrator.lease({
      runId: "context-forgery",
      taskId: "F0-01-REPO",
      role: "coder",
      actorId: "context-forger",
      attemptId: "context-forgery-1",
      contextHash: "0".repeat(64),
      platformReceipt: contextReceipt,
    }), "LEASE_CONTEXT_MISMATCH");

    const capabilityIdentityHarness = makeHarness();
    expectError("capability:writer-identity-must-match-sandbox", () => implement({
      harness: capabilityIdentityHarness,
      runId: "capability-identity",
      attempt: "capability-identity-1",
      candidateCommit: sha256("capability-identity-candidate").slice(0, 40),
      mutateReport: (report) => {
        report.identity_attestation = capabilityIdentityHarness.platform.issue("ROLE_IDENTITY", {
          principal_id: "different-platform-principal",
          session_id: "different-platform-session",
          role: report.role,
          task_id: report.task_id,
          slice_id: report.slice_id ?? null,
          attempt_id: report.attempt_id,
          base_commit: report.base_commit,
          candidate_commit: report.candidate_commit,
          context_hash: report.context_hash,
        });
      },
    }), "WORKSPACE_CAPABILITY_IDENTITY_MISMATCH");

    const goodHarness = makeHarness();
    const goodImplementation = implement({ harness: goodHarness, runId: "good", attempt: "good-1", candidateCommit: "1".repeat(40) });
    passReviews({ harness: goodHarness, runId: "good", implementation: goodImplementation, suffix: "good" });
    const verified = verifySigned(goodHarness, "good", goodImplementation);
    assertCheck("evidence:platform-signed-verified", verified.to_status === "VERIFIED"
      && verified.platform_receipts[0].kind === "VERIFICATION_GATE"
      && verified.payload.trusted_identities.length === 3, verified);
    const unlockProjection = goodHarness.orchestrator.project();
    const unlockState = unlockProjection.taskStates.get("F0-02-CONTRACTS");
    const unlockContext = contextHashFor(goodHarness, "F0-02-CONTRACTS");
    const dependencyEvidence = goodHarness.orchestrator.router.taskGraph(goodHarness.orchestrator.router.taskById.get("F0-02-CONTRACTS")).upstream
      .map((item) => ({ task_id: item.task_id, status: unlockProjection.taskStates.get(item.task_id).status }));
    const unlockReceipt = goodHarness.platform.issue("TASK_UNLOCK", {
      autonomy_run_id: "good",
      task_id: "F0-02-CONTRACTS",
      from_status: unlockState.status,
      to_status: "READY",
      context_hash: unlockContext,
      dependency_evidence_sha256: sha256(stableJson(dependencyEvidence)),
    });
    const unlocked = goodHarness.orchestrator.unlock({ runId: "good", receiptsByTask: { "F0-02-CONTRACTS": unlockReceipt } });
    assertCheck("unlock:signed-dependency-closure", unlocked.unlocked.includes("F0-02-CONTRACTS"), unlocked.unlocked);
    assertCheck("events:replay-revalidates-platform-evidence", goodHarness.orchestrator.store.read().at(-2).event_type === "EVIDENCE_VERIFIED", goodHarness.orchestrator.store.read().length);

    const historicalContextHarness = makeHarness();
    const historicalImplementation = implement({ harness: historicalContextHarness, runId: "historical-context", attempt: "historical-context-1", candidateCommit: sha256("historical-context-candidate").slice(0, 40) });
    passReviews({ harness: historicalContextHarness, runId: "historical-context", implementation: historicalImplementation, suffix: "historical-context" });
    verifySigned(historicalContextHarness, "historical-context", historicalImplementation);
    const originalControlContext = historicalContextHarness.orchestrator.controlContext.bind(historicalContextHarness.orchestrator);
    historicalContextHarness.orchestrator.controlContext = (taskId) => {
      const current = originalControlContext(taskId);
      return { ...current, hash: sha256(`upgraded-control-context:${current.hash}`) };
    };
    const historicalProjection = historicalContextHarness.orchestrator.project();
    assertCheck("history:verified-survives-later-control-upgrade", historicalProjection.taskStates.get("F0-01-REPO").status === "VERIFIED", historicalProjection.taskStates.get("F0-01-REPO"));

    const verifiedRollbackHarness = makeHarness();
    const verifiedRollbackImplementation = implement({ harness: verifiedRollbackHarness, runId: "verified-rollback", attempt: "verified-rollback-1", candidateCommit: sha256("verified-rollback-candidate").slice(0, 40) });
    passReviews({ harness: verifiedRollbackHarness, runId: "verified-rollback", implementation: verifiedRollbackImplementation, suffix: "verified-rollback" });
    verifySigned(verifiedRollbackHarness, "verified-rollback", verifiedRollbackImplementation);
    const verifiedRollbackLines = fs.readFileSync(verifiedRollbackHarness.orchestrator.store.eventsPath, "utf8").trimEnd().split(/\r?\n/);
    fs.writeFileSync(verifiedRollbackHarness.orchestrator.store.eventsPath, `${verifiedRollbackLines.slice(0, -1).join("\n")}\n`, "utf8");
    expectError("events:verified-tail-cannot-be-deleted", () => verifiedRollbackHarness.orchestrator.project(), "EVENT_LOG_ROLLBACK_DETECTED");

    const arbitraryHarness = makeHarness();
    const arbitraryImplementation = implement({
      harness: arbitraryHarness,
      runId: "arbitrary",
      attempt: "arbitrary-1",
      candidateCommit: "2".repeat(40),
      mutateReport: (report) => {
        report.acceptance.commands[0].stdout_sha256 = "1".repeat(64);
        report.acceptance.commands[0].regression_artifact_sha256 = "2".repeat(64);
        report.acceptance.commands[0].receipt = null;
      },
    });
    passReviews({ harness: arbitraryHarness, runId: "arbitrary", implementation: arbitraryImplementation, suffix: "arbitrary" });
    expectError("evidence:arbitrary-hashes-without-command-receipt", () => arbitraryHarness.orchestrator.verifyEvidence({
      runId: "arbitrary",
      taskId: "F0-01-REPO",
      candidateCommit: arbitraryImplementation.candidateCommit,
      verificationReceipt: verificationReceipt(arbitraryHarness),
    }), "PLATFORM_RECEIPT_REQUIRED");
    assertCheck("evidence:forgery-recorded-as-rework", arbitraryHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", arbitraryHarness.orchestrator.store.read().at(-1));

    const scopeHarness = makeHarness();
    const scopeImplementation = implement({
      harness: scopeHarness,
      runId: "scope-overflow",
      attempt: "scope-overflow-1",
      candidateCommit: sha256("scope-overflow-candidate").slice(0, 40),
      paths: ["outside-approved-write-scope.txt"],
    });
    passReviews({ harness: scopeHarness, runId: "scope-overflow", implementation: scopeImplementation, suffix: "scope-overflow" });
    expectError("evidence:scope-overflow-rejected", () => scopeHarness.orchestrator.verifyEvidence({
      runId: "scope-overflow",
      taskId: "F0-01-REPO",
      candidateCommit: scopeImplementation.candidateCommit,
      verificationReceipt: verificationReceipt(scopeHarness),
    }), "SCOPE_VIOLATION");

    const secretHarness = makeHarness();
    const fakeSecret = `sk-proj-${"A".repeat(24)}`;
    const secretImplementation = implement({
      harness: secretHarness,
      runId: "secret-leak",
      attempt: "secret-leak-1",
      candidateCommit: sha256("secret-leak-candidate").slice(0, 40),
      patch: `diff --git a/package.json b/package.json\n+fixture_secret=${fakeSecret}\n`,
    });
    passReviews({ harness: secretHarness, runId: "secret-leak", implementation: secretImplementation, suffix: "secret-leak" });
    expectError("evidence:secret-leak-rejected", () => secretHarness.orchestrator.verifyEvidence({
      runId: "secret-leak",
      taskId: "F0-01-REPO",
      candidateCommit: secretImplementation.candidateCommit,
      verificationReceipt: verificationReceipt(secretHarness),
    }), "SECRET_SCAN_FAILED");

    const binarySecretHarness = makeHarness();
    const binarySecret = Buffer.concat([Buffer.from([0x00, 0xff, 0x01]), Buffer.from(fakeSecret, "ascii"), Buffer.from([0x00, 0x02])]);
    const binarySecretImplementation = implement({
      harness: binarySecretHarness,
      runId: "binary-secret",
      attempt: "binary-secret-1",
      candidateCommit: sha256("binary-secret-candidate").slice(0, 40),
      patch: "diff --git a/package.json b/package.json\nBinary files differ\n",
      blobs: { "package.json": binarySecret },
    });
    passReviews({ harness: binarySecretHarness, runId: "binary-secret", implementation: binarySecretImplementation, suffix: "binary-secret" });
    const binaryScan = binarySecretHarness.orchestrator.scanCandidateSecrets(binarySecretImplementation.baseCommit, binarySecretImplementation.candidateCommit);
    assertCheck("secret:binary-blob-is-scanned", binaryScan.binary_blob_count === 1 && binaryScan.hit_types.includes("OPENAI_KEY"), binaryScan);
    expectError("evidence:binary-secret-leak-rejected", () => binarySecretHarness.orchestrator.verifyEvidence({
      runId: "binary-secret",
      taskId: "F0-01-REPO",
      candidateCommit: binarySecretImplementation.candidateCommit,
      verificationReceipt: verificationReceipt(binarySecretHarness),
    }), "SECRET_SCAN_FAILED");

    const oversizeHarness = makeHarness({ policyChanges: { secret_scan: { max_blob_bytes: 8 } } });
    const oversizeImplementation = implement({
      harness: oversizeHarness,
      runId: "oversize-blob",
      attempt: "oversize-blob-1",
      candidateCommit: sha256("oversize-blob-candidate").slice(0, 40),
      blobs: { "package.json": Buffer.alloc(9, 0x41) },
    });
    passReviews({ harness: oversizeHarness, runId: "oversize-blob", implementation: oversizeImplementation, suffix: "oversize-blob" });
    expectError("evidence:oversize-unscanned-blob-blocked", () => oversizeHarness.orchestrator.verifyEvidence({
      runId: "oversize-blob",
      taskId: "F0-01-REPO",
      candidateCommit: oversizeImplementation.candidateCommit,
      verificationReceipt: verificationReceipt(oversizeHarness),
    }), "SECRET_SCAN_FAILED");

    const intermittentHarness = makeHarness();
    const intermittentImplementation = implement({ harness: intermittentHarness, runId: "intermittent", attempt: "intermittent-1", candidateCommit: "3".repeat(40), commandExitCode: 1 });
    passReviews({ harness: intermittentHarness, runId: "intermittent", implementation: intermittentImplementation, suffix: "intermittent" });
    expectError("evidence:intermittent-command-failure", () => intermittentHarness.orchestrator.verifyEvidence({
      runId: "intermittent",
      taskId: "F0-01-REPO",
      candidateCommit: intermittentImplementation.candidateCommit,
      verificationReceipt: verificationReceipt(intermittentHarness),
    }), "ACCEPTANCE_COMMAND_FAILED");
    assertCheck("evidence:intermittent-failure-event", intermittentHarness.orchestrator.store.read().at(-1).payload.rejection.code === "ACCEPTANCE_COMMAND_FAILED", intermittentHarness.orchestrator.store.read().at(-1));

    const reviewerFailHarness = makeHarness();
    const reviewerFailImplementation = implement({ harness: reviewerFailHarness, runId: "reviewer-fail", attempt: "reviewer-fail-1", candidateCommit: sha256("reviewer-fail-candidate").slice(0, 40) });
    review({ harness: reviewerFailHarness, runId: "reviewer-fail", implementation: reviewerFailImplementation, role: "auditor", verdict: "PASS", attempt: "reviewer-fail-audit" });
    const reviewerFailure = review({ harness: reviewerFailHarness, runId: "reviewer-fail", implementation: reviewerFailImplementation, role: "reviewer", verdict: "REQUEST_CHANGES", attempt: "reviewer-fail-review" }).event;
    assertCheck("reviewer:request-changes-enters-rework", reviewerFailure.to_status === "REWORK"
      && reviewerFailHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", reviewerFailure);

    const blockHarness = makeHarness();
    const blockImplementation = implement({ harness: blockHarness, runId: "block", attempt: "block-1", candidateCommit: "4".repeat(40) });
    passReviews({ harness: blockHarness, runId: "block", implementation: blockImplementation, suffix: "block" });
    const environmentError = Object.assign(new Error("environment trust temporarily unavailable"), { code: "ENVIRONMENT_APPROVAL_REQUIRED", details: { reason: "TEST_ENVIRONMENT_BLOCK" } });
    blockHarness.orchestrator.recordEvidenceRejection({ runId: "block", taskId: "F0-01-REPO", candidateCommit: blockImplementation.candidateCommit, attemptId: "block-verify", error: environmentError });
    const blockedState = blockHarness.orchestrator.project().taskStates.get("F0-01-REPO");
    expectError("blocked:shape-only-resolution-rejected", () => blockHarness.orchestrator.transition({
      runId: "block",
      taskId: "F0-01-REPO",
      toStatus: "READY",
      attemptId: "block-resolve",
      resolutionEvidence: "f".repeat(64),
    }), "RESOLUTION_EVIDENCE_REQUIRED");
    const resolutionArtifact = sha256("self-test-resolution-artifact");
    const resolutionReceipt = blockHarness.platform.issue("BLOCK_RESOLUTION", {
      autonomy_run_id: "block",
      task_id: "F0-01-REPO",
      failed_event_id: blockedState.last_event_id,
      failure_fingerprint: blockedState.failure_fingerprint,
      resolution_artifact_sha256: resolutionArtifact,
      candidate_commit: blockedState.candidate_commit,
      context_hash: contextHashFor(blockHarness),
    });
    const resolved = blockHarness.orchestrator.transition({ runId: "block", taskId: "F0-01-REPO", toStatus: "READY", attemptId: "block-resolve", resolutionReceipt });
    assertCheck("blocked:signed-original-fingerprint-resolution", resolved.to_status === "READY"
      && resolved.payload.failure_fingerprint === blockedState.failure_fingerprint, resolved);

    const retryHarness = makeHarness();
    let lastImplementation = null;
    const failThree = (start) => {
      let event = null;
      for (let offset = 0; offset < 3; offset += 1) {
        const number = start + offset;
        lastImplementation = implement({ harness: retryHarness, runId: "retry", attempt: `retry-${number}`, candidateCommit: sha256(`candidate-${number}`).slice(0, 40) });
        event = review({ harness: retryHarness, runId: "retry", implementation: lastImplementation, role: "auditor", verdict: "FAIL", attempt: `audit-fail-${number}` }).event;
      }
      return event;
    };
    const firstReplan = failThree(1);
    assertCheck("replan:first-three-reworks", firstReplan.to_status === "REPLAN" && firstReplan.counters.replan === 1, firstReplan);
    expectError("architect:detached-or-missing-candidate-lease-rejected", () => signedLease(retryHarness, {
      runId: "retry",
      role: "architect",
      actorId: "architect-detached",
      attemptId: "architect-detached-1",
      candidateCommit: "d".repeat(40),
    }), "CANDIDATE_COMMIT_MISMATCH");
    const architectLease = signedLease(retryHarness, { runId: "retry", role: "architect", actorId: "architect-invalid", attemptId: "architect-1", candidateCommit: lastImplementation.candidateCommit });
    const detachedArchitectReport = selfTestReport({
      orchestrator: retryHarness.orchestrator,
      fakeGit: retryHarness.fakeGit,
      platform: retryHarness.platform,
      role: "architect",
      actorId: "architect-invalid",
      sessionId: "architect-detached-report-session",
      attemptId: "architect-1",
      baseCommit: architectLease.base_commit,
      candidateCommit: "d".repeat(40),
      contextHash: lastImplementation.contextHash,
      verdict: "REPLAN",
      decision: { category: "A", reason: "detached report candidate" },
    });
    expectError("architect:detached-report-candidate-rejected", () => retryHarness.orchestrator.record({ runId: "retry", report: detachedArchitectReport }), "REPORT_CANDIDATE_MISMATCH");
    const invalidArchitect = selfTestReport({
      orchestrator: retryHarness.orchestrator,
      fakeGit: retryHarness.fakeGit,
      platform: retryHarness.platform,
      role: "architect",
      actorId: "architect-invalid",
      sessionId: "architect-session-invalid",
      attemptId: "architect-1",
      baseCommit: architectLease.base_commit,
      candidateCommit: lastImplementation.candidateCommit,
      contextHash: lastImplementation.contextHash,
      verdict: "REPLAN",
      decision: { category: "A", reason: "claims will be changed" },
    });
    const invalidArchitectIdentity = clone(invalidArchitect);
    invalidArchitectIdentity.identity_attestation.signature = Buffer.from("invalid-architect-signature").toString("base64");
    resignReport(retryHarness, invalidArchitectIdentity);
    expectError("architect:identity-witness-required", () => retryHarness.orchestrator.record({ runId: "retry", report: invalidArchitectIdentity }), "PLATFORM_RECEIPT_SIGNATURE_INVALID");
    const selfArchitect = selfTestReport({
      orchestrator: retryHarness.orchestrator,
      fakeGit: retryHarness.fakeGit,
      platform: retryHarness.platform,
      role: "architect",
      actorId: "architect-invalid",
      sessionId: "architect-self-declared-session",
      principalId: lastImplementation.coderReport.identity_attestation.claims.principal_id,
      attestedSessionId: lastImplementation.coderReport.identity_attestation.claims.session_id,
      attemptId: "architect-1",
      baseCommit: architectLease.base_commit,
      candidateCommit: lastImplementation.candidateCommit,
      contextHash: lastImplementation.contextHash,
      verdict: "REPLAN",
      decision: { category: "A", reason: "same trusted session as coder" },
    });
    expectError("architect:must-be-independent-from-writer-and-reviewers", () => retryHarness.orchestrator.record({ runId: "retry", report: selfArchitect }), "SELF_REVIEW_BLOCKED");
    invalidArchitect.decision.category = "B";
    resignReport(retryHarness, invalidArchitect);
    expectError("architect:self-reported-a-b-without-matching-boundary", () => retryHarness.orchestrator.record({ runId: "retry", report: invalidArchitect }), "PLATFORM_RECEIPT_CLAIMS_MISMATCH");
    const validArchitect = selfTestReport({
      orchestrator: retryHarness.orchestrator,
      fakeGit: retryHarness.fakeGit,
      platform: retryHarness.platform,
      role: "architect",
      actorId: "architect-invalid",
      sessionId: "architect-session-valid",
      attemptId: "architect-1",
      baseCommit: architectLease.base_commit,
      candidateCommit: lastImplementation.candidateCommit,
      contextHash: lastImplementation.contextHash,
      verdict: "REPLAN",
      decision: { category: "A", reason: "signed technical boundary" },
    });
    const firstArchitectEvent = retryHarness.orchestrator.record({ runId: "retry", report: validArchitect });
    assertCheck("architect:first-signed-replan", firstArchitectEvent.to_status === "READY" && firstArchitectEvent.counters.replan === 1, firstArchitectEvent);
    const secondReplan = failThree(4);
    assertCheck("replan:second-architect-opportunity", secondReplan.to_status === "REPLAN" && secondReplan.counters.replan === 2, secondReplan);
    const secondArchitect = architectDecision({ harness: retryHarness, runId: "retry", implementation: lastImplementation, category: "B", attempt: "architect-2" });
    assertCheck("architect:second-signed-replan", secondArchitect.event.to_status === "READY" && secondArchitect.event.counters.replan === 2, secondArchitect.event);
    const exhausted = failThree(7);
    assertCheck("replan:critical-exhaustion-after-two-architects", exhausted.to_status === "CREATOR_REQUIRED" && exhausted.creator_required_reason === "CRITICAL_PATH_REPLAN_LIMIT_EXHAUSTED", exhausted);
    expectError("creator-required:cannot-clear-with-string", () => retryHarness.orchestrator.transition({ runId: "retry", taskId: "F0-01-REPO", toStatus: "READY", attemptId: "fake", creatorApprovalEvidence: "CREATOR_EXPLICIT_FAKE" }), "CREATOR_CONTROL_UPDATE_REQUIRED");
    const noncriticalTask = retryHarness.orchestrator.router.tasks.find((task) => !retryHarness.orchestrator.isCriticalTask(task.id));
    assertCheck("replan:noncritical-task-found", Boolean(noncriticalTask), noncriticalTask?.id);
    const noncriticalDisposition = retryHarness.orchestrator.evidenceFailureState(noncriticalTask.id, { counters: { retry: 8, rework: 2, replan: 2 } }, Object.assign(new Error("failure"), { code: "TEST_FAILURE" }));
    assertCheck("replan:noncritical-two-replans-block", noncriticalDisposition.toStatus === "BLOCKED" && noncriticalDisposition.decisionLevel === "BLOCKED_TECHNICAL", noncriticalDisposition);
    assertCheck("critical:dependency-ancestry-includes-s1-fp001-03", retryHarness.orchestrator.isCriticalTask("S1-FP001-03"), "S1-FP001-03");

    const noncriticalCoderTask = retryHarness.orchestrator.router.tasks.find((task) => task.values["角色"] === "VIEW::CODER" && !retryHarness.orchestrator.isCriticalTask(task.id));
    invariant(noncriticalCoderTask, "self-test requires a real noncritical coder Task");
    const noncriticalHarness = makeHarness({ readyTaskId: noncriticalCoderTask.id });
    let noncriticalImplementation = null;
    const failNoncriticalThree = (start) => {
      let event = null;
      for (let offset = 0; offset < 3; offset += 1) {
        const number = start + offset;
        noncriticalImplementation = implement({
          harness: noncriticalHarness,
          runId: "noncritical-retry",
          taskId: noncriticalCoderTask.id,
          attempt: `noncritical-${number}`,
          candidateCommit: sha256(`noncritical-candidate-${number}`).slice(0, 40),
        });
        event = review({
          harness: noncriticalHarness,
          runId: "noncritical-retry",
          implementation: noncriticalImplementation,
          role: "auditor",
          verdict: "FAIL",
          attempt: `noncritical-audit-fail-${number}`,
        }).event;
      }
      return event;
    };
    const noncriticalFirstReplan = failNoncriticalThree(1);
    const noncriticalFirstArchitect = architectDecision({ harness: noncriticalHarness, runId: "noncritical-retry", implementation: noncriticalImplementation, category: "A", attempt: "noncritical-architect-1" });
    const noncriticalSecondReplan = failNoncriticalThree(4);
    const noncriticalSecondArchitect = architectDecision({ harness: noncriticalHarness, runId: "noncritical-retry", implementation: noncriticalImplementation, category: "B", attempt: "noncritical-architect-2" });
    const noncriticalExhausted = failNoncriticalThree(7);
    assertCheck("replan:real-noncritical-two-architect-rounds", noncriticalFirstReplan.to_status === "REPLAN"
      && noncriticalFirstArchitect.event.to_status === "READY"
      && noncriticalSecondReplan.to_status === "REPLAN"
      && noncriticalSecondArchitect.event.to_status === "READY", {
      task_id: noncriticalCoderTask.id,
      first_replan: noncriticalFirstReplan.to_status,
      second_replan: noncriticalSecondReplan.to_status,
    });
    assertCheck("replan:real-noncritical-exhaustion-blocked", noncriticalExhausted.to_status === "BLOCKED"
      && noncriticalExhausted.decision_level === "BLOCKED_TECHNICAL", noncriticalExhausted);

    const architectCHarness = makeHarness();
    let architectCImplementation = null;
    for (let number = 1; number <= 3; number += 1) {
      architectCImplementation = implement({
        harness: architectCHarness,
        runId: "architect-c",
        attempt: `architect-c-${number}`,
        candidateCommit: sha256(`architect-c-candidate-${number}`).slice(0, 40),
      });
      review({ harness: architectCHarness, runId: "architect-c", implementation: architectCImplementation, role: "auditor", verdict: "FAIL", attempt: `architect-c-audit-${number}` });
    }
    const architectC = architectDecision({ harness: architectCHarness, runId: "architect-c", implementation: architectCImplementation, category: "C", attempt: "architect-c-decision" });
    assertCheck("architect:c-hard-stops-creator-required", architectC.event.to_status === "CREATOR_REQUIRED"
      && architectC.event.decision_level === "CREATOR_REQUIRED", architectC.event);
    const architectCLines = fs.readFileSync(architectCHarness.orchestrator.store.eventsPath, "utf8").trimEnd().split(/\r?\n/);
    const forgedArchitectC = JSON.parse(architectCLines.at(-1));
    forgedArchitectC.to_status = "READY";
    forgedArchitectC.decision_level = "ARCHITECT_AUTONOMOUS";
    forgedArchitectC.creator_required_reason = null;
    forgedArchitectC.event_hash = hashEvent(forgedArchitectC);
    architectCLines[architectCLines.length - 1] = JSON.stringify(forgedArchitectC);
    fs.writeFileSync(architectCHarness.orchestrator.store.eventsPath, `${architectCLines.join("\n")}\n`, "utf8");
    expectError("events:external-head-detects-architect-remap", () => architectCHarness.orchestrator.store.read(), "EVENT_HEAD_MISMATCH");
    architectCHarness.monotonicHead.forceForSemanticTest(architectCLines.map((line) => JSON.parse(line)));
    expectError("events:architect-c-cannot-be-remapped-to-ready", () => architectCHarness.orchestrator.store.read(), "EVENT_ARCHITECT_DECISION_INVALID");

    const selfReviewHarness = makeHarness();
    const selfReviewImplementation = implement({ harness: selfReviewHarness, runId: "self-review", attempt: "self-1", candidateCommit: "5".repeat(40), principalId: "shared-principal", attestedSessionId: "shared-session" });
    passReviews({ harness: selfReviewHarness, runId: "self-review", implementation: selfReviewImplementation, suffix: "self", identities: { auditorPrincipal: "shared-principal", auditorSession: "shared-session" } });
    expectError("identity:trusted-self-review-blocked", () => selfReviewHarness.orchestrator.verifyEvidence({ runId: "self-review", taskId: "F0-01-REPO", candidateCommit: selfReviewImplementation.candidateCommit, verificationReceipt: verificationReceipt(selfReviewHarness) }), "SELF_REVIEW_BLOCKED");

    const dirtyHarness = makeHarness();
    const dirtyImplementation = implement({ harness: dirtyHarness, runId: "dirty", attempt: "dirty-1", candidateCommit: "6".repeat(40) });
    passReviews({ harness: dirtyHarness, runId: "dirty", implementation: dirtyImplementation, suffix: "dirty" });
    dirtyHarness.fakeGit.clean = false;
    expectError("evidence:dirty-worktree", () => dirtyHarness.orchestrator.verifyEvidence({ runId: "dirty", taskId: "F0-01-REPO", candidateCommit: dirtyImplementation.candidateCommit, verificationReceipt: verificationReceipt(dirtyHarness) }), "WORKTREE_DIRTY");
    assertCheck("evidence:dirty-enters-rework", dirtyHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", dirtyHarness.orchestrator.store.read().at(-1));

    const staleHarness = makeHarness();
    const staleImplementation = implement({ harness: staleHarness, runId: "stale", attempt: "stale-1", candidateCommit: "7".repeat(40) });
    passReviews({ harness: staleHarness, runId: "stale", implementation: staleImplementation, suffix: "stale" });
    staleHarness.fakeGit.commits.add("8".repeat(40));
    staleHarness.fakeGit.headCommit = "8".repeat(40);
    expectError("evidence:new-commit-invalidates-audit", () => staleHarness.orchestrator.verifyEvidence({ runId: "stale", taskId: "F0-01-REPO", candidateCommit: staleImplementation.candidateCommit, verificationReceipt: verificationReceipt(staleHarness) }), "STALE_CANDIDATE_COMMIT");

    const resumeStaleHarness = makeHarness();
    const resumeStaleImplementation = implement({ harness: resumeStaleHarness, runId: "resume-stale", attempt: "resume-stale-1", candidateCommit: "9".repeat(40) });
    resumeStaleHarness.fakeGit.commits.add("a".repeat(40));
    resumeStaleHarness.fakeGit.headCommit = "a".repeat(40);
    const staleResume = resumeStaleHarness.orchestrator.resume({ runId: "resume-stale-new-run" });
    assertCheck("resume:stale-candidate-enters-rework", staleResume.recovered_stale_candidates.length === 1
      && resumeStaleHarness.orchestrator.project().taskStates.get("F0-01-REPO").status === "REWORK", staleResume);

    const forgeHarness = makeHarness();
    const forgeImplementation = implement({ harness: forgeHarness, runId: "forge", attempt: "forge-1", candidateCommit: "b".repeat(40) });
    passReviews({ harness: forgeHarness, runId: "forge", implementation: forgeImplementation, suffix: "forge" });
    verifySigned(forgeHarness, "forge", forgeImplementation);
    const forgedLines = fs.readFileSync(forgeHarness.orchestrator.store.eventsPath, "utf8").trimEnd().split(/\r?\n/);
    const forgedFinal = JSON.parse(forgedLines.at(-1));
    forgedFinal.platform_receipts = [];
    forgedFinal.event_hash = hashEvent(forgedFinal);
    forgedLines[forgedLines.length - 1] = JSON.stringify(forgedFinal);
    fs.writeFileSync(forgeHarness.orchestrator.store.eventsPath, `${forgedLines.join("\n")}\n`, "utf8");
    expectError("events:external-head-detects-recomputed-chain", () => forgeHarness.orchestrator.store.read(), "EVENT_HEAD_MISMATCH");
    forgeHarness.monotonicHead.forceForSemanticTest(forgedLines.map((line) => JSON.parse(line)));
    expectError("events:recomputed-chain-cannot-forge-verified", () => forgeHarness.orchestrator.store.read(), "PLATFORM_RECEIPT_REQUIRED");
    assertCheck("events:no-signing-private-key-in-state-dir", fs.readdirSync(forgeHarness.stateDir).every((name) => !name.includes("key") && !name.includes("private")), fs.readdirSync(forgeHarness.stateDir));

    const newlineHarness = makeHarness();
    const meterOne = signedMeter(newlineHarness, "newline", { tokens: 1, timeMs: 1, knownCost: null });
    newlineHarness.orchestrator.recordUsage({ runId: "newline", meterReceipt: meterOne });
    const noNewline = fs.readFileSync(newlineHarness.orchestrator.store.eventsPath, "utf8").trimEnd();
    fs.writeFileSync(newlineHarness.orchestrator.store.eventsPath, noNewline, "utf8");
    const meterTwo = signedMeter(newlineHarness, "newline", { tokens: 1, timeMs: 1, knownCost: null });
    newlineHarness.orchestrator.recordUsage({ runId: "newline", meterReceipt: meterTwo });
    assertCheck("events:complete-json-no-newline-append-safe", newlineHarness.orchestrator.store.read().length === 2, fs.readFileSync(newlineHarness.orchestrator.store.eventsPath, "utf8").split(/\r?\n/).length);

    const completeTailHarness = makeHarness();
    completeTailHarness.orchestrator.recordUsage({ runId: "complete-tail", meterReceipt: signedMeter(completeTailHarness, "complete-tail", { tokens: 1, timeMs: 1, knownCost: null }) });
    fs.writeFileSync(completeTailHarness.orchestrator.store.eventsPath, fs.readFileSync(completeTailHarness.orchestrator.store.eventsPath, "utf8").trimEnd(), "utf8");
    const completeTailResume = completeTailHarness.orchestrator.resume({ runId: "complete-tail" });
    assertCheck("resume:complete-json-tail-normalized", completeTailResume.recovered_truncated_tail?.complete_tail_newline_added === true
      && completeTailHarness.orchestrator.store.read().at(-1).event_type === "EVENT_LOG_TAIL_RECOVERED", completeTailResume.recovered_truncated_tail);

    const combinedRecoveryHarness = makeHarness();
    combinedRecoveryHarness.orchestrator.recordUsage({ runId: "combined-recovery", meterReceipt: signedMeter(combinedRecoveryHarness, "combined-recovery", { tokens: 1, timeMs: 1, knownCost: 0 }) });
    combinedRecoveryHarness.orchestrator.recordUsage({ runId: "combined-recovery", meterReceipt: signedMeter(combinedRecoveryHarness, "combined-recovery", { tokens: 2, timeMs: 2, knownCost: 0 }) });
    const combinedEvents = combinedRecoveryHarness.orchestrator.store.read();
    combinedRecoveryHarness.monotonicHead.forceForSemanticTest([combinedEvents[0]]);
    fs.writeFileSync(combinedRecoveryHarness.orchestrator.store.eventsPath, fs.readFileSync(combinedRecoveryHarness.orchestrator.store.eventsPath, "utf8").trimEnd(), "utf8");
    const combinedResume = combinedRecoveryHarness.orchestrator.resume({ runId: "combined-recovery" });
    assertCheck("resume:local-ahead-complete-tail-without-newline-reconciles", combinedResume.recovered_truncated_tail?.complete_tail_newline_added === true
      && combinedResume.external_head_reconciled?.from?.event_count === 1
      && combinedResume.external_head_reconciled?.to?.event_count === 2
      && combinedRecoveryHarness.monotonicHead.read().event_count === 3, combinedResume);

    const deterministicHarness = makeHarness();
    deterministicHarness.orchestrator.recordUsage({ runId: "deterministic", meterReceipt: signedMeter(deterministicHarness, "deterministic", { tokens: 1, timeMs: 2, knownCost: 0 }) });
    const firstDeterministicResume = deterministicHarness.orchestrator.resume({ runId: "deterministic" });
    const secondDeterministicResume = deterministicHarness.orchestrator.resume({ runId: "deterministic" });
    assertCheck("resume:deterministic-replay", firstDeterministicResume.replay_hash === secondDeterministicResume.replay_hash
      && firstDeterministicResume.event_count === secondDeterministicResume.event_count
      && stableJson(firstDeterministicResume.next) === stableJson(secondDeterministicResume.next), {
      first: firstDeterministicResume,
      second: secondDeterministicResume,
    });

    const truncatedHarness = makeHarness();
    truncatedHarness.orchestrator.recordUsage({ runId: "truncated", meterReceipt: signedMeter(truncatedHarness, "truncated", { tokens: 1, timeMs: 1, knownCost: null }) });
    fs.appendFileSync(truncatedHarness.orchestrator.store.eventsPath, "{\"partial\":", "utf8");
    const truncatedResume = truncatedHarness.orchestrator.resume({ runId: "truncated" });
    assertCheck("resume:invalid-tail-quarantined", truncatedResume.recovered_truncated_tail?.rejected_tail_bytes > 0
      && fs.existsSync(path.join(truncatedHarness.stateDir, truncatedResume.recovered_truncated_tail.quarantine_path)), truncatedResume.recovered_truncated_tail);

    let leaseClock = new Date("2026-07-11T12:00:00.000Z");
    const crossRunHarness = makeHarness({ clock: () => new Date(leaseClock) });
    signedLease(crossRunHarness, { runId: "old-run", role: "coder", actorId: "old-writer", attemptId: "old-lease", ttlSeconds: 1 });
    leaseClock = new Date("2026-07-11T12:00:02.000Z");
    const crossRunResume = crossRunHarness.orchestrator.resume({ runId: "new-run" });
    const newRunLease = signedLease(crossRunHarness, { runId: "new-run", role: "coder", actorId: "new-writer", attemptId: "new-lease" });
    assertCheck("lease:cross-run-expiry-recovered", crossRunResume.recovered_expired_leases.length === 1
      && newRunLease.to_status === "LEASED", { crossRunResume, newRunLease });

    const budgetHarness = makeHarness({ policyChanges: { budget: { limits: { tokens: 100, elapsed_ms: null, known_cost: null } } } });
    expectError("budget:caller-usage-without-meter-rejected", () => budgetHarness.orchestrator.recordUsage({ runId: "budget", execution: { tokens: 80, time_ms: 0, known_cost: null } }), "PLATFORM_RECEIPT_REQUIRED");
    const eighty = signedMeter(budgetHarness, "budget", { tokens: 80, timeMs: 0, knownCost: null });
    budgetHarness.orchestrator.recordUsage({ runId: "budget", meterReceipt: eighty, limits: { tokens: 1000000 } });
    assertCheck("budget:registered-limit-cannot-be-overridden", budgetHarness.orchestrator.budgetState("budget").dimensions.find((item) => item.name === "tokens").limit === 100
      && budgetHarness.orchestrator.budgetState("budget").state === "NOTIFY_80_PERCENT", budgetHarness.orchestrator.budgetState("budget"));
    const twenty = signedMeter(budgetHarness, "budget", { tokens: 20, timeMs: 0, knownCost: null });
    budgetHarness.orchestrator.recordUsage({ runId: "budget", meterReceipt: twenty });
    assertCheck("budget:platform-metered-100-hard-stop", budgetHarness.orchestrator.evaluateAction("PRODUCT_TASK_WRITE", "budget").reason === "BUDGET_100_PERCENT_OR_UNKNOWN_COST", budgetHarness.orchestrator.budgetState("budget"));
    expectError("budget:meter-receipt-reuse-rejected", () => budgetHarness.orchestrator.recordUsage({ runId: "budget", meterReceipt: twenty }), "PLATFORM_RECEIPT_REUSED");
    const tamperedMeter = clone(signedMeter(budgetHarness, "budget-tampered", { tokens: 1, timeMs: 1, knownCost: 0 }));
    tamperedMeter.claims.tokens = 2;
    expectError("budget:tampered-meter-signature-rejected", () => budgetHarness.orchestrator.recordUsage({ runId: "budget-tampered", meterReceipt: tamperedMeter }), "PLATFORM_RECEIPT_SIGNATURE_INVALID");

    const rollbackHarness = makeHarness({ policyChanges: { budget: { limits: { tokens: 100, elapsed_ms: null, known_cost: null } } } });
    rollbackHarness.orchestrator.recordUsage({ runId: "rollback", meterReceipt: signedMeter(rollbackHarness, "rollback", { tokens: 80, timeMs: 0, knownCost: 0 }) });
    rollbackHarness.orchestrator.recordUsage({ runId: "rollback", meterReceipt: signedMeter(rollbackHarness, "rollback", { tokens: 20, timeMs: 0, knownCost: 0 }) });
    const rollbackLines = fs.readFileSync(rollbackHarness.orchestrator.store.eventsPath, "utf8").trimEnd().split(/\r?\n/);
    fs.writeFileSync(rollbackHarness.orchestrator.store.eventsPath, `${rollbackLines.slice(0, -1).join("\n")}\n`, "utf8");
    expectError("events:complete-tail-deletion-cannot-rollback-budget", () => rollbackHarness.orchestrator.project(), "EVENT_LOG_ROLLBACK_DETECTED");

    const fullDeletionHarness = makeHarness();
    fullDeletionHarness.orchestrator.recordUsage({ runId: "full-delete", meterReceipt: signedMeter(fullDeletionHarness, "full-delete", { tokens: 1, timeMs: 0, knownCost: 0 }) });
    fs.unlinkSync(fullDeletionHarness.orchestrator.store.eventsPath);
    expectError("events:whole-log-deletion-detected", () => fullDeletionHarness.orchestrator.project(), "EVENT_LOG_ROLLBACK_DETECTED");

    const reconcileHarness = makeHarness();
    reconcileHarness.orchestrator.recordUsage({ runId: "reconcile", meterReceipt: signedMeter(reconcileHarness, "reconcile", { tokens: 1, timeMs: 0, knownCost: 0 }) });
    reconcileHarness.monotonicHead.forceForSemanticTest([]);
    const reconciled = reconcileHarness.orchestrator.resume({ runId: "reconcile" });
    assertCheck("events:resume-reconciles-valid-local-ahead-head", reconciled.external_head_reconciled?.to?.event_count === 1
      && reconcileHarness.monotonicHead.read().event_count === 1, reconciled.external_head_reconciled);
    const reportBudgetHarness = makeHarness({ policyChanges: { budget: { limits: { tokens: 100, elapsed_ms: null, known_cost: null } } } });
    implement({ harness: reportBudgetHarness, runId: "report-budget", attempt: "report-budget-1", candidateCommit: "c".repeat(40), mutateReport: (report) => { report.execution.tokens = 999999; } });
    assertCheck("budget:role-report-usage-not-authoritative", reportBudgetHarness.orchestrator.budgetState("report-budget").dimensions.find((item) => item.name === "tokens").used === 0, reportBudgetHarness.orchestrator.budgetState("report-budget"));

    const lockHarness = makeHarness();
    const oldOwner = lockHarness.orchestrator.store.acquireLock();
    fs.closeSync(oldOwner.descriptor);
    oldOwner.descriptor = fs.openSync(os.devNull, "r");
    fs.writeFileSync(lockHarness.orchestrator.store.lockPath, JSON.stringify({ nonce: "replacement-owner", pid: process.pid, hostname: os.hostname(), acquired_at: new Date().toISOString() }), "utf8");
    lockHarness.orchestrator.store.releaseLock(oldOwner);
    assertCheck("lock:old-owner-cannot-delete-replacement", fs.existsSync(lockHarness.orchestrator.store.lockPath), lockHarness.orchestrator.store.lockRecord());
    if (fs.existsSync(lockHarness.orchestrator.store.lockPath)) fs.unlinkSync(lockHarness.orchestrator.store.lockPath);

    const corruptLockHarness = makeHarness({ policyChanges: { concurrency: { lock_stale_ms: 1 } } });
    fs.writeFileSync(corruptLockHarness.orchestrator.store.lockPath, "{", "utf8");
    const oldLockTime = new Date(Date.now() - 60_000);
    fs.utimesSync(corruptLockHarness.orchestrator.store.lockPath, oldLockTime, oldLockTime);
    const recoveredCorruptOwner = corruptLockHarness.orchestrator.store.acquireLock();
    corruptLockHarness.orchestrator.store.releaseLock(recoveredCorruptOwner);
    assertCheck("lock:stale-corrupt-lock-quarantined-and-recovered", fs.readdirSync(corruptLockHarness.orchestrator.store.quarantinePath).some((name) => name.includes("stale.corrupt")), fs.readdirSync(corruptLockHarness.orchestrator.store.quarantinePath));

    const diffRoot = fs.mkdtempSync(path.join(os.tmpdir(), "g07-delete-diff-v3-"));
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
    fs.writeFileSync(path.join(diffRoot, "binary-secret.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(fakeSecret, "ascii"), Buffer.from([0, 3]) ]));
    runFixtureGit(["add", "binary-secret.bin"]);
    runFixtureGit(["commit", "--quiet", "-m", "binary secret"]);
    const binaryCandidate = runFixtureGit(["rev-parse", "HEAD"]);
    const realBinaryBlobs = new GitClient(diffRoot).changedBlobs(deletionCandidate, binaryCandidate);
    assertCheck("secret:real-git-binary-blob-bytes-scanned", realBinaryBlobs.length === 1
      && realBinaryBlobs[0].bytes.includes(0)
      && promptHarness.orchestrator.scanSecretBytes(realBinaryBlobs[0].bytes).includes("OPENAI_KEY"), realBinaryBlobs.map((item) => ({ path: item.path, bytes: item.bytes.length })));

    for (const action of MANDATORY_HARD_STOP_ACTIONS) {
      const result = promptHarness.orchestrator.evaluateAction(action, "actions");
      assertCheck(`hard-stop:${action}`, !result.allowed && result.hard_stop, result);
    }
    assertCheck("events:projection-not-manual", !fs.existsSync(path.join(goodHarness.stateDir, "projection.json")), goodHarness.stateDir);
  } finally {
    for (const tempRoot of tempRoots) {
      const resolved = path.resolve(tempRoot);
      if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
    }
  }

  const passed = checks.filter((check) => check.passed).length;
  return {
    schema_version: "project-orchestrator-self-test/v4",
    passed: passed === checks.length,
    assertions: { passed, failed: checks.length - passed, total: checks.length },
    failed_checks: checks.filter((check) => !check.passed),
    coverage: {
      guard: ["normalized known actions", "default deny unknown/destructive/external/paid"],
      platform_trust: ["production Ed25519 provider path", "no private key in workspace", "trusted receipt inbox realpath/type/hardlink boundary", "receipt claims/signature/reuse"],
      event_integrity: ["external monotonic head", "complete tail and whole-log rollback detection", "valid local-ahead reconciliation", "semantic replay"],
      workspace_capability: ["platform-enforced exact write scope", "denied .git/.autonomy/.env", "writer identity binding", "ignored path snapshot"],
      evidence: ["command stdout/regression", "identity", "audit", "review", "Git scope including deletion", "text/binary/oversize candidate blob secret scan", "historical control-context VERIFIED replay", "VERIFICATION_GATE replay"],
      recovery: ["intermittent failure", "two Architect replans", "noncritical exhaustion", "cross-run lease", "stale candidate", "complete/truncated tail", "corrupt stale lock quarantine"],
      budget: ["registered immutable limits", "platform metering only", "80/100 thresholds"],
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
    "  node tools/project-orchestrator.mjs lease --run-id ID [--task-id ID | --slice-id ID] --role ROLE --actor-id ID --attempt-id ID --platform-receipt-file NAME [--workspace-capability-receipt-file NAME] [--ttl-seconds N]",
    "  node tools/project-orchestrator.mjs record --run-id ID --report-file PATH",
    "  node tools/project-orchestrator.mjs verify-evidence --run-id ID --task-id ID --candidate-commit SHA --verification-receipt-file PATH [--context-hash SHA256]",
    "  node tools/project-orchestrator.mjs transition --run-id ID --task-id ID --to-status STATUS [--platform-receipt-file PATH | --resolution-receipt-file PATH] [--candidate-commit SHA]",
    "  node tools/project-orchestrator.mjs unlock --run-id ID --receipts-file PATH",
    "  node tools/project-orchestrator.mjs record-usage --run-id ID --meter-receipt-file PATH",
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
    invariant(!options.root || path.resolve(options.root) === DEFAULT_ROOT, "--root cannot redirect the production control plane", "CLI_ARGUMENT_INVALID");
    if (options.self_test) {
      const report = runOrchestratorSelfTest(DEFAULT_ROOT);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) process.exitCode = 1;
      return;
    }
    invariant(command, usage(), "CLI_USAGE");
    const root = DEFAULT_ROOT;
    invariant(!options.state_dir, "--state-dir is reserved for internal self-test authority", "CLI_ARGUMENT_INVALID");
    const orchestrator = new ProjectOrchestrator({ root });
    const common = { runId: options.run_id ?? "default" };
    let output;
    if (command === "status") output = orchestrator.status(common);
    else if (command === "dry-run") output = orchestrator.dryRun(common);
    else if (command === "lease") output = orchestrator.lease({
      ...common,
      taskId: options.task_id ?? null,
      sliceId: options.slice_id ?? null,
      role: options.role,
      actorId: options.actor_id,
      attemptId: options.attempt_id,
      ttlSeconds: options.ttl_seconds,
      contextHash: options.context_hash,
      baseCommit: options.base_commit,
      candidateCommit: options.candidate_commit,
      platformReceipt: orchestrator.readTrustedJson(options.platform_receipt_file, "--platform-receipt-file"),
      workspaceCapabilityReceipt: options.workspace_capability_receipt_file
        ? orchestrator.readTrustedJson(options.workspace_capability_receipt_file, "--workspace-capability-receipt-file")
        : null,
    });
    else if (command === "record") output = orchestrator.record({ ...common, report: orchestrator.readTrustedJson(options.report_file, "--report-file") });
    else if (command === "verify-evidence") output = orchestrator.verifyEvidence({
      ...common,
      taskId: options.task_id,
      candidateCommit: options.candidate_commit,
      contextHash: options.context_hash,
      attemptId: options.attempt_id,
      verificationReceipt: orchestrator.readTrustedJson(options.verification_receipt_file, "--verification-receipt-file"),
    });
    else if (command === "transition") {
      invariant(Boolean(options.platform_receipt_file) !== Boolean(options.resolution_receipt_file), "transition requires exactly one platform or resolution receipt file", "CLI_ARGUMENT_INVALID");
      output = orchestrator.transition({
        ...common,
        taskId: options.task_id,
        toStatus: options.to_status,
        attemptId: options.attempt_id,
        role: options.role ?? "orchestrator",
        candidateCommit: options.candidate_commit,
        contextHash: options.context_hash,
        decisionLevel: options.decision_level ?? "TASK_AUTONOMOUS",
        platformReceipt: options.platform_receipt_file ? orchestrator.readTrustedJson(options.platform_receipt_file, "--platform-receipt-file") : null,
        resolutionReceipt: options.resolution_receipt_file ? orchestrator.readTrustedJson(options.resolution_receipt_file, "--resolution-receipt-file") : null,
      });
    }
    else if (command === "unlock") output = orchestrator.unlock({ ...common, receiptsByTask: orchestrator.readTrustedJson(options.receipts_file, "--receipts-file") });
    else if (command === "record-usage") output = orchestrator.recordUsage({ ...common, meterReceipt: orchestrator.readTrustedJson(options.meter_receipt_file, "--meter-receipt-file") });
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
