import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  coverageReport,
  lintContract,
  parseInteractionYaml,
} from "../../packages/interaction-contracts/dist/src/index.js";

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

export async function runInteractionLint({ contractsDirectory = path.resolve("contracts/interactions"), coverageModel } = {}) {
  const files = await contractFiles(contractsDirectory);
  const contracts = [];
  const issues = [];
  for (const file of files) {
    try {
      const contract = parseInteractionYaml(await readFile(file, "utf8"));
      contracts.push(contract);
      const expectedOwner = coverageModel?.active?.find((item) => item.id === contract.contract_id)?.owner;
      issues.push(...lintContract(contract, file, expectedOwner));
    } catch (error) {
      issues.push({ code: "PARSE", file, path: "", message: error instanceof Error ? error.message : String(error) });
    }
  }
  const coverage = coverageReport(contracts, coverageModel);
  return { ok: issues.length === 0 && coverage.missing_active_fp.length === 0, files: files.length, issues, coverage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runInteractionLint();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
