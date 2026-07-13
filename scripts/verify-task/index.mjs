import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, extname } from "node:path";
import { fileURLToPath } from "node:url";

const taskCommands = Object.freeze({
  "F0-01-REPO": [["run", "lint"], ["run", "typecheck"], ["run", "build"]],
  "F0-02-CONTRACTS": [["--filter", "@zh/contracts", "test"]],
  "F0-03-MIGRATIONS": [["run", "db:reset"], ["run", "db:migrate:check"], ["run", "test:db"]],
  "F0-09-N8N-LINT": [["run", "n8n:lint"], ["run", "test:n8n-lint"]],
  "F0-17-INTERACTION-CONTRACTS": [["run", "interaction:lint"], ["run", "test:interaction-contracts"]],
});

export function routeTask(taskId) {
  const commands = taskCommands[taskId];
  if (!commands) throw new Error("TASK_VERIFIER_NOT_REGISTERED");
  return commands.map((args) => [...args]);
}

export async function runTask(taskId, runner) {
  for (const args of routeTask(taskId)) {
    const status = await runner(args);
    if (status !== 0) return status;
  }
  return 0;
}

export function parseTaskArguments(args) {
  if (args.length !== 1 || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(args[0])) {
    throw new Error("TASK_VERIFIER_INVALID_ARGUMENTS");
  }
  return args[0];
}

function runPnpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (
    typeof npmExecPath !== "string"
    || !isAbsolute(npmExecPath)
    || ![".js", ".cjs", ".mjs"].includes(extname(npmExecPath))
    || !existsSync(npmExecPath)
    || !statSync(npmExecPath).isFile()
  ) {
    throw new Error("PNPM_EXEC_PATH_UNAVAILABLE");
  }
  const result = spawnSync(process.execPath, [npmExecPath, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main(args) {
  try {
    const taskId = parseTaskArguments(args);
    const status = await runTask(taskId, runPnpm);
    process.exitCode = status;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
