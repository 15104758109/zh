import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REFERENCE_DIR = 'docs/后端/n8n';
const DEFAULT_BASELINE = 'orchestration/reference-baseline/n8n-workflows.json';
const WORKFLOW_COUNT = 17;
const SHA256 = /^[a-f0-9]{64}$/;
const DEPRECATED_RPCS = ['rpc_writeback_commit', 'rpc_create_chapter_target', 'rpc_persist_deduction_draft'];
const EXPERIMENTAL_RPCS = ['rpc_acquire_run_lock'];
const SECRET_KEY = /(?:api[_-]?key|authorization|password|secret|token)/i;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9_-]{12,}|AIza[\w-]{20,}|(?:bearer|basic)\s+[A-Za-z0-9._~+\/=:-]{8,}|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@)/i;
const WRITE_SQL = /\b(?:insert|update|delete|merge|upsert)\b/i;
const DIRECT_DB_CALL = /\b(?:db|database|client|pool)\s*\.\s*query\s*\(/i;
const INTEGRITY_CODES = new Set(['INVALID_JSON', 'MISSING_WORKFLOW', 'UNREGISTERED_WORKFLOW', 'CONTENT_DRIFT', 'WORKFLOW_IDENTITY_DRIFT', 'DUPLICATE_WORKFLOW_IDENTITY', 'INVALID_WORKFLOW_STRUCTURE']);

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function fail(message) { throw new Error(`Baseline integrity failure: ${message}`); }
function issue(code, path, detail = {}) { return { code, fingerprint: sha256(JSON.stringify({ code, path, ...detail })), path, ...detail }; }
function normalizedPath(value) { return value.replaceAll('\\', '/'); }
function findingKey(finding) { return JSON.stringify({ code: finding.code, path: finding.path, node: finding.node, rpc: finding.rpc, location: finding.location }); }

function walk(value, callback, path = []) {
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, callback, [...path, index]));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, callback, [...path, key]));
  else callback(value, path);
}

function isSecretLiteral(value) {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('={{') && !value.startsWith('$env.') && !/^\*+$/.test(value.trim());
}

function assertWorkflowStructure(workflow, path) {
  return workflow && typeof workflow === 'object' && !Array.isArray(workflow)
    && typeof workflow.id === 'string' && workflow.id !== ''
    && typeof workflow.name === 'string' && workflow.name !== ''
    && typeof workflow.active === 'boolean'
    && Array.isArray(workflow.nodes)
    && workflow.connections && typeof workflow.connections === 'object' && !Array.isArray(workflow.connections)
    ? null : issue('INVALID_WORKFLOW_STRUCTURE', path);
}

function scanWorkflow(workflow, path) {
  const findings = [];
  if (workflow.active !== false) findings.push(issue('ACTIVE_STATUS_ANOMALY', path, { actual: workflow.active ?? null }));
  walk(workflow, (value, valuePath) => {
    if (typeof value !== 'string') return;
    const location = valuePath.join('.');
    const node = String(valuePath[0] === 'nodes' ? workflow.nodes[valuePath[1]]?.id ?? workflow.nodes[valuePath[1]]?.name ?? 'unnamed' : 'workflow');
    if (valuePath[0] !== 'connections') {
      for (const rpc of DEPRECATED_RPCS) if (value.includes(rpc)) findings.push(issue('DEPRECATED_RPC', path, { node, rpc }));
      for (const rpc of EXPERIMENTAL_RPCS) if (value.includes(rpc)) findings.push(issue('EXPERIMENTAL_RPC', path, { node, rpc }));
    }
    if (SECRET_VALUE.test(value) || (SECRET_KEY.test(String(valuePath.at(-1))) && isSecretLiteral(value))) findings.push(issue('SECRET_LITERAL', path));
    const type = valuePath[0] === 'nodes' ? String(workflow.nodes[valuePath[1]]?.type ?? '') : '';
    if ((WRITE_SQL.test(value) && (/postgres|code|function/i.test(type) || /query|sql/i.test(location))) || (DIRECT_DB_CALL.test(value) && /code|function/i.test(type))) findings.push(issue('BARE_DATABASE_WRITE', path, { node, location }));
  });
  return findings;
}

async function readWorkflow(absolutePath, path) {
  const raw = await readFile(absolutePath, 'utf8');
  try { return { raw, workflow: JSON.parse(raw) }; }
  catch { return { raw, workflow: null }; }
}

async function validateBaseline(baseline, { cwd, referenceDir }) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) || baseline.schema_version !== 'n8n-reference-baseline/v2') fail('schema_version must be n8n-reference-baseline/v2');
  if (!Array.isArray(baseline.workflows) || baseline.workflows.length !== WORKFLOW_COUNT) fail(`workflows must contain exactly ${WORKFLOW_COUNT} entries`);
  if (!Array.isArray(baseline.known_semantic_findings) || baseline.known_semantic_findings.length !== 6 || 'known_issue_fingerprints' in baseline) fail('known semantic allowlist must contain exactly six bound entries');
  const absoluteReferenceDir = resolve(cwd, referenceDir);
  const referencePath = normalizedPath(relative(cwd, absoluteReferenceDir));
  if (referencePath.startsWith('..') || resolve(cwd, referencePath) !== absoluteReferenceDir) fail('reference directory must be inside cwd');
  const paths = new Set(); const ids = new Set(); const names = new Set(); const entries = new Map();
  for (const entry of baseline.workflows) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) fail('workflow entry shape is invalid');
    const expectedPath = `${referencePath}/${entry.path.slice(referencePath.length + 1)}`;
    const absolutePath = resolve(cwd, entry.path);
    if (entry.path !== normalizedPath(entry.path) || entry.path.split('/').includes('..') || entry.path.split('/').includes('.') || !entry.path.startsWith(`${referencePath}/`) || entry.path !== expectedPath || relative(absoluteReferenceDir, absolutePath).startsWith('..') || absolutePath === absoluteReferenceDir) fail(`unsafe workflow path: ${entry.path}`);
    if (paths.has(entry.path) || ids.has(entry.id) || names.has(entry.name)) fail('workflow paths, ids, and names must be unique');
    paths.add(entry.path); ids.add(entry.id); names.add(entry.name); entries.set(entry.path, entry);
    const { raw, workflow } = await readWorkflow(absolutePath, entry.path);
    if (!workflow || assertWorkflowStructure(workflow, entry.path) || sha256(raw) !== entry.sha256 || workflow.id !== entry.id || workflow.name !== entry.name) fail(`registered workflow does not match manifest: ${entry.path}`);
  }
  const features = new Set();
  for (const known of baseline.known_semantic_findings) {
    if (!known || typeof known !== 'object' || !['EXPERIMENTAL_RPC', 'BARE_DATABASE_WRITE'].includes(known.code) || typeof known.path !== 'string' || typeof known.workflow_id !== 'string' || typeof known.workflow_sha256 !== 'string') fail('known semantic entry shape is invalid');
    const entry = entries.get(known.path);
    if (!entry || known.workflow_id !== entry.id || known.workflow_sha256 !== entry.sha256) fail('known semantic entry is not bound to a registered workflow revision');
    const key = findingKey(known);
    if (features.has(key)) fail('known semantic entries must be unique');
    features.add(key);
  }
  return { entries, approvedKnown: features, absoluteReferenceDir, referencePath };
}

export async function lintN8n({ referenceDir = DEFAULT_REFERENCE_DIR, baselinePath = DEFAULT_BASELINE, cwd = process.cwd() } = {}) {
  const absoluteBaselinePath = resolve(cwd, baselinePath);
  let baseline;
  try { baseline = JSON.parse(await readFile(absoluteBaselinePath, 'utf8')); }
  catch { fail('baseline JSON is unreadable'); }
  const validated = await validateBaseline(baseline, { cwd, referenceDir });
  const files = (await readdir(validated.absoluteReferenceDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => normalizedPath(relative(validated.absoluteReferenceDir, resolve(entry.parentPath, entry.name)))).sort();
  const findings = []; const seen = new Set(); const ids = new Map(); const names = new Map();
  for (const file of files) {
    const path = `${validated.referencePath}/${file}`;
    const absolutePath = resolve(validated.absoluteReferenceDir, file);
    seen.add(path);
    const { raw, workflow } = await readWorkflow(absolutePath, path);
    const entry = validated.entries.get(path);
    if (!workflow) { findings.push(issue('INVALID_JSON', path)); continue; }
    const structural = assertWorkflowStructure(workflow, path);
    if (structural) { findings.push(structural); continue; }
    if (!entry) findings.push(issue('UNREGISTERED_WORKFLOW', path));
    else {
      if (sha256(raw) !== entry.sha256) findings.push(issue('CONTENT_DRIFT', path));
      if (workflow.id !== entry.id || workflow.name !== entry.name) findings.push(issue('WORKFLOW_IDENTITY_DRIFT', path));
    }
    if (ids.has(workflow.id)) findings.push(issue('DUPLICATE_WORKFLOW_IDENTITY', path, { field: 'id', duplicate_of: ids.get(workflow.id) })); else ids.set(workflow.id, path);
    if (names.has(workflow.name)) findings.push(issue('DUPLICATE_WORKFLOW_IDENTITY', path, { field: 'name', duplicate_of: names.get(workflow.name) })); else names.set(workflow.name, path);
    findings.push(...scanWorkflow(workflow, path));
  }
  for (const path of validated.entries.keys()) if (!seen.has(path)) findings.push(issue('MISSING_WORKFLOW', path));
  const semanticOccurrences = new Map();
  for (const finding of findings.filter((candidate) => !INTEGRITY_CODES.has(candidate.code))) { const key = findingKey(finding); semanticOccurrences.set(key, (semanticOccurrences.get(key) ?? 0) + 1); }
  for (const approved of validated.approvedKnown) if (semanticOccurrences.get(approved) !== 1) fail('known semantic entry no longer matches exactly one registered finding');
  const ordered = findings.map((finding) => ({ ...finding, baseline: !INTEGRITY_CODES.has(finding.code) && validated.approvedKnown.has(findingKey(finding)) ? 'known' : 'new' })).sort((a, b) => a.path.localeCompare(b.path, 'en') || a.code.localeCompare(b.code, 'en') || a.fingerprint.localeCompare(b.fingerprint));
  const newCount = ordered.filter((finding) => finding.baseline === 'new').length;
  return { schema_version: 'n8n-lint-report/v2', reference_dir: validated.referencePath, baseline: normalizedPath(baselinePath), workflow_count: files.length, registered_workflow_count: validated.entries.size, findings: ordered, summary: { known: ordered.length - newCount, new: newCount, total: ordered.length } };
}

function parseArgs(args) { const options = {}; for (let index = 0; index < args.length; index += 2) { if (!args[index + 1] || !['--reference-dir', '--baseline'].includes(args[index])) throw new Error(`Unknown argument: ${args[index]}`); options[args[index] === '--reference-dir' ? 'referenceDir' : 'baselinePath'] = args[index + 1]; } return options; }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { const report = await lintN8n(parseArgs(process.argv.slice(2))); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.summary.new === 0 ? 0 : 1; } catch (error) { process.stderr.write(`n8n lint failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; } }
