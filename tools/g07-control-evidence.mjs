#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const CONTROL_PATH = "docs/IMPLEMENTATION_CONTROL.md";
const BASELINE_COMMIT = "7faa8c132de6a2e66829d3d4b89364b56181e022";
const BASELINE_LOADER_PATH = "tools/project-context-loader.mjs";

const ALLOWED_G07_PATHS = new Set([
  ".autonomy/.gitignore",
  ".autonomy/policy.json",
  ".gitattributes",
  "DEV_HARNESS.md",
  "README.md",
  "docs/G07_A_EVIDENCE.json",
  "docs/G07_A_EVIDENCE_V3.json",
  "docs/G07_A_EVIDENCE_V4.json",
  "docs/G07_A_EVIDENCE_V5.json",
  "docs/G07_A_EVIDENCE_V6.json",
  "docs/IMPLEMENTATION_CONTROL.md",
  "tools/g07-control-evidence.mjs",
  "tools/project-context-loader.mjs",
  "tools/project-orchestrator.mjs",
]);

const SECRET_PATTERNS = new Map([
  ["AWS_ACCESS_KEY", /AKIA[0-9A-Z]{16}/],
  ["OPENAI_KEY", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["GITHUB_TOKEN", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["ANTHROPIC_KEY", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["GOOGLE_API_KEY", /AIza[0-9A-Za-z_-]{30,}/],
  ["SLACK_TOKEN", /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
]);

const LF_REPRODUCIBLE_PATHS = [
  "tools/project-context-loader.mjs",
  "tools/g07-control-evidence.mjs",
  "tools/project-orchestrator.mjs",
  "docs/IMPLEMENTATION_CONTROL.md",
  "docs/G07_A_EVIDENCE_V4.json",
  "docs/G07_A_EVIDENCE_V5.json",
];

function invariant(condition, message, code = "G07_EVIDENCE_ERROR", details = null) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function run(root, executable, args, { input = null, encoding = "utf8", allowFailure = false, maxBuffer = 256 * 1024 * 1024 } = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    input,
    encoding,
    windowsHide: true,
    shell: false,
    maxBuffer,
  });
  if (!allowFailure) invariant(result.status === 0, `${executable} ${args.join(" ")} failed`, "COMMAND_FAILED", {
    exit_code: result.status,
    stderr_sha256: sha256(result.stderr ?? ""),
  });
  return result;
}

function gitBuffer(root, args) {
  return run(root, "git", args, { encoding: null }).stdout ?? Buffer.alloc(0);
}

function gitText(root, args) {
  return String(run(root, "git", args).stdout ?? "").trim();
}

function controlValues(root) {
  const text = fs.readFileSync(path.join(root, CONTROL_PATH), "utf8");
  return new Map([...text.matchAll(/^([A-Z0-9_-]+)=(.*)$/gm)].map((match) => [match[1], match[2].trim()]));
}

function commitExists(root, commit) {
  if (!/^[a-f0-9]{40,64}$/.test(String(commit ?? ""))) return false;
  return run(root, "git", ["cat-file", "-e", `${commit}^{commit}`], { allowFailure: true }).status === 0;
}

function commitIsAncestor(root, ancestor, descendant) {
  return run(root, "git", ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
}

function commitFile(root, commit, relativePath) {
  return gitBuffer(root, ["show", `${commit}:${relativePath}`]);
}

function baselineCompatibility(root) {
  const loaderBytes = gitBuffer(root, ["show", `${BASELINE_COMMIT}:${BASELINE_LOADER_PATH}`]);
  const controlBytes = gitBuffer(root, ["show", `${BASELINE_COMMIT}:${CONTROL_PATH}`]);
  const values = controlValues(root);
  invariant(sha256(loaderBytes) === values.get("G06_BASELINE_ARTIFACT_SHA256"), "baseline loader hash does not match the active registration", "G06_BASELINE_HASH_MISMATCH");
  invariant(values.get("G06_BASELINE_TEST_ASSERTIONS") === "58", "baseline assertion registration is not 58", "G06_BASELINE_ASSERTIONS_MISMATCH");

  let source = loaderBytes.toString("utf8");
  const injection = `
const __g07EvidenceReadFileSync = fs.readFileSync.bind(fs);
const __g07EvidenceLoader = Buffer.from("${loaderBytes.toString("base64")}", "base64");
const __g07EvidenceControl = Buffer.from("${controlBytes.toString("base64")}", "base64");
fs.readFileSync = (filePath, options) => {
  const normalized = normalizePath(path.resolve(String(filePath))).toLowerCase();
  let bytes = null;
  if (normalized.endsWith("/tools/project-context-loader.mjs")) bytes = __g07EvidenceLoader;
  if (normalized.endsWith("/docs/implementation_control.md")) bytes = __g07EvidenceControl;
  if (!bytes) return __g07EvidenceReadFileSync(filePath, options);
  const encoding = typeof options === "string" ? options : options?.encoding;
  return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
};
`;
  const marker = source.lastIndexOf("main();");
  invariant(marker >= 0, "baseline loader main marker is missing", "G06_BASELINE_SOURCE_INVALID");
  source = source.slice(0, marker) + injection + source.slice(marker);
  const execution = run(root, process.execPath, ["--input-type=module", "-", "--self-test", "--root", root], { input: Buffer.from(source), encoding: null });
  const stdout = execution.stdout ?? Buffer.alloc(0);
  const parsed = JSON.parse(stdout.toString("utf8"));
  invariant(parsed.passed === true && parsed.assertions?.passed === 58 && parsed.assertions?.total === 58
    && (parsed.business_acceptance ?? []).every((item) => item.passed), "baseline G06 compatibility self-test failed", "G06_BASELINE_TEST_FAILED", parsed.failed_checks ?? null);
  return {
    source_commit: BASELINE_COMMIT,
    execution_mode: "REPOSITORY_EXECUTABLE_IN_MEMORY_GIT_OBJECTS",
    loader_sha256: sha256(loaderBytes),
    control_sha256: sha256(controlBytes),
    exit_code: execution.status,
    stdout_sha256: sha256(stdout),
    assertions: parsed.assertions,
    business_acceptance_passed: true,
  };
}

function changedPaths(root, baseCommit, candidateCommit) {
  const raw = gitBuffer(root, ["-c", "core.quotepath=false", "diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB", baseCommit, candidateCommit]);
  return [...new Set(raw.toString("utf8").split("\0").map(normalizePath).filter(Boolean))].sort();
}

function candidateBlob(root, candidateCommit, relativePath) {
  const tree = gitBuffer(root, ["ls-tree", "-z", candidateCommit, "--", relativePath]);
  if (!tree.length) return null;
  const tab = tree.indexOf(0x09);
  invariant(tab > 0, `malformed Git tree entry for ${relativePath}`, "CANDIDATE_BLOB_INVALID");
  const [mode, type, oid] = tree.subarray(0, tab).toString("utf8").split(" ");
  invariant(type === "blob" && /^[a-f0-9]{40,64}$/.test(oid), `unscannable candidate object for ${relativePath}`, "CANDIDATE_BLOB_INVALID", { mode, type });
  return { mode, oid, bytes: gitBuffer(root, ["cat-file", "blob", oid]) };
}

function scanBlob(bytes) {
  const text = bytes.toString("latin1");
  return [...SECRET_PATTERNS.entries()].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function scanBaselineCandidate(root, baseCommit, candidateCommit) {
  const candidate = gitText(root, ["rev-parse", candidateCommit]);
  const paths = changedPaths(root, baseCommit, candidate);
  const unexpectedPaths = paths.filter((item) => !ALLOWED_G07_PATHS.has(item));
  const maxBlobBytes = 16 * 1024 * 1024;
  const blobs = [];
  const hitTypes = new Set();
  for (const relativePath of paths) {
    if (!ALLOWED_G07_PATHS.has(relativePath)) continue;
    const blob = candidateBlob(root, candidate, relativePath);
    if (!blob) continue;
    const hits = blob.bytes.length > maxBlobBytes ? ["OVERSIZE_BLOB_UNSCANNED"] : scanBlob(blob.bytes);
    for (const hit of hits) hitTypes.add(hit);
    blobs.push({
      path: relativePath,
      mode: blob.mode,
      oid: blob.oid,
      bytes: blob.bytes.length,
      binary: blob.bytes.includes(0),
      blob_sha256: sha256(blob.bytes),
      hit_types: hits,
    });
  }
  const diff = gitBuffer(root, ["diff", "--no-ext-diff", "--binary", baseCommit, candidate]);
  return {
    base_commit: baseCommit,
    candidate_commit: candidate,
    changed_paths: paths,
    unexpected_paths: unexpectedPaths,
    scope_passed: unexpectedPaths.length === 0,
    candidate_diff_sha256: sha256(diff),
    secret_scan: {
      version: "G07_CANDIDATE_BLOBS_V1",
      passed: hitTypes.size === 0,
      hit_types: [...hitTypes].sort(),
      scanned_blob_count: blobs.length,
      binary_blob_count: blobs.filter((item) => item.binary).length,
      blobs,
    },
  };
}

function fullBaselineScope(root, candidateCommit = "HEAD") {
  const values = controlValues(root);
  const baseCommit = values.get("G07_A_BASE_COMMIT");
  invariant(baseCommit === BASELINE_COMMIT, "G07_A_BASE_COMMIT drifted from the approved G01-G06 baseline", "G07_BASE_COMMIT_MISMATCH", { registered: baseCommit, expected: BASELINE_COMMIT });
  const scan = scanBaselineCandidate(root, baseCommit, candidateCommit);
  const candidate = scan.candidate_commit;
  const status = run(root, "git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const artifactRegistrationKeys = [
    ["G06_ARTIFACT_PATH", "G06_ARTIFACT_SHA256"],
    ["G07_A_ORCHESTRATOR_PATH", "G07_A_ORCHESTRATOR_SHA256"],
    ["G07_A_POLICY_PATH", "G07_A_POLICY_SHA256"],
    ["G07_A_EVIDENCE_TOOL_PATH", "G07_A_EVIDENCE_TOOL_SHA256"],
  ];
  const artifactRegistrations = artifactRegistrationKeys.map(([pathKey, hashKey]) => {
    const relativePath = values.get(pathKey);
    const registeredSha256 = values.get(hashKey);
    invariant(relativePath && ALLOWED_G07_PATHS.has(relativePath) && /^[a-f0-9]{64}$/.test(registeredSha256 ?? ""), `artifact registration ${pathKey}/${hashKey} is invalid`, "G07_ARTIFACT_REGISTRATION_INVALID");
    const absolutePath = path.join(root, ...normalizePath(relativePath).split("/"));
    const actualSha256 = sha256(fs.readFileSync(absolutePath));
    return { path_key: pathKey, hash_key: hashKey, path: relativePath, registered_sha256: registeredSha256, actual_sha256: actualSha256, matches: actualSha256 === registeredSha256 };
  });
  const implementationCommit = values.get("G07_A_COMMIT");
  const implementationCommitExists = commitExists(root, implementationCommit);
  const implementationIsAncestor = implementationCommitExists && commitIsAncestor(root, implementationCommit, candidate);
  const implementationArtifacts = artifactRegistrations.map((registration) => {
    const bytes = implementationCommitExists ? commitFile(root, implementationCommit, registration.path) : Buffer.alloc(0);
    const commitSha256 = sha256(bytes);
    return { ...registration, implementation_commit_sha256: commitSha256, matches_implementation_commit: commitSha256 === registration.registered_sha256 };
  });
  const evidencePath = normalizePath(values.get("G07_A_EVIDENCE_PATH"));
  const evidenceRegisteredSha256 = values.get("G07_A_EVIDENCE_SHA256");
  invariant(ALLOWED_G07_PATHS.has(evidencePath) && /^[a-f0-9]{64}$/.test(evidenceRegisteredSha256 ?? ""), "active G07 evidence registration is invalid", "G07_ACTIVE_EVIDENCE_REGISTRATION_INVALID");
  const evidenceAbsolute = path.join(root, ...evidencePath.split("/"));
  const evidenceBytes = fs.readFileSync(evidenceAbsolute);
  const evidenceActualSha256 = sha256(evidenceBytes);
  const evidenceDocument = JSON.parse(evidenceBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const evidenceArtifactMatches = implementationArtifacts.every((item) => evidenceDocument.artifacts?.[item.path] === item.registered_sha256);
  const evidencePayloadMatches = evidenceDocument.evidence_status === "ACTIVE_IMPLEMENTATION_EVIDENCE"
    && evidenceDocument.implementation?.candidate_commit === implementationCommit
    && evidenceDocument.implementation?.g01_g06_base_commit === baseCommit
    && evidenceDocument.implementation?.branch === gitText(root, ["branch", "--show-current"])
    && evidenceArtifactMatches;
  const lfPaths = [...new Set([...LF_REPRODUCIBLE_PATHS, evidencePath])].sort();
  const lfReproducibility = lfPaths.map((relativePath) => {
    const worktreeBytes = fs.readFileSync(path.join(root, ...relativePath.split("/")));
    const committedBytes = commitFile(root, candidate, relativePath);
    const attribute = gitText(root, ["check-attr", "eol", "--", relativePath]);
    return {
      path: relativePath,
      attribute,
      eol_lf: attribute.endsWith(": eol: lf"),
      worktree_sha256: sha256(worktreeBytes),
      committed_sha256: sha256(committedBytes),
      bytes_match_clean_checkout: Buffer.compare(worktreeBytes, committedBytes) === 0,
    };
  });
  const result = {
    base_commit: baseCommit,
    candidate_commit: candidate,
    worktree_clean: String(status.stdout ?? "").trim().length === 0,
    changed_paths: scan.changed_paths,
    allowed_paths: [...ALLOWED_G07_PATHS].sort(),
    unexpected_paths: scan.unexpected_paths,
    scope_passed: scan.scope_passed,
    candidate_diff_sha256: scan.candidate_diff_sha256,
    registered_artifacts: artifactRegistrations,
    registered_artifacts_match: artifactRegistrations.every((item) => item.matches),
    implementation_registration: {
      commit: implementationCommit,
      exists: implementationCommitExists,
      ancestor_of_candidate: implementationIsAncestor,
      artifacts: implementationArtifacts,
      artifacts_match: implementationArtifacts.every((item) => item.matches_implementation_commit),
    },
    active_evidence: {
      path: evidencePath,
      registered_sha256: evidenceRegisteredSha256,
      actual_sha256: evidenceActualSha256,
      hash_matches: evidenceActualSha256 === evidenceRegisteredSha256,
      payload_matches_registration: evidencePayloadMatches,
      schema_version: evidenceDocument.schema_version ?? null,
    },
    lf_reproducibility: {
      passed: lfReproducibility.every((item) => item.eol_lf && item.bytes_match_clean_checkout),
      files: lfReproducibility,
    },
    gate_snapshot: {
      g07_gate: values.get("G07_GATE"),
      g07_a_status: values.get("G07_A_STATUS"),
      g07_a_commit: values.get("G07_A_COMMIT"),
    },
    secret_scan: scan.secret_scan,
  };
  Object.defineProperty(result, "evidence_document", { value: evidenceDocument, enumerable: false });
  return result;
}

function currentSelfTest(root, scriptPath) {
  const result = run(root, process.execPath, [scriptPath, "--self-test"], { encoding: null });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const parsed = JSON.parse(stdout.toString("utf8"));
  invariant(parsed.passed === true, `${scriptPath} self-test failed`, "CURRENT_SELF_TEST_FAILED", parsed.failed_checks ?? null);
  return { command: `node ${scriptPath} --self-test`, exit_code: result.status, stdout_sha256: sha256(stdout), assertions: parsed.assertions };
}

function currentSyntaxCheck(root) {
  const result = run(root, process.execPath, ["--check", "tools/project-orchestrator.mjs"], { encoding: null });
  return {
    command: "node --check tools/project-orchestrator.mjs",
    exit_code: result.status,
    stdout_sha256: sha256(result.stdout ?? Buffer.alloc(0)),
  };
}

function currentDryRun(root) {
  const command = "node tools/project-orchestrator.mjs dry-run --run-id g07-a-evidence-replay";
  const result = run(root, process.execPath, ["tools/project-orchestrator.mjs", "dry-run", "--run-id", "g07-a-evidence-replay"], { encoding: null });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const parsed = JSON.parse(stdout.toString("utf8"));
  return { command, exit_code: result.status, stdout_sha256: sha256(stdout), result: parsed };
}

function normalizedAssertions(value) {
  return {
    passed: Number(value?.passed),
    failed: Number(value?.failed),
    total: Number(value?.total),
  };
}

function secretScanSummary(scan) {
  return {
    version: scan.version,
    passed: scan.passed,
    hit_types: scan.hit_types,
    scanned_blob_count: scan.scanned_blob_count,
    binary_blob_count: scan.binary_blob_count,
  };
}

function buildMechanicalClaims(root, { baseline, currentTests, syntax, dryRun, implementationCommit }) {
  const implementationScope = scanBaselineCandidate(root, BASELINE_COMMIT, implementationCommit);
  const currentHead = gitText(root, ["rev-parse", "HEAD"]);
  const dry = dryRun.result;
  return {
    validation_version: "G07_EVIDENCE_SEMANTIC_V1",
    command: "node tools/g07-control-evidence.mjs --all",
    baseline_compatibility: {
      command: "node tools/g07-control-evidence.mjs --g06-baseline",
      source_commit: baseline.source_commit,
      execution_mode: baseline.execution_mode,
      exit_code: baseline.exit_code,
      assertions: normalizedAssertions(baseline.assertions),
      business_acceptance_passed: baseline.business_acceptance_passed,
    },
    current_tests: {
      g06: {
        command: currentTests.g06.command,
        exit_code: currentTests.g06.exit_code,
        assertions: normalizedAssertions(currentTests.g06.assertions),
      },
      g07: {
        command: currentTests.g07.command,
        exit_code: currentTests.g07.exit_code,
        assertions: normalizedAssertions(currentTests.g07.assertions),
      },
      evidence_tool: {
        command: currentTests.evidence_tool.command,
        exit_code: currentTests.evidence_tool.exit_code,
        assertions: normalizedAssertions(currentTests.evidence_tool.assertions),
      },
      syntax: {
        command: syntax.command,
        exit_code: syntax.exit_code,
      },
    },
    dry_run: {
      command: dryRun.command,
      exit_code: dryRun.exit_code,
      selected_task_id: dry.selected_task_id,
      selected_role: dry.selected_role,
      selection_reason: dry.selection_reason,
      ready_candidates: dry.ready_candidates,
      task_status: dry.task_status,
      fp_ids: dry.fp_ids,
      base_commit_is_invocation_head: dry.base_commit === currentHead,
      context_hash_is_sha256: /^[a-f0-9]{64}$/.test(String(dry.context_hash ?? "")),
      router_execution_authorized: dry.router_execution_authorized,
      policy_execution_allowed: dry.policy_execution_allowed,
      policy_stop_reason: dry.policy_stop_reason,
      event_log_unchanged: dry.event_log_unchanged,
      event_count: dry.event_count,
      product_files_written: dry.product_files_written,
      task_status_changed: dry.task_status_changed,
      g07_gate: dry.g07_gate,
    },
    implementation_scope: {
      base_commit: implementationScope.base_commit,
      candidate_commit: implementationScope.candidate_commit,
      changed_paths: implementationScope.changed_paths,
      unexpected_paths: implementationScope.unexpected_paths,
      scope_passed: implementationScope.scope_passed,
      candidate_diff_sha256: implementationScope.candidate_diff_sha256,
      secret_scan: secretScanSummary(implementationScope.secret_scan),
    },
  };
}

function validateEvidenceClaims(scope, actualClaims) {
  const document = scope.evidence_document;
  const schemaValid = document?.schema_version === "g07-a-evidence/v6"
    && document.evidence_status === "ACTIVE_IMPLEMENTATION_EVIDENCE"
    && document.implementation?.candidate_commit === scope.implementation_registration.commit
    && document.implementation?.g01_g06_base_commit === scope.base_commit
    && document.implementation?.g07_gate === "PENDING"
    && document.implementation?.g07_a_status === "IMPLEMENTED"
    && document.implementation?.product_task_executed === false;
  const claimsMatch = stableJson(document?.mechanical_claims ?? null) === stableJson(actualClaims);
  return {
    passed: schemaValid && claimsMatch,
    schema_valid: schemaValid,
    mechanical_claims_match: claimsMatch,
    declared_sha256: sha256(stableJson(document?.mechanical_claims ?? null)),
    actual_sha256: sha256(stableJson(actualClaims)),
    declared: document?.mechanical_claims ?? null,
    actual: actualClaims,
  };
}

function parseArgs(argv) {
  const options = { mode: "all", root: DEFAULT_ROOT, candidate: "HEAD" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--g06-baseline") options.mode = "g06-baseline";
    else if (item === "--scope") options.mode = "scope";
    else if (item === "--all") options.mode = "all";
    else if (item === "--self-test") options.mode = "self-test";
    else if (item === "--root") options.root = path.resolve(argv[++index]);
    else if (item === "--candidate") options.candidate = argv[++index];
    else invariant(false, `unknown argument: ${item}`, "CLI_ARGUMENT_INVALID");
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const baseline = ["all", "g06-baseline", "self-test"].includes(options.mode) ? baselineCompatibility(options.root) : null;
    const scope = ["all", "scope"].includes(options.mode) ? fullBaselineScope(options.root, options.candidate) : null;
    const binaryProbe = scanBlob(Buffer.concat([Buffer.from([0, 1]), Buffer.from(`sk-proj-${"A".repeat(24)}`), Buffer.from([0])]));
    if (options.mode === "self-test") {
      const registration = fullBaselineScope(options.root, options.candidate);
      const exactClaimProbe = { dry_run: { selected_task_id: "F0-01-REPO", policy_execution_allowed: false } };
      const staleClaimProbe = { dry_run: { ...exactClaimProbe.dry_run, stdout_sha256: "0".repeat(64) } };
      const assertions = [
        baseline.assertions.passed === 58,
        binaryProbe.includes("OPENAI_KEY"),
        registration.active_evidence.hash_matches && registration.active_evidence.payload_matches_registration
          && registration.active_evidence.schema_version === "g07-a-evidence/v6",
        registration.implementation_registration.exists && registration.implementation_registration.ancestor_of_candidate,
        registration.implementation_registration.artifacts_match,
        registration.lf_reproducibility.passed,
        registration.scope_passed && registration.secret_scan.passed && registration.registered_artifacts_match,
        stableJson(exactClaimProbe) === stableJson(JSON.parse(JSON.stringify(exactClaimProbe))),
        stableJson(exactClaimProbe) !== stableJson(staleClaimProbe),
      ];
      const report = {
        schema_version: "g07-control-evidence-self-test/v1",
        passed: assertions.every(Boolean),
        assertions: { passed: assertions.filter(Boolean).length, failed: assertions.filter((item) => !item).length, total: assertions.length },
        baseline,
        binary_secret_probe: binaryProbe,
        registration: {
          active_evidence: {
            path: registration.active_evidence.path,
            hash_matches: registration.active_evidence.hash_matches,
            payload_matches_registration: registration.active_evidence.payload_matches_registration,
            schema_version: registration.active_evidence.schema_version,
          },
          implementation_registration: {
            commit: registration.implementation_registration.commit,
            exists: registration.implementation_registration.exists,
            ancestor_of_candidate: registration.implementation_registration.ancestor_of_candidate,
            artifacts_match: registration.implementation_registration.artifacts_match,
          },
          lf_reproducibility: {
            passed: registration.lf_reproducibility.passed,
            files: registration.lf_reproducibility.files.map((item) => ({
              path: item.path,
              attribute: item.attribute,
              eol_lf: item.eol_lf,
              bytes_match_clean_checkout: item.bytes_match_clean_checkout,
            })),
          },
        },
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) process.exitCode = 1;
      return;
    }
    const currentTests = options.mode === "all" ? {
      g06: currentSelfTest(options.root, "tools/project-context-loader.mjs"),
      g07: currentSelfTest(options.root, "tools/project-orchestrator.mjs"),
      evidence_tool: currentSelfTest(options.root, "tools/g07-control-evidence.mjs"),
    } : null;
    const syntax = options.mode === "all" ? currentSyntaxCheck(options.root) : null;
    const dryRun = options.mode === "all" ? currentDryRun(options.root) : null;
    const actualClaims = options.mode === "all" ? buildMechanicalClaims(options.root, {
      baseline,
      currentTests,
      syntax,
      dryRun,
      implementationCommit: scope.implementation_registration.commit,
    }) : null;
    const evidenceClaims = options.mode === "all" ? validateEvidenceClaims(scope, actualClaims) : null;
    const report = {
      schema_version: "g07-control-evidence/v1",
      branch: gitText(options.root, ["branch", "--show-current"]),
      candidate_committed_at: gitText(options.root, ["show", "-s", "--format=%cI", scope?.candidate_commit ?? "HEAD"]),
      baseline_compatibility: baseline,
      full_baseline_scope: scope,
      current_tests: currentTests,
      syntax,
      dry_run: dryRun,
      evidence_claims: evidenceClaims,
    };
    report.passed = (baseline?.assertions.passed ?? 58) === 58
      && (scope?.scope_passed ?? true)
      && (scope?.secret_scan.passed ?? true)
      && (scope?.registered_artifacts_match ?? true)
      && (scope?.implementation_registration.exists ?? true)
      && (scope?.implementation_registration.ancestor_of_candidate ?? true)
      && (scope?.implementation_registration.artifacts_match ?? true)
      && (scope?.active_evidence.hash_matches ?? true)
      && (scope?.active_evidence.payload_matches_registration ?? true)
      && (scope?.lf_reproducibility.passed ?? true)
      && (scope?.worktree_clean ?? true)
      && Object.values(report.current_tests ?? {}).every((item) => item.exit_code === 0)
      && (syntax?.exit_code ?? 0) === 0
      && (dryRun?.exit_code ?? 0) === 0
      && (evidenceClaims?.passed ?? true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message, code: error.code ?? "G07_EVIDENCE_ERROR", details: error.details ?? null }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

main();
