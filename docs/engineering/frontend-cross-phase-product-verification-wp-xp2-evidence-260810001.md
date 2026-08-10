---
id: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION-WP-XP2-EVIDENCE-260810001
classification: CANONICAL
status: wp_xp2_implemented
work_item: FE-P5-XP
created_at: 2026-08-10
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
governing_ir: docs/implementation/frontend-cross-phase-product-verification-implementation-request-260809001.md
gap_repair_amendment: docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md
correction_b_evidence: docs/implementation/frontend-cross-phase-correction-b-implementation-evidence-260809001.md
wp_xp2_implementation_head: 1753707c0
wp_xp2_implementation_ci_number: 746
wp_xp2_implementation_ci_conclusion: SUCCESS
wp_xp2_implementation_ci_run_id: 31375519252
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

| Domain / boundary            | main.ts (production)                                            | Cross-Phase fixture (WP-XP2)                                        | Parity |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| Project / Auth / Settings    | PostgresProjectAdministration / PostgresAuth / PostgresSettings | Same                                                                | 1:1    |
| Command Ledger               | PostgresFrontendCommandGateway                                  | Same                                                                | 1:1    |
| Sources                      | PostgresSourcesProductService + SealedSourcesStagingService     | Same                                                                | 1:1    |
| Ask write/execution          | PostgresAsk* repositories + AskAnswerExecutionService           | Same (AIProvider = FakeAIProvider via StructuredAskAnswerProvider)   | 1:1*   |
| Knowledge Draft              | PostgresFrontendKnowledgeDraft*                                 | Same                                                                | 1:1    |
| Review boundary (review store) | PostgresFrontendReviewRepository                              | Same (production parity — WP-XP2 blocker)                           | 1:1    |
| Canonical                    | PostgresCanonicalKnowledgeRepository                            | Same                                                                | 1:1    |
| Change-Set-Review            | PostgresChangeSetReviewRepository                               | Same                                                                | 1:1    |
| External Action              | PostgresExternalActionStore + FakeExternalActionEngine          | Same (+ admin-seeded credential/budget — server-owned state)        | 1:1*   |
| Activity read model          | PostgresActivity*                                              | Same                                                                | 1:1    |
| History read model / payload | PostgresHistory* + PostgresPayloadStateStore                    | Same                                                                | 1:1    |
| Product read projections     | InMemory (shell/action-center/etc.) + PostgresKnowledgeWorkspaceProjection (kernel connector) | Same | 1:1    |
| Transformation / Evidence    | PostgresTransformationRepository / PostgresEvidenceRepository   | Same (Stage 3 bridge, below)                                        | 1:1    |
| AIProvider / ActionConnector | Gemini (AIProvider) / FakeDraftActionConnector                  | FakeAIProvider / FakeDraftActionConnector                           | fake   |

\* External side-effect boundary (deterministic fake) — recorded in the IR as
the only stubbed part of the E2E bridge.

## 3. Known product-gap bridges (real adapters, never stubs)

1. **Evidence bridge** — the Sources intake does not trigger the Stage 3
   Transformation/Evidence pipeline (documented product gap). The journey runs
   the REAL Stage 3 adapters (`PythonDocumentFormatAdapter`,
   `LucasAugmentedPlainTextAdapter`, `PostgresTransformationRepository`,
   `PostgresEvidenceRepository`, `buildEvidenceCandidates`) so Ask grounds on
   the freshly ingested SourceVersion's EvidenceSpans.
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

| AC        | Flow (real Product API)                                          | Journey proof                                                    |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| CP-AC-01  | Session bootstrap + CSRF                                          | `/api/v1/session/local-bootstrap` → real cookie; `/api/v1/security/csrf` → token used on every mutation |
| CP-AC-02  | Project create + active-project switch                            | `project.create.v1` ×2 (`journey-alpha`, `journey-beta`); `/api/v1/session/active-project`; XP-I01 |
| CP-AC-03  | Source intake                                                     | staging/bytes (DIRECT_TEXT) → `sources.intake.submit.v1` → poll `SUCCEEDED` → sources/query library |
| CP-AC-04  | Ask + citation                                                    | `ask/questions` (SOURCE_EXPLORATION + pinned EvidenceSpans) → poll answer run → citation lineage; XP-I02 |
| CP-AC-05  | Knowledge read                                                    | `knowledge/workspace` after the commit resolves the committed Canonical state |
| CP-AC-06  | DraftChangeSet                                                    | transition-seed → materialize → save CLAIM_ADD → validate → impact-preview → submit-review; XP-I02/I03 |
| CP-AC-07  | Review · Approval                                                 | review/queue → contexts/read → decisions (APPROVE) → approval ACTIVE; XP-I03 |
| CP-AC-08  | Canonical Commit                                                  | approvals/read → drafts/commit → commitIds; Approval consumed (read fails closed); XP-I04 |
| CP-AC-09  | External Action Preflight·Execute                                 | validate → prepare → approve → preflight → execute (attempt SUCCEEDED); XP-I05 |
| CP-AC-10  | Activity                                                          | activity/refresh (real route) → activity/queue shows the executed action + execution ref; XP-I06 |
| CP-AC-11  | History · Audit                                                   | operator history rebuild → history/workspace shows the canonical commit + Review Approval authority; XP-I06 |
| CP-AC-12  | Reversal · Compensation                                           | reversal-draft (historical approval evidence) + compensations/prepare (original action lineage); XP-I07 |

## 5. Lineage invariants — XP-I01 ~ XP-I07

| Invariant | Assertion in the journey                                         |
| --------- | ---------------------------------------------------------------- |
| XP-I01    | The ingested Source stays on `journey-alpha` after switching to `journey-beta`; it is visible again after switching back. |
| XP-I02    | Ask citation `sourceId`/`sourceVersionId`/`evidenceSpanId` == saved CLAIM_ADD `evidenceReferences[0]` (same SourceVersion/Evidence identity). |
| XP-I03    | Review Context `targetId == draftId`, `targetRevision == String(draftRevision)`, `targetDigest == reviewSubmission.contentDigest` — Draft base → Review Context → Approval point to the same change. |
| XP-I04    | The Approval is ACTIVE before the commit; after the commit the public read API fail-closes (`REVIEW_APPROVAL_NOT_ISSUED` 409) — Approval and Commit are separate and the Commit consumes the Approval. |
| XP-I05    | Manifest → Approval → Preflight → Execute share the same action id, manifest revision, target revision and external revision (revised action revision 1→2→3→4). |
| XP-I06    | Activity queue references the journey's action id + execution run id; History workspace references the journey's canonical `commitId` and the Review Approval `authorityId`. |
| XP-I07    | Canonical branch: `reversal-draft` (source revision `revision:<commitId>`) carries `sourceCommitId` and the historical `approvalId` as evidence-only `historicalApprovalRef`. External branch: `compensations/prepare` preserves `sourceActionId` + `sourceExecutionId`. |

## 6. Production blockers discovered by the journey (all fixed)

| Blocker | Root cause | Fix |
| ------- | ---------- | --- |
| Review Queue always empty | `submitDraftForReview` did not set a top-level `reviewResource`; the DraftReviewTargetAdapter requires `draft.reviewResource` | `product-api.ts`: single shared `reviewResourceIdValue` for top-level + reviewSubmission |
| `commitFrontendDraft` STALE_APPROVAL on every fresh draft | `PostgresFrontendKnowledgeDraftTargetResolver` returned a placeholder empty-snapshot digest (`sha256:000...0`) instead of the canonical empty digest | resolver now returns `canonicalSnapshotDigest(projectId, 0, [])` |
| `record-decisions` failed on production composition | InMemory Review store + Postgres Command Ledger mismatch | `ApplicationOptions.frontendReviewStore` + production `main.ts` injects `PostgresFrontendReviewRepository` |
| `knowledge/workspace` failed after a frontend commit | `ListCanonicalHistory` output schema required non-null `manifestId`/`changeSetId`; frontend-authority commits carry null by design (matching `CanonicalHistoryEvent` type + `GetCanonicalCommit` schema) | `list-canonical-history-output.v1.schema.json` allows `["string","null"]` |
| History rebuild duplicate-key | `PolicyHistoryAdapter.historyEntryId` was keyed only on `sourceId`; `POLICY_CONTEXT_REVISION:1` and `SETTINGS_REVISION:1` collided on the projection PRIMARY KEY | entry id now includes `sourceKind`; regression test added |
| External Action preflight/execute `EXTERNAL_ACTION_STALE` | preflight/execute must pin the CURRENT action revision (3 after approve, 4 after preflight) — the journey payload (and any browser) must track the monotonic revision | journey uses `expectedActionRevision` 3/4; documented revision lifecycle |
| Reversal `REVERSAL_SOURCE_NOT_FOUND` | journey passed the commit id; the API requires the REVISION id (`revision:<commitId>`) | journey payload fixed |
| Reversal missing `historicalApprovalRef` | `historicalApprovalResolver` (WP3 Round 1 fix B) was defined but never wired in the server composition | server wires it via `findCommit(revision)` → `commit.authorityId` (the Review Approval id) |
| External Action preflight DENIED | `fake-connector` credential + project budget were not provisioned (server-owned admin state) | fixture seeds credential + budget via the real store |

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
  **1 passed** on a fresh DB and on the dirty shared DB (re-run resilience).
- CI (automatic on push, PR #83): run #746 — see frontmatter conclusion
  (recorded once green).

## 8. Known limits / handoff

- WP-XP3 (CP-NEG-01~06 new journey-level negative deltas + evidence closure)
  is NOT part of this Work Package and is NOT started.
- PR #83 stays Draft; merge remains FORBIDDEN until the Cross-Phase
  verification (WP-XP2 + WP-XP3) is complete and GPT review accepts.
- The History projection rebuild remains an operator step (no browser refresh
  route by design); the journey documents it as such.
- Deployment / Production Verification remain NOT_AUTHORIZED / NOT_RUN.
