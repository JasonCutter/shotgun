# ADR-117 — Documentation Source of Truth·Canonicalization·Publication Boundary

## Status

Accepted.

- Approval date: 2026-07-28
- Approver: User
- Transition status: cutover PR pending
- Scope: all Project Shotgun documentation

## Context

Project Shotgun documentation is split across Notion, Git, and Google Drive.

Since 2026-07-16, Notion has been the ADD Canonical store. In practice, ADRs, contract snapshots, implementation plans, and engineering verification already change beside the code in Git pull requests.

This creates two effective authorities:

- the latest user-approved decision in Notion,
- the version that Codex and CI can read from Git `main`.

The split causes drift, prevents atomic review of code and architecture, makes branch-specific design changes difficult, and relies on manual export.

## Decision

### 1. Git `main` becomes the single Canonical source

The repository `JasonCutter/shotgun`, default branch `main`, will be the only Canonical source for Project Shotgun's authoritative text documents.

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

### 2. Cutover is explicit and forward-only

This ADR does not immediately revoke the current Notion authority.

A transition pull request must satisfy all of the following before a `Canonical Cutover Commit` is declared:

1. inventory Notion, Google Drive, and Git documents,
2. export and normalize existing Canonical documents into Git,
3. include ADR-116 and the Section 3 persistence contract revision,
4. add `docs/CANONICAL.md` and `docs/canonical-manifest.yaml`,
5. validate links, ADR numbering, approval metadata, and supersession relations,
6. resolve Notion/Git drift without using timestamps as automatic authority,
7. receive explicit user cutover approval.

Until the cutover commit is approved and merged, Notion remains the temporary transition authority. After that commit, Git `main` is the sole Canonical source.

### 3. Notion becomes working space and published mirror

After cutover, Notion is retained for:

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

### 4. Google Drive becomes reference and archive storage

Shotgun-authored governing text documents are inventoried and moved into Git.

Google Drive or another external store may retain:

- large binaries and scans,
- external vendor material,
- material whose license makes repository redistribution inappropriate,
- temporary exports.

Externally retained material must be represented by a Git reference manifest that records its identity, role, source location, integrity data when available, and retention status.

### 5. Canonicalization flow

```text
architecture meeting or change proposal
-> Candidate
-> user approval
-> Git branch documentation change
-> pull request review and CI
-> merge to main
-> Canonical revision
-> optional Notion mirror publication
```

AI output is Candidate until user approval. After approval, it remains `PENDING_CANONICALIZATION` until the Git merge completes.

### 6. Document classifications

Every managed document is classified as one of:

```text
CANONICAL
CANDIDATE
REFERENCE
GENERATED
ARCHIVED
SUPERSEDED
DUPLICATE
```

### 7. Documentation gates

The transition and future documentation pull requests should provide these gates:

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

The 2026-07-16 decision that Notion is the Project Shotgun ADD Canonical store is superseded **only after** the Canonical Cutover Commit.

Before cutover it remains the transition authority.

## Rejected alternatives

### Keep Notion Canonical and Git as a manual snapshot

Rejected because manual synchronization and drift remain structural risks.

### Make Notion and Git co-Canonical

Rejected because conflict resolution would require another authority, so it is not a single source of truth.

### Bidirectional automatic synchronization

Rejected because concurrent edits and block/Markdown conversion loss require a separate conflict-resolution system.

### Put every binary in Git

Rejected because repository growth and licensing constraints differ from authoritative text-contract needs. Reference manifests or separately approved Git LFS may be used.

## Impact

- Notion Canonical-hub policy
- repository documentation structure and CI
- Codex implementation-input boundary
- Google Drive reference retention
- architecture and contract PR workflow
- export and mirror automation

## Excluded

- immediate deletion or archival of all Notion pages,
- claiming Git is already Canonical before cutover,
- bulk deletion of Google Drive references,
- product-code or Frontend Phase 1 Section 3 implementation authorization.

## Approval boundary

This ADR accepts the direction and cutover conditions. Export, repository migration, CI implementation, transition-PR merge, and final cutover declaration remain separately verified execution steps.
