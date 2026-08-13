import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const database = process.env.ZH_V7_DATABASE ?? "zh_narrative";
const container = process.env.ZH_V7_POSTGRES_CONTAINER ?? "n8n-pgvector";
if (database !== "zh_narrative") throw new Error("ZH_V7_DATABASE must be zh_narrative; refusing to target another database");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sqlFile = path.join(root, "db", "install", "v7-data-rpc-contract.sql");
const sql = readFileSync(sqlFile, "utf8");

execFileSync("docker", [
  "exec", "-i", container, "sh", "-lc",
  `exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${database} -f -`,
], { cwd: root, input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });

process.stdout.write(`V7 data/RPC contract rebuild completed in ${database}\n`);
