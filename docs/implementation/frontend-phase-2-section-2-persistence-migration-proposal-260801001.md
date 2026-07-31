# Frontend Phase 2 Section 2 — Ask Write & Persistence Database Migration Proposal

**Proposal ID**: `frontend-phase-2-section-2-persistence-migration-proposal-260801001`  
**Date**: 2026-08-01  
**Repository**: `JasonCutter/shotgun`  
**Status**: `PROPOSED` (Awaiting User Review & Explicit Approval)  

---

## 1. Current Schema Assessment & Reusability

An audit of `db/migrations/001`~`020` indicates that:
- `017_frontend_section2_project_owner_scope.sql` provides `project_membership` and project authorization scope.
- `018_frontend_command_request_outcome_contract.sql` provides `frontend_command_requests` and `frontend_command_outcomes` tables for generic command ledger persistence.
- **No tables exist for Ask Conversation, Branch, Turn, AnswerRun, Statement, Citation, or SourceSelection**.

Therefore, a dedicated SQL migration file `021_frontend_phase2_ask_product_persistence.sql` is proposed.

---

## 2. Proposed DDL Specification

```sql
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
```

---

## 3. Transaction, Lock, Backfill & Rollback Strategy

1. **Transaction & Lock Impact**:
   - New table additions (`CREATE TABLE IF NOT EXISTS`). Zero lock impact on existing tables.
2. **Backfill**:
   - New feature persistence. Zero backfill required for existing historical data.
3. **Rollback Strategy**:
   - Downgrade script: `DROP TABLE IF EXISTS ask_source_selections, ask_citations, ask_statements, ask_answer_runs, ask_turns, ask_branches, ask_conversations CASCADE;`

---

## 4. User Review & Approval Request

> [!IMPORTANT]
> This DDL proposal is submitted for user review. No migration files will be created in `db/migrations` and no database migrations will be executed until explicit user approval is granted.
