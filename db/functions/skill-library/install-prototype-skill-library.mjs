import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const database = process.env.ZH_SKILL_LIBRARY_DATABASE ?? "zh_narrative_test";
if (database !== "zh_narrative_test") throw new Error("this installer is restricted to zh_narrative_test");

const directory = path.dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(path.join(directory, "install-prototype-skill-library.sql"), "utf8");
execFileSync("docker", [
  "exec", "-i", process.env.ZH_SKILL_LIBRARY_POSTGRES_CONTAINER ?? "n8n-pgvector", "sh", "-lc",
  `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -f -`,
], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
