CREATE TABLE zhreplan.runtime_write_locks (
  local_operator_id text NOT NULL REFERENCES zhreplan.local_operators(local_operator_id),
  book_id text NOT NULL CHECK (book_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  holder_token text NOT NULL UNIQUE CHECK (holder_token ~ '^[0-9a-f]{64}$'),
  fence_version bigint NOT NULL CHECK (fence_version > 0),
  lease_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (local_operator_id, book_id)
);

CREATE TABLE zhreplan.runtime_idempotency_ledger (
  idempotency_key text PRIMARY KEY CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  local_operator_id text NOT NULL REFERENCES zhreplan.local_operators(local_operator_id),
  book_id text NOT NULL CHECK (book_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  operation text NOT NULL CHECK (operation ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'finalized')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz
);

CREATE TABLE zhreplan.runtime_guarded_state (
  local_operator_id text NOT NULL REFERENCES zhreplan.local_operators(local_operator_id),
  book_id text NOT NULL CHECK (book_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  entity_id text NOT NULL CHECK (entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  state_version bigint NOT NULL CHECK (state_version > 0),
  state_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (local_operator_id, book_id, entity_id)
);

CREATE TABLE zhreplan.runtime_guard_audit_log (
  audit_id text PRIMARY KEY CHECK (audit_id ~ '^[0-9a-f]{64}$'),
  local_operator_id text NOT NULL REFERENCES zhreplan.local_operators(local_operator_id),
  book_id text NOT NULL CHECK (book_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  entity_id text NOT NULL CHECK (entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  idempotency_key text NOT NULL REFERENCES zhreplan.runtime_idempotency_ledger(idempotency_key),
  state_version bigint NOT NULL CHECK (state_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX runtime_write_locks_active_idx ON zhreplan.runtime_write_locks (lease_expires_at);
CREATE INDEX runtime_guarded_state_book_idx ON zhreplan.runtime_guarded_state (local_operator_id, book_id, entity_id);
CREATE INDEX runtime_guard_audit_book_idx ON zhreplan.runtime_guard_audit_log (local_operator_id, book_id, created_at);

CREATE FUNCTION zhreplan.runtime_guard_acquire(
  p_local_operator_id text,
  p_book_id text,
  p_ttl_seconds integer
) RETURNS TABLE(code text, fence_version bigint, holder_token text, lease_expires_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_token text := md5(random()::text || clock_timestamp()::text || pg_backend_pid()::text)
    || md5(random()::text || clock_timestamp()::text || txid_current()::text);
BEGIN
  IF p_ttl_seconds < 1 OR p_ttl_seconds > 300 THEN
    RETURN QUERY SELECT 'INPUT_INVALID'::text, NULL::bigint, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  RETURN QUERY
  WITH acquired AS (
    INSERT INTO zhreplan.runtime_write_locks AS locks
      (local_operator_id, book_id, holder_token, fence_version, lease_expires_at)
    VALUES (p_local_operator_id, p_book_id, v_token, 1, clock_timestamp() + make_interval(secs => p_ttl_seconds))
    ON CONFLICT (local_operator_id, book_id) DO UPDATE
      SET holder_token = EXCLUDED.holder_token,
          fence_version = locks.fence_version + 1,
          lease_expires_at = EXCLUDED.lease_expires_at,
          updated_at = clock_timestamp()
      WHERE locks.lease_expires_at <= clock_timestamp()
    RETURNING locks.fence_version, locks.holder_token, locks.lease_expires_at
  )
  SELECT COALESCE('LOCK_ACQUIRED', 'LOCK_CONFLICT'), acquired.fence_version, acquired.holder_token, acquired.lease_expires_at
  FROM acquired
  UNION ALL
  SELECT 'LOCK_CONFLICT', NULL, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM acquired);
END;
$$;

CREATE FUNCTION zhreplan.runtime_guard_renew(
  p_local_operator_id text, p_book_id text, p_holder_token text, p_fence_version bigint, p_ttl_seconds integer
) RETURNS TABLE(code text, lease_expires_at timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_ttl_seconds < 1 OR p_ttl_seconds > 300 THEN
    RETURN QUERY SELECT 'INPUT_INVALID'::text, NULL::timestamptz;
    RETURN;
  END IF;
  RETURN QUERY
  WITH renewed AS (
    UPDATE zhreplan.runtime_write_locks AS locks
    SET lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds), updated_at = clock_timestamp()
    WHERE locks.local_operator_id = p_local_operator_id AND locks.book_id = p_book_id
      AND locks.holder_token = p_holder_token AND locks.fence_version = p_fence_version
      AND locks.lease_expires_at > clock_timestamp()
    RETURNING locks.lease_expires_at AS renewed_lease_expires_at
  )
  SELECT 'LOCK_RENEWED', renewed.renewed_lease_expires_at FROM renewed
  UNION ALL SELECT 'LOCK_CONFLICT', NULL WHERE NOT EXISTS (SELECT 1 FROM renewed);
END;
$$;

CREATE FUNCTION zhreplan.runtime_guard_validate(
  p_local_operator_id text, p_book_id text, p_holder_token text, p_fence_version bigint
) RETURNS TABLE(code text)
LANGUAGE sql
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM zhreplan.runtime_write_locks
    WHERE local_operator_id = p_local_operator_id AND book_id = p_book_id
      AND holder_token = p_holder_token AND fence_version = p_fence_version
      AND lease_expires_at > clock_timestamp()
  ) THEN 'LOCK_VALID' ELSE 'LOCK_CONFLICT' END;
$$;

CREATE FUNCTION zhreplan.runtime_guard_release(
  p_local_operator_id text, p_book_id text, p_holder_token text, p_fence_version bigint
) RETURNS TABLE(code text)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE zhreplan.runtime_write_locks
  SET lease_expires_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE local_operator_id = p_local_operator_id AND book_id = p_book_id
    AND holder_token = p_holder_token AND fence_version = p_fence_version
    AND lease_expires_at > clock_timestamp();
  RETURN QUERY SELECT CASE WHEN FOUND THEN 'LOCK_RELEASED' ELSE 'LOCK_CONFLICT' END;
END;
$$;

CREATE FUNCTION zhreplan.runtime_guard_claim(
  p_local_operator_id text, p_book_id text, p_operation text, p_idempotency_key text, p_payload jsonb
) RETURNS TABLE(code text, result jsonb)
LANGUAGE plpgsql
AS $$
DECLARE v_row zhreplan.runtime_idempotency_ledger%ROWTYPE; v_inserted boolean;
BEGIN
  WITH inserted AS (
    INSERT INTO zhreplan.runtime_idempotency_ledger
    (idempotency_key, local_operator_id, book_id, operation, payload, status)
    VALUES (p_idempotency_key, p_local_operator_id, p_book_id, p_operation, p_payload, 'claimed')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING idempotency_key
  )
  SELECT EXISTS (SELECT 1 FROM inserted) INTO v_inserted;
  SELECT * INTO v_row FROM zhreplan.runtime_idempotency_ledger WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF v_row.local_operator_id <> p_local_operator_id OR v_row.book_id <> p_book_id
    OR v_row.operation <> p_operation OR v_row.payload <> p_payload THEN
    RETURN QUERY SELECT 'IDEMPOTENCY_CONFLICT'::text, NULL::jsonb;
  ELSIF v_row.status = 'finalized' THEN
    RETURN QUERY SELECT 'IDEMPOTENCY_REPLAY'::text, v_row.result;
  ELSE
    RETURN QUERY SELECT CASE WHEN v_inserted THEN 'IDEMPOTENCY_CLAIMED' ELSE 'IDEMPOTENCY_PENDING' END, NULL::jsonb;
  END IF;
END;
$$;

CREATE FUNCTION zhreplan.runtime_guard_finalize(
  p_local_operator_id text, p_book_id text, p_operation text, p_idempotency_key text, p_payload jsonb, p_result jsonb
) RETURNS TABLE(code text, result jsonb)
LANGUAGE plpgsql
AS $$
DECLARE v_row zhreplan.runtime_idempotency_ledger%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM zhreplan.runtime_idempotency_ledger WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR v_row.local_operator_id <> p_local_operator_id OR v_row.book_id <> p_book_id
    OR v_row.operation <> p_operation OR v_row.payload <> p_payload THEN
    RETURN QUERY SELECT 'IDEMPOTENCY_CONFLICT'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_row.status = 'finalized' THEN
    RETURN QUERY SELECT 'IDEMPOTENCY_REPLAY'::text, v_row.result;
    RETURN;
  END IF;
  UPDATE zhreplan.runtime_idempotency_ledger
  SET status = 'finalized', result = p_result, finalized_at = clock_timestamp()
  WHERE idempotency_key = p_idempotency_key;
  RETURN QUERY SELECT 'IDEMPOTENCY_FINALIZED'::text, p_result;
END;
$$;

CREATE FUNCTION zhreplan.runtime_guarded_write(
  p_local_operator_id text, p_book_id text, p_entity_id text, p_expected_version bigint,
  p_holder_token text, p_fence_version bigint, p_operation text, p_idempotency_key text,
  p_payload jsonb, p_state_value jsonb, p_result jsonb, p_fault_stage text DEFAULT NULL
) RETURNS TABLE(code text, state_version bigint, result jsonb)
LANGUAGE plpgsql
AS $$
DECLARE v_idempotency zhreplan.runtime_idempotency_ledger%ROWTYPE; v_state_version bigint; v_audit_id text;
BEGIN
  IF p_fault_stage IS NOT NULL AND p_fault_stage NOT IN ('after_claim', 'after_state', 'after_audit', 'after_finalize') THEN
    RETURN QUERY SELECT 'INPUT_INVALID'::text, NULL::bigint, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM 1 FROM zhreplan.runtime_write_locks
  WHERE local_operator_id = p_local_operator_id AND book_id = p_book_id
    AND holder_token = p_holder_token AND fence_version = p_fence_version
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'LOCK_CONFLICT'::text, NULL::bigint, NULL::jsonb;
    RETURN;
  END IF;
  INSERT INTO zhreplan.runtime_idempotency_ledger
    (idempotency_key, local_operator_id, book_id, operation, payload, status)
  VALUES (p_idempotency_key, p_local_operator_id, p_book_id, p_operation, p_payload, 'claimed')
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT * INTO v_idempotency FROM zhreplan.runtime_idempotency_ledger WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF v_idempotency.local_operator_id <> p_local_operator_id OR v_idempotency.book_id <> p_book_id
    OR v_idempotency.operation <> p_operation OR v_idempotency.payload <> p_payload THEN
    RETURN QUERY SELECT 'IDEMPOTENCY_CONFLICT'::text, NULL::bigint, NULL::jsonb;
    RETURN;
  ELSIF v_idempotency.status = 'finalized' THEN
    RETURN QUERY SELECT 'IDEMPOTENCY_REPLAY'::text, NULL::bigint, v_idempotency.result;
    RETURN;
  END IF;
  IF p_fault_stage = 'after_claim' THEN RAISE EXCEPTION 'GUARD_TRANSACTION_FAILED'; END IF;
  IF p_expected_version = 0 THEN
    INSERT INTO zhreplan.runtime_guarded_state (local_operator_id, book_id, entity_id, state_version, state_value)
    VALUES (p_local_operator_id, p_book_id, p_entity_id, 1, p_state_value)
    ON CONFLICT (local_operator_id, book_id, entity_id) DO NOTHING
    RETURNING runtime_guarded_state.state_version INTO v_state_version;
  ELSE
    UPDATE zhreplan.runtime_guarded_state SET state_version = state_version + 1, state_value = p_state_value, updated_at = clock_timestamp()
    WHERE local_operator_id = p_local_operator_id AND book_id = p_book_id AND entity_id = p_entity_id
      AND state_version = p_expected_version
    RETURNING runtime_guarded_state.state_version INTO v_state_version;
  END IF;
  IF v_state_version IS NULL THEN
    RAISE EXCEPTION 'GUARD_STALE_VERSION';
  END IF;
  IF p_fault_stage = 'after_state' THEN RAISE EXCEPTION 'GUARD_TRANSACTION_FAILED'; END IF;
  v_audit_id := md5(random()::text || clock_timestamp()::text || pg_backend_pid()::text)
    || md5(random()::text || clock_timestamp()::text || txid_current()::text);
  INSERT INTO zhreplan.runtime_guard_audit_log
    (audit_id, local_operator_id, book_id, entity_id, idempotency_key, state_version)
  VALUES (v_audit_id, p_local_operator_id, p_book_id, p_entity_id, p_idempotency_key, v_state_version);
  IF p_fault_stage = 'after_audit' THEN RAISE EXCEPTION 'GUARD_TRANSACTION_FAILED'; END IF;
  UPDATE zhreplan.runtime_idempotency_ledger
  SET status = 'finalized', result = p_result, finalized_at = clock_timestamp()
  WHERE idempotency_key = p_idempotency_key;
  IF p_fault_stage = 'after_finalize' THEN RAISE EXCEPTION 'GUARD_TRANSACTION_FAILED'; END IF;
  RETURN QUERY SELECT 'CAS_APPLIED'::text, v_state_version, p_result;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'GUARD_STALE_VERSION' THEN
      RETURN QUERY SELECT 'STALE_VERSION'::text, NULL::bigint, NULL::jsonb;
      RETURN;
    END IF;
    RAISE;
END;
$$;
