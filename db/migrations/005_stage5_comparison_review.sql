CREATE SCHEMA IF NOT EXISTS comparison;
CREATE SCHEMA IF NOT EXISTS review;

CREATE TABLE comparison.results (
  comparison_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES candidate.claim_candidates(candidate_id),
  snapshot_id text NOT NULL,
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  classification text NOT NULL
    CHECK (classification IN ('NEW_CLAIM', 'EXACT_DUPLICATE', 'POSSIBLE_CONFLICT')),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  diff_digest text NOT NULL CHECK (diff_digest ~ '^sha256:[a-f0-9]{64}$'),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, candidate_id, snapshot_digest)
);

CREATE INDEX comparison_results_source_idx
  ON comparison.results (project_id, source_version_id, created_at);

CREATE TABLE review.change_sets (
  change_set_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES candidate.claim_candidates(candidate_id),
  comparison_id uuid NOT NULL REFERENCES comparison.results(comparison_id),
  revision_number integer NOT NULL CHECK (revision_number = 1),
  status text NOT NULL
    CHECK (status IN ('PENDING_REVIEW', 'ON_HOLD', 'APPROVED', 'REJECTED', 'STALE')),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  expected_canonical_version integer NOT NULL CHECK (expected_canonical_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  change_set_json jsonb NOT NULL,
  manifest_json jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, comparison_id)
);

CREATE INDEX review_change_sets_source_idx
  ON review.change_sets (project_id, source_version_id, created_at);

CREATE TABLE review.decisions (
  decision_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  change_set_id uuid NOT NULL REFERENCES review.change_sets(change_set_id),
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'HOLD', 'REJECT')),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (length(reason) > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  decision_json jsonb NOT NULL,
  decided_at timestamptz NOT NULL
);

CREATE INDEX review_decisions_change_set_idx
  ON review.decisions (project_id, change_set_id, decided_at, decision_id);
