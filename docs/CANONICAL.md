# Project Shotgun Canonical Documentation Policy

## Canonical authority

Project Shotgun completed its documentation authority cutover under [ADR-117](architecture/adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md) as amended by [ADR-120](architecture/adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md).

- GitHub repository `JasonCutter/shotgun`, branch `main`, is the only Canonical source for authoritative text documents and durable evidence records.
- Notion is Candidate working space, published mirror, navigation hub, Legacy Reference and historical archive.
- Google Drive and other external stores are Reference or Archive locations for legacy, external, large, licensed, sensitive, regulated or binary material.
- Content that exists only in Notion, Drive, chat, a local workspace, a pull-request comment or an expiring CI log is not Canonical.

The known Project Shotgun documentation legacy-migration and final cross-store inventory program is complete. New or newly discovered external items do not reopen a second authority: they enter the ordinary inventory and Canonicalization lifecycle as Candidate, Reference or Archive material.

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
- **Generated**: derived output governed by [`generated-artifact-ownership.md`](governance/generated-artifact-ownership.md).
- **Reference**: supporting material that does not define Product truth.
- **Reference Pending Migration**: preserved external material awaiting a future reviewed decision; it has no governing authority.
- **Superseded**: retained historical content replaced or amended by a later approved decision.
- **Duplicate**: a non-owner occurrence classified without deleting historical context.
- **Archived**: retained non-governing history with an identified preservation reason and, where applicable, a Canonical successor.

## Canonical document classes

The following are Canonical when represented in Git, classified in `docs/canonical-manifest.yaml` where required and merged to `main`:

- Knowledge Flow structured baseline and Detailed Map;
- Phase ADDs;
- cross-phase and Frontend Architecture;
- ADRs and the global ADR Registry;
- contract snapshots and their lineage Registry;
- schema, migration and rollback contracts;
- implementation plans and roadmaps;
- engineering verification, Gate and completion records;
- inventory, mirror and archive registries;
- governance, security, operations and quality policies;
- decision history, open issues, rejected alternatives and impact records.

A class being Canonical does not automatically promote every external item in that class. Each item must pass the Git Canonicalization lifecycle.

## ADR governance

[ADR-121](architecture/adr/ADR-121-identifier-stability-registry-and-duplicate-resolution-boundary.md) and [`adr-registry.json`](architecture/adr/adr-registry.json) govern Project-wide ADR identifiers.

- accepted identifiers are immutable;
- each identifier has one authoritative owner;
- consolidated Phase ADR ranges remain valid owner documents;
- duplicates are classified rather than silently deleted;
- supersession retains both decisions and explicit history;
- `npm run docs:adr-index` validates ownership and completeness.

## Contract Snapshot governance

[`contract-snapshot-registry.json`](architecture/contracts/contract-snapshot-registry.json) governs non-ADR Snapshot lineage.

- approved Snapshot files are immutable;
- a later date does not imply supersession;
- topic overlap does not imply duplicate ownership;
- additive amendments retain and name their active base;
- Contract approval and Product implementation remain separate states.

## GitHub report and verification record requirement

All durable Shotgun reports, audits, inspection results, test results, verification records and completion evidence must be stored as Git-tracked repository documents.

A material result used to support an implementation, Gate, approval, release, deployment or completion claim must be committed with the work or in a dedicated evidence pull request that identifies the exact subject commit. The record must include, as applicable:

- record identity and execution date;
- subject branch and commit SHA;
- command, check, scenario or manual procedure;
- relevant environment and dependency versions;
- explicit `PASS`, `FAIL`, `BLOCKED` or `NOT_RUN` for every required check;
- failures, skips, retries, flaky behavior and their reasons;
- GitHub Actions, pull request, release or external evidence references;
- integrity and retention information for externally stored artifacts;
- known limits and the exact claim the evidence supports.

Evidence classification and precedence are defined by [`docs/engineering/README.md`](engineering/README.md) and [`evidence-registry.json`](engineering/evidence-registry.json).

Local verification, remote CI, review, user approval, merge, release, deployment and production verification are distinct evidence states. A failed, blocked or unexecuted check must not be recorded as passed.

Large, sensitive, licensed or regulated artifacts may remain outside Git, but their safe Git reference manifest must record identity, location, access boundary, version or checksum, retention state and Canonical status. Secrets and prohibited redistributable material must not be committed to satisfy this rule.

## Generated artifact boundary

Generated output must identify its owner, Canonical inputs, generator, regeneration rule and authority classification.

- Compiled Truth and other runtime projections are derived and directly non-writable as Canonical Knowledge.
- Knowledge Flow baseline JSON is Canonical; its HTML presentation is deterministic Generated output.
- approved Contract Snapshots are retained approval artifacts, not disposable generator output;
- CI SBOM and expiring diagnostics are transient supporting evidence;
- lockfiles are reproducibility artifacts, not architecture authority;
- migrated documents become Canonical only through reviewed Git migration.

The registry is [`docs/generated-artifacts.json`](generated-artifacts.json).

## Repository rules

1. Do not silently overwrite earlier decisions. Record `supersedes` and the reason.
2. Keep Claim and Fact distinct.
3. Treat Compiled Truth as a derived projection.
4. Do not promote AI output to Canonical without user approval.
5. User approval does not bypass Git review and merge.
6. Code that changes an architecture or contract boundary must update the governing document or explain why no change is needed.
7. Generated files must identify their Canonical inputs and generator.
8. External references must be represented in an inventory or reference manifest when the source is not stored in Git.
9. Missing or conflicting historical authority fails closed: import and reconcile it through a Git PR before using it to govern work.
10. Documentation changes must pass the applicable automated validation Gate.
11. Completion of the historical inventory does not exempt new external items from ongoing classification.

## Documentation validation

The repository provides:

```text
npm run docs:knowledge-flow:check
npm run docs:validate
npm run docs:links
npm run docs:adr-index
npm run docs:canonical
npm run docs:drift
```

The Knowledge Flow generated-output check and `docs:validate` are required Quality CI Steps. They check deterministic HTML equality, relative links, ADR ownership, Canonical governance paths, Evidence and Generated registries, completed-backlog drift and Manifest target existence.

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

High-value Project Shotgun mirrors and the identified historical preparation hub were normalized on 2026-07-29. Their current classifications are recorded in [`mirror-archive-registry.json`](inventory/mirror-archive-registry.json).

## Google Drive and external reference boundary

Keep external, large, licensed, sensitive, regulated or binary material outside Git where appropriate and describe it through a safe reference manifest.

Do not delete legacy material during inventory. Mark it as migrated, archived, superseded, duplicate or retained Reference only after verification. External material is not a second Canonical authority.

The Google Drive Detailed Map is a Legacy Source Reference with explicit Git path and revision metadata. Drive-only changes remain non-Canonical.

## Completed migration, governance and inventory increments

- 2026-07-29: `Shotgun Knowledge Flow Detailed Map` v0.3 migrated from Google Docs revision `9`.
- 2026-07-29: approved `Frontend and Human Interaction Architecture` migrated, including five Phases, twelve Sections, Cross-Phase contracts, ADR index and implementation plan.
- 2026-07-29: approved Phase 1–6 ADD hierarchy migrated, preserving 22 Steps, Section decisions, Phase ADR-018–075, user decisions, open items and change history.
- 2026-07-29: Project-wide ADR identifier governance established through ADR-121 and the global Registry.
- 2026-07-29: Stage 12.1 and Engineering Evidence classifications established.
- 2026-07-29: Generated Artifact Ownership policy and registry established.
- 2026-07-29: documentation validation commands and CI Gate implemented.
- 2026-07-29: final Notion, Google Drive and Git inventory completed.
- 2026-07-29: non-ADR Contract Snapshot lineage reconciled with no unresolved authority conflict.
- 2026-07-29: Knowledge Flow baseline converted to a Canonical structured JSON source with drift-gated HTML generation.
- 2026-07-29: high-value mirrors and archive metadata normalized without deleting historical sources.

Completion evidence is recorded in [`documentation-legacy-migration-completion-260729001.md`](engineering/documentation-legacy-migration-completion-260729001.md).

## Frontend Canonical boundary

The current Frontend Architecture entrypoint is [`docs/architecture/frontend/README.md`](architecture/frontend/README.md).

- Architecture and Contract completion do not imply Product implementation completion.
- Phase 1 Sections 1 and 2 are implemented, verified and merged.
- Phase 1 Section 3 is design/contract approved and frozen; implementation status is governed by later Git records.
- Phases 2 through 5 are design/contract confirmed with Product implementation verification separately governed.
- Historical Notion pages remain Reference; future Notion-only edits are Candidate.

## Ongoing inventory maintenance

The authorized historical migration and final inventory backlog is complete. Ongoing work is event-driven rather than a standing unresolved migration:

- classify newly discovered external documents;
- update mirrors after material Canonical revisions;
- register new Contract Snapshot lineage;
- preserve newly superseded or archived history;
- keep generated outputs synchronized through CI.

A newly discovered item starts as Candidate, Reference or Archive material and does not change the completed status of the 2026-07-29 inventory unless a material omission in the recorded scope is proven.

## Cutover and completion record

```yaml
status: active
cutover_commit: 08a6c7eb48b893a9309dfb90fbc3c4774a1f19a7
approved_by: user
approved_at: 2026-07-29
governing_adr: ADR-120
legacy_migration_status: complete
inventory_status: complete
```

The Cutover became effective when its recorded commit became reachable from `main`. The migration and inventory completion becomes effective when the final completion record and Manifest are merged to `main`.
