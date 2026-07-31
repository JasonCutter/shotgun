-- 021_frontend_phase2_ask_product_persistence.sql

CREATE TABLE IF NOT EXISTS ask_conversations (
  conversation_id VARCHAR(256) PRIMARY KEY,
  project_id VARCHAR(256) NOT NULL,
  title VARCHAR(500) NOT NULL,
  active_branch_id VARCHAR(256) NOT NULL,
  conversation_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ask_conversations_project_id ON ask_conversations(project_id);

CREATE TABLE IF NOT EXISTS ask_branches (
  branch_id VARCHAR(256) PRIMARY KEY,
  conversation_id VARCHAR(256) NOT NULL REFERENCES ask_conversations(conversation_id) ON DELETE CASCADE,
  parent_branch_id VARCHAR(256),
  origin_turn_id VARCHAR(256),
  label VARCHAR(256) NOT NULL,
  branch_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ask_branches_conversation_id ON ask_branches(conversation_id);

CREATE TABLE IF NOT EXISTS ask_turns (
  turn_id VARCHAR(256) PRIMARY KEY,
  conversation_id VARCHAR(256) NOT NULL REFERENCES ask_conversations(conversation_id) ON DELETE CASCADE,
  branch_id VARCHAR(256) NOT NULL REFERENCES ask_branches(branch_id) ON DELETE CASCADE,
  ordinal INT NOT NULL,
  user_message TEXT NOT NULL,
  ask_mode VARCHAR(64) NOT NULL DEFAULT 'CANONICAL_ONLY',
  turn_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ask_turns_branch_ordinal UNIQUE(branch_id, ordinal)
);

CREATE TABLE IF NOT EXISTS ask_answer_runs (
  answer_run_id VARCHAR(256) PRIMARY KEY,
  conversation_id VARCHAR(256) NOT NULL REFERENCES ask_conversations(conversation_id) ON DELETE CASCADE,
  branch_id VARCHAR(256) NOT NULL REFERENCES ask_branches(branch_id) ON DELETE CASCADE,
  turn_id VARCHAR(256) NOT NULL REFERENCES ask_turns(turn_id) ON DELETE CASCADE,
  project_id VARCHAR(256) NOT NULL,
  state VARCHAR(64) NOT NULL,
  answer_revision VARCHAR(256) NOT NULL,
  access_revision VARCHAR(256) NOT NULL,
  policy_context_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ask_statements (
  statement_id VARCHAR(256) PRIMARY KEY,
  answer_run_id VARCHAR(256) NOT NULL REFERENCES ask_answer_runs(answer_run_id) ON DELETE CASCADE,
  ordinal INT NOT NULL,
  text TEXT NOT NULL,
  statement_revision VARCHAR(256) NOT NULL
);

CREATE TABLE IF NOT EXISTS ask_citations (
  citation_id VARCHAR(256) PRIMARY KEY,
  statement_id VARCHAR(256) NOT NULL REFERENCES ask_statements(statement_id) ON DELETE CASCADE,
  source_id VARCHAR(256) NOT NULL,
  source_version_id VARCHAR(256) NOT NULL,
  evidence_id VARCHAR(256) NOT NULL,
  exact_quote TEXT,
  citation_ordinal INT NOT NULL
);

CREATE TABLE IF NOT EXISTS ask_source_selections (
  selection_id VARCHAR(256) PRIMARY KEY,
  answer_run_id VARCHAR(256) NOT NULL REFERENCES ask_answer_runs(answer_run_id) ON DELETE CASCADE,
  source_id VARCHAR(256) NOT NULL,
  source_version_id VARCHAR(256) NOT NULL,
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  selection_ordinal INT NOT NULL
);
