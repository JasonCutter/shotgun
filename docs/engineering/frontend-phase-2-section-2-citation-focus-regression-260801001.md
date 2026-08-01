# Frontend Phase 2 Section 2 Citation Focus Regression and Reopening

## Purpose

This record reopens the Section 2 completion claim after a reproducible citation
focus regression was found at the governance-only completion head. It preserves
the prior I03 Verification Record and records only the affected
`finalSectionVerification` criterion.

## Discovery evidence

- Discovery head: `919eb96962606f1cc577f3aee1cc45e2182d4703`
- Pull request: [#51](https://github.com/JasonCutter/shotgun/pull/51), open/Draft/not merged
- Exact-head CI run #367: `30701758565`
  - Quality: PASS
  - Frontend: FAIL
  - Required Gates: FAIL
  - The remote retry reproduced the same Frontend focus failure.
- Original local reproduction: the citation focus test failed 4 of 5 repetitions.
- RouteFocus remediation reproduction: the exact Evidence target test passed 16
  of 20 repetitions and failed 4 repetitions.

The failed assertion remained the required exact target contract:

```text
#evidence-ask-evidence-project-b-1 must be focused
```

The Evidence list item was visible and mounted in the failure artifacts, but it
was not the active element. No assertion removal, locator broadening, retry
increase, timeout increase, skip, or `continue-on-error` was used.

## Cause and decision

The first failure exposed a focus ownership race between the common `RouteFocus`
heading fallback and the citation-specific Evidence target. The approved
fallback ownership fix was applied, but local repetition exposed a second
element-availability path: the Evidence query can resolve while
`SourceDetailWorkspace` still returns `LoadingState` for the pending detail
query. The previous document lookup then ran before the Evidence `<li>` existed
and did not retry when the detail content mounted.

The remediation therefore uses a stable callback ref on the exact citation
Evidence `<li>`. The ref focuses and scrolls the target at the moment it is
mounted, independent of whether the detail or Evidence query resolves first.
The E2E assertion remains an exact Evidence identity and `toBeFocused()` check.

The existing I03 Verification Record is retained. The Section completion claim
is reopened only for the final section verification criterion until the
callback-ref remediation passes the required repeated and full Frontend gates.

## Follow-up review and approved scope

The follow-up review classified the remaining full-suite failures as two
separate remediation concerns:

- The Section 1 `Submission SUCCEEDED` failure was an E2E fixture isolation
  defect. Repeated runs reused the same Direct Text content hash, so the
  product correctly returned its duplicate decision instead of a new success.
  Only the browser test input is made unique per execution with a `randomUUID`
  token. Sources product duplicate handling and product code are unchanged.
- The Section 3 Search query focus failure was a product-level focus arbitration
  defect. `RouteFocus` now preserves focus owned by an active modal/dialog
  (`role="dialog"[aria-modal="true"]` or an open native `dialog`) while keeping
  the existing main-content route-specific focus and heading fallback rules.

The approved callback-ref citation remediation, exact Evidence identity
assertion, browser-fixture-only deterministic Evidence ID, and the reopening
governance state remain in force. No focus assertion was weakened, and no
retry, timeout, skip, or product duplicate-contract bypass was added.

## Local remediation validation

- Frontend unit tests: 38/38 PASS.
- Frontend typecheck: PASS.
- Frontend production build: PASS.
- Sources repeated test: 10/10 PASS with unique per-run input.
- Search focus repeated test: 30/30 PASS.
- Citation focus repeated test: 30/30 PASS.
- Full Frontend E2E repeated three times with retries disabled: 63/63 PASS
  per repetition, 189/189 total.

These are local validation results. Exact-head CI Quality, Frontend, and
Required Gates remain the publication gate for this remediation.

## Evidence registry taxonomy history

The Evidence Registry class for this record was normalized from
`REGRESSION_REPORT` to `AUDIT_REPORT` to match the existing class vocabulary.
The regression/reopening meaning of this document and its
`SECTION_REOPENING_EVIDENCE` authority are unchanged.

## Reopened status

- `answerExecution`: PASS remains unchanged.
- `failureAndRetry`: PASS remains unchanged.
- `finalSectionVerification`: FAIL pending callback-ref remediation verification.
- Remaining scope: citation focus arbitration, modal focus ownership, and
  repeat-safe Frontend E2E fixture remediation.
- No data, API, AnswerRun, PostgreSQL, or canonical-write rollback is required.
- `FE-P2`, `FE-P2-S2`, and `FE-P2-S2-I03` are reopened as `IN_PROGRESS`.
- Prior completion approvals and the prior Verification Record are historical
  evidence and are not deleted or silently rewritten.

## Next verification gate

The remediation head must pass the following before completion is reconsidered:

1. RouteFocus unit regression tests.
2. SourceDetailWorkspace Evidence-first and detail-first asynchronous ordering
   tests.
3. Exact citation E2E repeated 30 times with retries disabled.
4. Frontend unit tests, typecheck, build, and full E2E suite repeated 3 times
   with retries disabled.
5. Exact-head CI Quality, Frontend, and Required Gates.

Until those gates pass, PR #51 remains Draft/open and Ready/Merge remain
blocked.
