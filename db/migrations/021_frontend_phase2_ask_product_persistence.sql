BEGIN;

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '020_frontend_phase2_sources_product_persistence.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 021 preflight failed: migration 020 is not registered';
  END IF;

  IF to_regnamespace('frontend_ask') IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 021 preflight failed: frontend_ask schema already exists';
  END IF;
END
$$;

CREATE SCHEMA frontend_ask;

CREATE TABLE frontend_ask.conversations (
  conversation_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 256),
  active_branch_id text NOT NULL,
  conversation_revision text NOT NULL CHECK (length(conversation_revision) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, conversation_id),
  UNIQUE (conversation_id, active_branch_id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX frontend_ask_conversations_project_updated_idx
  ON frontend_ask.conversations (project_id, updated_at DESC, conversation_id);

CREATE TABLE frontend_ask.branches (
  branch_id text PRIMARY KEY,
  conversation_id text NOT NULL
    REFERENCES frontend_ask.conversations(conversation_id) ON DELETE CASCADE,
  parent_branch_id text,
  origin_turn_id text,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 256),
  branch_revision text NOT NULL CHECK (length(branch_revision) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (conversation_id, branch_id),
  CHECK (parent_branch_id IS NULL OR parent_branch_id <> branch_id),
  CHECK (updated_at >= created_at),
  FOREIGN KEY (conversation_id, parent_branch_id)
    REFERENCES frontend_ask.branches(conversation_id, branch_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX frontend_ask_branches_conversation_idx
  ON frontend_ask.branches (conversation_id, created_at, branch_id);

ALTER TABLE frontend_ask.conversations
  ADD CONSTRAINT frontend_ask_conversation_active_branch_fk
  FOREIGN KEY (conversation_id, active_branch_id)
  REFERENCES frontend_ask.branches(conversation_id, branch_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE frontend_ask.turns (
  turn_id text PRIMARY KEY,
  conversation_id text NOT NULL,
  branch_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  user_message text NOT NULL CHECK (length(btrim(user_message)) BETWEEN 1 AND 10000),
  ask_mode text NOT NULL CHECK (ask_mode IN ('CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID')),
  turn_revision text NOT NULL CHECK (length(turn_revision) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL,
  UNIQUE (conversation_id, branch_id, turn_id),
  UNIQUE (branch_id, ordinal),
  FOREIGN KEY (conversation_id, branch_id)
    REFERENCES frontend_ask.branches(conversation_id, branch_id)
    ON DELETE CASCADE
);

CREATE INDEX frontend_ask_turns_conversation_branch_idx
  ON frontend_ask.turns (conversation_id, branch_id, ordinal, turn_id);

ALTER TABLE frontend_ask.branches
  ADD CONSTRAINT frontend_ask_branch_origin_turn_fk
  FOREIGN KEY (conversation_id, parent_branch_id, origin_turn_id)
  REFERENCES frontend_ask.turns(conversation_id, branch_id, turn_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE frontend_ask.answer_runs (
  answer_run_id text PRIMARY KEY,
  conversation_id text NOT NULL,
  branch_id text NOT NULL,
  turn_id text NOT NULL,
  project_id text NOT NULL,
  create_command_id text NOT NULL UNIQUE
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID')),
  state text NOT NULL CHECK (
    state IN (
      'QUEUED', 'RUNNING', 'STREAMING', 'ACTION_REQUIRED', 'PARTIAL',
      'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_UNKNOWN'
    )
  ),
  attention_reason text CHECK (
    attention_reason IS NULL OR attention_reason = 'MODEL_EXECUTION_NOT_CONFIGURED'
  ),
  question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 10000),
  capabilities text[] NOT NULL DEFAULT '{}',
  answer_revision text NOT NULL CHECK (length(answer_revision) BETWEEN 1 AND 256),
  conversation_revision text NOT NULL CHECK (length(conversation_revision) BETWEEN 1 AND 256),
  access_revision text NOT NULL CHECK (length(access_revision) BETWEEN 1 AND 512),
  policy_context_revision text NOT NULL CHECK (length(policy_context_revision) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (turn_id),
  UNIQUE (project_id, answer_run_id),
  FOREIGN KEY (project_id, conversation_id)
    REFERENCES frontend_ask.conversations(project_id, conversation_id)
    ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, branch_id, turn_id)
    REFERENCES frontend_ask.turns(conversation_id, branch_id, turn_id)
    ON DELETE CASCADE,
  CHECK (
    (state = 'ACTION_REQUIRED' AND attention_reason IS NOT NULL)
    OR (state <> 'ACTION_REQUIRED' AND attention_reason IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX frontend_ask_answer_runs_conversation_idx
  ON frontend_ask.answer_runs (conversation_id, branch_id, created_at, answer_run_id);

CREATE TABLE frontend_ask.source_selections (
  selection_id text PRIMARY KEY,
  answer_run_id text NOT NULL
    REFERENCES frontend_ask.answer_runs(answer_run_id) ON DELETE CASCADE,
  project_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  selection_ordinal integer NOT NULL CHECK (selection_ordinal >= 0),
  UNIQUE (answer_run_id, selection_ordinal),
  UNIQUE (answer_run_id, selection_id),
  FOREIGN KEY (project_id, source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_id, source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT
);

CREATE TABLE frontend_ask.source_selection_evidence (
  selection_id text NOT NULL
    REFERENCES frontend_ask.source_selections(selection_id) ON DELETE CASCADE,
  evidence_ordinal integer NOT NULL CHECK (evidence_ordinal >= 0),
  evidence_id uuid NOT NULL REFERENCES evidence.spans(evidence_id) ON DELETE RESTRICT,
  PRIMARY KEY (selection_id, evidence_ordinal),
  UNIQUE (selection_id, evidence_id)
);

CREATE TABLE frontend_ask.statements (
  statement_id text PRIMARY KEY,
  answer_run_id text NOT NULL
    REFERENCES frontend_ask.answer_runs(answer_run_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 20000),
  statement_revision text NOT NULL CHECK (length(statement_revision) BETWEEN 1 AND 256),
  UNIQUE (answer_run_id, ordinal),
  UNIQUE (answer_run_id, statement_id)
);

CREATE TABLE frontend_ask.citations (
  citation_id text PRIMARY KEY,
  statement_id text NOT NULL
    REFERENCES frontend_ask.statements(statement_id) ON DELETE CASCADE,
  citation_ordinal integer NOT NULL CHECK (citation_ordinal >= 0),
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  evidence_id uuid NOT NULL REFERENCES evidence.spans(evidence_id) ON DELETE RESTRICT,
  exact_quote text,
  UNIQUE (statement_id, citation_ordinal),
  FOREIGN KEY (source_id, source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT
);

COMMIT;
