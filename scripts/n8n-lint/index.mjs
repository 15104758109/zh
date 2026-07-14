import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASELINE, DEFAULT_PRODUCTION_DIR, DEFAULT_REFERENCE_DIR, lintLegacyN8nInternal, lintProductionN8nInternal } from './internal-scanner.mjs';

function rejectParentTraversal(value, label) {
  if (value.split(/[\\/]+/).includes('..')) throw new Error(`${label} must not contain parent traversal`);
}

function checkedOptions({ referenceDir = DEFAULT_REFERENCE_DIR, baselinePath = DEFAULT_BASELINE, cwd = process.cwd() } = {}) {
  return { referenceDir, baselinePath, cwd };
}

export async function lintN8n(options = {}) {
  return lintLegacyN8nInternal(checkedOptions(options));
}

export async function lintProductionN8n(options = {}) {
  if (Object.hasOwn(options, 'hooks')) throw new Error('hooks are internal-only test controls');
  const { productionDir = DEFAULT_PRODUCTION_DIR, cwd = process.cwd() } = options;
  return lintProductionN8nInternal({ productionDir, cwd });
}

function parseArgs(args) {
  const options = {}; const names = new Map([['--reference-dir', 'referenceDir'], ['--baseline', 'baselinePath'], ['--production-dir', 'productionDir']]);
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]; const key = names.get(name); const value = args[index + 1];
    if (!key) throw new Error(`Unknown argument: ${name}`);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${name}`);
    if (isAbsolute(value)) throw new Error(`${name} path must be relative to cwd`);
    rejectParentTraversal(value, `${name} path`); options[key] = value; index += 1;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2)); const legacy = await lintN8n(options); const production = await lintProductionN8n(options); const report = { ...legacy, production };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = legacy.summary.new === 0 && production.summary.new === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`n8n lint failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2;
  }
}
