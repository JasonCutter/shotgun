---
id: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION-IR-260809001
classification: CANDIDATE
status: r1_frozen_execution_authorized
review_authority: GPT_IR_REVIEW_ACCEPTED
reviewed_at: 2026-08-09
review_head: b29852a0a5aa87db7e728aefd166a9b40fa25462
approved_by: USER
approved_at: 2026-08-09
approval_authority: Explicit user IR execution approval
approval_head: 67116b8a0
verification_gate: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION
created_at: 2026-08-09
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
precedent: FE-P5-S2 COMPLETE / FINAL_AFTER_MERGE (2026-08-09)
governing_contract: docs/architecture/frontend/cross-phase-contract-and-completion-audit.md
governing_plan: docs/implementation/frontend-phase-1-5-plan-v1.0.md
gap_repair_amendment: docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
---

# Shotgun — Frontend Cross-Phase Product Verification Implementation Request r0

## 1. Authority and precedents

- FE-P1 ~ FE-P5 (12 Sections): **COMPLETE** — `main@07990d6e` (2026-08-09,
  FE-P5-S2 FINAL_AFTER_MERGE).
- GPT review gate (2026-08-09): FE-P5-S2 Section Completion confirmed; next
  ordered stage is **Cross-Phase Product Verification** (a Verification Gate
  after FE-P1~P5, NOT a Section of FE-P5), followed by Local Launch / Serving
  Usability, Backup / Restore Owner Workflow and Final Local Acceptance.
- GPT guidance: Cross-Phase verification must **not** re-verify every Section;
  it verifies the **core user flows that connect FE-P1~P5** on the actual
  Product composition and reuses existing evidence. Deployment / Production
  Verification remain separate and NOT_AUTHORIZED.
- This document is a **verification-only CANDIDATE** Implementation Request
  (no new Product feature, no new runtime dependency, no Contract/ADR semantic
  change). **It does NOT authorize execution.** Execution requires, in order:
  `IR r0 CANDIDATE → GPT IR REVIEW ACCEPTED → USER explicit approval →
  IR r1 FROZEN / EXECUTION_AUTHORIZED → WP-XP1`. GPT review acceptance does
  not replace user approval.

## 2. Scope

### Included

1. Extend the browser E2E fixture backend (`tests/browser/fixtures/frontend-test-backend.ts`)
   so a **single application instance** serves all Phase product APIs
   statefully (Sources, Ask, Knowledge/Draft, Review, External Action,
   Activity, History/Tombstone/Reversal) **with production-composition parity**
   (see §5 WP-XP1): PostgreSQL adapters where `main.ts` owns the domain
   authority (Ask, Knowledge Draft, Review/Approval, Canonical, External
   Action, Activity, History), the same InMemory implementations that `main.ts`
   itself uses for projections, and deterministic fakes ONLY for external side
   effects (`AIProviderPort`, `ActionConnectorPort`). No test-specific
   authority composition.
2. One **cross-phase journey browser spec** that drives the 12 required
   end-to-end flows through the real product APIs (not stubbed endpoints),
   chaining FE-P1~P5 in one user journey and asserting the Cross-Phase lineage
   invariants (XP-I01~XP-I07).
3. Cross-phase **negative delta tests** only where a phase-crossing journey
   adds new risk (CP-NEG classified as `REUSE_ONLY` vs `NEW_CROSS_PHASE_DELTA`,
   see §4).
4. Cross-phase evidence document recording AC→evidence mapping (incl. the
   production-vs-test adapter parity table), reusing existing per-Section
   evidence and adding only the journey-level evidence.

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
| CP-AC-12 | Reversal·Compensation                                    | browser `frontend-history-workspace.spec.ts`; reversal/carrier suites; external-action rollback/compensation suites                    | BOTH branches in journey: Canonical branch (Historical Revision → Reversal Draft → Review entry) AND External Action branch (Executed Action → Compensation initiation/link → original action lineage preserved) |

### Cross-Phase lineage invariants (XP-I01 ~ XP-I07)

The journey must assert that the chain
`Project → Resource → Revision → Evidence → Draft → Review → Approval → Commit
→ Action → Activity → History → Reversal/Compensation` is connected by the
SAME authority and identity chain (not just that screens render):

| Invariant | Requirement                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| XP-I01    | Project Binding: an existing Resource stays on its Resource Project after an Active Project switch; no rebinding.   |
| XP-I02    | Evidence Lineage: SourceVersion/Evidence/Citation identity is preserved across Ask → Draft/Knowledge transition.   |
| XP-I03    | Draft/Review Binding: Draft base revision + target identity → Review Context → Approval Resource point to the same change. |
| XP-I04    | Approval/Commit Separation: creating an Approval causes no Canonical change; only the approved exact ChangeSet commits. |
| XP-I05    | Action Authority: External Action Manifest/Preflight/Approval/Execute share the same resource/revision/policy binding. |
| XP-I06    | Operations Lineage: Activity and History reference the journey's actual Domain IDs and correlation/causation/source identities. |
| XP-I07    | Rollback Branching: Canonical change → Reversal; External change → Compensation; the two never substitute for each other. |

## 4. Required negative tests — CP-NEG classification

All 10 Canonical negatives must be CLOSED, but each is classified as either
`REUSE_ONLY` (existing per-Section evidence already closes it; no new test
because the journey adds no new risk) or `NEW_CROSS_PHASE_DELTA` (a new
delta test IS required because the phase-crossing journey adds new risk).

| NEG     | Negative (frontend-phase-1-5-plan §Cross-Phase)                  | Existing evidence (reuse)                                                                      | Disposition                             |
| ------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| CP-NEG-01 | Frontend의 Principal·Project 권위 생성 금지                      | `stage12-p0-1-security.test.ts`, `product-settings-api.test.ts`, browser forbidden-header specs   | `NEW_CROSS_PHASE_DELTA` — journey browser requests carry no authority fields across all phase routes |
| CP-NEG-02 | 다른 Project Cache 재사용 금지                                   | `frontend-project-cache.test.ts`, `frontend-query-keys.test.ts`, browser `frontend-knowledge-api.spec.ts` | `NEW_CROSS_PHASE_DELTA` — journey Project switch isolates reads across phases |
| CP-NEG-03 | 민감 Resource 존재 노출 금지                                     | review/knowledge/activity/history non-disclosure suites                                         | `NEW_CROSS_PHASE_DELTA` — journey cross-project read non-disclosing |
| CP-NEG-04 | Candidate 자동 Canonical 반영 금지                               | `canonical-knowledge.contract.test.ts`, `review-ui.test.ts`, browser `frontend-review.spec.ts`   | `NEW_CROSS_PHASE_DELTA` — journey: unapproved draft absent from Canonical after commit of another change |
| CP-NEG-05 | Approval 우회 금지                                               | `frontend-external-action-domain.test.ts`, `action-execution-api.test.ts`                        | `NEW_CROSS_PHASE_DELTA` — journey: Execute requires ACTIVE approval bound to the same manifest |
| CP-NEG-06 | Approval과 Commit·Execute 혼합 금지                              | `frontend-review-negative.test.ts`, browser `frontend-external-action-lifecycle.spec.ts`          | `NEW_CROSS_PHASE_DELTA` — journey: Approval ≠ Commit ≠ Execute (separate, distinct resources) |
| CP-NEG-07 | Outcome Unknown 자동 재제출 금지                                 | `frontend-external-action-lifecycle.spec.ts`, connector reliability suites                         | `REUSE_ONLY` — journey adds no new risk |
| CP-NEG-08 | Cancel을 Rollback으로 표시하지 않음                              | `frontend-external-action-domain.test.ts`, browser lifecycle spec                                  | `REUSE_ONLY` — journey adds no new risk |
| CP-NEG-09 | 삭제 Project Audit 범위 확대 금지                                | `frontend-history-deleted-project-audit.test.ts`, `project-tombstone.test.ts`                      | `REUSE_ONLY` — journey adds no new risk |
| CP-NEG-10 | Retention Purge로 Event Identity 삭제 금지                       | `frontend-history-payload-state*.test.ts`, `frontend-history-persistence.test.ts`                  | `REUSE_ONLY` — journey adds no new risk |

## 5. Work package plan

- **WP-XP1 — Fixture backend composition with production parity**: extend
  `frontend-test-backend.ts` so a single application instance serves all Phase
  product APIs with **production-composition-equivalent adapters**:
  - PostgreSQL adapters for every Domain whose authority is PostgreSQL-backed
    in `main.ts` (Ask write/execution, Knowledge Draft persistence, Review /
    Approval persistence, Canonical repository, External Action store,
    Activity read model, History read model / payload state / tombstone,
    Project/Auth authority).
  - The SAME InMemory implementations `main.ts` itself uses for read
    projections.
  - Deterministic fake/stub ONLY at external side-effect boundaries
    (`AIProviderPort`, `ActionConnectorPort`).
  - Record a **production-vs-test adapter parity table** in the IR evidence
    (single occurrence). No production code change; no test-specific
    authority composition.
- **WP-XP2 — Cross-phase journey E2E + lineage invariants**: new
  `tests/browser/frontend-cross-phase-journey.spec.ts` driving the 12-flow
  journey through real product APIs (project create → source → ask → draft →
  review → approve → canonical commit → external action → activity → history
  → reversal AND compensation), asserting XP-I01~XP-I07 lineage invariants.
  External side effects are the only stubbed part (deterministic fakes via
  the E2E bridge).
- **WP-XP3 — Negative deltas + evidence closure**: only the
  `NEW_CROSS_PHASE_DELTA` negatives (CP-NEG-01~06) get new journey-level
  tests; `REUSE_ONLY` negatives (CP-NEG-07~10) are closed by citation. Plus
  the cross-phase evidence document
  (`docs/engineering/frontend-cross-phase-product-verification-evidence-260809001.md`)
  recording CP-AC/CP-NEG closure, XP-I invariants and the adapter parity
  table, reusing existing per-Section evidence.

## 6. Test policy

- Reuse already-PASS per-Section evidence; do not re-run full suites.
- Only the delta needed for the journey (fixture extension + new specs) is
  executed; normal-push automatic CI is the authoritative CI evidence.
- Do not duplicate per-Section tests inside the journey spec.
- **CI metadata chase prevention (FROZEN rules):**
  - no re-run of the same exact-head that already PASSed;
  - no manual duplicate CI;
  - no empty/docs-only commit whose only purpose is to record a CI number
    (metadata chase);
  - the Product verification head's automatic CI is recorded as the evidence
    subject;
  - no commit is made to re-record a CI number produced by a recording commit.
- OSS review: verification stage — no new OSS candidates; existing verified
  adapters are reused. `NO_RELEVANT_OSS` for new verification tooling beyond
  the existing Playwright/Vitest stack.

## 7. Completion criteria / gates

1. WP-XP1 fixture parity passes (single exact-head CI PASS; adapter parity
   table recorded).
2. WP-XP2 cross-phase journey spec passes (12 flows + XP-I01~XP-I07 through
   real APIs).
3. WP-XP3 CP-NEG closure: NEW_CROSS_PHASE_DELTA (01~06) tests pass;
   REUSE_ONLY (07~10) closed by citation.
4. Cross-phase evidence document updated (evidence head + automatic CI as
   evidence subject; no metadata-chase commits).
5. GPT review gate ACCEPTED; then USER Cross-Phase Verification Completion
   approval for Ready/Merge/closure.

## 8. Next gate

```text
IR r0: CANDIDATE (this document)
→ GPT IR REVIEW ACCEPTED (2026-08-09, r0 rev2)
→ USER explicit approval  ← CURRENT GATE
→ IR r1 FROZEN / EXECUTION_AUTHORIZED
→ WP-XP1 (parity, GPT review ACCEPTED)
→ WP-XP2 (journey + invariants, GPT review ACCEPTED)
→ WP-XP3 (negative deltas + evidence, GPT final review)
→ GPT ACCEPTED → 사용자 Cross-Phase Verification Completion 승인
→ Ready/Merge → Governance Closure
Deployment / Production Verification: NOT_AUTHORIZED
Local Launch / Backup / Final Local Acceptance: separate later stages
```

## 9. GPT Review Record

- 2026-08-09 — IR r0 rev1 review: **CHANGES_REQUIRED** (A~G).
  - A. Candidate self-authorization 제거; B. `FE-P5-XP` synthetic Work Item
    제거 → `verification_gate`; C. production composition parity; D.
    XP-I01~07 lineage invariants; E. CP-AC-12 Reversal+Compensation 양분기;
    F. CP-NEG REUSE_ONLY / NEW_CROSS_PHASE_DELTA 분류; G. CI metadata chase
    금지 규칙.
- 2026-08-09 — IR r0 rev2 review: **ACCEPTED** (`GPT_IR_REVIEW_ACCEPTED`).
  - A~G 전 항목 PASS; Work Package 구조(WP-XP1→XP2→XP3) 승인.
  - Execution: PENDING USER EXPLICIT APPROVAL. IR r1 FROZEN: NOT_YET.
    WP-XP1: NOT_YET_AUTHORIZED.
- 2026-08-09 — **USER explicit approval** ("승인한다").
  - IR r1 FROZEN / EXECUTION_AUTHORIZED (approved_by: USER, 2026-08-09).
  - WP-XP1 AUTHORIZED. WP-XP2/WP-XP3 proceed one at a time under GPT review
    gates as defined in §5/§8.
- 2026-08-09 — **WP-XP1 findings + GPT adjudication.**
  - WP-XP1 production-parity fixture implemented (head afaa67f0):
    `tests/browser/fixtures/frontend-cross-phase-backend.ts` (port 3002, all
    modules health OK); global setup unchanged (journey starts its own
    backend/Vite); full browser suite 70 passed (2 known performance flakes).
  - Discovery 1 (Draft→Review production wiring): fixed, PENDING RATIFICATION.
  - Discovery 2 (Approval→Canonical Commit consumer): **PRODUCT_GAP_CONFIRMED**
    (GPT verdict), CP-AC-08 BLOCKED, journey scope reduction REJECTED,
    direction = BOUNDED PRODUCT CORRECTION. WP-XP2: PAUSE.
  - **Blocking Product Correction Amendment**:
    `docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md`
    (Correction A IMPLEMENTED/PENDING RATIFICATION; Correction B CONFIRMED
    GAP/PENDING CONTRACT + USER APPROVAL). Current gate: USER amendment
    approval.
- 2026-08-09 — **USER approval of the GPT-confirmed Contract Delta.**
  - Amendment §3.2 frozen contract (migration 034 + `FrontendCanonicalCommitWrite`
    + `consumeApproval(canonicalCommitId)`) explicitly approved by USER ("승인").
  - Correction B implementation AUTHORIZED: migration 034 + `commitFrontendDraft`
    (in-memory/Postgres) + `POST /product-api/frontend/knowledge/drafts/commit`
    + consume + focused tests. WP-XP2 remains PAUSED until Correction B COMPLETE.
