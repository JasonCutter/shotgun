-- Stage 4 structured-output provenance correction.
--
-- Provider outputs are raw/audit records and remain immutable except for the
-- server-owned validation promotion performed atomically by acceptOutput().
-- The original append-only trigger rejected that one required transition.
CREATE OR REPLACE FUNCTION ai.reject_provider_output_change() RETURNS trigger AS $$
BEGIN
  IF NEW.structured_output_valid = TRUE
     AND OLD.structured_output_valid IN (TRUE, FALSE)
     AND (to_jsonb(NEW) - 'structured_output_valid') =
         (to_jsonb(OLD) - 'structured_output_valid') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai.provider_outputs is append-only except for validation promotion';
END;
$$ LANGUAGE plpgsql;
