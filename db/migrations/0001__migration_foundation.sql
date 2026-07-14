CREATE TABLE zhreplan.runtime_runs (
  run_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE zhreplan.audit_attempt_log (
  audit_attempt_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES zhreplan.runtime_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE zhreplan.idempotency_keys (
  idempotency_key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
