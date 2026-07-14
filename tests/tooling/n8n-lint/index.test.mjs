import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, link, mkdtemp, mkdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintN8n, lintProductionN8n } from '../../../scripts/n8n-lint/index.mjs';
import { lintProductionN8nInternal } from '../../../scripts/n8n-lint/internal-scanner.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const workflowHash = (value) => hash(value.replace(/\r\n|\r/g, '\n'));
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
  for (let index = 0; index < 18; index += 1) files.set(`workflow-${index}.json`, workflow(index));
  files.set('workflow-17.json', { ...workflow(17), active: true });
  files.set('workflow-0.json', workflow(0, { id: 'experimental', type: 'n8n-nodes-base.code', parameters: { text: 'rpc_acquire_run_lock' } }));
  for (let index = 1; index < 6; index += 1) files.set(`workflow-${index}.json`, workflow(index, { id: `write-${index}`, type: 'n8n-nodes-base.postgres', parameters: { operation: 'update' } }));
  const fixture = { cwd, references, files, baseline: { schema_version: 'n8n-reference-baseline/v2', workflows: [], known_semantic_findings: [] } };
  await syncFixture(fixture);
  fixture.baseline.known_semantic_findings = [
    known('EXPERIMENTAL_RPC', 0, 'experimental', { rpc: 'rpc_acquire_run_lock' }),
    ...[1, 2, 3, 4, 5].map((index) => known('BARE_DATABASE_WRITE', index, `write-${index}`, { location: 'nodes.0.parameters.operation' })),
    known('ACTIVE_STATUS_ANOMALY', 17),
  ];
  await syncFixture(fixture);
  return fixture;
}

async function syncFixture(fixture) {
  await mkdir(fixture.references, { recursive: true });
  fixture.baseline.workflows = [...fixture.files.entries()].filter(([name]) => !name.includes('/')).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const parsed = typeof value === 'string' ? null : value;
    return { path: `references/${name}`, id: parsed?.id ?? `workflow-${name}`, name: parsed?.name ?? name, sha256: workflowHash(raw) };
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
function lintProduction(fixture, productionDir = 'production') { return lintProductionN8n({ cwd: fixture.cwd, productionDir }); }
function lintProductionInternal(fixture, productionDir = 'production', hooks) { return lintProductionN8nInternal({ cwd: fixture.cwd, productionDir, hooks }); }
function codes(report) { return report.findings.map((finding) => finding.code); }

async function writeProduction(fixture, name, value, productionDir = 'production') {
  const target = join(fixture.cwd, productionDir, name);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
}

async function withOutsideFixture(run) {
  const outside = await mkdtemp(join(tmpdir(), 'n8n-lint-outside-'));
  try { await run(outside); } finally { await rm(outside, { recursive: true, force: true }); }
}

async function makeDirectoryLink(target, link) {
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

async function makeFileLink(target, link) {
  try { await symlink(target, link, 'file'); return true; } catch { return false; }
}

test('accepts the exact 18-workflow manifest with seven bound known findings deterministically', async () => withFixture(async (fixture) => {
  const first = await lint(fixture); const second = await lint(fixture);
  assert.equal(first.workflow_count, 18); assert.deepEqual(first.summary, { known: 7, new: 0, total: 7 }); assert.ok(codes(first).includes('ACTIVE_STATUS_ANOMALY'));
  assert.equal(hash(JSON.stringify(first)), hash(JSON.stringify(second)));
}));

test('canonicalizes LF, CRLF, and CR workflow content without ignoring non-newline changes', async () => withFixture(async (fixture) => {
  const rewrite = async (ending) => {
    for (const [name, value] of fixture.files) {
      const raw = JSON.stringify(value, null, 2).replace(/\n/g, ending);
      await writeFile(join(fixture.references, name), raw);
      const entry = fixture.baseline.workflows.find((candidate) => candidate.path === `references/${name}`);
      if (entry) entry.sha256 = workflowHash(raw);
    }
    for (const finding of fixture.baseline.known_semantic_findings) finding.workflow_sha256 = fixture.baseline.workflows.find((entry) => entry.path === finding.path).sha256;
    await writeBaseline(fixture);
    return lint(fixture);
  };
  const lf = await rewrite('\n'); const crlf = await rewrite('\r\n'); const cr = await rewrite('\r');
  assert.deepEqual(lf.summary, { known: 7, new: 0, total: 7 }); assert.deepEqual(crlf.summary, lf.summary); assert.deepEqual(cr.summary, lf.summary);
  await writeFile(join(fixture.references, 'workflow-10.json'), `${JSON.stringify(fixture.files.get('workflow-10.json'), null, 2)} `);
  assert.ok(codes(await lint(fixture)).includes('CONTENT_DRIFT'));
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
  const cli = spawnSync(process.execPath, [source, '--reference-dir', 'references', '--baseline', 'baseline.json'], { cwd: fixture.cwd }); assert.equal(cli.status, 1);
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
  const cli = spawnSync(process.execPath, [source, '--reference-dir', 'references', '--baseline', 'baseline.json'], { cwd: fixture.cwd }); assert.equal(cli.status, 2);
}));

test('fixture directories are removed after every try/finally wrapper', async () => {
  let cwd;
  await withFixture(async (fixture) => { cwd = fixture.cwd; await lint(fixture); });
  await assert.rejects(access(cwd));
});

test('production scan treats a missing directory as an empty deterministic collection', async () => withFixture(async (fixture) => {
  const first = await lintProduction(fixture); const second = await lintProduction(fixture);
  assert.deepEqual(first, { production_dir: 'production', workflow_count: 0, findings: [], summary: { known: 0, new: 0, total: 0 } });
  assert.deepEqual(second, first);
}));

test('public lintN8n retains the exact legacy top-level report contract', async () => withFixture(async (fixture) => {
  const report = await lint(fixture);
  assert.deepEqual(Object.keys(report), ['schema_version', 'reference_dir', 'baseline', 'workflow_count', 'registered_workflow_count', 'findings', 'summary']);
  assert.deepEqual(report, { schema_version: 'n8n-lint-report/v2', reference_dir: 'references', baseline: 'baseline.json', workflow_count: 18, registered_workflow_count: 18, findings: report.findings, summary: { known: 7, new: 0, total: 7 } });
}));

test('production scan recursively reports only new findings and does not echo secrets', async () => withFixture(async (fixture) => {
  const secret = 'production-secret-value';
  await writeProduction(fixture, 'nested/sensitive.JSON', { ...workflow('production'), active: true, nodes: [validNode('production', { parameters: { password: secret, jsCode: 'rpc_create_chapter_target(); db.query("UPDATE chapter SET title = 1")' } })] });
  const report = await lintProduction(fixture);
  assert.equal(report.workflow_count, 1); assert.deepEqual(codes(report).sort(), ['ACTIVE_STATUS_ANOMALY', 'BARE_DATABASE_WRITE', 'DEPRECATED_RPC', 'SECRET_LITERAL']);
  assert.ok(report.findings.every((finding) => finding.baseline === 'new')); assert.ok(!JSON.stringify(report).includes(secret));
}));

test('public production options reject hooks and cannot suppress an unsafe workflow', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'active.json', { ...workflow('active'), active: true }); let invoked = false;
  assert.throws(() => lintProductionN8n({ cwd: fixture.cwd, productionDir: 'production', hooks: { afterCollectionEnumeratedBeforeCapture() { invoked = true; } } }), /Invalid n8n lint public options/);
  assert.equal(invoked, false); assert.ok(codes(await lintProduction(fixture)).includes('ACTIVE_STATUS_ANOMALY'));
}));

test('public APIs synchronously reject non-allowlisted, symbol, accessor, and prototype options', async () => withFixture(async (fixture) => {
  const ownProto = {}; Object.defineProperty(ownProto, '__proto__', { value: 'polluted', enumerable: true });
  const symbol = { cwd: fixture.cwd }; symbol[Symbol('unknown')] = true;
  const inherited = Object.create({ cwd: fixture.cwd });
  let accessed = false; const accessor = {}; Object.defineProperty(accessor, 'cwd', { enumerable: true, get() { accessed = true; return fixture.cwd; } });
  const cases = [
    { fs: {} }, { hooks: {} }, { afterDirectoryVerifiedBeforeRead() {} }, { afterCollectionScannedBeforeVerify() {} }, { unsafeMutation: true }, { randomUnknown: true }, { constructor: true }, { prototype: true }, ownProto, symbol, inherited, Object.create(null), accessor,
  ];
  for (const value of cases) {
    assert.throws(() => lintN8n(value), /Invalid n8n lint public options/);
    assert.throws(() => lintProductionN8n(value), /Invalid n8n lint public options/);
  }
  assert.throws(() => lintN8n({ productionDir: 'production' }), /Invalid n8n lint public options/);
  assert.throws(() => lintProductionN8n({ referenceDir: 'references' }), /Invalid n8n lint public options/);
  assert.equal(accessed, false);
  assert.deepEqual((await lintN8n({ cwd: fixture.cwd, referenceDir: 'references', baselinePath: 'baseline.json' })).summary, { known: 7, new: 0, total: 7 });
  assert.deepEqual((await lintProductionN8n({ cwd: fixture.cwd, productionDir: 'production' })).summary, { known: 0, new: 0, total: 0 });
}));

test('public APIs reject transparent, nested, and revoked Proxies without invoking traps', async () => withFixture(async (fixture) => {
  const cases = [
    [lintN8n, { cwd: fixture.cwd, referenceDir: 'references', baselinePath: 'baseline.json' }],
    [lintProductionN8n, { cwd: fixture.cwd, productionDir: 'production' }],
  ];
  for (const [api, options] of cases) {
    const calls = { getPrototypeOf: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, get: 0 };
    const transparent = new Proxy(options, {
      getPrototypeOf(target) { calls.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
      ownKeys(target) { calls.ownKeys += 1; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) { calls.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
      get(target, key, receiver) { calls.get += 1; return Reflect.get(target, key, receiver); },
    });
    assert.throws(() => api(transparent), /Invalid n8n lint public options/);
    assert.deepEqual(calls, { getPrototypeOf: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, get: 0 });
    assert.throws(() => api(new Proxy(transparent, {})), /Invalid n8n lint public options/);
    const revocable = Proxy.revocable(options, {}); revocable.revoke();
    assert.throws(() => api(revocable.proxy), /Invalid n8n lint public options/);
  }
}));

test('production scan blocks invalid JSON and every valid non-object JSON value as structure-only findings', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'invalid.json', '{');
  for (const [index, value] of ['null', 'false', '0', '[]', '"string"'].entries()) await writeProduction(fixture, `non-object-${index}.json`, value);
  const report = await lintProduction(fixture);
  assert.equal(report.findings.filter((finding) => finding.code === 'INVALID_JSON').length, 1);
  for (let index = 0; index < 5; index += 1) assert.deepEqual(report.findings.filter((finding) => finding.path === `production/non-object-${index}.json`).map((finding) => finding.code), ['INVALID_WORKFLOW_STRUCTURE']);
  assert.ok(report.findings.every((finding) => finding.baseline === 'new'));
}));

test('production scan detects Postgres, Code, and Function writes', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'postgres.json', workflow('postgres', { type: 'n8n-nodes-base.postgres', parameters: { operation: 'update' } }));
  await writeProduction(fixture, 'code.json', workflow('code', { type: 'n8n-nodes-base.code', parameters: { jsCode: 'db.query("DELETE FROM chapter")' } }));
  await writeProduction(fixture, 'function.json', workflow('function', { type: 'n8n-nodes-base.function', parameters: { functionCode: "db.query('INSERT INTO chapter VALUES (1)')" } }));
  const report = await lintProduction(fixture);
  assert.equal(report.findings.filter((finding) => finding.code === 'BARE_DATABASE_WRITE').length, 3);
}));

test('production scan classifies deprecated, experimental, and unknown RPCs', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'rpcs.json', workflow('rpcs', { parameters: { jsCode: 'rpc_create_chapter_target(); rpc_acquire_run_lock(); rpc_unregistered_production();' } }));
  assert.deepEqual(codes(await lintProduction(fixture)).sort(), ['DEPRECATED_RPC', 'EXPERIMENTAL_RPC', 'UNKNOWN_RPC']);
}));

test('combined CLI uses exit 1 for findings and exit 2 for arguments', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'active.json', { ...workflow('active'), active: true });
  const finding = spawnSync(process.execPath, [source, '--reference-dir', 'references', '--baseline', 'baseline.json', '--production-dir', 'production'], { cwd: fixture.cwd, encoding: 'utf8' });
  assert.equal(finding.status, 1); assert.equal(JSON.parse(finding.stdout).production.summary.new, 1);
  const malformed = spawnSync(process.execPath, [source, '--production-dir'], { cwd: fixture.cwd, encoding: 'utf8' });
  assert.equal(malformed.status, 2); assert.match(malformed.stderr, /Missing value/);
}));

test('every CLI path rejects absolute, parent traversal, and Windows foreign-drive values', async () => withFixture(async (fixture) => {
  const absolute = join(fixture.cwd, 'references');
  for (const flag of ['--reference-dir', '--baseline', '--production-dir']) {
    const absoluteResult = spawnSync(process.execPath, [source, flag, absolute], { cwd: fixture.cwd, encoding: 'utf8' });
    assert.equal(absoluteResult.status, 2); assert.match(absoluteResult.stderr, /relative to cwd/);
    const traversal = spawnSync(process.execPath, [source, flag, 'nested/../target'], { cwd: fixture.cwd, encoding: 'utf8' });
    assert.equal(traversal.status, 2); assert.match(traversal.stderr, /parent traversal/);
  }
  if (process.platform === 'win32') for (const flag of ['--reference-dir', '--baseline', '--production-dir']) {
    const foreignDrive = `${process.cwd().slice(0, 1).toUpperCase() === 'Z' ? 'Y' : 'Z'}:\\outside`;
    const result = spawnSync(process.execPath, [source, flag, foreignDrive], { cwd: fixture.cwd, encoding: 'utf8' });
    assert.equal(result.status, 2); assert.match(result.stderr, /relative to cwd/);
  }
}));

test('production root and recursive directory links fail closed without reading external content', async () => withFixture(async (fixture) => withOutsideFixture(async (outside) => {
  const secret = 'external-directory-secret'; await writeFile(join(outside, 'workflow.json'), JSON.stringify({ ...workflow('outside'), nodes: [validNode('outside', { parameters: { password: secret } })] }));
  await makeDirectoryLink(outside, join(fixture.cwd, 'linked-production'));
  await assert.rejects(lintProduction(fixture, 'linked-production'), /symbolic link|junction/);
  await mkdir(join(fixture.cwd, 'production'), { recursive: true }); await makeDirectoryLink(outside, join(fixture.cwd, 'production', 'nested'));
  await assert.rejects(lintProduction(fixture), /symbolic links|junctions/);
  const cli = spawnSync(process.execPath, [source, '--reference-dir', 'references', '--baseline', 'baseline.json', '--production-dir', 'linked-production'], { cwd: fixture.cwd, encoding: 'utf8' });
  assert.equal(cli.status, 2); assert.ok(!`${cli.stdout}${cli.stderr}`.includes(secret));
})));

test('production file links fail closed when file symlinks are available', async (t) => withFixture(async (fixture) => withOutsideFixture(async (outside) => {
  await writeFile(join(outside, 'workflow.json'), JSON.stringify(workflow('outside'))); await mkdir(join(fixture.cwd, 'production'), { recursive: true });
  if (!await makeFileLink(join(outside, 'workflow.json'), join(fixture.cwd, 'production', 'linked.json'))) { t.skip('file symlinks are unavailable on this host'); return; }
  await assert.rejects(lintProduction(fixture), /symbolic links|junctions/);
})));

test('TOCTOU replacement of the verified root directory fails closed', async () => withFixture(async (fixture) => withOutsideFixture(async (outside) => {
  const secret = 'root-race-secret'; await writeFile(join(outside, 'outside.json'), JSON.stringify({ ...workflow('outside'), nodes: [validNode('outside', { parameters: { password: secret } })] }));
  await writeProduction(fixture, 'inside.json', workflow('inside')); const root = join(fixture.cwd, 'production'); let swapped = false;
  const error = await assert.rejects(lintProductionInternal(fixture, 'production', { afterDirectoryVerifiedBeforeRead: async ({ path }) => {
    if (!swapped && path === root) { swapped = true; await rm(root, { recursive: true, force: true }); await makeDirectoryLink(outside, root); }
  } }), /symbolic link|junction/);
  assert.ok(swapped); assert.ok(!String(error).includes(secret));
})));

test('TOCTOU replacement of a verified child directory fails closed', async () => withFixture(async (fixture) => withOutsideFixture(async (outside) => {
  await writeFile(join(outside, 'outside.json'), JSON.stringify(workflow('outside'))); await writeProduction(fixture, 'nested/inside.json', workflow('inside'));
  const child = join(fixture.cwd, 'production', 'nested'); let swapped = false;
  await assert.rejects(lintProductionInternal(fixture, 'production', { afterDirectoryVerifiedBeforeRead: async ({ path }) => {
    if (!swapped && path === child) { swapped = true; await rm(child, { recursive: true, force: true }); await makeDirectoryLink(outside, child); }
  } }), /symbolic link|junction/);
  assert.ok(swapped);
})));

test('TOCTOU replacement of a verified file with another inode fails closed', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'inside.json', workflow('inside')); const inside = join(fixture.cwd, 'production', 'inside.json'); let swapped = false;
  const error = await assert.rejects(lintProductionInternal(fixture, 'production', { afterFileVerifiedBeforeOpen: async ({ path }) => {
    if (!swapped && path === inside) { swapped = true; await rm(inside, { force: true }); await writeFile(inside, JSON.stringify(workflow('replacement'))); }
  } }), /changed before it could be opened/);
  assert.ok(swapped); assert.ok(!String(error).includes('replacement'));
}));

test('collection snapshot rejects a file replaced after enumeration before its first capture', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'early.json', workflow('early')); await writeProduction(fixture, 'late.json', workflow('late'));
  const late = join(fixture.cwd, 'production', 'late.json'); let replaced = false;
  await assert.rejects(lintProductionInternal(fixture, 'production', { afterCollectionEnumeratedBeforeCapture: async () => {
    if (!replaced) { replaced = true; await rm(late, { force: true }); await writeFile(late, JSON.stringify(workflow('replacement'))); }
  } }), /collection changed/);
  assert.ok(replaced);
}));

test('collection snapshot rejects an already-read workflow modified before final acceptance', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'inside.json', workflow('inside')); const inside = join(fixture.cwd, 'production', 'inside.json'); let changed = false;
  await assert.rejects(lintProductionInternal(fixture, 'production', { afterCollectionScannedBeforeVerify: async () => {
    if (!changed) { changed = true; await writeFile(inside, JSON.stringify({ ...workflow('inside'), active: true })); }
  } }), /collection changed/);
  assert.ok(changed);
}));

test('collection snapshot rejects JSON additions and deletions after scanning', async () => {
  await withFixture(async (fixture) => {
    await writeProduction(fixture, 'inside.json', workflow('inside')); let added = false;
    await assert.rejects(lintProductionInternal(fixture, 'production', { afterCollectionScannedBeforeVerify: async () => {
      if (!added) { added = true; await writeProduction(fixture, 'added.json', workflow('added')); }
    } }), /collection changed/);
    assert.ok(added);
  });
  await withFixture(async (fixture) => {
    await writeProduction(fixture, 'inside.json', workflow('inside')); const inside = join(fixture.cwd, 'production', 'inside.json'); let deleted = false;
    await assert.rejects(lintProductionInternal(fixture, 'production', { afterCollectionScannedBeforeVerify: async () => {
      if (!deleted) { deleted = true; await rm(inside, { force: true }); }
    } }), /collection changed/);
    assert.ok(deleted);
  });
});

test('production scan rejects hard-linked JSON workflows', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'source.json', workflow('source'));
  await link(join(fixture.cwd, 'production', 'source.json'), join(fixture.cwd, 'production', 'linked.json'));
  await assert.rejects(lintProduction(fixture), /hard linked/);
}));

test('collection snapshot rejects a rename replacement after scanning', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'inside.json', workflow('inside')); const inside = join(fixture.cwd, 'production', 'inside.json'); const replacement = join(fixture.cwd, 'replacement.json'); await writeFile(replacement, JSON.stringify(workflow('replacement'))); let replaced = false;
  await assert.rejects(lintProductionInternal(fixture, 'production', { afterCollectionScannedBeforeVerify: async () => {
    if (!replaced) { replaced = true; await rm(inside, { force: true }); await rename(replacement, inside); }
  } }), /collection changed/);
  assert.ok(replaced);
}));

test('collection snapshot rejects same-size content changes with restored mtime', async () => withFixture(async (fixture) => {
  await writeProduction(fixture, 'inside.json', '"aaaa"'); const inside = join(fixture.cwd, 'production', 'inside.json'); const before = await stat(inside); let changed = false;
  await assert.rejects(lintProductionInternal(fixture, 'production', { afterCollectionScannedBeforeVerify: async () => {
    if (!changed) { changed = true; await writeFile(inside, '"bbbb"'); await utimes(inside, before.atime, before.mtime); }
  } }), /collection changed/);
  assert.ok(changed);
}));
