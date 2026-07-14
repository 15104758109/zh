CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.t_repertoire_assets (
  skill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_code text NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  skill_name text NOT NULL,
  skill_category text NOT NULL,
  skill_description text NOT NULL DEFAULT '',
  skill_config_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  applicable_scenes jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback_strategy jsonb,
  eval_criteria jsonb,
  genre_main text,
  genre_sub_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  combo_logic jsonb,
  fun_source text,
  essence text,
  candidate_status text NOT NULL DEFAULT 'draft' CHECK (candidate_status IN ('draft', 'committed')),
  source_type text NOT NULL DEFAULT 'user_managed' CHECK (source_type IN ('system_builtin', 'user_managed')),
  owner_local_operator_id text,
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft', 'active', 'archived', 'inactive', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT t_repertoire_assets_system_builtin_owner_check CHECK (source_type <> 'system_builtin' OR owner_local_operator_id IS NULL),
  CONSTRAINT t_repertoire_assets_builtin_category_check CHECK (source_type <> 'system_builtin' OR skill_category IN ('题材组合', '章节展开', '艺术呈现', '镜头语言'))
);

ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'user_managed';
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS owner_local_operator_id text;
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'draft';
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1;
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS skill_config_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS skill_description text NOT NULL DEFAULT '';
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_lifecycle_status_check;
ALTER TABLE public.t_repertoire_assets ADD CONSTRAINT t_repertoire_assets_lifecycle_status_check CHECK (lifecycle_status IN ('draft', 'active', 'archived', 'inactive', 'deprecated'));
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_source_type_check;
ALTER TABLE public.t_repertoire_assets ADD CONSTRAINT t_repertoire_assets_source_type_check CHECK (source_type IN ('system_builtin', 'user_managed'));
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_system_builtin_owner_check;
ALTER TABLE public.t_repertoire_assets ADD CONSTRAINT t_repertoire_assets_system_builtin_owner_check CHECK (source_type <> 'system_builtin' OR owner_local_operator_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS t_repertoire_assets_skill_code_version_no_uidx ON public.t_repertoire_assets (skill_code, version_no);
CREATE INDEX IF NOT EXISTS t_repertoire_assets_active_genre_idx ON public.t_repertoire_assets (source_type, lifecycle_status, candidate_status, skill_category, genre_main);

CREATE OR REPLACE FUNCTION public.runtime_seed_requirement_status(p_genre_main text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.t_repertoire_assets
    WHERE source_type = 'system_builtin' AND lifecycle_status = 'active'
      AND candidate_status = 'committed' AND skill_category = '题材组合'
      AND genre_main = p_genre_main
  ) THEN jsonb_build_object('status', 'READY', 'genre_main', p_genre_main)
  ELSE jsonb_build_object('status', 'BLOCKED', 'code', 'REQUIRED_SKILL_MISSING', 'genre_main', p_genre_main)
  END;
$$;
