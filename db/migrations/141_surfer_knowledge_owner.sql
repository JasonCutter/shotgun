-- Surfer SF-01 isolated owner. No Source/VP/Canonical table changes.
CREATE SCHEMA IF NOT EXISTS surfer_knowledge;
CREATE TABLE IF NOT EXISTS surfer_knowledge.space_state (
    space_id text PRIMARY KEY CHECK (length(space_id) BETWEEN 1 AND 256),
    revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
    CHECK (payload->>'spaceId' = space_id),
    CHECK (payload->>'schemaVersion' = '1.0.0'),
    CHECK ((payload->>'sequence')::bigint = revision)
);
