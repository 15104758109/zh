import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REFERENCE_DIR = 'docs/后端/n8n';
const DEFAULT_BASELINE = 'orchestration/reference-baseline/n8n-workflows.json';
const WORKFLOW_COUNT = 17;
const SHA256 = /^[a-f0-9]{64}$/;
const DEPRECATED_RPCS = new Set(['rpc_writeback_commit', 'rpc_create_chapter_target', 'rpc_persist_deduction_draft']);
const EXPERIMENTAL_RPCS = new Set(['rpc_acquire_run_lock']);
const REGISTERED_RPCS = new Set(['rpc_archive_shadow_version', 'rpc_commit_chapter', 'rpc_commit_character_settings', 'rpc_commit_world_settings', 'rpc_confirm_audit_result', 'rpc_create_book_project', 'rpc_enhance_prose', 'rpc_execute_audit', 'rpc_finalize_deduction_snapshot', 'rpc_finalize_l1a', 'rpc_generate_l1a_conflicts', 'rpc_persist_candidate_text', 'rpc_persist_chapter_execution_plan', 'rpc_promote_prompt_config']);
const SECRET_KEYS = new Set(['apikey', 'authorization', 'password', 'clientsecret', 'accesstoken', 'refreshtoken', 'privatekey', 'databaseurl']);
const WRITE_OPERATIONS = new Set(['insert', 'update', 'delete', 'upsert', 'merge', 'create', 'alter', 'drop', 'truncate', 'grant', 'revoke']);
const INTEGRITY_CODES = new Set(['INVALID_JSON', 'MISSING_WORKFLOW', 'UNREGISTERED_WORKFLOW', 'CONTENT_DRIFT', 'WORKFLOW_IDENTITY_DRIFT', 'DUPLICATE_WORKFLOW_IDENTITY', 'INVALID_WORKFLOW_STRUCTURE']);
const POSTGRES_TYPES = new Set(['n8n-nodes-base.postgres', 'n8n-nodes-base.postgresTool']);
const CODE_TYPE = 'n8n-nodes-base.code';
const FUNCTION_TYPE = 'n8n-nodes-base.function';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizedPath = (value) => value.replaceAll('\\', '/');
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = (message) => { throw new Error(`Baseline integrity failure: ${message}`); };
const issue = (code, path, detail = {}) => ({ code, fingerprint: sha256(JSON.stringify({ code, path, ...detail })), path, ...detail });
const findingKey = (finding) => JSON.stringify({ code: finding.code, path: finding.path, node: finding.node, location: finding.location, rpc: finding.rpc });
const nodeKey = (node, index) => String(node.id ?? node.name ?? index);

function walk(value, callback, path = []) {
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, callback, [...path, index]));
  else if (isPlainObject(value)) Object.entries(value).forEach(([key, item]) => walk(item, callback, [...path, key]));
  else callback(value, path);
}

function workflowStructure(workflow, path) {
  const validNode = (node) => isPlainObject(node) && typeof node.name === 'string' && node.name !== '' && typeof node.type === 'string' && node.type !== '' && isPlainObject(node.parameters);
  return isPlainObject(workflow) && typeof workflow.id === 'string' && workflow.id !== '' && typeof workflow.name === 'string' && workflow.name !== '' && typeof workflow.active === 'boolean' && Array.isArray(workflow.nodes) && workflow.nodes.every(validNode) && isPlainObject(workflow.connections) ? null : issue('INVALID_WORKFLOW_STRUCTURE', path);
}

function isSecret(value, key) {
  if (typeof value !== 'string' || value.trim() === '' || /^\*+$/.test(value.trim()) || value.includes('={{') || value.startsWith('$env.') || value.startsWith('{{')) return false;
  const normalizedKey = String(key).replaceAll('_', '').toLowerCase();
  return SECRET_KEYS.has(normalizedKey) || /(?:^|\s)(?:Bearer|Basic)\s+\S+/i.test(value) || /\bsk-[A-Za-z0-9_-]{12,}\b/.test(value) || /(?:postgres|postgresql):\/\/[^\s/:]+:[^\s@]+@/i.test(value);
}

function stripLeadingComments(value) { return value.replace(/^\s*(?:--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, '').trim(); }
function sqlWrite(value) {
  const sql = stripLeadingComments(value);
  return /^(?:INSERT\s+INTO\b|UPDATE\s+[^\s;]+\s+SET\b|DELETE\s+FROM\b|(?:MERGE|UPSERT)\s+INTO\b|(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|VIEW|SCHEMA|DATABASE)\b|(?:GRANT|REVOKE)\b)/i.test(sql);
}
function codeWrite(value) {
  const query = /\.query\s*\(\s*(['"`])([\s\S]*?)\1/g;
  for (let match = query.exec(value); match; match = query.exec(value)) if (sqlWrite(match[2])) return true;
  return false;
}

function scanWorkflow(workflow, path) {
  const findings = []; const rpcSeen = new Set(); const writeSeen = new Set(); const secretSeen = new Set();
  if (workflow.active !== false) findings.push(issue('ACTIVE_STATUS_ANOMALY', path, { actual: workflow.active ?? null }));
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  nodes.forEach((node, index) => {
    if (!isPlainObject(node) || typeof node.name !== 'string' || node.name === '' || typeof node.type !== 'string' || node.type === '' || !isPlainObject(node.parameters)) return;
    const nodeId = nodeKey(node, index);
    const strings = [{ value: node.name, location: `nodes.${index}.name` }];
    walk(node.parameters, (value, parts) => { if (typeof value === 'string') strings.push({ value, location: `nodes.${index}.parameters.${parts.join('.')}`, leaf: parts.at(-1) }); });
    for (const { value, location, leaf } of strings) {
      if (isSecret(value, leaf)) { const key = `${nodeId}\u0000${location}`; if (!secretSeen.has(key)) { secretSeen.add(key); findings.push(issue('SECRET_LITERAL', path)); } }
      for (const match of value.matchAll(/\brpc_[a-z0-9_]+\b/g)) {
        const rpc = match[0]; const key = `${nodeId}\u0000${rpc}`; if (rpcSeen.has(key)) continue; rpcSeen.add(key);
        if (DEPRECATED_RPCS.has(rpc)) findings.push(issue('DEPRECATED_RPC', path, { node: nodeId, rpc }));
        else if (EXPERIMENTAL_RPCS.has(rpc)) findings.push(issue('EXPERIMENTAL_RPC', path, { node: nodeId, rpc }));
        else if (!REGISTERED_RPCS.has(rpc)) findings.push(issue('UNKNOWN_RPC', path, { node: nodeId, rpc }));
      }
    }
    const operation = node.parameters.operation; const query = node.parameters.query;
    const postgresWrite = POSTGRES_TYPES.has(node.type) && ((typeof operation === 'string' && WRITE_OPERATIONS.has(operation.toLowerCase())) || (typeof query === 'string' && sqlWrite(query)));
    const source = node.type === CODE_TYPE ? node.parameters.jsCode : node.type === FUNCTION_TYPE ? node.parameters.functionCode : undefined;
    const bareWrite = postgresWrite || (typeof source === 'string' && codeWrite(source));
    if (bareWrite && !writeSeen.has(nodeId)) { writeSeen.add(nodeId); const location = typeof operation === 'string' && WRITE_OPERATIONS.has(operation.toLowerCase()) ? `nodes.${index}.parameters.operation` : `nodes.${index}.parameters.query`; findings.push(issue('BARE_DATABASE_WRITE', path, { node: nodeId, location })); }
  });
  walk(workflow.pinData, (value, parts) => { if (isSecret(value, parts.at(-1))) findings.push(issue('SECRET_LITERAL', path)); });
  return findings;
}

async function readWorkflow(absolutePath) { const raw = await readFile(absolutePath, 'utf8'); try { return { raw, workflow: JSON.parse(raw) }; } catch { return { raw, workflow: null }; } }

async function validateBaseline(baseline, { cwd, referenceDir }) {
  if (!isPlainObject(baseline) || baseline.schema_version !== 'n8n-reference-baseline/v2') fail('schema_version must be n8n-reference-baseline/v2');
  if (!Array.isArray(baseline.workflows) || baseline.workflows.length !== WORKFLOW_COUNT || !Array.isArray(baseline.known_semantic_findings) || baseline.known_semantic_findings.length !== 6 || 'known_issue_fingerprints' in baseline) fail('baseline collection shape is invalid');
  const absoluteReferenceDir = resolve(cwd, referenceDir); const referencePath = normalizedPath(relative(cwd, absoluteReferenceDir));
  if (referencePath.startsWith('..')) fail('reference directory must be inside cwd');
  const paths = new Set(); const ids = new Set(); const names = new Set(); const entries = new Map();
  for (const entry of baseline.workflows) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) fail('workflow entry shape is invalid');
    const absolutePath = resolve(cwd, entry.path); const local = normalizedPath(relative(absoluteReferenceDir, absolutePath));
    if (entry.path !== normalizedPath(entry.path) || entry.path.split('/').some((part) => part === '.' || part === '..') || !entry.path.startsWith(`${referencePath}/`) || local.startsWith('..') || local.includes('/') || !/\.json$/.test(local)) fail(`unsafe workflow path: ${entry.path}`);
    if (paths.has(entry.path) || ids.has(entry.id) || names.has(entry.name)) fail('workflow paths, ids, and names must be unique');
    paths.add(entry.path); ids.add(entry.id); names.add(entry.name); entries.set(entry.path, entry);
  }
  const known = new Map();
  for (const item of baseline.known_semantic_findings) {
    if (!isPlainObject(item) || !['EXPERIMENTAL_RPC', 'BARE_DATABASE_WRITE'].includes(item.code) || typeof item.path !== 'string' || typeof item.workflow_id !== 'string' || typeof item.workflow_sha256 !== 'string') fail('known semantic entry shape is invalid');
    const entry = entries.get(item.path); const key = findingKey(item);
    if (!entry || item.workflow_id !== entry.id || item.workflow_sha256 !== entry.sha256 || known.has(key)) fail('known semantic entry is not bound to manifest');
    known.set(key, item);
  }
  return { entries, known, absoluteReferenceDir, referencePath };
}

export async function lintN8n({ referenceDir = DEFAULT_REFERENCE_DIR, baselinePath = DEFAULT_BASELINE, cwd = process.cwd() } = {}) {
  let baseline; try { baseline = JSON.parse(await readFile(resolve(cwd, baselinePath), 'utf8')); } catch { fail('baseline JSON is unreadable'); }
  const validated = await validateBaseline(baseline, { cwd, referenceDir });
  const files = (await readdir(validated.absoluteReferenceDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && /\.json$/i.test(entry.name)).map((entry) => normalizedPath(relative(validated.absoluteReferenceDir, resolve(entry.parentPath, entry.name)))).sort();
  const findings = []; const seen = new Set(); const ids = new Map(); const names = new Map(); const actualHashes = new Map();
  for (const file of files) {
    const path = `${validated.referencePath}/${file}`; const entry = validated.entries.get(path); seen.add(path);
    const { raw, workflow } = await readWorkflow(resolve(validated.absoluteReferenceDir, file));
    if (!workflow) { findings.push(issue('INVALID_JSON', path)); continue; }
    const actualHash = sha256(raw); actualHashes.set(path, actualHash);
    if (!entry) findings.push(issue('UNREGISTERED_WORKFLOW', path)); else { if (entry.sha256 !== actualHash) findings.push(issue('CONTENT_DRIFT', path)); if (!isPlainObject(workflow) || entry.id !== workflow.id || entry.name !== workflow.name) findings.push(issue('WORKFLOW_IDENTITY_DRIFT', path)); }
    if (!isPlainObject(workflow)) { findings.push(issue('INVALID_WORKFLOW_STRUCTURE', path)); continue; }
    const structural = workflowStructure(workflow, path); if (structural) findings.push(structural);
    if (typeof workflow.id === 'string') { if (ids.has(workflow.id)) findings.push(issue('DUPLICATE_WORKFLOW_IDENTITY', path, { field: 'id', duplicate_of: ids.get(workflow.id) })); else ids.set(workflow.id, path); }
    if (typeof workflow.name === 'string') { if (names.has(workflow.name)) findings.push(issue('DUPLICATE_WORKFLOW_IDENTITY', path, { field: 'name', duplicate_of: names.get(workflow.name) })); else names.set(workflow.name, path); }
    findings.push(...scanWorkflow(workflow, path));
  }
  for (const path of validated.entries.keys()) if (!seen.has(path)) findings.push(issue('MISSING_WORKFLOW', path));
  const unique = new Map(); for (const finding of findings) unique.set(`${findingKey(finding)}\u0000${finding.fingerprint}`, finding);
  const ordered = [...unique.values()].map((finding) => ({ ...finding, baseline: !INTEGRITY_CODES.has(finding.code) && validated.known.has(findingKey(finding)) && validated.known.get(findingKey(finding)).workflow_sha256 === actualHashes.get(finding.path) ? 'known' : 'new' })).sort((a, b) => a.path.localeCompare(b.path, 'en') || a.code.localeCompare(b.code, 'en') || String(a.node ?? '').localeCompare(String(b.node ?? '')) || String(a.location ?? '').localeCompare(String(b.location ?? '')) || String(a.rpc ?? '').localeCompare(String(b.rpc ?? '')));
  const newCount = ordered.filter((finding) => finding.baseline === 'new').length;
  return { schema_version: 'n8n-lint-report/v2', reference_dir: validated.referencePath, baseline: normalizedPath(baselinePath), workflow_count: files.length, registered_workflow_count: validated.entries.size, findings: ordered, summary: { known: ordered.length - newCount, new: newCount, total: ordered.length } };
}

function parseArgs(args) { const options = {}; for (let index = 0; index < args.length; index += 2) { if (!args[index + 1] || !['--reference-dir', '--baseline'].includes(args[index])) throw new Error(`Unknown argument: ${args[index]}`); options[args[index] === '--reference-dir' ? 'referenceDir' : 'baselinePath'] = args[index + 1]; } return options; }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { const report = await lintN8n(parseArgs(process.argv.slice(2))); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.summary.new === 0 ? 0 : 1; } catch (error) { process.stderr.write(`n8n lint failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; } }
