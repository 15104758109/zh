import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  coverageReport,
  lintContract,
  parseInteractionYaml,
} from "../../packages/interaction-contracts/dist/src/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function contractFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return contractFiles(file);
      return /\.ya?ml$/i.test(entry.name) ? [file] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function runInteractionLint({ contractsDirectory = path.join(REPO_ROOT, "contracts/interactions"), coverageModel, enforceCoverage = false } = {}) {
  const schemaPath = path.join(REPO_ROOT, "contracts/interactions/schema/interaction-contract.schema.json");
  let schema;
  try { schema = JSON.parse(await readFile(schemaPath, "utf8")); }
  catch (error) { return { ok: false, files: 0, issues: [{ code: "SCHEMA", file: schemaPath, path: "", message: error instanceof Error ? error.message : String(error) }], coverage: coverageReport([], coverageModel) }; }
  const files = await contractFiles(contractsDirectory);
  const contracts = [];
  const issues = [];
  for (const file of files) {
    try {
      const contract = parseInteractionYaml(await readFile(file, "utf8"));
      contracts.push(contract);
      issues.push(...lintContract(contract, schema, file, coverageModel));
    } catch (error) {
      issues.push({ code: "PARSE", file, path: "", message: error instanceof Error ? error.message : String(error) });
    }
  }
  const coverage = coverageReport(contracts, coverageModel);
  return { ok: issues.length === 0 && (!enforceCoverage || coverage.missing_active_fp.length === 0), files: files.length, issues, coverage, coverage_enforced: enforceCoverage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runInteractionLint({ enforceCoverage: process.argv.includes("--enforce-coverage") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
