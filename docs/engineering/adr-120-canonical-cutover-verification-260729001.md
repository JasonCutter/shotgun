# ADR-120 Canonical Cutover Verification

## Record

- Record ID: `adr-120-canonical-cutover-verification-260729001`
- Date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Base: `e673ed6ccb22424f9ce63cdba2a723138e50e720`
- Working branch: `agent/adr-120-canonical-cutover`
- Pull request: `https://github.com/JasonCutter/shotgun/pull/32`
- Canonical Cutover Commit: `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7`
- User direction: resolve the remaining Canonical Cutover `pending` state
- Activation condition: the Cutover Commit is reachable from `main`
- Product/runtime impact: none

## Scope

This change resolves the authority state without falsely claiming that the historical migration backlog is complete.

Changed governance scope:

- add ADR-120
- activate the Cutover Record in `docs/CANONICAL.md`
- activate the transition state in `docs/canonical-manifest.yaml`
- amend ADR-117 transparently
- convert the pre-cutover plan into a post-cutover migration plan
- publish the active status in README
- preserve unresolved legacy migration items as non-Canonical backlog

No Product code, database schema, runtime dependency, lockfile, deployment, or production state changes.

## Decision verification

| Requirement                                                 | Result | Evidence                                              |
| ----------------------------------------------------------- | ------ | ----------------------------------------------------- |
| Explicit user direction to resolve `pending`                | `PASS` | User instruction dated 2026-07-29                     |
| GitHub `main` defined as sole Canonical authority           | `PASS` | ADR-120 and `docs/CANONICAL.md`                       |
| Cutover Commit identified before merge                      | `PASS` | `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7`            |
| Activation requires Cutover Commit reachability from `main` | `PASS` | ADR-120 activation condition                          |
| Remaining legacy work is not reported complete              | `PASS` | Manifest inventory remains `in_progress_non_blocking` |
| Unmigrated external governing material is non-Canonical     | `PASS` | Detailed Map classified `REFERENCE_PENDING_MIGRATION` |
| Prior sequencing change recorded without silent overwrite   | `PASS` | ADR-120 `Supersedes` and ADR-117 amendment            |
| Reports and verification results remain Git-backed          | `PASS` | ADR-117 and `docs/CANONICAL.md`                       |
| Product/runtime change                                      | `N/A`  | Documentation governance only                         |

## Remote CI result

- Tested subject head: `2680695b2d93edb01b1920f42aa2a9a90a5a77eb`
- Workflow: `CI`
- Run: `https://github.com/JasonCutter/shotgun/actions/runs/30409764222`

| Job              | Result | Evidence                                                                                                                        |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `Quality`        | `PASS` | Job `90443062416`; formatting, lint, typecheck, dependency audit, SBOM, Stage 12 Gate, CI test suite, and database tests passed |
| `Frontend`       | `PASS` | Job `90443062488`; typecheck, tests, build, and Playwright E2E passed                                                           |
| `Required Gates` | `PASS` | Job `90443425043`                                                                                                               |

This record is an evidence-only follow-up to the tested subject head. The commit containing this updated record receives its own separate GitHub Actions run before merge; it does not alter the governing decision or other subject files.

## Validation results

| Check                            | Result            | Notes                                                                                                    |
| -------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Changed-file content review      | `PASS`            | Authority, cutover record, migration backlog, and supersession language reviewed for consistency         |
| Cutover SHA consistency          | `PASS`            | ADR-117, ADR-120, CANONICAL, manifest, and plan use the same Cutover Commit                              |
| Legacy backlog visibility        | `PASS`            | Manifest retains all previously listed unresolved items and adds Detailed Map migration explicitly       |
| GitHub Actions run `30409764222` | `PASS`            | Quality, Frontend, and Required Gates passed for subject head `2680695b2d93edb01b1920f42aa2a9a90a5a77eb` |
| `npm run docs:validate`          | `NOT_IMPLEMENTED` | No matching package script exists at base                                                                |
| `npm run docs:links`             | `NOT_IMPLEMENTED` | No matching package script exists at base                                                                |
| `npm run docs:adr-index`         | `NOT_IMPLEMENTED` | No matching package script exists at base                                                                |
| `npm run docs:canonical`         | `NOT_IMPLEMENTED` | No matching package script exists at base                                                                |
| `npm run docs:drift`             | `NOT_IMPLEMENTED` | No matching package script exists at base                                                                |
| Local repository commands        | `NOT_RUN`         | Change was performed through the GitHub connector without a synchronized local checkout                  |
| Merge                            | `PENDING`         | Cutover is not active until the recorded commit reaches `main`                                           |

## Evidence-state separation

| Evidence class                        | State                      | Notes                                                       |
| ------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| User approval of authority activation | `PASS`                     | User directed that the pending state be resolved            |
| Git branch publication                | `PASS`                     | Branch `agent/adr-120-canonical-cutover`                    |
| Pull request                          | `PASS`                     | PR #32 published and ready for review                       |
| Remote CI for subject head            | `PASS`                     | Run `30409764222`                                           |
| Remote CI for evidence-only head      | `PENDING`                  | Required before merge                                       |
| Merge                                 | `PENDING`                  | Not yet performed by this record                            |
| Canonical authority activation        | `PENDING`                  | Becomes active when Cutover Commit is reachable from `main` |
| Legacy migration completion           | `IN_PROGRESS_NON_BLOCKING` | Not claimed complete                                        |
| Deployment/production                 | `N/A`                      | Documentation governance only                               |

## Known limits

- Complete Notion, Google Drive, and Git inventory is not finished.
- Phase 1–6 ADD and Frontend Architecture migration is not finished.
- The Knowledge Flow Detailed Map remains outside Git and is non-Canonical until migrated through a reviewed PR.
- Documentation-specific validation scripts are not implemented.
- This record does not treat those items as complete; ADR-120 changes their sequencing and authority effect only.

## Canonical documentation impact

```text
Canonical documentation impact: UPDATED
Governing documents:
- docs/CANONICAL.md
- docs/canonical-manifest.yaml
- docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md
- docs/architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md
- docs/governance/documentation-sot-cutover-plan-260728001.md
- README.md

Change type:
- new decision
- authority activation
- partial supersession
- governance record
- verification evidence
```
