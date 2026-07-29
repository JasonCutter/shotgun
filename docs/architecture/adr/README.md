# Project Shotgun Architecture Decision Records

This directory and the registered consolidated Phase ADR documents form the global ADR authority for Project Shotgun.

## Governing rules

- [ADR-121](ADR-121-identifier-stability-registry-and-duplicate-resolution-boundary.md) defines identifier stability, ownership and duplicate resolution.
- [`adr-registry.json`](adr-registry.json) records the authoritative owner ranges.
- Accepted identifiers are immutable and are never renumbered to remove gaps or reorganize topics.
- One identifier has exactly one authoritative owner.
- References, mirrors, snapshots and historical quotations do not become owners merely because they mention an ADR heading.
- Supersession retains both records and uses explicit relationship metadata.

## Authoritative ownership layout

| Range | Owner |
| --- | --- |
| ADR-001–ADR-017 | Individual files in this directory |
| ADR-018–ADR-026 | Phase 2 consolidated ADR record |
| ADR-027–ADR-036 | Phase 3 consolidated ADR record |
| ADR-037–ADR-048 | Phase 4 consolidated ADR record |
| ADR-049–ADR-060 | Phase 5 consolidated ADR record |
| ADR-061–ADR-075 | Phase 6 consolidated ADR record |
| ADR-076 onward | Individual files in this directory |

The Phase records are located under `docs/architecture/add/` and retain their approved 2026-07-16 decision text.

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

The validator scans individual ADR filenames and registered consolidated ADR headings. It fails on missing registered owners, overlapping ranges, malformed identifiers and duplicate authoritative ownership.
