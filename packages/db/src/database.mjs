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
    input: `CREATE SCHEMA IF NOT EXISTS ${databaseSchema};\nSET search_path TO ${databaseSchema}, public;\n${statement}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function migrations() {
  return readdirSync(migrationsDirectory)
    .filter((name) => /^\d+__[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => {
      const contents = readFileSync(path.join(migrationsDirectory, name));
      return {
        name,
        filename: path.join(migrationsDirectory, name),
        checksum: createHash("sha256").update(contents).digest("hex"),
      };
    });
}

export function ensureDatabase() {
  sql("SELECT 1");
}
