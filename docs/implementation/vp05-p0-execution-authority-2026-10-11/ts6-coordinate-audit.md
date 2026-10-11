# VP-05 P0 — TS-6 current transaction authority audit

## CI finding and scope

PR #381 initial head `7821a3fa7bed125f226361864347e6f3c381d312` failed
`verify:ts6-c2`: the current v8 inventory still named pre-P0 coordinates and
omitted the new global transactions / expired-execution recovery transaction.
Local P0 verification had not included that required release command.

This follows the existing [current coordinate audit](../ts6-current-authority-coordinate-audit-2026-10-01.md).
Current v8 manifest, approved relation coordinates and derived lineage are
maintained after source review. Frozen v2–v7 history, history manifest, T3 base
identity, validator, reachability resolver, evidence grades and negative
validation rules are unchanged. VP corpus / experiments / semantic policy are
unchanged.

## Reviewed delta

Five existing `PostgresVPRelationJobs` methods were matched by file, class,
method and candidate kind: `claimNext`, `claim`, `storeOutput`,
`markOutcomeUnknown`, `completeDecision`. Their `PORT_INFERRED` classification
and reachability are retained. P0 behavior changes are covered by the P0 tests;
this audit does not describe the implementation delta as coordinate-only.

Eleven added source candidates:

| Owner / candidate                          | Classification       | Reason                                                           |
| ------------------------------------------ | -------------------- | ---------------------------------------------------------------- |
| Global budget `claim` BEGIN                | TEST_ONLY_OR_DEAD    | Generic legacy/test entry; normal worker uses reserveAttempt     |
| Global budget `reserveAttempt` BEGIN       | PORT_INFERRED        | Typed budget Port caller; static composition is not PROVEN       |
| Global budget `releaseUnused` BEGIN        | PORT_INFERRED        | Typed budget Port caller; static composition is not PROVEN       |
| Seven COMMIT/ROLLBACK lifecycle statements | NON_TX               | Lifecycle of those owners; not additional transaction owners     |
| `recoverExpiredExecutions` safe helper     | TX_BOUNDARY / PROVEN | Concrete job adapter invoked by normal app startup and claimNext |

For the new PROVEN recovery owner, the existing P0 PostgreSQL crash test now
calls `jobs.recoverExpiredExecutions()` explicitly after expiring a durably
activated execution. It checks UNKNOWN disposition, one local attempt and one
counted global claim. Its exact test block / qualified receiver are registered
as a DIRECT_BOUNDARY relation and independently resolved by the existing
regression-evidence resolver. This is mechanical execution evidence reviewed
under the user's implementation/verification authorization; it is not a new
semantic Gold judgment.

The source-derived inventory is 140 candidates, 126 transaction owners, one
participant and 21 raw transaction statement sites. Current classifications are
`TX_BOUNDARY 17`, `PORT_INFERRED 91`, `NON_TX 14`, `TEST_ONLY_OR_DEAD 18`,
`REVIEW_REQUIRED 0`. Current-source legacy name-only scoring is separately
reconstructed; frozen historical totals remain assertions against their own
records. No inferred global caller is promoted to PROVEN to make CI pass.

[Detailed mappings, source classifications and frozen hashes](./ts6-coordinate-audit.json).

## Reproduction

- `npm run ts6:v8:rebuild`
- `npm run ts6:v8:check`
- `npm run verify:ts6-c2`
- `npm run test:ts6-audit`
- isolated `tests/database/vp05-p0-crash.database.test.ts`

No verifier bypass, skipped release gate or production change is introduced.
Final exact-head CI evidence is recorded in the PR publication receipt.
