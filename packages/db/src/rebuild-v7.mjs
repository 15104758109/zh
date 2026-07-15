import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const database = process.env.ZH_V7_DATABASE ?? "zh_narrative";
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
if (database !== "zh_narrative") throw new Error("ZH_V7_DATABASE must be zh_narrative; refusing to target another database");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sqlFile = path.join(root, "db", "install", "v7-product.sql");
const sql = readFileSync(sqlFile, "utf8");

execFileSync("docker", [
  "exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "n8n", "-d", database, "-f", "-",
], { cwd: root, input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });

execFileSync(process.execPath, [path.join(root, "db", "seeds", "skill-library", "install-v7-seeds.mjs")], {
  cwd: root,
  env: { ...process.env, ZH_V7_DATABASE: database, ZH_V7_POSTGRES_CONTAINER: container },
  stdio: "inherit",
});

process.stdout.write(`V7 product install completed in ${database}\n`);
