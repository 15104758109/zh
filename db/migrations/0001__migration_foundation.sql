CREATE TABLE runtime_runs (
  run_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE audit_attempt_log (
  audit_attempt_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runtime_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE idempotency_keys (
  idempotency_key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
