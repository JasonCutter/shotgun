# AKP-8 WP2 Cross-Section Causal Acceptance Evidence

Status: `CANDIDATE / IN_PROGRESS` — pending Draft PR review and automatic CI.

Repository: `JasonCutter/shotgun`
Canonical baseline: `ba6f8e9e1fd5e2d0335bb054bde1a3d9a2d2fa01`
Working branch: `codex/akp-8-wp2-cross-section-causal-acceptance-20260901`

## Scope

This package adds acceptance evidence for the five WP2 cross-section scenarios
authorized by the AKP-8 directive:

- `E2E-A`: Canonical relation change → projection readiness → incremental
  Discovery → derived relation finding → re-entry → Review → Draft → approved
  Canonical relation → projection refresh and later reconciliation.
- `E2E-B`: enabled schedule → deterministic due tick → durable `FULL_SCAN` Job,
  Run, Attempt, and seven successful stages → next occurrence advancement.
- `E2E-C`: Product-owned `SNOOZE` and `SUPPRESS_SIMILAR` feedback through the
  command ledger, with history/truth preserved and later Product evaluation
  hiding the finding.
- `E2E-M`: ADR-151 typed proposition conflict authority → conflict hypothesis →
  derived validation/re-entry → comparison/review, while materially new
  conflicts remain visible after ordinary suppression feedback.
- `E2E-P`: projection-unavailable wait → bounded typed deadline disposition → a
  later Canonical event creates a new queued trigger.

Existing accepted scenarios `D/F/G/I/L` were reused and not duplicated. WP3
scenarios `E/H/J/K/N/O` remain out of scope.

No product capability, migration, runtime dependency, or external service was
added. The changes are acceptance contracts, a PostgreSQL composition test, and
this evidence record.

## Production authorities exercised

The PostgreSQL acceptance test composes the existing production boundaries for
Canonical snapshot/outbox, trigger coordination, semantic projection readiness
and generation activation, durable Discovery runtime and finding lifecycle,
re-entry, Review, Draft, command ledger, and ADR-152 Canonical commit. It also
uses the production Product read/feedback coordinators for `E2E-C` and the real
schedule repository/scheduler for `E2E-B`.

`E2E-M` uses the production ADR-151 typed proposition conflict rule service,
knowledge-model repositories, and `DiscoveryCompetingResourcePortV1` composition
in the contract test; the existing PostgreSQL typed-conflict authority test
remains the database evidence for persistence. `E2E-P` is a deterministic
coordinator contract slice. The later `E2E-A` PostgreSQL reconciliation proves
the real lifecycle transition after a subsequent Canonical commit; the P slice
does not claim to replace a full end-to-end deadline/recovery database run.

The initial PostgreSQL fixture seeds an approved baseline Canonical state and
its projection so the production flow has an authoritative starting point. No
post-start production handoff is created by inserting Review, Approval, Draft,
Finding lifecycle, or Canonical rows directly; those transitions use their
normal services and repositories.

## OSS integration decision

The acceptance package introduces no new OSS runtime or dependency. The required
reference review remains recorded in the repository OSS registry and role matrix:

| Candidate     | Official repository                      | Fixed review pin                           | License          | Decision for this package                                                 |
| ------------- | ---------------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------- |
| gbrain        | https://github.com/garrytan/gbrain       | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT              | `REFERENCE_ONLY`                                                          |
| llmwiki       | https://github.com/lucasastorian/llmwiki | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0       | `EXTRACT` in audited conversion/evidence boundary; no new extraction here |
| llm-wiki      | https://github.com/ddsyasas/llm-wiki     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT              | `REFERENCE_ONLY`                                                          |
| OpenKnowledge | https://github.com/inkeep/open-knowledge | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | `REFERENCE_ONLY`                                                          |

These candidates do not own Shotgun Canonical, Evidence, Approval, Action,
Finding lifecycle, or Contract semantics. Therefore no candidate is adopted for
the acceptance fixtures; `NO_RELEVANT_OSS` applies to the new test-only
cross-section composition itself. There is no lockfile or dependency change.

## Verification

Local results on the candidate branch:

- Cross-section contract: `3 passed` (`E2E-A`, `E2E-M`, `E2E-P`).
- Focused regression: `5 files / 24 tests passed`, including scheduler,
  feedback Product API, typed conflict, and relation reconciliation contracts.
- TypeScript typecheck: passed.
- PostgreSQL cross-section acceptance: `1 skipped` because this workspace has no
  `TEST_DATABASE_URL`; the test is explicitly gated by the repository database
  guard and is required in CI.
- Automatic main CI for the WP2A baseline was already verified before this work:
  run `33496775546` / workflow run `#1221`, exact merge SHA
  `ba6f8e9e1fd5e2d0335bb054bde1a3d9a2d2fa01`, with Quality/DB, Frontend/E2E,
  and Required Gates successful. This is baseline evidence, not the candidate
  branch result.
- No manual rerun was performed; no no-op rerun was performed.

The candidate must remain a Draft PR until GPT review. Automatic PR CI and its
database, frontend/E2E, and required-gate results are the authoritative final
gate for this package.

## Change, migration, and rollback

Changed files:

- `tests/contract/akp-8-wp2-cross-section-causal-acceptance.contract.test.ts`
- `tests/database/akp-8-wp2-cross-section-causal-acceptance.database.test.ts`
- `docs/implementation/akp-8-wp2-cross-section-causal-acceptance.md`

There is no schema migration and no production dependency change. Rollback is a
normal branch/PR revert or deletion of the two test files and this evidence
record; no persisted application data is changed by the candidate package.

## Acceptance matrix and remaining work

| Scenario    | WP2 candidate evidence                                                             | Current disposition                                             |
| ----------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| A           | contract + real PostgreSQL production journey and later reconciliation             | pending PR/CI review                                            |
| B           | real PostgreSQL schedule repository, durable runtime, worker, and stage assertions | pending CI database run                                         |
| C           | real Product read, feedback coordinator, command ledger, history/truth assertions  | pending CI database run                                         |
| D/F/G/I/L   | existing accepted evidence reused                                                  | no duplicate work                                               |
| M           | production conflict authority contract + existing PostgreSQL authority evidence    | pending PR/CI review                                            |
| P           | deterministic bounded wait/deadline/new-event coordinator slice                    | pending PR/CI review; full DB deadline run remains a limitation |
| E/H/J/K/N/O | not part of WP2                                                                    | WP3 scope                                                       |

This document does not close the AKP-8 A–P or PAC/AC matrix and does not declare
the Stage complete. Critical/High closure, exact PR CI evidence, and GPT review
remain required before any Ready transition or merge. After WP2 is explicitly
accepted, WP3 may begin with only `E/H/J/K/N/O`; accepted WP2 scenarios must not
be retested as duplicate scope.
