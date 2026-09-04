# ADR-156 — Critical Handoff Classification and Runtime Policy

- Status: **Accepted for WP-07 implementation**
- Date: 2026-09-04
- Scope: Module producer handoff classification, route validation and publisher acknowledgement
- Work item: Runtime/Data Integrity Correction WP-07, Issue #179
- Implementation branch: `codex/wp07-critical-handoff-rollout`
- Base: `main@2164519f9acb4de0a76fe9b448a6d34435376659`
- Approval evidence: Issue #179 design review approval with required amendments
- Related decisions: ADR-077, ADR-086, ADR-154, ADR-155

## Authority and scope gate

This decision authorizes WP-07 only. It does not authorize readiness redesign
(WP-08), HTTP decoder work (WP-09), Action feedback review (WP-10), legacy
cleanup (WP-11), or the final E2E gate (WP-12). Existing Canonical, Source,
Evidence, Approval, Connector and Discovery authorities remain authoritative.

The existing `ModuleManifest.produces` field is extended with an edge-level
`handoffs` list. No second registry, queue, Canonical store or replacement
runtime is introduced.

## Decision

Each produced event must declare one or more handoff edges. An edge identifies
the event and compatible version range, a registered consumer module or an
existing runtime authority/intentional disposition, one or more frozen policy
tags, and (when applicable) the existing durability/transaction authority.

The only tags are:

`TRANSACTIONAL`, `DURABLE_OUTBOX`, `DURABLE_JOB`, `RECONSTRUCTABLE`,
`REQUIRED_ACK`, `INTENTIONAL_BEST_EFFORT`, `INTENTIONAL_TERMINAL`.

`REQUIRED_ACK` means that the publisher does not acknowledge its child
publication when that consumer dead-letters. It is independent of durability;
the existing Connector Runtime supplies the acknowledgement behaviour, while
the selected transaction/outbox/job authority supplies persistence and replay.
Registry metadata never proves that persistence exists.

`RECONSTRUCTABLE` requires explicit replay-source, deterministic-identity and
idempotency-evidence metadata. Durable/transactional tags require an explicit
existing authority reference. Intentional dispositions require owner,
retention and observability metadata (including best-effort consumer edges);
terminal disposition is not a consumer.

## Runtime validation boundary

`ModuleRegistry.start()` validates handoffs after event routes are registered
and before any module is initialized. It proves only facts available at the
registry boundary:

- every declared producer event has at least one handoff;
- the handoff event is producer-declared and its range is compatible;
- tags are known, unique and policy-compatible;
- a consumer target exists, declares the event and has a registered handler;
- every `REQUIRED_ACK` consumer edge has a handler marked
  `requiredForPublisherAcknowledgement: true`;
- the reverse mapping also holds: every handler with that flag has a matching
  `REQUIRED_ACK` edge;
- intentional dispositions cannot be used as required consumers;
- reconstructable and durability metadata is structurally complete.

Contract/integration tests, not this registry, prove PostgreSQL/outbox/job
durability and replay behaviour.

## Frozen handoff matrix

| Producer event                   | Target/disposition                          | Tags                                | Existing authority/evidence                                                 |
| -------------------------------- | ------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `PongEvent`                      | `stage1.pong`                               | `INTENTIONAL_BEST_EFFORT`           | Stage 1 read-model activity; reliability dead-letter/replay tests           |
| `IntakeAccepted`                 | `stage2.original-asset`                     | `INTENTIONAL_BEST_EFFORT`           | Existing intake trace/audit; no new required edge                           |
| `OriginalAssetStored`            | `stage3.transformation`                     | `RECONSTRUCTABLE`                   | SourceVersion/original asset replay identity and transformation idempotency |
| `DocumentTransformed`            | `stage3.evidence`                           | `RECONSTRUCTABLE`                   | Transformation revision replay identity and Evidence idempotency            |
| `EvidenceIndexed`                | `stage4.candidate-generation`               | `DURABLE_JOB`                       | Existing Stage 4 continuation job                                           |
| `CandidateGenerated`             | `stage4.validation`                         | `DURABLE_JOB`, `REQUIRED_ACK`       | Connector durable job/dedup state; existing required flag preserved         |
| `CandidateMaterialized`          | `stage4.ai-provider`                        | `DURABLE_JOB`                       | Provider-call state repository                                              |
| `CandidateMaterializationFailed` | `stage4.ai-provider`                        | `DURABLE_JOB`                       | Provider-call state repository                                              |
| `CandidateValidated`             | `stage4.candidate-generation` status update | `REQUIRED_ACK`                      | Claim Candidate status owner                                                |
| `CandidateValidated`             | `stage5.comparison`                         | `REQUIRED_ACK`                      | Comparison handler                                                          |
| `CandidateRejected`              | `stage4.candidate-generation` status update | `REQUIRED_ACK`                      | Claim Candidate status owner                                                |
| `ComparisonCompleted`            | `stage5.change-set-review`                  | `REQUIRED_ACK`                      | Review handler                                                              |
| `DraftChangeSetReady`            | explicit terminal disposition               | `INTENTIONAL_TERMINAL`              | Review owner/retention/audit                                                |
| `ReviewDecisionRecorded`         | explicit terminal disposition               | `INTENTIONAL_TERMINAL`              | Review owner/retention/audit                                                |
| `ChangeSetApproved`              | `stage6.canonical-knowledge`                | `TRANSACTIONAL`, `REQUIRED_ACK`     | Canonical commit transaction                                                |
| `CanonicalCommitted`             | `stage7.projection-search`                  | `DURABLE_OUTBOX`, `RECONSTRUCTABLE` | Canonical outbox; commit replay identity                                    |
| `CanonicalCommitted`             | `akp-4.discovery-trigger-coordinator`       | `DURABLE_OUTBOX`, `REQUIRED_ACK`    | Canonical outbox and Discovery coordinator                                  |
| `ProjectionReady`                | explicit terminal disposition               | `INTENTIONAL_TERMINAL`              | Projection watermark/readiness audit                                        |
| `DerivedInferenceReady`          | explicit terminal disposition               | `INTENTIONAL_TERMINAL`              | Compiled-truth lifecycle audit                                              |
| `ActionFeedbackRecorded`         | existing Action feedback runtime            | `DURABLE_OUTBOX`                    | ActionExecution feedback boundary; no WP-10 consumer                        |

`DiscoveryFindingReadyV1` remains published by the Discovery runtime rather
than a registered Shotgun Module; its re-entry contract and durable source are
not duplicated in this registry. No consumer is invented for terminal events.

## Required acknowledgement strengthening

In addition to the existing `CandidateGenerated → stage4.validation` edge,
the following handlers are required acknowledgements:

1. `CandidateValidated → stage4.candidate-generation` status update;
2. `CandidateRejected → stage4.candidate-generation` status update;
3. `CandidateValidated → stage5.comparison`;
4. `ComparisonCompleted → stage5.change-set-review`;
5. `ChangeSetApproved → stage6.canonical-knowledge`.

`CandidateValidated` therefore has two separate edge rows. A failure in the
status synchronizer cannot leave a Claim Candidate in `PENDING_VALIDATION`
while validation has already acknowledged success.

## Verification and rollout

WP-07 adds focused manifest/registry tests for completeness, invalid tags and
ranges, per-edge route resolution, bidirectional required acknowledgement,
reconstructable metadata, and intentional disposition rules. Existing
Connector reliability, Stage 4 continuation, Canonical outbox and Discovery
re-entry tests are reused for runtime proof; they are not cloned.

The rollout is additive: deploy the manifest contract and registry checks with
all producer manifests updated, then enable the strengthened handler flags.
Startup fails closed on an incomplete or contradictory handoff. Rollback is a
code/manifest revert to the previous exact commit; no data migration is
needed, and existing outbox/job/dedup rows remain valid. A replacement runtime
must implement the same handoff and acknowledgement contracts before adoption.

## OSS and reference decisions

- gbrain: `REFERENCE_ONLY`; its job/event patterns informed the inventory, but
  no runtime or database IDs cross the Module SDK boundary.
- lucasastorian/llmwiki: `REFERENCE_ONLY` for transformation/evidence replay
  patterns; no SQLite/FTS/VaultFS runtime is introduced.
- ddsyasas/llm-wiki and Inkeep OpenKnowledge: `REFERENCE_ONLY` for UX and
  activity patterns; no backend or second event registry is adopted.
- PostgreSQL/Connector durable state, Canonical outbox and existing Stage 4
  continuation remain the verified authorities from ADR-154/ADR-155.
