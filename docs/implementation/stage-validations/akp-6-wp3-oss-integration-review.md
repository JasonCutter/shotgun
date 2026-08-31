# AKP-6 WP3 OSS Integration Review

Status: `PASS` for the Discovery Graph Binding and Non-Canonical Overlay
boundary. No new runtime dependency, schema, worker, store, or graph
materializer is introduced by WP3.

## Decisions

| Candidate            | Decision                            | Version / commit     | License            | Boundary                                                         |
| -------------------- | ----------------------------------- | -------------------- | ------------------ | ---------------------------------------------------------------- |
| Cytoscape.js         | `ADOPT` (existing Graph UI adapter) | `3.34.0` / `22716bf` | MIT                | Canvas presentation only; no authority or persistence            |
| `garrytan/gbrain`    | `REFERENCE_ONLY`                    | `a25209b`            | MIT                | Read coordination and graph product patterns only                |
| Inkeep OpenKnowledge | `REFERENCE_ONLY`                    | `f2834c2`            | GPL-3.0-or-later   | Overlay visual distinction and source-preservation patterns only |
| PostgreSQL           | `ADOPT` (existing storage)          | `16.14`              | PostgreSQL License | Existing Discovery and Graph read authorities; no WP3 migration  |

The existing Graph contracts, React views, Cytoscape adapter, PostgreSQL
Discovery readers, and WP1 server-authoritative coordinator are reused behind
their existing Ports. No graph/layout/visualization package is added, and no
OSS runtime, database model, ID, or internal schema is promoted to a Shotgun
Canonical contract.

## Verification and replacement

WP3 keeps the replaceable seams at `GraphReadPort`,
`GraphDiscoveryOverlayPort`, and the typed frontend Graph client. The overlay
is read-time only and is bound to `baseSnapshotId`, `projectionRevision`,
`findingId`, `findingRevision`, project, access, lifecycle, current resource,
and Evidence authority. An unavailable or replaced adapter returns a typed
overlay-specific unavailable result while the healthy base Graph remains
usable.

Migration: `NONE`.

Rollback: remove the WP3 overlay route/client/UI binding and retain the
pre-WP3 Graph snapshot contracts; no data rollback or rebuild is required.

Contract, identity-mismatch, terminal-lifecycle, cross-project, current
resource, Evidence, and base-Graph health tests are required before the WP3
Draft PR is considered for review. Stage 12 remains the final OSS and
replacement gate.

## Production composition correction

The production correction keeps the existing `projection.compiled_truth`
projection and `PostgresCompiledTruthRepository` as the Graph read authority.
`PostgresCompiledTruthGraphReadAdapter` is an `AUGMENT` adapter behind
`GraphReadPort`; it adds no schema, migration, Canonical owner, or second
truth store. Existing `PostgresFrontendKnowledgeGraphStores` from migration
026 remains limited to snapshot context, health, and continuation state.

The in-memory Stage 9 adapter remains a fixture/test implementation and is not
used by the normal `startShotgunApplication()` production composition. The
replacement boundary is the GraphReadPort adapter: rollback is a code revert
of the correction wiring, with no Canonical data migration or rebuild.
