# ADR-117 — Documentation Source of Truth, Canonicalization, and Publication Boundary

## Status

Accepted by user on 2026-07-29.

- Publication status: `PENDING_CANONICALIZATION`
- Canonical cutover status: `pending`
- Implementation status: documentation policy Candidate

Acceptance authorizes this decision. It does not make the working branch or
pull request Canonical, and it does not complete the cutover recorded in
`docs/CANONICAL.md`.

## Context

Shotgun architecture, implementation, verification, and operational evidence
has been created across Git, local workspaces, chat, Notion, Google Drive,
pull requests, and CI systems. That distribution creates several risks:

- two systems can appear to be authoritative at the same time
- a locally generated report can support a completion claim without durable
  review history
- pull request comments and CI logs can expire or become difficult to connect
  to the exact implementation commit
- external edits can bypass repository review and required CI
- approvals, implementation, remote CI, merge, deployment, and production
  verification can be incorrectly collapsed into a single status
- generated documents can lose their source revision or generator provenance

The repository already stores ADRs, contract snapshots, engineering reports,
Stage validation records, implementation plans, and completion records.
Shotgun needs one explicit ownership and publication boundary that applies to
all of these document classes.

This ADR governs documentation authority and evidence persistence. It does not
change the Canonical Knowledge module's product-data write authority,
Claim/Fact boundary, user approval rules, or external Action approval model.

## Decision

### 1. GitHub repository ownership

After the approved cutover, the GitHub repository
`https://github.com/JasonCutter/shotgun` is the single source of truth for all
Shotgun-authored authoritative text documentation. The Canonical branch is
`main`, and each published document revision is identified by a Git commit
SHA.

A branch or pull request contains a Candidate. Review, required CI, and merge
into `main` establish the Canonical Revision. User approval authorizes a
decision but does not bypass publication.

### 2. Mandatory Git-backed records

All durable reports, audits, inspection results, verification results,
completion records, decision records, plans, contracts, and operational
records must be stored as Git-tracked repository files.

This rule applies immediately to new work during the cutover period: evidence
created before cutover must still be prepared on the work branch and reviewed
in Git. Pre-cutover authority remains unchanged until the cutover revision is
merged, but new local-only or external-only result documents are not an
acceptable completion record.

The following supporting material does not satisfy the rule by itself:

- local files or terminal output
- chat messages
- Notion-only or Google Drive-only text
- GitHub Issue, Discussion, pull request description, or comment
- an expiring GitHub Actions log or artifact

Material results from those sources must be summarized in a repository
document that identifies the exact source and subject revision.

### 3. Verification evidence schema

Every verification or inspection record used for a claim must record, as
applicable:

- record identity and execution date
- subject branch and commit SHA
- commands, checks, scenarios, and manual procedures
- material environment and version information
- explicit `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` result for every required
  item
- failures, skips, retries, flaky behavior, and their reasons
- remote CI, artifact, pull request, release, or deployment references
- checksum and retention details for external artifacts
- known limits and the exact claim supported

Local validation, remote CI, reviewer approval, merge, deployment, and
production verification remain separate evidence classes. None may be inferred
from another.

### 4. Repository placement

Documents use stable paths according to ownership:

- `docs/architecture/`: ADDs, ADRs, contracts, normalization records, and
  architecture implementation records
- `docs/implementation/`: plans, roadmaps, policy, risk, release, OSS
  evaluation, and Stage validation
- `docs/engineering/`: engineering reports, verification, completion records,
  operational runbooks, drills, and measured baselines

A new document class may add a more specific directory under `docs/`. It may
not select an external system as its sole durable home.

### 5. Publication and correction

The publication flow is:

```text
Candidate
→ User Approval
→ Git Branch and Pull Request
→ Review and Required CI
→ main Merge
→ Canonical Revision
→ Optional External Mirror
```

Published records are corrected with a new commit that preserves the previous
result and explains supersession. Reports are not silently rewritten to make a
failed or incomplete check appear successful.

Generated documents record their Canonical inputs, generator identity and
version, output revision, and reproduction method.

### 6. External systems

Notion is limited to meeting workspaces, Candidate drafts, navigation,
historical archives, and read-only mirrors. Google Drive or another controlled
store may retain large binaries, scans, vendor material, licensed material, or
other content that cannot safely or legally be stored in Git.

Material retained externally requires a Git-tracked reference manifest with
identity, purpose, owner, external location, access boundary, retention state,
version or integrity hash, and Canonical status.

After cutover, synchronization is one way:

```text
GitHub main
→ External read-only mirror
```

External edits are Candidates until reviewed and merged through Git.

Secrets, credentials, regulated personal data, and prohibited redistributable
material remain outside Git. Their repository record must be redacted and must
reference the controlled source without exposing sensitive values.

### 7. Completion boundary

An implementation, Stage, Gate, release, migration, rollback, or operational
claim is not complete when its required report or inspection result has not
been recorded in Git.

The committed record must distinguish:

- implementation present
- local verification
- remote CI
- reviewer or user approval
- merge
- deployment
- production verification

Missing documentation automation is reported as `NOT_IMPLEMENTED`; it is not a
passing result and does not waive the requirement to commit the record.

### 8. Cutover boundary

The initial Cutover Record remains:

```yaml
status: pending
cutover_commit: null
approved_by: null
approved_at: null
```

The cutover requires a separately reviewable revision that inventories legacy
authoritative sources, imports or references required material, verifies
provenance and links, and receives explicit cutover approval. This ADR must not
be mixed into an unrelated product implementation pull request.

## Alternatives Considered

### Dual Canonical ownership in GitHub and Notion

Rejected. Concurrent authority creates drift and forces implementers to infer
which copy wins.

### Latest edit wins

Rejected. Modification time does not establish approval, review, provenance,
or semantic authority.

### Pull request or CI-only evidence

Rejected. Descriptions, comments, logs, and artifacts can be edited, expire, or
become detached from the durable documentation history.

### Local report with a final chat summary

Rejected. The result is not repository-reviewable and cannot provide a stable
commit-addressed evidence trail.

### Store every raw artifact directly in Git

Rejected. Large, sensitive, licensed, or regulated artifacts require a
controlled external store. Git retains their safe reference manifest and the
durable result summary.

## Impact Scope

- `docs/CANONICAL.md`: authority, record classes, publication flow, evidence
  requirements, external boundaries, and cutover state
- all future reports and inspection results under `docs/`
- pull request templates and documentation validation automation in follow-up
  work
- Notion and Google Drive publication processes after cutover

This ADR changes documentation governance only. It adds no runtime dependency,
database migration, product-data schema, or Canonical Knowledge write path.

## OSS Integration Decision

`NO_RELEVANT_OSS`

This decision defines repository governance and publication authority rather
than a replaceable runtime capability. The reviewed integration surface is
GitHub repository history, pull requests, Actions references, and optional
external mirrors. No third-party runtime or library is adopted, extracted,
augmented, or pinned by this ADR.

## Migration

1. Inventory current repository and external authoritative text.
2. Record ownership, source revision, approval state, and supersession status.
3. Move Shotgun-authored authoritative text into `docs/`.
4. Create Git reference manifests for allowed external artifacts.
5. Add link, index, Canonical-state, and drift validation.
6. Review and merge the explicitly approved cutover revision.
7. Generate external read-only mirrors from the merged commit.

The migration is additive. Existing sources are not deleted or declared
non-authoritative before the approved cutover.

## Rollback

Before cutover, rollback closes or reverts the Candidate and leaves existing
authority unchanged.

After cutover, rollback is a new reviewed Git revision. It preserves Git
history and evidence records, disables broken mirror publication if necessary,
and does not promote an external system back to Canonical without a separate
approved ADR.

## Verification Required

- confirm both governing document paths exist in the repository
- run repository formatting for the changed Markdown
- run the architecture test to ensure no implementation boundary changed
- run every implemented documentation validation script
- report absent documentation scripts as `NOT_IMPLEMENTED`
- verify the Cutover Record remains `pending` until the approved merge revision
