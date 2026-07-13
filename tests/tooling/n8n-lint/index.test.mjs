import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintN8n } from '../../../scripts/n8n-lint/index.mjs';

async function fixture(workflows, baseline) {
  const cwd = await mkdtemp(join(tmpdir(), 'n8n-lint-'));
  await mkdir(join(cwd, 'references'));
  for (const [name, value] of Object.entries(workflows)) await writeFile(join(cwd, 'references', name), value);
  await writeFile(join(cwd, 'baseline.json'), JSON.stringify(baseline));
  return lintN8n({ cwd, referenceDir: 'references', baselinePath: 'baseline.json' });
}

test('reports malformed JSON and missing baseline workflows', async () => {
  const report = await fixture({ 'bad.json': '{' }, { workflows: [{ path: 'references/missing.json', id: 'x', name: 'x', sha256: 'x' }] });
  assert.deepEqual(report.findings.map((item) => item.code), ['CONTENT_DRIFT', 'INVALID_JSON', 'MISSING_WORKFLOW']);
});

test('reports identity, content, active, secret, RPC, and bare-write findings', async () => {
  const source = JSON.stringify({ id: 'changed', name: 'changed', active: true, nodes: [{ id: 'n1', type: 'n8n-nodes-base.postgres', parameters: { query: 'INSERT INTO x VALUES (1); rpc_acquire_run_lock; rpc_writeback_commit', apiKey: 'sk-abcdefghijklmnop' } }] });
  const report = await fixture({ 'one.json': source }, { workflows: [{ path: 'references/one.json', id: 'old', name: 'old', sha256: 'old' }] });
  assert.deepEqual(report.findings.map((item) => item.code), ['ACTIVE_STATUS_ANOMALY', 'BARE_DATABASE_WRITE', 'CONTENT_DRIFT', 'DEPRECATED_RPC', 'EXPERIMENTAL_RPC', 'SECRET_LITERAL', 'WORKFLOW_IDENTITY_DRIFT']);
  assert.equal(report.summary.new, 7);
  assert.ok(!JSON.stringify(report).includes('sk-abcdefghijklmnop'));
});

test('uses known fingerprints and stable ordering', async () => {
  const source = JSON.stringify({ id: 'x', name: 'x', active: false, nodes: [{ id: 'n', type: 'postgres', parameters: { query: 'DELETE FROM x' } }] });
  const first = await fixture({ 'z.json': source }, { workflows: [{ path: 'references/z.json', id: 'x', name: 'x', sha256: (await import('node:crypto')).createHash('sha256').update(source).digest('hex') }] });
  const second = await fixture({ 'z.json': source }, { workflows: [{ path: 'references/z.json', id: 'x', name: 'x', sha256: (await import('node:crypto')).createHash('sha256').update(source).digest('hex') }], known_issue_fingerprints: first.findings.map((item) => item.fingerprint) });
  assert.equal(second.summary.new, 0);
  assert.equal(second.findings[0].baseline, 'known');
  assert.deepEqual(second.findings, [...second.findings].sort((a, b) => a.path.localeCompare(b.path, 'en') || a.code.localeCompare(b.code, 'en') || a.fingerprint.localeCompare(b.fingerprint)));
});

test('reports duplicate identities and uses error exit codes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'n8n-lint-cli-'));
  const references = join(cwd, 'references');
  await mkdir(references);
  await writeFile(join(references, 'bad.json'), '{');
  await writeFile(join(cwd, 'baseline.json'), JSON.stringify({ workflows: [], known_issue_fingerprints: [] }));
  const source = fileURLToPath(new URL('../../../scripts/n8n-lint/index.mjs', import.meta.url));
  const lint = spawnSync(process.execPath, [source, '--reference-dir', references, '--baseline', join(cwd, 'baseline.json')]);
  const broken = spawnSync(process.execPath, [source, '--baseline', join(cwd, 'missing.json')]);
  assert.equal(lint.status, 1);
  assert.match(lint.stdout.toString(), /INVALID_JSON/);
  assert.equal(broken.status, 2);
  const report = await fixture({ 'a.json': JSON.stringify({ id: 'same', name: 'same', active: false }), 'b.json': JSON.stringify({ id: 'same', name: 'same', active: false }) }, { workflows: [] });
  assert.equal(report.findings.filter((item) => item.code === 'DUPLICATE_WORKFLOW_IDENTITY').length, 1);
});
