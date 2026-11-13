-- Additive shadow storage only. No routing/activation change and no destructive down migration.
CREATE SCHEMA IF NOT EXISTS surfer_history;
CREATE TABLE surfer_history.generation (
  space_id text NOT NULL CHECK (length(space_id) BETWEEN 1 AND 256),
  generation_id text NOT NULL CHECK (generation_id ~ '^sha256:[a-f0-9]{64}$'),
  mode text NOT NULL DEFAULT 'SHADOW_ONLY' CHECK (mode = 'SHADOW_ONLY'),
  status text NOT NULL CHECK (status IN ('COPYING', 'SEALED', 'SUSPENDED')),
  verified boolean NOT NULL DEFAULT false,
  cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  total integer NOT NULL CHECK (total >= 0 AND cursor <= total),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY (space_id, generation_id),
  CHECK (manifest->>'spaceId' = space_id),
  CHECK (manifest->>'purpose' = 'HISTORICAL_ONLY'),
  CHECK (NOT verified OR cursor = total),
  CHECK (status <> 'SEALED' OR verified),
  CHECK (manifest->>'contract' = 'surfer.history-archive.v1')
);
CREATE TABLE surfer_history.record (
  space_id text NOT NULL,
  generation_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  kind text NOT NULL CHECK (kind IN ('INPUT','ARTIFACT','EPOCH','SNAPSHOT','COMMAND','BINDING','CAPTURE','WATERMARK')),
  record_key text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  PRIMARY KEY (space_id, generation_id, ordinal),
  UNIQUE (space_id, generation_id, kind, record_key),
  FOREIGN KEY (space_id, generation_id) REFERENCES surfer_history.generation(space_id, generation_id)
);
-- Runtime owner has only insert/read operations on record. Block accidental SQL UPDATE/DELETE too.
CREATE FUNCTION surfer_history.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Surfer history records are immutable'; END;
$$;
CREATE TRIGGER surfer_history_record_immutable BEFORE UPDATE OR DELETE ON surfer_history.record
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
