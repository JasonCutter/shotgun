# Frontend Phase 2 Section 1 Migration Candidate Revision 2 — Normative DDL Appendix

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-revision-2-ddl-appendix-260730001`
- Date: 2026-07-30
- Parent Candidate:
  `frontend-phase-2-section-1-migration-approval-candidate-revision-2-260730001.md`
- Status: **NORMATIVE / REVIEWED**
- Migration SQL creation or execution: **NOT YET APPROVED**

This Appendix removes every shorthand left in the Revision 2 Final Candidate.
The approval package is the Parent Candidate plus this Appendix. If wording
conflicts, this Appendix controls the DDL, transition and trigger meaning.

## 1. Common exact columns

Every table described with a Project/Submission/Item triple uses exactly:

```sql
project_id text NOT NULL,
submission_id uuid NOT NULL,
submission_item_id uuid NOT NULL
```

Every mutable table described with timestamps uses exactly:

```sql
created_at timestamptz NOT NULL,
updated_at timestamptz NOT NULL,
completed_at timestamptz
```

Every safe failure triple uses exactly:

```sql
safe_failure_code text,
safe_failure_message text,
safe_failure_retryable boolean
```

with this shape rule:

```sql
CHECK (
  (safe_failure_code IS NULL AND safe_failure_message IS NULL
   AND safe_failure_retryable IS NULL)
  OR
  (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL
   AND safe_failure_retryable IS NOT NULL)
)
```

`safe_failure_code` is limited to 200 characters and
`safe_failure_message` to 2,000 characters.

## 2. Required type and JSON checks

Migration 020 creates immutable helper functions in `source_product` for CHECK
constraints only. They are `IMMUTABLE`, have no table access and are covered by
unit/database tests:

```text
source_product.text_array_is_unique(text[]) -> boolean
source_product.jsonb_is_object(jsonb) -> boolean
source_product.jsonb_is_array(jsonb) -> boolean
```

Mandatory checks:

- every policy binding and response metadata value is a JSON object;
- every validation, DNS and redirect observation value is a JSON array;
- `allowed_dispositions` is non-empty, contains approved values only and has no
  duplicate values;
- all revision values are greater than zero;
- all bounded IDs and messages satisfy the Parent Candidate limits;
- all SHA-256 values match `^sha256:[a-f0-9]{64}$`;
- all mutable rows satisfy `updated_at >= created_at` and terminal completion
  time is not before creation;
- all retention expiry values are null or not before creation.

## 3. Exact omitted columns

### 3.1 `source_product.intake_attempts`

In addition to the Parent Candidate columns, the exact timestamp and failure
columns are:

```sql
safe_failure_code text,
safe_failure_message text,
safe_failure_retryable boolean,
attempt_revision bigint NOT NULL DEFAULT 1,
created_at timestamptz NOT NULL,
updated_at timestamptz NOT NULL,
completed_at timestamptz
```

The same-Item causation relation is enforced by:

```sql
UNIQUE (submission_item_id, intake_attempt_id),
FOREIGN KEY (submission_item_id, causation_attempt_id)
  REFERENCES source_product.intake_attempts
    (submission_item_id, intake_attempt_id)
  ON DELETE RESTRICT
```

`causation_attempt_id` must be null for the initial `SUBMIT` Attempt and present
for retry/cancel Attempts unless the cancellation is the first command after
Submission creation. It must never equal `intake_attempt_id`.

### 3.2 `source_product.exact_duplicate_decisions`

The exact columns represented by the Project/Submission/Item shorthand are:

```sql
project_id text NOT NULL,
submission_id uuid NOT NULL,
submission_item_id uuid NOT NULL
```

Mandatory full-context uniqueness:

```sql
UNIQUE (
  project_id,
  submission_id,
  submission_item_id,
  decision_id,
  decision_revision
)
```

The Item/hash relation is:

```sql
FOREIGN KEY (submission_item_id, content_hash)
  REFERENCES source_product.intake_submission_items
    (submission_item_id, content_hash)
  ON DELETE RESTRICT
```

A constraint trigger rejects:

- `supersedes_decision_id = decision_id`;
- a superseded Decision from another Item;
- a revision that is not exactly previous per-Item revision plus one;
- an existing SourceVersion that does not belong to the existing Source and
  Project;
- an active pointer to a Decision from another Item.

### 3.3 `source_product.exact_duplicate_dispositions`

Exact columns:

```sql
disposition_id uuid PRIMARY KEY,
project_id text NOT NULL,
submission_id uuid NOT NULL,
submission_item_id uuid NOT NULL,
decision_id uuid NOT NULL,
observed_decision_revision bigint NOT NULL,
command_id text NOT NULL,
disposition text NOT NULL,
target_source_id uuid,
created_at timestamptz NOT NULL
```

Mandatory constraints:

```sql
UNIQUE (decision_id),
UNIQUE (command_id),
FOREIGN KEY (
  project_id,
  submission_id,
  submission_item_id,
  decision_id,
  observed_decision_revision
)
REFERENCES source_product.exact_duplicate_decisions (
  project_id,
  submission_id,
  submission_item_id,
  decision_id,
  decision_revision
)
ON DELETE RESTRICT
```

A constraint trigger verifies that:

- the Decision is the Item's current active Decision;
- the disposition is in the Decision's allowed set;
- Source, access and policy revisions are current;
- `CREATE_VERSION_CANDIDATE` has `target_source_id` equal to the Decision's
  existing Source;
- all other dispositions have `target_source_id IS NULL`.

The same transaction inserts the Disposition and clears the Item active Decision
pointer. A uniqueness conflict returns the typed already-resolved conflict.

### 3.4 `source_product.url_acquisition_attempts`

Exact columns omitted by shorthand:

```sql
url_acquisition_attempt_id uuid PRIMARY KEY,
project_id text NOT NULL,
submission_id uuid NOT NULL,
submission_item_id uuid NOT NULL,
intake_attempt_id uuid NOT NULL,
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
completed_at timestamptz
```

Mandatory unique key for the Receipt FK:

```sql
UNIQUE (
  project_id,
  submission_id,
  submission_item_id,
  url_acquisition_attempt_id
)
```

A constraint trigger verifies that the referenced Item has
`input_kind = 'URL'` and the referenced Intake Attempt belongs to the same Item.

### 3.5 `source_product.url_provenance_receipts`

Exact columns:

```sql
url_provenance_receipt_id uuid PRIMARY KEY,
project_id text NOT NULL,
submission_id uuid NOT NULL,
submission_item_id uuid NOT NULL,
url_acquisition_attempt_id uuid NOT NULL,
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
created_at timestamptz NOT NULL
```

Mandatory full-context Attempt FK:

```sql
FOREIGN KEY (
  project_id,
  submission_id,
  submission_item_id,
  url_acquisition_attempt_id
)
REFERENCES source_product.url_acquisition_attempts (
  project_id,
  submission_id,
  submission_item_id,
  url_acquisition_attempt_id
)
ON DELETE RESTRICT
```

Mandatory Asset/Version relation:

```sql
FOREIGN KEY (original_asset_id, source_version_id)
  REFERENCES asset.source_versions(original_asset_id, source_version_id)
  ON DELETE RESTRICT
```

Success shape:

```text
outcome = SUCCEEDED
redacted_final_url, content_hash, original_asset_id, source_version_id,
retrieved_at are present
failure_code is null
```

Failure shape:

```text
outcome = FAILED
failure_code is present
original_asset_id and source_version_id are null
```

Cancellation shape:

```text
outcome = CANCELLED
original_asset_id and source_version_id are null
```

`UNIQUE (url_acquisition_attempt_id)` and `receipt_revision = 1` are mandatory.

## 4. Exact mutable state edges

All other state changes are rejected.

### 4.1 Submission

```text
VALIDATING -> QUEUED | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED
QUEUED -> RUNNING | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
RUNNING -> PARTIAL | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
PARTIAL -> QUEUED | RUNNING | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED
ACTION_REQUIRED -> QUEUED | RUNNING | FAILED | CANCEL_REQUESTED | CANCELLED
FAILED -> QUEUED | RUNNING                    only with a new Retry Attempt
CANCELLED -> QUEUED | RUNNING                 only with a new Retry Attempt
CANCEL_REQUESTED -> CANCELLED | PARTIAL | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> QUEUED | RUNNING | PARTIAL | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | CANCELLED
SUCCEEDED -> no edge
```

Submission state is derived from locked Item states by the Server Coordinator.

### 4.2 Item

```text
VALIDATING -> QUEUED | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED
QUEUED -> RUNNING | ACTION_REQUIRED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
RUNNING -> ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
ACTION_REQUIRED -> QUEUED | RUNNING | FAILED | CANCEL_REQUESTED | CANCELLED
FAILED -> QUEUED | RUNNING                    only with a new Retry Attempt
CANCELLED -> QUEUED | RUNNING                 only with a new Retry Attempt
CANCEL_REQUESTED -> CANCELLED | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> QUEUED | RUNNING | ACTION_REQUIRED | SUCCEEDED | FAILED | CANCEL_REQUESTED | CANCELLED
SUCCEEDED -> no edge
```

A successful Item's produced Source and SourceVersion cannot change.

### 4.3 Intake Attempt

```text
ACCEPTED -> RUNNING | CANCEL_REQUESTED | FAILED | OUTCOME_INDETERMINATE
RUNNING -> SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
CANCEL_REQUESTED -> CANCELLED | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> RUNNING | SUCCEEDED | FAILED | CANCELLED
SUCCEEDED | FAILED | CANCELLED -> no edge
```

### 4.4 URL Acquisition Attempt

```text
VALIDATING -> CONNECTING | FAILED | CANCEL_REQUESTED
CONNECTING -> READING | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
READING -> SUCCEEDED | FAILED | CANCEL_REQUESTED | OUTCOME_INDETERMINATE
CANCEL_REQUESTED -> CANCELLED | SUCCEEDED | FAILED | OUTCOME_INDETERMINATE
OUTCOME_INDETERMINATE -> CONNECTING | READING | SUCCEEDED | FAILED | CANCELLED
SUCCEEDED | FAILED | CANCELLED -> no edge
```

## 5. Trigger names and behavior

Migration 020 creates exactly these trigger functions or repository-standard
names with identical meaning:

```text
source_product.enforce_submission_transition
source_product.enforce_item_transition
source_product.enforce_attempt_transition
source_product.enforce_url_attempt_transition
source_product.validate_duplicate_decision
source_product.validate_duplicate_disposition
source_product.validate_url_attempt_item
source_product.reject_immutable_change
```

Mutable transition triggers are `BEFORE UPDATE`. They validate the state edge,
set the revision to `OLD + 1`, set `updated_at = clock_timestamp()`, and enforce
terminal timestamps. Retry-only reopening verifies a new higher-numbered Retry
Attempt in the same transaction.

Decision/Disposition/Receipt immutability triggers reject every `UPDATE` and
`DELETE`. `TRUNCATE` is not granted to the Product runtime role.

## 6. Exact Command operation bindings

```text
sources.intake.submit.v1
  -> one intake_submissions.create_command_id
  -> one intake_attempts row per accepted Item

sources.intake.retry.v1
  -> one new intake_attempts row per selected Item

sources.intake.cancel.v1
  -> one new intake_attempts row per cancellable Item

sources.duplicate.resolve.v1
  -> one exact_duplicate_dispositions.command_id
```

All command IDs reference the existing `frontend_command.command_ledger` with
`ON DELETE RESTRICT`. Ledger payloads contain only safe manifests, hashes and
Server staging references. They never contain original Direct Text, Base64 file
bytes, local paths, Cookies, Authorization values or credential-bearing URLs.

## 7. Preflight and Up-only rollback

Preflight verifies exact target column types and migration 001–019 registration.
It stops on any incompatible pre-existing `source_product` object. Migration 020
is not a repair migration for an unknown partial schema.

No Down migration is created. Operational rollback is application Compatibility
mode with Product writes disabled. Accepted rows remain. Any destructive cleanup
is a separately approved forward operation.

## 8. Approval package conclusion

The Parent Candidate plus this Appendix satisfies the confirmed Revision 2
conditions:

- exact Migration number, schema, seven relations and types;
- exact PK/FK/RESTRICT/nullability/unique/check/index meaning;
- exact states, edges, terminal behavior and monotonic revisions;
- ADR-116 Command sequence and recovery;
- existing Stage 2/Asset ownership and transaction linkage;
- zero historical Product backfill;
- URL secret, redaction, observation and retention boundaries;
- Up-only Compatibility rollback;
- Fresh/upgrade/repeat/concurrency/fault-injection verification plan.

Migration SQL creation and execution remain prohibited until the user explicitly
approves this Revision 2 package.
