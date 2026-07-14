import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../../..");
const seedFile = path.join(repositoryRoot, "db", "seeds", "skill-library", "default-skill-data.json");
const outputFile = path.join(directory, "install-prototype-skill-library.sql");
const categories = JSON.parse(readFileSync(seedFile, "utf8"));
const mapping = {
  "theme-combos": "commercial",
  "chapter-expansion": "chapter",
  "art-presentation": "world",
  "camera-language": "chapter",
};
const records = Object.entries(categories).flatMap(([prototype_category, items]) => items.map((raw) => ({
  prototype_category,
  skill_category: mapping[prototype_category],
  raw,
})));

if (records.length !== 72 || Object.keys(mapping).length !== 4) throw new Error("invalid skill-library seed");

const payload = JSON.stringify(records);
const sql = `-- Generated from db/seeds/skill-library/default-skill-data.json. Do not edit by hand.
-- Category map: theme-combos=commercial, chapter-expansion=chapter,
-- art-presentation=world, camera-language=chapter.
-- committed is intentional: these are shipped system prototypes, not user candidates.
BEGIN;
SET LOCAL zh.bypass_rpc = 'true';

ALTER TABLE public.t_repertoire_assets
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'user_managed',
  ADD COLUMN IF NOT EXISTS owner_local_operator_id text NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
ALTER TABLE public.t_repertoire_assets
  DROP CONSTRAINT IF EXISTS t_repertoire_assets_source_type_check,
  ADD CONSTRAINT t_repertoire_assets_source_type_check
    CHECK (source_type IN ('system_builtin', 'user_managed')),
  DROP CONSTRAINT IF EXISTS t_repertoire_assets_lifecycle_status_check,
  ADD CONSTRAINT t_repertoire_assets_lifecycle_status_check
    CHECK (lifecycle_status IN ('active', 'inactive', 'deprecated')),
  DROP CONSTRAINT IF EXISTS t_repertoire_assets_system_builtin_owner_check,
  ADD CONSTRAINT t_repertoire_assets_system_builtin_owner_check
    CHECK (source_type <> 'system_builtin' OR owner_local_operator_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS t_repertoire_assets_skill_code_version_no_uidx
  ON public.t_repertoire_assets (skill_code, version_no);

WITH seed AS (
  SELECT value AS item
  FROM jsonb_array_elements($skill_library_seed$${payload}$skill_library_seed$::jsonb)
)
INSERT INTO public.t_repertoire_assets (
  skill_code, version_no, skill_name, skill_category, input_requirements, execution_steps,
  output_structure, applicable_scenes, failure_samples, rollback_strategy,
  eval_criteria, genre_main, genre_sub_tags, combo_logic, fun_source, essence,
  commercial_bonus, combo_synergy, candidate_status, source_type,
  owner_local_operator_id, lifecycle_status
)
SELECT
  'prototype:skill-library:' || (item->>'prototype_category') || ':' || (item->'raw'->>'id'),
  1,
  item->'raw'->>'title',
  item->>'skill_category',
  jsonb_build_object('prototype_category', item->>'prototype_category', 'source_id', item->'raw'->>'id'),
  jsonb_build_array(jsonb_build_object('logic', item->'raw'->'logic')),
  jsonb_build_object('raw', item->'raw'),
  jsonb_build_object('tag', item->'raw'->'tag'),
  jsonb_build_object('conflict', item->'raw'->'conflict', 'taboo', item->'raw'->'taboo'),
  jsonb_build_object('source', 'prototype-skill-library-v2'),
  jsonb_build_object('rating', item->'raw'->'rating'),
  item->'raw'->>'tag',
  CASE WHEN item->'raw' ? 'subGenres' THEN jsonb_build_array(item->'raw'->>'subGenres') ELSE '[]'::jsonb END,
  item->'raw'->'logic',
  item->'raw'->>'attraction',
  item->'raw'->>'essence',
  jsonb_build_object('rating', item->'raw'->'rating'),
  jsonb_build_object('prototype_category', item->>'prototype_category', 'raw', item->'raw'),
  'committed',
  'system_builtin',
  NULL,
  'active'
FROM seed
ON CONFLICT (skill_code, version_no) DO UPDATE
SET
  skill_name = EXCLUDED.skill_name,
  skill_category = EXCLUDED.skill_category,
  input_requirements = EXCLUDED.input_requirements,
  execution_steps = EXCLUDED.execution_steps,
  output_structure = EXCLUDED.output_structure,
  applicable_scenes = EXCLUDED.applicable_scenes,
  failure_samples = EXCLUDED.failure_samples,
  rollback_strategy = EXCLUDED.rollback_strategy,
  eval_criteria = EXCLUDED.eval_criteria,
  genre_main = EXCLUDED.genre_main,
  genre_sub_tags = EXCLUDED.genre_sub_tags,
  combo_logic = EXCLUDED.combo_logic,
  fun_source = EXCLUDED.fun_source,
  essence = EXCLUDED.essence,
  commercial_bonus = EXCLUDED.commercial_bonus,
  combo_synergy = EXCLUDED.combo_synergy,
  candidate_status = EXCLUDED.candidate_status,
  source_type = EXCLUDED.source_type,
  owner_local_operator_id = EXCLUDED.owner_local_operator_id,
  lifecycle_status = EXCLUDED.lifecycle_status
WHERE public.t_repertoire_assets.source_type = 'system_builtin';

COMMIT;
`;

writeFileSync(outputFile, sql, "utf8");
