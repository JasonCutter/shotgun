# Project Shotgun Documentation SSoT Cutover and Legacy Migration Plan

- Plan ID: `documentation-sot-cutover-plan-260728001`
- Created: 2026-07-28
- Completed: 2026-07-29
- Authority Cutover status: active
- Governance implementation status: complete
- Legacy migration status: complete
- Final cross-store inventory status: complete
- Governing ADRs:
  - [ADR-117](../architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md)
  - [ADR-120](../architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md)
  - [ADR-121](../architecture/adr/ADR-121-identifier-stability-registry-and-duplicate-resolution-boundary.md)
- Canonical repository: `JasonCutter/shotgun`
- Canonical branch: `main`
- Canonical Cutover Commit: `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7`
- Completion evidence: [`documentation-legacy-migration-completion-260729001.md`](../engineering/documentation-legacy-migration-completion-260729001.md)

## Final operating state

GitHub `main` is the sole Canonical authority. Notion is Candidate workspace, mirror, navigation hub, Legacy Reference and historical archive. Google Drive and other external stores are Reference or Archive locations.

The authorized migration, governance and inventory backlog is complete. Newly discovered or newly created external items enter ongoing inventory maintenance and do not become a second authority.

## Completed migration increments

### Knowledge Flow Detailed Map

```text
Source: Google Docs document 1HazG-oAeJ8Sgg_mPmBiWpQqeCeeAoDUuWgqVNJR1DCg
Source revision at migration: 9
Version: v0.3
Target: docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md
Verification: docs/engineering/knowledge-flow-detailed-map-migration-verification-260729001.md
```

The Google Drive source remains a Legacy Source Reference. It now displays the Git target and Canonical revision. Drive-only edits are Candidate.

### Frontend and Human Interaction Architecture

```text
Source root: Notion page 3a15181d-71ad-81e4-bfa4-ee2578e692a0
Target root: docs/architecture/frontend/README.md
Implementation plan: docs/implementation/frontend-phase-1-5-plan-v1.0.md
Verification: docs/engineering/frontend-architecture-migration-verification-260729001.md
```

The Git hierarchy preserves five Phases, twelve Sections, Cross-Phase contracts, the Frontend ADR index, status reconciliation and implementation boundaries.

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
- Duplicates are classified, not silently deleted.

### Stage 12.1 and Engineering Evidence classification

- Stage classification: `docs/architecture/stage-12-1/README.md`
- Final Stage 12.1 authority: `docs/engineering/stage-12-1-completion-record.md`
- Evidence policy: `docs/engineering/README.md`
- Evidence Registry: `docs/engineering/evidence-registry.json`
- Local, CI, review, approval, merge, release, deployment and Production verification remain distinct.

### Generated Artifact Ownership

- Policy: `docs/governance/generated-artifact-ownership.md`
- Registry: `docs/generated-artifacts.json`
- Compiled Truth remains a derived runtime projection.
- approved snapshots are retained approval artifacts;
- transient CI output is supporting evidence only;
- lockfiles and migrated outputs have explicit ownership.

### Documentation validation tooling

```text
npm run docs:knowledge-flow:check
npm run docs:validate
npm run docs:links
npm run docs:adr-index
npm run docs:canonical
npm run docs:drift
```

The Quality CI job verifies the Knowledge Flow Generated HTML and runs documentation governance before formatting, lint and tests.

## Final inventory sequence

### 1. Cross-store inventory

- Pull request: #37
- Merge Commit: `445c7fce93c9bec8c262da39ea0ea8688eaeca3d`
- Registry: `docs/inventory/cross-store-inventory.json`
- Verification: `docs/engineering/final-cross-store-inventory-verification-260729001.md`
- Result: known Project Shotgun Git, Notion and Google Drive governing roots covered; no external Canonical authority remains.

### 2. Non-ADR Contract Snapshot reconciliation

- Pull request: #38
- Merge Commit: `87946bdbda8d407d7d3b8d1e6a30411d433efdd8`
- Registry: `docs/architecture/contracts/contract-snapshot-registry.json`
- Verification: `docs/engineering/contract-snapshot-reconciliation-verification-260729001.md`
- Result: three records classified; no duplicate owner, no whole-record supersession and no unresolved authority conflict.

### 3. Knowledge Flow baseline structured-source conversion

- Pull request: #39
- Merge Commit: `094eb1f486f808a315c0f4eeaaae01c58c327c61`
- Canonical source: `docs/architecture/knowledge-flow/knowledge-flow-baseline-v1.0.json`
- Generated presentation: `docs/SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html`
- Generator: `scripts/render-knowledge-flow-baseline.mjs`
- Verification: `docs/engineering/knowledge-flow-baseline-structured-source-verification-260729001.md`
- Result: 6 Phases, 22 Steps, principles, loops and safeguards preserved; CI Drift Gate active.

### 4. Mirror and archive normalization

- Pull request: #40
- Merge Commit: `2961ceecaa86addf4046950a7acc09f175091568`
- Registry: `docs/inventory/mirror-archive-registry.json`
- Verification: `docs/engineering/mirror-archive-normalization-verification-260729001.md`
- Result: 10 Notion pages and one Google Doc normalized; one historical preparation hub archived; no source deleted.

## Conflict and ambiguity resolutions

- latest timestamps did not override approved Git authority;
- ambiguous historical material was retained rather than deleted or promoted;
- ADR-117 `pending` wording was preserved as pre-Cutover history with an ADR-120 authority banner;
- Stage 12.1 Notion status was retained as history while Git completion evidence remains authoritative;
- Section 3 Contract Snapshot and Persistence Revision were composed as active base plus additive amendment;
- the Phase 1 preparation hub was archived with its Canonical successor.

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
├─ governance/
├─ implementation/
├─ inventory/
├─ operations/
├─ references/
└─ archive/
```

Avoid path-only rewrites that break stable history without a governance benefit.

## Ongoing maintenance

Completion closes the historical backlog, not future documentation operations. Continue to:

- inventory newly discovered external material;
- update high-value mirrors after material Git changes;
- register Contract Snapshot revisions and supersession explicitly;
- preserve archives and decision history;
- run all documentation Gates on every material change.

## Publication and mirror rule

- Git `main` remains authoritative even when a mirror is stale.
- Git-to-Notion publication may be automated one-way.
- Bidirectional automatic synchronization is prohibited.
- External-only edits remain Candidate.
- No archive or mirror is deleted merely because inventory is complete.

## Rollback boundary

Do not silently restore Notion or another store as Canonical. Reversal requires a new ADR, explicit user approval and a recorded Cutover boundary.

## Decision history

- 2026-07-28: ADR-117 defined Git `main` as the target authority and a pre-Cutover migration sequence.
- 2026-07-29: ADR-120 activated Git authority while preserving a visible post-Cutover migration backlog.
- 2026-07-29: Detailed Map, Frontend Architecture and Phase 1–6 ADD were migrated.
- 2026-07-29: ADR-121, Stage 12.1 and Evidence classification, Generated Artifact Ownership and documentation validation completed Governance implementation.
- 2026-07-29: PR #37 completed the Cross-store Inventory.
- 2026-07-29: PR #38 reconciled Contract Snapshot lineage.
- 2026-07-29: PR #39 converted the Knowledge Flow baseline to a structured Canonical source.
- 2026-07-29: PR #40 normalized high-value Mirrors and Archives.
- 2026-07-29: the final completion PR changed legacy migration and inventory status to `complete` after required CI.
