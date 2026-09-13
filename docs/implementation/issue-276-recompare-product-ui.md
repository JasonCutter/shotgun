# Issue #276 — Recompare Product/UI correction

## Pre-change source audit (2026-09-13)

Canonical base: `main@293823e631ff0ba1db0c9d4fd124d7d1b1bb8744`.

### Existing flow and return semantics

- `apps/shotgun-web/src/routes/review-workspace.tsx` consumes the frozen
  FE-P4-S1 Review queue/context contract. A V2 target exposes its structured
  `context.targetId` as the ChangeSet identity, but no Recompare control.
- `packages/shotgun-api-client/src/client.ts` sends
  `POST /api/v1/comparisons/recompare` and currently returns
  `result: unknown` after checking only that `commandStatus` is a string.
- `assemblies/shotgun-app/src/server.ts` accepts the Candidate identity and
  constructs the server-owned `RecompareClaimCandidate@1.0.0` command. Project,
  actor, access scope, sensitivity and rollout are derived from the request
  context.
- `modules/comparison/src/index.ts` returns the bounded execution shape:
  `rollout`, `v1Executed`, optional `candidateId`/revision, optional V2 outcome
  (`COMPLETED`, `BLOCKED`, `INCOMPLETE`, `FAILED`) and optional Review outcome
  (`DRAFT_CREATED`, `BLOCKED`, `NOT_ATTEMPTED`). Explicit re-entry deliberately
  returns these domain outcomes instead of applying the publisher required-ACK
  failure rule.

Therefore HTTP 2xx and connector `SUCCEEDED` are transport outcomes only. In
`V2_ACTIVE`, Product success requires `v2.status=COMPLETED` and
`review.status=DRAFT_CREATED`; `BLOCKED`, `INCOMPLETE` and `FAILED` remain
typed recovery states.

### Consumers and locator seam

- Before this change there were no browser consumers of
  `ShotgunApiClient.recompareCandidate`; the Review route is the first owner
  surface to use it.
- The narrow server-owned locator is `changeSetId` (already present as the
  Review `context.targetId`). The server resolves
  `options.changeSetReviewV2Repository.findDraftById(context.projectId,
changeSetId)` and takes the Candidate identity from the authoritative draft.
  Missing, cross-project, or mismatched drafts fail closed. Browser labels,
  `targetLabel`, `after.detailText`, JSON presentation text and `OPAQUE_TEXT`
  are never parsed for authority.
- This bridge is outside the frozen FE-P4-S1 Review contract. No Contract
  Snapshot amendment, new ADR, or migration is required by the audit.

### Refresh and idempotency

- The Review route already refetches the queue after an authoritative V2
  decision. Recompare will reuse that read refresh and select the newly
  materialized `comparison-v2:<comparisonId>` ChangeSet when returned.
- The browser generates one idempotency identity per explicit click and
  disables the control while pending. The server keeps its existing project
  namespace and connector deduplication; no browser mutation retry is added.

## Integration decision

The comparison/review implementations are Shotgun-owned contracts and no OSS
runtime is needed for this Product/UI seam. The four approved references were
reviewed for applicable UX or adapter patterns and remain `REFERENCE_ONLY`:

- `garrytan/gbrain` — commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT
- `lucasastorian/llmwiki` — commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0
- `ddsyasas/llm-wiki` — commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT
- Inkeep OpenKnowledge — commit `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later

No external package, Adapter or Extract boundary is introduced.

## Implementation and completion evidence

1. **Pre-change flow:** Review queue/context exposed a stale V2 Change Set but
   had no action; the API returned an untyped `result` and the server accepted
   only `candidateId`.
2. **Semantics audit:** HTTP 2xx/connector `SUCCEEDED` remains transport-only.
   Product success is exactly `V2_ACTIVE` + `v2.status=COMPLETED` +
   `review.status=DRAFT_CREATED`; V2 failure never falls back to V1.
3. **Locator:** the browser sends the structured `context.targetId`; the
   server resolves `findDraftById(projectId, changeSetId)` and validates the
   project, Change Set and Candidate identity. Missing/cross-project/mismatch
   cases fail closed. No presentation text is parsed.
4. **Contract/ADR/migration:** the frozen FE-P4-S1 contract, ADR-160 and
   ADR-163 remain unchanged; no Contract Snapshot amendment or database
   migration was required. `reviewChangeSetId` is an additive Product response
   field derived from the safe V2 Comparison ID.
5. **Typed model/classification:** `RecompareCandidateResponse` and nested
   bounded V2/Review unions are decoded strictly. Candidate text, evidence,
   rationale, prompts, provider output, access scopes and Canonical content
   are excluded.
6. **Files/ports:** API client contracts/decoder, server locator bridge and
   safe response projection, contextual Review UI, and focused unit/integration
   tests were changed. The existing `RecompareClaimCandidate@1.0.0` command,
   Comparison and Review ports remain authoritative.
7. **Tests:** API success/malformed/`BLOCKED`/`INCOMPLETE`/`FAILED` decoding;
   stale V2 UI visibility, one-click pending idempotency, blocked recovery and
   no-text-parsing; authenticated in-memory locator negatives; and the
   PostgreSQL-backed locator/history path were added. PostgreSQL test is
   present but skipped when `TEST_DATABASE_URL` is unavailable.
8. **Safety proof:** the UI has no Review approval or Canonical mutation path;
   successful V2 re-entry refreshes the queue and selects the new current
   snapshot item. Existing Comparison V2 runtime tests prove `v1Executed=false`
   for V2_ACTIVE and preserve prior history.
9. **Branch/base/head:** branch `codex/issue-276-recompare-product-ui`, based
   on `main@293823e631ff0ba1db0c9d4fd124d7d1b1bb8744`, exact HEAD
   `70eb428ad34f45300e7c643726c76fa3d4df889b`.
10. **PR:** [#291](https://github.com/JasonCutter/shotgun/pull/291) targets
    `main`, references Issue #276, and remains unmerged for controller review.
11. **Local gates:** root typecheck, web typecheck, lint, architecture,
    documentation validation, all 1121 unit tests, all 671 contract tests,
    focused integration tests and focused Review UI tests pass. Format check
    still reports two pre-existing unrelated files:
    `modules/frontend-knowledge-draft/src/product-api.ts` and
    `tests/integration/connector-reliability.test.ts`. Exact-head CI run
    [34758236757](https://github.com/JasonCutter/shotgun/actions/runs/34758236757)
    passed `Quality`, `Frontend`, and `Required Gates`.
12. **Excluded follow-ups:** no Contract Snapshot/ADR migration, no V2 public
    capability addition, no browser retry, no Canonical write/approval, no
    V1 fallback, and no unrelated cleanup were introduced. Controller
    review/merge remains after the passing exact-head CI.
