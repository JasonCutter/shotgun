-- AKP-8 WP2R: governed typed-proposition conflict rules and rebuildable
-- incompatibility assertions. Existing Knowledge Model, Canonical and
-- frontend command ledgers remain the authorities for their own meanings.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '057_akp_7_wp4_epistemic_feedback_reentry.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 058 preflight failed: migration 057 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE IF NOT EXISTS knowledge.typed_proposition_conflict_rules (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  rule_id text NOT NULL,
  rule_revision integer NOT NULL CHECK (rule_revision >= 1),
  semantic_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED', 'SUPERSEDED')),
  rule jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, rule_id, rule_revision),
  CHECK (rule->>'schemaVersion' = '1.0.0'),
  CHECK (rule->>'participantBinding' = 'SAME_EXACT_ENDPOINT_PAIR'),
  CHECK (rule->>'kind' = 'FACTUAL'),
  CHECK (rule->>'source' = 'TYPED_PROPOSITION'),
  CHECK (rule->>'projectId' = project_id),
  CHECK ((rule->>'ruleRevision')::integer = rule_revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_typed_proposition_conflict_rules_active_key
  ON knowledge.typed_proposition_conflict_rules (project_id, semantic_key)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS knowledge_typed_proposition_conflict_rules_lifecycle_idx
  ON knowledge.typed_proposition_conflict_rules (project_id, rule_id, rule_revision DESC);

CREATE TABLE IF NOT EXISTS knowledge.typed_incompatibility_assertions (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  identity_key text NOT NULL,
  assertion_id text NOT NULL,
  assertion_revision integer NOT NULL CHECK (assertion_revision >= 1),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'RETIRED')),
  assertion jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, identity_key, assertion_revision),
  UNIQUE (project_id, assertion_id, assertion_revision),
  CHECK (assertion->>'schemaVersion' = '1.0.0'),
  CHECK (assertion->>'projectId' = project_id),
  CHECK (assertion->>'identityKey' = identity_key),
  CHECK (assertion->>'kind' = 'FACTUAL'),
  CHECK (assertion->>'source' = 'TYPED_PROPOSITION'),
  CHECK (assertion->>'sourceAuthorityId' = 'stage9.typed-proposition-conflict-evaluator'),
  CHECK (assertion->>'sourceAuthorityRevision' = '1.0.0'),
  CHECK ((assertion->>'assertionRevision')::integer = assertion_revision),
  CHECK (assertion->>'status' = status)
);

CREATE INDEX IF NOT EXISTS knowledge_typed_incompatibility_assertions_active_idx
  ON knowledge.typed_incompatibility_assertions (project_id, assertion_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_typed_incompatibility_assertions_active_identity_key
  ON knowledge.typed_incompatibility_assertions (project_id, identity_key)
  WHERE status = 'ACTIVE';
