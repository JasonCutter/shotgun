# Frontend Phase 2 Section 1 Migration Approval Candidate — Revision 2

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-260730001`
- Revision: **2**
- Date: 2026-07-30
- Canonical Base SHA: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: [#46](https://github.com/JasonCutter/shotgun/pull/46)
- Governing ADR: ADR-122
- Frozen Contract: Frontend Phase 2 Section 1 AC-01 through AC-32
- Status: **DDL-LEVEL CANDIDATE / REVIEW IN PROGRESS**
- Migration implementation or execution: **NOT APPROVED**
- Product activation: **NOT APPROVED**
- Runtime dependency change: **NONE**

## 1. Decision requested

Approve creation and isolated verification of one additive PostgreSQL migration:

```text
020_frontend_phase2_sources_product_persistence.sql
```

The migration would add the durable Product-facing Sources intake lifecycle,
exact-duplicate decision/disposition, and secure URL acquisition provenance
required by AC-06 and AC-09 through AC-19. It would not activate Product write
routes or the Browser Submit action. Activation remains conditional on the
required tests and a later exact-Head review.

Revision 2 replaces the rejected Revision 1 transaction and rollback wording.
It preserves the accepted Command Ledger sequence and the existing Stage 2
`intake` and `asset` owners.

## 2. Fixed ownership boundary

### Existing owners retained

- `intake.submissions`: normalized Stage 2 item submission.
- `asset.original_assets`: immutable content-addressed original bytes.
- `asset.sources`: logical Source identity.
- `asset.source_versions`: immutable SourceVersion identity.
- `asset.storage_receipts`: Stage 2 item-to-SourceVersion storage result.
- `frontend_command.command_ledger`: command acceptance, idempotency, semantic
  digest and typed outcome.
- `auth.principals`, `auth.sessions`, `project_admin.projects`: authority
  identities.

### New owner

The exact new schema is:

```text
source_product
```

It owns Product lifecycle and decision metadata only. It must not store original
file bytes, direct-text bytes, a second Source identity, a second SourceVersion
identity, or a replacement command outcome.

The exact seven relations are:

1. `source_product.intake_submissions`
2. `source_product.intake_submission_items`
3. `source_product.intake_attempts`
4. `source_product.exact_duplicate_decisions`
5. `source_product.exact_duplicate_dispositions`
6. `source_product.url_acquisition_attempts`
7. `source_product.url_provenance_receipts`

## 3. Exact additive DDL contract

The following is the required SQL shape. The implementation may add comments,
constraint names and equivalent validation functions, but may not weaken the
column types, ownership, cardinality, transition, immutability or foreign-key
meaning without a new reviewed revision.

### 3.1 Existing-owner support indexes

Migration 020 may add only these support indexes to existing owners:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_sources_project_source_uidx
  ON asset.sources (project_id, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS asset_source_versions_source_version_uidx
  ON asset.source_versions (source_id, source_version_id);
```

They do not change existing identity. `source_id` and `source_version_id` remain
the existing primary keys.

### 3.2 `source_product.intake_submissions`

```sql
CREATE SCHEMA IF NOT EXISTS source_product;

CREATE TABLE source_product.intake_submissions (
  submission_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  principal_id uuid NOT NULL,
  session_id uuid NOT NULL,
  create_command_id text NOT NULL UNIQUE,
  state text NOT NULL,
  origin_kind text NOT NULL DEFAULT 'NATIVE',
  accepted_policy_context_id text NOT NULL,
  accepted_policy_binding jsonb NOT NULL,
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  submission_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,

  CONSTRAINT source_product_submission_project_fk
    FOREIGN KEY (project_id)
    REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  CONSTRAINT source_product_submission_principal_fk
    FOREIGN KEY (principal_id)
    REFERENCES auth.principals(principal_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_submission_session_fk
    FOREIGN KEY (session_id)
    REFERENCES auth.sessions(session_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_submission_command_fk
    FOREIGN KEY (create_command_id)
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_submission_state_check CHECK (
    state IN (
      'VALIDATING', 'QUEUED', 'RUNNING', 'PARTIAL', 'ACTION_REQUIRED',
      'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED',
      'OUTCOME_INDETERMINATE'
    )
  ),
  CONSTRAINT source_product_submission_origin_check CHECK (
    origin_kind IN ('NATIVE', 'LEGACY_COMPATIBILITY')
  ),
  CONSTRAINT source_product_submission_revision_check CHECK (
    submission_revision > 0
  ),
  CONSTRAINT source_product_submission_completion_check CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  ),
  CONSTRAINT source_product_submission_time_check CHECK (
    updated_at >= created_at AND
    (completed_at IS NULL OR completed_at >= created_at)
  ),
  UNIQUE (project_id, submission_id)
);
```

Required indexes:

```sql
CREATE INDEX source_product_submissions_project_updated_idx
  ON source_product.intake_submissions (project_id, updated_at DESC, submission_id);

CREATE INDEX source_product_submissions_attention_idx
  ON source_product.intake_submissions (project_id, state, updated_at DESC)
  WHERE state IN ('PARTIAL', 'ACTION_REQUIRED', 'FAILED', 'OUTCOME_INDETERMINATE');
```

### 3.3 `source_product.intake_submission_items`

`submission_item_id` is the Server identity. `client_item_id` is only a bounded
correlation value from the reviewed Draft; it is never authority.

```sql
CREATE TABLE source_product.intake_submission_items (
  submission_item_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  client_item_id text NOT NULL,
  ordinal integer NOT NULL,
  input_kind text NOT NULL,
  label text NOT NULL,
  input_manifest jsonb NOT NULL,
  state text NOT NULL,
  validation_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text,
  media_type text,
  size_bytes bigint,
  stage2_submission_id text,
  produced_source_id uuid,
  produced_source_version_id uuid,
  active_duplicate_decision_id uuid,
  attention_reason text,
  safe_failure_code text,
  safe_failure_message text,
  safe_failure_retryable boolean,
  item_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,

  CONSTRAINT source_product_item_submission_fk
    FOREIGN KEY (project_id, submission_id)
    REFERENCES source_product.intake_submissions(project_id, submission_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_item_stage2_fk
    FOREIGN KEY (project_id, stage2_submission_id)
    REFERENCES intake.submissions(project_id, submission_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_item_source_fk
    FOREIGN KEY (project_id, produced_source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_item_version_fk
    FOREIGN KEY (produced_source_id, produced_source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_item_kind_check CHECK (
    input_kind IN ('DIRECT_TEXT', 'FILE', 'URL')
  ),
  CONSTRAINT source_product_item_state_check CHECK (
    state IN (
      'VALIDATING', 'QUEUED', 'RUNNING', 'ACTION_REQUIRED', 'SUCCEEDED',
      'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_INDETERMINATE'
    )
  ),
  CONSTRAINT source_product_item_ordinal_check CHECK (ordinal >= 0),
  CONSTRAINT source_product_item_revision_check CHECK (item_revision > 0),
  CONSTRAINT source_product_item_hash_check CHECK (
    content_hash IS NULL OR content_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT source_product_item_size_check CHECK (
    size_bytes IS NULL OR size_bytes > 0
  ),
  CONSTRAINT source_product_item_stage2_identity_check CHECK (
    stage2_submission_id IS NULL OR stage2_submission_id = submission_item_id::text
  ),
  CONSTRAINT source_product_item_result_shape_check CHECK (
    (produced_source_id IS NULL AND produced_source_version_id IS NULL)
    OR
    (produced_source_id IS NOT NULL AND produced_source_version_id IS NOT NULL)
  ),
  CONSTRAINT source_product_item_failure_shape_check CHECK (
    (safe_failure_code IS NULL AND safe_failure_message IS NULL AND safe_failure_retryable IS NULL)
    OR
    (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL AND safe_failure_retryable IS NOT NULL)
  ),
  CONSTRAINT source_product_item_completion_check CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  ),
  UNIQUE (submission_id, client_item_id),
  UNIQUE (submission_id, ordinal),
  UNIQUE (project_id, stage2_submission_id),
  UNIQUE (project_id, submission_id, submission_item_id),
  UNIQUE (submission_item_id, content_hash)
);
```

`input_manifest` contains safe metadata only. Direct text and file bytes are not
stored in this table. For URL items, it contains only the Server-normalized URL
that passed the pre-acceptance credential and query-secret checks in Section 8.

Required indexes:

```sql
CREATE INDEX source_product_items_submission_state_idx
  ON source_product.intake_submission_items
  (project_id, submission_id, state, ordinal);

CREATE INDEX source_product_items_attention_idx
  ON source_product.intake_submission_items
  (project_id, state, updated_at DESC)
  WHERE state IN ('ACTION_REQUIRED', 'FAILED', 'OUTCOME_INDETERMINATE');
```

### 3.4 `source_product.intake_attempts`

One command may create one attempt row for each targeted item. Submit creates the
initial attempt for every accepted item. Retry and cancellation create new rows;
they never overwrite prior attempt history.

```sql
CREATE TABLE source_product.intake_attempts (
  intake_attempt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  command_id text NOT NULL,
  attempt_number integer NOT NULL,
  attempt_kind text NOT NULL,
  state text NOT NULL,
  correlation_id text NOT NULL,
  causation_attempt_id uuid,
  accepted_policy_context_id text NOT NULL,
  accepted_policy_binding jsonb NOT NULL,
  safe_failure_code text,
  safe_failure_message text,
  safe_failure_retryable boolean,
  attempt_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,

  CONSTRAINT source_product_attempt_item_fk
    FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_attempt_command_fk
    FOREIGN KEY (command_id)
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_attempt_causation_fk
    FOREIGN KEY (submission_item_id, causation_attempt_id)
    REFERENCES source_product.intake_attempts(submission_item_id, intake_attempt_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_attempt_number_check CHECK (attempt_number > 0),
  CONSTRAINT source_product_attempt_kind_check CHECK (
    attempt_kind IN ('SUBMIT', 'RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY', 'CANCEL')
  ),
  CONSTRAINT source_product_attempt_state_check CHECK (
    state IN (
      'ACCEPTED', 'RUNNING', 'CANCEL_REQUESTED', 'SUCCEEDED', 'FAILED',
      'CANCELLED', 'OUTCOME_INDETERMINATE'
    )
  ),
  CONSTRAINT source_product_attempt_revision_check CHECK (attempt_revision > 0),
  CONSTRAINT source_product_attempt_failure_shape_check CHECK (
    (safe_failure_code IS NULL AND safe_failure_message IS NULL AND safe_failure_retryable IS NULL)
    OR
    (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL AND safe_failure_retryable IS NOT NULL)
  ),
  CONSTRAINT source_product_attempt_completion_check CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  ),
  UNIQUE (command_id, submission_item_id),
  UNIQUE (submission_item_id, attempt_number),
  UNIQUE (submission_item_id, intake_attempt_id)
);
```

Required indexes:

```sql
CREATE INDEX source_product_attempts_submission_idx
  ON source_product.intake_attempts
  (project_id, submission_id, submission_item_id, attempt_number DESC);

CREATE INDEX source_product_attempts_recovery_idx
  ON source_product.intake_attempts (command_id, state);
```

### 3.5 `source_product.exact_duplicate_decisions`

Decision rows are immutable snapshots. A changed Source, policy or access
revision creates a new Decision row with a higher per-item `decision_revision`.
It does not update the prior Decision.

```sql
CREATE TABLE source_product.exact_duplicate_decisions (
  decision_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  decision_revision bigint NOT NULL,
  content_hash text NOT NULL,
  existing_source_id uuid NOT NULL,
  existing_source_version_id uuid NOT NULL,
  allowed_dispositions text[] NOT NULL,
  observed_source_revision text NOT NULL,
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  supersedes_decision_id uuid,
  created_at timestamptz NOT NULL,

  CONSTRAINT source_product_decision_item_fk
    FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_decision_item_hash_fk
    FOREIGN KEY (submission_item_id, content_hash)
    REFERENCES source_product.intake_submission_items(submission_item_id, content_hash)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_decision_source_fk
    FOREIGN KEY (project_id, existing_source_id)
    REFERENCES asset.sources(project_id, source_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_decision_version_fk
    FOREIGN KEY (existing_source_id, existing_source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_decision_supersedes_fk
    FOREIGN KEY (supersedes_decision_id)
    REFERENCES source_product.exact_duplicate_decisions(decision_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_decision_revision_check CHECK (decision_revision > 0),
  CONSTRAINT source_product_decision_hash_check CHECK (
    content_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT source_product_decision_allowed_check CHECK (
    cardinality(allowed_dispositions) > 0 AND
    allowed_dispositions <@ ARRAY[
      'REUSE_EXISTING_VERSION',
      'CREATE_VERSION_CANDIDATE',
      'CREATE_SEPARATE_SOURCE',
      'CANCEL_SUBMISSION'
    ]::text[]
  ),
  UNIQUE (submission_item_id, decision_revision),
  UNIQUE (submission_item_id, decision_id),
  UNIQUE (decision_id, decision_revision)
);
```

After this table exists, Migration 020 adds the active pointer:

```sql
ALTER TABLE source_product.intake_submission_items
  ADD CONSTRAINT source_product_item_active_decision_fk
  FOREIGN KEY (submission_item_id, active_duplicate_decision_id)
  REFERENCES source_product.exact_duplicate_decisions
    (submission_item_id, decision_id)
  ON DELETE RESTRICT;
```

Required index:

```sql
CREATE INDEX source_product_decisions_item_revision_idx
  ON source_product.exact_duplicate_decisions
  (project_id, submission_item_id, decision_revision DESC);
```

### 3.6 `source_product.exact_duplicate_dispositions`

Disposition rows are immutable. `UNIQUE (decision_id)` is the database arbiter
for at-most-one accepted user disposition.

```sql
CREATE TABLE source_product.exact_duplicate_dispositions (
  disposition_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  decision_id uuid NOT NULL UNIQUE,
  observed_decision_revision bigint NOT NULL,
  command_id text NOT NULL UNIQUE,
  disposition text NOT NULL,
  target_source_id uuid,
  created_at timestamptz NOT NULL,

  CONSTRAINT source_product_disposition_item_fk
    FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_disposition_decision_fk
    FOREIGN KEY (decision_id, observed_decision_revision)
    REFERENCES source_product.exact_duplicate_decisions
      (decision_id, decision_revision)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_disposition_command_fk
    FOREIGN KEY (command_id)
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_disposition_target_fk
    FOREIGN KEY (project_id, target_source_id)
    REFERENCES asset.sources(project_id, source_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_disposition_value_check CHECK (
    disposition IN (
      'REUSE_EXISTING_VERSION',
      'CREATE_VERSION_CANDIDATE',
      'CREATE_SEPARATE_SOURCE',
      'CANCEL_SUBMISSION'
    )
  ),
  CONSTRAINT source_product_disposition_target_shape_check CHECK (
    (disposition = 'CREATE_VERSION_CANDIDATE' AND target_source_id IS NOT NULL)
    OR
    (disposition <> 'CREATE_VERSION_CANDIDATE' AND target_source_id IS NULL)
  )
);
```

Required index:

```sql
CREATE INDEX source_product_dispositions_item_idx
  ON source_product.exact_duplicate_dispositions
  (project_id, submission_item_id, created_at DESC);
```

### 3.7 `source_product.url_acquisition_attempts`

Only URL items may own these rows. The normalized URL is accepted only after the
Section 8 security checks. The Browser never supplies this row identity.

```sql
CREATE TABLE source_product.url_acquisition_attempts (
  url_acquisition_attempt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  intake_attempt_id uuid NOT NULL UNIQUE,
  normalized_requested_url text NOT NULL,
  redacted_requested_url text NOT NULL,
  state text NOT NULL,
  max_redirects integer NOT NULL,
  connect_timeout_ms integer NOT NULL,
  header_timeout_ms integer NOT NULL,
  body_timeout_ms integer NOT NULL,
  total_timeout_ms integer NOT NULL,
  max_compressed_bytes bigint NOT NULL,
  max_decompressed_bytes bigint NOT NULL,
  accepted_policy_context_id text NOT NULL,
  policy_context_revision text NOT NULL,
  retention_class text NOT NULL,
  retention_expires_at timestamptz,
  safe_failure_code text,
  safe_failure_message text,
  safe_failure_retryable boolean,
  acquisition_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,

  CONSTRAINT source_product_url_attempt_item_fk
    FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_url_attempt_domain_attempt_fk
    FOREIGN KEY (submission_item_id, intake_attempt_id)
    REFERENCES source_product.intake_attempts
      (submission_item_id, intake_attempt_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_url_attempt_state_check CHECK (
    state IN (
      'VALIDATING', 'CONNECTING', 'READING', 'SUCCEEDED', 'FAILED',
      'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_INDETERMINATE'
    )
  ),
  CONSTRAINT source_product_url_attempt_limit_check CHECK (
    max_redirects >= 0 AND max_redirects <= 20 AND
    connect_timeout_ms > 0 AND header_timeout_ms > 0 AND body_timeout_ms > 0 AND
    total_timeout_ms > 0 AND
    max_compressed_bytes > 0 AND max_decompressed_bytes > 0 AND
    max_decompressed_bytes >= max_compressed_bytes
  ),
  CONSTRAINT source_product_url_attempt_scheme_check CHECK (
    normalized_requested_url ~ '^https?://'
  ),
  CONSTRAINT source_product_url_attempt_fragment_check CHECK (
    position('#' in normalized_requested_url) = 0
  ),
  CONSTRAINT source_product_url_attempt_revision_check CHECK (
    acquisition_revision > 0
  ),
  CONSTRAINT source_product_url_attempt_failure_shape_check CHECK (
    (safe_failure_code IS NULL AND safe_failure_message IS NULL AND safe_failure_retryable IS NULL)
    OR
    (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL AND safe_failure_retryable IS NOT NULL)
  ),
  CONSTRAINT source_product_url_attempt_completion_check CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  )
);
```

Required index:

```sql
CREATE INDEX source_product_url_attempts_item_idx
  ON source_product.url_acquisition_attempts
  (project_id, submission_item_id, created_at DESC);
```

### 3.8 `source_product.url_provenance_receipts`

A terminal acquisition attempt creates exactly one immutable receipt. Failed
and cancelled acquisition attempts also create a safe receipt; they do not
create OriginalAsset or SourceVersion references.

```sql
CREATE TABLE source_product.url_provenance_receipts (
  url_provenance_receipt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  url_acquisition_attempt_id uuid NOT NULL UNIQUE,
  receipt_revision bigint NOT NULL DEFAULT 1,
  outcome text NOT NULL,
  redacted_requested_url text NOT NULL,
  redacted_final_url text,
  redirect_chain_digest text NOT NULL,
  redirect_observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  dns_observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_status integer,
  response_content_type text,
  response_content_length bigint,
  compressed_bytes bigint,
  decompressed_bytes bigint,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  original_asset_id uuid,
  source_version_id uuid,
  failure_code text,
  retention_class text NOT NULL,
  retention_expires_at timestamptz,
  retrieved_at timestamptz,
  created_at timestamptz NOT NULL,

  CONSTRAINT source_product_url_receipt_item_fk
    FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_url_receipt_attempt_fk
    FOREIGN KEY (url_acquisition_attempt_id)
    REFERENCES source_product.url_acquisition_attempts(url_acquisition_attempt_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_product_url_receipt_asset_fk
    FOREIGN KEY (original_asset_id)
    REFERENCES asset.original_assets(asset_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_url_receipt_version_fk
    FOREIGN KEY (source_version_id)
    REFERENCES asset.source_versions(source_version_id) ON DELETE RESTRICT,
  CONSTRAINT source_product_url_receipt_revision_check CHECK (receipt_revision = 1),
  CONSTRAINT source_product_url_receipt_outcome_check CHECK (
    outcome IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT source_product_url_receipt_digest_check CHECK (
    redirect_chain_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT source_product_url_receipt_hash_check CHECK (
    content_hash IS NULL OR content_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT source_product_url_receipt_status_check CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  CONSTRAINT source_product_url_receipt_size_check CHECK (
    (response_content_length IS NULL OR response_content_length >= 0) AND
    (compressed_bytes IS NULL OR compressed_bytes >= 0) AND
    (decompressed_bytes IS NULL OR decompressed_bytes >= 0)
  ),
  CONSTRAINT source_product_url_receipt_success_shape_check CHECK (
    (
      outcome = 'SUCCEEDED' AND
      redacted_final_url IS NOT NULL AND
      content_hash IS NOT NULL AND
      original_asset_id IS NOT NULL AND
      source_version_id IS NOT NULL AND
      failure_code IS NULL AND
      retrieved_at IS NOT NULL
    )
    OR
    (
      outcome = 'FAILED' AND
      original_asset_id IS NULL AND
      source_version_id IS NULL AND
      failure_code IS NOT NULL
    )
    OR
    (
      outcome = 'CANCELLED' AND
      original_asset_id IS NULL AND
      source_version_id IS NULL
    )
  )
);
```

Required indexes:

```sql
CREATE INDEX source_product_url_receipts_item_idx
  ON source_product.url_provenance_receipts
  (project_id, submission_item_id, created_at DESC);

CREATE INDEX source_product_url_receipts_hash_idx
  ON source_product.url_provenance_receipts (project_id, content_hash)
  WHERE content_hash IS NOT NULL;
```

## 4. Revision and immutability enforcement

Migration 020 must create Server-owned trigger functions with the following exact
behavior:

- `source_product.enforce_submission_transition()`
- `source_product.enforce_item_transition()`
- `source_product.enforce_attempt_transition()`
- `source_product.enforce_url_attempt_transition()`
- `source_product.reject_immutable_change()`

For Submission, Item, Attempt and URL Acquisition Attempt updates:

1. the application must use optimistic concurrency with
   `WHERE <revision> = observedRevision`;
2. a `BEFORE UPDATE` trigger validates the allowed state edge;
3. the trigger sets `NEW.<revision> = OLD.<revision> + 1`;
4. the trigger sets `NEW.updated_at = clock_timestamp()`;
5. terminal-state timestamps are set once and cannot move backward;
6. no update may lower or reuse a revision.

`exact_duplicate_decisions`, `exact_duplicate_dispositions` and
`url_provenance_receipts` reject every `UPDATE` and `DELETE`. A correction or
retry creates a new row. Normal Product deletion is not part of Section 1.

## 5. Exact state-transition contract

### 5.1 Submission

Allowed edges:

```text
VALIDATING -> QUEUED | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED
QUEUED -> RUNNING | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
RUNNING -> PARTIAL | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
PARTIAL -> QUEUED | RUNNING | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED
ACTION_REQUIRED -> QUEUED | RUNNING | FAILED | CANCEL_REQUESTED | CANCELLED
FAILED -> QUEUED | RUNNING                 only with a new RETRY attempt
CANCELLED -> QUEUED | RUNNING              only with a new RETRY attempt
CANCEL_REQUESTED -> CANCELLED | PARTIAL | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> QUEUED | RUNNING | PARTIAL | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | CANCELLED
SUCCEEDED -> no transition
```

The aggregate Submission state is recalculated from locked Item states in the
same Domain Unit of Work. The Browser never derives it.

### 5.2 Item

Allowed edges:

```text
VALIDATING -> QUEUED | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED
QUEUED -> RUNNING | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
RUNNING -> ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
ACTION_REQUIRED -> QUEUED | RUNNING | FAILED | CANCEL_REQUESTED | CANCELLED
FAILED -> QUEUED | RUNNING                 only with a new RETRY attempt
CANCELLED -> QUEUED | RUNNING              only with a new RETRY attempt
CANCEL_REQUESTED -> CANCELLED | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> QUEUED | RUNNING | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | CANCELLED
SUCCEEDED -> no transition
```

A successful Item has one immutable `produced_source_id` and
`produced_source_version_id`. A retry cannot replace them.

### 5.3 Attempt

Allowed edges:

```text
ACCEPTED -> RUNNING | CANCEL_REQUESTED | FAILED | OUTCOME_INDETERMINATE
RUNNING -> SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
CANCEL_REQUESTED -> CANCELLED | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> RUNNING | SUCCEEDED | FAILED | CANCELLED
SUCCEEDED | FAILED | CANCELLED -> no transition
```

A Domain retry always creates a new Attempt row and increments
`attempt_number`. A transport replay uses the existing command and Attempt.

### 5.4 URL Acquisition Attempt

Allowed edges:

```text
VALIDATING -> CONNECTING | FAILED | CANCEL_REQUESTED
CONNECTING -> READING | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
READING -> SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
CANCEL_REQUESTED -> CANCELLED | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> CONNECTING | READING | SUCCEEDED | FAILED | CANCELLED
SUCCEEDED | FAILED | CANCELLED -> no transition
```

## 6. Command Ledger sequence and recovery

Revision 2 preserves ADR-116 and the current Command Gateway:

```text
1. Validate and normalize the versioned command.
2. Commit frontend_command.command_ledger outcome_state = ACCEPTED.
3. Start the Sources Domain Unit of Work in a separate transaction.
4. Lock and commit source_product plus existing Stage 2/Asset changes.
5. Commit the Domain transaction.
6. Update the same Command Ledger row to COMPLETED or REJECTED.
```

The Product tables bind commands as follows:

- submit command: `intake_submissions.create_command_id` and one
  `intake_attempts.command_id` row per item;
- retry command: new `intake_attempts.command_id` rows for the selected items;
- cancel command: new `intake_attempts.command_id` rows for cancellable items;
- duplicate command: `exact_duplicate_dispositions.command_id`.

The Ledger `produced_resources` JSON is a typed outcome projection, not the
persistence owner.

### Commit-before-completion recovery

When the Ledger remains `ACCEPTED` or `OUTCOME_UNKNOWN` after Domain commit:

1. lookup uses the original `principal_id + client_request_id`;
2. the Coordinator reads Product rows by the accepted `command_id`;
3. if the Domain resource exists and matches Project, Principal, policy binding
   and semantic meaning, the same Ledger row is completed with those references;
4. if no Domain resource exists, execution may resume once under the same
   idempotency identity;
5. a different semantic digest returns the existing typed mismatch failure;
6. the Browser never creates a new key automatically.

A validation or infrastructure failure before Domain commit may reject the
Command without Product rows. A per-item processing failure after Submission
creation is represented in Product state and normally completes the Command with
the Submission resource; it is not hidden as a missing Domain result.

## 7. Stage 2 and Asset Unit of Work

Migration approval requires a `SourcesIntakeUnitOfWorkPort` or equivalent
transaction boundary. The PostgreSQL adapter must use one `PoolClient` for:

1. Product Submission, Item and Attempt rows;
2. existing `intake.submissions` normalization row;
3. existing OriginalAsset reuse/creation;
4. existing Source/SourceVersion reuse or creation according to the accepted
   duplicate disposition;
5. existing `asset.storage_receipts` row;
6. Product Item produced-resource references;
7. URL provenance receipt when the item is URL-based.

The current `PostgresOriginalAssetRepository.store()` opens its own transaction.
The implementation must extract or add a transaction-aware adapter path; it must
not nest an independent Stage 2 transaction inside the Product Unit of Work.
The standalone Stage 2 API remains compatible and continues to use its existing
transaction behavior.

For every Product Item accepted into Stage 2:

```text
stage2_submission_id = submission_item_id::text
```

The composite foreign key to `intake.submissions(project_id, submission_id)` and
the existing `asset.storage_receipts(project_id, submission_id)` uniqueness make
the link deterministic. No second Source or OriginalAsset table is introduced.

## 8. URL security, redaction and retention

The following checks occur before Command acceptance and therefore before the
normalized URL is written to the Command Ledger or Product tables:

- scheme must be `http` or `https`;
- URL userinfo is rejected;
- fragment is removed;
- malformed host, numeric ambiguity and forbidden Unicode host forms are
  rejected by the Server URL parser and policy;
- policy-maintained sensitive query-key names and credential-shaped values are
  rejected unless an approved Connector owns the credential and supplies a
  Connector reference instead of a raw URL;
- Cookie, Authorization, Proxy-Authorization and client credential headers are
  not accepted from this command and are never persisted;
- redirect targets repeat the same validation for every hop;
- DNS results are validated against loopback, link-local, private, multicast,
  reserved, metadata-service and policy-blocked ranges at every hop and again
  immediately before connection;
- DNS rebinding or an address-set change outside the accepted policy fails
  closed.

### Stored URL forms

- `normalized_requested_url`: Server-only URL that passed credential checks.
- `redacted_requested_url` and `redacted_final_url`: userinfo absent, fragment
  absent and query values replaced by a fixed redaction marker for Browser and
  support views.
- logs and error envelopes use only the redacted form.

### DNS and redirect observations

`dns_observations` and `redirect_observations` store bounded arrays of safe
objects only:

```text
ordinal
timestamp
scheme
redactedHost
addressFamily
addressClass
normalizedAddressSetDigest
validationOutcome
redirectStatus
redactedLocation
```

Raw resolver packets, Cookies, Authorization values, response bodies, private or
rejected address values, and complete response headers are prohibited.
`normalizedAddressSetDigest` is audit evidence, not a Browser identifier.

`response_metadata` is allowlisted to safe fields such as ETag digest,
Last-Modified, declared content encoding and filename decision. It never stores
Set-Cookie, authentication challenges, credentials or arbitrary headers.

### Retention

`retention_class` and `retention_expires_at` are derived from the accepted Server
policy context. Section 1 does not invent a fixed duration. Before Product
activation, tests must prove that:

- protected URL metadata follows the same Project retention and access-loss
  policy as the resulting Source;
- Browser projections never expose normalized URLs or observation internals;
- logs contain only redacted URLs;
- an expired record is not used for a new fetch or retry;
- destructive deletion or historical redaction is performed only by a separately
  approved retention operation because immutable audit rows may not be silently
  updated or deleted by Migration 020.

## 9. Duplicate serialization and lock order

Every submit, retry, cancellation and duplicate disposition transaction uses the
following lock order:

1. accepted Command identity is already durable in the Ledger;
2. `pg_advisory_xact_lock(hashtextextended(project_id || ':' || submission_id, 0))`;
3. Submission row `FOR UPDATE`;
4. targeted Item rows `FOR UPDATE` ordered by `submission_item_id`;
5. active Decision rows `FOR UPDATE` ordered by `decision_id`;
6. referenced Source and SourceVersion rows in stable ID order;
7. insert/update Product and existing Stage 2/Asset rows;
8. commit.

For duplicate disposition, the transaction verifies:

- the Item active pointer still names the Decision;
- `observed_decision_revision` matches;
- Source, access and policy revisions still match;
- the requested disposition is in `allowed_dispositions`;
- the target Source is valid for `CREATE_VERSION_CANDIDATE`;
- `UNIQUE (decision_id)` has not already accepted a disposition.

The unique constraint is the final concurrent arbiter. A conflict returns the
typed stale-decision or already-resolved failure; it never silently reuses or
merges a Source.

## 10. Legacy compatibility and backfill

Migration 020 performs **no historical Product-row backfill**.

Existing Sources and SourceVersions continue through the current compatibility
projection. They may appear in Library, Detail, Version, Preview and Evidence
views without a fabricated Product Intake Submission.

Migration 020 must not create historical:

- Session ownership;
- Product Submission or Attempt history;
- retry or cancellation events;
- duplicate Decision or Disposition;
- URL acquisition or provenance receipts.

`origin_kind = 'LEGACY_COMPATIBILITY'` is reserved for a future separately
approved deterministic backfill only when a unique historical Principal,
Session, Project, Stage 2 Submission and policy binding can all be proven.
Revision 2 concludes that existing migrations 001 through 019 do not provide
that complete evidence, so the eligible count for Migration 020 is zero.

## 11. Expand, Compatibility, Activate and rollback

### Expand

- run preflight;
- create the schema, support indexes, seven tables, constraints, triggers and
  indexes;
- update `scripts/database.ts` reset and verify coverage;
- leave write routes disabled;
- existing V1 and Stage 2 behavior remains unchanged.

### Compatibility

- application reads existing Source/SourceVersion projections and optional new
  Product rows;
- Sources Submit, retry, cancel, duplicate disposition and URL acquisition
  writes remain disabled;
- no historical Product rows are guessed or backfilled;
- exact integrity and compatibility reports are produced.

### Activate

Activation is not granted by approving Migration creation. A later exact-Head
review must verify:

- migration and database evidence;
- Product API and Domain Unit of Work evidence;
- URL security corpus;
- recovery, concurrency and stale-decision evidence;
- Browser E2E;
- AC traceability update.

Only then may the Server switch Sources Intake from `COMPATIBILITY` to `ACTIVE`
and expose Submit capability.

### Rollback

The repository migration runner is Up-only. Therefore:

```text
Operational rollback = application to COMPATIBILITY + new writes disabled
```

Before or after Activate, accepted Product, decision and provenance records are
preserved. There is no normal `DROP TABLE` or schema downgrade. Any destructive
cleanup requires a separately approved forward cleanup migration or script,
exported integrity report and disposable-database drill.

## 12. Migration preflight

Migration 020 must stop before schema change if any condition fails:

- migrations 001 through 019 are not all registered;
- required existing tables or columns are absent;
- existing target key types differ from this contract;
- an incompatible `source_product` schema object already exists;
- support indexes cannot be created;
- any existing database object uses a conflicting name;
- the PostgreSQL version is outside the repository-supported baseline.

Preflight and postflight reports include:

```text
migration count
existing-owner table and key validation
support-index validation
new table and constraint count
legacy Product-backfill eligible = 0
ambiguous historical Sources count
rejected incompatible-object count
```

Ambiguous historical data is reported but not mutated.

## 13. Required verification after approval

### Database paths

- Fresh Database apply through 020.
- Existing Database upgrade from exact 001 through 019 to 020.
- Re-running `db:migrate` is a no-op through `runtime.schema_migrations`.
- `db:reset` and `db:verify` include `source_product`.
- Existing Stage 2 database tests remain unchanged and pass.
- No Product historical rows are inserted during upgrade.

### Constraint and transition tests

- every PK, FK, `ON DELETE RESTRICT`, unique, check and partial index;
- revision increment and optimistic conflict;
- every allowed state edge and representative forbidden edge;
- immutable Decision, Disposition and Receipt update/delete rejection;
- one SourceVersion result per Item;
- one disposition per Decision;
- one URL receipt per acquisition attempt.

### Command and fault injection

- ACCEPTED commit failure;
- Domain transaction failure before any row;
- failure after Product rows but before Stage 2 rows;
- failure after OriginalAsset but before SourceVersion;
- failure after SourceVersion but before StorageReceipt;
- failure after Domain commit but before Ledger COMPLETED;
- recovery by original `clientRequestId` and command identity;
- semantic-digest mismatch and transport replay;
- concurrent retry/cancel and duplicate disposition.

Every injected Domain failure rolls back the complete Domain Unit of Work.
Commit-before-completion preserves Domain rows and repairs only the Ledger
outcome.

### URL security corpus

- disallowed schemes;
- userinfo and credential-shaped query values;
- loopback, link-local, private, multicast, reserved and metadata addresses;
- mixed public/private DNS results;
- DNS rebinding and address change;
- redirect loop, redirect limit, cross-scheme and policy-blocked redirect;
- Cookie and Authorization non-forwarding;
- connection, header, body and total timeout;
- compressed and decompressed byte limits;
- unsupported content type and misleading filename;
- redacted log, error and Browser projection verification;
- failed and cancelled safe provenance receipts.

### Product and Browser

- Direct Text, File and URL submission;
- partial success and user attention;
- `OUTCOME_UNKNOWN` recovery;
- explicit cancellation and Domain retry;
- exact duplicate choice and stale decision;
- Library, Preview, SourceVersion and Evidence continuity;
- offline write blocking;
- accessibility and Chromium E2E;
- exact-Head CI and AC-06, AC-09 through AC-19 and AC-30 updates.

## 14. Explicit exclusions

- no Migration SQL file is created by this candidate document;
- no local or remote Migration execution;
- no Product route activation or Browser Submit enablement;
- no new Runtime Dependency;
- no V1 removal, schema contraction or Stage 2 replacement;
- no browser persistence of original text, file bytes, normalized URLs or Server
  identities;
- no automatic duplicate merge;
- no Phase 2 Section 2 work;
- no PR Ready transition, merge or Section completion declaration.

## 15. Approval boundary

Approval of Revision 2 would authorize only:

1. creation of `db/migrations/020_frontend_phase2_sources_product_persistence.sql`;
2. required adapter, Unit of Work, reset/verify and test implementation;
3. execution against isolated development and CI databases;
4. evidence updates on Draft PR #46.

It would not authorize Product activation, Ready transition, merge or Section
completion. Those require later exact-Head evidence and separate approval.
