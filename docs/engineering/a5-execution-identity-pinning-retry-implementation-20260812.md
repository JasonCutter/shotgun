# A5 Execution Identity, Pinning & Retry — Implementation Evidence

## Boundary

This change implements the A5 durable execution foundation on top of the existing
`frontend_ask.answer_runs` and `frontend_ask.answer_run_attempts` model. It does
not implement provider adapters, Settings API/UI, runtime routing, Test
Connection, or actual external egress.

The existing DeepSeek worktree was inspected for presence and status; no changes
were reused and it was left untouched. A5 uses the frozen A5 design and the
existing Ask repository port as the replacement-safe boundary.

## Implementation

- `AIExecutionPin` is server-owned and contains only AnswerRun/Project,
  provider/model, AI configuration revision, credential id/revision, initial
  provider-policy fingerprint, and creation time.
- PostgreSQL stores the pin on `answer_runs`, copies it to each attempt, and
  persists the effective policy fingerprint separately for each attempt.
- Database checks, immutable triggers, Project-scoped queries, and a
  lock-and-compare `createExecutionPinIfAbsent` path prevent divergent or
  mutated identities.
- The execution service resolves the pin before the initial claim, verifies
  provider result identity before accepting a response, and revalidates the
  exact pinned credential revision before every managed attempt.
- `RETRY_SAME_CONTEXT` retains the original context and policy fingerprint.
  `RETRY_CURRENT_POLICY` retains the original execution identity while
  reevaluating current provider policy eligibility.
- A revoked, removed, unavailable, or mismatched credential fails closed; no
  latest credential lookup or substitution exists in the retry path.
- Historical rows remain nullable and are not assigned fabricated identity.
  No credential plaintext or ciphertext is written to the new columns, audit,
  provider request, or failure messages.

## Verification

Focused unit and contract checks passed:

- A5 execution identity tests: 3/3
- Existing Ask execution tests: 8/8
- Ask execution contract tests: 2/2
- A2 credential vault regression: 4/4
- A3 AI configuration regression: 6/6
- A4 provider privacy/policy regression: 24/24
- Changed-file TypeScript typecheck, ESLint, Prettier, and `git diff --check`

PostgreSQL focus test:

- `NOT_RUN`: `TEST_DATABASE_URL` was not configured in this Codex environment.
  The additive migration and database focus test are included for exact-head CI.

## Acceptance mapping

| Criteria     | Evidence                                                                          |
| ------------ | --------------------------------------------------------------------------------- |
| A5-AC01–AC05 | Immutable pin resolver, repository CAS/locking, and pin/attempt persistence tests |
| A5-AC06–AC07 | Same-context/current-policy retry tests with unchanged pin                        |
| A5-AC08–AC09 | Exact credential revalidation and no-substitution negative test                   |
| A5-AC10      | Durable pin remains attached to the AnswerRun and is copied during retry          |
| A5-AC11      | Nullable additive migration and legacy-unpinned handling                          |
| A5-AC12      | Existing Ask, A2, A3, and A4 regression tests listed above                        |
| A5-AC13      | No provider adapter, router, Settings surface, or external egress added           |

This evidence records implementation readiness only. A5 reaches its frozen exit
condition after merge and successful automatic post-merge `main` CI.
