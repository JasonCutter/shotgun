-- Issue #203 / ADR-160 WP2: additive v2 Comparison persistence.
--
-- The historical comparison.results and review tables are intentionally not
-- altered.  v2 analysis attempts may exist before a completed Comparison, so
-- analysis_revisions_v2 deliberately does not FK comparison_id to results_v2;
-- the completed aggregate transaction binds the rows through its identity and
-- the relationship table uses project-scoped FKs to the completed aggregate.

DO $$
BEGIN
  IF to_regclass('candidate.claim_candidates') IS NULL THEN
    RAISE EXCEPTION 'Migration 066 preflight failed: candidate.claim_candidates is missing';
  END IF;
END
$$;

-- The candidate_id primary key is globally unique today.  This additive key
-- is required to enforce project + candidate scope in composite foreign keys
-- without changing Candidate ownership or historical rows.
CREATE UNIQUE INDEX IF NOT EXISTS claim_candidates_project_candidate_uq
  ON candidate.claim_candidates (project_id, candidate_id);

CREATE SCHEMA IF NOT EXISTS comparison;

CREATE TABLE IF NOT EXISTS comparison.results_v2 (
  comparison_id text PRIMARY KEY,
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  candidate_id uuid NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_version_id uuid NOT NULL,
  snapshot_id text NOT NULL CHECK (length(btrim(snapshot_id)) > 0),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  disposition text NOT NULL CHECK (
    disposition IN (
      'NEW', 'EXACT_DUPLICATE', 'REVIEW_REQUIRED', 'ANALYSIS_PENDING',
      'SEMANTIC_UNAVAILABLE', 'POLICY_BLOCKED', 'STALE'
    )
  ),
  review_recommendation text NOT NULL CHECK (
    review_recommendation IN ('NO_OP', 'ADD_CLAIM', 'MODIFY_REVIEW', 'HOLD')
  ),
  comparison_mode text NOT NULL CHECK (
    comparison_mode IN ('DETERMINISTIC_EXACT', 'SEMANTIC')
  ),
  exact_duplicate_claim_id text,
  exact_duplicate_claim_revision integer CHECK (
    exact_duplicate_claim_revision IS NULL OR exact_duplicate_claim_revision > 0
  ),
  shortlist_digest text CHECK (
    shortlist_digest IS NULL OR shortlist_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  analysis_input_set_digest text CHECK (
    analysis_input_set_digest IS NULL OR analysis_input_set_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  logical_identity_digest text NOT NULL CHECK (logical_identity_digest ~ '^sha256:[a-f0-9]{64}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, comparison_id),
  UNIQUE (project_id, logical_identity_digest),
  CONSTRAINT results_v2_candidate_scope_fk
    FOREIGN KEY (project_id, candidate_id)
    REFERENCES candidate.claim_candidates (project_id, candidate_id)
    ON DELETE RESTRICT,
  CONSTRAINT results_v2_mode_identity_ck CHECK (
    (comparison_mode = 'DETERMINISTIC_EXACT'
      AND exact_duplicate_claim_id IS NOT NULL
      AND exact_duplicate_claim_revision IS NOT NULL
      AND shortlist_digest IS NULL
      AND analysis_input_set_digest IS NULL)
    OR
    (comparison_mode = 'SEMANTIC'
      AND exact_duplicate_claim_id IS NULL
      AND exact_duplicate_claim_revision IS NULL
      AND shortlist_digest IS NOT NULL
      AND analysis_input_set_digest IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS results_v2_candidate_idx
  ON comparison.results_v2 (project_id, candidate_id, candidate_revision, created_at DESC);

CREATE TABLE IF NOT EXISTS comparison.analysis_revisions_v2 (
  analysis_revision_id text PRIMARY KEY,
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  comparison_id text NOT NULL CHECK (length(btrim(comparison_id)) > 0),
  candidate_id uuid NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_source_version_id uuid NOT NULL,
  candidate_evidence_ids text[] NOT NULL CHECK (cardinality(candidate_evidence_ids) > 0),
  snapshot_id text NOT NULL CHECK (length(btrim(snapshot_id)) > 0),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  shortlist_digest text NOT NULL CHECK (shortlist_digest ~ '^sha256:[a-f0-9]{64}$'),
  compared_resource_types text[] NOT NULL DEFAULT '{}' CHECK (
    compared_resource_types <@ ARRAY['CLAIM']::text[]
  ),
  compared_resource_identities jsonb NOT NULL CHECK (jsonb_typeof(compared_resource_identities) = 'array'),
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) > 0),
  model_id text NOT NULL CHECK (length(btrim(model_id)) > 0),
  capability_id text NOT NULL CHECK (length(btrim(capability_id)) > 0),
  credential_revision_ref text NOT NULL CHECK (length(btrim(credential_revision_ref)) > 0),
  prompt_template_revision text NOT NULL CHECK (length(btrim(prompt_template_revision)) > 0),
  output_schema_revision text NOT NULL CHECK (length(btrim(output_schema_revision)) > 0),
  semantic_policy_revision text NOT NULL CHECK (length(btrim(semantic_policy_revision)) > 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  state text NOT NULL CHECK (
    state IN ('PENDING', 'ANALYZING', 'COMPLETED', 'SEMANTIC_UNAVAILABLE',
      'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'POLICY_BLOCKED')
  ),
  outcome text CHECK (
    outcome IS NULL OR outcome IN ('COMPLETED', 'SEMANTIC_UNAVAILABLE',
      'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'POLICY_BLOCKED')
  ),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms numeric CHECK (duration_ms IS NULL OR duration_ms >= 0),
  output_digest text CHECK (output_digest IS NULL OR output_digest ~ '^sha256:[a-f0-9]{64}$'),
  material_digest text CHECK (material_digest IS NULL OR material_digest ~ '^sha256:[a-f0-9]{64}$'),
  safe_failure_code text,
  analysis_json jsonb NOT NULL CHECK (jsonb_typeof(analysis_json) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, analysis_revision_id),
  UNIQUE (project_id, candidate_id, candidate_revision, snapshot_digest, input_digest, attempt),
  CONSTRAINT analyses_v2_candidate_scope_fk
    FOREIGN KEY (project_id, candidate_id)
    REFERENCES candidate.claim_candidates (project_id, candidate_id)
    ON DELETE RESTRICT,
  CONSTRAINT analyses_v2_state_outcome_ck CHECK (
    (state IN ('PENDING', 'ANALYZING') AND outcome IS NULL)
    OR
    (state NOT IN ('PENDING', 'ANALYZING') AND outcome = state)
  ),
  CONSTRAINT analyses_v2_completed_material_ck CHECK (
    state <> 'COMPLETED' OR (output_digest IS NOT NULL AND material_digest IS NOT NULL)
  ),
  CONSTRAINT analyses_v2_failure_code_ck CHECK (
    state IN ('PENDING', 'ANALYZING', 'COMPLETED') OR safe_failure_code IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS analyses_v2_input_idx
  ON comparison.analysis_revisions_v2 (
    project_id, candidate_id, candidate_revision, snapshot_digest, input_digest, attempt
  );
CREATE INDEX IF NOT EXISTS analyses_v2_recovery_idx
  ON comparison.analysis_revisions_v2 (project_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS comparison.relationships_v2 (
  relationship_id text PRIMARY KEY,
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  comparison_id text NOT NULL,
  candidate_id uuid NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_evidence_ids text[] NOT NULL CHECK (cardinality(candidate_evidence_ids) > 0),
  compared_resource_type text NOT NULL CHECK (compared_resource_type = 'CLAIM'),
  compared_resource_id text NOT NULL CHECK (length(btrim(compared_resource_id)) > 0),
  compared_resource_revision integer NOT NULL CHECK (compared_resource_revision > 0),
  snapshot_id text NOT NULL CHECK (length(btrim(snapshot_id)) > 0),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  relationship_type text NOT NULL CHECK (
    relationship_type IN ('SEMANTIC_DUPLICATE', 'SUPPORTS', 'REFINES', 'NARROWS',
      'BROADENS', 'UPDATES', 'SUPERSEDES', 'CONTRADICTS', 'TEMPORALLY_COEXISTS',
      'AMBIGUOUS', 'UNRELATED', 'POLICY_BLOCKED')
  ),
  conflict_kind text CHECK (
    conflict_kind IS NULL OR conflict_kind IN ('DIRECT_NEGATION', 'QUANTITATIVE_VALUE',
      'SCOPE', 'TEMPORAL', 'DEFINITION_TERM', 'ENTITY_IDENTITY',
      'SOURCE_OBSERVATION', 'POLICY')
  ),
  analysis_revision_id text NOT NULL,
  rule_identity text NOT NULL CHECK (length(btrim(rule_identity)) > 0),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  material_digest text NOT NULL CHECK (material_digest ~ '^sha256:[a-f0-9]{64}$'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  relationship_revision integer NOT NULL CHECK (relationship_revision > 0),
  relationship_identity_digest text NOT NULL CHECK (relationship_identity_digest ~ '^sha256:[a-f0-9]{64}$'),
  relationship_json jsonb NOT NULL CHECK (jsonb_typeof(relationship_json) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, relationship_id),
  UNIQUE (project_id, relationship_identity_digest),
  CONSTRAINT relationships_v2_comparison_scope_fk
    FOREIGN KEY (project_id, comparison_id)
    REFERENCES comparison.results_v2 (project_id, comparison_id)
    ON DELETE CASCADE,
  CONSTRAINT relationships_v2_analysis_scope_fk
    FOREIGN KEY (project_id, analysis_revision_id)
    REFERENCES comparison.analysis_revisions_v2 (project_id, analysis_revision_id)
    ON DELETE RESTRICT,
  CONSTRAINT relationships_v2_candidate_scope_fk
    FOREIGN KEY (project_id, candidate_id)
    REFERENCES candidate.claim_candidates (project_id, candidate_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS relationships_v2_candidate_idx
  ON comparison.relationships_v2 (project_id, candidate_id, candidate_revision, created_at DESC);
CREATE INDEX IF NOT EXISTS relationships_v2_comparison_idx
  ON comparison.relationships_v2 (project_id, comparison_id, relationship_id);
