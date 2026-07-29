# ADR-117 — Documentation Source of Truth·Canonicalization·Publication Boundary

## Status

Accepted and active, as amended by [ADR-120](ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md).

- Approval date: 2026-07-28
- Approver: User
- Transition status: cutover active from 2026-07-29
- Canonical Cutover Commit: `08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7`
- Scope: all Project Shotgun documentation
- Clarification approved: 2026-07-29 — all durable reports and inspection results require Git-backed records
- Cutover activation approved: 2026-07-29 — authority activation is separated from the remaining legacy migration backlog under ADR-120

## Context

Project Shotgun documentation was split across Notion, Git, and Google Drive.

Since 2026-07-16, Notion had been the ADD Canonical store. In practice, ADRs, contract snapshots, implementation plans, and engineering verification already changed beside the code in Git pull requests.

This created two effective authorities:

- the latest user-approved decision in Notion,
- the version that Codex and CI could read from Git `main`.

The split caused drift, prevented atomic review of code and architecture, made branch-specific design changes difficult, and relied on manual export.

## Decision

### 1. Git `main` is the single Canonical source

The repository `JasonCutter/shotgun`, default branch `main`, is the only Canonical source for Project Shotgun's authoritative text documents and durable evidence records.

Canonical scope includes:

- Knowledge Flow baseline and Detailed Map
- Phase 1–6 ADDs
- Frontend and Human Interaction Architecture
- ADRs and user-approved decision records
- contract snapshots and schema/migration/rollback contracts
- implementation plans and roadmaps
- engineering verification and completion records
- change history, unresolved issues, rejected alternatives, and impact scope
- operating, security, and quality policies

User approval remains mandatory. Approval alone does not make a revision Canonical: the approved change must be reviewed and merged into Git `main`.

### 2. Cutover is active; legacy migration continues separately

The original transition sequence required all of the following before authority cutover:

1. inventory Notion, Google Drive, and Git documents,
2. export and normalize existing Canonical documents into Git,
3. include ADR-116 and the Section 3 persistence contract revision,
4. add `docs/CANONICAL.md` and `docs/canonical-manifest.yaml`,
5. validate links, ADR numbering, approval metadata, and supersession relations,
6. resolve Notion/Git drift without using timestamps as automatic authority,
7. receive explicit user cutover approval.

ADR-120 supersedes only the requirement that items 1, 2, 5, and 6 must all finish before authority activation. The user explicitly approved resolution of the pending state on 2026-07-29.

Git `main` is now the sole Canonical authority. Remaining inventory, export, normalization, validation-tooling, drift-resolution, mirror, and archive work continues as a Git-tracked post-cutover migration backlog.

This amendment does not claim that unresolved items are complete. Unmigrated Notion or Drive material is `REFERENCE_PENDING_MIGRATION` or another non-Canonical class until imported, reconciled, approved where required, and merged to `main`.

### 3. Notion is working space and published mirror

Notion is retained for:

- architecture meetings and Candidate drafts,
- readable published mirrors,
- navigation hubs,
- historical archive.

A Notion-only edit is a Candidate, not Canonical Knowledge.

The authoritative synchronization direction is:

```text
Git main -> Notion mirror
```

Bidirectional automatic synchronization is prohibited.

Mirror pages should expose, where practical:

- Canonical repository,
- Canonical path,
- Canonical commit SHA,
- last synchronization date,
- Mirror or Candidate status.

### 4. Google Drive is reference and archive storage

Shotgun-authored governing text documents are inventoried and moved into Git through reviewed migration pull requests.

Google Drive or another external store may retain:

- large binaries and scans,
- external vendor material,
- material whose license makes repository redistribution inappropriate,
- sensitive or regulated material,
- temporary exports,
- unmigrated historical sources.

Externally retained material must be represented by a Git reference manifest that records its identity, role, source location, access boundary, integrity data when available, retention status, migration status, and Canonical status.

External or unmigrated material is not a second Canonical authority.

### 5. Canonicalization flow

```text
architecture meeting or change proposal
-> Candidate
-> user approval
-> Git branch documentation change
-> pull request review and CI
-> merge to main
-> Canonical revision
-> optional Notion mirror or other publication
```

AI output is Candidate until user approval. After approval, it remains `PENDING_CANONICALIZATION` until the Git merge completes.

### 6. Document classifications

Every managed document is classified as one of:

```text
CANONICAL
CANDIDATE
REFERENCE
REFERENCE_PENDING_MIGRATION
GENERATED
ARCHIVED
SUPERSEDED
DUPLICATE
```

A legacy source does not retain governing authority merely because it was previously stored in Notion or Drive. Missing historical authority fails closed and must be imported and reconciled before use.

### 7. Git-backed reports and verification records

All durable reports, audits, inspection results, test results, verification records, and completion evidence must be stored as Git-tracked repository documents.

Material evidence records identify the subject commit, execution date, commands or procedures, relevant environment, per-check `PASS`/`FAIL`/`BLOCKED`/`NOT_RUN` status, failures, skips, retries, remote evidence links, externally retained artifact integrity, known limits, and the claim supported.

Local files, terminal output, chat, external-only text, pull request comments, and expiring GitHub Actions logs cannot be the sole durable evidence for a completion or publication claim. The material result must be summarized under `docs/`.

Local verification, remote CI, approval, merge, deployment, and production verification remain separate evidence classes. None may be inferred from another, and a failed or unexecuted check cannot be reported as passed.

Large, sensitive, licensed, or regulated artifacts may remain in an approved external store only when a safe Git reference manifest records identity, location, access boundary, version or integrity information, retention state, and Canonical status.

### 8. Documentation gates

Documentation pull requests should provide these gates:

```text
docs:validate
docs:links
docs:adr-index
docs:canonical
docs:drift
```

They validate at least:

- duplicate ADR identifiers,
- required metadata and approval state,
- relative links and referenced files,
- contract snapshot existence,
- Candidate/Canonical classification conflicts,
- supersession consistency,
- direct edits to generated artifacts,
- Notion-only Canonical references.

If a gate is not yet implemented, its absence must be recorded as `NOT_IMPLEMENTED`; it must not be reported as passed. ADR-120 makes completion of this tooling post-cutover enforcement work rather than a reason to preserve an external Canonical authority.

## Preserved decisions

The transition preserves:

- AI results are Candidate before approval,
- explicit user approval boundaries,
- no automatic Canonical promotion,
- Claim/Fact separation,
- Compiled Truth as a derived projection,
- separate recording of decisions, open issues, rejected alternatives, and impacts,
- decision history and reasons are not silently overwritten.

## Supersedes

The 2026-07-16 decision that Notion is the Project Shotgun ADD Canonical store was superseded when the ADR-120 Cutover Commit became reachable from `main`.

ADR-120 also supersedes the pre-cutover sequencing requirement that complete historical migration and validation tooling must finish before Git authority activation. It does not supersede the obligation to complete and record that backlog.

## Rejected alternatives

### Keep Notion Canonical and Git as a manual snapshot

Rejected because manual synchronization and drift remain structural risks.

### Make Notion and Git co-Canonical

Rejected because conflict resolution would require another authority, so it is not a single source of truth.

### Bidirectional automatic synchronization

Rejected because concurrent edits and block/Markdown conversion loss require a separate conflict-resolution system.

### Put every binary in Git

Rejected because repository growth, security, privacy, and licensing constraints differ from authoritative text-contract needs. Reference manifests or separately approved Git LFS may be used.

### Claim the historical migration is complete to activate Cutover

Rejected because the manifest contains unresolved inventory and migration items. Authority activation and backlog completion are recorded separately.

## Impact

- Notion Canonical-hub policy is retired.
- repository documentation structure and CI become the authority path.
- Codex implementation inputs must resolve to Git `main` or an explicitly identified Candidate branch.
- Google Drive becomes reference and legacy-retention storage.
- architecture and contract changes use Git PR workflow.
- export and mirror automation is one-way from Git.
- unresolved legacy migration remains visible and non-Canonical.

## Excluded

- immediate deletion or archival of all Notion pages,
- claiming every legacy document has already been inventoried or migrated,
- bulk deletion of Google Drive references,
- product-code or Frontend Phase 1 Section 3 implementation authorization.

## Approval boundary

ADR-117 accepted the Git SSoT direction and evidence policy. ADR-120 records the separately approved authority activation and the continuing non-blocking legacy migration boundary. Future reversals or authority changes require a new ADR and explicit user approval.
