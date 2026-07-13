import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintN8n } from '../../../scripts/n8n-lint/index.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const source = fileURLToPath(new URL('../../../scripts/n8n-lint/index.mjs', import.meta.url));

function validNode(index, node = {}) {
  return { id: `node-${index}`, name: `node-${index}`, type: 'n8n-nodes-base.code', typeVersion: 1, position: [0, 0], parameters: {}, ...node };
}

function workflow(index, node) {
  return { id: `workflow-${index}`, name: `workflow-${index}`, active: false, nodes: node ? [validNode(index, node)] : [], connections: {} };
}

function known(code, index, node, detail) {
  return { code, path: `references/workflow-${index}.json`, workflow_id: `workflow-${index}`, workflow_sha256: '', node, ...detail };
}

async function makeFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'n8n-lint-'));
  const references = join(cwd, 'references');
  const files = new Map();
  for (let index = 0; index < 17; index += 1) files.set(`workflow-${index}.json`, workflow(index));
  files.set('workflow-0.json', workflow(0, { id: 'experimental', type: 'n8n-nodes-base.code', parameters: { text: 'rpc_acquire_run_lock' } }));
  for (let index = 1; index < 6; index += 1) files.set(`workflow-${index}.json`, workflow(index, { id: `write-${index}`, type: 'n8n-nodes-base.postgres', parameters: { operation: 'update' } }));
  const fixture = { cwd, references, files, baseline: { schema_version: 'n8n-reference-baseline/v2', workflows: [], known_semantic_findings: [] } };
  await syncFixture(fixture);
  fixture.baseline.known_semantic_findings = [
    known('EXPERIMENTAL_RPC', 0, 'experimental', { rpc: 'rpc_acquire_run_lock' }),
    ...[1, 2, 3, 4, 5].map((index) => known('BARE_DATABASE_WRITE', index, `write-${index}`, { location: 'nodes.0.parameters.operation' })),
  ];
  await syncFixture(fixture);
  return fixture;
}

async function syncFixture(fixture) {
  await mkdir(fixture.references, { recursive: true });
  fixture.baseline.workflows = [...fixture.files.entries()].filter(([name]) => !name.includes('/')).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const parsed = typeof value === 'string' ? null : value;
    return { path: `references/${name}`, id: parsed?.id ?? `workflow-${name}`, name: parsed?.name ?? name, sha256: hash(raw) };
  });
  for (const [name, value] of fixture.files) {
    const target = join(fixture.references, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const finding of fixture.baseline.known_semantic_findings ?? []) {
    const entry = fixture.baseline.workflows.find((candidate) => candidate.path === finding.path);
    if (entry) { finding.workflow_id = entry.id; finding.workflow_sha256 = entry.sha256; }
  }
  await writeBaseline(fixture);
}

async function writeBaseline(fixture) { await writeFile(join(fixture.cwd, 'baseline.json'), JSON.stringify(fixture.baseline)); }

async function withFixture(run) {
  const fixture = await makeFixture();
  try { await run(fixture); } finally { await rm(fixture.cwd, { recursive: true, force: true }); }
}

function lint(fixture) { return lintN8n({ cwd: fixture.cwd, referenceDir: 'references', baselinePath: 'baseline.json' }); }
function codes(report) { return report.findings.map((finding) => finding.code); }

test('accepts the exact 17-workflow manifest with six bound known findings deterministically', async () => withFixture(async (fixture) => {
  const first = await lint(fixture); const second = await lint(fixture);
  assert.equal(first.workflow_count, 17); assert.deepEqual(first.summary, { known: 6, new: 0, total: 6 });
  assert.equal(hash(JSON.stringify(first)), hash(JSON.stringify(second)));
}));

test('rejects malformed, undersized, oversized, duplicate, unsafe, and fingerprint-based manifests', async () => {
  const mutations = [
    (b) => { b.schema_version = 'wrong'; }, (b) => { b.workflows = []; }, (b) => { b.workflows = b.workflows.slice(0, 1); },
    (b) => { b.workflows = b.workflows.slice(0, 16); }, (b) => { b.workflows.push({ ...b.workflows[0], path: 'references/workflow-extra.json' }); },
    (b) => { b.workflows[1].path = b.workflows[0].path; }, (b) => { b.workflows[1].id = b.workflows[0].id; }, (b) => { b.workflows[1].name = b.workflows[0].name; },
    (b) => { b.workflows[0].path = 'references/../escape.json'; }, (b) => { b.workflows[0].path = 'references/x/../workflow-0.json'; }, (b) => { b.workflows[0].sha256 = 'not-a-sha'; },
    (b) => { b.known_issue_fingerprints = ['attacker-controlled']; },
  ];
  for (const mutate of mutations) await withFixture(async (fixture) => { mutate(fixture.baseline); await writeBaseline(fixture); await assert.rejects(lint(fixture), /Baseline integrity failure/); });
});

test('recursively finds case-insensitive unregistered JSON and separately rejects duplicate ids and names', async () => withFixture(async (fixture) => {
  fixture.files.set('nested/lower.json', workflow(99)); fixture.files.set('nested/upper.JSON', workflow(98)); fixture.files.set('nested/mixed.JsOn', workflow(97)); await syncFixture(fixture);
  const nested = await lint(fixture); assert.equal(nested.findings.filter((finding) => finding.code === 'UNREGISTERED_WORKFLOW').length, 3);
  fixture.files.set('nested/same-id.json', { ...workflow(100), id: 'workflow-10' }); fixture.files.set('nested/same-name.json', { ...workflow(101), name: 'workflow-11' }); await syncFixture(fixture);
  const duplicate = await lint(fixture); assert.equal(duplicate.findings.filter((finding) => finding.code === 'DUPLICATE_WORKFLOW_IDENTITY' && finding.field === 'id').length, 1); assert.equal(duplicate.findings.filter((finding) => finding.code === 'DUPLICATE_WORKFLOW_IDENTITY' && finding.field === 'name').length, 1);
}));

test('classifies high-confidence SQL writes while excluding SELECT and ordinary update text', async () => {
  const writes = ['INSERT INTO target', 'UPDATE target SET x = 1', 'DELETE FROM target', 'UPSERT INTO target', 'MERGE INTO target', 'CREATE TABLE target'];
  for (const token of writes) await withFixture(async (fixture) => {
    fixture.files.set('workflow-10.json', workflow(10, { id: `write-${token}`, parameters: { jsCode: `/* note */ db.query(\"${token}\")` } })); await syncFixture(fixture);
    const report = await lint(fixture); assert.equal(report.findings.filter((finding) => finding.path === 'references/workflow-10.json' && finding.code === 'BARE_DATABASE_WRITE').length, 1);
  });
  await withFixture(async (fixture) => {
    fixture.files.set('workflow-10.json', workflow(10, { id: 'read', parameters: { jsCode: 'db.query("SELECT * FROM target"); const message = "update available";' } })); await syncFixture(fixture);
    const report = await lint(fixture); assert.equal(report.findings.filter((finding) => finding.path === 'references/workflow-10.json' && finding.code === 'BARE_DATABASE_WRITE').length, 0);
  });
});

test('uses exact node types for Postgres, Code, and Function SQL contexts', async () => withFixture(async (fixture) => {
  fixture.files.set('workflow-10.json', workflow(10, { type: 'n8n-nodes-base.function', parameters: { functionCode: "db.query('UPDATE chapter SET title = 1')" } }));
  fixture.files.set('workflow-11.json', workflow(11, { type: 'n8n-nodes-base.postgresTrigger', parameters: { operation: 'update' } }));
  fixture.files.set('workflow-12.json', workflow(12, { type: 'custom.notpostgreshelper', parameters: { query: 'INSERT INTO chapter VALUES (1)' } }));
  fixture.files.set('workflow-13.json', workflow(13, { type: 'custom.decoder', parameters: { jsCode: "db.query('UPDATE chapter SET title = 1')" } }));
  await syncFixture(fixture);
  const report = await lint(fixture);
  assert.equal(report.findings.filter((finding) => finding.code === 'BARE_DATABASE_WRITE' && finding.path === 'references/workflow-10.json').length, 1);
  for (const index of [11, 12, 13]) assert.equal(report.findings.filter((finding) => finding.code === 'BARE_DATABASE_WRITE' && finding.path === `references/workflow-${index}.json`).length, 0);
}));

test('reports malformed JSON or missing workflow structure as new integrity findings', async () => withFixture(async (fixture) => {
  fixture.files.set('workflow-10.json', '{}'); await syncFixture(fixture); assert.ok(codes(await lint(fixture)).includes('INVALID_WORKFLOW_STRUCTURE'));
  fixture.files.set('workflow-10.json', '{'); await writeFile(join(fixture.references, 'workflow-10.json'), '{'); assert.ok(codes(await lint(fixture)).includes('INVALID_JSON'));
}));

test('reports null nodes and invalid minimal node fields or types', async () => {
  const mutations = [
    (workflowValue) => { workflowValue.nodes = [null]; },
    (workflowValue) => { delete workflowValue.nodes[0].name; },
    (workflowValue) => { workflowValue.nodes[0].type = ''; },
    (workflowValue) => { workflowValue.nodes[0].parameters = []; },
    (workflowValue) => { workflowValue.nodes[0].parameters = null; },
    (workflowValue) => { workflowValue.connections = []; },
  ];
  for (const mutate of mutations) await withFixture(async (fixture) => {
    const value = workflow(10, { id: 'structural' }); mutate(value); fixture.files.set('workflow-10.json', value); await syncFixture(fixture);
    assert.ok(codes(await lint(fixture)).includes('INVALID_WORKFLOW_STRUCTURE'));
  });
});

test('scans high-confidence secrets, SQL writes, active state, and RPC registry without echoing secrets', async () => withFixture(async (fixture) => {
  fixture.files.set('workflow-10.json', { ...workflow(10), pinData: { x: [{ json: { password: 'opaque-secret', note: 'ordinary text' } }] }, nodes: [validNode(10, { parameters: { apiKey: 'plaintext-credential', tokenCountMode: 'estimated', credentials: { id: 'ref', name: 'ref' } } })] });
  fixture.files.set('workflow-11.json', workflow(11, { id: 'code-write', type: 'n8n-nodes-base.code', parameters: { jsCode: 'db.query(\"UPDATE table SET x = 1\")' } }));
  fixture.files.set('workflow-12.json', workflow(12, { id: 'old-rpc', type: 'n8n-nodes-base.code', parameters: { jsCode: 'rpc_create_chapter_target(); rpc_persist_deduction_draft();' } }));
  fixture.files.set('workflow-13.json', workflow(13, { id: 'unknown-rpc', parameters: { jsCode: 'rpc_not_registered_anywhere(); rpc_commit_chapter();' } }));
  fixture.files.set('workflow-14.json', workflow(14, { id: 'read-only', parameters: { jsCode: '// update available\ndb.query(\"SELECT * FROM chapters\")' } }));
  fixture.files.set('workflow-15.json', { ...workflow(15), active: true }); await syncFixture(fixture);
  const report = await lint(fixture); assert.ok(codes(report).includes('SECRET_LITERAL')); assert.ok(codes(report).includes('BARE_DATABASE_WRITE')); assert.equal(report.findings.filter((finding) => finding.code === 'DEPRECATED_RPC').length, 2); assert.equal(report.findings.filter((finding) => finding.code === 'UNKNOWN_RPC').length, 1); assert.ok(codes(report).includes('ACTIVE_STATUS_ANOMALY')); assert.equal(report.findings.filter((finding) => finding.path === 'references/workflow-14.json' && finding.code === 'BARE_DATABASE_WRITE').length, 0); assert.ok(!JSON.stringify(report).includes('plaintext-credential'));
}));

test('continues semantic scanning after parseable content and identity drift and binds known to SHA', async () => withFixture(async (fixture) => {
  const changed = { ...workflow(0, { id: 'experimental', type: 'n8n-nodes-base.postgres', parameters: { operation: 'update', apiKey: 'plaintext-credential', text: 'rpc_acquire_run_lock', query: 'INSERT INTO chapter VALUES (1)' } }), id: 'changed-id', active: true };
  await writeFile(join(fixture.references, 'workflow-0.json'), JSON.stringify(changed));
  const report = await lint(fixture);
  for (const code of ['CONTENT_DRIFT', 'WORKFLOW_IDENTITY_DRIFT', 'ACTIVE_STATUS_ANOMALY', 'SECRET_LITERAL', 'EXPERIMENTAL_RPC', 'BARE_DATABASE_WRITE']) assert.ok(codes(report).includes(code));
  assert.equal(report.findings.find((finding) => finding.code === 'EXPERIMENTAL_RPC').baseline, 'new');
  const cli = spawnSync(process.execPath, [source, '--reference-dir', fixture.references, '--baseline', join(fixture.cwd, 'baseline.json')], { cwd: fixture.cwd }); assert.equal(cli.status, 1);
}));

test('continues safe semantic checks when connections has the wrong type', async () => withFixture(async (fixture) => {
  const changed = { ...workflow(10, { type: 'n8n-nodes-base.postgres', parameters: { operation: 'update', password: 'opaque-secret', text: 'rpc_not_registered_anywhere' } }), active: true, connections: [] };
  await writeFile(join(fixture.references, 'workflow-10.json'), JSON.stringify(changed));
  const report = await lint(fixture);
  for (const code of ['INVALID_WORKFLOW_STRUCTURE', 'CONTENT_DRIFT', 'ACTIVE_STATUS_ANOMALY', 'SECRET_LITERAL', 'UNKNOWN_RPC', 'BARE_DATABASE_WRITE']) assert.ok(codes(report).includes(code));
}));

test('integrity findings and CLI fatal errors cannot be waived', async () => withFixture(async (fixture) => {
  await writeFile(join(fixture.references, 'unregistered.json'), '{');
  const report = await lint(fixture); assert.ok(codes(report).includes('INVALID_JSON')); assert.equal(report.findings.find((finding) => finding.code === 'INVALID_JSON').baseline, 'new');
  fixture.baseline.known_semantic_findings = fixture.baseline.known_semantic_findings.slice(0, 5); await syncFixture(fixture);
  const cli = spawnSync(process.execPath, [source, '--reference-dir', fixture.references, '--baseline', join(fixture.cwd, 'baseline.json')]); assert.equal(cli.status, 2);
}));

test('fixture directories are removed after every try/finally wrapper', async () => {
  let cwd;
  await withFixture(async (fixture) => { cwd = fixture.cwd; await lint(fixture); });
  await assert.rejects(access(cwd));
});
