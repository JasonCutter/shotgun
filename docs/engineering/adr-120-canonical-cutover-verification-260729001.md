# ADR-120 Canonical Cutover Verification

## Record

- Record ID: `adr-120-canonical-cutover-verification-260729001`
- Date: 2026-07-29
- Repository: `JasonCutter/shotgun`
- Base: `e673ed6ccb22424f9ce63cdba2a723138e50e720`
- Working branch: `agent/adr-120-canonical-cutover`
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

| Requirement | Result | Evidence |
| --- | --- | --- |
| Explicit user direction to resolve `pending` | `PASS` | User instruction dated 2026-07-29 |
| GitHub `main` defined as sole Canonical authority | `PASS` | ADR-120 and `docs/CANONICAL.md` |
| Cutover Commit identified before merge | `PASS` | `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7` |
| Activation requires Cutover Commit reachability from `main` | `PASS` | ADR-120 activation condition |
| Remaining legacy work is not reported complete | `PASS` | Manifest inventory remains `in_progress_non_blocking` |
| Unmigrated external governing material is non-Canonical | `PASS` | Detailed Map classified `REFERENCE_PENDING_MIGRATION` |
| Prior sequencing change recorded without silent overwrite | `PASS` | ADR-120 `Supersedes` and ADR-117 amendment |
| Reports and verification results remain Git-backed | `PASS` | ADR-117 and `docs/CANONICAL.md` |
| Product/runtime change | `N/A` | Documentation governance only |

## Validation state before remote CI

| Check | Result | Notes |
| --- | --- | --- |
| Changed-file content review | `PASS` | Authority, cutover record, migration backlog, and supersession language reviewed for consistency |
| Cutover SHA consistency | `PASS` | ADR-117, ADR-120, CANONICAL, manifest, and plan use the same Cutover Commit |
| Legacy backlog visibility | `PASS` | Manifest retains all previously listed unresolved items and adds Detailed Map migration explicitly |
| `npm run docs:validate` | `NOT_IMPLEMENTED` | No matching package script exists at base |
| `npm run docs:links` | `NOT_IMPLEMENTED` | No matching package script exists at base |
| `npm run docs:adr-index` | `NOT_IMPLEMENTED` | No matching package script exists at base |
| `npm run docs:canonical` | `NOT_IMPLEMENTED` | No matching package script exists at base |
| `npm run docs:drift` | `NOT_IMPLEMENTED` | No matching package script exists at base |
| Local repository commands | `NOT_RUN` | Change was performed through the GitHub connector without a synchronized local checkout |
| GitHub Actions | `PENDING` | To be recorded after the pull-request head is tested |
| Merge | `PENDING` | Cutover is not active until the recorded commit reaches `main` |

## Evidence-state separation

| Evidence class | State |
| --- | --- |
| User approval of authority activation | `PASS` |
| Git branch publication | `PASS` |
| Pull request | `PENDING` |
| Remote CI | `PENDING` |
| Merge | `PENDING` |
| Canonical authority activation | `PENDING` |
| Legacy migration completion | `IN_PROGRESS_NON_BLOCKING` |
| Deployment/production | `N/A` |

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
