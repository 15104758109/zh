BEGIN;
SET search_path TO public;

ALTER TABLE public.t_book_projects ADD COLUMN IF NOT EXISTS local_operator_id text;
ALTER TABLE public.t_book_projects ADD COLUMN IF NOT EXISTS normalized_title text;
ALTER TABLE public.t_book_projects ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.t_segment_promises ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'initial';
ALTER TABLE public.t_segment_promises ADD COLUMN IF NOT EXISTS core_conflict_flag boolean NOT NULL DEFAULT false;

DO $segment_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.t_segment_promises'::regclass
      AND conname = 't_segment_promises_source_type_check_v7'
  ) THEN
    ALTER TABLE public.t_segment_promises ADD CONSTRAINT t_segment_promises_source_type_check_v7
      CHECK (source_type IN ('initial', 'traversal', 'manual'));
  END IF;
END;
$segment_constraint$;

DO $precondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.t_book_projects
    WHERE local_operator_id IS NULL OR normalized_title IS NULL OR idempotency_key IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NEW_BOOK_INSTALL_PRECONDITION_FAILED',
      DETAIL = 'Legacy book-project rows must be cleared by the controlled cleanup before installation.';
  END IF;
END;
$precondition$;

ALTER TABLE public.t_world_assets DROP CONSTRAINT IF EXISTS t_world_assets_board_type_check;
ALTER TABLE public.t_world_assets DROP CONSTRAINT IF EXISTS t_world_assets_board_type_check_v7;
ALTER TABLE public.t_world_assets ADD CONSTRAINT t_world_assets_board_type_check_v7
  CHECK (board_type IN ('rule','geography','resource','faction','profession','monster','chronicle'));

CREATE UNIQUE INDEX IF NOT EXISTS t_book_projects_operator_title_uq
  ON public.t_book_projects (local_operator_id, normalized_title)
  WHERE local_operator_id IS NOT NULL AND normalized_title IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS t_book_projects_operator_idempotency_uq
  ON public.t_book_projects (local_operator_id, idempotency_key)
  WHERE local_operator_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rpc_create_book_project(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_operator text;
  v_title text;
  v_normalized_title text;
  v_idempotency_key text;
  v_book_id uuid := gen_random_uuid();
  v_existing uuid;
  v_existing_title text;
  v_constraint text;
  v_char_map jsonb := '{}'::jsonb;
  v_character jsonb;
  v_world jsonb;
  v_relation jsonb;
  v_segment jsonb;
  v_char_id uuid;
  v_l1a_id uuid;
  v_allowed constant text[] := ARRAY[
    'local_operator_id','title','idempotency_key','intent','forbid','selling_points',
    'target_words','chapter_words','characters','world_assets',
    'relations','segment_promises'
  ];
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','The request could not be accepted.'));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS k WHERE NOT (k = ANY(v_allowed)))
     OR NOT (p_data ?& v_allowed) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','The request contains unsupported fields.'));
  END IF;

  v_operator := p_data->>'local_operator_id';
  v_title := NULLIF(regexp_replace(trim(coalesce(p_data->>'title','')), '\s+', ' ', 'g'), '');
  v_normalized_title := lower(v_title);
  v_idempotency_key := NULLIF(trim(p_data->>'idempotency_key'), '');
  IF v_operator IS NULL OR v_operator !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     OR v_title IS NULL OR length(v_title) > 240
     OR (v_idempotency_key IS NOT NULL AND v_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$')
     OR jsonb_typeof(p_data->'intent') <> 'object'
     OR jsonb_typeof(p_data->'forbid') <> 'object'
     OR jsonb_typeof(p_data->'selling_points') <> 'array'
     OR (p_data ? 'target_words' AND (jsonb_typeof(p_data->'target_words') <> 'number' OR (p_data->>'target_words')::numeric < 1 OR (p_data->>'target_words')::numeric <> trunc((p_data->>'target_words')::numeric)))
     OR (p_data ? 'chapter_words' AND (jsonb_typeof(p_data->'chapter_words') <> 'number' OR (p_data->>'chapter_words')::numeric NOT BETWEEN 500 AND 10000 OR (p_data->>'chapter_words')::numeric <> trunc((p_data->>'chapter_words')::numeric)))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['characters','world_assets','relations','segment_promises']) f WHERE jsonb_typeof(p_data->f) <> 'array') THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','The request could not be accepted.'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_data->'world_assets') AS asset(value)
    WHERE jsonb_typeof(value) <> 'object'
      OR jsonb_typeof(value->'item_content') <> 'object'
      OR CASE WHEN jsonb_typeof(value->'item_content'->'affordance_dims') = 'array'
        THEN jsonb_array_length(value->'item_content'->'affordance_dims') = 0 ELSE true END
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','The request could not be accepted.'));
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT book_id, book_name INTO v_existing, v_existing_title FROM public.t_book_projects
    WHERE local_operator_id = v_operator AND idempotency_key = v_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('ok',true,'status','success','book_id',v_existing::text,'idempotent',true,
        'current_book',jsonb_build_object('book_id',v_existing::text,'local_operator_id',v_operator,'title',v_existing_title));
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.t_book_projects WHERE local_operator_id = v_operator AND normalized_title = v_normalized_title) THEN
    RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','DUPLICATE_TITLE','message','A book with this title already exists.'));
  END IF;

  BEGIN
    PERFORM set_config('zh.bypass_rpc','true',true);
    INSERT INTO public.t_book_projects (
      book_id, local_operator_id, book_name, normalized_title, intent_json, forbid_json,
      selling_points_json, stage_code, target_words, chapter_words,
      idempotency_key, is_active
    ) VALUES (
      v_book_id, v_operator, v_title, v_normalized_title, coalesce(p_data->'intent','{}'::jsonb),
      coalesce(p_data->'forbid','{}'::jsonb), coalesce(p_data->'selling_points','[]'::jsonb),
      'design', (p_data->>'target_words')::integer, (p_data->>'chapter_words')::integer,
      v_idempotency_key, true
    );

    IF jsonb_typeof(p_data->'characters') = 'array' THEN
      FOR v_character IN SELECT value FROM jsonb_array_elements(p_data->'characters') LOOP
        IF jsonb_typeof(v_character) <> 'object' OR NULLIF(trim(v_character->>'client_ref'),'') IS NULL
           OR NULLIF(trim(v_character->>'name'),'') IS NULL
           OR jsonb_typeof(v_character->'five_layers') <> 'object'
           OR NOT ((v_character->'five_layers') ?& ARRAY['L0','L1','L2','L3'])
           OR jsonb_typeof(v_character->'knowledge_boundary') <> 'object'
           OR NOT ((v_character->'knowledge_boundary') ?& ARRAY['knows','unknown','false_belief','reasonable_suspect']) THEN
          RAISE EXCEPTION USING ERRCODE='22023';
        END IF;
        v_char_id := gen_random_uuid();
        INSERT INTO public.t_character_profiles (
          char_id, book_id, char_code, char_name, char_type, gender, five_layers_json,
          knowledge_boundary_json, decide_init_json, origin_memory_json, conflict_seed_json, char_arc
        ) VALUES (
          v_char_id, v_book_id, v_character->>'client_ref', v_character->>'name',
          CASE WHEN v_character->>'char_type' IN ('protagonist','supporting','ensemble','antagonist') THEN v_character->>'char_type' ELSE 'ensemble' END,
          v_character->>'gender', v_character->'five_layers', v_character->'knowledge_boundary',
          coalesce(v_character->'decide_init','{}'::jsonb), coalesce(v_character->'origin_memory','{}'::jsonb),
          coalesce(v_character->'conflict_seed','{}'::jsonb), v_character->>'char_arc'
        );
        v_char_map := v_char_map || jsonb_build_object(v_character->>'client_ref', v_char_id::text);
      END LOOP;
    END IF;

    IF jsonb_typeof(p_data->'world_assets') = 'array' THEN
      FOR v_world IN SELECT value FROM jsonb_array_elements(p_data->'world_assets') LOOP
        IF coalesce(v_world->>'board_type','') NOT IN ('rule','geography','resource','faction','profession','monster','chronicle')
           OR coalesce(v_world->>'atom_type','') NOT IN ('rule','fact','resource','conflict_seed')
           OR NULLIF(trim(coalesce(v_world->>'item_name',v_world->>'title')),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
        INSERT INTO public.t_world_assets (world_id, book_id, board_type, atom_type, source_type, setting_layer, item_name, item_content)
        VALUES (gen_random_uuid(), v_book_id, v_world->>'board_type', v_world->>'atom_type',
          CASE WHEN v_world->>'source_type' IN ('manual','imported','ai_generated') THEN v_world->>'source_type' ELSE 'manual' END,
          'initial', coalesce(v_world->>'item_name',v_world->>'title'), coalesce(v_world->'item_content',v_world));
      END LOOP;
    END IF;

    IF jsonb_typeof(p_data->'relations') = 'array' THEN
      FOR v_relation IN SELECT value FROM jsonb_array_elements(p_data->'relations') LOOP
        IF NOT (v_char_map ? (v_relation->>'from_ref')) OR NOT (v_char_map ? (v_relation->>'to_ref'))
           OR (v_relation->>'from_ref') = (v_relation->>'to_ref') THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
        INSERT INTO public.t_relation_states (
          relation_state_id, book_id, from_char_id, to_char_id, intimacy_score, trust_score,
          dependency_score, comm_mode, conflict_mode, support_level, role_assign, reciprocity_score,
          relation_status, conflict_mem_json, support_event_json
        ) VALUES (
          gen_random_uuid(), v_book_id, (v_char_map->>(v_relation->>'from_ref'))::uuid,
          (v_char_map->>(v_relation->>'to_ref'))::uuid, (v_relation->>'intimacy')::numeric,
          (v_relation->>'trust')::numeric, (v_relation->>'dependence')::numeric,
          v_relation->>'relation_type', v_relation->>'relation_hierarchy', (v_relation->>'support_level')::numeric,
          v_relation->>'role_assign', (v_relation->>'emotional_bond')::numeric, 'candidate', v_relation, v_relation
        );
      END LOOP;
    END IF;

    IF jsonb_typeof(p_data->'segment_promises') = 'array' THEN
      FOR v_segment IN SELECT value FROM jsonb_array_elements(p_data->'segment_promises') LOOP
        IF (v_segment->>'l1a_seq') !~ '^[0-9]+$' OR (v_segment->>'l1a_seq')::integer < 1
           OR NULLIF(trim(v_segment->>'l1a_name'),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
        v_l1a_id := gen_random_uuid();
        INSERT INTO public.t_segment_promises (
          l1a_id, book_id, l1a_seq, l1a_name, conflict_background, stakes_json,
          irreversible_consequences, escalation_path, plot_promise_json, emotion_promise_json,
          role_arc_json, world_progress_json, status, run_status, source_type, core_conflict_flag
        ) VALUES (
          v_l1a_id, v_book_id, (v_segment->>'l1a_seq')::integer, v_segment->>'l1a_name',
          coalesce(v_segment->'conflict_background','{}'::jsonb), coalesce(v_segment->'stakes','{}'::jsonb),
          coalesce(v_segment->'irreversible_consequences','{}'::jsonb), coalesce(v_segment->'escalation_path','{}'::jsonb),
          coalesce(v_segment->'plot_promise','{}'::jsonb), coalesce(v_segment->'emotion_promise','{}'::jsonb),
          coalesce(v_segment->'role_arc','{}'::jsonb), coalesce(v_segment->'world_progress','{}'::jsonb),
          'candidate', 'Idle', 'initial', true
        );
      END LOOP;
    END IF;
    INSERT INTO public.t_writeback_logs (wb_id, book_id, world_diff_json, char_diff_json, relation_diff_json, asset_diff_json, l1a_diff_json, commit_result)
    VALUES (gen_random_uuid(), v_book_id, coalesce(p_data->'world_assets','[]'::jsonb), coalesce(p_data->'characters','[]'::jsonb), coalesce(p_data->'relations','[]'::jsonb), '[]'::jsonb, coalesce(p_data->'segment_promises','[]'::jsonb), 'success');
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 't_book_projects_operator_idempotency_uq' AND v_idempotency_key IS NOT NULL THEN
        SELECT book_id, book_name INTO v_existing, v_existing_title FROM public.t_book_projects WHERE local_operator_id=v_operator AND idempotency_key=v_idempotency_key LIMIT 1;
        IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'status','success','book_id',v_existing::text,'idempotent',true,
          'current_book',jsonb_build_object('book_id',v_existing::text,'local_operator_id',v_operator,'title',v_existing_title)); END IF;
      END IF;
      IF v_constraint = 't_book_projects_operator_title_uq' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','DUPLICATE_TITLE','message','A book with this title already exists.')); END IF;
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','WRITE_FAILED','message','The book could not be created.'));
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','WRITE_FAILED','message','The book could not be created.'));
  END;
  RETURN jsonb_build_object('ok',true,'status','success','book_id',v_book_id::text,'idempotent',false,
    'current_book',jsonb_build_object('book_id',v_book_id::text,'local_operator_id',v_operator,'title',v_title));
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_create_book_project(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_book_project(jsonb) TO CURRENT_USER;
COMMIT;
