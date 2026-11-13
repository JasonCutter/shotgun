-- Explicit opt-in row Source profile; existing v2 aggregate/routing is unchanged.
CREATE TABLE surfer_rows.source_capture (
  space_id text NOT NULL REFERENCES surfer_rows.space(space_id),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  PRIMARY KEY(space_id,content_digest),
  UNIQUE(space_id,receipt_digest)
);
CREATE TABLE surfer_rows.source_binding (
  space_id text NOT NULL REFERENCES surfer_rows.space(space_id),
  artifact_id text NOT NULL CHECK(length(artifact_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  digest text NOT NULL CHECK(digest ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY(space_id,artifact_id,revision)
);
CREATE TRIGGER surfer_rows_capture_immutable BEFORE UPDATE OR DELETE ON surfer_rows.source_capture
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
CREATE TRIGGER surfer_rows_binding_immutable BEFORE UPDATE OR DELETE ON surfer_rows.source_binding
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
