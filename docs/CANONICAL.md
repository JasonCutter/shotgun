# Project Shotgun Canonical Documentation Policy

## Current transition state

Project Shotgun is transitioning from a Notion-first Canonical model to a Git `main` Single Source of Truth under [ADR-117](architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md).

This file is part of the transition PR. **The cutover is not complete merely because this file exists.**

Until an explicitly approved `Canonical Cutover Commit` is merged:

- Notion remains the temporary transition authority for previously Canonical ADD content.
- Git records the proposed normalized Canonical documents and validation machinery.
- Drift must be resolved by approval history and document meaning, not by latest timestamp.

After the cutover commit:

- GitHub repository `JasonCutter/shotgun`, branch `main`, is the only Canonical source for authoritative text documents.
- Notion is Candidate working space, published mirror, navigation hub, and archive.
- Google Drive is reference/archive storage for external or unsuitable-for-Git material.

## Canonicalization lifecycle

```text
Candidate
-> User Approved
-> Pending Canonicalization
-> Git Pull Request
-> Review and CI
-> Merge to main
-> Canonical
-> Optional Notion Mirror
```

Definitions:

- **Candidate**: proposed content. AI-generated content is Candidate by default.
- **User Approved**: the user accepted the decision or text, but it may not yet exist in Git `main`.
- **Pending Canonicalization**: approved content awaiting a repository PR and merge.
- **Canonical**: merged into Git `main` after the cutover boundary.
- **Generated**: derived output that must be reproducible from Canonical sources.
- **Reference**: supporting material that does not define product truth.
- **Superseded**: retained historical content replaced by a later approved decision.

## Canonical document classes

The following are Canonical when listed in `docs/canonical-manifest.yaml` and merged to `main`:

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

## GitHub report and verification record requirement

All durable Shotgun reports, audits, inspection results, test results,
verification records, and completion evidence must be stored as Git-tracked
repository documents. This rule applies to new work during the transition
period and does not itself complete the Canonical cutover.

A material result used to support an implementation, Gate, approval, release,
deployment, or completion claim must be committed with the work or in a
dedicated evidence pull request that identifies the exact subject commit. The
record must include, as applicable:

- record identity and execution date,
- subject branch and commit SHA,
- command, check, scenario, or manual procedure,
- relevant environment and dependency versions,
- explicit `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` for every required check,
- failures, skips, retries, flaky behavior, and their reasons,
- links to GitHub Actions runs, pull requests, releases, or external evidence,
- integrity and retention information for externally stored artifacts,
- known limits and the exact claim the evidence supports.

Local terminal output, chat, an external-only text document, a pull request
comment, or an expiring GitHub Actions log is supporting material, not the sole
durable record. Material results must be summarized under `docs/`, normally in
`docs/engineering/`, `docs/implementation/stage-validations/`, or the relevant
architecture implementation-record path.

Local verification, remote CI, reviewer or user approval, merge, deployment,
and production verification are distinct evidence states. A failed, blocked,
or unexecuted check must not be recorded as passed.

Large, sensitive, licensed, or regulated artifacts may remain outside Git, but
their safe Git reference manifest must record identity, location, access
boundary, version or checksum, retention state, and Canonical status. Secrets
and prohibited redistributable material must not be committed to satisfy this
rule.

## Repository rules

1. Do not silently overwrite earlier decisions. Record `supersedes` and the reason.
2. Keep Claim and Fact distinct.
3. Treat Compiled Truth as a derived projection.
4. Do not promote AI output to Canonical without user approval.
5. User approval does not bypass Git review and merge after cutover.
6. Code that changes an architecture or contract boundary must update the governing document or explain why no change is needed.
7. Generated files must identify their Canonical inputs and generator.
8. External references must be represented in a manifest when the source is not stored in Git.

## Notion mirror requirements

After cutover, a mirrored page should show:

```text
Canonical status: Mirror
Canonical repository: JasonCutter/shotgun
Canonical path: docs/...
Canonical revision: <commit SHA>
Last synchronized: <date>
```

Notion-only edits remain Candidate until represented in a Git PR and merged.

## Google Drive boundary

Move Shotgun-authored governing text into Git. Keep external, large, licensed, or binary material outside Git where appropriate and describe it through a reference manifest.

Do not delete legacy material during inventory. Mark it as migrated, archived, superseded, duplicate, or retained reference only after verification.

## Cutover prerequisites

The final cutover requires:

- complete document inventory,
- normalized Git paths,
- ADR and contract indexes,
- link validation,
- approval and supersession validation,
- Notion/Git drift resolution,
- explicit user approval of the cutover commit.

The cutover commit SHA must be recorded in this file and in `docs/canonical-manifest.yaml`.

## Cutover record

```yaml
status: pending
cutover_commit: null
approved_by: null
approved_at: null
```
