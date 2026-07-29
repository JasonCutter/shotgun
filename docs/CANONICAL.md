# Project Shotgun Canonical Documentation Policy

## Canonical authority

Project Shotgun completed its documentation authority cutover under [ADR-117](architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md) as amended by [ADR-120](architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md).

- GitHub repository `JasonCutter/shotgun`, branch `main`, is the only Canonical source for authoritative text documents and durable evidence records.
- Notion is Candidate working space, published mirror, navigation hub, and historical archive.
- Google Drive and other external stores are reference/archive locations for legacy, external, large, licensed, sensitive, regulated, or binary material.
- Content that exists only in Notion, Drive, chat, a local workspace, a pull-request comment, or an expiring CI log is not Canonical.

The authority cutover does not claim that every historical document has already been migrated. Remaining inventory and migration work is a visible post-cutover governance backlog. An unmigrated legacy item cannot govern new implementation until it is imported, reconciled, approved where required, and merged to `main`.

## Canonicalization lifecycle

```text
Candidate
-> User Approved
-> Pending Canonicalization
-> Git Pull Request
-> Review and CI
-> Merge to main
-> Canonical
-> Optional Notion Mirror or other publication
```

Definitions:

- **Candidate**: proposed content. AI-generated content is Candidate by default.
- **User Approved**: the user accepted the decision or text, but it may not yet exist in Git `main`.
- **Pending Canonicalization**: approved content awaiting a repository PR and merge.
- **Canonical**: merged into Git `main` after the cutover boundary.
- **Generated**: derived output that must be reproducible from Canonical sources.
- **Reference**: supporting material that does not define product truth.
- **Reference Pending Migration**: preserved legacy material that may be imported but has no current governing authority.
- **Superseded**: retained historical content replaced by a later approved decision.

## Canonical document classes

The following are Canonical when represented in Git, classified in `docs/canonical-manifest.yaml` where required, and merged to `main`:

- Knowledge Flow baseline and Detailed Map
- Phase ADDs
- cross-phase and frontend architecture
- ADRs
- contract snapshots
- schema, migration, and rollback contracts
- implementation plans and roadmaps
- engineering verification and completion records
- governance, security, operations, and quality policies
- decision history, open issues, rejected alternatives, and impact records

A class being Canonical does not automatically promote every external or legacy item in that class. Each item must pass the Git canonicalization lifecycle.

## GitHub report and verification record requirement

All durable Shotgun reports, audits, inspection results, test results, verification records, and completion evidence must be stored as Git-tracked repository documents.

A material result used to support an implementation, Gate, approval, release, deployment, or completion claim must be committed with the work or in a dedicated evidence pull request that identifies the exact subject commit. The record must include, as applicable:

- record identity and execution date,
- subject branch and commit SHA,
- command, check, scenario, or manual procedure,
- relevant environment and dependency versions,
- explicit `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` for every required check,
- failures, skips, retries, flaky behavior, and their reasons,
- links to GitHub Actions runs, pull requests, releases, or external evidence,
- integrity and retention information for externally stored artifacts,
- known limits and the exact claim the evidence supports.

Local terminal output, chat, an external-only text document, a pull request comment, or an expiring GitHub Actions log is supporting material, not the sole durable record. Material results must be summarized under `docs/`, normally in `docs/engineering/`, `docs/implementation/stage-validations/`, or the relevant architecture implementation-record path.

Local verification, remote CI, reviewer or user approval, merge, deployment, and production verification are distinct evidence states. A failed, blocked, or unexecuted check must not be recorded as passed.

Large, sensitive, licensed, or regulated artifacts may remain outside Git, but their safe Git reference manifest must record identity, location, access boundary, version or checksum, retention state, and Canonical status. Secrets and prohibited redistributable material must not be committed to satisfy this rule.

## Repository rules

1. Do not silently overwrite earlier decisions. Record `supersedes` and the reason.
2. Keep Claim and Fact distinct.
3. Treat Compiled Truth as a derived projection.
4. Do not promote AI output to Canonical without user approval.
5. User approval does not bypass Git review and merge.
6. Code that changes an architecture or contract boundary must update the governing document or explain why no change is needed.
7. Generated files must identify their Canonical inputs and generator.
8. External references must be represented in a manifest when the source is not stored in Git.
9. Missing or conflicting historical authority fails closed: import and reconcile it through a Git PR before using it to govern work.

## Notion mirror requirements

A mirrored page should show, where practical:

```text
Canonical status: Mirror
Canonical repository: JasonCutter/shotgun
Canonical path: docs/...
Canonical revision: <commit SHA>
Last synchronized: <date>
```

Notion-only edits remain Candidate until represented in a Git PR and merged. The authoritative synchronization direction is `Git main -> Notion mirror`. Bidirectional automatic synchronization is prohibited.

## Google Drive and external reference boundary

Move Shotgun-authored governing text into Git through reviewed migration PRs. Keep external, large, licensed, sensitive, regulated, or binary material outside Git where appropriate and describe it through a safe reference manifest.

Do not delete legacy material during inventory. Mark it as migrated, archived, superseded, duplicate, or retained reference only after verification. External or unmigrated material is not a second Canonical authority.

## Post-cutover migration backlog

The following work continues without changing the active GitHub authority:

- complete Notion, Google Drive, and Git document inventory,
- normalize remaining Git paths,
- migrate the Knowledge Flow Detailed Map and remaining governing text,
- export and reconcile Phase ADD and frontend architecture history,
- complete ADR and contract indexes,
- implement link, metadata, canonical, and drift validation gates,
- resolve historical approval and supersession gaps,
- add commit metadata to high-value mirrors and archive legacy sources safely.

Backlog completion must be reported truthfully. An unresolved item remains `REFERENCE_PENDING_MIGRATION` or another non-Canonical classification until its Git canonicalization completes.

## Cutover record

```yaml
status: active
cutover_commit: 08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7
approved_by: user
approved_at: 2026-07-29
governing_adr: ADR-120
legacy_migration_status: in_progress_non_blocking
```

The cutover became effective when the recorded commit became reachable from `main`.
