-- Backend project fence only. No operating assembly/routing selection is changed.
CREATE TABLE surfer_rows.migration (
  space_id text NOT NULL,
  generation_id text NOT NULL CHECK(generation_id ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK(status IN ('COPYING','READY','ACTIVE','SUSPENDED','ABORTED')),
  cursor integer NOT NULL DEFAULT 0 CHECK(cursor>=0),
  total integer NOT NULL CHECK(total>=0 AND cursor<=total),
  manifest jsonb NOT NULL,
  digest text NOT NULL CHECK(digest ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY(space_id,generation_id)
);
CREATE TABLE surfer_rows.route (
  space_id text PRIMARY KEY,
  mode text NOT NULL CHECK(mode IN ('LEGACY','COPYING','ROWS','SUSPENDED','CONFLICT')),
  generation_id text,
  revision bigint NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY(space_id,generation_id) REFERENCES surfer_rows.migration(space_id,generation_id)
);
CREATE TABLE surfer_rows.stage (
  space_id text NOT NULL,
  generation_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal>=0),
  archive_record jsonb NOT NULL,
  archive_digest text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  target_revision bigint NOT NULL,
  target_payload jsonb NOT NULL,
  target_digest text NOT NULL,
  PRIMARY KEY(space_id,generation_id,ordinal),
  UNIQUE(space_id,generation_id,target_kind,target_id,target_revision),
  FOREIGN KEY(space_id,generation_id) REFERENCES surfer_rows.migration(space_id,generation_id)
);
CREATE TRIGGER surfer_stage_immutable BEFORE UPDATE OR DELETE ON surfer_rows.stage
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();

-- Preserve pre-upgrade projects. Mixed independent stores require explicit resolution.
INSERT INTO surfer_rows.route(space_id,mode)
SELECT space_id,CASE WHEN EXISTS(SELECT 1 FROM surfer_rows.space r WHERE r.space_id=l.space_id) THEN 'CONFLICT' ELSE 'LEGACY' END
FROM (SELECT space_id FROM surfer_knowledge.space_state UNION SELECT space_id FROM surfer_knowledge.source_binding_v2) l;
INSERT INTO surfer_rows.route(space_id,mode) SELECT space_id,'ROWS' FROM surfer_rows.space ON CONFLICT DO NOTHING;

-- BEFORE STATEMENT executes before target row locks. Cutover takes the exclusive counterpart.
CREATE FUNCTION surfer_rows.write_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('surfer-storage-cutover-v1',0));
  RETURN NULL;
END;
$$;
CREATE FUNCTION surfer_rows.check_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid text; selected text; initial text;
BEGIN
  sid := CASE WHEN TG_OP='DELETE' THEN OLD.space_id ELSE NEW.space_id END;
  IF TG_ARGV[0]='LEGACY' THEN
    initial := CASE WHEN EXISTS(SELECT 1 FROM surfer_rows.space WHERE space_id=sid) THEN 'ROWS' ELSE 'LEGACY' END;
  ELSE
    initial := CASE WHEN EXISTS(SELECT 1 FROM surfer_knowledge.space_state WHERE space_id=sid)
                     OR EXISTS(SELECT 1 FROM surfer_knowledge.source_binding_v2 WHERE space_id=sid) THEN 'LEGACY' ELSE 'ROWS' END;
  END IF;
  INSERT INTO surfer_rows.route(space_id,mode) VALUES(sid,initial) ON CONFLICT DO NOTHING;
  SELECT mode INTO selected FROM surfer_rows.route WHERE space_id=sid FOR SHARE;
  IF selected<>TG_ARGV[0] THEN
    RAISE EXCEPTION 'Surfer storage route % refuses % operation',selected,TG_ARGV[0] USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER surfer_legacy_gate BEFORE INSERT OR UPDATE OR DELETE ON surfer_knowledge.space_state FOR EACH STATEMENT EXECUTE FUNCTION surfer_rows.write_gate();
CREATE TRIGGER surfer_legacy_route BEFORE INSERT OR UPDATE OR DELETE ON surfer_knowledge.space_state FOR EACH ROW EXECUTE FUNCTION surfer_rows.check_route('LEGACY');
CREATE TRIGGER surfer_binding_gate BEFORE INSERT OR UPDATE OR DELETE ON surfer_knowledge.source_binding_v2 FOR EACH STATEMENT EXECUTE FUNCTION surfer_rows.write_gate();
CREATE TRIGGER surfer_binding_route BEFORE INSERT OR UPDATE OR DELETE ON surfer_knowledge.source_binding_v2 FOR EACH ROW EXECUTE FUNCTION surfer_rows.check_route('LEGACY');
CREATE TRIGGER surfer_row_space_gate BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.space FOR EACH STATEMENT EXECUTE FUNCTION surfer_rows.write_gate();
CREATE TRIGGER surfer_row_space_route BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.space FOR EACH ROW EXECUTE FUNCTION surfer_rows.check_route('ROWS');
CREATE TRIGGER surfer_row_record_gate BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.record FOR EACH STATEMENT EXECUTE FUNCTION surfer_rows.write_gate();
CREATE TRIGGER surfer_row_record_route BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.record FOR EACH ROW EXECUTE FUNCTION surfer_rows.check_route('ROWS');
CREATE TRIGGER surfer_row_capture_gate BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.source_capture FOR EACH STATEMENT EXECUTE FUNCTION surfer_rows.write_gate();
CREATE TRIGGER surfer_row_capture_route BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.source_capture FOR EACH ROW EXECUTE FUNCTION surfer_rows.check_route('ROWS');
CREATE TRIGGER surfer_row_binding_gate BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.source_binding FOR EACH STATEMENT EXECUTE FUNCTION surfer_rows.write_gate();
CREATE TRIGGER surfer_row_binding_route BEFORE INSERT OR UPDATE OR DELETE ON surfer_rows.source_binding FOR EACH ROW EXECUTE FUNCTION surfer_rows.check_route('ROWS');
