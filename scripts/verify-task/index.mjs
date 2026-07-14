import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
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

export function resolvePnpmExecPath(npmExecPath) {
  try {
    if (typeof npmExecPath !== "string" || !isAbsolute(npmExecPath) || ![".js", ".cjs", ".mjs"].includes(extname(npmExecPath))) {
      throw new Error();
    }
    const cli = realpathSync(npmExecPath);
    if (!statSync(cli).isFile()) throw new Error();
    const packageRoot = dirname(dirname(cli));
    const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    const bin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.pnpm;
    if (metadata.name !== "pnpm" || metadata.version !== "9.15.9" || typeof bin !== "string") throw new Error();
    const binPath = resolve(packageRoot, bin);
    const binRelative = relative(packageRoot, binPath);
    if (!binRelative || binRelative.startsWith("..") || isAbsolute(binRelative) || realpathSync(binPath) !== cli) throw new Error();
    return cli;
  } catch {
    throw new Error("PNPM_EXEC_PATH_UNAVAILABLE");
  }
}

function runPnpm(args) {
  const validatedCli = resolvePnpmExecPath(process.env.npm_execpath);
  const result = spawnSync(process.execPath, [validatedCli, ...args], {
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
