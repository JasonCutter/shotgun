# VP Ask stale-snapshot recovery — 2026-10-01

**Status: bounded recovery implemented and verified; VP-03/04/06 remain open.**
This report records a real PDF Ask failure, its cause, the bounded retry, and a
second live end-to-end run. It does not close broad extraction-quality or
reliability gates.

## Failure and cause

The 2026-10-01 live test re-uploaded the supplied 10-page finance PDF into a
disposable PostgreSQL database and completed extraction with all 20/20 curated
markers matched. One final Ask failed to publish citations. Logs showed that
the VP knowledge epoch changed before the answer could be committed.

The PostgreSQL adapter correctly rejected the stale answer. The execution
service returned the asynchronous `complete()` Promise from inside a `try`
block without awaiting it, so this rejection bypassed the service's error
handler. Its lease later expired and recovery marked the known stale attempt
`OUTCOME_UNKNOWN`. The provider response was known; the answer was withheld.

## Change

- The execution service now awaits answer completion, so persistence errors
  reach its failure handler.
- A stale VP completion has the typed `STALE_VERSION` code and
  `complete-vp-snapshot` operation. It is recorded as a known failed attempt;
  the old answer and citations are not published.
- On the first `INITIAL` attempt only, the service makes one bounded retry with
  `CURRENT_POLICY`, which resolves a fresh VP snapshot and current accessible
  SourceVersion watermark. If that retry also becomes stale or cannot be
  claimed, the AnswerRun remains a visible failure with the retry action
  available. It never retries an `OUTCOME_UNKNOWN` provider result.
- The retry may incur a second provider charge; the separate AnswerRun attempt
  preserves that cost and execution history. No DB migration was needed.

## OSS integration decision

The relevant reviewed references are `garrytan/gbrain` at commit
`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT) for Job/Attempt recovery
patterns, and `ddsyasas/llm-wiki` at commit
`e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` (MIT) for Ask UX. Both remain
`REFERENCE_ONLY` under the existing Role Matrix decisions. Neither supplies
this Shotgun-specific interaction between a durable Ask attempt, immutable VP
snapshot, and answer publication. Decision: `NO_RELEVANT_OSS` for a new runtime
or package. The retry uses Shotgun's existing `AskAnswerExecutionRepositoryPort`
and persisted `CURRENT_POLICY` attempt path; no new dependency or provider
egress was introduced.

## Verification

- `tests/unit/frontend-ask-execution.test.ts`: 10/10 passed, including one
  forced `STALE_VERSION` completion followed by one successful current-policy
  retry (two provider calls, two durable attempts).
- `tests/database/frontend-ask-uploaded-source-resolution.database.test.ts`:
  1/1 passed; the PostgreSQL adapter rejects a stale completion with typed
  `STALE_VERSION` and writes no answer statement.
- Actual PDF browser flow, configured DeepSeek `deepseek-flash`: 1/1 passed in
  3 minutes. A fresh isolated database received the 797,599-byte PDF with SHA
  `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`; the
  run produced 107 current assertions and 116 candidates, matched 20/20
  markers, answered two smoke questions plus four fixed topic questions,
  checked citation SourceVersion/page selectors, matched projection replay,
  and ended with zero pending relation jobs. The disposable database was
  released by the test helper.
- `npm run docs:validate` and `npm run oss:verify` are recorded after the
  documentation update.

## Limits and rollback

This run measured marker coverage, not full claim precision/recall: duplicates
and malformed formula glyphs remain visible in extraction output. The Ask corpus
and relation labels remain `CANDIDATE`; provider billing is not reconciled. The
VP-04/05 quality, scale, and cost gates stay open. If the automatic retry causes
undesired provider cost or behavior, remove only the bounded retry branch while
keeping awaited completion, typed stale failures, and fail-closed publication;
there is no schema migration to reverse.
