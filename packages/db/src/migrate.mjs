import { readFileSync } from "node:fs";
import { databaseSchema, migrations, ensureDatabase, sql } from "./database.mjs";

const checkOnly = process.argv.includes("--check");

function appliedMigrations() {
  const rows = sql(`SELECT migration_name || '|' || checksum FROM ${databaseSchema}.schema_migrations ORDER BY migration_name`).trim();
  return new Map(rows ? rows.split("\n").map((row) => row.split("|", 2)) : []);
}

function verifyApplied(available, applied) {
  for (const [name, checksum] of applied) {
    const migration = available.get(name);
    if (!migration) throw new Error(`migration drift: applied migration is missing from disk: ${name}`);
    if (migration.checksum !== checksum) throw new Error(`migration drift: checksum mismatch for ${name}`);
  }
}

ensureDatabase();
sql(`CREATE TABLE IF NOT EXISTS ${databaseSchema}.schema_migrations (
  migration_name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
)`);

const available = new Map(migrations().map((migration) => [migration.name, migration]));
const applied = appliedMigrations();
verifyApplied(available, applied);

if (checkOnly) {
  const pending = [...available.keys()].filter((name) => !applied.has(name));
  if (pending.length) throw new Error(`pending migrations: ${pending.join(", ")}`);
  process.stdout.write("migration check passed\n");
  process.exit(0);
}

for (const migration of available.values()) {
  if (applied.has(migration.name)) continue;
  const body = readFileSync(migration.filename, "utf8");
  sql(`BEGIN;
${body}
INSERT INTO ${databaseSchema}.schema_migrations (migration_name, checksum) VALUES ('${migration.name}', '${migration.checksum}');
COMMIT;`);
  process.stdout.write(`applied ${migration.name}\n`);
}
