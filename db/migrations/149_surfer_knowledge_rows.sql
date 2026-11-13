-- Isolated Core profile only. Existing aggregate/Source routing stays unchanged.
CREATE SCHEMA IF NOT EXISTS surfer_rows;
CREATE TABLE surfer_rows.space (
  space_id text PRIMARY KEY CHECK (length(space_id) BETWEEN 1 AND 256),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991),
  payload jsonb NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (payload->>'contract' = 'surfer.knowledge-rows.v1'),
  CHECK (payload->>'spaceId' = space_id),
  CHECK ((payload->>'sequence')::bigint = sequence)
);
CREATE TABLE surfer_rows.record (
  space_id text NOT NULL REFERENCES surfer_rows.space(space_id),
  kind text NOT NULL CHECK (kind IN ('INPUT','ARTIFACT','EPOCH','SNAPSHOT','COMMAND')),
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY (space_id,kind,record_id,revision)
);
CREATE UNIQUE INDEX surfer_rows_operation_identity ON surfer_rows.record(space_id,record_id) WHERE kind='COMMAND';
CREATE UNIQUE INDEX surfer_rows_operation_sequence ON surfer_rows.record(space_id,revision) WHERE kind='COMMAND';
CREATE TRIGGER surfer_rows_record_immutable BEFORE UPDATE OR DELETE ON surfer_rows.record
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
