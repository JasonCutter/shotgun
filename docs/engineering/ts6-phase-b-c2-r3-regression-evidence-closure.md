# TS-6 Phase B C2-R3 Regression Evidence Closure

Date: 2026-09-20  
Branch: `codex/ts6-postgres-transaction-phase-b`  
Base SHA: `1f821ea371b308d8cecede4a98ebe27960873b21`

## Scope and stop conditions

C2-R3 closes the exact 16 `MISSING_REGRESSION` records reported by the C2-R2
validator. The source transaction topology, command gateway design, C1 proofs,
and C2-R2 counts remain frozen. No commit, push, pull request, Ready status, or
TS-7 transition is authorized by this request.

The R3 delta is limited to regression evidence, validator strictness, the count
crosswalk, and three minimal PostgreSQL proof tests required to cover existing
boundaries. No Product source implementation was changed for R3.

## Boundary count crosswalk

The candidate inventory is 120 records: 100 production-reachable transaction
boundaries, zero independent participants, zero delegates, seven non-transaction
raw sites, and 13 test-only/dead safe helpers. The canonical inventory is 113
boundaries, one participant, and 11 raw sites. The difference is explicit in
[`ts6-c2-r3-boundary-count-crosswalk.json`](../../ts6-c2-r3-boundary-count-crosswalk.json):

- 100 candidate transaction boundaries map one-to-one to canonical boundaries.
- 13 test-only/dead safe helpers are retained as canonical inventory extras.
- The raw ask savepoint participant is owned by the ask execution boundary and
  is not promoted to an independent boundary.
- Eleven raw sites are seven excluded candidates, one participant, and three
  additional raw sites.
- `unexplained` is empty.

## Exact 16-record closure

| Boundary                                                    | Evidence test                                                                        | Coverage          | Decision                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------- | ----------------------------------- |
| connector-runtime:1199 `acquireNext`                        | `runtime-data-integrity-wp05-connector-current-job`: re-enters rotated durable event | `PUBLIC_PATH`     | `B EXISTING_PATH_REGRESSION`        |
| connector-runtime:1389 `recoverExpiredLeases`               | `post-tf-risk002-connector-fencing-proof`: Scenario A                                | `DIRECT_BOUNDARY` | `A EXISTING_DIRECT_REGRESSION`      |
| discovery-reentry:777 `recordConsumptionDisposition`        | `akp-5-wp2-discovery-reentry`: retryable failure disposition                         | `PUBLIC_PATH`     | `B EXISTING_PATH_REGRESSION`        |
| discovery-reentry:987 `persistIntake`                       | `akp-5-wp2-discovery-reentry`: manifest/candidate atomicity                          | `PUBLIC_PATH`     | `B EXISTING_PATH_REGRESSION`        |
| discovery-runtime:2844 `saveFailureContext`                 | `akp-4-wp4-discovery-execution`: persists retryable failure context                  | `DIRECT_BOUNDARY` | `E NEW_MINIMAL_REGRESSION_REQUIRED` |
| frontend-activity:91 `withProjectWriteLock`                 | `frontend-activity-postgres-parity`: concurrent upsert/rebuild                       | `OWNER_ATOMICITY` | `B EXISTING_PATH_REGRESSION`        |
| frontend-ask-execution:2421 `poolTransaction`               | `frontend-ask-write-postgres`: aggregate/outcome recovery and follow-ups             | `OWNER_ATOMICITY` | `B EXISTING_PATH_REGRESSION`        |
| frontend-sources-write:467 `markSubmissionStage3Incomplete` | `frontend-sources-stage3-recovery`: fail/retry/idempotent SourceVersion              | `OWNER_ATOMICITY` | `B EXISTING_PATH_REGRESSION`        |
| frontend-sources-write:508 `finalizeSubmissionState`        | `frontend-sources-stage3-recovery`: mixed submission final PARTIAL                   | `OWNER_ATOMICITY` | `B EXISTING_PATH_REGRESSION`        |
| frontend-sources-write:1485 `markStage3ItemsSucceeded`      | `frontend-sources-stage3-recovery`: mixed submission final PARTIAL                   | `OWNER_ATOMICITY` | `B EXISTING_PATH_REGRESSION`        |
| postgres-stage5:418 `withTransaction`                       | `stage-5-comparison-v2-postgres`: P2-01 aggregate persistence                        | `OWNER_ATOMICITY` | `B EXISTING_PATH_REGRESSION`        |
| postgres-stage5:1340 `markStale`                            | `comparison-reentry-product-postgres`: authenticated Product V2 re-entry             | `PUBLIC_PATH`     | `B EXISTING_PATH_REGRESSION`        |
| postgres:971 `updateProject`                                | `section2-postgres`: PostgreSQL project metadata update                              | `DIRECT_BOUNDARY` | `E NEW_MINIMAL_REGRESSION_REQUIRED` |
| postgres:1500 `updatePrincipalPreferences`                  | `section2-postgres`: PostgreSQL principal preferences update                         | `DIRECT_BOUNDARY` | `E NEW_MINIMAL_REGRESSION_REQUIRED` |
| provider-privacy-deployment:90 `createProposal`             | `a4-provider-external-transfer-authority`: proposal/history preservation             | `PUBLIC_PATH`     | `B EXISTING_PATH_REGRESSION`        |
| provider-privacy-deployment:160 `approveProposal`           | `a4-provider-external-transfer-authority`: stale/concurrent approval fail-closed     | `PUBLIC_PATH`     | `B EXISTING_PATH_REGRESSION`        |

Every record has an exact file, active test title, `boundaryId`, coverage kind,
entry symbol, and ordered path. The validator rejects missing files, skipped or
TODO-only titles, nonexistent path symbols, constructor-only direct evidence,
wrong boundary IDs, and missing direct method calls. Private helpers are covered
through their proven public owner path; no helper was exported or wrapped solely
for evidence.

## Required counters

```json
{
  "missingRegressionAtStart": 16,
  "closedByExistingDirect": 1,
  "closedByExistingPath": 12,
  "closedByParticipantInheritance": 0,
  "closedByDelegateInheritance": 0,
  "closedByNewMinimalTest": 3,
  "closedByReclassification": 0,
  "remainingMissingRegression": 0,
  "reviewRequired": 0
}
```

The three new minimal tests are direct PostgreSQL repository calls for
`saveFailureContext`, `updateProject`, and `updatePrincipalPreferences`. They
are additions to existing authorized database suites; they do not change the
Product implementation.

## OSS and architecture gate

The four mandated references were rechecked against the existing pinned review
records. No external runtime, database schema, or UI was introduced in R3.

| Candidate                                                         | Decision                    | Pin / license                                                                          | R3 boundary                                                                        |
| ----------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `REFERENCE_ONLY`            | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                                       | Job, locking, retry, and recovery patterns only; Runtime/DB excluded               |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `REFERENCE_ONLY`            | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0                                | No conversion or Evidence package is relevant to this transaction-evidence closure |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `REFERENCE_ONLY`            | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                                       | UX patterns only; backend, SQLite, and LLM client excluded                         |
| [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) | `REFERENCE_ONLY`            | `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later                          | Review/lineage presentation patterns only; GPL Runtime, Git/MCP, and Yjs excluded  |
| PostgreSQL                                                        | `ADOPT` existing foundation | `postgres:16.14-alpine` pinned in existing implementation records / PostgreSQL License | Existing Shotgun-owned transaction adapters only                                   |
| Ajv                                                               | `ADOPT` existing foundation | `8.20.0` / MIT                                                                         | Existing contract validation foundation only                                       |

The R3 validator and count crosswalk are Shotgun-owned evidence tooling. They do
not expose OSS internal IDs or schemas as Canonical IDs. Existing migration and
rollback remain removal/reversion of the focused uncommitted R3 changes; the
source topology and C1/C2-R2 artifacts remain the frozen rollback reference.

## Verification

- C2-R3 validator `verify`: 120 candidates, 11 raw sites, `issueCount: 0`.
- Validator unit tests: 24 passed, including R3-V01 through R3-V16.
- TypeScript: `npx tsc --noEmit` passed.
- Focused non-DB tests: 4 files, 13 tests passed (frontend command gateway,
  transaction outcome contract, runtime integrity, and golden boundary tests).
- Golden fixture: sole fixture remains `tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json`.
- R3-start pre-edit fixture SHA-256 (H0): `A8574BCD72FFF36ABE1E4C6B919FC29B2475E35B02ED1A12D9056DB3EB685240`.
- Final reviewed pre-validation fixture SHA-256 (H1): `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.
- Post-audit fixture SHA-256 (H2): `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.
- Pre-verify fixture SHA-256 (H3): `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.
- Post-verify fixture SHA-256 (H4): `256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`.
- `H1 == H2` and `H3 == H4`; audit and verify did not mutate the fixture.
- `DATABASE_URL` and `TEST_DATABASE_URL` were checked once and are both unset.
  Database proofs are therefore `BLOCKED_NO_TEST_DATABASE`; no fallback database
  or retry was attempted.

## Completion decision

C2-R3 regression evidence is closed with zero remaining missing records and zero
review-required records. This is a R3 evidence closure only. The task remains
STOPPED at the requested handoff boundary: no commit, push, PR, Ready signal, or
TS-7 work was performed.
