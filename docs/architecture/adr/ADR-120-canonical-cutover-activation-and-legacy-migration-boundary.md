# ADR-120 — Canonical Cutover Activation and Legacy Migration Boundary

## Status

Accepted.

- Approval date: 2026-07-29
- Approver: User
- Activation condition: this ADR commit is reachable from `JasonCutter/shotgun` `main`
- Scope: Project Shotgun documentation authority and remaining legacy-document migration

## Context

ADR-117 accepted GitHub `main` as the target Single Source of Truth but made authority cutover depend on completing the entire historical inventory, export, normalization, validation-tooling, and drift-resolution program first.

That sequencing leaves Notion as a temporary authority for an indefinite period even though new architecture decisions, contracts, implementation records, reports, inspections, and test evidence are already reviewed and retained through GitHub.

The user explicitly directed that the remaining `pending` Canonical Cutover state be resolved on 2026-07-29.

The cutover must not be completed by falsely claiming that every legacy item has already been inventoried or migrated. Authority activation and legacy migration therefore need separate completion states.

## Decision

### 1. GitHub `main` becomes the sole Canonical authority

When the commit that introduces this ADR becomes reachable from the repository `main` branch:

- `JasonCutter/shotgun` `main` is the sole Canonical source for Project Shotgun governing text and durable evidence records.
- Notion is a Candidate workspace, readable mirror, navigation hub, and historical archive.
- Google Drive and other external stores are reference/archive locations for material that is not yet migrated or is unsuitable for Git.
- No Notion-only, Drive-only, chat-only, local-only, PR-comment-only, or expiring CI-log-only content may govern new implementation or support a durable completion claim.

### 2. Legacy migration continues after authority cutover

Incomplete inventory and migration do not remain a second authority and do not block the authority cutover.

Unmigrated legacy items are classified as one of:

- `REFERENCE_PENDING_MIGRATION`
- `CANDIDATE_PENDING_REVIEW`
- `ARCHIVED_LEGACY`
- `SUPERSEDED`
- `DUPLICATE`

A legacy item becomes Canonical only after it is represented in Git, its provenance and approval state are recorded, conflicts are resolved explicitly, and the change is merged to `main`.

Migration backlog must remain visible in Git-tracked manifests or reports. This decision does not claim that the backlog is complete.

### 3. Historical gaps fail closed

When a required historical decision is absent from Git or conflicts with a Git document:

1. do not infer authority from modification timestamps,
2. do not silently copy or overwrite text,
3. stop the affected decision or implementation boundary,
4. import the relevant source through a Git pull request,
5. record provenance, approval, supersession, rejected alternatives, and impact,
6. obtain user approval when meaning is unresolved or changed.

### 4. Cutover record

The Canonical Cutover Commit is the commit that creates this ADR. The commit SHA is recorded in `docs/CANONICAL.md` and `docs/canonical-manifest.yaml` before the branch is merged.

The cutover becomes effective only when that recorded commit is reachable from `main`. A branch or open pull request does not activate the cutover.

### 5. Evidence and publication

All durable reports, audits, inspection results, test results, verification records, and completion evidence remain Git-tracked repository documents under ADR-117.

Generated sites, Notion mirrors, releases, or other publications are projections of Git `main`; they are not independent authorities.

## Supersedes

This ADR supersedes only the sequencing rule in ADR-117 and the documentation cutover plan that required the full legacy inventory, export, validation-tooling, and mirror update program to finish before Git authority activation.

It does not supersede:

- explicit user approval boundaries,
- Git pull request and merge requirements,
- Claim/Fact separation,
- Compiled Truth as a derived projection,
- preservation of decision history and supersession reasons,
- the requirement to complete and document the remaining migration backlog,
- the prohibition on bidirectional automatic Git/Notion synchronization.

## Rejected alternatives

### Mark all prerequisites complete without evidence

Rejected because the current manifest explicitly records unresolved inventory and migration work.

### Keep Cutover pending until every legacy document is migrated

Rejected because it preserves two practical authorities indefinitely and makes current Git-based engineering records subordinate to an incomplete external inventory.

### Treat Git and Notion as co-Canonical during migration

Rejected because conflict resolution would still require a third authority.

## Impact

- GitHub `main` becomes immediately authoritative when this ADR commit reaches `main`.
- Existing Git documents and future merged revisions are governed through Git.
- Unmigrated Notion and Drive material loses governing authority but remains preserved as reference or migration input.
- The inventory, normalization, validation gates, mirror metadata, and archive work continue as post-cutover governance backlog.
- No Product code, database schema, runtime contract, or deployment state changes.

## Verification boundary

Cutover completion requires verification that:

- this ADR commit is reachable from `main`,
- `docs/CANONICAL.md`, `docs/canonical-manifest.yaml`, ADR-117, the cutover plan, and README consistently report the active authority,
- unresolved legacy items remain visible and are not reported as migrated,
- remote required CI gates pass for the cutover pull request.
