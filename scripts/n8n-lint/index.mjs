import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REFERENCE_DIR = 'docs/后端/n8n';
const DEFAULT_BASELINE = 'orchestration/reference-baseline/n8n-workflows.json';
const DEPRECATED_RPCS = ['rpc_writeback_commit'];
const EXPERIMENTAL_RPCS = ['rpc_acquire_run_lock'];
const SECRET_KEY = /(?:api[_-]?key|authorization|password|secret|token)/i;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[\w-]{20,}|(?:bearer|basic)\s+[A-Za-z0-9._~+\/=:-]{8,}|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@)/i;
const WRITE_SQL = /\b(?:insert|update|delete|merge|upsert)\b/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function issue(code, path, detail = {}) {
  return { code, fingerprint: sha256(JSON.stringify({ code, path, ...detail })), path, ...detail };
}

function walk(value, callback, path = []) {
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, callback, [...path, index]));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, callback, [...path, key]));
  else callback(value, path);
}

function isSecretLiteral(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && !value.includes('={{')
    && !value.startsWith('$env.')
    && !/^\*+$/.test(value.trim());
}

function scanWorkflow(workflow, path) {
  const findings = [];
  if (workflow.active !== false) findings.push(issue('ACTIVE_STATUS_ANOMALY', path, { actual: workflow.active ?? null }));
  for (const node of Array.isArray(workflow.nodes) ? workflow.nodes : []) {
    const nodeKey = String(node.id ?? node.name ?? 'unnamed');
    walk(node, (value, valuePath) => {
      if (typeof value !== 'string') return;
      const location = valuePath.join('.');
      for (const rpc of DEPRECATED_RPCS) {
        if (value.includes(rpc)) findings.push(issue('DEPRECATED_RPC', path, { node: nodeKey, rpc }));
      }
      for (const rpc of EXPERIMENTAL_RPCS) {
        if (value.includes(rpc)) findings.push(issue('EXPERIMENTAL_RPC', path, { node: nodeKey, rpc }));
      }
      if (SECRET_VALUE.test(value) || (SECRET_KEY.test(String(valuePath.at(-1))) && isSecretLiteral(value))) {
        findings.push(issue('SECRET_LITERAL', path, { node: nodeKey, location }));
      }
      if (WRITE_SQL.test(value) && (/postgres/i.test(String(node.type)) || /query|sql/i.test(location))) {
        findings.push(issue('BARE_DATABASE_WRITE', path, { node: nodeKey, location }));
      }
    });
  }
  return findings;
}

export async function lintN8n({ referenceDir = DEFAULT_REFERENCE_DIR, baselinePath = DEFAULT_BASELINE, cwd = process.cwd() } = {}) {
  const absoluteReferenceDir = resolve(cwd, referenceDir);
  const absoluteBaselinePath = resolve(cwd, baselinePath);
  const baseline = JSON.parse(await readFile(absoluteBaselinePath, 'utf8'));
  const files = (await readdir(absoluteReferenceDir)).filter((name) => name.endsWith('.json')).sort();
  const expected = new Map((baseline.workflows ?? []).map((entry) => [entry.path, entry]));
  const seen = new Set();
  const identities = new Map();
  const findings = [];

  for (const file of files) {
    const absolutePath = resolve(absoluteReferenceDir, file);
    const path = relative(cwd, absolutePath).replaceAll('\\', '/');
    seen.add(path);
    const raw = await readFile(absolutePath, 'utf8');
    let workflow;
    try {
      workflow = JSON.parse(raw);
    } catch (error) {
      if (expected.get(path)?.sha256 !== sha256(raw)) findings.push(issue('CONTENT_DRIFT', path));
      findings.push(issue('INVALID_JSON', path, { message: error instanceof Error ? error.message.replace(/\d+/g, '#') : 'parse error' }));
      continue;
    }
    const expectedWorkflow = expected.get(path);
    const actualHash = sha256(raw);
    if (!expectedWorkflow) findings.push(issue('UNREGISTERED_WORKFLOW', path));
    else {
      if (expectedWorkflow.id !== workflow.id || expectedWorkflow.name !== workflow.name) {
        findings.push(issue('WORKFLOW_IDENTITY_DRIFT', path, { id: String(workflow.id ?? ''), name: String(workflow.name ?? '') }));
      }
      if (expectedWorkflow.sha256 !== actualHash) findings.push(issue('CONTENT_DRIFT', path));
    }
    const identity = `${String(workflow.id ?? '')}\u0000${String(workflow.name ?? '')}`;
    const priorPath = identities.get(identity);
    if (priorPath) findings.push(issue('DUPLICATE_WORKFLOW_IDENTITY', path, { duplicate_of: priorPath }));
    else identities.set(identity, path);
    findings.push(...scanWorkflow(workflow, path));
  }
  for (const [path] of expected) if (!seen.has(path)) findings.push(issue('MISSING_WORKFLOW', path));
  const known = new Set(baseline.known_issue_fingerprints ?? []);
  const ordered = findings
    .map((finding) => ({ ...finding, baseline: known.has(finding.fingerprint) ? 'known' : 'new' }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en') || a.code.localeCompare(b.code, 'en') || a.fingerprint.localeCompare(b.fingerprint));
  const newCount = ordered.filter((finding) => finding.baseline === 'new').length;
  return {
    schema_version: 'n8n-lint-report/v1',
    reference_dir: referenceDir.replaceAll('\\', '/'),
    baseline: baselinePath.replaceAll('\\', '/'),
    workflow_count: files.length,
    registered_workflow_count: expected.size,
    findings: ordered,
    summary: { known: ordered.length - newCount, new: newCount, total: ordered.length },
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === '--reference-dir') options.referenceDir = args[index + 1];
    else if (args[index] === '--baseline') options.baselinePath = args[index + 1];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await lintN8n(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.summary.new === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`n8n lint failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
