import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { databaseSchema, migrations, repositoryRoot, sql } from "../src/database.mjs";

function run(script) {
  const commands = {
    "db:migrate": ["packages/db/src/migrate.mjs"],
    "db:migrate:check": ["packages/db/src/migrate.mjs", "--check"],
    "db:reset": ["packages/db/src/reset.mjs"],
  };
  return execFileSync(process.execPath, commands[script], { cwd: repositoryRoot, encoding: "utf8" });
}

function query(statement) {
  return sql(statement).trim();
}

test("empty database migrates and repeated migration is idempotent", () => {
  run("db:reset");
  run("db:migrate");
  assert.equal(query("SELECT count(*) FROM schema_migrations"), String(migrations().length));
  assert.equal(query(`SELECT to_regclass('${databaseSchema}.runtime_runs') IS NOT NULL`), "t");
  assert.equal(query(`SELECT to_regclass('${databaseSchema}.audit_attempt_log') IS NOT NULL`), "t");
  assert.equal(query(`SELECT to_regclass('${databaseSchema}.idempotency_keys') IS NOT NULL`), "t");
});

test("migration checksum drift is rejected", () => {
  run("db:reset");
  const migration = migrations()[0];
  sql(`UPDATE schema_migrations SET checksum = 'drift' WHERE migration_name = '${migration.name}'`);
  assert.throws(() => run("db:migrate:check"), /migration drift/);
  sql(`UPDATE schema_migrations SET checksum = '${migration.checksum}' WHERE migration_name = '${migration.name}'`);
  run("db:migrate:check");
});

test("failed transaction leaves no run, audit, or idempotency row", () => {
  run("db:reset");
  assert.throws(() => sql(`BEGIN;
    INSERT INTO runtime_runs (run_id) VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO audit_attempt_log (audit_attempt_id, run_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
    INSERT INTO idempotency_keys (idempotency_key) VALUES ('failure-test');
    SELECT 1 / 0;
    COMMIT;`));
  assert.equal(query("SELECT count(*) FROM runtime_runs"), "0");
  assert.equal(query("SELECT count(*) FROM audit_attempt_log"), "0");
  assert.equal(query("SELECT count(*) FROM idempotency_keys"), "0");
});
