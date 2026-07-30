# Frontend Phase 2 Section 1 Migration Approval Candidate Revision 2 Review

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-revision-2-review-260730001`
- Date: 2026-07-30
- Repository: `JasonCutter/shotgun`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: [#46](https://github.com/JasonCutter/shotgun/pull/46)
- Review result: **PASS / READY FOR USER DECISION**
- Migration implementation or execution: **NOT YET APPROVED**
- Product activation: **NOT APPROVED**
- Ready transition and merge: **NOT APPROVED**

## 1. Reviewed package

1. `frontend-phase-2-section-1-migration-approval-candidate-revision-2-260730001.md`
2. `frontend-phase-2-section-1-migration-approval-candidate-revision-2-ddl-appendix-260730001.md`
3. `frontend-phase-2-section-1-migration-approval-candidate-revision-2-stage2-compatibility-amendment-260730001.md`

The working-draft file
`frontend-phase-2-section-1-migration-approval-candidate-260730001.md` remains as
history and is not the approval authority.

## 2. Canonical and implementation references checked

- ADR-122 Sources Product authority and lifecycle boundary;
- frozen AC-01 through AC-32 Contract Snapshot;
- ADR-116 and the Frontend Command Ledger V2 persistence contract;
- Migration 002 Stage 2 Intake and Asset schema;
- Migration 018 Frontend Command Request/Outcome schema;
- Migration 019 Principal/Project/Resource scope compatibility;
- current PostgreSQL Intake, OriginalAsset and Command Gateway adapters;
- current Up-only migration runner and reset/verify behavior;
- current Sources Product contracts and Draft PR #46 implementation state.

## 3. Confirmed Revision 2 condition matrix

| Condition | Result | Review conclusion |
|---|---|---|
| exact Migration number and file | `PASS` | `020_frontend_phase2_sources_product_persistence.sql` only |
| exact Product schema and seven relations | `PASS` | `source_product` and seven fixed relations |
| exact columns and PostgreSQL types | `PASS` | Final Candidate plus Normative DDL Appendix removes shorthand |
| PK/FK/RESTRICT/nullability/unique/check/index | `PASS` | full-context composite keys prevent cross-Item/Project misbinding |
| state transitions and monotonic revisions | `PASS` | exact Edge matrix and trigger behavior fixed |
| ADR-116 Command ordering | `PASS` | durable `ACCEPTED`, Domain commit, post-commit `COMPLETED` |
| Stage 2/Asset ownership linkage | `PASS` | one client-bound Unit of Work, deterministic Item-to-Stage-2 identity |
| non-fabricating legacy compatibility | `PASS` | Migration 020 historical Product backfill count is zero |
| URL security/redaction/retention | `PASS` | secret rejection, safe observation set, policy-derived retention |
| Up-only rollback | `PASS` | Compatibility mode and write deactivation; no normal DDL downgrade |
| Fresh/upgrade/repeat/concurrency/fault tests | `PASS` | required evidence is explicit |
| no Runtime Dependency or AC weakening | `PASS` | none proposed; frozen AC meanings retained |

## 4. Review findings resolved during Revision 2

### 4.1 Command transaction conflict

Revision 1 incorrectly grouped Command acceptance, Domain writes and Command
completion into one atomic transaction. Revision 2 now preserves the accepted
Command Gateway model:

```text
Command ACCEPTED commit
-> Sources Domain Unit of Work commit
-> Command COMPLETED/REJECTED update
```

Commit-before-completion recovery uses the original request and command identity.

### 4.2 Raw content in Command Ledger

The current candidate code type carries Direct Text and Base64 file content in
the generic command payload. Revision 2 correctly treats this as not
activation-safe. Protected transport ingress, existing Asset Storage staging and
a safe Ledger manifest are required before write activation. Original content,
local paths and credentials may not enter `command_payload`.

### 4.3 Cross-owner transaction gap

The current OriginalAsset PostgreSQL adapter opens its own transaction. Revision
2 requires a transaction-aware Stage 2/Asset path using the same `PoolClient` as
the Product Unit of Work. It preserves the standalone Stage 2 API and prevents a
Product Item from committing without its Stage 2/StorageReceipt binding.

### 4.4 Duplicate and URL misbinding

The Normative DDL Appendix adds full-context composite foreign keys and unique
keys. A Disposition cannot point to a Decision from another Item, and a URL
Receipt cannot point to an Acquisition Attempt, OriginalAsset or SourceVersion
from another context.

### 4.5 Stage 2 URL provenance conflict

Migration 002 permits only `direct_text` and `file_upload`. Revision 2 adds the
compatible value `url_acquisition` to both Intake Submission and StorageReceipt
Channel checks. It prohibits falsely recording URL content as a file upload.

### 4.6 Current Stage 2 media and size limits

Revision 2 does not silently broaden format or body limits. Section 1 activation
remains limited to Plain Text/Markdown and 1 MiB for Direct Text, File and URL
body persistence. Larger or additional formats require a later approved
contract and migration.

### 4.7 Historical backfill

Existing migrations do not prove historical Session, policy, retry/cancel,
duplicate-choice or URL provenance. Revision 2 therefore performs no Product
history backfill and keeps legacy Sources in the compatibility projection.

### 4.8 Rollback mismatch

The repository migration runner is Up-only. Revision 2 defines operational
rollback as Compatibility mode plus write deactivation and preserves accepted
records. Destructive cleanup requires a separate forward operation and approval.

## 5. Residual implementation risks

These are required evidence, not unresolved architecture decisions:

- transaction-aware extraction from the current OriginalAsset adapter;
- durable and bounded unreferenced staging cleanup using existing storage policy;
- exact SQL trigger and constraint implementation matching the Appendix;
- URL acquisition security corpus and DNS rebinding simulation;
- migration preflight against exact Migration 002 constraint definitions;
- performance and concurrency behavior under multi-item submissions;
- full accessibility and Chromium E2E after Product writes are implemented.

A failure in any required test returns the Migration implementation to Draft and
blocks Activation, Ready transition and merge.

## 6. Approval recommendation

The Revision 2 package is sufficiently specific for a user decision.

Recommended decision:

```text
Approve Migration 020 creation and isolated development/CI execution only.
Do not approve Product activation, Browser Submit, PR Ready, merge or Section completion.
```

If approved, implementation must remain on Draft PR #46 and report:

- exact new Head SHA;
- Migration 020 SQL and schema diff;
- Stage 2 Channel compatibility changes;
- safe-ingress and Ledger payload proof;
- transaction/fault-injection evidence;
- database Fresh/Upgrade/Repeat results;
- URL security results;
- updated AC state.

## 7. Current boundary

```text
Revision 2 design review: PASS
Migration 020 implementation: AWAITING USER APPROVAL
Migration execution: AWAITING USER APPROVAL
Product activation: NOT APPROVED
Browser Submit: NOT APPROVED
PR Ready: NOT APPROVED
Merge: NOT APPROVED
Section completion: NOT APPROVED
Phase 2 Section 2: NOT STARTED
```
