# Shotgun Documentation Canonical Record

## 1. Document Status

- Repository: `JasonCutter/shotgun`
- Canonical branch after cutover: `main`
- Governing decision:
  `docs/architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md`
- Policy decision: user approved on 2026-07-29
- Publication state: `PENDING_CANONICALIZATION`
- Canonical cutover: not completed

This file records the target documentation operating model and the current
cutover state. User approval authorizes the policy, but a document becomes a
Canonical Revision only after review, required CI, and merge into GitHub
`main`.

## 2. Source of Truth

After cutover, all Shotgun-authored authoritative text documents are managed in
the GitHub repository:

`https://github.com/JasonCutter/shotgun`

The Canonical branch is `main`, and a Canonical Revision is identified by its
Git commit SHA. A document that exists only in another branch, a pull request,
a local workspace, chat, Notion, Google Drive, or another external system is
not Canonical.

User approval and Canonical publication are separate facts:

1. User approval authorizes a decision or candidate change.
2. A Git branch and pull request make the exact proposed revision reviewable.
3. Review and required CI provide publication evidence.
4. Merge into `main` creates the Canonical Revision.

Until the cutover recorded in Section 10 is completed, existing governing
sources retain the authority documented in the repository. This file does not
silently supersede or delete a pre-cutover source.

## 3. Documents That Must Be Stored in GitHub

Every durable document created for Shotgun work must be recorded as a
Git-tracked repository file. This requirement includes, at minimum:

- Architecture Design Documents, ADRs, contract snapshots, schemas, migration
  and rollback contracts
- implementation plans, roadmaps, risk registers, open issues, rejected
  alternatives, and decision histories
- engineering reports, audits, reviews, gap analyses, impact analyses, and
  completion records
- test, contract, architecture, database, security, quality, OSS, license,
  performance, migration, rollback, backup, restore, release, and deployment
  inspection results
- approval evidence, production verification records, incident reports,
  postmortems, and corrective-action records
- generated verification summaries, manifests, indexes, checksums, and other
  records used to support a status or completion claim

The normal repository locations are:

- `docs/architecture/` for architecture, ADRs, contracts, and implementation
  records
- `docs/implementation/` for plans, roadmaps, policies, risk, and Stage
  validation records
- `docs/engineering/` for engineering reports, verification results,
  completion records, operational runbooks, and drills

New document classes may introduce a more specific path under `docs/`, but
must not be kept only outside the repository.

## 4. Verification and Inspection Record Contract

A report or inspection result that supports an implementation, Gate, release,
approval, or completion claim must be committed in the same pull request as
the work, or in a dedicated evidence pull request that names the exact subject
commit.

Each durable verification record must include, as applicable:

- record identity and date
- subject repository, branch, and commit SHA
- command, check, scenario, or manual procedure executed
- relevant environment and dependency versions
- result for every required check: `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`
- failures, skips, retries, flaky behavior, and their reasons
- links to GitHub Actions runs, artifacts, pull requests, releases, or external
  evidence
- integrity hash and retention information for externally stored artifacts
- known limits and the claim the evidence does or does not support

Local terminal output, a chat response, a pull request comment, or an expiring
GitHub Actions log is supporting material, not the sole durable verification
record. Material results must be summarized in a Git-tracked file. A check
that failed, was blocked, or was not run must not be recorded as passed.

Local execution, remote CI, reviewer approval, merge, deployment, and
production verification are distinct evidence states and must not be
collapsed into one completion claim.

## 5. Documentation Change and Publication Flow

```text
Architecture Meeting or Change Proposal
→ Candidate
→ User Approval
→ Git Documentation Branch
→ Pull Request
→ Review and Required CI
→ main Merge
→ Canonical Revision identified by Commit SHA
→ Optional External Mirror
```

AI-authored requests, designs, ADR drafts, and review results remain Candidates
until approved. Approved documents remain `PENDING_CANONICALIZATION` until
merged into `main`.

A code change that alters or clarifies architecture, contracts, operations, or
completion evidence must update the affected repository documents in the same
pull request. A pure implementation with no documentation impact must state:

```text
Canonical documentation impact: NONE
Reason: <why the approved contract is unchanged>
```

A documentation change must state:

```text
Canonical documentation impact: UPDATED
Governing documents:
- <repository path>

Change type:
- clarification
- implementation record
- verification evidence
- supersession
- new decision requiring approval
```

If implementation reveals a new architecture decision, work must not silently
rewrite an accepted ADR. The new decision and impact scope require a separate
Candidate and approval.

## 6. GitHub Publication Boundary

- The official publication unit is a revision merged into GitHub `main`.
- A pull request is a reviewable publication candidate, not a Canonical
  Revision.
- Releases, documentation sites, and mirrors must be generated from an
  identified Canonical Revision.
- Generated documents must identify their Canonical inputs, generator, and
  reproducible version.
- Corrections preserve history through a new commit; published evidence is not
  silently overwritten to change a prior result.
- GitHub Issues, Discussions, pull request descriptions, comments, Actions
  logs, and release notes may support a repository document, but do not replace
  a required durable record under `docs/`.

## 7. External Systems and Large Artifacts

Notion may be used for meetings, Candidate drafts, navigation, historical
archives, and read-only mirrors. Google Drive or another controlled store may
hold large binaries, scans, vendor material, licensed material that cannot be
redistributed in Git, or temporary exports.

External material that supports a Shotgun decision or claim requires a
Git-tracked reference manifest containing:

- stable identity and purpose
- external location and access boundary
- owner and retention status
- version, checksum, or equivalent integrity information
- Canonical status
- the repository document and commit that reference it

An external-only text document is not an authoritative Shotgun record. Secrets,
credentials, regulated personal data, and material prohibited from
redistribution must not be committed merely to satisfy this policy; commit a
redacted record and safe reference manifest instead.

The allowed synchronization direction after cutover is:

```text
GitHub main
→ External read-only mirror
```

Bidirectional Canonical synchronization and external edits promoted without a
Git pull request are prohibited.

## 8. Completion and Gate Claims

Work must not be reported as complete when a required report or inspection
result exists only locally or outside GitHub. A completion proposal must point
to:

- the implementation commit or pull request
- the Git-tracked verification and completion records
- the remote CI run when required
- separate approval, merge, deployment, and production evidence when those
  states are claimed

Missing documentation automation does not waive the persistence requirement.
Until repository documentation gates are implemented, their state must be
reported as `NOT_IMPLEMENTED`; they must not be described as passed.

## 9. Migration and Rollback

The cutover is additive:

1. inventory pre-cutover authoritative documents and external evidence
2. copy or convert Shotgun-authored text into repository paths
3. add reference manifests for material that must remain external
4. review links, provenance, supersession, and sensitive-data handling
5. merge the approved cutover revision into `main`
6. publish read-only mirrors from that revision

Rollback before cutover means closing or reverting the Candidate without
changing current authority. Rollback after cutover uses a new reviewed Git
revision; it does not delete history or make an external system authoritative
again.

## 10. Cutover Record

```yaml
status: pending
cutover_commit: null
approved_by: null
approved_at: null
```

These fields may be changed only by the explicitly approved cutover revision.
Creating or editing this Candidate does not itself complete the cutover.
