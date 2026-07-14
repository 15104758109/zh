-- Runtime installer setup. Data is loaded from optimized-skill-data.json by install-prototype-skill-library.mjs.
BEGIN;
SET LOCAL zh.bypass_rpc = 'true';
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'user_managed';
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS owner_local_operator_id text NULL;
ALTER TABLE public.t_repertoire_assets ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_lifecycle_status_check;
UPDATE public.t_repertoire_assets SET lifecycle_status = CASE lifecycle_status WHEN 'inactive' THEN 'draft' WHEN 'deprecated' THEN 'archived' ELSE lifecycle_status END WHERE source_type = 'system_builtin' AND skill_code LIKE 'prototype:skill-library:%' AND lifecycle_status IN ('inactive', 'deprecated');
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_skill_category_check, ADD CONSTRAINT t_repertoire_assets_skill_category_check CHECK (skill_category IN ('commercial', 'chapter', 'world', '题材组合', '章节展开', '艺术呈现', '镜头语言'));
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_source_type_check, ADD CONSTRAINT t_repertoire_assets_source_type_check CHECK (source_type IN ('system_builtin', 'user_managed'));
ALTER TABLE public.t_repertoire_assets ADD CONSTRAINT t_repertoire_assets_lifecycle_status_check CHECK (lifecycle_status IN ('active', 'draft', 'archived', 'inactive', 'deprecated'));
ALTER TABLE public.t_repertoire_assets DROP CONSTRAINT IF EXISTS t_repertoire_assets_system_builtin_owner_check, ADD CONSTRAINT t_repertoire_assets_system_builtin_owner_check CHECK (source_type <> 'system_builtin' OR owner_local_operator_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS t_repertoire_assets_skill_code_version_no_uidx ON public.t_repertoire_assets (skill_code, version_no);
COMMIT;
