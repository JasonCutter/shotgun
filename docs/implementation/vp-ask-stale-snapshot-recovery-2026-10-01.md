# VP Ask query-scoped freshness — 2026-10-01

**Status: implemented and verified for the real finance PDF flow; VP-03/04/06 remain open.**
This change addresses an Ask availability failure. It does not close the broad
extraction-quality, relation-quality, cost, or reliability gates.

## Failure and cause

The supplied 10-page finance PDF was uploaded through the real Shotgun browser
flow and reached all 20 curated extraction markers. Repeated DeepSeek Ask runs
revealed that the serial relation worker can advance `vp.project_epochs` while
processing pairs that do not affect the current question. The old global epoch
equality check treated that unrelated work as a stale answer. One failure also
exposed an async error-handling bug: the execution service returned the
`complete()` Promise from inside a `try` without awaiting it, so a known stale
failure bypassed its handler and expired as `OUTCOME_UNKNOWN`.

## Change

- The execution service awaits answer completion so persistence errors reach
  its failure handler. Stale completion is a typed, retryable `STALE_VERSION`
  failure; a known failed attempt never publishes its answer or citations.
- The pinned `vp_knowledge_epoch` remains in the attempt as audit context. It is
  no longer the sole freshness predicate. Ask re-runs the same question under
  the same access/sensitivity scope and compares its ordered Evidence IDs and
  accessible latest-SourceVersion watermark.
- The adapter checks freshness at evidence resolution, immediately before a
  provider attempt, and immediately before publishing the answer. The last two
  checks run on the caller's PostgreSQL transaction while holding a shared lock
  on the project's VP epoch row, so relation changes cannot race the shortlist
  validation and publication transition.
- The resolver makes one bounded local refresh. The service permits at most
  three total provider attempts when a relevant snapshot keeps changing. Each
  retry uses current policy and persists its own attempt/cost record; an
  `OUTCOME_UNKNOWN` result is never retried automatically.
- A source watermark or question shortlist change still fails closed. A global
  epoch increment with the same current shortlist and accessible source
  watermark no longer cancels the answer. No DB migration or new dependency was
  required.

## OSS integration decision

The relevant reviewed references are `garrytan/gbrain` at commit
`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT) for Job/Attempt recovery
patterns, and `ddsyasas/llm-wiki` at commit
`e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` (MIT) for Ask UX. Both remain
`REFERENCE_ONLY` under the existing Role Matrix decisions. Neither supplies
this Shotgun-specific interaction between a durable Ask attempt, an immutable
VP audit snapshot, and a query-scoped current evidence check. Decision:
`NO_RELEVANT_OSS` for a new runtime or package. The change stays behind the
existing `AskKnowledgeEvidenceSearchPort`; no new provider egress was added.

## Verification

- Full unit suite: **1,303/1,303 tests passed**, including the bounded stale
  retry tests.
- `tests/database/vp-direct-assertion-ledger.database.test.ts`: **2/2 passed**.
  It checks that an epoch-only difference with the same shortlist stays current,
  while an Evidence shortlist or source-watermark mismatch is stale.
- `tests/database/frontend-ask-uploaded-source-resolution.database.test.ts`:
  **1/1 passed**.
- Actual finance PDF browser test using the configured DeepSeek `deepseek-flash`:
  **two consecutive isolated runs passed** (2.7 and 2.3 minutes). Each fresh
  PostgreSQL database received the 797,599-byte PDF with SHA
  `bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01`.
  Run 1 produced 112 current assertions and 123 candidates; Run 2 produced 100
  and 109. Both matched all 20/20 curated markers; each balance-sheet and NPV
  answer had two citations, and four additional topic answers matched with the
  expected PDF page citations. Projection replay matched and pending relation
  jobs were zero at the end of both runs. The runs recorded 15 responses / 33,125
  tokens and 14 responses / 30,569 tokens, respectively; provider billing was
  not reconciled. Both isolated databases were disposed by the test helper.
- `npm run docs:validate`, `npm run oss:verify` (72 decisions, 45 baseline
  references, Stage 0–12 reviews), Prettier, and ESLint passed.
- Full repository typecheck remains blocked by pre-existing type errors in the
  unrelated, untracked `tests/contract/ts7-cross-section-acceptance.contract.test.ts`.
  It reports no error in this change's files.

## Limits and rollback

The PDF markers are a narrow coverage measure, not a full claim precision/recall
score. The relation and Ask corpora remain `CANDIDATE`; malformed stacked
formula extraction, duplicate claims, full-quality limits, scale, and actual
provider billing remain open under VP-04/05. If bounded stale retries create
unwanted provider cost, lower the attempt bound while retaining query-scoped
freshness and fail-closed publication. There is no schema migration to reverse.
