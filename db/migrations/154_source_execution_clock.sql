-- Preserve historical origin timestamps and transition guards. NULL on old
-- rows means that the actual DB wall-clock of their last write is unknown.
ALTER TABLE source_product.source_stage3_progress ADD COLUMN db_transition_at timestamptz;
ALTER TABLE evidence.stage4_continuations ADD COLUMN db_transition_at timestamptz;

CREATE FUNCTION source_product.record_execution_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  NEW.db_transition_at := clock_timestamp();
  IF TG_OP='UPDATE' THEN
    NEW.updated_at := GREATEST(OLD.updated_at, NEW.created_at, NEW.db_transition_at);
    IF TG_TABLE_SCHEMA='evidence' AND TG_TABLE_NAME='stage4_continuations' THEN
      IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
        NEW.completed_at := GREATEST(NEW.completed_at, NEW.created_at, NEW.updated_at);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- PostgreSQL executes same-kind triggers by name. Timestamp normalization runs
-- after the existing stage3 state/image binding guard; no state rule is copied.
CREATE TRIGGER zz_source_execution_clock BEFORE INSERT OR UPDATE
ON source_product.source_stage3_progress FOR EACH ROW
EXECUTE FUNCTION source_product.record_execution_clock();
CREATE TRIGGER zz_source_execution_clock BEFORE INSERT OR UPDATE
ON evidence.stage4_continuations FOR EACH ROW
EXECUTE FUNCTION source_product.record_execution_clock();
COMMENT ON COLUMN source_product.source_stage3_progress.db_transition_at IS
 'Actual DB wall-clock of the last insert/update;NULL means historical time unknown. updated_at remains logical monotonic origin-compatible metadata.';
COMMENT ON COLUMN evidence.stage4_continuations.db_transition_at IS
 'Actual DB wall-clock of the last insert/update;NULL means historical time unknown. updated_at/completed_at preserve origin-compatible logical ordering.';
