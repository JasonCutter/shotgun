# Project Shotgun Documentation SSoT Cutover and Legacy Migration Plan

- Plan ID: `documentation-sot-cutover-plan-260728001`
- Created: 2026-07-28
- Amended: 2026-07-29
- Authority cutover status: active
- Legacy migration status: in progress, non-blocking
- Governing ADRs:
  - [ADR-117](../architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md)
  - [ADR-120](../architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md)
- Canonical repository: `JasonCutter/shotgun`
- Canonical branch: `main`
- Canonical Cutover Commit: `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7`

## Current operating state

GitHub `main` is the sole Canonical authority when the recorded Cutover Commit is reachable from `main`.

Notion is Candidate workspace, mirror, navigation hub, and historical archive. Google Drive and other external stores are Reference or Archive locations. Unmigrated legacy items are not a second authority.

The original plan required complete historical inventory, export, validation tooling, and drift resolution before authority cutover. ADR-120 supersedes only that blocking sequence. Remaining migration work continues visibly after cutover and must not be reported as complete until verified.

## Objective

Preserve Project Shotgun's authoritative text, approval history, superseded decisions, open issues, source provenance, reports, inspections, tests, and completion evidence in Git without either:

- retaining two active Canonical authorities, or
- falsely claiming that the legacy migration backlog is complete.

## Completed foundation

The repository contains:

- ADR-116
- ADR-117
- ADR-120
- Section 3 persistence contract revision
- `docs/CANONICAL.md`
- `docs/canonical-manifest.yaml`
- this plan
- README Canonical status
- Git-backed report and verification-record requirements

Authority cutover was explicitly approved by the user on 2026-07-29.

## Completed migration increments

### Google Drive — Knowledge Flow Detailed Map

The following governing document was migrated through the current reviewed Git change:

```text
Title: Shotgun Knowledge Flow Detailed Map
Source provider: Google Drive / Google Docs
Source document ID: 1HazG-oAeJ8Sgg_mPmBiWpQqeCeeAoDUuWgqVNJR1DCg
Source revision: 9
Source version: v0.3
Target: docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md
Target classification after merge: CANONICAL
Legacy source classification after merge: REFERENCE
Verification: docs/engineering/knowledge-flow-detailed-map-migration-verification-260729001.md
```

The Google Drive source is retained and is not deleted. After merge, new edits made only in Google Docs are non-Canonical until represented in a reviewed Git pull request and merged to `main`.

## Post-cutover migration work

### 1. Inventory

Inventory all relevant Notion, Google Drive, and Git documents.

For each item record:

```text
id
title
source
source identifier or URL
current Git path when present
classification
approval state
approval date
supersedes / superseded-by
content owner
migration target
migration status
```

Rules:

- Do not infer authority from the latest modified timestamp.
- Do not delete duplicates during inventory.
- Preserve exact approval and completion claims.
- Separate design, implementation, local verification, remote CI, approval, merge, deployment, and production verification.
- Unmigrated items remain non-Canonical.

### 2. Export and normalize

#### Notion

Migrate through reviewed Git pull requests:

- ADD hub and Phase 1–6 ADDs
- Phase ADR indexes and ADR pages
- Frontend Architecture hierarchy
- Stage 12.1 Architecture records
- user decision records
- change history and unresolved-item pages

Retain stable IDs, legacy URLs, provenance, approval state, supersession rationale, rejected alternatives, and impact. Do not promote Candidate text during export.

#### Google Drive

Move remaining Shotgun-authored governing text to Git through reviewed migration pull requests.

The Knowledge Flow Detailed Map migration is recorded in the completed migration section above. External, large, licensed, sensitive, regulated, or binary materials may remain outside Git with a safe reference-manifest entry.

#### Existing Git documents

Classify and reconcile:

- existing ADRs
- contract snapshots
- canonical-normalization records
- implementation plans
- engineering audits and completion records
- HTML baselines and generated outputs

## Preferred Canonical structure

Preserve stable paths where safe and use this structure for new normalization:

```text
docs/
├─ CANONICAL.md
├─ canonical-manifest.yaml
├─ architecture/
│  ├─ add/
│  ├─ adr/
│  ├─ contracts/
│  │  └─ snapshots/
│  ├─ decisions/
│  ├─ knowledge-flow/
│  └─ canonical-normalization/
├─ implementation/
├─ engineering/
├─ governance/
├─ operations/
├─ references/
└─ archive/
```

Avoid a path-only rewrite when it would break history or repository-relative links without providing a clear governance benefit.

## Validation tooling backlog

Implement scripts equivalent to:

```text
npm run docs:validate
npm run docs:links
npm run docs:adr-index
npm run docs:canonical
npm run docs:drift
```

Minimum checks:

- required metadata and known classifications
- duplicate document and ADR IDs
- repository-relative links and referenced files
- approval and supersession consistency
- Candidate/Canonical conflicts
- generated-artifact source ownership
- external-only Canonical claims
- Notion mirror metadata and Git revision validity

Until a gate is implemented, record it as `NOT_IMPLEMENTED`; never report it as `PASS`.

## Migration pull-request evidence

Each material migration PR must show:

- inventory items included
- migrated document count by classification
- unresolved drift and conflicts
- generated/reference exclusions
- local and remote validation results
- provenance and approval state
- exact Git commit that the evidence supports

No unresolved Canonical conflict may be hidden. A semantic conflict requires explicit user review before the imported text becomes Canonical.

## Publication and mirror update

- Git `main` is authoritative even when a mirror is stale.
- Git-to-Notion publication may be automated as one-way synchronization.
- Bidirectional automatic synchronization is prohibited.
- High-value mirrors should identify Canonical path, commit SHA, status, and synchronization date.
- Legacy Google Drive material may be marked archive only after successful migration verification; do not delete it as part of inventory.

## Rollback boundary

Do not silently restore Notion or another external store as Canonical. A reversal requires a new ADR that records the reason, data-loss risk, conflict policy, and new cutover boundary, plus explicit user approval.

## Completion criteria for legacy migration

Legacy migration is complete only when:

- the final inventory is committed,
- required governing documents are migrated,
- documentation gates are implemented and pass,
- unresolved semantic drift is resolved,
- mirrors and external references have correct status metadata,
- contributors can identify every active Canonical governing document from Git alone.

These criteria govern migration completion, not the already active GitHub authority cutover.

## Decision history

- 2026-07-28: ADR-117 accepted Git `main` as the target authority and defined a pre-cutover migration sequence.
- 2026-07-29: Git-backed durable-report requirements were added.
- 2026-07-29: the user directed that the `pending` state be resolved.
- 2026-07-29: ADR-120 separated immediate authority activation from truthful, continuing legacy migration and superseded the original blocking sequence only.
- 2026-07-29: Knowledge Flow Detailed Map v0.3, Google Docs revision `9`, was migrated to the repository target path with source provenance and verification evidence; the Google Drive source remains a legacy Reference.
