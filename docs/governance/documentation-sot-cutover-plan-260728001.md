# Project Shotgun Documentation SSoT Cutover Plan

- Plan ID: `documentation-sot-cutover-plan-260728001`
- Date: 2026-07-28
- Status: in progress
- Governing ADR: [ADR-117](../architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md)
- Target repository: `JasonCutter/shotgun`
- Target branch: `main`
- Current transition authority: Notion
- Target Canonical authority: Git `main`

## Objective

Move Project Shotgun's authoritative text documents into Git without losing approval history, superseded decisions, open issues, or source provenance.

The cutover must avoid both failure modes:

- no Canonical authority during migration,
- two active Canonical authorities after migration.

## Phase 0 — Foundation

Deliver in the initial draft PR:

- ADR-116
- ADR-117
- Section 3 persistence contract revision
- `docs/CANONICAL.md`
- `docs/canonical-manifest.yaml`
- this cutover plan
- README transition notice

Exit criteria:

- documents are readable through repository-relative links,
- every newly added accepted document has approval metadata,
- the manifest clearly says cutover is pending,
- no document claims Git is already Canonical.

## Phase 1 — Inventory

Inventory all relevant Notion, Google Drive, and Git documents.

For each item record:

```text
id
title
source
source identifier or URL
current path if in Git
classification
approval state
approval date
supersedes / superseded-by
content owner
migration target
migration status
```

Classifications:

```text
CANONICAL
CANDIDATE
REFERENCE
GENERATED
ARCHIVED
SUPERSEDED
DUPLICATE
```

Rules:

- Do not infer authority from the latest modified timestamp.
- Do not delete duplicates during inventory.
- Preserve exact approval and completion claims.
- Separate design completion from implementation, verification, merge, and release completion.

## Phase 2 — Export and normalize

### Notion

Export:

- ADD hub and Phase 1–6 ADDs
- Phase ADR indexes and ADR pages
- Frontend Architecture hierarchy
- Stage 12.1 Architecture records
- user decision records
- change history and unresolved-item pages

Normalization rules:

- retain stable document IDs,
- convert internal Notion links to repository-relative links when both targets are migrated,
- keep legacy Notion URLs in provenance metadata,
- retain `Superseded` text and rationale,
- do not promote Candidate text during export.

### Google Drive

Move Shotgun-authored governing text to Git.

Initial known item:

```text
Shotgun Knowledge Flow Detailed Map
Google Drive ID: 1HazG-oAeJ8Sgg_mPmBiWpQqeCeeAoDUuWgqVNJR1DCg
Target: docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md
```

External or binary materials stay outside Git and receive reference-manifest entries.

### Existing Git documents

Classify and reconcile:

- existing ADRs,
- contract snapshots,
- canonical-normalization records,
- implementation plans,
- engineering audits and completion records,
- HTML baselines and generated outputs.

## Phase 3 — Canonical structure

Preferred structure, adjusted only when an existing stable path should be preserved:

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

Avoid a large path-only rewrite when existing relative links and history can be retained safely.

## Phase 4 — Validation tooling

Add scripts equivalent to:

```text
npm run docs:validate
npm run docs:links
npm run docs:adr-index
npm run docs:canonical
npm run docs:drift
```

Minimum checks:

### `docs:validate`

- valid front matter or manifest entry,
- required approval metadata for accepted documents,
- known classification,
- no duplicate document ID.

### `docs:links`

- repository-relative links resolve,
- referenced ADRs and contract snapshots exist,
- no broken generated-artifact source link.

### `docs:adr-index`

- ADR number is unique,
- status in the index matches the ADR,
- supersession references resolve.

### `docs:canonical`

- no Candidate is marked Canonical,
- no approved document is omitted from the manifest,
- cutover state is internally consistent,
- Notion-only Canonical claims are rejected after cutover.

### `docs:drift`

Before cutover:

- compare exported Notion sources and Git normalized documents,
- report semantic or structural differences for manual review.

After cutover:

- verify Notion mirror metadata points to an existing Git path and commit,
- never use Notion content as an automatic overwrite source.

## Phase 5 — Transition PR review

The final transition PR must show:

- inventory summary,
- migrated document count by classification,
- unresolved drift list,
- generated/reference exclusions,
- validation results,
- proposed Cutover Commit,
- explicit statement that code implementation remains separately authorized.

No unresolved Canonical-vs-Canonical conflict may be hidden in the PR.

## Phase 6 — Cutover approval

Cutover requires explicit user approval after validation.

On approval:

1. merge the transition PR,
2. record the merge SHA as `Canonical Cutover Commit`,
3. update `docs/CANONICAL.md`,
4. update `docs/canonical-manifest.yaml`,
5. update the Notion ADD hub from `Canonical: Notion` to `Mirror/Working Space`,
6. add Canonical path and commit metadata to high-value Notion mirrors,
7. mark migrated Google Drive documents as legacy/archive without deleting them.

## Phase 7 — Post-cutover enforcement

- Architecture and Contract changes use Git PRs.
- User-approved content awaiting merge is `PENDING_CANONICALIZATION`.
- CI blocks invalid Canonical metadata and broken references.
- Notion-to-Git automatic overwrite is prohibited.
- Git-to-Notion publication may be automated as a one-way mirror.

## Rollback boundary

### Before cutover

The draft PR may be closed and Notion remains Canonical. No authority rollback is needed.

### After cutover

Do not silently restore Notion as Canonical. A reversal requires a new ADR that records the reason, data-loss risk, conflict policy, and new cutover boundary.

## Completion criteria

This plan is complete only when:

- the final inventory is committed,
- required documents are migrated,
- all documentation gates pass,
- the user approves the cutover,
- the merge SHA is recorded,
- Notion and Google Drive roles are updated,
- Codex and contributors can identify the Canonical document from Git alone.
