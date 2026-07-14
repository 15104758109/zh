import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASELINE, DEFAULT_PRODUCTION_DIR, DEFAULT_REFERENCE_DIR, lintLegacyN8nInternal, lintProductionN8nInternal } from './internal-scanner.mjs';

function rejectParentTraversal(value, label) {
  if (value.split(/[\\/]+/).includes('..')) throw new Error(`${label} must not contain parent traversal`);
}

const PUBLIC_OPTIONS_ERROR = 'Invalid n8n lint public options';
const LEGACY_OPTION_NAMES = new Set(['referenceDir', 'baselinePath', 'cwd']);
const PRODUCTION_OPTION_NAMES = new Set(['productionDir', 'cwd']);

function publicOptions(options, allowed) {
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options) || Object.getPrototypeOf(options) !== Object.prototype) throw new Error(PUBLIC_OPTIONS_ERROR);
    if (Object.getOwnPropertySymbols(options).length !== 0) throw new Error(PUBLIC_OPTIONS_ERROR);
    const values = {};
    for (const name of Object.getOwnPropertyNames(options)) {
      if (!allowed.has(name)) throw new Error(PUBLIC_OPTIONS_ERROR);
      const descriptor = Object.getOwnPropertyDescriptor(options, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error(PUBLIC_OPTIONS_ERROR);
      values[name] = descriptor.value;
    }
    return values;
  } catch { throw new Error(PUBLIC_OPTIONS_ERROR); }
}

function optionOrDefault(options, name, value) { return Object.hasOwn(options, name) && options[name] !== undefined ? options[name] : value; }

export function lintN8n(options = {}) {
  const values = publicOptions(options, LEGACY_OPTION_NAMES);
  return lintLegacyN8nInternal({ referenceDir: optionOrDefault(values, 'referenceDir', DEFAULT_REFERENCE_DIR), baselinePath: optionOrDefault(values, 'baselinePath', DEFAULT_BASELINE), cwd: optionOrDefault(values, 'cwd', process.cwd()) });
}

export function lintProductionN8n(options = {}) {
  const values = publicOptions(options, PRODUCTION_OPTION_NAMES);
  return lintProductionN8nInternal({ productionDir: optionOrDefault(values, 'productionDir', DEFAULT_PRODUCTION_DIR), cwd: optionOrDefault(values, 'cwd', process.cwd()) });
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
    const options = parseArgs(process.argv.slice(2)); const legacy = await lintN8n({ referenceDir: options.referenceDir, baselinePath: options.baselinePath }); const production = await lintProductionN8n({ productionDir: options.productionDir }); const report = { ...legacy, production };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = legacy.summary.new === 0 && production.summary.new === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`n8n lint failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2;
  }
}
