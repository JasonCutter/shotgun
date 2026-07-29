# Project Shotgun Architecture Decision Records

This directory and the registered consolidated ADR documents form the global ADR authority for Project Shotgun.

## Governing rules

- [ADR-121](ADR-121-identifier-stability-registry-and-duplicate-resolution-boundary.md) defines identifier stability, ownership and duplicate resolution.
- [`adr-registry.json`](adr-registry.json) records authoritative owner ranges and explicit reserved gaps.
- Accepted identifiers are immutable and are never renumbered to remove gaps or reorganize topics.
- One active identifier has exactly one authoritative owner.
- References, mirrors, snapshots and historical quotations do not become owners merely because they mention an ADR heading.
- Supersession retains both records and uses explicit relationship metadata.
- An identifier without a verified owner remains a reserved Legacy Gap and cannot be reused.

## Authoritative ownership layout

| Range | Classification or owner |
| --- | --- |
| ADR-001–ADR-017 | Reserved Legacy Gaps — no Git owner identified |
| ADR-018–ADR-026 | Phase 2 consolidated ADR record |
| ADR-027–ADR-036 | Phase 3 consolidated ADR record |
| ADR-037–ADR-048 | Phase 4 consolidated ADR record |
| ADR-049–ADR-060 | Phase 5 consolidated ADR record |
| ADR-061–ADR-075 | Phase 6 consolidated ADR record |
| ADR-076–ADR-078 | Reserved Legacy Gaps |
| ADR-079–ADR-094 | Individual files in this directory |
| ADR-095 | Reserved Legacy Gap |
| ADR-096–ADR-099 | Individual files in this directory |
| ADR-100–ADR-113 | [Frontend consolidated record](../frontend/adr-100-113-consolidated-record.md) |
| ADR-114–ADR-122 | Individual files in this directory |

The Phase records under `docs/architecture/add/` retain their approved 2026-07-16 decision text. ADR-100–113 preserve the accepted Frontend decisions and later Contract Normalization outcomes in one Git owner record while the individual Notion pages remain Legacy References.

The current latest individual decision is [ADR-122 — Sources Workspace Intake Draft, Duplicate Resolution, URL Acquisition and Source Lifecycle Boundary](ADR-122-sources-workspace-intake-duplicate-url-and-lifecycle-boundary.md).

## Reserved-gap rule

A reserved gap means no authoritative Git owner was verified during reconciliation. It does not mean that the number is free.

When historical evidence is found:

1. verify the decision identity and approval state;
2. import or classify it through a reviewed Git PR;
3. replace the gap classification with one owner;
4. preserve the reason and migration history.

## Duplicate handling

A duplicate owner is not resolved by deleting the older file or choosing the newest timestamp. The repository must:

1. identify the accepted owner;
2. classify every other occurrence;
3. preserve historical context;
4. record alias or supersession relationships;
5. pass `npm run docs:adr-index`.

## Validation commands

```text
npm run docs:adr-index
npm run docs:validate
```

The validator scans individual ADR filenames and registered consolidated ADR headings. It fails on missing unclassified owners, overlapping ranges, malformed identifiers, duplicate ownership and a reserved gap that unexpectedly acquires an owner.
