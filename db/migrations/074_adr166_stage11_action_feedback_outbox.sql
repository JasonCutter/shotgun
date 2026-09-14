-- ADR-166: Stage 11 Action feedback is handed off through a producer-owned
-- transactional outbox. This table is intentionally separate from
-- canonical.outbox: Action feedback is not a Canonical write or projection.
CREATE SCHEMA IF NOT EXISTS action;

CREATE TABLE action.action_feedback_outbox (
  outbox_id text PRIMARY KEY CHECK (length(btrim(outbox_id)) BETWEEN 1 AND 700),
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  action_id uuid NOT NULL REFERENCES action.executions(action_id),
  semantic_key text NOT NULL CHECK (length(btrim(semantic_key)) BETWEEN 1 AND 700),
  feedback_status text NOT NULL CHECK (feedback_status IN ('VERIFIED', 'OUTCOME_UNKNOWN', 'FAILED')),
  phase text NOT NULL CHECK (phase = 'ACTION_REVIEW'),
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  payload_json jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'published')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  published_at timestamptz,
  last_error text,
  UNIQUE (project_id, semantic_key),
  CHECK (semantic_key = 'action-feedback:' || action_id::text || ':' || feedback_status),
  CHECK (occurred_at = source_updated_at),
  CHECK ((status = 'processing') = (claimed_at IS NOT NULL)),
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK (payload_json->>'actionId' = action_id::text),
  CHECK (payload_json->>'status' = feedback_status),
  CHECK (payload_json->>'reentryPhase' = 'ACTION_REVIEW'),
  CHECK (payload_json ? 'occurredAt')
);

CREATE INDEX action_feedback_outbox_dispatch_idx
  ON action.action_feedback_outbox (project_id, status, available_at, outbox_id);

CREATE INDEX action_feedback_outbox_action_idx
  ON action.action_feedback_outbox (project_id, action_id, feedback_status);

-- Deterministic additive repair for transitions recorded before this table
-- existed. Keep the first authoritative audit occurrence for each semantic
-- status; repeated application is harmless because the semantic key is unique.
WITH feedback_history AS (
  SELECT
    audit.project_id,
    audit.action_id,
    audit.occurred_at,
    CASE audit.category
      WHEN 'ACTION_VERIFIED' THEN 'VERIFIED'
      WHEN 'ACTION_OUTCOME_UNKNOWN' THEN 'OUTCOME_UNKNOWN'
      WHEN 'ACTION_FAILED' THEN 'FAILED'
      WHEN 'ACTION_VERIFICATION_FAILED' THEN 'FAILED'
    END AS feedback_status,
    row_number() OVER (
      PARTITION BY audit.project_id, audit.action_id,
        CASE audit.category
          WHEN 'ACTION_VERIFIED' THEN 'VERIFIED'
          WHEN 'ACTION_OUTCOME_UNKNOWN' THEN 'OUTCOME_UNKNOWN'
          WHEN 'ACTION_FAILED' THEN 'FAILED'
          WHEN 'ACTION_VERIFICATION_FAILED' THEN 'FAILED'
        END
      ORDER BY audit.sequence ASC
    ) AS occurrence_number
  FROM action.audit_events AS audit
  WHERE audit.category IN (
    'ACTION_FAILED', 'ACTION_OUTCOME_UNKNOWN', 'ACTION_VERIFIED',
    'ACTION_VERIFICATION_FAILED'
  )
)
INSERT INTO action.action_feedback_outbox
  (outbox_id, project_id, action_id, semantic_key, feedback_status, phase,
   schema_version, payload_json, occurred_at, source_updated_at, status,
   attempts, available_at)
SELECT
  'action-feedback-outbox:' || history.project_id ||
    ':action-feedback:' || history.action_id::text || ':' || history.feedback_status,
  history.project_id,
  history.action_id,
  'action-feedback:' || history.action_id::text || ':' || history.feedback_status,
  history.feedback_status,
  'ACTION_REVIEW',
  '1.0.0',
  jsonb_build_object(
    'actionId', history.action_id::text,
    'status', history.feedback_status,
    'reentryPhase', 'ACTION_REVIEW',
    'occurredAt', history.occurred_at
  ),
  history.occurred_at,
  history.occurred_at,
  'pending',
  0,
  history.occurred_at
FROM feedback_history AS history
WHERE history.occurrence_number = 1
ON CONFLICT (project_id, semantic_key) DO NOTHING;
