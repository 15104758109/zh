import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import crypto from "node:crypto";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const database = "zh_narrative_test";
const install = path.join(root, "db", "functions", "skill-library", "install-prototype-skill-library.mjs");
const rawSeed = JSON.parse(readFileSync(path.join(root, "db", "seeds", "skill-library", "default-skill-data.json"), "utf8"));
const optimized = JSON.parse(readFileSync(path.join(root, "db", "seeds", "skill-library", "optimized-skill-data.json"), "utf8"));
const report = JSON.parse(readFileSync(path.join(root, "docs", "skill-library", "prototype-skill-quality-report.json"), "utf8"));
const semantic = JSON.parse(readFileSync(path.join(root, "docs", "skill-library", "semantic-skill-research.json"), "utf8"));
const userCode = `user:test-skill-library-${process.pid}`;

function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "n8n-pgvector", "sh", "-lc",
    `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -At -f -`,
  ], { input: statement, encoding: "utf8" }).trim();
}

function installSeed() {
  execFileSync(process.execPath, [install], { cwd: root, encoding: "utf8" });
}

function prototypeMap(expression) {
  return JSON.parse(sql(`SELECT json_object_agg(skill_code, ${expression})::text FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%'`));
}

function fileHashes() {
  return Object.fromEntries([
    "db/seeds/skill-library/default-skill-data.json",
    "db/seeds/skill-library/optimized-skill-data.json",
    "docs/skill-library/prototype-skill-quality-report.json",
    "db/functions/skill-library/install-prototype-skill-library.sql",
  ].map((relative) => [relative, crypto.createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex")]));
}

function parsePrototype() {
  const source = readFileSync(path.join(root, "docs", "前端原型_v2", "pages", "skill_library.html"), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf("const defaultSkillData =");
  const end = source.indexOf("\n    };\n\n    let activeCategory", start);
  assert.ok(start >= 0 && end >= 0);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end + 7).replace("const defaultSkillData =", "globalThis.defaultSkillData =")};`, context);
  return context.defaultSkillData;
}

function assertUtf8Safe(value) {
  if (typeof value === "string") assert.equal(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), false, `unsafe text: ${value}`);
  else if (Array.isArray(value)) value.forEach(assertUtf8Safe);
  else if (value && typeof value === "object") Object.values(value).forEach(assertUtf8Safe);
}

test("semantic-reviewed prototype seed installs canonically, preserves user rows, and is idempotent", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parsePrototype())), rawSeed);
  const rawRows = Object.entries(rawSeed).flatMap(([category, items]) => items.map((raw) => ({ category, raw })));
  assert.equal(rawRows.length, 72);
  assert.equal(optimized.length, 72);
  assert.equal(report.decisions.length, 72);
  assert.deepEqual(report.decision_counts, { ACTIVE_OPTIMIZED: 24, ACTIVE_CONSTRAINED: 38, INACTIVE_ALIAS: 2, INACTIVE_UNSAFE: 8 });
  assert.equal(report.count_note.includes("54/8/6/4"), true);
  assert.equal(rawSeed["theme-combos"].find((row) => row.id === "tc-30").title.includes("奇幻"), true);
  assert.equal(report.source.includes("前端原型_v2"), true);
  assert.equal(report.count_note.includes("历史展示口径"), true);
  assert.equal(semantic.decisions.find((row) => row.id === "tc-30").reason.includes("奇幻"), true);
  assertUtf8Safe(optimized);
  assertUtf8Safe(report);
  assertUtf8Safe(semantic);
  const researchById = new Map(semantic.decisions.map((row) => [row.id, row]));
  assert.equal(new Set(semantic.decisions.map((row) => row.specific_gate)).size >= 20, true);
  assert.equal(new Set(semantic.decisions.map((row) => row.eval_check)).size >= 20, true);
  for (const row of optimized) {
    const research = researchById.get(row.output_structure.raw_source.id);
    assert.ok(research);
    assert.equal(row.decision, research.decision);
    assert.equal(row.research.reason, research.reason);
    assert.equal(row.input_requirements.specific_gate, research.specific_gate);
    assert.equal(row.eval_criteria.specific_eval_check, research.eval_check);
    assert.ok(["题材组合", "章节展开", "艺术呈现", "镜头语言"].includes(row.skill_category));
    assert.equal(row.quality_score, null);
  }

  const builder = path.join(root, "db", "functions", "skill-library", "build-install-sql.mjs");
  execFileSync(process.execPath, [builder], { cwd: root, encoding: "utf8" });
  const hashesBefore = fileHashes();
  execFileSync(process.execPath, [builder], { cwd: root, encoding: "utf8" });
  assert.deepEqual(fileHashes(), hashesBefore);

  installSeed();
  sql(`BEGIN; SET LOCAL zh.bypass_rpc = 'true'; INSERT INTO public.t_repertoire_assets (skill_code, skill_name, skill_category, candidate_status, lifecycle_status) VALUES ('${userCode}', 'user row must survive', 'commercial', 'draft', 'inactive'); COMMIT;`);
  try {
    installSeed();
    const firstSkillIds = prototypeMap("skill_id");
    sql("BEGIN; SET LOCAL zh.bypass_rpc = 'true'; UPDATE public.t_repertoire_assets SET candidate_status='committed', lifecycle_status='active' WHERE skill_code='prototype:skill-library:theme-combos:tc-54'; COMMIT;");
    sql("BEGIN; SET LOCAL zh.bypass_rpc = 'true'; UPDATE public.t_repertoire_assets SET skill_category='commercial' WHERE skill_code='prototype:skill-library:theme-combos:tc-35'; COMMIT;");
    installSeed();
    const secondSkillIds = prototypeMap("skill_id");
    assert.equal(sql("SELECT candidate_status || '/' || lifecycle_status FROM public.t_repertoire_assets WHERE skill_code='prototype:skill-library:theme-combos:tc-54'"), "draft/draft");
    assert.notEqual(secondSkillIds["prototype:skill-library:theme-combos:tc-54"], firstSkillIds["prototype:skill-library:theme-combos:tc-54"]);
    installSeed();
    const thirdSkillIds = prototypeMap("skill_id");
    assert.deepEqual(thirdSkillIds, secondSkillIds);
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND source_type='system_builtin' AND lifecycle_status='active' AND candidate_status='committed'"), "62");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND lifecycle_status='draft' AND candidate_status='draft'"), "10");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND skill_category IN ('commercial','chapter','world')"), "0");
    assert.equal(sql(`SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code='${userCode}'`), "1");
    assert.equal(sql(`SELECT candidate_status || '/' || lifecycle_status FROM public.t_repertoire_assets WHERE skill_code='${userCode}'`), "draft/inactive");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND output_structure ? 'raw_source'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND combo_synergy ? 'raw_source'"), "0");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_category <> '题材组合' AND genre_main IS NOT NULL"), "0");
    assert.equal(sql("SELECT genre_main FROM public.t_repertoire_assets WHERE skill_code='prototype:skill-library:theme-combos:tc-34'"), "玄幻");
    assert.equal(sql("SELECT genre_main FROM public.t_repertoire_assets WHERE skill_code='prototype:skill-library:theme-combos:tc-48'"), "奇幻");
    assert.equal(sql("SELECT candidate_status || '/' || lifecycle_status || '/' || genre_main FROM public.t_repertoire_assets WHERE skill_code='prototype:skill-library:theme-combos:tc-48'"), "committed/active/奇幻");
    const urbanActive = sql("SELECT string_agg(skill_code, ',' ORDER BY skill_code) FROM public.t_repertoire_assets WHERE source_type='system_builtin' AND lifecycle_status='active' AND candidate_status='committed' AND genre_main='都市'");
    assert.equal(urbanActive.includes("prototype:skill-library:theme-combos:tc-35"), true);
    assert.equal(urbanActive.includes("prototype:skill-library:theme-combos:tc-54"), false);
    assert.equal(urbanActive.includes("prototype:skill-library:theme-combos:tc-48"), false);
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND commercial_bonus IS NOT NULL"), "0");
    const dbEvidence = prototypeMap("jsonb_build_object('gate', input_requirements->>'specific_gate', 'eval', eval_criteria->>'specific_eval_check')");
    for (const row of optimized) assert.deepEqual(dbEvidence[row.skill_code], { gate: row.research.specific_gate, eval: row.research.eval_check });
    const expectedRaw = Object.fromEntries(rawRows.map(({ category, raw }) => [`prototype:skill-library:${category}:${raw.id}`, raw]));
    assert.deepEqual(prototypeMap("output_structure->'raw_source'"), expectedRaw);
  } finally {
    sql(`BEGIN; SET LOCAL zh.bypass_rpc = 'true'; DELETE FROM public.t_repertoire_assets WHERE skill_code='${userCode}'; COMMIT;`);
  }
});
