import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskArguments, routeTask, runTask } from "../../../scripts/verify-task/index.mjs";

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
