CREATE TABLE zhreplan.local_operators (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  local_operator_id text NOT NULL UNIQUE CHECK (local_operator_id ~ '^operator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION zhreplan.reject_local_operator_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'local operator is immutable';
END;
$$;

CREATE TRIGGER local_operators_reject_update
BEFORE UPDATE ON zhreplan.local_operators
FOR EACH ROW EXECUTE FUNCTION zhreplan.reject_local_operator_mutation();

CREATE TRIGGER local_operators_reject_delete
BEFORE DELETE ON zhreplan.local_operators
FOR EACH ROW EXECUTE FUNCTION zhreplan.reject_local_operator_mutation();
