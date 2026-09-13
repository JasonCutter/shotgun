# Home Attention / Activity Deep-Link Consistency Integration Decision

- Date: 2026-09-13
- Canonical base: `acb438da1ce9e0b80b00bc6d996304afc1ae45fb`
- Contract amendment proposal:
  [FE-P5-S1 Activity Presentation Amendment](../architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-amendment-260913001.md)
- Target: Home `ActionCenterAttentionProjectionPort`, Activity Product API and
  Sources owner-workspace navigation

## Decision

This repair reuses the accepted Shotgun ports and adapters. No new runtime,
database, router, cache, or UI dependency is introduced.

| Candidate                      | Pin reviewed                                                                                    | License          | Decision          | Boundary                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| React Router                   | `react-router@8.3.0`                                                                            | MIT              | `ADOPT` (retain)  | Durable Activity and Sources URL identity only; no authority in the URL                      |
| TanStack Query                 | `@tanstack/react-query@5.101.4`                                                                 | MIT              | `ADOPT` (retain)  | Scope- and resource-bound server cache keys                                                  |
| PostgreSQL                     | `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | PostgreSQL       | `ADOPT` (retain)  | Authoritative Sources state and replaceable Activity projection behind existing ports        |
| Fastify                        | lockfile-resolved `5.12.1`                                                                      | MIT              | `ADOPT` (retain)  | Existing Product API transport only                                                          |
| ddsyasas/llm-wiki              | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`                                                      | MIT              | `REFERENCE_ONLY`  | Existing Home/Action UX reference; no backend or SQLite reuse                                |
| Inkeep OpenKnowledge           | `f2834c237639e2cff603817ed88182b33f83cf91`                                                      | GPL-3.0-or-later | `REFERENCE_ONLY`  | Existing Activity UX reference; no GPL code or runtime reuse                                 |
| gbrain / lucasastorian/llmwiki | existing registry pins                                                                          | MIT / Apache-2.0 | `NO_RELEVANT_OSS` | Their Job/transform components do not solve a route-identity and presentation-adapter defect |

## Included and excluded scope

Included:

- serialize the already accepted Activity identity into Home Attention links;
- preserve the Sources attention reason through the Activity contract and
  projection snapshot;
- preserve the Sources attempt completion timestamp at the presentation adapter
  when a later row update follows terminal completion;
- deep-link from Activity to the exact owning `IntakeSubmission` and load it
  through a typed, project-scoped query key.

Excluded:

- Canonical or owner-data mutation;
- new identity models, SourceVersion collapsing, automatic duplicate decisions,
  retry, approval, or action execution;
- database schema or data migration.

## Verification, replacement, migration, rollback

Contract, adapter, Home projection, route-selection, Sources owner-action, identity
isolation, and projection-refresh regression tests are required. The existing
React Router, Query, Activity coordinator, and Sources Product ports remain the
replacement boundaries. Migration is `NONE`; rollback is a code revert with no
owner-data operation. The open-source role matrix is unchanged because every
decision retains an already accepted role and pin.
