# HFM-S7-C8 Final Owner Acceptance and S7 Closure Record — 260818001

- **Record:** HFM-S7-C8
- **Status:** TARGETED_RUNTIME_ACCEPTANCE_PASS / READY_FOR_GPT_FINAL_C8_CLOSURE_REVIEW
- **Audit Date:** 2026-08-18
- **Subject Exact HEAD:** `b17050146ee08beb166dc4653f75f52cc58a00ef`
- **Draft PR:** #118 (`OPEN / DRAFT / NOT MERGED`)
- **Governing Architecture:** [ADR-146 — PC Global Conversation Shell and GUI/Slash Dual-Control](../architecture/adr/ADR-146-pc-global-conversation-shell-and-gui-slash-dual-control.md)
- **CI Validation:** CI #1002 (Run ID: `32088697291` / Attempt #2: `SUCCESS`)

---

## 1. Executive Summary

This document records the complete evidence reconciliation and owner-acceptance closure audit for **HFM-S7 (PC Global Conversation Shell and GUI/Slash Dual-Control)** and its final stage **HFM-S7-C8 (Targeted Runtime Owner Acceptance / S7 Closure)**.

Every required item across the HFM-S7 PC Owner UI surface—including the global shell, navigation tree, instrument panel, source detail evidence, Ask workspace & landing, global composer typography, provider eligibility localization, and focused privacy command surface—has been implemented, verified, corrected where requested, and backed by passing automated CI on the final exact HEAD (`b17050146ee08beb166dc4653f75f52cc58a00ef`).

There are **zero remaining REQUIRED blockers**.

---

## 2. A. Final Accepted Decisions

| Area                       | Authoritative Accepted Decision                                                                                                                                                                                                                                                                                              |
| :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product Scope**          | **PC-Only Desktop Web Layout**. Mobile, tablet, touch-first responsive variants are excluded per ADR-146.                                                                                                                                                                                                                    |
| **Shell Geometry**         | Top Instrument Panel (64px), Left Tree Navigation (240px), Right Conversation Pane (420px), Bottom Global Composer (persistent natural language entry), Center Interaction Workspace (fluid remaining width).                                                                                                                |
| **Interaction Model**      | **GUI + Slash Dual-Control**. GUI menus and slash (`/` / `Ctrl+K`) palette provide dual discovery over identical underlying domain actions and authorities.                                                                                                                                                                  |
| **Authority Boundaries**   | Question-mode authority (`VERIFIED_KNOWLEDGE_ONLY`, `ALL_FACTS_CLAIM_SUPPORTED`, `SOURCE_EXPLORATION`) preserved in Global Composer mode selector. Provider privacy vs Project privacy authority separation strictly preserved. Read-only `privacy.open` vs mutating `privacy.review` modal distinction strictly maintained. |
| **Retention Presentation** | Contract `PrivacyRetentionView` preserved unchanged. Free-text server-authored `retentionSummary` prose excluded from focused Privacy command surface presentation to ensure clean localized presentation without contract drift.                                                                                            |

---

## 3. B. Reconstructed C8 Acceptance Ledger & Runtime Evidence

| Acceptance Area                                  | Original Observed State / Issue                                                     | Correction Slice & Commit                    | Exact Verification Evidence                                                                              | Owner Visible Result                                                                | Final Disposition |
| :----------------------------------------------- | :---------------------------------------------------------------------------------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- | :---------------- |
| **C8-A: Runtime Readiness**                      | Initial runtime readiness verification                                              | None (Base verification)                     | `HFM-S7-C8-A-readiness-report.md`, runtime launch & auth bridge verification                             | Clean local dev/test runtime operational                                            | **PASS**          |
| **C8-B: Left Tree / Settings IA**                | Duplicate preferences/settings nodes in Left Navigation Tree violating ADR-146      | `HFM-S7-C8-B`<br>`f21e38dfa`                 | `left-tree-navigation.test.tsx`, CI #996 SUCCESS (`32035848529`)                                         | Simplified canonical tree taxonomy for Settings                                     | **PASS**          |
| **C8-C: Project / Top Instrument Panel**         | Project switcher, active project display, command entry, system status              | None (Verified compliant)                    | C7 visual normalization suite (`6d935c535`), CI #995 SUCCESS                                             | Top instrument panel renders project status & command shortcuts                     | **PASS**          |
| **C8-D3: Source Detail Evidence Presentation**   | Evidence list showed duplicate chunks due to multi-source-version span overlap      | `HFM-S7-C8-D3`<br>`a1a140496`<br>`87ad7e3c2` | `source-detail-pane.test.tsx`, `frontend-auth-session-recovery.spec.ts`, CI #998 SUCCESS (`32036141097`) | Deduplicated evidence presentation with clean source spans                          | **PASS**          |
| **C8-E1: Ask Empty Landing**                     | Ambiguous empty `/ask` landing copy lacking clear conversation entry guidance       | `HFM-S7-C8-E1`<br>`2d51a1d5e`                | `ask-workspace.test.tsx`, CI #999 SUCCESS (`32036574921`)                                                | Localized empty state copy guiding question input via Global Composer               | **PASS**          |
| **C8-E3: Global Composer Typography**            | Textarea font size too large relative to selector; typed text vertically misaligned | `HFM-S7-C8-E3`<br>`e5806493c`                | `application.css` inspection, visual screenshot confirmation, CI #1000 SUCCESS (`32036735502`)           | Textarea font size exactly 1pt smaller (0.875rem / 14px) and vertically centered    | **PASS**          |
| **C8-E4-C: Provider Eligibility Localization**   | Server-authored English message rendered on ko-KR UI when private context blocked   | `HFM-S7-C8-E4-C`<br>`096d48384`              | `ask-workspace.test.tsx` (ELIGIBLE, BLOCKED, NO_PROVIDER), CI #1001 SUCCESS (`32040310946`)              | Localized Korean eligibility warnings and status copy                               | **PASS**          |
| **C8-F-D: Privacy Focused Surface Localization** | Raw English retention text, unlocalized AI Provider labels and action buttons       | `HFM-S7-C8-F-D`<br>`b17050146`               | `privacy-command-surface.test.tsx` (13/13 PASS), CI #1002 Attempt #2 SUCCESS (`32088697291`)             | Localized Privacy command surface; raw retention prose removed; read-only preserved | **PASS**          |

---

## 4. C. Corrections Completed During C8

1. **HFM-S7-C8-B** (`f21e38dfa`): `fix(frontend): simplify Settings preferences tree`
   - Removed redundant Settings child items from the navigation tree.
2. **HFM-S7-C8-D3** (`a1a140496` & `87ad7e3c2`): `fix(frontend): deduplicate Source evidence presentation` & `test(frontend): isolate missing-session Knowledge API check`
   - Deduplicated evidence presentation across source versions and stabilized test session isolation.
3. **HFM-S7-C8-E1** (`2d51a1d5e`): `fix(frontend): clarify Ask conversations landing`
   - Clarified empty Ask conversation landing copy in English and Korean.
4. **HFM-S7-C8-E3** (`e5806493c`): `fix(frontend): refine Global Composer input typography`
   - Tuned composer textarea font size (0.875rem) and vertical alignment.
5. **HFM-S7-C8-E4-C** (`096d48384`): `fix(frontend): localize Ask provider eligibility messages`
   - Added Korean localization mappings for AI provider eligibility states.
6. **HFM-S7-C8-F-D** (`b17050146`): `feat(web): localize focused privacy command surface and remove raw retention prose`
   - Localized Privacy command surface, actions, notes, and removed raw `retentionSummary` prose.

---

## 5. D. NOT_APPLICABLE Items

- **Mobile / Responsive Touch Breakpoints**: Excluded by design under PC-Only Desktop scope (ADR-146).
- **Native OS Window Frame Controls**: Excluded (Pure browser web application).
- **Backend / Database Schema Changes**: NOT_REQUIRED for the accepted HFM-S7-C8 correction scope; no backend or database schema change was needed to close the observed owner-facing runtime defects.

---

## 6. E. DEFERRED / OUT_OF_SCOPE Items

- **Yjs Collaborative Realtime Markdown Editor**: Explicitly `DEFER` per Shotgun Agent Rules.
- **Contract Schema Expansion for Retention Policy Classes**: Deferred to future contract cycles; presentation layer omits arbitrary prose without changing backend schemas.
- **HFM-S8 (Governance, Merge, and Final Closure)**: NOT_STARTED during C8. HFM-S8 begins after formal HFM-S7 owner-acceptance closure and owns final governance reconciliation, Ready-for-Review authorization, PR merge, canonical-main verification, post-merge CI verification, and FINAL_AFTER_MERGE closure.

---

## 7. F. Remaining REQUIRED Blockers

- **ZERO (0)** remaining REQUIRED blockers.

---

## 8. Final Exact HEAD and CI Evidence Summary

- **Subject Exact HEAD:** `b17050146ee08beb166dc4653f75f52cc58a00ef`
- **Draft PR:** #118 (`OPEN / DRAFT / NOT MERGED`)
- **Automatic Exact-Head CI:** Run `32088697291` / Attempt #2
  - `Quality`: **SUCCESS** (4m 15s)
  - `Frontend`: **SUCCESS** (6m 20s, 81/81 Playwright tests passed, 289 unit tests passed, typecheck passed, build passed)
  - `Required Gates`: **SUCCESS** (2s)

---

## 9. Final Governance State

```text
HFM-S7-C8:

OWNER_ACCEPTANCE_COMPLETE /
TARGETED_RUNTIME_ACCEPTANCE_PASS /
CORRECTION_CHAIN_COMPLETE /
ZERO_REQUIRED_BLOCKERS /
SUBJECT_PRODUCT_EXACT_HEAD_b17050146ee08beb166dc4653f75f52cc58a00ef /
EXACT_HEAD_CI_PASS /
FINAL_C8_CLOSURE_ACCEPTED /
HFM-S7_OWNER_ACCEPTANCE_COMPLETE /
READY_FOR_HFM-S8 /
PR_118_OPEN_DRAFT /
NO_READY /
NO_MERGE /
FINAL_AFTER_MERGE_NOT_DECLARED
```

HFM-S8 remains NOT_STARTED at the time of this record.

This record closes HFM-S7 targeted runtime owner acceptance. It does not authorize Ready for Review, merge PR #118, or declare FINAL_AFTER_MERGE. Those actions belong to HFM-S8 Governance, Merge, and Final Closure.
