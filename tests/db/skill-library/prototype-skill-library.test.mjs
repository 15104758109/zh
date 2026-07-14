import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../../..");
const database = "zh_narrative_test";
const install = path.join(repositoryRoot, "db", "functions", "skill-library", "install-prototype-skill-library.mjs");
const seed = JSON.parse(readFileSync(path.join(repositoryRoot, "db", "seeds", "skill-library", "default-skill-data.json"), "utf8"));
const userCode = `user:test-skill-library-${process.pid}`;

function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "n8n-pgvector", "sh", "-lc",
    `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -At -f -`,
  ], { input: statement, encoding: "utf8" }).trim();
}

function installSeed() {
  execFileSync(process.execPath, [install], { cwd: repositoryRoot, encoding: "utf8" });
}

function prototypeMap(valueExpression) {
  return JSON.parse(sql(`SELECT json_object_agg(skill_code, ${valueExpression})::text FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%'`));
}

test("prototype skill-library seed is complete, idempotent, and preserves user rows", () => {
  const expected = Object.values(seed).flat();
  assert.equal(expected.length, 72);
  assert.deepEqual(Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, value.length])), {
    "theme-combos": 54, "chapter-expansion": 8, "art-presentation": 6, "camera-language": 4,
  });

  sql(`BEGIN; SET LOCAL zh.bypass_rpc = 'true'; INSERT INTO public.t_repertoire_assets (skill_code, skill_name, skill_category, candidate_status) VALUES ('${userCode}', 'user row must survive', 'commercial', 'draft'); COMMIT;`);
  try {
    installSeed();
    const firstSkillIds = prototypeMap("skill_id");
    installSeed();
    const secondSkillIds = prototypeMap("skill_id");

    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%'"), "72");
    assert.deepEqual(secondSkillIds, firstSkillIds);
    assert.equal(sql("SELECT string_agg(skill_category || ':' || count, ',' ORDER BY skill_category) FROM (SELECT skill_category, count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' GROUP BY skill_category) categories"), "chapter:12,commercial:54,world:6");
    assert.equal(sql(`SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code = '${userCode}'`), "1");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND candidate_status = 'committed'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND source_type = 'system_builtin' AND lifecycle_status = 'active' AND owner_local_operator_id IS NULL"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND output_structure->'raw' ? 'id' AND output_structure->'raw' ? 'title'"), "72");
    assert.equal(sql("SELECT count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' AND input_requirements ? 'prototype_category'"), "72");
    assert.equal(sql("SELECT string_agg(prototype_category || ':' || count, ',' ORDER BY prototype_category) FROM (SELECT combo_synergy->>'prototype_category' AS prototype_category, count(*) FROM public.t_repertoire_assets WHERE skill_code LIKE 'prototype:skill-library:%' GROUP BY 1) categories"), "art-presentation:6,camera-language:4,chapter-expansion:8,theme-combos:54");
    const expectedRaw = Object.fromEntries(Object.entries(seed).flatMap(([category, items]) => items.map((item) => [
      `prototype:skill-library:${category}:${item.id}`, item,
    ])));
    assert.deepEqual(prototypeMap("output_structure->'raw'"), expectedRaw);
  } finally {
    sql(`BEGIN; SET LOCAL zh.bypass_rpc = 'true'; DELETE FROM public.t_repertoire_assets WHERE skill_code = '${userCode}'; COMMIT;`);
  }
});
