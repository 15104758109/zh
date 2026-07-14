import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const database = process.env.ZH_SKILL_LIBRARY_DATABASE ?? "zh_narrative_test";
if (!new Set(["zh_narrative", "zh_narrative_test"]).has(database)) throw new Error("ZH_SKILL_LIBRARY_DATABASE must be zh_narrative or zh_narrative_test");
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const setup = readFileSync(path.join(directory, "install-prototype-skill-library.sql"), "utf8");
const seed = JSON.parse(readFileSync(path.join(root, "db", "seeds", "skill-library", "optimized-skill-data.json"), "utf8"));
const encoded = Buffer.from(JSON.stringify(seed), "utf8").toString("base64");
const json = `convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb`;
const sql = `${setup}
BEGIN;
SET LOCAL zh.bypass_rpc = 'true';
WITH seed AS (SELECT value AS item FROM jsonb_array_elements(${json}))
DELETE FROM public.t_repertoire_assets AS existing
USING seed
WHERE existing.source_type = 'system_builtin'
  AND existing.skill_code LIKE 'prototype:skill-library:%'
  AND existing.skill_code = seed.item->>'skill_code'
  AND (existing.candidate_status, existing.lifecycle_status) IS DISTINCT FROM (seed.item->>'candidate_status', seed.item->>'lifecycle_status');
WITH seed AS (SELECT value AS item FROM jsonb_array_elements(${json}))
DELETE FROM public.t_repertoire_assets AS existing
WHERE existing.source_type = 'system_builtin'
  AND existing.skill_code LIKE 'prototype:skill-library:%'
  AND NOT EXISTS (SELECT 1 FROM seed WHERE seed.item->>'skill_code' = existing.skill_code);
WITH seed AS (SELECT value AS item FROM jsonb_array_elements(${json}))
INSERT INTO public.t_repertoire_assets (
  skill_code, version_no, skill_name, skill_category, input_requirements, execution_steps,
  output_structure, applicable_scenes, failure_samples, rollback_strategy, eval_criteria,
  genre_main, genre_sub_tags, combo_logic, fun_source, essence, commercial_bonus, combo_synergy,
  candidate_status, source_type, owner_local_operator_id, lifecycle_status
)
SELECT
  item->>'skill_code', (item->>'version_no')::int, item->>'skill_name', item->>'skill_category',
  item->'input_requirements', item->'execution_steps',
  item->'output_structure' || jsonb_build_object('optimization_notes', item->'optimization_notes', 'quality_status', item->'quality_status', 'quality_score', item->'quality_score'),
  item->'applicable_scenes', item->'failure_samples', item->'rollback_strategy', item->'eval_criteria',
  item->>'genre_main', item->'genre_sub_tags', item->'output_structure'->'raw_source'->'logic',
  item->'output_structure'->'raw_source'->>'attraction', item->'output_structure'->'raw_source'->>'essence',
  NULL,
  jsonb_build_object('prototype_category', item->>'prototype_category', 'decision', item->>'decision', 'alias_of', item->'alias_of'),
  item->>'candidate_status', item->>'source_type', NULL, item->>'lifecycle_status'
FROM seed
ON CONFLICT (skill_code, version_no) DO UPDATE SET
  skill_name=EXCLUDED.skill_name, skill_category=EXCLUDED.skill_category,
  input_requirements=EXCLUDED.input_requirements, execution_steps=EXCLUDED.execution_steps,
  output_structure=EXCLUDED.output_structure, applicable_scenes=EXCLUDED.applicable_scenes,
  failure_samples=EXCLUDED.failure_samples, rollback_strategy=EXCLUDED.rollback_strategy,
  eval_criteria=EXCLUDED.eval_criteria, genre_main=EXCLUDED.genre_main,
  genre_sub_tags=EXCLUDED.genre_sub_tags, combo_logic=EXCLUDED.combo_logic,
  fun_source=EXCLUDED.fun_source, essence=EXCLUDED.essence, commercial_bonus=EXCLUDED.commercial_bonus,
  combo_synergy=EXCLUDED.combo_synergy, candidate_status=EXCLUDED.candidate_status,
  source_type=EXCLUDED.source_type, lifecycle_status=EXCLUDED.lifecycle_status
WHERE public.t_repertoire_assets.source_type='system_builtin';
COMMIT;
`;
execFileSync("docker", [
  "exec", "-i", process.env.ZH_SKILL_LIBRARY_POSTGRES_CONTAINER ?? "n8n-pgvector", "sh", "-lc",
  `exec psql -X -q -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d ${database} -f -`,
], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
