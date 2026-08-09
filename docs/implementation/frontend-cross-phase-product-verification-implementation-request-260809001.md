---
id: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION-IR-260809001
classification: CANDIDATE
status: draft_pending_review
work_item: FE-P5-XP
created_at: 2026-08-09
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
precedent: FE-P5-S2 COMPLETE / FINAL_AFTER_MERGE (2026-08-09)
governing_contract: docs/architecture/frontend/cross-phase-contract-and-completion-audit.md
governing_plan: docs/implementation/frontend-phase-1-5-plan-v1.0.md
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
---

# Shotgun — Frontend Cross-Phase Product Verification Implementation Request r0

## 1. Authority and precedents

- FE-P1 ~ FE-P5 (12 Sections): **COMPLETE** — `main@07990d6e` (2026-08-09,
  FE-P5-S2 FINAL_AFTER_MERGE).
- GPT review gate (2026-08-09): FE-P5-S2 Section Completion confirmed; next
  ordered stage is **Cross-Phase Product Verification** followed by Local
  Launch / Serving Usability, Backup / Restore Owner Workflow and Final Local
  Acceptance.
- GPT guidance: Cross-Phase verification must **not** re-verify every Section;
  it verifies the **core user flows that connect FE-P1~P5** on one backend and
  reuses existing evidence. Deployment / Production Verification remain
  separate and NOT_AUTHORIZED.
- This document is a **verification-only** Implementation Request (no new
  Product feature, no new runtime dependency, no Contract/ADR semantic change).
  It authorizes the Cross-Phase verification evidence work described below.

## 2. Scope

### Included

1. Extend the browser E2E fixture backend (`tests/browser/fixtures/frontend-test-backend.ts`)
   so a **single application instance** serves all Phase product APIs
   statefully (Sources, Ask, Knowledge/Draft, Review, External Action,
   Activity, History/Tombstone/Reversal) with shared in-memory adapters and
   coordinators, mirroring the persistent runtime composition in
   `assemblies/shotgun-app/src/main.ts`.
2. One **cross-phase journey browser spec** that drives the 12 required
   end-to-end flows through the real product APIs (not stubbed endpoints),
   chaining FE-P1~P5 in one user journey.
3. Cross-phase **negative boundary tests** for the 10 required negatives where
   the journey/browser boundary is the subject (server revalidation while
   chaining phases).
4. Cross-phase evidence document recording AC→evidence mapping, reusing
   existing per-Section evidence and adding only the journey-level evidence.

### Excluded

- New Product features, new migrations, new runtime dependencies.
- Re-running already-PASS exact-head per-Section suites (reuse evidence).
- Contract/ADR semantic changes; Canonical/Approval/Evidence/Action boundary
  changes.
- Deployment, Production Verification, Local Launch, Backup/Restore, Final
  Local Acceptance (later stages, separately authorized).
- Yjs/CRDT, Graph virtualization, multi-approval DSL and other deferred items.

## 3. Required end-to-end journey — CP-AC mapping

One browser journey chains all 12 flows (IR r0; a single journey may cover
multiple ACs, and adjacent-phase wiring may be verified in the same spec):

| AC     | Flow (frontend-phase-1-5-plan §Cross-Phase)              | Existing evidence (reuse)                                                                                                             | Journey proof (new)                    |
| ------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| CP-AC-01 | Local Owner Bootstrap                                    | `tests/integration/frontend-section3-bootstrap.test.ts`, `tests/database/auth-postgres.test.ts`, browser `frontend-section-3.spec.ts` | Journey boot step (fixture bootstrap)  |
| CP-AC-02 | Project 생성·전환                                        | browser `frontend-section-2.spec.ts`, `frontend-section-1.spec.ts`; `frontend-project-cache.test.ts`                                  | Create + switch project in journey     |
| CP-AC-03 | Source 입력·처리·중복                                    | browser `frontend-phase-2-section-1.spec.ts`; sources/intake contract+database suites                                                | Submit source in journey               |
| CP-AC-04 | Ask·Citation                                             | browser `frontend-phase-2-section-2.spec.ts`; ask contract/database suites                                                            | Ask submit + citation pin in journey   |
| CP-AC-05 | Knowledge 탐색                                           | browser `frontend-knowledge-workspace.spec.ts`, `frontend-knowledge-graph.spec.ts`; knowledge suites                                  | Knowledge read after commit in journey |
| CP-AC-06 | DraftChangeSet                                           | `knowledge-draft-controller.test.ts`, `frontend-knowledge-draft-*.test.ts`                                                            | Draft materialize/save in journey      |
| CP-AC-07 | Review·Approval                                          | browser `frontend-review.spec.ts`; review domain/security suites                                                                      | Review + Record APPROVE in journey     |
| CP-AC-08 | Canonical Commit                                         | `canonical-knowledge.contract.test.ts`, `stage-6-postgres.test.ts`                                                                    | Canonical commit in journey            |
| CP-AC-09 | External Action Preflight·Execute·Verify                 | browser `frontend-external-action-lifecycle.spec.ts`; external-action domain suites                                                  | Governed action flow in journey        |
| CP-AC-10 | Activity                                                 | browser `frontend-activity-workspace.spec.ts`; activity suites                                                                        | Activity reflects journey events       |
| CP-AC-11 | History·Audit                                            | browser `frontend-history-workspace.spec.ts`; history suites                                                                          | History reflects journey decisions     |
| CP-AC-12 | Reversal·Compensation                                    | browser `frontend-history-workspace.spec.ts`; reversal/carrier suites                                                                 | Reversal → Review in journey           |

## 4. Required negative tests — CP-NEG mapping

| NEG     | Negative (frontend-phase-1-5-plan §Cross-Phase)                  | Existing evidence (reuse)                                                                    | Journey-level proof (new)                          |
| ------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| CP-NEG-01 | Frontend의 Principal·Project 권위 생성 금지                      | `stage12-p0-1-security.test.ts`, `product-settings-api.test.ts`, browser forbidden-header specs | Journey browser requests carry no authority fields |
| CP-NEG-02 | 다른 Project Cache 재사용 금지                                   | `frontend-project-cache.test.ts`, `frontend-query-keys.test.ts`, browser `frontend-knowledge-api.spec.ts` | Project switch in journey isolates reads           |
| CP-NEG-03 | 민감 Resource 존재 노출 금지                                     | review/knowledge/activity/history non-disclosure suites                                         | Journey cross-project read non-disclosing          |
| CP-NEG-04 | Candidate 자동 Canonical 반영 금지                               | `canonical-knowledge.contract.test.ts`, `review-ui.test.ts`, browser `frontend-review.spec.ts`   | Journey: unapproved draft absent from canonical    |
| CP-NEG-05 | Approval 우회 금지                                               | `frontend-external-action-domain.test.ts`, `action-execution-api.test.ts`                        | Journey: execute requires ACTIVE approval          |
| CP-NEG-06 | Approval과 Commit·Execute 혼합 금지                              | `frontend-review-negative.test.ts`, browser `frontend-external-action-lifecycle.spec.ts`          | Journey: approve ≠ commit ≠ execute (separate)     |
| CP-NEG-07 | Outcome Unknown 자동 재제출 금지                                 | `frontend-external-action-lifecycle.spec.ts`, connector reliability suites                         | Journey: OUTCOME_UNKNOWN no auto resubmit          |
| CP-NEG-08 | Cancel을 Rollback으로 표시하지 않음                              | `frontend-external-action-domain.test.ts`, browser lifecycle spec                                  | Journey: Cancel ≠ Rollback display                 |
| CP-NEG-09 | 삭제 Project Audit 범위 확대 금지                                | `frontend-history-deleted-project-audit.test.ts`, `project-tombstone.test.ts`                      | Journey: deleted-project audit requires scope      |
| CP-NEG-10 | Retention Purge로 Event Identity 삭제 금지                       | `frontend-history-payload-state*.test.ts`, `frontend-history-persistence.test.ts`                  | Journey: purge keeps identity, redacts payload     |

## 5. Work package plan

- **WP-XP1 — Fixture backend composition**: extend `frontend-test-backend.ts`
  to construct shared in-memory adapters/coordinators (knowledge draft,
  review, external action, activity, history, tombstone, payload state,
  policy history) and pass them through `createApplication` options so all
  Phase product APIs are stateful on one backend instance. Follow the
  persistent composition in `main.ts` and the in-memory default composition
  in `server.ts`. No production code change.
- **WP-XP2 — Cross-phase journey E2E**: new `tests/browser/frontend-cross-phase-journey.spec.ts`
  driving the 12-flow journey through real product APIs (project create →
  source → ask → draft → review → approve → canonical commit → external
  action → activity → history → reversal), with E2E bridge for external
  connector and answer execution stubbing where the external side effect is
  the only stubbed part.
- **WP-XP3 — Cross-phase negatives + evidence**: journey-level negative
  coverage for CP-NEG-01~10 that is not already proven at the journey
  boundary, plus the cross-phase evidence document
  (`docs/engineering/frontend-cross-phase-product-verification-evidence-260809001.md`)
  recording CP-AC/CP-NEG closure with existing-evidence reuse.

## 6. Test policy

- Reuse already-PASS per-Section evidence; do not re-run full suites.
- Only the delta needed for the journey (fixture extension + new specs) is
  executed; normal-push automatic CI is the authoritative CI evidence.
- Do not duplicate per-Section tests inside the journey spec.
- OSS review: verification stage — no new OSS candidates; existing verified
  adapters (in-memory fixtures) are reused. `NO_RELEVANT_OSS` for new
  verification tooling beyond the existing Playwright/Vitest stack.

## 7. Completion criteria / gates

1. Fixture backend serves all Phase product APIs statefully on one instance
   (single exact-head CI PASS).
2. Cross-phase journey spec passes (12 flows covered through real APIs).
3. CP-NEG-01~10 closure recorded (existing evidence + journey delta).
4. Cross-phase evidence document updated with evidence head + CI.
5. GPT review gate ACCEPTED; then user approval for Ready/Merge/closure.

## 8. Next gate

```text
IR r0: DRAFT (candidate for GPT review)
→ GPT review → IR r1 FROZEN
→ WP-XP1 → WP-XP2 → WP-XP3 (one at a time, exact-head CI)
→ Evidence → GPT review → ACCEPTED
→ 사용자 Section Completion 승인 → Ready/Merge → Closure
Deployment / Production Verification: NOT_AUTHORIZED
```
