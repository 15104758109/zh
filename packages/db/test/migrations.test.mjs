import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { databaseSchema, migrations, migrationsDirectory, repositoryRoot, sql } from "../src/database.mjs";

const publicDecoys = ["runtime_runs", "audit_attempt_log", "idempotency_keys"];

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

function migrationPath(name) {
  return path.join(migrationsDirectory, name);
}

function nextMigrationVersion() {
  const versions = migrations().map((migration) => Number(migration.name.slice(0, 4)));
  const version = Math.max(...versions) + 1;
  assert.ok(version <= 9999, "migration fixture version must fit four digits");
  return String(version).padStart(4, "0");
}

function withMigration(name, contents, callback) {
  const filename = migrationPath(name);
  writeFileSync(filename, contents);
  try {
    callback();
  } finally {
    unlinkSync(filename);
  }
}

before(() => {
  assert.equal(
    query(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('${publicDecoys.join("','")}')`),
    "0",
    "public decoy names must be unused before the test",
  );
  for (const table of publicDecoys) {
    sql(`CREATE TABLE public.${table} (marker text NOT NULL); INSERT INTO public.${table} (marker) VALUES ('public-decoy-${table}')`);
  }
});

after(() => {
  for (const table of publicDecoys) {
    assert.equal(query(`SELECT marker FROM public.${table}`), `public-decoy-${table}`);
    sql(`DROP TABLE public.${table}`);
  }
  assert.equal(
    query(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('${publicDecoys.join("','")}')`),
    "0",
  );
});

test("empty database migrates and repeated migration is idempotent", () => {
  run("db:reset");
  run("db:migrate");
  assert.equal(query(`SELECT count(*) FROM ${databaseSchema}.schema_migrations`), String(migrations().length));
  assert.equal(query(`SELECT to_regclass('${databaseSchema}.runtime_runs') IS NOT NULL`), "t");
  assert.equal(query(`SELECT to_regclass('${databaseSchema}.audit_attempt_log') IS NOT NULL`), "t");
  assert.equal(query(`SELECT to_regclass('${databaseSchema}.idempotency_keys') IS NOT NULL`), "t");
});

test("migration checksum drift is rejected", () => {
  run("db:reset");
  const migration = migrations()[0];
  sql(`UPDATE ${databaseSchema}.schema_migrations SET checksum = 'drift' WHERE migration_name = '${migration.name}'`);
  assert.throws(() => run("db:migrate:check"), /migration drift/);
  sql(`UPDATE ${databaseSchema}.schema_migrations SET checksum = '${migration.checksum}' WHERE migration_name = '${migration.name}'`);
  run("db:migrate:check");
});

test("invalid migration filenames and duplicate versions fail closed", () => {
  const version = nextMigrationVersion();
  withMigration(`${version}__Invalid.sql`, "SELECT 1;\n", () => {
    assert.throws(() => migrations(), /invalid SQL migration filename/);
  });
  withMigration(`${migrations()[0].name.slice(0, 4)}__duplicate.sql`, "SELECT 1;\n", () => {
    assert.throws(() => migrations(), /duplicate migration version/);
  });
});

test("unknown ledger entries and pending migrations are rejected", () => {
  run("db:reset");
  sql(`INSERT INTO ${databaseSchema}.schema_migrations (migration_name, checksum) VALUES ('9999__unknown.sql', 'unknown')`);
  assert.throws(() => run("db:migrate:check"), /applied migration is missing from disk/);

  run("db:reset");
  withMigration(`${nextMigrationVersion()}__pending.sql`, "SELECT 1;\n", () => {
    assert.throws(() => run("db:migrate:check"), /pending migrations/);
  });
});

test("failed transaction leaves no run, audit, or idempotency row", () => {
  run("db:reset");
  assert.throws(() => sql(`BEGIN;
    INSERT INTO ${databaseSchema}.runtime_runs (run_id) VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO ${databaseSchema}.audit_attempt_log (audit_attempt_id, run_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
    INSERT INTO ${databaseSchema}.idempotency_keys (idempotency_key) VALUES ('failure-test');
    SELECT 1 / 0;
    COMMIT;`));
  assert.equal(query(`SELECT count(*) FROM ${databaseSchema}.runtime_runs`), "0");
  assert.equal(query(`SELECT count(*) FROM ${databaseSchema}.audit_attempt_log`), "0");
  assert.equal(query(`SELECT count(*) FROM ${databaseSchema}.idempotency_keys`), "0");
});
