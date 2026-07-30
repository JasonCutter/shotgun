# Frontend Phase 2 Section 1 Migration Approval Candidate

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-260730001`
- Date: 2026-07-30
- Base SHA: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: [#46](https://github.com/JasonCutter/shotgun/pull/46)
- Status: **REVIEW_CONFIRMED / REVISION_REQUIRED**
- Review decision confirmed by: user, 2026-07-30
- Migration implementation or execution: **NOT APPROVED**
- Runtime dependency change: **NONE**

## 1. Decision requested

Approve an additive persistence migration for the ADR-122 Sources Product
intake boundary. The current schema owns immutable Source, SourceVersion,
Original Asset, Storage Receipt, Evidence and Command Ledger outcomes, but it
does not own the Product-facing intake lifecycle, exact-duplicate decision, or
secure URL acquisition provenance required by frozen AC-06 and AC-09 through
AC-19.

The browser and the untyped Command Ledger payload are not acceptable substitute
owners. Until approval and activation, the UI permits project-fixed
route-scoped draft preparation but keeps every submission action disabled.

This Revision 1 candidate is retained as the original proposal and review
baseline. It is not an executable migration authorization. A DDL-level Revision
2 must satisfy the confirmed review conditions in Section 8 before a new
approval decision is requested.

## 2. Proposed additive ownership

Exact names may be normalized during implementation to the repository migration
conventions, but the semantic ownership and constraints below are fixed.

| Additive relation                     | Owned meaning                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `source_intake_submissions`           | server-created submission identity, Principal, Session, Project, state, policy binding and monotonic revision     |
| `source_intake_submission_items`      | immutable accepted input manifest, per-item state, validation result, produced Source/SourceVersion and attention |
| `source_intake_attempts`              | explicit retry/cancel attempt history, request identity, transition result and safe failure                       |
| `source_exact_duplicate_decisions`    | server content-hash match, authorized existing identity, allowed dispositions and decision revision               |
| `source_exact_duplicate_dispositions` | one immutable accepted user disposition with stale-decision precondition                                          |
| `source_url_acquisition_attempts`     | bounded server acquisition attempt, outcome, limits and safe failure                                              |
| `source_url_provenance_receipts`      | requested/final URL, validated redirect and DNS/IP observations, content metadata and immutable receipt revision  |

Sensitive response headers, credentials, raw DNS resolver output not required
for replay, private-address values rejected by policy, and original content
bytes do not belong in browser projections. Original bytes continue to use the
existing Original Asset storage boundary.

## 3. Required constraints and transaction boundary

- All identities are server-created. No browser-supplied Source, SourceVersion,
  Project, Principal, submission, decision or receipt identity becomes
  authority.
- Every row is Project-bound and references the existing Principal, Session,
  Command Ledger, Source, SourceVersion and Original Asset owners where
  applicable.
- A submission item can produce at most one accepted SourceVersion result.
- A duplicate decision can receive at most one accepted disposition.
- URL receipt revisions are immutable; a new acquisition attempt creates a new
  receipt rather than overwriting historical evidence.
- Command acceptance, submission/item creation and the durable command outcome
  were proposed here as one atomic transaction. The confirmed review rejects
  that wording because it conflicts with the accepted Command Ledger recovery
  model. Revision 2 must use `ACCEPTED` before the Domain transaction,
  Domain commit through an explicit Unit of Work, and `COMPLETED` after commit,
  with commit-before-completion recovery through the original request identity.
- Existing Source/SourceVersion creation stays atomic with Original Asset and
  Storage Receipt persistence.
- Cancellation and retry are explicit commands. Transport retries never create
  a second semantic attempt silently.

## 4. Expand, Compatibility, Activate

### Expand

1. Add nullable/additive relations, enums/check constraints, indexes and foreign
   keys without changing or removing existing V1 columns or routes.
2. Deploy adapters that can write the new records while existing Stage 2 and V1
   Product flows continue unchanged.
3. Add deterministic integrity validation and database contract tests.

### Compatibility

1. Existing V1 direct-text/file intake remains readable and executable.
2. Existing Sources lacking Product intake rows are projected through the
   current Source/SourceVersion compatibility adapter.
3. A deterministic backfill creates compatibility records only when a unique
   existing owner can be proven. Re-running it is a no-op through stable natural
   keys and conflict checks.
4. Ambiguous historical data is reported and left unchanged; it is never
   guessed into a submission, duplicate decision or URL receipt.

### Activate

1. Enable the versioned Sources submission, outcome recovery, cancellation,
   retry and duplicate disposition Product routes.
2. Enable URL acquisition only after SSRF, redirect, DNS rebinding, size,
   timeout, content-type and credential-redaction negative suites pass.
3. Enable the browser Submit action only after Product API, database,
   integration and recovery gates pass.

No V1 relation, route, decoder or compatibility adapter is removed during this
Section.

## 5. Backfill, rollback and data impact

The backfill must be deterministic and re-entrant. Stable keys are derived only
from existing authoritative database identities; timestamps and random values
must not decide whether two executions create different rows. Validation emits
counts for eligible, inserted, already-present, ambiguous and rejected records.

The confirmed review rejects normal DDL deletion as the primary rollback model
because the current migration runner is Up-only. Operational rollback must
return the Product route to Compatibility mode, disable new writes and preserve
accepted records. Any destructive cleanup requires a separately approved
cleanup script and disposable-database drill.

Expected data impact is additive metadata and attempt history. Existing Original
Asset bytes, Source/SourceVersion identities, Evidence, Command Ledger V1/V2
records and APIs remain unchanged.

## 6. Required implementation evidence after approval

- migration apply, repeat apply/backfill and compatibility verification
- rollback drill for pre-Activate and post-Activate compatibility modes
- Command `ACCEPTED`, Domain Unit of Work, post-commit `COMPLETED` and
  commit-before-completion recovery fault injection
- idempotency and semantic-digest mismatch tests
- exact duplicate race and stale-decision tests
- explicit cancel/retry and `OUTCOME_UNKNOWN` recovery tests
- URL SSRF, redirect loop, cross-scheme redirect, DNS rebinding, private/reserved
  address, credential, response-size, timeout and content-type negative corpus
- PostgreSQL database, Product contract, integration, security and browser E2E
- updated AC-06 and AC-09 through AC-19 traceability evidence

## 7. Explicit exclusions

- no new runtime dependency
- no V1 contract removal or schema contraction
- no browser persistence of raw text, file bytes, URLs or server identities
- no automatic duplicate merge
- no Phase 2 Section 2 work
- no PR Ready transition, merge or Phase 2 completion declaration

## 8. Confirmed review outcome and Revision 2 conditions

The user confirmed the following review result on 2026-07-30:

```text
Architecture direction: ACCEPTABLE
Revision 1 migration authorization: NOT APPROVED
Required next artifact: DDL-level Migration Approval Candidate Revision 2
```

Revision 2 must fix all of the following before Migration creation or execution
can be approved:

1. Reserve the next additive migration as `020_...` and define the exact Product
   Intake schema, table names, columns and PostgreSQL types.
2. Define every primary key, foreign key, `ON DELETE` behavior, nullability,
   unique constraint, check constraint, index and lock/serialization strategy.
3. Define Submission, Item, Attempt, Duplicate Decision, Disposition, URL
   Acquisition and Receipt state transitions, terminal states and monotonic
   revision rules.
4. Preserve the accepted Command Ledger sequence:
   `ACCEPTED` durable before Domain work, Domain Unit of Work commit,
   `COMPLETED` after commit, and recovery of commit-before-completion through the
   original `clientRequestId` and command identity.
5. Define the exact link from each Product Submission Item to the existing
   `intake.submissions`, `asset.original_assets`, `asset.sources`,
   `asset.source_versions` and `asset.storage_receipts` owners without creating
   a second Source or Original Asset persistence model.
6. Limit legacy backfill to provable `LEGACY_COMPATIBILITY` ownership. Do not
   fabricate historical Session, retry/cancel Attempt, duplicate Decision or
   URL provenance records.
7. Define URL userinfo rejection, query-secret redaction, Cookie and
   Authorization non-storage, safe DNS/IP observation representation, Browser
   and log masking, retention and deletion policy.
8. Define operational rollback as Compatibility-mode application rollback and
   write deactivation. Treat DDL cleanup as a separate destructive operation.
9. Provide Fresh Database, `001` through `019` upgrade, repeat apply/backfill,
   ambiguous-data preflight, concurrency, stale-decision and fault-injection
   test plans.
10. Preserve all frozen AC meanings, ADR-122 authority boundaries, V1
    compatibility, no new Runtime Dependency, Draft PR status and no merge or
    completion claim.

Until Revision 2 is reviewed and explicitly approved, Migration SQL creation,
local or remote execution, Product route activation and Browser Submit enablement
remain prohibited.
