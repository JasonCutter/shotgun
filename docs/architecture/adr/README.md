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

| Range           | Classification or owner                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| ADR-001–ADR-017 | Reserved Legacy Gaps — no Git owner identified                                 |
| ADR-018–ADR-026 | Phase 2 consolidated ADR record                                                |
| ADR-027–ADR-036 | Phase 3 consolidated ADR record                                                |
| ADR-037–ADR-048 | Phase 4 consolidated ADR record                                                |
| ADR-049–ADR-060 | Phase 5 consolidated ADR record                                                |
| ADR-061–ADR-075 | Phase 6 consolidated ADR record                                                |
| ADR-076–ADR-078 | Reserved Legacy Gaps                                                           |
| ADR-079–ADR-094 | Individual files in this directory                                             |
| ADR-095         | Reserved Legacy Gap                                                            |
| ADR-096–ADR-099 | Individual files in this directory                                             |
| ADR-100–ADR-113 | [Frontend consolidated record](../frontend/adr-100-113-consolidated-record.md) |
| ADR-114–ADR-146 | Individual files in this directory                                             |

The Phase records under `docs/architecture/add/` retain their approved 2026-07-16 decision text. ADR-100–113 preserve the accepted Frontend decisions and later Contract Normalization outcomes in one Git owner record while the individual Notion pages remain Legacy References.

ADR-131 through ADR-146 are authoritative accepted individual files. ADR-134 through ADR-142 were accepted together by the user on 2026-08-12 as the AKP v1 whole-design architecture. Their Product implementation remains separately unauthorized. ADR-143 is the accepted finite implementation/completion contract for ADR-133 Runtime-selectable AI Settings and authorizes Product work only through its frozen A4–A9 Section boundaries.

ADR-145 remains an accepted historical individual decision. ADR-146 supersedes ADR-145 as the governing owner-facing Product interaction architecture; both identifiers retain explicit relationship metadata.
The current latest accepted individual decision is
[ADR-146 — PC Global Conversation Shell and GUI/Slash Dual-Control](ADR-146-pc-global-conversation-shell-and-gui-slash-dual-control.md), accepted on 2026-08-15.

The accepted AKP v1 whole-design state remains recorded in
[`../akp/AKP-V1-ARCHITECTURE-ACCEPTANCE.md`](../akp/AKP-V1-ARCHITECTURE-ACCEPTANCE.md).

## Accepted AKP v1 range

- ADR-134 — Active Knowledge Productization v1 Boundary and Completion Contract
- ADR-135 — Hybrid Semantic Retrieval as a Rebuildable Derived Projection
- ADR-136 — Typed Discovery Finding Envelope and Re-entry Mapping Boundary
- ADR-137 — Bounded Multi-Signal Active Discovery Engine Boundary
- ADR-138 — Durable Triggered Discovery Runtime over Existing Outbox and Job Foundations
- ADR-139 — Discovery Re-entry through Derived-Provenance Validation and Existing Review Authority
- ADR-140 — Discovery Workspace, Graph Overlay and Activity Product Boundary
- ADR-141 — Explicit Feedback Separation, Suppression and Non-Epistemic Adaptive Ranking
- ADR-142 — Finite End-to-End Acceptance Gate and AKP v1 Closure Boundary

The range is one accepted architecture system. Acceptance freezes its architecture boundary but does not authorize Product implementation, migrations, dependencies, Ready, Merge, Deployment or Production Verification.

## Accepted Runtime-selectable AI Settings completion contract

- ADR-133 — Runtime-selectable AI Provider, Model & Credential Authority
- ADR-143 — Runtime-selectable AI Settings Implementation Completion Contract

The detailed A1–A9 implementation map is recorded under [`../ai-settings/`](../ai-settings/). DeepSeek is the fresh-Project default selection and primary live verification path, while DeepSeek, OpenAI and Google Gemini must all be operational after valid Settings configuration. Deployment and Production Verification remain separately authorized.

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
