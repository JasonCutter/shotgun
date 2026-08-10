---
id: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION-WP-XP2-EVIDENCE-260810001
classification: CANONICAL
status: ACCEPTED / COMPLETE
status_authority: FINAL_AFTER_MERGE
verification_gate: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION
created_at: 2026-08-10
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
governing_ir: docs/implementation/frontend-cross-phase-product-verification-implementation-request-260809001.md
gap_repair_amendment: docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md
correction_b_evidence: docs/implementation/frontend-cross-phase-correction-b-implementation-evidence-260809001.md
final_cross_phase_evidence: docs/engineering/frontend-cross-phase-product-verification-evidence-260809001.md
# Historical review record — preserved as history (never rewritten).
gpt_review_20260810: BLOCKED_CORRECTION_AUTHORIZED (Correction C — Source Intake → Transformation/Evidence production wiring; 7 fixed deltas)
gpt_review_20260810_r2: CHANGES_REQUIRED (Correction Round 2 — no final SUCCEEDED before Stage 3; failure → retryable OUTCOME_INDETERMINATE; same-SourceVersion resume; no duplicates)
gpt_review_20260810_r3: CHANGES_REQUIRED (Correction Round 3 — mixed PARTIAL submission + Stage 3 failure must also be retryable and resume to PARTIAL; CI #752 report corrected to #750/run 31381019634 on exact head 698c1eb5b)
gpt_review_20260810_final: ACCEPTED (Correction C + Recovery Rounds 1~3 CLOSED)
wp_xp2_implementation_head: 1753707c0
wp_xp2_implementation_ci_number: 746
wp_xp2_implementation_ci_conclusion: SUCCESS
wp_xp2_implementation_ci_run_id: 31375519252
wp_xp2_correction_round1_head: 85dbd8f0b
wp_xp2_correction_round1_ci_number: 748
wp_xp2_correction_round1_ci_conclusion: SUCCESS
wp_xp2_correction_round1_ci_run_id: 31379439134
wp_xp2_correction_round2_head: 698c1eb5b
wp_xp2_correction_round2_ci_number: 750
wp_xp2_correction_round2_ci_conclusion: SUCCESS
wp_xp2_correction_round2_ci_run_id: 31381019634
wp_xp2_correction_round3_terminal_head: 37e67874a
wp_xp2_correction_round3_ci_number: 751
wp_xp2_correction_round3_ci_conclusion: SUCCESS
wp_xp2_correction_round3_ci_run_id: 31382160274
correction_c_recovery_rounds: CLOSED
# Correction Round 2/3 evidence cleanup ships inside the substantive fix
# commits (GPT governance: no separate docs-only metadata commit; the
# automatic CI on the exact head is the final gate — see sections 9/10).
wp_xp2_correction_round3_ci_governance: no_docs_only_commit (auto CI on exact head is final gate)
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
product_pr: https://github.com/JasonCutter/shotgun/pull/83
---

# Shotgun — Frontend Cross-Phase Product Verification WP-XP2 Evidence

## 1. Scope

WP-XP2 — Cross-phase journey E2E + lineage invariants (IR r1 §5 WP-XP2) on the
production-composition-parity backend (`tests/browser/fixtures/
frontend-cross-phase-backend.ts`, 127.0.0.1:3002) implemented on
`feat/fe-p5-xp-cross-phase-verification` (PR #83, Draft — merge stays
FORBIDDEN until the Cross-Phase verification is complete).

One user journey chains the 12 required flows (CP-AC-01 ~ CP-AC-12) through
the REAL product APIs:

```text
Project → Source → Ask → Draft → Review → Approval → Canonical Commit →
External Action → Activity → History → Reversal / Compensation
```

asserting the XP-I01 ~ XP-I07 lineage invariants. Every governed mutation is a
real Product API request with the real session cookie + CSRF token; the client
never declares authority. Deterministic fakes are used ONLY at external
side-effect boundaries (`AIProviderPort`, `ActionConnectorPort`), the same as
`main.ts`.

## 2. Production-vs-test adapter parity table

The Cross-Phase fixture mirrors `assemblies/shotgun-app/src/main.ts` adapter
composition exactly. All authority Domains are PostgreSQL-backed; the same
InMemory read projections `main.ts` itself uses are used; deterministic fakes
only where `main.ts` uses fakes (ActionConnector) or where live AI is not
runnable in CI (AIProvider).

| Domain / boundary              | main.ts (production)                                                                          | Cross-Phase fixture (WP-XP2)                                       | Parity |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Project / Auth / Settings      | PostgresProjectAdministration / PostgresAuth / PostgresSettings                               | Same                                                               | 1:1    |
| Command Ledger                 | PostgresFrontendCommandGateway                                                                | Same                                                               | 1:1    |
| Sources                        | PostgresSourcesProductService + SealedSourcesStagingService                                   | Same                                                               | 1:1    |
| Ask write/execution            | PostgresAsk* repositories + AskAnswerExecutionService                                         | Same (AIProvider = FakeAIProvider via StructuredAskAnswerProvider) | 1:1*   |
| Knowledge Draft                | PostgresFrontendKnowledgeDraft*                                                               | Same                                                               | 1:1    |
| Review boundary (review store) | PostgresFrontendReviewRepository                                                              | Same (production parity — WP-XP2 blocker)                          | 1:1    |
| Canonical                      | PostgresCanonicalKnowledgeRepository                                                          | Same                                                               | 1:1    |
| Change-Set-Review              | PostgresChangeSetReviewRepository                                                             | Same                                                               | 1:1    |
| External Action                | PostgresExternalActionStore + FakeExternalActionEngine                                        | Same (+ admin-seeded credential/budget — server-owned state)       | 1:1*   |
| Activity read model            | PostgresActivity*                                                                             | Same                                                               | 1:1    |
| History read model / payload   | PostgresHistory* + PostgresPayloadStateStore                                                  | Same                                                               | 1:1    |
| Product read projections       | InMemory (shell/action-center/etc.) + PostgresKnowledgeWorkspaceProjection (kernel connector) | Same                                                               | 1:1    |
| Transformation / Evidence      | PostgresTransformationRepository / PostgresEvidenceRepository                                 | Same (real production pipeline, Correction C)                      | 1:1    |
| AIProvider / ActionConnector   | Gemini (AIProvider) / FakeDraftActionConnector                                                | FakeAIProvider / FakeDraftActionConnector                          | fake   |

\* External side-effect boundary (deterministic fake) — recorded in the IR as
the only stubbed part of the E2E bridge.

## 3. Known product-gap bridges (real adapters, never stubs)

1. **Correction C — Source Intake → Transformation/Evidence production
   wiring** (GPT 2026-08-10: BLOCKED / CORRECTION AUTHORIZED): the Sources
   intake previously did not trigger the Stage 3 pipeline, so the journey
   bridged it fixture-side. Correction C wires the REAL production path: the
   Sources product service runs `SourcesStage3Pipeline`
   (`SourcesStage3PipelinePort`, adapter `sources-stage3-pipeline`) after a
   successful intake materializes each SourceVersion — it reads the staged
   bytes via `AssetStoragePort`, transforms with `PythonDocumentFormatAdapter`,
   persists the Transformation Revision, and indexes the EvidenceSpans with the
   real Stage 3 repositories. The fixture-side `bridgeEvidence()` is REMOVED.
   New Phase/Section/ADR were NOT created (existing contracts, minimal wiring).
2. **History projection rebuild** — there is deliberately NO browser History
   refresh route (FE-P5-S2 WP4 Round 1 fix E; the federated History projection
   is NON-AUTHORITATIVE and operator-rebuildable). The journey performs the
   operator rebuild with the REAL `HistoryProjectionBuilder` + owning-Domain
   adapters (Canonical / Review / External Action / Policy), then reads the
   REAL History Product API.
3. **Rollback capability provisioning** — `project:action:rollback` is a
   CURRENT server-derived capability separate from `owner` (FE-P5-S2 WP3).
   There is no browser API for membership grants; the journey provisions it
   through the REAL `PostgresAuthRepository` (owner membership upsert) exactly
   as an administrator would.
4. **External Action admin state** — the `fake-connector` credential and the
   per-project execution budget are seeded through the REAL
   `PostgresExternalActionStore` (admin-configured state; without them the
   preflight six revalidations fail closed).

## 4. Journey closure — CP-AC-01 ~ CP-AC-12

| AC       | Flow (real Product API)                | Journey proof                                                                                                                                                                                                          |
| -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-AC-01 | Session bootstrap + CSRF               | `/api/v1/session/local-bootstrap` → real cookie; `/api/v1/security/csrf` → token used on every mutation                                                                                                                |
| CP-AC-02 | Project create + active-project switch | `project.create.v1` ×2 (`journey-alpha`, `journey-beta`); `/api/v1/session/active-project`; XP-I01                                                                                                                     |
| CP-AC-03 | Source intake                          | staging/bytes (DIRECT_TEXT) → `sources.intake.submit.v1` → poll `SUCCEEDED` → sources/query library; the intake runs the REAL Stage 3 pipeline (Correction C) so the SourceVersion's EvidenceSpans are already indexed |
| CP-AC-04 | Ask + citation                         | `ask/questions` (SOURCE_EXPLORATION + pinned EvidenceSpans) → poll answer run → citation lineage; XP-I02                                                                                                               |
| CP-AC-05 | Knowledge read                         | `knowledge/workspace` after the commit resolves the committed Canonical state                                                                                                                                          |
| CP-AC-06 | DraftChangeSet                         | transition-seed → materialize → save CLAIM_ADD → validate → impact-preview → submit-review; XP-I02/I03                                                                                                                 |
| CP-AC-07 | Review · Approval                      | review/queue → contexts/read → decisions (APPROVE) → approval ACTIVE; XP-I03                                                                                                                                           |
| CP-AC-08 | Canonical Commit                       | approvals/read → drafts/commit → commitIds; Approval consumed (read fails closed); XP-I04                                                                                                                              |
| CP-AC-09 | External Action Preflight·Execute      | validate → prepare → approve → preflight → execute (attempt SUCCEEDED); XP-I05                                                                                                                                         |
| CP-AC-10 | Activity                               | activity/refresh (real route) → activity/queue shows the executed action + execution ref; XP-I06                                                                                                                       |
| CP-AC-11 | History · Audit                        | operator history rebuild → history/workspace shows the canonical commit + Review Approval authority; XP-I06                                                                                                            |
| CP-AC-12 | Reversal · Compensation                | reversal-draft (historical approval evidence) → the Reversal carrier appears in the Review queue/context (Review entry) + compensations/prepare (original action lineage); XP-I07                                      |

## 5. Lineage invariants — XP-I01 ~ XP-I07

| Invariant | Assertion in the journey                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| XP-I01    | The ingested Source stays on `journey-alpha` after switching to `journey-beta`; it is visible again after switching back.                                                                                                                                                                                                                                                |
| XP-I02    | Ask citation `sourceId`/`sourceVersionId`/`evidenceSpanId` == saved CLAIM_ADD `evidenceReferences[0]` — all three identities (incl. `sourceId`) match.                                                                                                                                                                                                                   |
| XP-I03    | Review Context `targetId == draftId`, `targetRevision == String(draftRevision)`, `targetDigest == reviewSubmission.contentDigest` AND the created Approval Resource is bound to the same `reviewContextId`/`contextRevision`/`targetId`/`targetRevision`/`targetDigest`/`approvedItemIds`.                                                                               |
| XP-I04    | (before commit) the Knowledge Workspace projection reports `canonicalVersion === 0` + the empty snapshot digest right after the Approval — creating the Approval causes NO Canonical change; (after commit) the same projection reports an advanced `canonicalVersion` + changed digest, and the Approval read fail-closes (`REVIEW_APPROVAL_NOT_ISSUED` 409, consumed). |
| XP-I05    | Manifest → Approval → Preflight → Execute share the same action id + manifest revision, and the Approval/Preflight/Attempt bind the same `resourceProjectId`/`effectiveProjectId`/`policyContextRevision`; Preflight `policyRevalidated === true` (action revision 1→2→3→4).                                                                                             |
| XP-I06    | Activity queue references the journey's action id + execution run id; History workspace references the journey's canonical `commitId` and the Review Approval `authorityId`, and preserves the authoritative source identity (`sourceEventKind = CANONICAL_CLAIM_ADDED`, `sourceEventId = history:<commitId>`).                                                          |
| XP-I07    | Canonical branch: `reversal-draft` (source revision `revision:<commitId>`) carries `sourceCommitId` + evidence-only `historicalApprovalRef`, AND the materialized Reversal carrier (`draftId = reversalId`) surfaces in the real Review queue/context as a reviewable entry. External branch: `compensations/prepare` preserves `sourceActionId` + `sourceExecutionId`.  |

## 6. Production blockers discovered by the journey (all fixed)

| Blocker                                                                       | Root cause                                                                                                                                                                                               | Fix                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source intake did not run Transformation/Evidence (Correction C, GPT BLOCKED) | the Sources intake never triggered the Stage 3 pipeline; the journey bridged it fixture-side                                                                                                             | new `SourcesStage3PipelinePort` + `sources-stage3-pipeline` adapter; the Sources product service runs the REAL Stage 3 adapters after a successful intake materializes each SourceVersion; fixture `bridgeEvidence()` removed |
| Review Queue always empty                                                     | `submitDraftForReview` did not set a top-level `reviewResource`; the DraftReviewTargetAdapter requires `draft.reviewResource`                                                                            | `product-api.ts`: single shared `reviewResourceIdValue` for top-level + reviewSubmission                                                                                                                                      |
| `commitFrontendDraft` STALE_APPROVAL on every fresh draft                     | `PostgresFrontendKnowledgeDraftTargetResolver` returned a placeholder empty-snapshot digest (`sha256:000...0`) instead of the canonical empty digest                                                     | resolver now returns `canonicalSnapshotDigest(projectId, 0, [])`                                                                                                                                                              |
| `record-decisions` failed on production composition                           | InMemory Review store + Postgres Command Ledger mismatch                                                                                                                                                 | `ApplicationOptions.frontendReviewStore` + production `main.ts` injects `PostgresFrontendReviewRepository`                                                                                                                    |
| `knowledge/workspace` failed after a frontend commit                          | `ListCanonicalHistory` output schema required non-null `manifestId`/`changeSetId`; frontend-authority commits carry null by design (matching `CanonicalHistoryEvent` type + `GetCanonicalCommit` schema) | `list-canonical-history-output.v1.schema.json` allows `["string","null"]`                                                                                                                                                     |
| History rebuild duplicate-key                                                 | `PolicyHistoryAdapter.historyEntryId` was keyed only on `sourceId`; `POLICY_CONTEXT_REVISION:1` and `SETTINGS_REVISION:1` collided on the projection PRIMARY KEY                                         | entry id now includes `sourceKind`; regression test added                                                                                                                                                                     |
| External Action preflight/execute `EXTERNAL_ACTION_STALE`                     | preflight/execute must pin the CURRENT action revision (3 after approve, 4 after preflight) — the journey payload (and any browser) must track the monotonic revision                                    | journey uses `expectedActionRevision` 3/4; documented revision lifecycle                                                                                                                                                      |
| Reversal `REVERSAL_SOURCE_NOT_FOUND`                                          | journey passed the commit id; the API requires the REVISION id (`revision:<commitId>`)                                                                                                                   | journey payload fixed                                                                                                                                                                                                         |
| Reversal missing `historicalApprovalRef`                                      | `historicalApprovalResolver` (WP3 Round 1 fix B) was defined but never wired in the server composition                                                                                                   | server wires it via `findCommit(revision)` → `commit.authorityId` (the Review Approval id)                                                                                                                                    |
| External Action preflight DENIED                                              | `fake-connector` credential + project budget were not provisioned (server-owned admin state)                                                                                                             | fixture seeds credential + budget via the real store                                                                                                                                                                          |

## 7. Verification

- `npx tsc --noEmit` PASS.
- `npm run format:check` PASS; `npm run lint` PASS.
- `npm run docs:validate` PASS; `npm run test:architecture` PASS; `npm run stage12:reuse-operations-gate` PASS.
- Unit: 481 tests PASS (incl. the new Policy adapter collision regression).
- Contract: 458 tests PASS.
- Database: history projection / payload-state / knowledge-product-read /
  external-action parity / reversal / review parity = 40 tests PASS.
- Integration: reversal carrier/review-queue, history security-negative /
  deleted-project-audit, external-action product-api/domain = 56 tests PASS.
- Browser journey: `tests/browser/frontend-cross-phase-journey.spec.ts`
  **1 passed** on a fresh DB and on the dirty shared DB (re-run resilience) —
  with Correction C (real production intake pipeline) + hardened invariant
  assertions.
- CI (automatic on push, PR #83): implementation head `1753707c0` run #746
  SUCCESS; Correction Round 1 head `85dbd8f0b` run #748 SUCCESS; Correction
  Round 2 exact head `698c1eb5b` run #750 / 31381019634 SUCCESS (Quality +
  Frontend + Required Gates) — see frontmatter. CI #746/#748/#750 were never
  re-run; the docs-only frontmatter commit's run is NOT used as technical
  evidence (GPT governance).
- Correction Round 2 local gates all PASS (below); Correction Round 3 (below)
  local gates all PASS; the automatic CI on the Round 3 exact head is the
  final gate (no docs-only metadata commit per GPT governance).

## 8. Known limits / handoff

- WP-XP3 (CP-NEG-01~06 new journey-level negative deltas + evidence closure)
  is NOT part of this Work Package and is NOT started (GPT: NOT AUTHORIZED).
- PR #83 stays Draft; merge remains FORBIDDEN until the Cross-Phase
  verification (WP-XP2 + WP-XP3) is complete and GPT review accepts.
- The History projection rebuild remains an operator step (no browser refresh
  route by design); the journey documents it as such.
- Deployment / Production Verification remain NOT_AUTHORIZED / NOT_RUN.

## 9. Correction Round 2 — Stage 3 post-commit failure recovery

GPT second review (CHANGES_REQUIRED) required that a Source Intake submission
is never finalized SUCCEEDED before its Stage 3 (Transformation/Evidence)
pipeline completed, and that a Stage 3 failure leaves the submission in a
retryable state that resumes the SAME SourceVersions without creating
duplicates. This evidence cleanup ships inside the Stage 3 fix commit
(GPT governance: no separate docs-only metadata commit).

### 9.1 Delta (production)

`adapters/frontend-sources-write-postgres/src/product-service.ts`:

- After the (durable) materialization COMMIT the submission is set to
  `RUNNING` (or `PARTIAL`/`ACTION_REQUIRED` when exact-duplicate items exist),
  never SUCCEEDED.
- The real Stage 3 pipeline then runs for every materialized SourceVersion;
  only on completion the submission is finalized `SUCCEEDED`/`PARTIAL`.
- A Stage 3 failure flips the submission to `OUTCOME_INDETERMINATE`
  (`markSubmissionStage3Incomplete`) and rethrows — no false SUCCESS without
  Evidence.
- A replay of the same command with an `OUTCOME_INDETERMINATE` submission
  resumes the SAME materialized SourceVersions
  (`materializedItemsForStage3` → `runStage3AndFinalize`), so retry completes
  Transformation/Evidence without creating duplicate Source/SourceVersion.

### 9.2 Focused regression (Sources)

`tests/database/frontend-sources-stage3-recovery.test.ts` — one test with a
`FailOnceStage3Pipeline` wrapper (first pipeline call throws a transient
fault, then delegates to the real production pipeline):

1. `submit()` first attempt → throws the Stage 3 fault.
2. Submission state is `OUTCOME_INDETERMINATE` (no false final SUCCESS) and
   the durable Source/SourceVersion are already materialized.
3. `submit()` retry → `SUCCEEDED`, resuming the SAME `sourceId` /
   `sourceVersionId`.
4. `asset.source_versions` has exactly 1 row for the pair (no duplicate).
5. `evidence.spans` has rows for the same `project_id` + `source_version_id`
   (real pipeline evidence).

Local gates for Round 2 (all PASS): `npx tsc --noEmit`; sources DB suite
(persistence 5 + lifecycle 2 + duplicate 2 + recovery 1 = 10); sources
product-api integration (3); cross-phase journey E2E on fresh DB and on the
dirty shared DB (re-run resilience, 2 passes); `format:check`, `lint`,
`docs:validate`.

Final gate: the automatic CI on this exact Round 2 head (PR #83). No CI
metadata is appended via a later docs-only commit.

Round 2 exact-head CI confirmed by GPT review: **#750 / run 31381019634** on
`698c1eb5b` (Quality · Frontend · Required Gates all SUCCESS). The interim
user report called it "#752"; GPT corrected the label to #750 — the run id is
the authoritative record and it was never re-run.

## 10. Correction Round 3 — mixed PARTIAL submission recovery

GPT third review (CHANGES_REQUIRED, Round 2 primary path CLOSED) found one
remaining blocker: a submission with BOTH a duplicate/action-required item and
a newly materialized item commits as `PARTIAL`; when its Stage 3 fails, the
submission stayed `PARTIAL` forever (no resume trigger) — a materialized
SourceVersion could remain permanently without Evidence.

### 10.1 Delta (production + schema)

- `adapters/frontend-sources-write-postgres/src/product-service.ts`:
  - `markSubmissionStage3Incomplete()` now flips `RUNNING` **or** `PARTIAL`
    to `OUTCOME_INDETERMINATE` (retryable) on a Stage 3 failure — the mixed
    submission is no longer stuck.
  - The resume path preserves the original mix: `materializedItemsForStage3()`
    also returns the count of still action-required (duplicate-decision)
    items, and `runStage3AndFinalize()` finalizes `PARTIAL` for a mixed
    submission and `SUCCEEDED` only when no item is action-required.
- `db/migrations/035_frontend_sources_stage3_recovery.sql`: extends
  `source_product.enforce_submission_transition()` to allow
  `PARTIAL → OUTCOME_INDETERMINATE` (append-only migration; `db:reset`
  re-applies the full set).

### 10.2 Focused regression (mixed case)

`tests/database/frontend-sources-stage3-recovery.test.ts` adds the mixed case
on the same fail-once pipeline:

1. Anchor Source created by a real-pipeline submit (duplicate content target).
2. Mixed submission `[duplicate item, new item]` with a fresh fail-once
   pipeline → Stage 3 throws on first attempt.
3. State is `OUTCOME_INDETERMINATE` (mixed PARTIAL is retryable, never a
   false SUCCESS, never a stuck PARTIAL); the new item has a durable
   Source/SourceVersion; the duplicate item is action-required.
4. Retry → final state `PARTIAL` (mixed outcome preserved), resuming the SAME
   `sourceId`/`sourceVersionId`.
5. `asset.source_versions` has exactly 1 row for the pair (no duplicate);
   `evidence.spans` has rows for the same `project_id` + `source_version_id`.

### 10.3 Local gates (all PASS)

`npx tsc --noEmit`; sources DB suite (persistence 5 + lifecycle 2 + duplicate
2 + recovery 2 = 11); sources product-api integration (3); cross-phase journey
E2E on fresh DB and on the dirty shared DB (2 passes); `format:check`, `lint`,
`docs:validate`.

Final gate: the automatic CI on this exact Round 3 head (PR #83). No CI
metadata is appended via a later docs-only commit.

## 11. Closure reference (append-only, 2026-08-10)

Cross-Phase Governance Closure (GPT AUTHORIZED) normalizes the WP-XP2 final
state after merge — prior CHANGES_REQUIRED review records above are preserved
as history, never rewritten:

- WP-XP2: **ACCEPTED / COMPLETE** (GPT Final Review ACCEPTED 2026-08-10).
- Correction C + Recovery Rounds 1~3: **CLOSED**.
- Correction Round 3 terminal accepted head: `37e67874a` / CI **#751** / run
  31382160274 / SUCCESS.
- Merged via PR #83 (`774f2fffa`); canonical `main` at the merge commit;
  post-merge main CI #753 / run 31386938625 / SUCCESS.
- Final Cross-Phase authority: `docs/engineering/frontend-cross-phase-product-verification-evidence-260809001.md`
  (status COMPLETE / FINAL_AFTER_MERGE).
