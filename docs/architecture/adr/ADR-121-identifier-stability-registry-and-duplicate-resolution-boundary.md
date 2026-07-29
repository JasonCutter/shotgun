# ADR-121 — ADR Identifier Stability, Registry and Duplicate Resolution Boundary

## Status

Accepted.

- Approval date: 2026-07-29
- Approver: User
- Scope: Project-wide architecture decision record governance

## Context

Project Shotgun accumulated architecture decisions through several storage and implementation periods:

- Phase ADD decision collections in Notion and later Git;
- individual Git ADR files created by implementation Stages;
- Frontend ADRs;
- documentation authority and migration ADRs;
- historical mirrors, snapshots and completion records that repeat ADR identifiers as references.

Renumbering accepted decisions would break links, implementation evidence, PR discussions, contract snapshots and historical reasoning. At the same time, allowing multiple documents to claim ownership of the same identifier would create conflicting authority.

## Decision

### 1. Accepted ADR identifiers are immutable

Once an ADR identifier is accepted, its number is never reassigned or renumbered for cosmetic ordering.

A gap in the number sequence is preserved. It is not filled by moving another accepted ADR.

### 2. One authoritative owner per identifier

Each ADR identifier has exactly one authoritative owner location recorded by `docs/architecture/adr/adr-registry.json`.

Owner forms:

- an individual ADR file under `docs/architecture/adr/`; or
- one approved consolidated Phase ADR document that owns a contiguous historical range.

Other occurrences are references, aliases, mirrors, snapshots or historical quotations and do not own the identifier.

### 3. Historical Phase ranges remain consolidated

The approved Phase ADD ADR collections remain authoritative owners for these ranges:

- ADR-018–ADR-026: Phase 2
- ADR-027–ADR-036: Phase 3
- ADR-037–ADR-048: Phase 4
- ADR-049–ADR-060: Phase 5
- ADR-061–ADR-075: Phase 6

They are not split or renumbered merely to match the later one-file-per-ADR layout.

### 4. Duplicate resolution is classification, not deletion

When the same identifier appears in more than one location:

1. identify the accepted owner;
2. classify other occurrences as `REFERENCE`, `ALIAS`, `MIRROR`, `SUPERSEDED`, or `HISTORICAL_QUOTE`;
3. record the relationship and reason;
4. retain the historical text unless deletion has an independent retention basis.

An unresolved duplicate fails the ADR validation Gate.

### 5. Supersession is explicit

A later ADR may amend or supersede an earlier ADR, but it does not reuse the earlier number. Both records remain available with explicit `supersedes`, `superseded_by`, or amendment metadata.

### 6. Automated registry validation

Repository validation must check:

- valid `ADR-NNN` identifiers;
- one owner per registered identifier;
- registered owner path existence;
- no overlapping owner ranges;
- no unclassified duplicate owner headings;
- no silent renumbering of accepted identifiers.

## Rejected alternatives

### Renumber all ADRs into topic order

Rejected because it destroys stable references and obscures decision history.

### Copy every consolidated Phase ADR into an individual file

Rejected as a mandatory migration because it would create duplicate owners and unnecessary semantic drift. Individual extraction may occur later only through an explicit migration record.

### Treat the newest modified file as authoritative

Rejected because timestamps do not prove approval or authority.

### Delete duplicate text immediately

Rejected because duplicate occurrences may contain historical context, prior wording or evidence required for audit.

## Consequences

- ADR numbers remain stable even when document layout changes.
- Global ordering is provided by the Registry rather than filesystem naming alone.
- Phase ADD ADR collections and later individual ADRs coexist without competing ownership.
- Validation can fail closed on duplicate or missing ownership.
- Existing links and evidence remain valid.

## Migration impact

This ADR establishes governance only. It does not change Product runtime contracts, Canonical Knowledge, database schema, dependencies or deployment behavior.

## Change history

- 2026-07-29: Accepted as part of the authorized documentation governance completion work.
