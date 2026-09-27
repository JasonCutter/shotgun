-- Legacy test fixtures truncate upstream tables with CASCADE. PostgreSQL
-- invokes the VP statement trigger even when the dependent ledger is empty.
-- Empty truncation changes no history; a populated ledger remains protected.
CREATE OR REPLACE FUNCTION vp.reject_ledger_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  contains_history boolean;
BEGIN
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.%I)',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME
  ) INTO contains_history;
  IF contains_history THEN
    RAISE EXCEPTION 'VP ledger % cannot be truncated', TG_TABLE_NAME;
  END IF;
  RETURN NULL;
END
$$;
