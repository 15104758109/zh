\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $cleanup$
DECLARE
  v_record record;
BEGIN
  FOR v_record IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND (
        c.relname LIKE 't\_%' ESCAPE '\'
        OR c.relname LIKE 'tc\_%' ESCAPE '\'
        OR c.relname LIKE 'ts\_%' ESCAPE '\'
        OR c.relname LIKE 'v\_%' ESCAPE '\'
        OR c.relname IN (
          '_migrations', '_seed_log', 'api_cp', 'character_memory', 'world_state',
          'local_operator', 'book_project', 'world_version', 'world_binding',
          'character_version', 'character', 'relation_state', 'l1a_unit',
          'chapter', 'world_knowledge_entry', 'audit_attempt_log', 'editor_log', 'iteration_log',
          'prompt_config', 'prompt_iteration_log', 'skill', 'book_skill_preference',
          'model_sync_config', 'model_runtime_binding',
          'narrative_asset', 'writeback_log', 'character_writeback_log',
          'relation_state_log', 'vector_index_log', 'retrieval_snapshot',
          'product_request_log', 'v7_install_metadata'
        )
      )
  LOOP
    EXECUTE format(
      'DROP %s IF EXISTS %I.%I CASCADE',
      CASE v_record.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE'
        ELSE 'TABLE'
      END,
      v_record.nspname,
      v_record.relname
    );
  END LOOP;

  FOR v_record IN
    SELECT p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'rpc\_%' ESCAPE '\' OR p.proname LIKE 'v7\_%' ESCAPE '\')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', v_record.nspname, v_record.proname, v_record.args);
  END LOOP;
END;
$cleanup$;

CREATE TABLE public.v7_install_metadata (
  install_key text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  description text NOT NULL
);

CREATE TABLE public.local_operator (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  local_operator_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.book_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  title text NOT NULL,
  normalized_title text NOT NULL,
  intent_json jsonb NOT NULL,
  forbid_json jsonb NOT NULL,
  selling_points_json jsonb,
  stage_code text NOT NULL DEFAULT 'design' CHECK (stage_code IN ('design', 'production', 'audit', 'iteration')),
  run_status text NOT NULL DEFAULT 'idle',
  current_l1a_id uuid,
  active_l1a_json jsonb,
  total_chapters integer NOT NULL DEFAULT 0 CHECK (total_chapters >= 0),
  presentation_intensity numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (presentation_intensity BETWEEN 0 AND 1),
  auto_production boolean NOT NULL DEFAULT false,
  auto_audit boolean NOT NULL DEFAULT false,
  auto_iteration boolean NOT NULL DEFAULT false,
  config_revision text NOT NULL DEFAULT 'v1',
  target_words integer CHECK (target_words > 0),
  chapter_words integer CHECK (chapter_words > 0),
  commercial_score integer CHECK (commercial_score BETWEEN 0 AND 10),
  active_chapter_json jsonb,
  cover_url text,
  design_frozen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (local_operator_id, normalized_title),
  UNIQUE (id, local_operator_id)
);

CREATE TABLE public.product_request_log (
  operation text NOT NULL CHECK (operation IN (
    'create_book', 'world_confirm', 'character_confirm', 'l1a_generate',
    'l1a_finalize', 'audit_confirm', 'prompt_promote', 'skill_manage'
  )),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  local_operator_id uuid NOT NULL,
  book_id uuid,
  intent jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation, local_operator_id, idempotency_key)
);

CREATE TABLE public.world_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  local_operator_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  state text NOT NULL CHECK (state IN ('candidate', 'formal', 'returned')),
  parent_version_id uuid REFERENCES public.world_version(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  FOREIGN KEY (book_id, local_operator_id) REFERENCES public.book_project(id, local_operator_id),
  UNIQUE (book_id, version_no)
);

CREATE TABLE public.l1a_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  l1a_index integer NOT NULL CHECK (l1a_index > 0),
  l1a_name text NOT NULL,
  conflict_background text NOT NULL,
  escalation_path text NOT NULL,
  stakes text NOT NULL,
  irreversible_consequence text NOT NULL,
  plot_emotion_commit jsonb NOT NULL,
  arc_requirement jsonb NOT NULL,
  info_reveal_boundary jsonb NOT NULL,
  role_arc_json jsonb NOT NULL,
  chapter_nos_json jsonb,
  status text NOT NULL CHECK (status IN ('candidate', 'sorted', 'finalized')),
  source_type text NOT NULL CHECK (source_type IN ('initial', 'traversal', 'manual')),
  confirmation_status text NOT NULL CHECK (confirmation_status IN ('unconfirmed', 'creator_confirmed', 'returned')),
  is_shadow boolean NOT NULL DEFAULT false,
  is_formal boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  is_patch boolean NOT NULL DEFAULT false,
  need_regen boolean NOT NULL DEFAULT false,
  core_conflict_flag boolean NOT NULL DEFAULT false,
  mid_goals jsonb,
  world_progress_json jsonb,
  narrative_techniques jsonb,
  future_value_reserved jsonb,
  future_setting_seeds jsonb,
  world_resistance_refs jsonb,
  jinzhan jsonb,
  payoff jsonb,
  emotion_type text,
  has_explicit_hook boolean NOT NULL DEFAULT false,
  consequences text,
  escalation text,
  related_hook jsonb,
  role_arcs jsonb NOT NULL,
  participant_chars_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (book_id, l1a_index)
);

ALTER TABLE public.book_project
  ADD CONSTRAINT book_project_current_l1a_fk FOREIGN KEY (current_l1a_id) REFERENCES public.l1a_unit(id);

CREATE TABLE public.world_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_version_id uuid NOT NULL REFERENCES public.world_version(id),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  board_type text NOT NULL CHECK (board_type IN ('rule', 'geography', 'resource', 'faction', 'profession', 'monster', 'chronicle')),
  atom_type text NOT NULL CHECK (atom_type IN ('rule', 'fact', 'resource', 'event', 'faction', 'job', 'monster', 'geo')),
  atom_key text NOT NULL,
  atom_value_jsonb jsonb NOT NULL,
  affordance_dims jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affordance_dims) = 'array'),
  source_type text NOT NULL CHECK (source_type IN ('manual', 'ai_generated', 'imported')),
  setting_layer text NOT NULL CHECK (setting_layer IN ('initial', 'l1a_generated', 'editor_patch')),
  origin_l1a_id uuid REFERENCES public.l1a_unit(id),
  is_active boolean NOT NULL DEFAULT false,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  knowledge_boundary_json jsonb,
  apply_scope_json jsonb,
  violate_cost_json jsonb,
  chain_change_json jsonb,
  reverse_dep_index jsonb,
  reveal_order integer,
  l1a_change_log_json jsonb,
  gen_l1a_json jsonb,
  conflict_with_initial jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (world_version_id, atom_key),
  CHECK (atom_type <> 'fact' OR knowledge_boundary_json IS NOT NULL),
  CHECK (setting_layer <> 'l1a_generated' OR origin_l1a_id IS NOT NULL)
);

CREATE TABLE public.world_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_version_id uuid NOT NULL REFERENCES public.world_version(id),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  from_ref_type text NOT NULL CHECK (from_ref_type IN ('world', 'character')),
  from_ref_id text NOT NULL,
  to_ref_type text NOT NULL CHECK (to_ref_type IN ('world', 'character')),
  to_ref_id text NOT NULL,
  binding_type text NOT NULL,
  binding_strength text NOT NULL DEFAULT '中' CHECK (binding_strength IN ('强', '中', '弱')),
  setting_layer text NOT NULL CHECK (setting_layer IN ('initial', 'l1a_generated', 'editor_patch')),
  origin_l1a_id uuid REFERENCES public.l1a_unit(id),
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (world_version_id, from_ref_type, from_ref_id, to_ref_type, to_ref_id, binding_type)
);

CREATE TABLE public.character_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  local_operator_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  state text NOT NULL CHECK (state IN ('candidate', 'formal', 'returned')),
  parent_version_id uuid REFERENCES public.character_version(id),
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  FOREIGN KEY (book_id, local_operator_id) REFERENCES public.book_project(id, local_operator_id),
  UNIQUE (book_id, version_no)
);

CREATE TABLE public.character (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_version_id uuid NOT NULL REFERENCES public.character_version(id),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  char_name text NOT NULL,
  five_layers_json jsonb NOT NULL CHECK (five_layers_json ?& ARRAY['L0','L1','L2','L3']),
  knowledge_boundary_json jsonb NOT NULL CHECK (knowledge_boundary_json ?& ARRAY['knows','unknown','false_belief','reasonable_suspect']),
  arc_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive', 'candidate')),
  is_active boolean NOT NULL DEFAULT true,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  char_type text CHECK (char_type IN ('protagonist', 'supporting', 'ensemble', 'antagonist')),
  char_code text,
  gender text,
  current_goal_txt text,
  current_emo_tag text,
  cheat_hot_json jsonb,
  conflict_seed_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (character_version_id, char_code)
);

CREATE TABLE public.relation_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_version_id uuid NOT NULL REFERENCES public.character_version(id),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  char_a_id uuid NOT NULL REFERENCES public.character(id),
  char_b_id uuid NOT NULL REFERENCES public.character(id),
  trust integer NOT NULL DEFAULT 0 CHECK (trust BETWEEN -100 AND 100),
  intimacy integer NOT NULL DEFAULT 0 CHECK (intimacy BETWEEN -100 AND 100),
  power_balance integer NOT NULL DEFAULT 0 CHECK (power_balance BETWEEN -100 AND 100),
  dependence integer NOT NULL DEFAULT 0 CHECK (dependence BETWEEN -100 AND 100),
  hostility integer NOT NULL DEFAULT 0 CHECK (hostility BETWEEN 0 AND 100),
  common_goal integer NOT NULL DEFAULT 0 CHECK (common_goal BETWEEN 0 AND 100),
  secret_known integer NOT NULL DEFAULT 0 CHECK (secret_known BETWEEN 0 AND 100),
  emotional_bond integer NOT NULL DEFAULT 0 CHECK (emotional_bond BETWEEN -100 AND 100),
  relation_type text NOT NULL,
  relation_hierarchy text NOT NULL,
  relation_origin text,
  relation_overview text,
  change_event_json jsonb NOT NULL,
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  support_level integer CHECK (support_level BETWEEN 0 AND 10),
  source_chapter_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (char_a_id <> char_b_id),
  UNIQUE (character_version_id, char_a_id, char_b_id)
);

CREATE TABLE public.character_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  char_id uuid NOT NULL REFERENCES public.character(id),
  character_version_id uuid REFERENCES public.character_version(id),
  chapter_id uuid,
  memory_type text NOT NULL CHECK (memory_type IN ('event', 'emotion', 'knowledge', 'relationship')),
  memory_content text NOT NULL,
  truth_status text NOT NULL CHECK (truth_status IN ('true', 'misremembered', 'false')),
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  vector_indexed boolean NOT NULL DEFAULT false,
  importance numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (importance BETWEEN 0 AND 1),
  decay_rate numeric(3,2) NOT NULL DEFAULT 0.10 CHECK (decay_rate BETWEEN 0 AND 1),
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.world_knowledge_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  world_id uuid NOT NULL REFERENCES public.world_state(id),
  character_id uuid NOT NULL REFERENCES public.character(id),
  knows boolean NOT NULL DEFAULT false,
  is_unknown boolean NOT NULL DEFAULT true,
  false_belief boolean NOT NULL DEFAULT false,
  reasonable_suspect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (world_id, character_id)
);

CREATE TABLE public.chapter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  l1a_unit_id uuid NOT NULL REFERENCES public.l1a_unit(id),
  chapter_index integer NOT NULL CHECK (chapter_index > 0),
  title text,
  target_snapshot_json jsonb,
  chapter_implementation_json jsonb,
  candidate_plot_sim_json jsonb,
  formal_plot_sim_json jsonb,
  deduction_progress_json jsonb,
  deduction_locked boolean NOT NULL DEFAULT false,
  candidate_text text,
  candidate_version_no integer NOT NULL DEFAULT 0,
  formal_text text,
  formal_summary text,
  word_count integer NOT NULL DEFAULT 0,
  exception_summary_jsonb jsonb,
  status text NOT NULL CHECK (status IN ('draft', 'in_progress', 'auditing', 'confirmed', 'rolled_back')),
  is_shadow boolean NOT NULL DEFAULT false,
  is_formal boolean NOT NULL DEFAULT false,
  is_finalized boolean NOT NULL DEFAULT false,
  confirmation_status text NOT NULL CHECK (confirmation_status IN ('unconfirmed', 'creator_confirmed', 'returned')),
  sublimation_type text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (book_id, chapter_index)
);

ALTER TABLE public.relation_state
  ADD CONSTRAINT relation_state_source_chapter_fk FOREIGN KEY (source_chapter_id) REFERENCES public.chapter(id);
ALTER TABLE public.character_memory
  ADD CONSTRAINT character_memory_chapter_fk FOREIGN KEY (chapter_id) REFERENCES public.chapter(id);

CREATE TABLE public.audit_attempt_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid NOT NULL REFERENCES public.chapter(id),
  audit_type text NOT NULL,
  candidate_version_no integer NOT NULL,
  candidate_text_snapshot text NOT NULL,
  has_p0_blocker boolean NOT NULL DEFAULT true,
  p0_items_json jsonb,
  audit_findings_jsonb jsonb NOT NULL,
  return_route_suggestion_jsonb jsonb,
  frozen_deduction_result_jsonb jsonb NOT NULL,
  audit_status text NOT NULL CHECK (audit_status IN ('pending', 'running', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT has_p0_blocker OR p0_items_json IS NOT NULL)
);

CREATE TABLE public.narrative_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  linked_chapter_id uuid REFERENCES public.chapter(id),
  asset_type text NOT NULL CHECK (asset_type IN ('hook', 'foreshadow', 'critical_event', 'foreshadow_fulfillment', 'echo')),
  asset_name text NOT NULL,
  asset_description text NOT NULL,
  hook_category text CHECK (hook_category IN ('short', 'medium', 'long', 'wild')),
  countdown_deadline integer,
  fulfillment_window text,
  status text NOT NULL CHECK (status IN ('planted', 'pending', 'fulfilled', 'abandoned')),
  is_formal boolean NOT NULL DEFAULT false,
  is_shadow boolean NOT NULL DEFAULT false,
  is_valid boolean NOT NULL DEFAULT true,
  evidence_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.editor_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid NOT NULL REFERENCES public.chapter(id),
  phase text NOT NULL CHECK (phase IN ('draft', 'commercial', 'reader', 'editorial', 'revision', 'sublimation')),
  decision_json jsonb,
  score_json jsonb,
  exemption_reason_json jsonb,
  creator_confirmed boolean NOT NULL DEFAULT false,
  confirmation_deadline timestamptz,
  fix_instruction_json jsonb,
  review_comment text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.writeback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid REFERENCES public.chapter(id),
  transaction_id uuid NOT NULL,
  writeback_scope_jsonb jsonb NOT NULL,
  world_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  char_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  relation_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_diff_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'rolled_back')),
  rollback_reason text,
  source_version_no text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.character_writeback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid REFERENCES public.chapter(id),
  char_id uuid NOT NULL REFERENCES public.character(id),
  change_type text NOT NULL,
  change_layer integer NOT NULL CHECK (change_layer BETWEEN 0 AND 3),
  old_values_jsonb jsonb NOT NULL,
  new_values_jsonb jsonb NOT NULL,
  writeback_log_id uuid NOT NULL REFERENCES public.writeback_log(id),
  is_valid boolean NOT NULL DEFAULT true,
  change_reason text,
  change_amplitude numeric(3,2) CHECK (change_amplitude BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.relation_state_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  chapter_id uuid REFERENCES public.chapter(id),
  relation_state_id uuid NOT NULL REFERENCES public.relation_state(id),
  change_event_jsonb jsonb NOT NULL,
  before_snapshot_jsonb jsonb NOT NULL,
  after_snapshot_jsonb jsonb,
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.iteration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid REFERENCES public.book_project(id),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  source_fp text NOT NULL,
  iter_type text NOT NULL CHECK (iter_type IN ('prompt', 'skill', 'data')),
  review_status text NOT NULL CHECK (review_status IN ('pool', 'pending_review', 'confirmed', 'returned', 'deferred', 'discarded')),
  exec_result text NOT NULL CHECK (exec_result IN ('not_executed', 'success', 'failed')),
  root_debt_type text CHECK (root_debt_type IN ('prompt', 'skill', 'data')),
  attribution_evidence_json jsonb,
  snapshot_jsonb jsonb NOT NULL,
  before_metric_json jsonb,
  after_metric_json jsonb,
  before_prompt text,
  after_prompt text,
  confirmed_at timestamptz,
  is_valid boolean NOT NULL DEFAULT true,
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.prompt_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  book_id uuid REFERENCES public.book_project(id),
  fp_target text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  prompt_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate', 'active', 'archived')),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (local_operator_id, book_id, fp_target, version)
);

CREATE UNIQUE INDEX prompt_config_one_active_uq
  ON public.prompt_config (local_operator_id, COALESCE(book_id, '00000000-0000-0000-0000-000000000000'::uuid), fp_target)
  WHERE is_active;

CREATE TABLE public.prompt_iteration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_config_id uuid NOT NULL REFERENCES public.prompt_config(id),
  change_type text NOT NULL,
  old_prompt_text text,
  new_prompt_text text NOT NULL,
  changed_by uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.model_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  book_id uuid REFERENCES public.book_project(id),
  version integer NOT NULL CHECK (version > 0),
  model_name text NOT NULL,
  template_type text NOT NULL CHECK (template_type IN ('感性文字', '简单逻辑', '重复指令', '复杂任务', '客观公正')),
  provider_base_url text,
  api_key_ref text,
  routing_config_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  parameters_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  UNIQUE (local_operator_id, book_id, template_type, version)
);

CREATE UNIQUE INDEX model_sync_config_one_active_uq
  ON public.model_sync_config (local_operator_id, COALESCE(book_id, '00000000-0000-0000-0000-000000000000'::uuid), template_type)
  WHERE is_active;

CREATE TABLE public.model_runtime_binding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  book_id uuid REFERENCES public.book_project(id),
  node_code text NOT NULL,
  model_config_id uuid NOT NULL REFERENCES public.model_sync_config(id),
  model_config_version integer NOT NULL,
  prompt_config_id uuid REFERENCES public.prompt_config(id),
  prompt_version integer,
  template_type text NOT NULL CHECK (template_type IN ('感性文字', '简单逻辑', '重复指令', '复杂任务', '客观公正')),
  temperature numeric(3,2) CHECK (temperature BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (local_operator_id, book_id, node_code)
);

CREATE TABLE public.skill (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL,
  stable_slug text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  source_type text NOT NULL CHECK (source_type IN ('system_builtin', 'user_managed')),
  owner_local_operator_id uuid REFERENCES public.local_operator(local_operator_id),
  source_locator text NOT NULL,
  source_sha256 text NOT NULL,
  skill_name text NOT NULL,
  skill_category text NOT NULL CHECK (skill_category IN ('题材组合', '章节展开', '艺术呈现', '镜头语言')),
  skill_description text NOT NULL,
  applicable_stages jsonb NOT NULL,
  applicable_scopes jsonb NOT NULL,
  constraint_fields jsonb NOT NULL,
  template_fields jsonb NOT NULL,
  skill_config_jsonb jsonb NOT NULL,
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (skill_id, version),
  UNIQUE (stable_slug, version),
  CHECK ((source_type = 'system_builtin' AND owner_local_operator_id IS NULL) OR (source_type = 'user_managed' AND owner_local_operator_id IS NOT NULL))
);

CREATE TABLE public.book_skill_preference (
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  skill_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  updated_by uuid NOT NULL REFERENCES public.local_operator(local_operator_id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, skill_id)
);

CREATE TABLE public.vector_index_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.book_project(id),
  source_table text NOT NULL CHECK (source_table IN ('character_memory', 'relation_state_log', 'iteration_log', 'skill')),
  source_id uuid NOT NULL,
  vector_namespace text NOT NULL CHECK (vector_namespace IN ('memory', 'relation', 'governance', 'trope')),
  is_valid boolean NOT NULL DEFAULT true,
  is_shadow boolean NOT NULL DEFAULT false,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.retrieval_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_code text NOT NULL,
  chapter_id uuid NOT NULL REFERENCES public.chapter(id),
  query_text text NOT NULL,
  retrieved_chunks_json jsonb NOT NULL,
  validated_chunks_json jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX world_state_live_idx ON public.world_state (book_id, setting_layer, atom_key) WHERE is_active AND is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX world_binding_live_idx ON public.world_binding (book_id, from_ref_type, from_ref_id) WHERE is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX character_live_idx ON public.character (book_id, char_code) WHERE is_active AND is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX relation_state_live_idx ON public.relation_state (book_id, char_a_id, char_b_id) WHERE is_formal AND is_valid AND NOT is_shadow;
CREATE INDEX character_memory_live_idx ON public.character_memory (book_id, char_id) WHERE is_valid AND NOT is_shadow;
CREATE INDEX skill_active_idx ON public.skill (source_type, skill_category, lifecycle_status, stable_slug);

CREATE FUNCTION public.v7_error(p_correlation text, p_code text, p_message text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'ok', false,
    'correlation_id', COALESCE(NULLIF(p_correlation, ''), 'unavailable'),
    'redacted_error', jsonb_build_object('code', p_code, 'message', p_message)
  )
$$;

CREATE FUNCTION public.v7_normalize_title(p_title text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(trim(COALESCE(p_title, '')), '\s+', ' ', 'g'))
$$;

CREATE FUNCTION public.v7_assert_operator(p_operator uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.local_operator WHERE local_operator_id = p_operator)
$$;

CREATE FUNCTION public.v7_assert_book(p_operator uuid, p_book uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.book_project WHERE id = p_book AND local_operator_id = p_operator)
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_local_operator(p_request jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT local_operator_id INTO v_id FROM public.local_operator WHERE singleton_key;
  IF v_id IS NULL THEN
    INSERT INTO public.local_operator(singleton_key, local_operator_id) VALUES (true, gen_random_uuid())
    ON CONFLICT (singleton_key) DO NOTHING;
    SELECT local_operator_id INTO v_id FROM public.local_operator WHERE singleton_key;
  END IF;
  RETURN jsonb_build_object('ok', true, 'result', jsonb_build_object('local_operator_id', v_id, 'scope', 'local_single_operator'));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_create_book_project(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_operator uuid; v_book uuid := gen_random_uuid(); v_corr text := p_data->>'correlation_id';
  v_key text := p_data->>'idempotency_key'; v_intent jsonb := p_data - 'correlation_id';
  v_existing public.product_request_log%ROWTYPE; v_world_version uuid; v_char_version uuid;
  v_item jsonb; v_char_map jsonb := '{}'::jsonb; v_world_map jsonb := '{}'::jsonb; v_char uuid;
  v_result jsonb; v_tx uuid := gen_random_uuid(); v_title text;
BEGIN
  BEGIN v_operator := (p_data->>'local_operator_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  v_title := NULLIF(trim(p_data->>'title'), '');
  IF NOT public.v7_assert_operator(v_operator) OR v_title IS NULL OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
     OR jsonb_typeof(p_data->'intent_json') <> 'object' OR jsonb_typeof(p_data->'forbid_json') <> 'object'
     OR jsonb_typeof(p_data->'characters') <> 'array' OR jsonb_array_length(p_data->'characters') = 0
     OR jsonb_typeof(p_data->'relations') <> 'array' OR jsonb_typeof(p_data->'world_atoms') <> 'array'
     OR jsonb_array_length(p_data->'world_atoms') = 0 OR jsonb_typeof(p_data->'world_bindings') <> 'array'
     OR jsonb_typeof(p_data->'initial_l1a') <> 'array' OR jsonb_array_length(p_data->'initial_l1a') = 0 THEN
    RETURN public.v7_error(v_corr,'INVALID_REQUEST','The complete book package is required.');
  END IF;
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='create_book' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for a different request.'); END IF;
    RETURN v_existing.result || jsonb_build_object('correlation_id',v_corr,'idempotent',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.book_project WHERE local_operator_id=v_operator AND normalized_title=public.v7_normalize_title(v_title)) THEN
    RETURN public.v7_error(v_corr,'DUPLICATE_TITLE','A book with this title already exists.');
  END IF;
  INSERT INTO public.book_project(id,local_operator_id,title,normalized_title,intent_json,forbid_json,selling_points_json,target_words,chapter_words,commercial_score)
  VALUES(v_book,v_operator,v_title,public.v7_normalize_title(v_title),p_data->'intent_json',p_data->'forbid_json',p_data->'selling_points_json',NULLIF(p_data->>'target_words','')::integer,NULLIF(p_data->>'chapter_words','')::integer,NULLIF(p_data->>'commercial_score','')::integer);
  INSERT INTO public.world_version(book_id,local_operator_id,version_no,state,confirmed_at) VALUES(v_book,v_operator,1,'formal',clock_timestamp()) RETURNING id INTO v_world_version;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'world_atoms') LOOP
    IF NULLIF(v_item->>'client_ref','') IS NULL OR NULLIF(v_item->>'atom_key','') IS NULL
       OR v_item->>'board_type' NOT IN ('rule','geography','resource','faction','profession','monster','chronicle')
       OR v_item->>'atom_type' NOT IN ('rule','fact','resource','event','faction','job','monster','geo')
       OR jsonb_typeof(v_item->'atom_value_jsonb') <> 'object' OR jsonb_typeof(v_item->'affordance_dims') <> 'array'
       OR jsonb_array_length(v_item->'affordance_dims') = 0 OR (v_item->>'atom_type'='fact' AND jsonb_typeof(v_item->'knowledge_boundary_json') <> 'object') THEN
      RAISE EXCEPTION USING ERRCODE='22023';
    END IF;
    INSERT INTO public.world_state(world_version_id,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,is_active,is_formal,knowledge_boundary_json,apply_scope_json,violate_cost_json)
    VALUES(v_world_version,v_book,v_item->>'board_type',v_item->>'atom_type',v_item->>'atom_key',v_item->'atom_value_jsonb',v_item->'affordance_dims',COALESCE(v_item->>'source_type','manual'),'initial',true,true,v_item->'knowledge_boundary_json',v_item->'apply_scope_json',v_item->'violate_cost_json');
    v_world_map := v_world_map || jsonb_build_object(v_item->>'client_ref',v_item->>'atom_key');
  END LOOP;
  INSERT INTO public.character_version(book_id,local_operator_id,version_no,state,snapshot_json,confirmed_at)
  VALUES(v_book,v_operator,1,'formal',jsonb_build_object('characters',p_data->'characters','relations',p_data->'relations','initial_memories',COALESCE(p_data->'initial_memories','[]'::jsonb)),clock_timestamp()) RETURNING id INTO v_char_version;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'characters') LOOP
    IF NULLIF(v_item->>'client_ref','') IS NULL OR NULLIF(v_item->>'char_name','') IS NULL
       OR jsonb_typeof(v_item->'five_layers_json') <> 'object' OR NOT (v_item->'five_layers_json' ?& ARRAY['L0','L1','L2','L3'])
       OR jsonb_typeof(v_item->'knowledge_boundary_json') <> 'object' OR NOT (v_item->'knowledge_boundary_json' ?& ARRAY['knows','unknown','false_belief','reasonable_suspect']) THEN
      RAISE EXCEPTION USING ERRCODE='22023';
    END IF;
    INSERT INTO public.character(character_version_id,book_id,char_name,five_layers_json,knowledge_boundary_json,arc_json,status,is_formal,char_type,char_code,gender,conflict_seed_json)
    VALUES(v_char_version,v_book,v_item->>'char_name',v_item->'five_layers_json',v_item->'knowledge_boundary_json',COALESCE(v_item->'arc_json','{}'::jsonb),'active',true,COALESCE(v_item->>'char_type','ensemble'),v_item->>'client_ref',v_item->>'gender',v_item->'conflict_seed_json') RETURNING id INTO v_char;
    v_char_map := v_char_map || jsonb_build_object(v_item->>'client_ref',v_char::text);
  END LOOP;
  INSERT INTO public.world_knowledge_entry(book_id,world_id,character_id,knows,is_unknown,false_belief,reasonable_suspect)
  SELECT v_book,ws.id,c.id,
    COALESCE((c.knowledge_boundary_json->'knows') ? ws.atom_key,false),
    NOT (COALESCE((c.knowledge_boundary_json->'knows') ? ws.atom_key,false)
      OR COALESCE((c.knowledge_boundary_json->'false_belief') ? ws.atom_key,false)
      OR COALESCE((c.knowledge_boundary_json->'reasonable_suspect') ? ws.atom_key,false)),
    COALESCE((c.knowledge_boundary_json->'false_belief') ? ws.atom_key,false),
    COALESCE((c.knowledge_boundary_json->'reasonable_suspect') ? ws.atom_key,false)
  FROM public.world_state ws CROSS JOIN public.character c
  WHERE ws.world_version_id=v_world_version AND ws.atom_type='fact' AND c.character_version_id=v_char_version;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'relations') LOOP
    IF NOT (v_char_map ? (v_item->>'from_ref')) OR NOT (v_char_map ? (v_item->>'to_ref')) OR NULLIF(v_item->>'change_event','') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.relation_state(character_version_id,book_id,char_a_id,char_b_id,trust,intimacy,power_balance,dependence,hostility,common_goal,secret_known,emotional_bond,relation_type,relation_hierarchy,relation_origin,change_event_json,is_formal)
    VALUES(v_char_version,v_book,(v_char_map->>(v_item->>'from_ref'))::uuid,(v_char_map->>(v_item->>'to_ref'))::uuid,COALESCE((v_item->>'trust')::integer,0),COALESCE((v_item->>'intimacy')::integer,0),COALESCE((v_item->>'power_balance')::integer,0),COALESCE((v_item->>'dependence')::integer,0),COALESCE((v_item->>'hostility')::integer,0),COALESCE((v_item->>'common_goal')::integer,0),COALESCE((v_item->>'secret_known')::integer,0),COALESCE((v_item->>'emotional_bond')::integer,0),v_item->>'relation_type',v_item->>'relation_hierarchy',v_item->>'relation_origin',jsonb_build_object('event',v_item->>'change_event'),true);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_data->'initial_memories','[]'::jsonb)) LOOP
    IF NOT (v_char_map ? (v_item->>'char_ref')) OR NULLIF(v_item->>'memory_content','') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.character_memory(book_id,char_id,character_version_id,memory_type,memory_content,truth_status,importance,decay_rate)
    VALUES(v_book,(v_char_map->>(v_item->>'char_ref'))::uuid,v_char_version,COALESCE(v_item->>'memory_type','knowledge'),v_item->>'memory_content',COALESCE(v_item->>'truth_status','true'),COALESCE((v_item->>'importance')::numeric,0.5),COALESCE((v_item->>'decay_rate')::numeric,0.1));
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'world_bindings') LOOP
    IF NOT (v_world_map ? (v_item->>'from_ref')) OR NOT (v_world_map ? (v_item->>'to_ref'))
       OR v_item->>'binding_strength' NOT IN ('强','中','弱') OR NULLIF(v_item->>'binding_type','') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.world_binding(world_version_id,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer,is_formal)
    VALUES(v_world_version,v_book,'world',v_world_map->>(v_item->>'from_ref'),'world',v_world_map->>(v_item->>'to_ref'),v_item->>'binding_type',v_item->>'binding_strength','initial',true);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'initial_l1a') LOOP
    INSERT INTO public.l1a_unit(book_id,l1a_index,l1a_name,conflict_background,escalation_path,stakes,irreversible_consequence,plot_emotion_commit,arc_requirement,info_reveal_boundary,role_arc_json,status,source_type,confirmation_status,core_conflict_flag,role_arcs)
    VALUES(v_book,(v_item->>'l1a_index')::integer,v_item->>'l1a_name',v_item->>'conflict_background',v_item->>'escalation_path',v_item->>'stakes',v_item->>'irreversible_consequence',v_item->'plot_emotion_commit',v_item->'arc_requirement',v_item->'info_reveal_boundary',v_item->'role_arc_json','candidate','initial','unconfirmed',true,COALESCE(v_item->'role_arcs','{}'::jsonb));
  END LOOP;
  INSERT INTO public.writeback_log(book_id,transaction_id,writeback_scope_jsonb,world_diff_json,char_diff_json,relation_diff_json,status)
  VALUES(v_book,v_tx,jsonb_build_object('fp','FP001-07','tables',jsonb_build_array('book_project','character','relation_state','world_state','world_binding','l1a_unit','writeback_log')),p_data->'world_atoms',p_data->'characters',p_data->'relations','success');
  v_result := jsonb_build_object('ok',true,'correlation_id',v_corr,'idempotent',false,'result',jsonb_build_object('status','created','book_id',v_book,'world_version_id',v_world_version,'character_version_id',v_char_version));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('create_book',v_key,v_operator,v_book,v_intent,v_result - 'correlation_id');
  RETURN v_result;
EXCEPTION WHEN others THEN
  RETURN public.v7_error(v_corr,'WRITE_FAILED','The book package was not created.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_commit_world_settings(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_action text := p_request->>'action'; v_corr text := p_request->>'correlation_id'; v_operator uuid; v_book uuid;
  v_version uuid; v_parent uuid; v_no integer; v_item jsonb; v_map jsonb := '{}'::jsonb; v_key text := p_request->>'idempotency_key';
  v_intent jsonb := p_request - 'correlation_id'; v_existing public.product_request_log%ROWTYPE; v_result jsonb;
BEGIN
  BEGIN v_operator := (p_request->>'local_operator_id')::uuid; v_book := (p_request->>'book_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_book(v_operator,v_book) OR v_action NOT IN ('save_candidate','read_versions','restore','confirm') THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','The selected book is unavailable.'); END IF;
  IF v_action='read_versions' THEN
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('versions',COALESCE((SELECT jsonb_agg(jsonb_build_object('version_id',wv.id,'version_no',wv.version_no,'state',wv.state,'atoms',(SELECT jsonb_agg(to_jsonb(ws) - 'world_version_id') FROM public.world_state ws WHERE ws.world_version_id=wv.id),'bindings',(SELECT jsonb_agg(to_jsonb(wb) - 'world_version_id') FROM public.world_binding wb WHERE wb.world_version_id=wv.id)) ORDER BY wv.version_no DESC) FROM public.world_version wv WHERE wv.book_id=v_book),'[]'::jsonb)));
  END IF;
  IF (SELECT design_frozen_at IS NOT NULL FROM public.book_project WHERE id=v_book) THEN RETURN public.v7_error(v_corr,'FROZEN','World settings are frozen because conflict traversal has started.'); END IF;
  IF v_action='save_candidate' OR v_action='restore' THEN
    SELECT COALESCE(max(version_no),0)+1 INTO v_no FROM public.world_version WHERE book_id=v_book;
    IF v_action='restore' THEN
      BEGIN v_parent := (p_request->>'version_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The requested version is invalid.'); END;
      IF NOT EXISTS(SELECT 1 FROM public.world_version WHERE id=v_parent AND book_id=v_book) THEN RETURN public.v7_error(v_corr,'NOT_FOUND','The requested version is unavailable.'); END IF;
      INSERT INTO public.world_version(book_id,local_operator_id,version_no,state,parent_version_id) VALUES(v_book,v_operator,v_no,'candidate',v_parent) RETURNING id INTO v_version;
      INSERT INTO public.world_state(world_version_id,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,origin_l1a_id,knowledge_boundary_json,apply_scope_json,violate_cost_json,chain_change_json,reverse_dep_index,reveal_order,l1a_change_log_json,gen_l1a_json,conflict_with_initial)
      SELECT v_version,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,origin_l1a_id,knowledge_boundary_json,apply_scope_json,violate_cost_json,chain_change_json,reverse_dep_index,reveal_order,l1a_change_log_json,gen_l1a_json,conflict_with_initial FROM public.world_state WHERE world_version_id=v_parent;
      INSERT INTO public.world_binding(world_version_id,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer,origin_l1a_id)
      SELECT v_version,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer,origin_l1a_id FROM public.world_binding WHERE world_version_id=v_parent;
    ELSE
      IF jsonb_typeof(p_request->'atoms') <> 'array' OR jsonb_typeof(p_request->'bindings') <> 'array' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','World atoms and bindings are required.'); END IF;
      INSERT INTO public.world_version(book_id,local_operator_id,version_no,state) VALUES(v_book,v_operator,v_no,'candidate') RETURNING id INTO v_version;
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_request->'atoms') LOOP
        IF NULLIF(v_item->>'client_ref','') IS NULL OR NULLIF(v_item->>'atom_key','') IS NULL OR jsonb_typeof(v_item->'atom_value_jsonb') <> 'object' OR jsonb_typeof(v_item->'affordance_dims') <> 'array' OR jsonb_array_length(v_item->'affordance_dims')=0 THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
        INSERT INTO public.world_state(world_version_id,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,knowledge_boundary_json,apply_scope_json,violate_cost_json)
        VALUES(v_version,v_book,v_item->>'board_type',v_item->>'atom_type',v_item->>'atom_key',v_item->'atom_value_jsonb',v_item->'affordance_dims',COALESCE(v_item->>'source_type','manual'),COALESCE(v_item->>'setting_layer','editor_patch'),v_item->'knowledge_boundary_json',v_item->'apply_scope_json',v_item->'violate_cost_json');
        v_map := v_map || jsonb_build_object(v_item->>'client_ref',v_item->>'atom_key');
      END LOOP;
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_request->'bindings') LOOP
        IF NOT(v_map ? (v_item->>'from_ref')) OR NOT(v_map ? (v_item->>'to_ref')) OR v_item->>'binding_strength' NOT IN ('强','中','弱') OR v_item ?| ARRAY['timespan','unlock','tags','amount','strength'] THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
        INSERT INTO public.world_binding(world_version_id,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer)
        VALUES(v_version,v_book,'world',v_map->>(v_item->>'from_ref'),'world',v_map->>(v_item->>'to_ref'),v_item->>'binding_type',v_item->>'binding_strength',COALESCE(v_item->>'setting_layer','editor_patch'));
      END LOOP;
    END IF;
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status','candidate_saved','version_id',v_version,'version_no',v_no));
  END IF;
  IF v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','An idempotency key is required.'); END IF;
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='world_confirm' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for another request.'); END IF; RETURN v_existing.result || jsonb_build_object('correlation_id',v_corr,'idempotent',true); END IF;
  BEGIN v_version := (p_request->>'version_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The version is invalid.'); END;
  IF NOT EXISTS(SELECT 1 FROM public.world_version WHERE id=v_version AND book_id=v_book AND state='candidate') THEN RETURN public.v7_error(v_corr,'NOT_FOUND','The candidate version is unavailable.'); END IF;
  UPDATE public.world_version SET state='returned' WHERE book_id=v_book AND state='formal';
  UPDATE public.world_state SET is_active=false,is_formal=false,is_shadow=true WHERE book_id=v_book AND is_active AND is_formal;
  UPDATE public.world_binding SET is_formal=false,is_shadow=true WHERE book_id=v_book AND is_formal AND NOT is_shadow;
  UPDATE public.world_version SET state='formal',confirmed_at=clock_timestamp() WHERE id=v_version;
  UPDATE public.world_state SET is_active=true,is_formal=true,is_shadow=false WHERE world_version_id=v_version;
  UPDATE public.world_binding SET is_formal=true,is_shadow=false WHERE world_version_id=v_version;
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'result',jsonb_build_object('status','confirmed','version_id',v_version));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('world_confirm',v_key,v_operator,v_book,v_intent,v_result);
  RETURN v_result || jsonb_build_object('correlation_id',v_corr);
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','World settings were not changed.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_commit_character_settings(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE
  v_action text:=p_request->>'action'; v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid;
  v_version uuid; v_parent uuid; v_no integer; v_snapshot jsonb; v_item jsonb; v_map jsonb:='{}'::jsonb; v_char uuid;
  v_key text:=p_request->>'idempotency_key'; v_intent jsonb:=p_request-'correlation_id'; v_existing public.product_request_log%ROWTYPE; v_result jsonb;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=(p_request->>'book_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_book(v_operator,v_book) OR v_action NOT IN ('save_candidate','read_versions','restore','confirm') THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','The selected book is unavailable.'); END IF;
  IF v_action='read_versions' THEN RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('versions',COALESCE((SELECT jsonb_agg(jsonb_build_object('version_id',id,'version_no',version_no,'state',state,'snapshot',snapshot_json) ORDER BY version_no DESC) FROM public.character_version WHERE book_id=v_book),'[]'::jsonb))); END IF;
  IF (SELECT design_frozen_at IS NOT NULL FROM public.book_project WHERE id=v_book) THEN RETURN public.v7_error(v_corr,'FROZEN','Character settings are frozen because conflict traversal has started.'); END IF;
  IF v_action IN ('save_candidate','restore') THEN
    SELECT COALESCE(max(version_no),0)+1 INTO v_no FROM public.character_version WHERE book_id=v_book;
    IF v_action='restore' THEN
      BEGIN v_parent:=(p_request->>'version_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The version is invalid.'); END;
      SELECT snapshot_json INTO v_snapshot FROM public.character_version WHERE id=v_parent AND book_id=v_book;
      IF v_snapshot IS NULL THEN RETURN public.v7_error(v_corr,'NOT_FOUND','The requested version is unavailable.'); END IF;
    ELSE v_snapshot:=p_request->'snapshot'; END IF;
    IF jsonb_typeof(v_snapshot)<>'object' OR jsonb_typeof(v_snapshot->'characters')<>'array' OR jsonb_typeof(v_snapshot->'relations')<>'array' OR jsonb_typeof(v_snapshot->'initial_memories')<>'array' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The complete character snapshot is required.'); END IF;
    INSERT INTO public.character_version(book_id,local_operator_id,version_no,state,parent_version_id,snapshot_json) VALUES(v_book,v_operator,v_no,'candidate',v_parent,v_snapshot) RETURNING id INTO v_version;
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status','candidate_saved','version_id',v_version,'version_no',v_no));
  END IF;
  IF v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','An idempotency key is required.'); END IF;
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='character_confirm' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for another request.'); END IF; RETURN v_existing.result||jsonb_build_object('correlation_id',v_corr,'idempotent',true); END IF;
  BEGIN v_version:=(p_request->>'version_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The version is invalid.'); END;
  SELECT snapshot_json INTO v_snapshot FROM public.character_version WHERE id=v_version AND book_id=v_book AND state='candidate' FOR UPDATE;
  IF v_snapshot IS NULL THEN RETURN public.v7_error(v_corr,'NOT_FOUND','The candidate version is unavailable.'); END IF;
  UPDATE public.character_version SET state='returned' WHERE book_id=v_book AND state='formal';
  UPDATE public.character SET is_active=false,is_formal=false,is_shadow=true WHERE book_id=v_book AND is_active AND is_formal;
  UPDATE public.relation_state SET is_formal=false,is_shadow=true WHERE book_id=v_book AND is_formal AND NOT is_shadow;
  UPDATE public.character_memory SET is_valid=false,is_shadow=true WHERE book_id=v_book AND is_valid AND NOT is_shadow;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_snapshot->'characters') LOOP
    IF NULLIF(v_item->>'client_ref','') IS NULL OR jsonb_typeof(v_item->'five_layers_json')<>'object' OR NOT(v_item->'five_layers_json'?&ARRAY['L0','L1','L2','L3']) OR jsonb_typeof(v_item->'knowledge_boundary_json')<>'object' OR NOT(v_item->'knowledge_boundary_json'?&ARRAY['knows','unknown','false_belief','reasonable_suspect']) THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.character(character_version_id,book_id,char_name,five_layers_json,knowledge_boundary_json,arc_json,status,is_formal,char_type,char_code,gender,conflict_seed_json)
    VALUES(v_version,v_book,v_item->>'char_name',v_item->'five_layers_json',v_item->'knowledge_boundary_json',COALESCE(v_item->'arc_json','{}'::jsonb),'active',true,COALESCE(v_item->>'char_type','ensemble'),v_item->>'client_ref',v_item->>'gender',v_item->'conflict_seed_json') RETURNING id INTO v_char;
    v_map:=v_map||jsonb_build_object(v_item->>'client_ref',v_char::text);
  END LOOP;
  INSERT INTO public.world_knowledge_entry(book_id,world_id,character_id,knows,is_unknown,false_belief,reasonable_suspect)
  SELECT v_book,ws.id,c.id,
    COALESCE((c.knowledge_boundary_json->'knows') ? ws.atom_key,false),
    NOT (COALESCE((c.knowledge_boundary_json->'knows') ? ws.atom_key,false)
      OR COALESCE((c.knowledge_boundary_json->'false_belief') ? ws.atom_key,false)
      OR COALESCE((c.knowledge_boundary_json->'reasonable_suspect') ? ws.atom_key,false)),
    COALESCE((c.knowledge_boundary_json->'false_belief') ? ws.atom_key,false),
    COALESCE((c.knowledge_boundary_json->'reasonable_suspect') ? ws.atom_key,false)
  FROM public.world_state ws CROSS JOIN public.character c
  WHERE ws.is_active AND ws.is_formal AND ws.is_valid AND NOT ws.is_shadow AND ws.atom_type='fact' AND c.character_version_id=v_version;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_snapshot->'relations') LOOP
    IF NOT(v_map?(v_item->>'from_ref')) OR NOT(v_map?(v_item->>'to_ref')) OR NULLIF(v_item->>'change_event','') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.relation_state(character_version_id,book_id,char_a_id,char_b_id,trust,intimacy,power_balance,dependence,hostility,common_goal,secret_known,emotional_bond,relation_type,relation_hierarchy,relation_origin,change_event_json,is_formal)
    VALUES(v_version,v_book,(v_map->>(v_item->>'from_ref'))::uuid,(v_map->>(v_item->>'to_ref'))::uuid,COALESCE((v_item->>'trust')::integer,0),COALESCE((v_item->>'intimacy')::integer,0),COALESCE((v_item->>'power_balance')::integer,0),COALESCE((v_item->>'dependence')::integer,0),COALESCE((v_item->>'hostility')::integer,0),COALESCE((v_item->>'common_goal')::integer,0),COALESCE((v_item->>'secret_known')::integer,0),COALESCE((v_item->>'emotional_bond')::integer,0),v_item->>'relation_type',v_item->>'relation_hierarchy',v_item->>'relation_origin',jsonb_build_object('event',v_item->>'change_event'),true);
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_snapshot->'initial_memories') LOOP
    IF NOT(v_map?(v_item->>'char_ref')) OR NULLIF(v_item->>'memory_content','') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.character_memory(book_id,char_id,character_version_id,memory_type,memory_content,truth_status,importance,decay_rate)
    VALUES(v_book,(v_map->>(v_item->>'char_ref'))::uuid,v_version,COALESCE(v_item->>'memory_type','knowledge'),v_item->>'memory_content',COALESCE(v_item->>'truth_status','true'),COALESCE((v_item->>'importance')::numeric,0.5),COALESCE((v_item->>'decay_rate')::numeric,0.1));
  END LOOP;
  UPDATE public.character_version SET state='formal',confirmed_at=clock_timestamp() WHERE id=v_version;
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'result',jsonb_build_object('status','confirmed','version_id',v_version));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('character_confirm',v_key,v_operator,v_book,v_intent,v_result);
  RETURN v_result||jsonb_build_object('correlation_id',v_corr);
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','Character settings were not changed.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_generate_l1a_conflicts(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_key text:=p_request->>'idempotency_key'; v_intent jsonb:=p_request-'correlation_id'; v_existing public.product_request_log%ROWTYPE; v_item jsonb; v_ids jsonb:='[]'::jsonb; v_id uuid; v_result jsonb;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=(p_request->>'book_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_book(v_operator,v_book) OR jsonb_typeof(p_request->'generated_candidates')<>'array' OR jsonb_array_length(p_request->'generated_candidates')=0 OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','A valid L1A candidate batch is required.'); END IF;
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='l1a_generate' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for another request.'); END IF; RETURN v_existing.result||jsonb_build_object('correlation_id',v_corr,'idempotent',true); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.l1a_unit WHERE book_id=v_book AND source_type='initial' AND NOT is_shadow) OR NOT EXISTS(SELECT 1 FROM public.world_state WHERE book_id=v_book AND setting_layer='initial' AND is_active AND is_formal AND is_valid AND NOT is_shadow) OR NOT EXISTS(SELECT 1 FROM public.character WHERE book_id=v_book AND is_active AND is_formal AND is_valid AND NOT is_shadow) THEN RETURN public.v7_error(v_corr,'DATA_DEBT','Formal initial world, characters, and initial L1A are required.'); END IF;
  UPDATE public.book_project SET design_frozen_at=COALESCE(design_frozen_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=v_book;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_request->'generated_candidates') LOOP
    INSERT INTO public.l1a_unit(book_id,l1a_index,l1a_name,conflict_background,escalation_path,stakes,irreversible_consequence,plot_emotion_commit,arc_requirement,info_reveal_boundary,role_arc_json,status,source_type,confirmation_status,future_value_reserved,future_setting_seeds,world_resistance_refs,role_arcs,participant_chars_json)
    VALUES(v_book,(v_item->>'l1a_index')::integer,v_item->>'l1a_name',v_item->>'conflict_background',v_item->>'escalation_path',v_item->>'stakes',v_item->>'irreversible_consequence',v_item->'plot_emotion_commit',v_item->'arc_requirement',v_item->'info_reveal_boundary',v_item->'role_arc_json','candidate','traversal','unconfirmed',v_item->'future_value_reserved',v_item->'future_setting_seeds',v_item->'world_resistance_refs',COALESCE(v_item->'role_arcs','{}'::jsonb),v_item->'participant_chars_json') RETURNING id INTO v_id;
    v_ids:=v_ids||jsonb_build_array(v_id);
  END LOOP;
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'result',jsonb_build_object('status','candidates_saved','candidate_ids',v_ids,'design_frozen',true));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('l1a_generate',v_key,v_operator,v_book,v_intent,v_result);
  RETURN v_result||jsonb_build_object('correlation_id',v_corr);
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','The L1A candidates were not saved.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finalize_l1a(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_key text:=p_request->>'idempotency_key'; v_intent jsonb:=p_request-'correlation_id'; v_existing public.product_request_log%ROWTYPE; v_ids uuid[]; v_old_world uuid; v_new_world uuid; v_no integer; v_item jsonb; v_map jsonb:='{}'::jsonb; v_result jsonb; v_tx uuid:=gen_random_uuid();
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=(p_request->>'book_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_book(v_operator,v_book) OR jsonb_typeof(p_request->'l1a_ids')<>'array' OR jsonb_array_length(p_request->'l1a_ids')=0 OR jsonb_typeof(p_request->'future_world_atoms')<>'array' OR jsonb_typeof(p_request->'future_world_bindings')<>'array' OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The finalized L1A package is required.'); END IF;
  SELECT array_agg(value::uuid) INTO v_ids FROM jsonb_array_elements_text(p_request->'l1a_ids');
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='l1a_finalize' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for another request.'); END IF; RETURN v_existing.result||jsonb_build_object('correlation_id',v_corr,'idempotent',true); END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) id WHERE NOT EXISTS(SELECT 1 FROM public.l1a_unit l WHERE l.id=id AND l.book_id=v_book AND l.status IN ('candidate','sorted') AND NOT l.is_shadow)) THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','A selected L1A is unavailable.'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_request->'future_world_atoms') x WHERE COALESCE(x->>'inherit_status','')='needs_review') THEN RETURN public.v7_error(v_corr,'REVIEW_REQUIRED','Future world entries requiring review cannot be finalized.'); END IF;
  UPDATE public.l1a_unit SET status='finalized',confirmation_status='creator_confirmed',is_formal=true,is_locked=true,updated_at=clock_timestamp() WHERE id=ANY(v_ids);
  SELECT id INTO v_old_world FROM public.world_version WHERE book_id=v_book AND state='formal' ORDER BY version_no DESC LIMIT 1 FOR UPDATE;
  SELECT COALESCE(max(version_no),0)+1 INTO v_no FROM public.world_version WHERE book_id=v_book;
  INSERT INTO public.world_version(book_id,local_operator_id,version_no,state,parent_version_id,confirmed_at) VALUES(v_book,v_operator,v_no,'formal',v_old_world,clock_timestamp()) RETURNING id INTO v_new_world;
  INSERT INTO public.world_state(world_version_id,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,origin_l1a_id,is_active,is_formal,knowledge_boundary_json,apply_scope_json,violate_cost_json,chain_change_json,reverse_dep_index,reveal_order,l1a_change_log_json,gen_l1a_json,conflict_with_initial)
  SELECT v_new_world,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,origin_l1a_id,true,true,knowledge_boundary_json,apply_scope_json,violate_cost_json,chain_change_json,reverse_dep_index,reveal_order,l1a_change_log_json,gen_l1a_json,conflict_with_initial FROM public.world_state WHERE world_version_id=v_old_world;
  INSERT INTO public.world_binding(world_version_id,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer,origin_l1a_id,is_formal)
  SELECT v_new_world,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer,origin_l1a_id,true FROM public.world_binding WHERE world_version_id=v_old_world;
  UPDATE public.world_version SET state='returned' WHERE id=v_old_world;
  UPDATE public.world_state SET is_active=false,is_formal=false,is_shadow=true WHERE world_version_id=v_old_world;
  UPDATE public.world_binding SET is_formal=false,is_shadow=true WHERE world_version_id=v_old_world;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_request->'future_world_atoms') WHERE value->>'inherit_status'='inheritable' LOOP
    INSERT INTO public.world_state(world_version_id,book_id,board_type,atom_type,atom_key,atom_value_jsonb,affordance_dims,source_type,setting_layer,origin_l1a_id,is_active,is_formal,knowledge_boundary_json,conflict_with_initial)
    VALUES(v_new_world,v_book,v_item->>'board_type',v_item->>'atom_type',v_item->>'atom_key',v_item->'atom_value_jsonb',v_item->'affordance_dims',COALESCE(v_item->>'source_type','ai_generated'),'l1a_generated',(v_item->>'origin_l1a_id')::uuid,true,true,v_item->'knowledge_boundary_json',COALESCE(v_item->'conflict_with_initial','[]'::jsonb));
    v_map:=v_map||jsonb_build_object(v_item->>'client_ref',v_item->>'atom_key');
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_request->'future_world_bindings') LOOP
    IF NOT(v_map?(v_item->>'from_ref')) OR NOT(v_map?(v_item->>'to_ref')) OR v_item->>'binding_strength' NOT IN ('强','中','弱') THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
    INSERT INTO public.world_binding(world_version_id,book_id,from_ref_type,from_ref_id,to_ref_type,to_ref_id,binding_type,binding_strength,setting_layer,origin_l1a_id,is_formal)
    VALUES(v_new_world,v_book,'world',v_map->>(v_item->>'from_ref'),'world',v_map->>(v_item->>'to_ref'),v_item->>'binding_type',v_item->>'binding_strength','l1a_generated',(v_item->>'origin_l1a_id')::uuid,true);
  END LOOP;
  UPDATE public.book_project SET current_l1a_id=v_ids[1],active_l1a_json=jsonb_build_object('l1a_ids',to_jsonb(v_ids)),stage_code='production',updated_at=clock_timestamp() WHERE id=v_book;
  INSERT INTO public.writeback_log(book_id,transaction_id,writeback_scope_jsonb,world_diff_json,status) VALUES(v_book,v_tx,jsonb_build_object('fp','FP004-04','tables',jsonb_build_array('l1a_unit','world_state','world_binding','writeback_log')),p_request->'future_world_atoms','success');
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'result',jsonb_build_object('status','finalized','l1a_ids',to_jsonb(v_ids),'world_version_id',v_new_world));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('l1a_finalize',v_key,v_operator,v_book,v_intent,v_result);
  RETURN v_result||jsonb_build_object('correlation_id',v_corr);
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','The L1A package was not finalized.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_confirm_audit_result(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_chapter uuid; v_key text:=p_request->>'idempotency_key'; v_intent jsonb:=p_request-'correlation_id'; v_existing public.product_request_log%ROWTYPE; v_audit uuid; v_item jsonb; v_result jsonb;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=(p_request->>'book_id')::uuid; v_chapter:=(p_request->>'chapter_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_book(v_operator,v_book) OR NOT EXISTS(SELECT 1 FROM public.chapter WHERE id=v_chapter AND book_id=v_book) OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','The selected chapter is unavailable.'); END IF;
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='audit_confirm' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for another request.'); END IF; RETURN v_existing.result||jsonb_build_object('correlation_id',v_corr,'idempotent',true); END IF;
  INSERT INTO public.audit_attempt_log(book_id,chapter_id,audit_type,candidate_version_no,candidate_text_snapshot,has_p0_blocker,p0_items_json,audit_findings_jsonb,return_route_suggestion_jsonb,frozen_deduction_result_jsonb,audit_status)
  SELECT v_book,v_chapter,COALESCE(p_request->>'audit_type','objective'),c.candidate_version_no,c.candidate_text,COALESCE((p_request->>'has_p0_blocker')::boolean,true),p_request->'p0_items_json',p_request->'audit_findings_jsonb',p_request->'return_route_suggestion_jsonb',c.candidate_plot_sim_json,'completed' FROM public.chapter c WHERE c.id=v_chapter RETURNING id INTO v_audit;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_request->'candidate_assets','[]'::jsonb)) LOOP
    INSERT INTO public.narrative_asset(book_id,linked_chapter_id,asset_type,asset_name,asset_description,hook_category,countdown_deadline,fulfillment_window,status,evidence_json)
    VALUES(v_book,v_chapter,v_item->>'asset_type',v_item->>'asset_name',v_item->>'asset_description',v_item->>'hook_category',NULLIF(v_item->>'countdown_deadline','')::integer,v_item->>'fulfillment_window',COALESCE(v_item->>'status','pending'),v_item->'evidence_json');
  END LOOP;
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'result',jsonb_build_object('status','audit_confirmed','audit_id',v_audit));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('audit_confirm',v_key,v_operator,v_book,v_intent,v_result);
  RETURN v_result||jsonb_build_object('correlation_id',v_corr);
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','The audit evidence was not saved.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_record_iteration_sample(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_id uuid;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=NULLIF(p_request->>'book_id','')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_operator(v_operator) OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator,v_book)) OR COALESCE((p_request->>'failure_count')::integer,0)<3 THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','Only the third failed attempt may enter the sample pool.'); END IF;
  INSERT INTO public.iteration_log(book_id,local_operator_id,source_fp,iter_type,review_status,exec_result,snapshot_jsonb)
  VALUES(v_book,v_operator,p_request->>'source_fp',p_request->>'iter_type','pool','failed',p_request->'snapshot_jsonb') RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status','pooled','sample_id',v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_classify_iteration_sample(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_id uuid; v_disposition text;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_id:=(p_request->>'sample_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  v_disposition:=p_request->>'disposition';
  IF v_disposition NOT IN ('pending_review','discarded') OR p_request->>'root_debt_type' NOT IN ('prompt','skill','data') OR jsonb_typeof(p_request->'attribution_evidence_json')<>'object' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','A single evidence-backed attribution is required.'); END IF;
  UPDATE public.iteration_log SET review_status=v_disposition,root_debt_type=p_request->>'root_debt_type',attribution_evidence_json=p_request->'attribution_evidence_json' WHERE id=v_id AND local_operator_id=v_operator AND review_status='pool';
  IF NOT FOUND THEN RETURN public.v7_error(v_corr,'STATE_REJECTED','The sample is not available for classification.'); END IF;
  RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status',v_disposition,'sample_id',v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_save_prompt_candidate(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_version integer; v_id uuid;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=NULLIF(p_request->>'book_id','')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_operator(v_operator) OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator,v_book)) OR NULLIF(p_request->>'fp_target','') IS NULL OR NULLIF(p_request->>'prompt_text','') IS NULL THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','A scoped prompt candidate is required.'); END IF;
  SELECT COALESCE(max(version),0)+1 INTO v_version FROM public.prompt_config WHERE local_operator_id=v_operator AND book_id IS NOT DISTINCT FROM v_book AND fp_target=p_request->>'fp_target';
  INSERT INTO public.prompt_config(local_operator_id,book_id,fp_target,version,prompt_text,status,is_active) VALUES(v_operator,v_book,p_request->>'fp_target',v_version,p_request->>'prompt_text','candidate',false) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status','candidate','prompt_config_id',v_id,'version',v_version));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_promote_prompt_config(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_candidate uuid; v_key text:=p_request->>'idempotency_key'; v_intent jsonb:=p_request-'correlation_id'; v_existing public.product_request_log%ROWTYPE; v_old text; v_new text; v_fp text; v_sample jsonb; v_result jsonb;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=NULLIF(p_request->>'book_id','')::uuid; v_candidate:=(p_request->>'candidate_prompt_id')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_operator(v_operator) OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator,v_book)) OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR jsonb_typeof(p_request->'sample_results')<>'array' THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','A reviewed prompt promotion is required.'); END IF;
  SELECT * INTO v_existing FROM public.product_request_log WHERE operation='prompt_promote' AND local_operator_id=v_operator AND idempotency_key=v_key;
  IF FOUND THEN IF v_existing.intent IS DISTINCT FROM v_intent THEN RETURN public.v7_error(v_corr,'IDEMPOTENCY_CONFLICT','The idempotency key was already used for another request.'); END IF; RETURN v_existing.result||jsonb_build_object('correlation_id',v_corr,'idempotent',true); END IF;
  SELECT fp_target,prompt_text INTO v_fp,v_new FROM public.prompt_config WHERE id=v_candidate AND local_operator_id=v_operator AND book_id IS NOT DISTINCT FROM v_book AND status='candidate' FOR UPDATE;
  IF v_fp IS NULL THEN RETURN public.v7_error(v_corr,'STATE_REJECTED','The prompt candidate is unavailable.'); END IF;
  SELECT prompt_text INTO v_old FROM public.prompt_config WHERE local_operator_id=v_operator AND book_id IS NOT DISTINCT FROM v_book AND fp_target=v_fp AND is_active FOR UPDATE;
  UPDATE public.prompt_config SET status='archived',is_active=false WHERE local_operator_id=v_operator AND book_id IS NOT DISTINCT FROM v_book AND fp_target=v_fp AND is_active;
  UPDATE public.prompt_config SET status='active',is_active=true WHERE id=v_candidate;
  FOR v_sample IN SELECT value FROM jsonb_array_elements(p_request->'sample_results') LOOP
    UPDATE public.iteration_log SET review_status=CASE WHEN (v_sample->>'accepted')::boolean THEN 'confirmed' ELSE 'discarded' END,exec_result=CASE WHEN (v_sample->>'accepted')::boolean THEN 'success' ELSE 'failed' END,confirmed_at=CASE WHEN (v_sample->>'accepted')::boolean THEN clock_timestamp() ELSE NULL END WHERE id=(v_sample->>'sample_id')::uuid AND local_operator_id=v_operator AND review_status='pending_review';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
  END LOOP;
  INSERT INTO public.prompt_iteration_log(prompt_config_id,change_type,old_prompt_text,new_prompt_text,changed_by) VALUES(v_candidate,'promotion',v_old,v_new,v_operator);
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'result',jsonb_build_object('status','active','prompt_config_id',v_candidate,'fp_target',v_fp));
  INSERT INTO public.product_request_log(operation,idempotency_key,local_operator_id,book_id,intent,result) VALUES('prompt_promote',v_key,v_operator,v_book,v_intent,v_result);
  RETURN v_result||jsonb_build_object('correlation_id',v_corr);
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','The prompt promotion was rolled back.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_manage_skill(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE v_corr text:=p_request->>'correlation_id'; v_operator uuid; v_book uuid; v_action text:=p_request->>'action'; v_skill_id uuid; v_version integer; v_id uuid; v_slug text;
BEGIN
  BEGIN v_operator:=(p_request->>'local_operator_id')::uuid; v_book:=NULLIF(p_request->>'book_id','')::uuid; EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','The request could not be accepted.'); END;
  IF NOT public.v7_assert_operator(v_operator) OR (v_book IS NOT NULL AND NOT public.v7_assert_book(v_operator,v_book)) THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','The selected scope is unavailable.'); END IF;
  IF v_action='list' THEN
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('skills',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.skill_category,s.skill_name) FROM public.skill s WHERE s.lifecycle_status='active' AND (s.source_type='system_builtin' OR s.owner_local_operator_id=v_operator) AND (v_book IS NULL OR NOT EXISTS(SELECT 1 FROM public.book_skill_preference p WHERE p.book_id=v_book AND p.skill_id=s.skill_id AND p.status='disabled'))),'[]'::jsonb)));
  ELSIF v_action='create_version' THEN
    v_skill_id:=COALESCE(NULLIF(p_request->>'skill_id','')::uuid,gen_random_uuid()); v_slug:=p_request->>'stable_slug';
    IF NULLIF(v_slug,'') IS NULL OR p_request->>'skill_category' NOT IN ('题材组合','章节展开','艺术呈现','镜头语言') THEN RETURN public.v7_error(v_corr,'INVALID_REQUEST','A valid user-managed skill is required.'); END IF;
    SELECT COALESCE(max(version),0)+1 INTO v_version FROM public.skill WHERE skill_id=v_skill_id AND owner_local_operator_id=v_operator;
    UPDATE public.skill SET lifecycle_status='archived',updated_at=clock_timestamp() WHERE skill_id=v_skill_id AND owner_local_operator_id=v_operator AND lifecycle_status='active';
    INSERT INTO public.skill(skill_id,stable_slug,version,source_type,owner_local_operator_id,source_locator,source_sha256,skill_name,skill_category,skill_description,applicable_stages,applicable_scopes,constraint_fields,template_fields,skill_config_jsonb,lifecycle_status)
    VALUES(v_skill_id,v_slug,v_version,'user_managed',v_operator,'user-managed','user-managed',p_request->>'skill_name',p_request->>'skill_category',p_request->>'skill_description',p_request->'applicable_stages',p_request->'applicable_scopes',p_request->'constraint_fields',p_request->'template_fields',COALESCE(p_request->'skill_config_jsonb','{}'::jsonb),'active') RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status','active','id',v_id,'skill_id',v_skill_id,'version',v_version));
  ELSIF v_action='set_preference' THEN
    v_skill_id:=(p_request->>'skill_id')::uuid;
    IF v_book IS NULL OR p_request->>'status' NOT IN ('active','disabled') OR NOT EXISTS(SELECT 1 FROM public.skill WHERE skill_id=v_skill_id AND lifecycle_status='active' AND (source_type='system_builtin' OR owner_local_operator_id=v_operator)) THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','The skill preference is unavailable.'); END IF;
    INSERT INTO public.book_skill_preference(book_id,skill_id,status,updated_by) VALUES(v_book,v_skill_id,p_request->>'status',v_operator) ON CONFLICT(book_id,skill_id) DO UPDATE SET status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp();
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status',p_request->>'status','skill_id',v_skill_id));
  ELSIF v_action='delete' THEN
    v_skill_id:=(p_request->>'skill_id')::uuid;
    IF EXISTS(SELECT 1 FROM public.skill WHERE skill_id=v_skill_id AND source_type='system_builtin') THEN RETURN public.v7_error(v_corr,'BUILTIN_READ_ONLY','System built-in skills cannot be deleted.'); END IF;
    IF EXISTS(SELECT 1 FROM public.book_skill_preference WHERE skill_id=v_skill_id AND status='active') THEN RETURN public.v7_error(v_corr,'SKILL_REFERENCED','The skill still has active book references.'); END IF;
    DELETE FROM public.book_skill_preference WHERE skill_id=v_skill_id;
    DELETE FROM public.vector_index_log WHERE source_table='skill' AND source_id IN (SELECT id FROM public.skill WHERE skill_id=v_skill_id AND owner_local_operator_id=v_operator);
    DELETE FROM public.skill WHERE skill_id=v_skill_id AND owner_local_operator_id=v_operator;
    IF NOT FOUND THEN RETURN public.v7_error(v_corr,'SCOPE_REJECTED','The user-managed skill is unavailable.'); END IF;
    RETURN jsonb_build_object('ok',true,'correlation_id',v_corr,'result',jsonb_build_object('status','deleted','skill_id',v_skill_id));
  END IF;
  RETURN public.v7_error(v_corr,'INVALID_REQUEST','The skill action is unsupported.');
EXCEPTION WHEN others THEN RETURN public.v7_error(v_corr,'WRITE_FAILED','The skill command was not completed.');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_workbench(p_request jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
  SELECT jsonb_build_object(
    'ok', false,
    'correlation_id', COALESCE(p_request->>'correlation_id','unavailable'),
    'redacted_error', jsonb_build_object(
      'code','CONFIG_CONTRACT_BLOCKED',
      'message','V7 has not defined the budget unit, safe default, or complete configuration scope contract.'
    ),
    'result', jsonb_build_object(
      'automation_defaults', jsonb_build_object('auto_production',false,'auto_audit',false,'auto_iteration',false),
      'mutations_allowed', false
    )
  )
$$;

CREATE VIEW public.v_world_state_active AS
SELECT ws.* FROM public.world_state ws
WHERE ws.is_active AND ws.is_formal AND ws.is_valid AND NOT ws.is_shadow;

CREATE VIEW public.v_character_active AS
SELECT c.* FROM public.character c
WHERE c.is_active AND c.is_formal AND c.is_valid AND NOT c.is_shadow;

CREATE VIEW public.v_skill_effective AS
SELECT s.* FROM public.skill s WHERE s.lifecycle_status='active';

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_local_operator(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_create_book_project(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_commit_world_settings(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_commit_character_settings(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_generate_l1a_conflicts(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_l1a(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_confirm_audit_result(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_record_iteration_sample(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_classify_iteration_sample(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_save_prompt_candidate(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_promote_prompt_config(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_manage_skill(jsonb) TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.rpc_workbench(jsonb) TO CURRENT_USER;

INSERT INTO public.v7_install_metadata(install_key,description)
VALUES('v7-product-20260714','V7 product data and RPC layer; conflicting chapter transitions intentionally excluded.');

COMMIT;
