# Project Shotgun Documentation SSoT Cutover and Legacy Migration Plan

- Plan ID: `documentation-sot-cutover-plan-260728001`
- Created: 2026-07-28
- Amended: 2026-07-29
- Authority cutover status: active
- Governance implementation status: complete
- Final cross-store inventory status: pending, non-blocking
- Governing ADRs:
  - [ADR-117](../architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md)
  - [ADR-120](../architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md)
  - [ADR-121](../architecture/adr/ADR-121-identifier-stability-registry-and-duplicate-resolution-boundary.md)
- Canonical repository: `JasonCutter/shotgun`
- Canonical branch: `main`
- Canonical Cutover Commit: `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7`

## Current operating state

GitHub `main` is the sole Canonical authority. Notion is Candidate workspace, mirror, navigation hub, Legacy Reference and historical archive. Google Drive and other external stores are Reference or Archive locations.

The governance backlog requested on 2026-07-29 has been implemented:

- Phase 1–6 ADD hierarchy migration;
- Project-wide ADR identifier and duplicate-owner governance;
- Stage 12.1 record classification;
- Engineering Evidence classification;
- Generated Artifact Ownership;
- automated documentation validation commands and CI Gate.

The final Notion, Google Drive and Git inventory remains visible and non-blocking. It does not create a second authority.

## Completed migration increments

### Knowledge Flow Detailed Map

```text
Source: Google Docs document 1HazG-oAeJ8Sgg_mPmBiWpQqeCeeAoDUuWgqVNJR1DCg
Revision: 9
Version: v0.3
Target: docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md
Verification: docs/engineering/knowledge-flow-detailed-map-migration-verification-260729001.md
```

The Google Drive source remains a Legacy Reference. New Drive-only edits are Candidate.

### Frontend and Human Interaction Architecture

```text
Source root: Notion page 3a15181d-71ad-81e4-bfa4-ee2578e692a0
Target root: docs/architecture/frontend/README.md
Implementation plan: docs/implementation/frontend-phase-1-5-plan-v1.0.md
Verification: docs/engineering/frontend-architecture-migration-verification-260729001.md
```

The consolidated Git hierarchy preserves five Phases, twelve Sections, Cross-Phase contracts, the Frontend ADR index, status reconciliation and implementation boundaries.

### Phase 1–6 ADD hierarchy

```text
Source root: Notion page 39f5181d-71ad-81a6-a51f-f7f2a3a88ee6
Original export commit: f0d7f7a65a11f28dc9e3bc3a6e47a084b46541eb
Target root: docs/architecture/add/README.md
Documents: 63 Markdown source documents plus migration verification
Coverage: Phase 1–6, Step 1–22, approved Section records, ADR-018–075
Verification: docs/engineering/phase-1-6-add-migration-verification-260729001.md
```

Historical Notion authority wording is retained as dated provenance. Git `main` is the current authority.

## Completed governance increments

### ADR identifier and duplicate governance

- Governing decision: ADR-121
- Registry: `docs/architecture/adr/adr-registry.json`
- Accepted identifiers are immutable.
- Each identifier has one authoritative owner.
- ADR-018–075 remain owned by consolidated Phase records.
- Other authoritative occurrences use individual ADR files.
- Duplicates are classified, not silently deleted.

### Stage 12.1 classification

- Classification: `docs/architecture/stage-12-1/README.md`
- Final current status authority: `docs/engineering/stage-12-1-completion-record.md`
- Architecture, Gate evidence, final completion, deferred work and historical statuses are separated.

### Engineering Evidence classification

- Policy: `docs/engineering/README.md`
- Registry: `docs/engineering/evidence-registry.json`
- Local, CI, review, approval, merge, release, deployment and production verification remain distinct.

### Generated Artifact Ownership

- Policy: `docs/governance/generated-artifact-ownership.md`
- Registry: `docs/generated-artifacts.json`
- Compiled Truth remains a derived runtime projection.
- approved snapshots are retained approval artifacts;
- transient CI output is supporting evidence only;
- lockfiles and migrated outputs have explicit ownership.

### Documentation validation tooling

Commands:

```text
npm run docs:validate
npm run docs:links
npm run docs:adr-index
npm run docs:canonical
npm run docs:drift
```

The Quality CI job runs `npm run docs:validate` before formatting, lint and tests.

Checks include:

- repository-relative links;
- ADR identifier ownership, completeness and duplicate owners;
- Canonical governance paths;
- Evidence Registry paths;
- Generated Artifact ownership metadata and versioned targets;
- Manifest target existence;
- completed migration items remaining incorrectly unresolved.

## Preferred Canonical structure

```text
docs/
├─ CANONICAL.md
├─ canonical-manifest.yaml
├─ generated-artifacts.json
├─ architecture/
│  ├─ add/
│  ├─ adr/
│  ├─ contracts/
│  ├─ frontend/
│  ├─ knowledge-flow/
│  └─ stage-12-1/
├─ engineering/
├─ implementation/
├─ governance/
├─ operations/
├─ references/
└─ archive/
```

Avoid path-only rewrites that break stable history without a governance benefit.

## Migration and evidence rules

Each material migration or governance PR must show:

- inventory items included;
- classification and approval state;
- source provenance;
- unresolved drift and conflicts;
- exact subject commit;
- local and remote results without converting `NOT_RUN` into `PASS`;
- known limits;
- final merge and publication state.

No unresolved Canonical conflict may be hidden. A semantic conflict requires explicit user review.

## Publication and mirror update

- Git `main` remains authoritative even when a mirror is stale.
- Git-to-Notion publication may be automated one-way.
- Bidirectional automatic synchronization is prohibited.
- High-value mirrors should show Canonical path, revision, status and synchronization date.
- Legacy external sources are retained until inventory and archival verification complete.

## Rollback boundary

Do not silently restore Notion or another store as Canonical. Reversal requires a new ADR, explicit user approval and a recorded cutover boundary.

## Remaining inventory backlog

- complete the final Notion, Google Drive and Git inventory;
- review non-ADR duplicate and superseded contract snapshots;
- normalize the HTML Knowledge Flow baseline to a structured source format;
- add commit metadata to high-value mirrors and archive legacy sources safely.

These items have no authority effect and must not be reported as complete before verification.

## Decision history

- 2026-07-28: ADR-117 defined Git `main` as the target authority and a pre-cutover migration sequence.
- 2026-07-29: ADR-120 activated Git authority while preserving a visible post-cutover migration backlog.
- 2026-07-29: Knowledge Flow Detailed Map migrated with source provenance.
- 2026-07-29: Frontend Architecture migrated and status-reconciled.
- 2026-07-29: Phase 1–6 ADD hierarchy migrated from the verified historical export.
- 2026-07-29: ADR-121, Stage 12.1 and Evidence classifications, Generated Artifact Ownership and documentation validation tooling completed the authorized governance work.
