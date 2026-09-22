# TS-6 PHASE B C2-R1 Transaction Authority Evidence

> C2-R2 supersession: this document is retained as the historical C2-R1
> finding. The v1 corpus and its equality-to-87 comparison are superseded by
> `docs/engineering/ts6-phase-b-c2-r2-transaction-authority-rebaseline.md` and
> the v2 source-derived taxonomy. The original C2-R1 counts and blockers remain
> unchanged as historical evidence.

Status: `REVIEW_REQUIRED`

The C2-R1 request was executed against branch `codex/ts6-postgres-transaction-phase-b`.
The reviewed base remains `1f821ea371b308d8cecede4a98ebe27960873b21`.
Commit, push, PR, Ready, merge, release, and TS-7 remain unauthorized.

## Scope and exclusions

The only Product behavior change in this pass is the exact durable readback in
`adapters/frontend-command-gateway-postgres/src/index.ts`. No migration,
schema, Port, transaction framework, command ledger, retry, reconciliation
service, package, dependency, or lockfile was added. The frozen C1 artifact was
not regenerated and the five primary C1 ACK-loss proofs were not rerun.

## OSS and integration decision

No new OSS candidate is relevant to this narrow PostgreSQL readback or source
caller-evidence audit. The existing `packages/postgres-transaction` helper is
retained as the already-approved Shotgun transaction boundary; this pass does
not promote its internal types or storage into a Canonical contract. Decision:
`NO_RELEVANT_OSS` for the new behavior, with existing helper reuse.

## Blocker 1: caller authority

The stable fixture is present at
`tests/fixtures/ts6-phase-b-transaction-authority-golden.v1.json` and the
validator is independent and read-only at
`scripts/ts6-phase-b-transaction-authority-validator.ts`.

The four Discovery families were checked by exact source call expression, not
owner prefix. The known correction is recorded as:

`PostgresDiscoveryFeedbackRepository.appendSuppression`
→ `modules/discovery-feedback/src/index.ts`
→ `handle.repository.appendSuppression(directive)` inside
`DiscoveryFeedbackProductCoordinator.submit`.

The Discovery runtime worker is not asserted as the caller of every repository
method. Methods without a production call expression remain `UNRESOLVED` or
`TEST_ONLY`; they are not converted to `PROVEN` by class or directory naming.

## Blocker 2: direct Frontend Canonical caller

The direct path is recorded and documented:

`assemblies/shotgun-app/src/product-api/frontend-knowledge-draft-routes.ts`
→ `coordinator.commitFrontendDraft(...)`
→ `modules/frontend-knowledge-draft/src/product-api.ts`
→ `dependencies.canonical.commitFrontendDraftInTransaction(transaction, write)`
or `dependencies.canonical.commitFrontendDraft(write)`
→ `adapters/postgres-stage6/src/index.ts`.

The Canonical event-handler path is retained separately; it is not treated as
the sole caller. Regression evidence is anchored to
`tests/integration/frontend-knowledge-draft-commit.test.ts`.

## Blocker 3: exact completion readback

After `OUTCOME_UNKNOWN`, `complete()` now performs one read-only PostgreSQL
lookup requiring all of:

- the same `command_id`;
- `outcome_state = 'COMPLETED'`;
- `completion_disposition = 'SUCCEEDED'`;
- structural JSONB equality of `produced_resources`.

Every other durable state, absent row, or readback error rethrows the original
`OUTCOME_UNKNOWN`. No second UPDATE, retry, or command execution is introduced.

The new test file contains the required IDs `CG-RB-01` through `CG-RB-08` and
checks the durable revision/material state and the one-commit/no-rollback-after-
commit trace for the real ACK-loss case.

## Blocker 4 and independent validator result

The validator does not scan and rewrite the fixture. It reports the current
source-derived inventory as **120 transaction sites**, while the historical
reviewed corpus contains **87 rows**. It also reports stale raw sites from the
older corpus and newly detected raw transaction primitives. This is the
explicit C2-R1 `V16` delta condition, so the result is `CHANGES_REQUIRED /
REVIEW_REQUIRED`; the corpus is not silently forced to 87.

Validator result: exit `1`, derived row count `120`, current raw site count
`11`, issue count `172` (including unresolved/blocked caller status, stale
raw-site entries, unregistered raw sites, and the historical count delta).

## Tests and gates

- `npx tsc --noEmit`: passed.
- `npx vitest run tests/unit/ts6-phase-b-transaction-authority-validator.test.ts`:
  7 tests passed.
- The focused command-gateway DB test is present and guarded by
  `requireTestDatabaseTarget`. It could not execute because this environment
  has no `TEST_DATABASE_URL`; no production `DATABASE_URL` fallback was used.
- Full unit/contract/integration/architecture/docs/security/OSS gates were not
  claimed because the mandatory source-inventory gate is already
  `REVIEW_REQUIRED` and the guarded test database is unavailable.

## Final stop

The implementation stops here awaiting the next independent GPT review. No
commit, push, PR, Ready transition, merge, or TS-7 work was performed.
