-- Workbench configuration is intentionally isolated from n8n's own database.
DO $$ BEGIN
  IF current_database() NOT IN ('zh_narrative', 'zh_narrative_test') THEN
    RAISE EXCEPTION 'WORKBENCH_INSTALL_DATABASE_NOT_ALLOWED';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.t_workbench_config_versions (
  config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_operator_id text NOT NULL,
  book_id uuid NULL REFERENCES public.t_book_projects(book_id) ON DELETE CASCADE,
  config_kind text NOT NULL CHECK (config_kind IN ('prompt','model','budget','automation','presentation')),
  scope text NOT NULL CHECK (scope IN ('operator','book')),
  effective_value jsonb NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (local_operator_id, book_id, config_kind, version)
);
CREATE INDEX IF NOT EXISTS t_workbench_config_active_idx
  ON public.t_workbench_config_versions(local_operator_id, book_id, config_kind)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.rpc_workbench(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_action text := p_request->>'action';
  v_operator text := p_request->>'local_operator_id';
  v_book uuid;
  v_items jsonb := COALESCE(p_request->'items', '[]'::jsonb);
  v_item jsonb;
  v_kind text;
  v_scope text;
  v_value jsonb;
  v_next integer;
  v_books jsonb;
  v_config jsonb;
  v_prompt text;
  v_provider text;
  v_model text;
  v_budget integer;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' OR v_operator IS NULL OR v_operator !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','Request could not be accepted.'));
  END IF;
  IF p_request ? 'book_id' AND NULLIF(p_request->>'book_id','') IS NOT NULL THEN
    BEGIN v_book := (p_request->>'book_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','Request could not be accepted.'));
    END;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('book_id', book_id, 'title', book_name, 'genre', genre_main, 'stage', stage_code) ORDER BY updated_at DESC), '[]'::jsonb)
    INTO v_books FROM public.t_book_projects WHERE local_operator_id = v_operator;
  IF v_action = 'load' THEN
    IF v_book IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.t_book_projects WHERE book_id=v_book AND local_operator_id=v_operator) THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','BOOK_NOT_FOUND','message','The selected book is unavailable.'));
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', k.kind, 'scope', c.scope, 'effective_value', c.effective_value, 'source_config_id', c.config_id, 'version', c.version) ORDER BY k.kind), '[]'::jsonb)
      INTO v_config
      FROM (VALUES ('prompt'),('model'),('budget'),('automation'),('presentation')) AS k(kind)
      LEFT JOIN LATERAL (
        SELECT * FROM public.t_workbench_config_versions w
        WHERE w.local_operator_id=v_operator AND w.config_kind=k.kind AND w.status='active'
          AND ((v_book IS NOT NULL AND w.book_id=v_book) OR (w.book_id IS NULL))
        ORDER BY (w.book_id IS NOT NULL) DESC, w.version DESC LIMIT 1
      ) c ON true;
    RETURN jsonb_build_object('ok', true, 'state', CASE WHEN jsonb_array_length(v_books)=0 THEN 'empty' ELSE 'ready' END,
      'local_operator_id',v_operator,'current_book_id',v_book,'books',v_books,'config',v_config,
      'maturity',jsonb_build_object('automation_ready',false),'correlation_id',gen_random_uuid()::text);
  END IF;
  IF v_action <> 'save' OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) <> 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','Request could not be accepted.'));
  END IF;
  IF v_book IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.t_book_projects WHERE book_id=v_book AND local_operator_id=v_operator) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','BOOK_NOT_FOUND','message','The selected book is unavailable.'));
  END IF;
  IF (SELECT count(DISTINCT item->>'kind') FROM jsonb_array_elements(v_items) item) <> 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','Request could not be accepted.'));
  END IF;
  -- Validate the complete command before changing any active version.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_kind := v_item->>'kind'; v_scope := v_item->>'scope'; v_value := v_item->'effective_value';
    IF v_kind NOT IN ('prompt','model','budget','automation','presentation') OR v_scope NOT IN ('operator','book') OR v_value IS NULL OR (v_scope='book' AND v_book IS NULL) THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code','INVALID_REQUEST','message','Request could not be accepted.'));
    END IF;
    IF v_kind='prompt' THEN
      v_prompt := trim(v_value->>'text');
      IF COALESCE(length(v_prompt),0)=0 THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','PROMPT_REQUIRED','message','A prompt is required.')); END IF;
    ELSIF v_kind='model' THEN
      v_provider := trim(v_value->>'provider'); v_model := trim(v_value->>'model');
      IF COALESCE((v_value->>'connection_tested')::boolean,false) IS NOT TRUE OR v_provider='' OR v_model='' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','CONNECTION_TEST_REQUIRED','message','Test the configured connection before saving model settings.')); END IF;
    ELSIF v_kind='budget' THEN
      v_budget := COALESCE((v_value->>'max_tokens')::integer,0);
      IF v_budget < 1 THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','BUDGET_REQUIRED','message','A positive token budget is required.')); END IF;
    ELSIF v_kind='automation' AND (COALESCE((v_value->>'production')::boolean,false) OR COALESCE((v_value->>'audit')::boolean,false) OR COALESCE((v_value->>'iteration')::boolean,false)) THEN
      RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','AUTOMATION_NOT_READY','message','Automation remains disabled until maturity is approved.'));
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtext(v_operator || ':' || COALESCE(v_book::text,'operator')));
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_kind := v_item->>'kind'; v_scope := v_item->>'scope'; v_value := v_item->'effective_value';
    UPDATE public.t_workbench_config_versions SET status='superseded'
      WHERE local_operator_id=v_operator AND book_id IS NOT DISTINCT FROM CASE WHEN v_scope='book' THEN v_book ELSE NULL END AND config_kind=v_kind AND status='active';
    SELECT COALESCE(max(version),0)+1 INTO v_next FROM public.t_workbench_config_versions WHERE local_operator_id=v_operator AND book_id IS NOT DISTINCT FROM CASE WHEN v_scope='book' THEN v_book ELSE NULL END AND config_kind=v_kind;
    INSERT INTO public.t_workbench_config_versions(local_operator_id,book_id,config_kind,scope,effective_value,version)
      VALUES(v_operator,CASE WHEN v_scope='book' THEN v_book ELSE NULL END,v_kind,v_scope,v_value,v_next);
  END LOOP;
  -- ZH01 reads this existing active projection before its first model call.
  PERFORM set_config('zh.bypass_rpc','true',true);
  UPDATE public.t_prompt_configs SET status='archived'
    WHERE status='active' AND node_code='FP001-03' AND book_id IS NOT DISTINCT FROM v_book;
  INSERT INTO public.t_prompt_configs(book_id,node_code,provider_name,model_name,max_tokens,prompt,version_no,status,created_by,updated_by)
    VALUES(v_book,'FP001-03',v_provider,v_model,v_budget,v_prompt,COALESCE((SELECT max(version_no) FROM public.t_prompt_configs WHERE node_code='FP001-03' AND book_id IS NOT DISTINCT FROM v_book),0)+1,'active',v_operator::uuid,v_operator::uuid);
  RETURN public.rpc_workbench(jsonb_build_object('action','load','local_operator_id',v_operator,'book_id',v_book));
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','WORKBENCH_UNAVAILABLE','message','Configuration could not be saved.'));
END $$;
