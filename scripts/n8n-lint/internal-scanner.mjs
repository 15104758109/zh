import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_REFERENCE_DIR = 'docs/后端/n8n';
export const DEFAULT_BASELINE = 'orchestration/reference-baseline/n8n-workflows.json';
export const DEFAULT_PRODUCTION_DIR = 'orchestration/workflows';
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
const workflowSha256 = (value) => createHash('sha256').update(Buffer.from(value.replace(/\r\n|\r/g, '\n'), 'utf8')).digest('hex');
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
function sqlWrite(value) { return /^(?:INSERT\s+INTO\b|UPDATE\s+[^\s;]+\s+SET\b|DELETE\s+FROM\b|(?:MERGE|UPSERT)\s+INTO\b|(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|VIEW|SCHEMA|DATABASE)\b|(?:GRANT|REVOKE)\b)/i.test(stripLeadingComments(value)); }
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
    const nodeId = nodeKey(node, index); const strings = [{ value: node.name, location: `nodes.${index}.name` }];
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
    if ((postgresWrite || (typeof source === 'string' && codeWrite(source))) && !writeSeen.has(nodeId)) { writeSeen.add(nodeId); const location = typeof operation === 'string' && WRITE_OPERATIONS.has(operation.toLowerCase()) ? `nodes.${index}.parameters.operation` : `nodes.${index}.parameters.query`; findings.push(issue('BARE_DATABASE_WRITE', path, { node: nodeId, location })); }
  });
  walk(workflow.pinData, (value, parts) => { if (isSecret(value, parts.at(-1))) findings.push(issue('SECRET_LITERAL', path)); });
  return findings;
}

function pathInside(root, target, label) {
  const local = normalizedPath(relative(root, target));
  if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error(`${label} must be inside its allowed root`);
  return local || '.';
}

function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode; }
function samePhysical(left, right) { return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right; }
function metadataFingerprint(stat) { return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
async function hook(hooks, name, context) { if (typeof hooks?.[name] === 'function') await hooks[name](context); }

async function directorySnapshot(absolutePath, { realCwd, realRoot, label }) {
  const before = await lstat(absolutePath);
  if (before.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link or junction`);
  if (!before.isDirectory()) throw new Error(`${label} must be a directory`);
  const physical = await realpath(absolutePath); pathInside(realCwd, physical, label); if (realRoot) pathInside(realRoot, physical, label);
  const after = await lstat(absolutePath); if (!sameIdentity(before, after)) throw new Error(`${label} changed while being checked`);
  return { identity: before, physical };
}

async function fileSnapshot(absolutePath, { realCwd, realRoot, label }) {
  const before = await lstat(absolutePath);
  if (before.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  if (!before.isFile()) throw new Error(`${label} must be a file`);
  if (before.nlink > 1) throw new Error(`${label} must not be hard linked`);
  const physical = await realpath(absolutePath); pathInside(realCwd, physical, label); if (realRoot) pathInside(realRoot, physical, label);
  const after = await lstat(absolutePath); if (!sameIdentity(before, after)) throw new Error(`${label} changed while being checked`);
  return { identity: before, physical };
}

async function listDirectory(absolutePath, options) {
  const before = await directorySnapshot(absolutePath, options);
  await hook(options.hooks, 'afterDirectoryVerifiedBeforeRead', { path: absolutePath, label: options.label });
  const entries = await readdir(absolutePath, { withFileTypes: true }); const after = await directorySnapshot(absolutePath, options);
  if (!sameIdentity(before.identity, after.identity) || !samePhysical(before.physical, after.physical)) throw new Error(`${options.label} changed while being enumerated`);
  return { entries, snapshot: before };
}

async function checkedReadFile(absolutePath, options) {
  const before = await fileSnapshot(absolutePath, options); await hook(options.hooks, 'afterFileVerifiedBeforeOpen', { path: absolutePath, label: options.label });
  const handle = await open(absolutePath, 'r');
  try {
    if (!sameIdentity(before.identity, await handle.stat())) throw new Error(`${options.label} changed before it could be opened`);
    const opened = await fileSnapshot(absolutePath, options); if (!sameIdentity(before.identity, opened.identity) || !samePhysical(before.physical, opened.physical)) throw new Error(`${options.label} changed before it could be read`);
    const raw = await handle.readFile({ encoding: 'utf8' }); if (!sameIdentity(before.identity, await handle.stat())) throw new Error(`${options.label} changed while being read`);
    const after = await fileSnapshot(absolutePath, options); if (!sameIdentity(before.identity, after.identity) || !samePhysical(before.physical, after.physical)) throw new Error(`${options.label} changed while being read`);
    return { raw, identity: before.identity, physical: before.physical, metadata: metadataFingerprint(before.identity), content: sha256(raw) };
  } finally { await handle.close(); }
}

async function jsonFiles(absoluteDir, { cwd, missingEmpty = false, label, hooks } = {}) {
  const realCwd = await realpath(cwd); let root;
  try { root = await directorySnapshot(absoluteDir, { realCwd, label }); } catch (error) { if (missingEmpty && error && typeof error === 'object' && error.code === 'ENOENT') return { files: [], directories: new Map(), entries: new Map(), realCwd, realRoot: null }; throw error; }
  const files = []; const directories = new Map(); const entries = new Map();
  async function visit(directory) {
    const listed = await listDirectory(directory, { realCwd, realRoot: root.physical, label, hooks });
    directories.set(normalizedPath(relative(absoluteDir, directory)) || '.', { identity: listed.snapshot.identity, physical: listed.snapshot.physical, metadata: metadataFingerprint(listed.snapshot.identity) });
    for (const entry of listed.entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const child = resolve(directory, entry.name); const metadata = await lstat(child);
      if (metadata.isSymbolicLink()) throw new Error(`${label} must not contain symbolic links or junctions`);
      const local = normalizedPath(relative(absoluteDir, child));
      entries.set(local, { type: metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other', identity: metadata, metadata: metadataFingerprint(metadata) });
      if (metadata.isDirectory()) await visit(child); else if (metadata.isFile() && /\.json$/i.test(entry.name)) files.push(local);
    }
  }
  await visit(absoluteDir); const after = await directorySnapshot(absoluteDir, { realCwd, label });
  if (!sameIdentity(root.identity, after.identity) || !samePhysical(root.physical, after.physical)) throw new Error(`${label} changed while being scanned`);
  return { files: files.sort((a, b) => a.localeCompare(b, 'en')), directories, entries, realCwd, realRoot: root.physical };
}

function parseWorkflow(raw) {
  try { return { parsed: true, workflow: JSON.parse(raw) }; } catch { return { parsed: false, workflow: null }; }
}

async function collectionSnapshot(absoluteDir, { cwd, missingEmpty = false, label, workflowLabel, hooks, afterEnumerated = false } = {}) {
  const listed = await jsonFiles(absoluteDir, { cwd, missingEmpty, label, hooks });
  if (afterEnumerated) await hook(hooks, 'afterCollectionEnumeratedBeforeCapture', { path: absoluteDir, label });
  const workflows = new Map();
  for (const file of listed.files) workflows.set(file, await checkedReadFile(resolve(absoluteDir, file), { realCwd: listed.realCwd, realRoot: listed.realRoot, label: workflowLabel, hooks }));
  return { ...listed, workflows };
}

function assertSameMap(initial, current, label, describe, equal) {
  if (initial.size !== current.size) throw new Error(`${label} collection changed: ${describe}`);
  for (const [path, record] of initial) if (!current.has(path) || !equal(record, current.get(path))) throw new Error(`${label} collection changed: ${describe}`);
}

function assertStableCollection(initial, current, label) {
  assertSameMap(initial.directories, current.directories, label, 'directory manifest', (left, right) => sameIdentity(left.identity, right.identity) && samePhysical(left.physical, right.physical) && left.metadata === right.metadata);
  assertSameMap(initial.entries, current.entries, label, 'directory entries', (left, right) => left.type === right.type && sameIdentity(left.identity, right.identity) && left.metadata === right.metadata);
  assertSameMap(initial.workflows, current.workflows, label, 'workflow manifest', (left, right) => sameIdentity(left.identity, right.identity) && samePhysical(left.physical, right.physical) && left.metadata === right.metadata && left.content === right.content);
}

async function validateBaseline(baseline, { cwd, referenceDir }) {
  if (!isPlainObject(baseline) || baseline.schema_version !== 'n8n-reference-baseline/v2') fail('schema_version must be n8n-reference-baseline/v2');
  if (!Array.isArray(baseline.workflows) || baseline.workflows.length !== WORKFLOW_COUNT || !Array.isArray(baseline.known_semantic_findings) || baseline.known_semantic_findings.length !== 6 || 'known_issue_fingerprints' in baseline) fail('baseline collection shape is invalid');
  const absoluteReferenceDir = resolve(cwd, referenceDir); const referencePath = normalizedPath(pathInside(cwd, absoluteReferenceDir, 'reference directory')); const paths = new Set(); const ids = new Set(); const names = new Set(); const entries = new Map();
  for (const entry of baseline.workflows) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) fail('workflow entry shape is invalid');
    const absolutePath = resolve(cwd, entry.path); const local = normalizedPath(relative(absoluteReferenceDir, absolutePath));
    if (entry.path !== normalizedPath(entry.path) || entry.path.split('/').some((part) => part === '.' || part === '..') || !entry.path.startsWith(`${referencePath}/`) || local.startsWith('..') || local.includes('/') || !/\.json$/.test(local)) fail(`unsafe workflow path: ${entry.path}`);
    if (paths.has(entry.path) || ids.has(entry.id) || names.has(entry.name)) fail('workflow paths, ids, and names must be unique'); paths.add(entry.path); ids.add(entry.id); names.add(entry.name); entries.set(entry.path, entry);
  }
  const known = new Map();
  for (const item of baseline.known_semantic_findings) {
    if (!isPlainObject(item) || !['EXPERIMENTAL_RPC', 'BARE_DATABASE_WRITE'].includes(item.code) || typeof item.path !== 'string' || typeof item.workflow_id !== 'string' || typeof item.workflow_sha256 !== 'string') fail('known semantic entry shape is invalid');
    const entry = entries.get(item.path); const key = findingKey(item); if (!entry || item.workflow_id !== entry.id || item.workflow_sha256 !== entry.sha256 || known.has(key)) fail('known semantic entry is not bound to manifest'); known.set(key, item);
  }
  return { entries, known, absoluteReferenceDir, referencePath };
}

export async function lintLegacyN8nInternal({ referenceDir = DEFAULT_REFERENCE_DIR, baselinePath = DEFAULT_BASELINE, cwd = process.cwd(), hooks } = {}) {
  const absoluteBaselinePath = resolve(cwd, baselinePath); pathInside(cwd, absoluteBaselinePath, 'baseline path'); const realCwd = await realpath(cwd);
  let baseline; try { baseline = JSON.parse((await checkedReadFile(absoluteBaselinePath, { realCwd, label: 'baseline path', hooks })).raw); } catch { fail('baseline JSON is unreadable'); }
  const validated = await validateBaseline(baseline, { cwd, referenceDir }); const initial = await collectionSnapshot(validated.absoluteReferenceDir, { cwd, label: 'reference directory', workflowLabel: 'reference workflow', hooks, afterEnumerated: true });
  const findings = []; const seen = new Set(); const ids = new Map(); const names = new Map(); const actualHashes = new Map();
  for (const file of initial.files) {
    const path = `${validated.referencePath}/${file}`; const entry = validated.entries.get(path); seen.add(path); const { raw } = initial.workflows.get(file); const { parsed, workflow } = parseWorkflow(raw);
    if (!parsed) { findings.push(issue('INVALID_JSON', path)); continue; }
    const actualHash = workflowSha256(raw); actualHashes.set(path, actualHash);
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
  await hook(hooks, 'afterCollectionScannedBeforeVerify', { path: validated.absoluteReferenceDir, label: 'reference directory' });
  const final = await collectionSnapshot(validated.absoluteReferenceDir, { cwd, label: 'reference directory', workflowLabel: 'reference workflow', hooks }); assertStableCollection(initial, final, 'reference directory');
  return { schema_version: 'n8n-lint-report/v2', reference_dir: validated.referencePath, baseline: normalizedPath(baselinePath), workflow_count: initial.files.length, registered_workflow_count: validated.entries.size, findings: ordered, summary: { known: ordered.length - newCount, new: newCount, total: ordered.length } };
}

export async function lintProductionN8nInternal({ productionDir = DEFAULT_PRODUCTION_DIR, cwd = process.cwd(), hooks } = {}) {
  const absoluteProductionDir = resolve(cwd, productionDir); const productionPath = normalizedPath(pathInside(cwd, absoluteProductionDir, 'production directory')); const initial = await collectionSnapshot(absoluteProductionDir, { cwd, missingEmpty: true, label: 'production directory', workflowLabel: 'production workflow', hooks, afterEnumerated: true }); const findings = [];
  for (const file of initial.files) {
    const path = normalizedPath(relative(cwd, resolve(absoluteProductionDir, file))); const { raw } = initial.workflows.get(file); const { parsed, workflow } = parseWorkflow(raw);
    if (!parsed) { findings.push(issue('INVALID_JSON', path)); continue; }
    const structural = workflowStructure(workflow, path); if (structural) findings.push(structural); if (isPlainObject(workflow)) findings.push(...scanWorkflow(workflow, path));
  }
  const unique = new Map(); for (const finding of findings) unique.set(`${findingKey(finding)}\u0000${finding.fingerprint}`, finding);
  const ordered = [...unique.values()].map((finding) => ({ ...finding, baseline: 'new' })).sort((a, b) => a.path.localeCompare(b.path, 'en') || a.code.localeCompare(b.code, 'en') || String(a.node ?? '').localeCompare(String(b.node ?? '')) || String(a.location ?? '').localeCompare(String(b.location ?? '')) || String(a.rpc ?? '').localeCompare(String(b.rpc ?? '')));
  await hook(hooks, 'afterCollectionScannedBeforeVerify', { path: absoluteProductionDir, label: 'production directory' });
  const final = await collectionSnapshot(absoluteProductionDir, { cwd, missingEmpty: true, label: 'production directory', workflowLabel: 'production workflow', hooks }); assertStableCollection(initial, final, 'production directory');
  return { production_dir: productionPath, workflow_count: initial.files.length, findings: ordered, summary: { known: 0, new: ordered.length, total: ordered.length } };
}
