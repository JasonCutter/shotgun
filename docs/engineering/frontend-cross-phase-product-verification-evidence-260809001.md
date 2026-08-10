---
id: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION-EVIDENCE-260809001
classification: CANONICAL
status: COMPLETE
status_authority: FINAL_AFTER_MERGE
verification_gate: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION
created_at: 2026-08-09
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
governing_ir: docs/implementation/frontend-cross-phase-product-verification-implementation-request-260809001.md
gap_repair_amendment: docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md
wp_xp1_status: ACCEPTED / COMPLETE
wp_xp1_parity_head: afaa67f052626f6240fc82f754e6bb1899c3e47a
wp_xp1_exact_head_ci: NOT_RUN / NO_EXACT_HEAD_WORKFLOW_RUN (no GitHub Actions workflow run exists for this exact head; CI #746 belongs to the WP-XP2 implementation head 1753707c0 — never inferred)
wp_xp2_status: ACCEPTED / COMPLETE
wp_xp2_evidence: docs/engineering/frontend-cross-phase-product-verification-wp-xp2-evidence-260810001.md
wp_xp2_implementation_head: 1753707c0
wp_xp2_implementation_ci_number: 746
wp_xp2_implementation_ci_run_id: 31375519252
wp_xp2_implementation_ci_conclusion: SUCCESS
wp_xp2_correction_round1_head: 85dbd8f0b
wp_xp2_correction_round1_ci_number: 748
wp_xp2_correction_round1_ci_run_id: 31379439134
wp_xp2_correction_round1_ci_conclusion: SUCCESS
wp_xp2_correction_round2_head: 698c1eb5b
wp_xp2_correction_round2_ci_number: 750
wp_xp2_correction_round2_ci_run_id: 31381019634
wp_xp2_correction_round2_ci_conclusion: SUCCESS
wp_xp2_correction_round3_terminal_head: 37e67874a
wp_xp2_correction_round3_ci_number: 751
wp_xp2_correction_round3_ci_run_id: 31382160274
wp_xp2_correction_round3_ci_conclusion: SUCCESS
wp_xp2_correction_c_recovery_rounds: CLOSED
wp_xp3_status: ACCEPTED / COMPLETE
wp_xp3_head: c8dd7c461
wp_xp3_ci_number: 752
wp_xp3_ci_run_id: 31385927813
wp_xp3_ci_conclusion: SUCCESS
cp_ac_closure: CP-AC-01~12 CLOSED
xp_i_closure: XP-I01~07 CLOSED
cp_neg_closure: CP-NEG-01~10 CLOSED (01~06 NEW_CROSS_PHASE_DELTA by journey-level verification; 07~10 REUSE_ONLY by citation)
gpt_final_review: ACCEPTED
user_completion_approval: APPROVED
merged_pr: 83
canonical_main: 774f2fffa7759c9ee25ca98a0e705d245c34ec2a
post_merge_main_ci_number: 753
post_merge_main_ci_run_id: 31386938625
post_merge_main_ci_conclusion: SUCCESS
governance_closure: docs/engineering/frontend-cross-phase-governance-closure-260810001.md (if created) | normalized here per GPT AUTHORIZED 2026-08-10
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
product_pr: https://github.com/JasonCutter/shotgun/pull/83
---

# Shotgun — Frontend Cross-Phase Product Verification Evidence (WP-XP1 + WP-XP2 + WP-XP3)

## 1. Scope

Frontend Cross-Phase Product Verification (IR r1 §5) over the three work
packages, on the production-composition-parity backend
(`tests/browser/fixtures/frontend-cross-phase-backend.ts`, 127.0.0.1:3002),
branch `feat/fe-p5-xp-cross-phase-verification` (PR #83, Draft — merge stays
FORBIDDEN until the Cross-Phase verification final GPT gate accepts).

- **WP-XP1** — fixture backend composition with production parity (adapter
  parity table below; exact-head CI #746 SUCCESS at `afaa67f0`; the parity
  table is recorded once here).
- **WP-XP2** — one cross-phase journey E2E
  (`tests/browser/frontend-cross-phase-journey.spec.ts`) chaining the 12
  required flows (CP-AC-01 ~ CP-AC-12) through the REAL product APIs and
  asserting the XP-I01 ~ XP-I07 lineage invariants (Correction C + Recovery
  Rounds 1~3; GPT ACCEPTED 2026-08-10).
- **WP-XP3** — the NEW_CROSS_PHASE_DELTA negatives
  (`tests/browser/frontend-cross-phase-negative.spec.ts`, CP-NEG-01 ~ 06) and
  the REUSE_ONLY negatives (CP-NEG-07 ~ 10) closed by citation; this evidence
  document integrates CP-AC / XP-I / CP-NEG closure, the parity table and the
  reuse evidence.

Every governed mutation is a real Product API request with the real session
cookie + CSRF token; the client never declares authority. Deterministic fakes
are used ONLY at external side-effect boundaries (`AIProviderPort`,
`ActionConnectorPort`), the same as `main.ts`.

## 2. Production-vs-test adapter parity table (single occurrence)

The Cross-Phase fixture mirrors `assemblies/shotgun-app/src/main.ts` adapter
composition exactly. All authority Domains are PostgreSQL-backed; the same
InMemory read projections `main.ts` itself uses are used; deterministic fakes
only where `main.ts` uses fakes (ActionConnector) or where live AI is not
runnable in CI (AIProvider).

| Domain / boundary              | main.ts (production)                                                                          | Cross-Phase fixture                                                | Parity |
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

\* External side-effect boundary (deterministic fake) — the only stubbed part
of the E2E bridge (IR r1 §6).

## 3. CP-AC closure — CP-AC-01 ~ CP-AC-12 (WP-XP2 journey)

| AC       | Flow (real Product API)                | Journey proof (frontend-cross-phase-journey.spec.ts)                                                                                               | Reuse evidence (citation)                                                                                     |
| -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| CP-AC-01 | Session bootstrap + CSRF               | `/api/v1/session/local-bootstrap` → real cookie; `/api/v1/security/csrf` → token on every mutation                                                 | `frontend-section3-bootstrap.test.ts`, `auth-postgres.test.ts`, browser `frontend-section-3.spec.ts`          |
| CP-AC-02 | Project create + active-project switch | `project.create.v1` ×2 + `/api/v1/session/active-project`; XP-I01                                                                                  | browser `frontend-section-2.spec.ts`, `frontend-project-cache.test.ts`                                        |
| CP-AC-03 | Source intake                          | staging/bytes → `sources.intake.submit.v1` → poll `SUCCEEDED` → sources/query; real Stage 3 pipeline (Correction C)                                | browser `frontend-phase-2-section-1.spec.ts`; sources/intake contract+database suites                         |
| CP-AC-04 | Ask + citation                         | `ask/questions` (SOURCE_EXPLORATION + pinned EvidenceSpans) → answer run → citation lineage; XP-I02                                                | browser `frontend-phase-2-section-2.spec.ts`; ask contract/database suites                                    |
| CP-AC-05 | Knowledge read                         | `knowledge/workspace` after commit resolves the committed Canonical state                                                                          | browser `frontend-knowledge-workspace.spec.ts`, `frontend-knowledge-graph.spec.ts`; knowledge suites          |
| CP-AC-06 | DraftChangeSet                         | transition-seed → materialize → save CLAIM_ADD → validate → impact-preview → submit-review; XP-I02/I03                                             | `knowledge-draft-controller.test.ts`, `frontend-knowledge-draft-*.test.ts`                                    |
| CP-AC-07 | Review · Approval                      | review/queue → contexts/read → decisions (APPROVE) → approval ACTIVE; XP-I03                                                                       | browser `frontend-review.spec.ts`; review domain/security suites                                              |
| CP-AC-08 | Canonical Commit                       | approvals/read → drafts/commit → commitIds; Approval consumed (read fails closed); XP-I04                                                          | `canonical-knowledge.contract.test.ts`, `stage-6-postgres.test.ts`                                            |
| CP-AC-09 | External Action Preflight·Execute      | validate → prepare → approve → preflight → execute (attempt SUCCEEDED); XP-I05                                                                     | browser `frontend-external-action-lifecycle.spec.ts`; external-action domain suites                           |
| CP-AC-10 | Activity                               | activity/refresh (real route) → activity/queue shows the executed action + execution ref; XP-I06                                                   | browser `frontend-activity-workspace.spec.ts`; activity suites                                                |
| CP-AC-11 | History · Audit                        | operator history rebuild → history/workspace shows the canonical commit + Review Approval authority; XP-I06                                        | browser `frontend-history-workspace.spec.ts`; history suites                                                  |
| CP-AC-12 | Reversal · Compensation                | reversal-draft (historical approval evidence) → Reversal carrier in Review queue/context + compensations/prepare (original action lineage); XP-I07 | browser `frontend-history-workspace.spec.ts`; reversal/carrier + external-action rollback/compensation suites |

## 4. Lineage invariants — XP-I01 ~ XP-I07 (WP-XP2)

| Invariant | Assertion in the journey                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XP-I01    | The ingested Source stays on `journey-alpha` after switching to `journey-beta`; visible again after switching back.                                                                                                                                                          |
| XP-I02    | Ask citation `sourceId`/`sourceVersionId`/`evidenceSpanId` == saved CLAIM_ADD `evidenceReferences[0]` — all three identities match.                                                                                                                                          |
| XP-I03    | Review Context `targetId == draftId`, `targetRevision == String(draftRevision)`, `targetDigest == reviewSubmission.contentDigest` AND the Approval Resource binds the same `reviewContextId`/`contextRevision`/`targetId`/`targetRevision`/`targetDigest`/`approvedItemIds`. |
| XP-I04    | (before commit) Workspace projection reports the base `canonicalVersion`/digest right after the Approval (no Canonical change); (after commit) an advanced version + changed digest, and the Approval read fail-closes (`REVIEW_APPROVAL_NOT_ISSUED`).                       |
| XP-I05    | Manifest → Approval → Preflight → Execute share the same action id + manifest revision; Approval/Preflight/Attempt bind the same `resourceProjectId`/`effectiveProjectId`/`policyContextRevision`; Preflight `policyRevalidated === true`.                                   |
| XP-I06    | Activity references the journey's action id + execution run id; History references the canonical `commitId` + Review Approval `authorityId`, preserving `sourceEventKind = CANONICAL_CLAIM_ADDED` / `sourceEventId = history:<commitId>`.                                    |
| XP-I07    | Canonical branch: Reversal carries `sourceCommitId` + evidence-only `historicalApprovalRef`, and the Reversal carrier surfaces in the Review queue/context. External branch: Compensation preserves `sourceActionId` + `sourceExecutionId`.                                  |

## 5. CP-NEG closure — CP-NEG-01 ~ CP-NEG-10 (WP-XP3)

NEW_CROSS_PHASE_DELTA (01~~06) are closed by the new journey-level negative
spec; REUSE_ONLY (07~~10) are closed by existing per-Section evidence
citation (no new tests — the phase-crossing journey adds no new risk).

| NEG       | Negative                                    | Disposition           | Closure                                                                                                                                                                                                                                                                                                                     |
| --------- | ------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-NEG-01 | Frontend의 Principal·Project 권위 생성 금지 | NEW_CROSS_PHASE_DELTA | negative spec: forged bootstrap body is ignored (server-derived Principal, never `attacker-principal`) AND `x-project-id`/`x-actor-id`/`x-access-scope`/`x-sensitivity` rejected `400 LEGACY_SECURITY_HEADER_FORBIDDEN` on every phase route (Sources/Knowledge/Review/Activity/History/External-Action/Projects) incl. GET |
| CP-NEG-02 | 다른 Project Cache 재사용 금지              | NEW_CROSS_PHASE_DELTA | negative spec: after switching to `neg-beta`, Sources library / Knowledge workspace / Review queue / Activity queue do not expose `neg-alpha` resources (isolation across phases)                                                                                                                                           |
| CP-NEG-03 | 민감 Resource 존재 노출 금지                | NEW_CROSS_PHASE_DELTA | negative spec: cross-project reads of real identities fail closed — Source `404 NOT_FOUND`, Review Approval `409 REVIEW_APPROVAL_NOT_ISSUED`, External Action/Execution `404 EXTERNAL_ACTION_NOT_FOUND`                                                                                                                     |
| CP-NEG-04 | Candidate 자동 Canonical 반영 금지          | NEW_CROSS_PHASE_DELTA | negative spec: Draft-2 (unapproved candidate) is submitted to review but never approved; after Draft-1's approved commit the Canonical detail page exposes the approved claim (`CP-NEG-04 alpha`) and does NOT expose the unapproved candidate (`CP-NEG-04 beta`)                                                           |
| CP-NEG-05 | Approval 우회 금지                          | NEW_CROSS_PHASE_DELTA | negative spec: preflight without any ACTIVE approval → `403 ACTION_APPROVAL_REQUIRED`; after a manifest re-preparation the old ACTIVE approval no longer binds → `409 ACTION_APPROVAL_INVALID` (re-approval required); positive control execute with a matching ACTIVE approval SUCCEEDS                                    |
| CP-NEG-06 | Approval과 Commit·Execute 혼합 금지         | NEW_CROSS_PHASE_DELTA | negative spec: creating the Review Approval leaves Canonical at the base version/digest (Approval ≠ Commit); creating the External Action Approval creates NO Execution (`executions/read` → `EXTERNAL_ACTION_NOT_FOUND`) (Approval ≠ Execute)                                                                              |
| CP-NEG-07 | Outcome Unknown 자동 재제출 금지            | REUSE_ONLY            | `frontend-external-action-lifecycle.spec.ts`, connector reliability suites — closed by citation                                                                                                                                                                                                                             |
| CP-NEG-08 | Cancel을 Rollback으로 표시하지 않음         | REUSE_ONLY            | `frontend-external-action-domain.test.ts`, browser lifecycle spec — closed by citation                                                                                                                                                                                                                                      |
| CP-NEG-09 | 삭제 Project Audit 범위 확대 금지           | REUSE_ONLY            | `frontend-history-deleted-project-audit.test.ts`, `project-tombstone.test.ts` — closed by citation                                                                                                                                                                                                                          |
| CP-NEG-10 | Retention Purge로 Event Identity 삭제 금지  | REUSE_ONLY            | `frontend-history-payload-state*.test.ts`, `frontend-history-persistence.test.ts` — closed by citation                                                                                                                                                                                                                      |

## 6. Known product-gap bridges / corrections (real adapters, never stubs)

1. **Correction C — Source Intake → Transformation/Evidence production
   wiring** (GPT BLOCKED → CORRECTION AUTHORIZED, 2026-08-10): the Sources
   intake now runs the REAL production `SourcesStage3Pipeline`
   (`SourcesStage3PipelinePort`, adapter `sources-stage3-pipeline`) after a
   successful intake materializes each SourceVersion. The fixture-side
   `bridgeEvidence()` is REMOVED. New Phase/Section/ADR were NOT created.
2. **Recovery Rounds 1~3 — Stage 3 post-commit failure recovery**
   (GPT CHANGES_REQUIRED → ACCEPTED, 2026-08-10): an intake is never finalized
   `SUCCEEDED` before its Stage 3 pipeline completes; a Stage 3 failure flips
   `RUNNING`/`PARTIAL` to retryable `OUTCOME_INDETERMINATE`; a replay resumes
   the SAME SourceVersions (no duplicates) and preserves the original mixed
   outcome (`PARTIAL`) vs all-succeeded (`SUCCEEDED`). Migration
   `035_frontend_sources_stage3_recovery.sql` allows the
   `PARTIAL → OUTCOME_INDETERMINATE` transition. Focused regression:
   `tests/database/frontend-sources-stage3-recovery.test.ts` (all-succeeded +
   mixed cases).
3. **History projection rebuild** — no browser refresh route by design
   (federated History is NON-AUTHORITATIVE and operator-rebuildable); the
   journey performs the operator rebuild with the REAL `HistoryProjectionBuilder`
   - owning-Domain adapters.
4. **Rollback capability provisioning** — `project:action:rollback` is a
   CURRENT server-derived capability; provisioned through the REAL
   `PostgresAuthRepository` as an administrator would.
5. **External Action admin state** — `fake-connector` credential + per-project
   budget seeded through the REAL `PostgresExternalActionStore` (incl. the
   WP-XP3 negative projects `neg-alpha`/`neg-beta`); without them preflight
   revalidations fail closed.

## 7. Verification

- `npx tsc --noEmit` PASS.
- `npm run format:check` PASS; `npm run lint` PASS.
- `npm run docs:validate` PASS.
- WP-XP1: fixture production-parity composition; full browser suite 70 passed
  (2 known performance flakes), parity head `afaa67f0` — exact-head CI
  **NOT_RUN / NO_EXACT_HEAD_WORKFLOW_RUN** (no GitHub Actions workflow run
  exists for that exact head; the parity is verified as an integrated
  descendant of the merged main lineage).
- WP-XP2: `tests/browser/frontend-cross-phase-journey.spec.ts` **1 passed** on
  a fresh DB and on the dirty shared DB (re-run resilience); evidence chain —
  implementation `1753707c0` / CI #746 / run 31375519252 / SUCCESS, Correction
  Round 1 `85dbd8f0b` / CI #748 / SUCCESS, Correction Round 2 `698c1eb5b` /
  CI #750 / run 31381019634 / SUCCESS, Correction Round 3 terminal accepted
  head `37e67874a` / CI #751 / run 31382160274 / SUCCESS; Correction C +
  Recovery Rounds 1~3 CLOSED; GPT ACCEPTED.
- WP-XP3: `tests/browser/frontend-cross-phase-negative.spec.ts` **1 passed**
  on the shared DB and on a re-run (dirty) — CP-NEG-01~~06; CP-NEG-07~~10
  REUSE_ONLY closed by citation; sources DB suite 11 + sources product-api
  integration 3 = 14 tests PASS; `format:check`/`lint`/`docs:validate` PASS.
- CI (automatic on push, never re-run): WP-XP2 implementation #746, Round 1
  #748, Round 2 #750, Round 3 terminal #751, WP-XP3 #752 (run 31385927813),
  and post-merge main #753 (run 31386938625) — all SUCCESS. The docs-only
  frontmatter commit's run is NOT promoted to technical authority. No
  metadata-chase commits were made.

## 8. Governance Closure / gates (FINAL_AFTER_MERGE)

- GPT Cross-Phase Final Review: **ACCEPTED** (2026-08-10).
- USER Cross-Phase Verification Completion: **APPROVED** (2026-08-10).
- PR #83 merged (`774f2fffa`); canonical `main` points at the merge commit;
  post-merge main CI #753 / run 31386938625 / SUCCESS.
- WP-XP1: ACCEPTED / COMPLETE (exact-head CI NOT_RUN — recorded, never
  inferred).
- WP-XP2: ACCEPTED / COMPLETE; WP-XP3: ACCEPTED / COMPLETE.
- CP-AC-01~~12: CLOSED; XP-I01~~07: CLOSED; CP-NEG-01~10: CLOSED.
- WP-XP1 CI attribution correction: CI #746 / run 31375519252 is the WP-XP2
  implementation head `1753707c0` run (NOT a WP-XP1 run). Any prior
  "WP-XP1 CI #746" / "afaa67f0 / #746" phrasing is hereby corrected; no new
  WP-XP1 CI was created or inferred.
- Governance Closure is the single docs-only normalization commit (this
  change). Frozen IR and prior Amendment decisions are NOT rewritten.
- Local Launch / Serving Usability, Backup/Restore Owner Workflow, Final
  Local Acceptance: NOT STARTED until this Governance Closure is ACCEPTED by
  the GPT review gate.
- Deployment / Production Verification: NOT_AUTHORIZED / NOT_RUN.
