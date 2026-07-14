import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseTaskArguments, resolvePnpmExecPath, routeTask, runTask } from "../../../scripts/verify-task/index.mjs";

function withPnpmFixture(options, callback) {
  const temporary = mkdtempSync(join(tmpdir(), "verify-task-"));
  const root = join(temporary, "pnpm");
  const binDirectory = join(root, "bin");
  const cli = join(binDirectory, options.extension ?? "pnpm.cjs");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(cli, "process.exitCode = 0;\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: options.name ?? "pnpm",
    version: options.version ?? "9.15.9",
    bin: options.bin ?? { pnpm: "bin/pnpm.cjs" },
  }));
  try {
    callback({ cli, root, temporary });
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

test("routes each registered task to its exact ordered pnpm arguments", () => {
  assert.deepEqual(routeTask("F0-01-REPO"), [["run", "lint"], ["run", "typecheck"], ["run", "build"]]);
  assert.deepEqual(routeTask("F0-02-CONTRACTS"), [["--filter", "@zh/contracts", "test"]]);
  assert.deepEqual(routeTask("F0-03-MIGRATIONS"), [["run", "db:reset"], ["run", "db:migrate:check"], ["run", "test:db"]]);
  assert.deepEqual(routeTask("F0-09-N8N-LINT"), [["run", "n8n:lint"], ["run", "test:n8n-lint"]]);
  assert.deepEqual(routeTask("F0-17-INTERACTION-CONTRACTS"), [["run", "interaction:lint"], ["run", "test:interaction-contracts"]]);
});

test("runs commands in order and stops at the first failure", async () => {
  const seen = [];
  const status = await runTask("F0-03-MIGRATIONS", async (args) => {
    seen.push(args);
    return seen.length === 2 ? 17 : 0;
  });
  assert.equal(status, 17);
  assert.deepEqual(seen, [["run", "db:reset"], ["run", "db:migrate:check"]]);
});

test("rejects unknown and unmerged task identifiers", () => {
  assert.throws(() => routeTask("F0-04-LOCAL-OPERATOR"), /TASK_VERIFIER_NOT_REGISTERED/);
  assert.throws(() => routeTask("F0-06-OBSERVABILITY"), /TASK_VERIFIER_NOT_REGISTERED/);
  assert.throws(() => routeTask("F0-08-UNKNOWN"), /TASK_VERIFIER_NOT_REGISTERED/);
});

test("rejects missing, extra, and injection-shaped task arguments", () => {
  assert.throws(() => parseTaskArguments([]), /TASK_VERIFIER_INVALID_ARGUMENTS/);
  assert.throws(() => parseTaskArguments(["F0-01-REPO", "extra"]), /TASK_VERIFIER_INVALID_ARGUMENTS/);
  assert.throws(() => parseTaskArguments(["F0-01-REPO;whoami"]), /TASK_VERIFIER_INVALID_ARGUMENTS/);
});

test("accepts only the pnpm 9.15.9 package bin identity", () => {
  withPnpmFixture({}, ({ cli }) => assert.equal(resolvePnpmExecPath(cli), cli));
  withPnpmFixture({ bin: "bin/pnpm.cjs" }, ({ cli }) => assert.equal(resolvePnpmExecPath(cli), cli));
});

test("rejects unavailable and non-pnpm executable paths", () => {
  assert.throws(() => resolvePnpmExecPath(), /PNPM_EXEC_PATH_UNAVAILABLE/);
  assert.throws(() => resolvePnpmExecPath("relative/pnpm.cjs"), /PNPM_EXEC_PATH_UNAVAILABLE/);
  assert.throws(() => resolvePnpmExecPath(join(tmpdir(), "missing-pnpm.cjs")), /PNPM_EXEC_PATH_UNAVAILABLE/);

  withPnpmFixture({ extension: "pnpm.txt" }, ({ cli }) => assert.throws(() => resolvePnpmExecPath(cli), /PNPM_EXEC_PATH_UNAVAILABLE/));
  withPnpmFixture({ name: "not-pnpm" }, ({ cli }) => assert.throws(() => resolvePnpmExecPath(cli), /PNPM_EXEC_PATH_UNAVAILABLE/));
  withPnpmFixture({ version: "9.15.8" }, ({ cli }) => assert.throws(() => resolvePnpmExecPath(cli), /PNPM_EXEC_PATH_UNAVAILABLE/));
  withPnpmFixture({ bin: {} }, ({ cli }) => assert.throws(() => resolvePnpmExecPath(cli), /PNPM_EXEC_PATH_UNAVAILABLE/));
  withPnpmFixture({ bin: "bin/other.cjs" }, ({ cli, root }) => {
    writeFileSync(join(root, "bin", "other.cjs"), "process.exitCode = 0;\n");
    assert.throws(() => resolvePnpmExecPath(cli), /PNPM_EXEC_PATH_UNAVAILABLE/);
  });
});

test("rejects arbitrary JavaScript files, directories, and escaped bin mappings", () => {
  for (const extension of ["arbitrary.js", "arbitrary.cjs", "arbitrary.mjs"]) {
    withPnpmFixture({}, ({ root }) => {
      const arbitrary = join(root, "bin", extension);
      writeFileSync(arbitrary, "process.exitCode = 0;\n");
      assert.throws(() => resolvePnpmExecPath(arbitrary), /PNPM_EXEC_PATH_UNAVAILABLE/);
    });
  }
  withPnpmFixture({}, ({ root }) => assert.throws(() => resolvePnpmExecPath(join(root, "bin")), /PNPM_EXEC_PATH_UNAVAILABLE/));
  withPnpmFixture({ bin: "../pnpm.cjs" }, ({ cli, temporary }) => {
    writeFileSync(join(temporary, "pnpm.cjs"), "process.exitCode = 0;\n");
    assert.throws(() => resolvePnpmExecPath(cli), /PNPM_EXEC_PATH_UNAVAILABLE/);
  });
});
