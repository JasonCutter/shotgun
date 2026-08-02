# Frontend Phase 2 Section 1 Migration Approval Candidate — Revision 2 Final

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-revision-2-260730001`
- Date: 2026-07-30
- Canonical Base SHA: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: [#46](https://github.com/JasonCutter/shotgun/pull/46)
- Governing ADR: ADR-122
- Frozen Contract: Frontend Phase 2 Section 1 AC-01 through AC-32
- Supersedes: Revision 1 and the Revision 2 working draft in
  `frontend-phase-2-section-1-migration-approval-candidate-260730001.md`
- Status: **REVIEWED / READY FOR USER APPROVAL**
- Migration SQL creation or execution: **NOT YET APPROVED**
- Product activation: **NOT APPROVED**
- Runtime dependency change: **NONE**

## 1. Approval requested

Approve creation and isolated development/CI execution of one additive migration:

```text
020_frontend_phase2_sources_product_persistence.sql
```

Approval of this Candidate would authorize Migration 020 implementation,
transaction-aware adapters, database reset/verify changes and the required test
suite. It would not authorize Sources write-route activation, Browser Submit,
PR Ready transition, merge or Section completion.

## 2. Fixed ownership

Existing owners remain authoritative:

| Meaning                                     | Existing owner                                               |
| ------------------------------------------- | ------------------------------------------------------------ |
| normalized Stage 2 input                    | `intake.submissions`                                         |
| immutable original bytes                    | `asset.original_assets` plus the existing Asset Storage Port |
| logical Source                              | `asset.sources`                                              |
| immutable SourceVersion                     | `asset.source_versions`                                      |
| Stage 2 storage result                      | `asset.storage_receipts`                                     |
| command acceptance, idempotency and outcome | `frontend_command.command_ledger`                            |
| Principal, Session and Project              | `auth.principals`, `auth.sessions`, `project_admin.projects` |

The new exact schema is `source_product`. It owns Product lifecycle, attempt,
duplicate-choice and URL provenance metadata only. It does not create a second
Source, SourceVersion, OriginalAsset or Command outcome model.

## 3. Migration file and existing-owner additions

The only Migration filename allowed by this Candidate is:

```text
db/migrations/020_frontend_phase2_sources_product_persistence.sql
```

Migration 020 creates these additive support indexes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS asset_sources_project_source_uidx
  ON asset.sources (project_id, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS asset_source_versions_source_version_uidx
  ON asset.source_versions (source_id, source_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS asset_source_versions_asset_version_uidx
  ON asset.source_versions (original_asset_id, source_version_id);
```

No existing column, relation, route, decoder or V1 meaning is removed or
contracted.

## 4. Exact seven-relation model

All primary identities are Server-generated UUIDs except `command_id`, which
uses the existing Command Ledger `text` identity, and existing Project IDs,
which remain `text`.

### 4.1 `source_product.intake_submissions`

| Column                       | PostgreSQL type | Null | Rule                                                                         |
| ---------------------------- | --------------: | ---: | ---------------------------------------------------------------------------- |
| `submission_id`              |          `uuid` |   no | primary key, Server-generated                                                |
| `project_id`                 |          `text` |   no | FK `project_admin.projects(id)` `ON DELETE RESTRICT`                         |
| `principal_id`               |          `uuid` |   no | FK `auth.principals(principal_id)` `ON DELETE RESTRICT`                      |
| `session_id`                 |          `uuid` |   no | FK `auth.sessions(session_id)` `ON DELETE RESTRICT`                          |
| `create_command_id`          |          `text` |   no | unique FK `frontend_command.command_ledger(command_id)` `ON DELETE RESTRICT` |
| `state`                      |          `text` |   no | Submission state set below                                                   |
| `origin_kind`                |          `text` |   no | `NATIVE` or reserved `LEGACY_COMPATIBILITY`; default `NATIVE`                |
| `accepted_policy_context_id` |          `text` |   no | non-empty, maximum 512 characters                                            |
| `accepted_policy_binding`    |         `jsonb` |   no | JSON object, Server-accepted safe binding                                    |
| `access_revision`            |          `text` |   no | non-empty, maximum 512 characters                                            |
| `policy_context_revision`    |          `text` |   no | non-empty, maximum 512 characters                                            |
| `submission_revision`        |        `bigint` |   no | starts at 1, monotonic                                                       |
| `created_at`                 |   `timestamptz` |   no | Server time                                                                  |
| `updated_at`                 |   `timestamptz` |   no | Server time, not before `created_at`                                         |
| `completed_at`               |   `timestamptz` |  yes | required only for `SUCCEEDED`, `FAILED`, `CANCELLED`                         |

Required unique/index shape:

- `UNIQUE (project_id, submission_id)`;
- `INDEX (project_id, updated_at DESC, submission_id)`;
- partial attention index on `PARTIAL`, `ACTION_REQUIRED`, `FAILED`,
  `OUTCOME_INDETERMINATE`.

### 4.2 `source_product.intake_submission_items`

`submission_item_id` is authority. `client_item_id` is bounded correlation only.

| Column                         | PostgreSQL type | Null | Rule                                                                       |
| ------------------------------ | --------------: | ---: | -------------------------------------------------------------------------- |
| `submission_item_id`           |          `uuid` |   no | primary key, Server-generated                                              |
| `project_id`                   |          `text` |   no | part of composite Submission FK                                            |
| `submission_id`                |          `uuid` |   no | composite FK to `intake_submissions(project_id, submission_id)` `RESTRICT` |
| `client_item_id`               |          `text` |   no | 1–200 characters; unique per Submission                                    |
| `ordinal`                      |       `integer` |   no | zero or greater; unique per Submission                                     |
| `input_kind`                   |          `text` |   no | `DIRECT_TEXT`, `FILE`, `URL`                                               |
| `label`                        |          `text` |   no | trimmed, 1–500 characters                                                  |
| `input_manifest`               |         `jsonb` |   no | safe JSON object; never original bytes                                     |
| `state`                        |          `text` |   no | Item state set below                                                       |
| `validation_results`           |         `jsonb` |   no | JSON array; default `[]`                                                   |
| `content_hash`                 |          `text` |  yes | `sha256:` plus 64 lowercase hex characters                                 |
| `media_type`                   |          `text` |  yes | bounded Server-validated value                                             |
| `size_bytes`                   |        `bigint` |  yes | greater than zero                                                          |
| `stage2_submission_id`         |          `text` |  yes | when present equals `submission_item_id::text`                             |
| `produced_source_id`           |          `uuid` |  yes | composite Project/Source FK                                                |
| `produced_source_version_id`   |          `uuid` |  yes | composite Source/Version FK                                                |
| `active_duplicate_decision_id` |          `uuid` |  yes | composite Item/Decision FK added after Decision table                      |
| `attention_reason`             |          `text` |  yes | maximum 2,000 characters                                                   |
| `safe_failure_code`            |          `text` |  yes | all three failure fields null or present                                   |
| `safe_failure_message`         |          `text` |  yes | maximum 2,000 characters                                                   |
| `safe_failure_retryable`       |       `boolean` |  yes | all three failure fields null or present                                   |
| `item_revision`                |        `bigint` |   no | starts at 1, monotonic                                                     |
| `created_at`                   |   `timestamptz` |   no | Server time                                                                |
| `updated_at`                   |   `timestamptz` |   no | Server time                                                                |
| `completed_at`                 |   `timestamptz` |  yes | terminal Item states only                                                  |

Required foreign keys and checks:

- `(project_id, stage2_submission_id)` references
  `intake.submissions(project_id, submission_id)` `ON DELETE RESTRICT`;
- the same pair references
  `asset.storage_receipts(project_id, submission_id)` `ON DELETE RESTRICT`;
- `(project_id, produced_source_id)` references
  `asset.sources(project_id, source_id)` `ON DELETE RESTRICT`;
- `(produced_source_id, produced_source_version_id)` references
  `asset.source_versions(source_id, source_version_id)` `ON DELETE RESTRICT`;
- produced Source and SourceVersion are either both null or both present;
- `UNIQUE (submission_id, client_item_id)`;
- `UNIQUE (submission_id, ordinal)`;
- `UNIQUE (project_id, stage2_submission_id)`;
- `UNIQUE (project_id, submission_id, submission_item_id)`;
- `UNIQUE (submission_item_id, content_hash)`.

`stage2_submission_id` is set only when the same Domain transaction creates the
existing Stage 2 Submission and StorageReceipt. Failed pre-Stage-2 Items leave it
null.

### 4.3 `source_product.intake_attempts`

One accepted submit/retry/cancel command creates one Attempt per targeted Item.

| Column                       | PostgreSQL type |  Null | Rule                                                             |
| ---------------------------- | --------------: | ----: | ---------------------------------------------------------------- |
| `intake_attempt_id`          |          `uuid` |    no | primary key, Server-generated                                    |
| `project_id`                 |          `text` |    no | composite Item FK                                                |
| `submission_id`              |          `uuid` |    no | composite Item FK                                                |
| `submission_item_id`         |          `uuid` |    no | composite Item FK `RESTRICT`                                     |
| `command_id`                 |          `text` |    no | FK Command Ledger `RESTRICT`                                     |
| `attempt_number`             |       `integer` |    no | greater than zero, unique per Item                               |
| `attempt_kind`               |          `text` |    no | `SUBMIT`, `RETRY_SAME_CONTEXT`, `RETRY_CURRENT_POLICY`, `CANCEL` |
| `state`                      |          `text` |    no | Attempt state set below                                          |
| `correlation_id`             |          `text` |    no | non-empty, maximum 512 characters                                |
| `causation_attempt_id`       |          `uuid` |   yes | same-Item composite self-FK `RESTRICT`                           |
| `accepted_policy_context_id` |          `text` |    no | bounded safe ID                                                  |
| `accepted_policy_binding`    |         `jsonb` |    no | JSON object                                                      |
| failure triple               |           mixed |   yes | code/message/retryable all null or all present                   |
| `attempt_revision`           |        `bigint` |    no | starts at 1, monotonic                                           |
| timestamps                   |   `timestamptz` | mixed | terminal completion rule                                         |

Required uniqueness/indexes:

- `UNIQUE (command_id, submission_item_id)`;
- `UNIQUE (submission_item_id, attempt_number)`;
- `UNIQUE (submission_item_id, intake_attempt_id)`;
- recovery index `(command_id, state)`;
- history index `(project_id, submission_id, submission_item_id, attempt_number DESC)`.

### 4.4 `source_product.exact_duplicate_decisions`

Decision rows are immutable snapshots. A stale context creates a new Decision
with the next per-Item revision; the prior row is not updated.

| Column                         | PostgreSQL type | Null | Rule                                           |
| ------------------------------ | --------------: | ---: | ---------------------------------------------- |
| `decision_id`                  |          `uuid` |   no | primary key, Server-generated                  |
| Project/Submission/Item triple |           mixed |   no | composite Item FK `RESTRICT`                   |
| `decision_revision`            |        `bigint` |   no | greater than zero, unique per Item             |
| `content_hash`                 |          `text` |   no | composite Item/hash FK                         |
| `existing_source_id`           |          `uuid` |   no | composite Project/Source FK                    |
| `existing_source_version_id`   |          `uuid` |   no | composite Source/Version FK                    |
| `allowed_dispositions`         |        `text[]` |   no | non-empty, no duplicates, approved values only |
| `observed_source_revision`     |          `text` |   no | bounded revision                               |
| `access_revision`              |          `text` |   no | bounded revision                               |
| `policy_context_revision`      |          `text` |   no | bounded revision                               |
| `supersedes_decision_id`       |          `uuid` |  yes | self-FK `RESTRICT`, not self                   |
| `created_at`                   |   `timestamptz` |   no | immutable                                      |

Approved disposition values are exactly:

```text
REUSE_EXISTING_VERSION
CREATE_VERSION_CANDIDATE
CREATE_SEPARATE_SOURCE
CANCEL_SUBMISSION
```

Required unique shapes:

- `(submission_item_id, decision_revision)`;
- `(submission_item_id, decision_id)`;
- `(decision_id, decision_revision)`;
- `(project_id, submission_id, submission_item_id, decision_id, decision_revision)`.

After this table is created, Item `active_duplicate_decision_id` receives a
composite `(submission_item_id, active_duplicate_decision_id)` FK to the Decision
`(submission_item_id, decision_id)` key.

### 4.5 `source_product.exact_duplicate_dispositions`

Disposition rows are immutable. Database uniqueness is the final concurrency
arbiter.

| Column                         | PostgreSQL type | Null | Rule                                         |
| ------------------------------ | --------------: | ---: | -------------------------------------------- |
| `disposition_id`               |          `uuid` |   no | primary key                                  |
| Project/Submission/Item triple |           mixed |   no | composite Item FK `RESTRICT`                 |
| `decision_id`                  |          `uuid` |   no | one disposition per Decision                 |
| `observed_decision_revision`   |        `bigint` |   no | composite full-context Decision FK           |
| `command_id`                   |          `text` |   no | unique Command Ledger FK `RESTRICT`          |
| `disposition`                  |          `text` |   no | approved value only                          |
| `target_source_id`             |          `uuid` |  yes | required only for `CREATE_VERSION_CANDIDATE` |
| `created_at`                   |   `timestamptz` |   no | immutable                                    |

The full composite FK is:

```text
(project_id, submission_id, submission_item_id, decision_id, observed_decision_revision)
-> exact_duplicate_decisions
(project_id, submission_id, submission_item_id, decision_id, decision_revision)
```

`UNIQUE (decision_id)` and `UNIQUE (command_id)` are mandatory.

### 4.6 `source_product.url_acquisition_attempts`

Only URL Items may own these rows.

| Column                         | PostgreSQL type |  Null | Rule                                                           |
| ------------------------------ | --------------: | ----: | -------------------------------------------------------------- |
| `url_acquisition_attempt_id`   |          `uuid` |    no | primary key                                                    |
| Project/Submission/Item triple |           mixed |    no | composite Item FK `RESTRICT`                                   |
| `intake_attempt_id`            |          `uuid` |    no | unique same-Item Attempt FK `RESTRICT`                         |
| `normalized_requested_url`     |          `text` |    no | 1–8,192 characters, HTTP(S), no fragment, passed secret checks |
| `redacted_requested_url`       |          `text` |    no | 1–8,192 characters, safe projection form                       |
| `state`                        |          `text` |    no | URL state set below                                            |
| limit columns                  |  integer/bigint |    no | positive, bounded by accepted policy                           |
| policy IDs/revision            |          `text` |    no | accepted Server policy                                         |
| `retention_class`              |          `text` |    no | non-empty, bounded                                             |
| `retention_expires_at`         |   `timestamptz` |   yes | not before creation                                            |
| failure triple                 |           mixed |   yes | all null or all present                                        |
| `acquisition_revision`         |        `bigint` |    no | starts at 1, monotonic                                         |
| timestamps                     |   `timestamptz` | mixed | terminal completion rule                                       |

Mandatory limits:

- redirects: 0–20;
- every timeout greater than zero;
- compressed and decompressed limits greater than zero;
- decompressed limit not below compressed limit.

Required unique shape for receipt linkage:

```text
(project_id, submission_id, submission_item_id, url_acquisition_attempt_id)
```

### 4.7 `source_product.url_provenance_receipts`

Each terminal URL Acquisition Attempt creates exactly one immutable Receipt,
including a safe Receipt for failure or cancellation.

| Column                         | PostgreSQL type |  Null | Rule                                               |
| ------------------------------ | --------------: | ----: | -------------------------------------------------- |
| `url_provenance_receipt_id`    |          `uuid` |    no | primary key                                        |
| Project/Submission/Item triple |           mixed |    no | composite Item FK `RESTRICT`                       |
| `url_acquisition_attempt_id`   |          `uuid` |    no | unique full-context Attempt FK `RESTRICT`          |
| `receipt_revision`             |        `bigint` |    no | exactly 1; retry creates a new Attempt and Receipt |
| `outcome`                      |          `text` |    no | `SUCCEEDED`, `FAILED`, `CANCELLED`                 |
| redacted URL fields            |          `text` | mixed | safe forms only                                    |
| `redirect_chain_digest`        |          `text` |    no | SHA-256 form                                       |
| `redirect_observations`        |         `jsonb` |    no | bounded JSON array                                 |
| `dns_observations`             |         `jsonb` |    no | bounded safe JSON array                            |
| response metadata fields       |           mixed |   yes | allowlisted only                                   |
| `content_hash`                 |          `text` |   yes | required for success                               |
| `original_asset_id`            |          `uuid` |   yes | success-only                                       |
| `source_version_id`            |          `uuid` |   yes | success-only                                       |
| `failure_code`                 |          `text` |   yes | required for failure                               |
| retention fields               |           mixed | mixed | accepted policy                                    |
| timestamps                     |   `timestamptz` | mixed | retrieval and creation evidence                    |

The full Attempt FK is:

```text
(project_id, submission_id, submission_item_id, url_acquisition_attempt_id)
-> url_acquisition_attempts
(project_id, submission_id, submission_item_id, url_acquisition_attempt_id)
```

The successful Asset/Version pair uses:

```text
(original_asset_id, source_version_id)
-> asset.source_versions(original_asset_id, source_version_id)
```

Success requires final redacted URL, content hash, OriginalAsset,
SourceVersion and retrieval time. Failure/cancellation prohibits Asset and
SourceVersion references. `UNIQUE (url_acquisition_attempt_id)` is mandatory.

## 5. State and revision contract

### Submission states

```text
VALIDATING
QUEUED
RUNNING
PARTIAL
ACTION_REQUIRED
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
OUTCOME_INDETERMINATE
```

### Item states

```text
VALIDATING
QUEUED
RUNNING
ACTION_REQUIRED
SUCCEEDED
FAILED
CANCEL_REQUESTED
CANCELLED
OUTCOME_INDETERMINATE
```

### Attempt states

```text
ACCEPTED
RUNNING
CANCEL_REQUESTED
SUCCEEDED
FAILED
CANCELLED
OUTCOME_INDETERMINATE
```

### URL Acquisition states

```text
VALIDATING
CONNECTING
READING
CANCEL_REQUESTED
SUCCEEDED
FAILED
CANCELLED
OUTCOME_INDETERMINATE
```

Migration 020 creates transition triggers for all mutable relations. They:

1. reject an unapproved state edge;
2. set revision to exactly `OLD + 1`;
3. set `updated_at` on the Server;
4. preserve terminal timestamps;
5. reject revision reuse or decrease.

The application uses `WHERE revision = observedRevision` for optimistic
concurrency.

`SUCCEEDED` is terminal for Submission and Item. `FAILED` or `CANCELLED` may
return to `QUEUED`/`RUNNING` only in the same transaction that inserts a new
higher-numbered Retry Attempt. Attempts and URL Attempts never reopen; retry
creates new rows.

Decision, Disposition and Receipt relations reject every `UPDATE` and `DELETE`.

## 6. Command Ledger and safe ingress

The accepted sequence is unchanged:

```text
Frontend Command ACCEPTED commit
-> Sources Domain Unit of Work commit
-> same Frontend Command COMPLETED or REJECTED
```

A commit-before-Ledger-completion failure is repaired through the original
`principal_id`, `clientRequestId` and `command_id`. Product rows bind the command
through Submission, Attempt or Disposition foreign keys. Ledger
`produced_resources` remains a typed projection, not the owner.

### Direct Text and File transport separation

The current Candidate code type that places direct text or Base64 file bytes in
the Frontend Command payload is not activation-safe and must be replaced before
Migration 020 Product writes are enabled.

Required ingress sequence:

1. the protected Sources transport accepts the stream/body outside the generic
   JSON Ledger payload;
2. the Server validates limits, computes content hash and writes immutable bytes
   through the existing Asset Storage Port using a server staging reference;
3. the accepted Frontend Command payload contains only safe manifests, content
   hashes and server-issued staging references;
4. `frontend_command.command_ledger.command_payload` never stores direct text,
   Base64 file bytes, local paths or original content;
5. the Domain Unit of Work binds the staged bytes to existing
   `asset.original_assets` and removes or expires an unreferenced staging
   reference according to existing storage policy.

The staging reference is not a Source identity and is not exposed as Browser
authority. No new Runtime Dependency is required.

URL commands likewise enter the Ledger only after URL normalization and
credential/query-secret rejection. Cookie and Authorization values never enter
the request, Ledger, Product tables or logs.

## 7. Stage 2 transaction boundary

A `SourcesIntakeUnitOfWorkPort` or equivalent uses one PostgreSQL `PoolClient`
for Product rows and existing Stage 2/Asset rows.

The same transaction performs:

1. Product Submission/Item/Attempt mutation;
2. existing `intake.submissions` insert;
3. existing OriginalAsset reuse/creation;
4. existing Source/SourceVersion resolution;
5. existing `asset.storage_receipts` insert;
6. Product produced-resource binding;
7. URL Receipt insert when applicable.

For every accepted Item:

```text
stage2_submission_id = submission_item_id::text
```

The current `PostgresOriginalAssetRepository.store()` opens its own transaction.
Implementation must extract a client-bound path or equivalent and must not nest
that independent transaction inside the Product Unit of Work. The standalone
Stage 2 API remains compatible.

## 8. Duplicate serialization

Lock order is fixed:

1. Command already durable as `ACCEPTED`;
2. advisory transaction lock on `project_id + submission_id`;
3. Submission `FOR UPDATE`;
4. targeted Items ordered by Item ID `FOR UPDATE`;
5. active Decisions ordered by Decision ID `FOR UPDATE`;
6. referenced Sources/Versions in stable ID order;
7. writes and commit.

A disposition transaction verifies active Decision pointer, Decision revision,
Source revision, access revision, policy revision, allowed disposition and
target Source. `UNIQUE (decision_id)` is the final arbiter. A race returns a
typed conflict and never silently reuses, versions or merges a Source.

## 9. URL security, redaction and retention

Before Command acceptance:

- only HTTP(S) is allowed;
- userinfo and fragments are rejected/removed;
- sensitive query-key names and credential-shaped values are rejected unless an
  approved Connector supplies a Connector reference;
- Cookie, Authorization and Proxy-Authorization input is prohibited;
- every redirect repeats protocol, DNS, IP, egress, limit and credential checks;
- loopback, private, link-local, multicast, reserved and metadata-service ranges
  fail closed;
- DNS rebinding and unapproved address-set change fail closed.

Browser and log views use redacted URLs only. Query values are replaced by a
fixed marker. DNS/redirect observations contain only bounded safe fields:
ordinal, time, scheme, redacted host/location, address family/class, normalized
address-set digest and validation outcome. Raw resolver packets, rejected
private-address values, arbitrary headers, response bodies and credentials are
not stored.

Response metadata is allowlisted. Set-Cookie, authentication challenges and
arbitrary headers are prohibited.

`retention_class` and `retention_expires_at` come from the accepted Server policy.
Expired records cannot authorize a new fetch or retry. Destructive audit-row
redaction/deletion is not part of Migration 020 and requires a separate approved
retention operation.

## 10. Legacy compatibility and backfill

Migration 020 performs no historical Product-row backfill.

Existing Sources continue through the current Source/SourceVersion compatibility
projection. Migration 020 does not fabricate Session, Submission, Attempt,
Duplicate Decision/Disposition or URL provenance history.

`LEGACY_COMPATIBILITY` is reserved for a later separately approved backfill only
when historical Principal, Session, Project, Stage 2 Submission and policy
binding are all provable. With migrations 001–019, the eligible count is zero.

## 11. Expand, Compatibility, Activate and rollback

### Expand

- preflight exact migrations 001–019 and target key types;
- create schema, seven relations, support indexes, constraints and triggers;
- update database reset/verify coverage;
- do not activate writes.

### Compatibility

- read legacy Source projections and optional Product rows;
- keep submit/retry/cancel/duplicate/URL writes disabled;
- report integrity and compatibility counts;
- insert no historical Product rows.

### Activate

Not authorized by Candidate approval. Activation requires later exact-Head
Product, database, URL-security, recovery, accessibility and E2E evidence plus
separate user approval.

### Rollback

The migration runner is Up-only. Operational rollback is:

```text
Sources Intake mode -> COMPATIBILITY
new Product writes -> disabled
accepted records -> preserved
```

No normal schema downgrade or table drop is allowed. Destructive cleanup is a
separate forward migration/script approval.

## 12. Required verification

Migration implementation must prove:

- Fresh Database apply through 020;
- exact 001–019 upgrade to 020;
- repeated `db:migrate` no-op;
- `db:reset` and `db:verify` coverage;
- no historical Product rows inserted;
- all PK/FK/RESTRICT/unique/check/index contracts;
- allowed and forbidden transitions;
- revision conflict and immutable-row rejection;
- Stage 2 and Product atomic fault injection at every write boundary;
- ACCEPTED/Domain/COMPLETED and commit-before-completion recovery;
- semantic mismatch and transport replay;
- duplicate race and stale Decision;
- retry/cancel concurrency;
- URL SSRF, DNS rebinding, redirects, credentials, limits, content type and
  redaction corpus;
- Direct Text/File Ledger payload contains no original bytes;
- Product API, security, database and Chromium E2E;
- updated AC-06, AC-09 through AC-19 and AC-30 evidence.

## 13. Approval boundary

Approval authorizes only:

1. Migration 020 SQL creation;
2. required Unit of Work, safe ingress, reset/verify and tests;
3. isolated development and CI database execution;
4. Draft PR #46 evidence updates.

Still excluded:

- Product write activation and Browser Submit;
- new Runtime Dependency;
- V1 removal or schema contraction;
- PR Ready transition or merge;
- Section completion or Phase 2 Section 2.
