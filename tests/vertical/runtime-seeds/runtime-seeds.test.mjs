import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const installer = path.join(root, "db/functions/runtime-seeds/install-runtime-seeds.mjs");
function sql(statement) { return execFileSync("docker", ["exec", "-i", "n8n-pgvector", "sh", "-lc", "exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d zh_narrative_test -At -f -"], { input: `BEGIN; SET LOCAL zh.bypass_rpc = 'true'; ${statement}; COMMIT;`, encoding: "utf8" }).trim(); }
function prototype() { const source = readFileSync(path.join(root, "docs/前端原型_v2/pages/skill_library.html"), "utf8").replaceAll("\r\n", "\n"); const start = source.indexOf("const defaultSkillData ="); const end = source.indexOf("\n    };\n\n    let activeCategory", start); const context = {}; vm.runInNewContext(`${source.slice(start, end + 7).replace("const defaultSkillData =", "defaultSkillData =")};`, context); return context.defaultSkillData; }
function install() { execFileSync(process.execPath, [installer], { cwd: root, encoding: "utf8" }); }

test("runtime seed install preserves all prototype identities, is idempotent, and fails closed", () => {
  const raw = prototype();
  assert.deepEqual(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.length])), { "theme-combos": 54, "chapter-expansion": 8, "art-presentation": 6, "camera-language": 4 });
  assert.equal(Object.values(raw).flat().length, 72);
  sql("DROP TABLE IF EXISTS public.t_repertoire_assets CASCADE;");
  install();
  const userCode = `runtime-seeds-user-${process.pid}`;
  sql(`INSERT INTO public.t_repertoire_assets (skill_code, skill_name, skill_category, candidate_status, source_type, lifecycle_status) VALUES ('${userCode}', 'user survives', '题材组合', 'draft', 'user_managed', 'draft');`);
  sql("INSERT INTO public.t_repertoire_assets (skill_code, skill_name, skill_category, candidate_status, source_type, lifecycle_status) VALUES ('prototype:skill-library:theme-combos:legacy', 'replaced builtin', '题材组合', 'committed', 'system_builtin', 'active'), ('prototype:skill-library:user:legacy', 'user legacy survives', '题材组合', 'draft', 'user_managed', 'draft');");
  try {
    install();
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'runtime-seeds:skill-library:%'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE source_type='system_builtin' AND skill_code LIKE '%skill-library:%'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code='prototype:skill-library:theme-combos:legacy'"), "0");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code='prototype:skill-library:user:legacy' AND source_type='user_managed'"), "1");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'runtime-seeds:skill-library:%' AND source_type='system_builtin' AND lifecycle_status='active' AND candidate_status='committed'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_config_jsonb #>> '{research,decision}'='ACTIVE_OPTIMIZED'"), "24");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_config_jsonb #>> '{research,decision}'='ACTIVE_CONSTRAINED'"), "48");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'runtime-seeds:skill-library:chapter-expansion:%' AND lifecycle_status='active'"), "8");
    assert.equal(sql(`SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code='${userCode}'`), "1");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'runtime-seeds:skill-library:%' AND COALESCE(skill_config_jsonb #>> '{research,reason}', '') <> ''"), "72");
    assert.equal(sql("SELECT skill_config_jsonb #>> '{research,decision}' FROM public.t_repertoire_assets WHERE skill_code='runtime-seeds:skill-library:chapter-expansion:ce-6'"), "ACTIVE_CONSTRAINED");
    assert.equal(sql("SELECT skill_config_jsonb #>> '{research,decision}' FROM public.t_repertoire_assets WHERE skill_code='runtime-seeds:skill-library:theme-combos:tc-35'"), "ACTIVE_CONSTRAINED");
    assert.equal(sql("SELECT skill_config_jsonb #>> '{research,decision}' FROM public.t_repertoire_assets WHERE skill_code='runtime-seeds:skill-library:theme-combos:tc-54'"), "ACTIVE_CONSTRAINED");
    for (const id of ["tc-50", "tc-6", "tc-43", "tc-45", "tc-46", "tc-51", "tc-54", "tc-22", "tc-25", "ce-6"]) assert.ok(sql(`SELECT skill_config_jsonb #>> '{research,reason}' FROM public.t_repertoire_assets WHERE skill_code LIKE '%:${id}'`).length > 40, id);
    for (const [category, rows] of Object.entries(raw)) for (const item of rows) {
      const stored = JSON.parse(sql(`SELECT output_structure->'raw_source' FROM public.t_repertoire_assets WHERE skill_code='runtime-seeds:skill-library:${category}:${item.id}'`));
      assert.deepEqual(stored, JSON.parse(JSON.stringify(item)));
    }
    for (const genre of ["奇幻", "玄幻", "科幻", "都市", "军事", "仙侠"]) assert.equal(sql(`SELECT public.runtime_seed_requirement_status('${genre}')->>'status'`), "READY");
    assert.equal(sql("SELECT (public.runtime_seed_requirement_status('不存在')->>'status') || '/' || (public.runtime_seed_requirement_status('不存在')->>'code')"), "BLOCKED/REQUIRED_SKILL_MISSING");
  } finally { sql(`DELETE FROM public.t_repertoire_assets WHERE skill_code IN ('${userCode}', 'prototype:skill-library:user:legacy');`); }
});
