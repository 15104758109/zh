import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const database = process.env.ZH_WORKBENCH_DATABASE ?? "zh_narrative_test";
if (!new Set(["zh_narrative", "zh_narrative_test"]).has(database)) throw new Error("ZH_WORKBENCH_DATABASE must be zh_narrative or zh_narrative_test");
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "install.sql"), "utf8");
execFileSync("docker", ["exec", "-i", "n8n-pgvector", "sh", "-lc", `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -f -`], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
