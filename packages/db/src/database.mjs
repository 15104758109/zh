import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(packageDirectory, "../../..");
export const migrationsDirectory = path.join(repositoryRoot, "db", "migrations");
export const databaseSchema = "zhreplan";
const postgresContainer = process.env.ZHREPLAN_POSTGRES_CONTAINER ?? "n8n-pgvector";

export function sql(statement) {
  return execFileSync("docker", [
    "exec", "-i", postgresContainer, "sh", "-lc",
    'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -f -',
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: `CREATE SCHEMA IF NOT EXISTS ${databaseSchema};\nSET search_path TO ${databaseSchema};\n${statement}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function migrations() {
  const parsed = [];
  const versions = new Set();

  for (const entry of readdirSync(migrationsDirectory, { withFileTypes: true })) {
    if (!/\.sql$/i.test(entry.name)) continue;
    const match = /^(\d{4})__([a-z0-9_]+)\.sql$/.exec(entry.name);
    if (!entry.isFile() || !match) {
      throw new Error(`invalid SQL migration filename: ${entry.name}`);
    }
    if (versions.has(match[1])) {
      throw new Error(`duplicate migration version: ${match[1]}`);
    }
    versions.add(match[1]);
    const name = entry.name;
    const contents = readFileSync(path.join(migrationsDirectory, name));
    parsed.push({
      name,
      version: Number(match[1]),
      filename: path.join(migrationsDirectory, name),
      checksum: createHash("sha256").update(contents).digest("hex"),
    });
  }

  return parsed
    .sort((left, right) => left.version - right.version)
    .map(({ version, ...migration }) => migration);
}

export function ensureDatabase() {
  sql("SELECT 1");
}
