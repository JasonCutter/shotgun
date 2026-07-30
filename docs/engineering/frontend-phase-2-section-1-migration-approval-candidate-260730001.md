# Frontend Phase 2 Section 1 Migration Approval Candidate

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-260730001`
- Date: 2026-07-30
- Base SHA: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: [#46](https://github.com/JasonCutter/shotgun/pull/46)
- Status: **APPROVAL_REQUIRED**
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
  are committed atomically. A partial database transaction cannot expose a
  created Source without its accepted item and outcome.
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

Rollback before Activate disables new writes and removes only unactivated
additive relations after an exported integrity report. Rollback after Activate
returns the Product route to Compatibility mode and preserves accepted intake,
duplicate and URL provenance records for audit; destructive data removal is a
separate decision and is not part of this request.

Expected data impact is additive metadata and attempt history. Existing Original
Asset bytes, Source/SourceVersion identities, Evidence, Command Ledger V1/V2
records and APIs remain unchanged.

## 6. Required implementation evidence after approval

- migration apply, repeat apply/backfill and compatibility verification
- rollback drill for pre-Activate and post-Activate compatibility modes
- atomic submission/item/Source/SourceVersion/command-outcome fault injection
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
