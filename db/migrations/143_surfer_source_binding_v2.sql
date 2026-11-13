-- Sidecar v2 Source-binding semantics; v1 state and readers remain intact.
CREATE TABLE IF NOT EXISTS surfer_knowledge.source_binding_v2 (
  space_id text PRIMARY KEY CHECK (length(space_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (payload->>'spaceId' = space_id),
  CHECK (payload->>'schemaVersion' = '2.0.0'),
  CHECK ((payload->>'sequence')::bigint = revision)
);
