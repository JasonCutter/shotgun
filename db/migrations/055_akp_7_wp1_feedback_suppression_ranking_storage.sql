-- AKP-7 WP1: explicit feedback, suppression/snooze, and the durable
-- revision envelope for the existing server-global AKP-3 ranking policy.
-- These records are not Canonical, Evidence, Review, or Discovery Finding
-- state and are intentionally append-only.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '054_akp_5_wp3_persistent_review_bridge.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 055 preflight failed: 054 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS discovery;

CREATE TABLE IF NOT EXISTS discovery.feedback_events (
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  feedback_id text NOT NULL,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text NOT NULL,
  principal_id text,
  feedback_class text NOT NULL CHECK (feedback_class IN ('EPISTEMIC', 'UTILITY')),
  feedback_kind text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  scope_kind text CHECK (scope_kind IS NULL OR scope_kind IN ('FINDING', 'PROJECT')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, feedback_id),
  CONSTRAINT discovery_feedback_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_feedback_class_kind_ck CHECK (
    (feedback_class = 'EPISTEMIC' AND feedback_kind IN (
      'INCORRECT_RELATION', 'INSUFFICIENT_EVIDENCE', 'WRONG_ENTITY',
      'TEMPORAL_ERROR', 'MISLEADING_PATTERN', 'MISIDENTIFIED_CONFLICT'
    )) OR
    (feedback_class = 'UTILITY' AND feedback_kind IN (
      'USEFUL', 'NOT_RELEVANT', 'ALREADY_KNOWN', 'TOO_FREQUENT',
      'SNOOZE', 'SUPPRESS_EXACT', 'SUPPRESS_SIMILAR'
    ))
  )
);

CREATE INDEX IF NOT EXISTS discovery_feedback_finding_history_idx
  ON discovery.feedback_events (project_id, finding_id, finding_revision, created_at, feedback_id);

CREATE OR REPLACE FUNCTION discovery.block_feedback_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'discovery.feedback_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER discovery_feedback_events_append_only
  BEFORE UPDATE OR DELETE ON discovery.feedback_events
  FOR EACH ROW EXECUTE FUNCTION discovery.block_feedback_event_mutation();

CREATE TABLE IF NOT EXISTS discovery.suppression_directives (
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  suppression_id text NOT NULL,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text NOT NULL,
  principal_id text,
  source_finding_id text NOT NULL,
  source_finding_revision integer NOT NULL CHECK (source_finding_revision >= 1),
  suppression_kind text NOT NULL CHECK (
    suppression_kind IN ('SUPPRESS_EXACT', 'SUPPRESS_SIMILAR', 'SNOOZE')
  ),
  scope_kind text NOT NULL CHECK (scope_kind IN ('FINDING', 'PROJECT')),
  matcher_kind text NOT NULL CHECK (
    matcher_kind IN ('NONE', 'EXACT_FINGERPRINT', 'SEMANTIC_FAMILY')
  ),
  matcher_version text,
  fingerprint text,
  fingerprint_version text,
  expires_at timestamptz,
  review_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, suppression_id),
  CONSTRAINT discovery_suppression_finding_fk
    FOREIGN KEY (project_id, source_finding_id, source_finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_suppression_shape_ck CHECK (
    (
      suppression_kind = 'SNOOZE' AND matcher_kind = 'NONE'
      AND matcher_version IS NULL AND fingerprint IS NULL
      AND fingerprint_version IS NULL AND expires_at IS NOT NULL
    ) OR (
      suppression_kind = 'SUPPRESS_EXACT' AND matcher_kind = 'EXACT_FINGERPRINT'
      AND matcher_version IS NOT NULL AND fingerprint IS NOT NULL
      AND fingerprint_version IS NOT NULL
    ) OR (
      suppression_kind = 'SUPPRESS_SIMILAR' AND matcher_kind = 'SEMANTIC_FAMILY'
      AND matcher_version IS NOT NULL AND fingerprint IS NULL
      AND fingerprint_version IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS discovery_suppression_finding_idx
  ON discovery.suppression_directives (
    project_id, source_finding_id, source_finding_revision, created_at, suppression_id
  );
CREATE INDEX IF NOT EXISTS discovery_suppression_matcher_idx
  ON discovery.suppression_directives (
    project_id, principal_id, suppression_kind, matcher_kind, matcher_version,
    fingerprint_version, fingerprint
  );

CREATE OR REPLACE FUNCTION discovery.block_suppression_directive_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'discovery.suppression_directives is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER discovery_suppression_directives_append_only
  BEFORE UPDATE OR DELETE ON discovery.suppression_directives
  FOR EACH ROW EXECUTE FUNCTION discovery.block_suppression_directive_mutation();

-- AKP-3 currently has a server-global deterministic policy. Keep that scope
-- explicit so WP1 does not invent per-user or per-project customization.
CREATE TABLE IF NOT EXISTS discovery.ranking_policy_revisions (
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  policy_id text NOT NULL,
  policy_revision integer NOT NULL CHECK (policy_revision >= 1),
  policy_scope text NOT NULL CHECK (policy_scope = 'GLOBAL'),
  algorithm_version text NOT NULL CHECK (algorithm_version = 'discovery-ranking-policy:v1'),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'array'),
  weights jsonb NOT NULL CHECK (jsonb_typeof(weights) = 'object'),
  created_by_type text NOT NULL CHECK (created_by_type IN ('user', 'service', 'system')),
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL,
  effective_from timestamptz NOT NULL,
  PRIMARY KEY (policy_id, policy_revision)
);

CREATE INDEX IF NOT EXISTS discovery_ranking_policy_effective_idx
  ON discovery.ranking_policy_revisions (policy_id, effective_from DESC, policy_revision DESC);

CREATE OR REPLACE FUNCTION discovery.block_ranking_policy_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'discovery.ranking_policy_revisions is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER discovery_ranking_policy_revisions_append_only
  BEFORE UPDATE OR DELETE ON discovery.ranking_policy_revisions
  FOR EACH ROW EXECUTE FUNCTION discovery.block_ranking_policy_revision_mutation();
