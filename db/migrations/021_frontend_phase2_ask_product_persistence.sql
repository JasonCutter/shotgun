-- 021_frontend_phase2_ask_product_persistence.sql

CREATE SCHEMA IF NOT EXISTS frontend_ask;

CREATE TABLE IF NOT EXISTS frontend_ask.conversations (
  conversation_id VARCHAR(256) PRIMARY KEY,
  project_id VARCHAR(256) NOT NULL,
  title VARCHAR(500) NOT NULL,
  active_branch_id VARCHAR(256) NOT NULL,
  conversation_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_frontend_ask_conversations_project_id ON frontend_ask.conversations(project_id);

CREATE TABLE IF NOT EXISTS frontend_ask.branches (
  branch_id VARCHAR(256) PRIMARY KEY,
  conversation_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.conversations(conversation_id) ON DELETE CASCADE,
  parent_branch_id VARCHAR(256),
  origin_turn_id VARCHAR(256),
  label VARCHAR(256) NOT NULL,
  branch_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_frontend_ask_branches_conversation UNIQUE(branch_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_frontend_ask_branches_conversation_id ON frontend_ask.branches(conversation_id);

-- Deferrable foreign key for active_branch_id to ensure it belongs to the conversation
ALTER TABLE frontend_ask.conversations
  ADD CONSTRAINT fk_frontend_ask_conversations_active_branch
  FOREIGN KEY (active_branch_id, conversation_id) 
  REFERENCES frontend_ask.branches(branch_id, conversation_id) 
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS frontend_ask.turns (
  turn_id VARCHAR(256) PRIMARY KEY,
  conversation_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.conversations(conversation_id) ON DELETE CASCADE,
  branch_id VARCHAR(256) NOT NULL,
  ordinal INT NOT NULL,
  user_message TEXT NOT NULL,
  ask_mode VARCHAR(64) NOT NULL DEFAULT 'CANONICAL_ONLY',
  turn_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (branch_id, conversation_id) REFERENCES frontend_ask.branches(branch_id, conversation_id) ON DELETE CASCADE,
  CONSTRAINT uq_frontend_ask_turns_branch_ordinal UNIQUE(branch_id, ordinal)
);

CREATE TABLE IF NOT EXISTS frontend_ask.answer_runs (
  answer_run_id VARCHAR(256) PRIMARY KEY,
  conversation_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.conversations(conversation_id) ON DELETE CASCADE,
  branch_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.branches(branch_id) ON DELETE CASCADE,
  turn_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.turns(turn_id) ON DELETE CASCADE,
  project_id VARCHAR(256) NOT NULL,
  state VARCHAR(64) NOT NULL,
  answer_revision VARCHAR(256) NOT NULL,
  access_revision VARCHAR(256) NOT NULL,
  policy_context_revision VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_frontend_ask_answer_runs_turn UNIQUE(turn_id)
);

CREATE TABLE IF NOT EXISTS frontend_ask.statements (
  statement_id VARCHAR(256) PRIMARY KEY,
  answer_run_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.answer_runs(answer_run_id) ON DELETE CASCADE,
  ordinal INT NOT NULL,
  text TEXT NOT NULL,
  statement_revision VARCHAR(256) NOT NULL,
  CONSTRAINT uq_frontend_ask_statements_run_ordinal UNIQUE(answer_run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS frontend_ask.citations (
  citation_id VARCHAR(256) PRIMARY KEY,
  statement_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.statements(statement_id) ON DELETE CASCADE,
  source_id VARCHAR(256) NOT NULL,
  source_version_id VARCHAR(256) NOT NULL,
  evidence_id VARCHAR(256) NOT NULL,
  exact_quote TEXT,
  citation_ordinal INT NOT NULL,
  CONSTRAINT uq_frontend_ask_citations_stmt_ordinal UNIQUE(statement_id, citation_ordinal)
);

CREATE TABLE IF NOT EXISTS frontend_ask.source_selections (
  selection_id VARCHAR(256) PRIMARY KEY,
  answer_run_id VARCHAR(256) NOT NULL REFERENCES frontend_ask.answer_runs(answer_run_id) ON DELETE CASCADE,
  source_id VARCHAR(256) NOT NULL,
  source_version_id VARCHAR(256) NOT NULL,
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  selection_ordinal INT NOT NULL,
  CONSTRAINT uq_frontend_ask_source_selections_run_ordinal UNIQUE(answer_run_id, selection_ordinal)
);
