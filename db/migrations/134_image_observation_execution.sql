-- Image execution is owned by AI execution. Existing provider_calls/output
-- contracts are candidate-only; no relation reservation is relabeled here.
-- This additive path is ISOLATED_FAKE only, never a live budget fallback.
CREATE TABLE ai.image_observation_executions (
  call_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  request_id text NOT NULL,
  source_version_id uuid NOT NULL REFERENCES asset.source_versions(source_version_id),
  state text NOT NULL CHECK (state IN ('REQUESTED','PROVIDER_RUNNING','OUTPUT_STORED','COMPLETED','OUTCOME_UNKNOWN','OUTPUT_REJECTED')),
  execution_mode text NOT NULL DEFAULT 'ISOLATED_FAKE' CHECK (execution_mode = 'ISOLATED_FAKE'),
  attempt_id uuid UNIQUE,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  record_json jsonb NOT NULL,
  output_json jsonb,
  rejected_response_json jsonb,
  transformation_revision_id uuid REFERENCES transformation.revisions(revision_id),
  created_at timestamptz NOT NULL,
  activated_at timestamptz,
  output_stored_at timestamptz,
  completed_at timestamptz,
  UNIQUE (project_id, request_id),
  UNIQUE (project_id, call_id, attempt_id),
  CHECK ((state = 'REQUESTED') = (attempt_id IS NULL)),
  CHECK ((state IN ('OUTPUT_STORED','COMPLETED')) = (output_json IS NOT NULL)),
  CHECK (rejected_response_json IS NULL OR (state='OUTPUT_REJECTED' AND octet_length(rejected_response_json::text)<=4194304)),
  CHECK ((state = 'COMPLETED') = (transformation_revision_id IS NOT NULL))
);
CREATE INDEX image_observation_execution_source_idx
  ON ai.image_observation_executions(project_id, source_version_id, state);

ALTER TABLE vp.image_observations ADD CONSTRAINT image_observation_execution_binding_fk
  FOREIGN KEY (project_id, call_id, attempt_id)
  REFERENCES ai.image_observation_executions(project_id, call_id, attempt_id);
