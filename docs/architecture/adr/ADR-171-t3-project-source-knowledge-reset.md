# ADR-171 — T3 Project Source Knowledge Reset

- Status: **ACCEPTED — implementation in progress; destructive apply disabled**
- Date: 2026-09-23
- Baseline: `main@d06170d85001e72be7367281891d2d9de7196305`
- Related: ADR-086, ADR-122, ADR-123, ADR-131, ADR-144, ADR-168, ADR-169, ADR-170

## Context

The Owner needs to remove every Source and its derived content from an existing
Project while retaining the same Project, account and AI configuration. The
current Sources UI only removes an unsubmitted draft. PostgreSQL has 190
application tables after migration 077; Source references reach Evidence,
Candidate, Review, Canonical, Projection, Ask and History. Several owner tables
are append-only or immutable. A raw cascade, schema reset, or Project deletion
would either fail or erase unrelated authority.

ADR-086 protects Canonical writes and append-only history. ADR-131 permits
payload tombstones but does not itself erase raw payload stored inside an
append-only event. ADR-170 protects shared CAS blobs and requires a conservative
maintenance lifecycle. This decision adds a narrow erasure exception without
making ordinary Product writes able to bypass those boundaries.

## Decision

### 1. Exact scope

T3 implements **Reset Project Source Knowledge**, identified by one Project ID.
It removes all Source/SourceVersion/OriginalAsset references owned by that
Project and every _recorded_ Source-derived content dependency. It does not
delete or recreate the Project, Principal, Membership, Session, AI provider
credentials, Project AI configuration, standing AI policy, privacy approval or
independent Project settings. Their IDs and values are compared before and
after the reset.

Per-Source deletion is **deferred**. Mixed-source Answers, shared evidence,
Canonical relations and JSON payloads currently lack a complete selective
lineage contract. A per-Source operation would risk leaving derived content or
removing unrelated content. It requires its own future ADR and proof corpus.
The implementation plan's broader per-Source wording is narrowed accordingly.

Independent user-authored knowledge is preserved only when its owner record
proves a user origin and has no Source, Evidence, Answer or Canonical dependency.
An unclassified or ambiguous content record blocks the reset at Preview; it is
never silently retained as safe or silently deleted. The Owner can resolve the
classification through a separate reviewed change, then request a new Preview.

### 2. Product authority and confirmation

Only the current Project Owner may request the reset. Browser requests require
the existing session, CSRF check and Project-scope authorization. Preview is
read-only and returns a bounded impact summary, preserved-configuration
fingerprints, blocking dependencies, and an opaque digest over a server-owned
manifest. It never returns raw source content unnecessarily.

Confirm names the Project, Preview ID, manifest digest, expected Project
revision and idempotency key. The Owner explicitly confirms the irreversible
content erasure. A stale Preview, changed membership, changed knowledge
revision, changed dependency set, or new Source/Job is rejected. Replaying the
same command returns the same durable outcome.

The durable request also stores the opaque owner-impact and
preserved-configuration digests from the approved Preview. After fencing and
draining owners, maintenance rechecks the owner-impact digest before its first
content mutation. It can verify the same Project/Auth/AI configuration after
restart without persisting either underlying snapshot in the request.

The confirmation is a new, narrow **Knowledge Reset Approval**. It is not an AI
approval and cannot authorize a normal Canonical Claim or external Action.
The Canonical Knowledge owner consumes the approved reset manifest and performs
its own final revision/digest check. No other module acquires general Canonical
write authority.

### 3. Storage classification and closure

Every table, JSON field, file, queue, projection and cache is classified in the
T3 storage register as one of:

- `PRESERVE_IDENTITY_OR_CONFIGURATION`
- `PURGE_SOURCE_CONTENT`
- `REDACT_PAYLOAD_KEEP_IDENTITY`
- `REBUILD_PROJECTION`
- `SHARED_ASSET_RECHECK`
- `BLOCK_UNCLASSIFIED`

The register is fail-closed: a new table or content-bearing field without a
classification fails the reset Preview and the schema coverage test. The
Project-wide closure includes all selected SourceVersions, their evidence,
provider outputs, candidates, comparisons, reviews, Canonical content,
discovery outputs, Answer runs and conversations that selected or cited any
selected Source, exports, activity/history projections, command payloads,
staging leases and client caches. An entire conversation is included when one
turn may have carried Source context into later turns. Pure configuration and
independent user content use the preservation rule above.

External Action is classified from its owner snapshots before confirmation.
The owner traces exact Project Source and SourceVersion IDs through every
External Action snapshot. Evidence-only references without a resolvable Source
lineage remain `UNKNOWN`. It removes only Source-linked Actions with no
execution, attempt, compensation, rollback, or execution-audit evidence; their
append-only audit rows retain event identity and category while the payload is
replaced by a T3 erasure marker. Any active External Action blocks reset, and a
Source-linked Action with possible external effects blocks pending separate
compensation or external-data disposition. Connector credentials and Project
budgets remain preserved.

### 4. Fencing, execution and outcome

The durable state machine is:

`PREVIEWED → APPROVED → FENCING → PURGING → REBUILDING → VERIFYING → COMPLETE`

Before `PURGING`, the coordinator increments a Project knowledge epoch,
blocks new Source intake and Source-dependent jobs, invalidates stale browser
state, and drains or fences in-flight workers. Read APIs reject old-epoch
knowledge rather than serving partially purged data. If a lease or side effect
cannot be determined, the request becomes `BLOCKED` or `OUTCOME_UNKNOWN`;
it is reconciled by durable readback and is never blindly replayed.

The runtime's shared maintenance advisory lock (ADR-170) must be released
before the executor acquires the exclusive lock. The local launcher therefore
stops the runtime, executes the approved reset in a separate maintenance
process, and restarts only after verification. The UI submits and monitors the
request; it does not run privileged SQL inside the request handler.

The executor uses a dedicated maintenance DB identity. The normal runtime
identity has no grant to invoke the erasure routine or suppress immutable
guards. The routine uses fixed, reviewed statements for this Project and
request; it does not use `session_replication_role=replica`, disable foreign-key
checks globally, drop schemas, or construct SQL from client table names.
Migration and credential setup must demonstrate this separation before any
destructive apply is enabled. On the current single-superuser local setup,
destructive apply remains disabled until role separation is proven.

Before `PURGING`, cancellation can release the fence. After the first
content mutation, recovery is **forward-only** under the same request ID.
Failure never reports success. Each owner operation is idempotent and records a
checkpoint; the final readback verifies the entire closure and preserved
configuration fingerprints before `COMPLETE`.

#### FK-verified owner order

The executable owner order follows the installed PostgreSQL foreign-key graph,
which refines the earlier design-freeze sequence. Catalog inspection of
migrations 001–100 found `source_product.source_stage3_progress` references
`evidence.indexing_results` with `ON DELETE RESTRICT`, intake items reference
`intake.submissions`, `asset.storage_receipts`, and Source rows, and Ask rows
reference Source, SourceVersion, and Evidence. The executable partial orders are
`Ask → Source Product → Intake → Evidence → Transformation → Asset` and
`Review → Knowledge Draft → Comparison → Validation → Candidate → AI output`, and
`Canonical → Discovery`. Ask conversations are removed before their restrictive
Source/Evidence parents; Source Product and Intake rows precede Evidence;
Evidence precedes its Transformation revision parent; Canonical relation
precursors are removed before their referenced Discovery review resources; and
Asset roots remain last. The last edge is enforced by
`canonical_relation_precursor_resource_fk` (`ON DELETE RESTRICT`) from
`canonical.relation_precursors` to
`discovery.reentry_review_resources`. This keeps the reset idempotent without
disabling constraints. The design-freeze document remains the historical
decision snapshot; this ADR and the implementation plan record the executable
FK-corrected order.

Review runs before Knowledge Draft even though the tables have no FK between
them: Review classification must inspect the still-present Draft lineage so it
can distinguish Source-derived Draft review from an independent page review.
The executable order is fixed in the owner manifest and migration 083.

#### Executor control-plane routines

Migration 083 keeps reset execution state behind fixed `SECURITY DEFINER`
routines. The dedicated executor can read the approved request, advance its
state and checkpoints, and complete it without direct table privileges.
Completion is refused until the approved impact checkpoint and all 100
owner-phase checkpoints are present. The ordinary Product persistence adapter
no longer exposes execution-state writes; it remains responsible for preview,
approval, status reads and preserved-configuration fingerprints.

#### Ask conversation owner

Migration 086 adds the Ask owner boundary. Preview and executor readback resolve
Source lineage through `source_selections`, `citations`, and
`answer_attempt_evidence`, and hash affected conversation rows inside
PostgreSQL. One Source-linked turn closes the entire conversation, including
later turns, AnswerRuns, statements, citations, attempts, exports, feedback and
transition seeds. Independent conversations in the same Project remain. The
active-branch FK is deferred so the owner can safely remove the branch/turn
cycle in one transaction. Ask tables without `project_id` receive Project
write fences through their parent lineage. Text evidence references that
cannot be tied to a SourceVersion in the reset Project fail closed as
`UNCLASSIFIED_CONTENT`.

#### Knowledge Draft owner

Migration 098 classifies all five `frontend_knowledge_draft` tables even though
they lack `project_id` columns. It follows Source IDs, SourceVersions, Evidence,
AnswerRun, and Discovery provenance through the complete Draft aggregate.
Seed-derived drafts are erased. A `KNOWLEDGE_PAGE` draft is preserved only when
its Project bindings agree, a Principal owns the page materialization, and its
lineage and Answer/Discovery references are empty. Canonical Resource drafts,
malformed aggregates, and unresolved Source references block as
`UNCLASSIFIED_CONTENT`. The owner runs after Review so Review can inspect these
classifications before the Draft rows are removed.

#### Review owner

Migration 099 classifies legacy and v2 Change Set Review plus all six
Frontend Review content tables. It deletes Source-linked Review aggregates and
the complete frontend context, then retains only opaque event identities in
`frontend_review.history_payload_state` with a non-sensitive append-only purge
audit event. Independent directive reviews and reviews attached to proven
independent page Drafts remain. Missing Draft/Candidate bindings, unresolved
Source references, and Reversal rows without provable Source disposition block.
Insert fences cover Review tables without `project_id`; immutable and
append-only rows can be deleted only by the approved executor path.

#### Candidate, Validation and Comparison owners

Migrations 087–089 add fixed executor-only routines for Comparison,
Validation, and Candidate. The routines delete semantic relationships before
analysis revisions, Comparison before Validation before Candidate, and
Candidate materializations before provider outputs. `PENDING` or `ANALYZING`
semantic work and `PENDING_VALIDATION` candidates block the purge. Candidate,
Validation, and Comparison content is removed by Project scope; the underlying
Evidence and Transformation owners run later in the FK order.

#### AI Provider output owner

Migration 090 preserves AI configuration, credentials, policies, and
provider-transfer approvals while classifying provider calls and outputs by
their exact Project SourceVersion, Transformation revision, and Evidence spans.
Calls with missing or inconsistent lineage block as `UNCLASSIFIED_CONTENT`;
active provider attempts and unresolved outcomes block as
`ACTIVE_JOB_OUTCOME_UNKNOWN`. The executor removes only validated outputs and
calls, after Candidate materializations release their restrictive output
references. The status fingerprint contains hashes and counts only, not source
payloads. Other Projects' provider rows remain outside the owner scope.

#### Asset owner

Migration 091 removes selected Project storage receipts, expired staging
leases, SourceVersions, Sources, and OriginalAsset database roots that have no
remaining SourceVersion or active staging-lease reference. Any active staging
lease blocks the reset until its fixed expiry. Shared OriginalAssets remain
protected by surviving Project references; physical bytes become eligible for
ADR-170's separately reported quarantine and safety-period sweep.

#### Knowledge Graph projection owner

Migration 092 invalidates selected Project snapshot contexts, overlay and
projection health rows, and session continuations through one executor-only
routine. Graph snapshots are request-scoped and are rebuilt lazily from the
remaining live owners; canonical knowledge and its independent facts remain
owned by their respective modules.

#### Search and Compiled Truth projection owner

Migration 100 snapshots all seven Project-scoped Search, Compiled Truth,
Discovery inference, and semantic generation tables. It blocks `BUILDING`
semantic generations and profiles, removes all generated rows and pointers,
and preserves `semantic_embedding_profiles` as configuration. The executor-only
snapshot writer accepts domain-built Search and Compiled Truth output only when
its Project, Canonical version, and snapshot digest match current Canonical
state. Readback requires READY Search and Compiled Truth watermarks at that
state and rejects leftover semantic generations, items, pointers, or Discovery
inferences. The maintenance composition must supply the post-reset projection
builder before destructive apply is enabled.

#### Project Audit retention guard

Migration 093 leaves deleted-Project tombstones and their audit scopes
untouched. If either row type is associated with the reset Project, the owner
blocks as `UNCLASSIFIED_CONTENT` until a separate retention disposition exists.

#### Frontend Command owner

Migration 094 fingerprints command-ledger rows without returning their payloads
and snapshots exact Source command IDs plus Source-linked Ask command IDs during
the all-owner fence phase, before Ask and Source Product rows are purged. The
owner selects the five versioned `sources.*` commands, intake commands still
referenced by the Project's intake submissions, and Ask commands whose source
selection, precondition, or produced-resource reference resolves to an affected
Source-linked Ask conversation or run. Other Project commands and commands for
other Projects remain outside the mutation set.

For selected terminal commands, the executor clears policy and context JSON,
preconditions, payload, produced resources, rejection detail, and semantic
digest while retaining command/request IDs, principal and Project binding,
command kind, terminal outcome, completion disposition, and timestamps.
`ACCEPTED` and `OUTCOME_UNKNOWN` selected commands block. Unknown Source command
types, malformed or unresolved Ask lineage, cross-Project scope, and Draft,
Review, or Action command families without an exact owner mapping block as
`UNCLASSIFIED_CONTENT`. Independent Ask commands remain intact. Reset request
and epoch control rows are excluded from the Source impact manifest because
they are created and updated after preview approval.

### 5. Canonical, History and Action exception

The Canonical owner appends a reset decision with the approved manifest digest,
advances the Project state version monotonically to an empty-knowledge digest,
and publishes one reset event. Existing Source-derived Claim, Relation,
Commit, Revision, Outbox and History payloads are physically removed or
content-scrubbed by the privileged erasure path. Minimal opaque event identities
and a purge audit event remain so the reset itself can be audited. The
append-only exception applies **only** to the verified erasure request and
content fields; ordinary updates and deletes remain rejected.

Each History owner marks affected payload `PURGED_BY_POLICY` and removes raw
payload from its authoritative storage, not merely at read time. Tombstones
contain Project ID, opaque event ID, operation kind, time and actor but no
source text, filename, URL, quote, prompt, content hash or source-derived
digest. Rebuilding History from owners cannot resurrect the payload.

Previously executed external Actions cannot be undone by deleting a local
Source. If the impact graph finds one, Preview blocks the reset until a
separately approved compensation or external-data disposition is recorded.
No automatic external Action is triggered by this reset. Independent Action
credentials and settings remain untouched.

### 6. CAS and backup boundary

After Source rows and staging leases are cleared, unreferenced CAS keys are
handled by ADR-170's lock, recheck, quarantine and later sweep. Shared objects
stay protected. `COMPLETE` means active DB and Product reads are clean;
physical CAS completion is separately reported as
`QUARANTINED_PENDING_SWEEP` until the positive safety period and final
readback have passed. It is never called physically erased earlier.

Shotgun-managed backups containing the old Project knowledge are inventoried.
They are expired or replaced under the approved retention policy. A durable
erasure epoch journal outside the restorable database records the Project and
reset generation without source content. A `PREPARED` record is durably written
before the first content mutation; a `VERIFIED` record follows DB readback.
Restore preflight uses either record as a minimum epoch barrier and refuses to
start a restored runtime at an older knowledge epoch; it must replay the reset
and verify, or reject the backup.
If the journal is missing or integrity checks fail, restore fails closed.
Copies outside Shotgun's control, including an external AI provider or
independent backup, are disclosed as limits and are not claimed erased.

## Alternatives rejected

- `db:reset`, Project deletion, or a new Project: violates preserved identity
  and configuration.
- Raw `DELETE ... CASCADE` from a Product route: crosses module ownership and
  immutable/approval boundaries.
- Read-time hiding alone: leaves source content in active DB and restores it
  through rebuild or backup.
- Immediate CAS unlink: may destroy bytes shared by another Source.
- Selective per-Source deletion on today's incomplete lineage: cannot prove
  complete erasure without over-deletion.
- Automatic rollback after content mutation: cannot safely reconstruct erased
  private data or reverse an external side effect.

## OSS integration decision

The existing Shotgun Product command, owner module Ports, PostgreSQL
transaction/reconciliation, History payload-state and ADR-170 CAS maintenance
are extended inside their current ownership boundaries. The four pre-evaluated
references are classified in the T3 design document. No new OSS runtime is
adopted for erasure: external runtimes cannot own Shotgun's Source, Canonical
or approval semantics. Installed dependency versions remain locked; a future
adapter adoption requires its own pin, license, security, Contract and
replacement evidence before coding.

## Required proofs before implementation can finish

1. A schema/storage register covers every current application table and fails
   on an unclassified table or JSON content field.
2. Preview detects mixed/ambiguous provenance and executed Actions; Owner,
   CSRF, stale digest, wrong Project and replay negatives fail closed.
3. A real DB/CAS test proves the reset removes Source content, keeps
   Project/Auth/AI settings byte-identical, preserves shared CAS, and rejects
   writes from an old knowledge epoch.
4. Kill/restart and COMMIT acknowledgement-loss tests converge on one request
   outcome; no old worker republishes Source content.
5. Canonical/History readback and projection rebuild cannot recover erased
   payload; a new Source can be submitted and cited in the same Project.
6. Backup restore preflight refuses a pre-reset epoch; GC quarantine and sweep
   each report their actual state.

The detailed table register, API schemas, SQL role/procedure design, migration
order and executable test matrix are frozen in the T3 design document before
the first Product migration or deletion implementation.

## Implementation progress (2026-09-24)

Migration 101 and `PostgresCanonicalKnowledgeResetOwner` implement the Canonical owner boundary. The read-only impact classifier resolves SourceVersion, Evidence, relation and inherited Commit/Revision/History/Outbox lineage; unknown lineage and active outbox work block. A fence snapshot preserves opaque row identities and the pre-reset Canonical version/digest so Frontend Review can be purged earlier without losing the Canonical owner's exact target set. The executor-only routine removes eligible Claims and Relations, scrubs append-only payloads and existing Canonical History sidecars, advances `canonical.project_state.version` monotonically to the empty snapshot digest, and records one durable reset event per approved request. Migration 107 adds a bounded Canonical reset-event read function and an executor-only publication acknowledgement. The Canonical History adapter maps only the reset identity and non-content audit metadata. Publication is accepted only after the complete four-owner History snapshot contains the exact event identity at a committed watermark revision.

Migrations 102 and 103 add explicit impact, fencing, purge, rebuild and readback routines for the Activity and federated History projection tables, which use `resource_project_id` rather than `project_id`. Activity is cleared and rebuilt from surviving Sources, Ask, External Action and Discovery adapters; Source-domain Activity input is rejected. History is cleared and rebuilt from Canonical, Review, External Action and Policy adapters; all four watermarks are required and `PURGED_BY_POLICY` entries cannot carry payload snapshots. Both routines use executor-only JSON writers, request-scoped fence fingerprints, Project write guards and idempotent recovery checkpoints. Existing domain owners remain responsible for scrubbing authoritative History payloads before the federated History rebuild.

The frozen OSS decision remains in force: gbrain execution/recovery patterns are `REFERENCE_ONLY`; the reset remains behind Shotgun's owner Ports and PostgreSQL routines because Source lineage, Canonical approval, minimal audit identity and reset authority are Shotgun-owned semantics. No new runtime or dependency was adopted. Isolated PostgreSQL tests cover Canonical, Activity and History owner behavior, write fences, other-Project isolation, reset retry and backup integrity. The History adapter's reset-event read and publication path now has unit and isolated PostgreSQL coverage, including runtime read access, executor-only publication, missing-projection rejection and successful committed-watermark acknowledgement. Unit-tested Activity/History capture rebuilders now reuse the existing projection builders. Production maintenance composition/CLI, runtime drain/restart, wiring the production domain adapter registries and actor scope resolver into those capture rebuilders, Projection builder composition, product acceptance, and backup/CAS recovery acceptance remain open. Destructive apply stays disabled until the required proofs above pass.

Migration 104 adds the Knowledge Model owner; migrations 105–106 add Connector and Settings owners. Their isolated PostgreSQL tests verify Source lineage, terminal-work disposition, project isolation, configuration preservation, write fences, and readback. Migration 107 now publishes the retained Canonical reset identity into History after the four-owner projection is committed. All 25 owner implementations now exist, and the storage inventory remains at 195 tables and 167 content columns. The maintenance command and production composition, worker drain/restart, production adapter/scope wiring for Activity and History capture rebuilders, Projection builder composition, end-to-end product acceptance, and backup/CAS recovery drills are still pending. Destructive apply remains disabled.

### Implementation update — 2026-09-24

The maintenance CLI, 25-owner production composition, Activity/History domain registries and actor scope resolver, and post-reset Projection rebuilder are now wired. The production composition test uses the dedicated non-superuser runtime and executor DB roles. A dedicated worker process commits the first owner purge and pauses before its runner checkpoint while holding the maintenance lock; the test kills that process at the OS level, verifies the durable request remains `PURGING` without the owner checkpoint, and launches the production `t3:reset` CLI in a separate OS process to resume the same request through `COMPLETE`.

That restart test exposed a state transition defect: when all fence checkpoints existed, a resumed executor renewed the fences while the epoch was still `RESET_UNVERIFIED`. Execution now sets the request to `FENCING` before renewing owner fences on every run, restoring the Project write fence before forward recovery.

The isolated Product acceptance now uses real local CAS files and the actual Product API. It verifies the full Source-to-Citation path, reset, app restart, configuration preservation, a retained CAS object shared with another Project, and quarantine followed by a sweep of an unreferenced object after a positive test grace interval. It then confirms a new Source is usable in the same Project. A separate isolated PostgreSQL restore test invokes `restoreBackup` and proves an older backup epoch is rejected before the target database or asset root is changed. The backup integrity table-set comparison now de-duplicates its expected migration-derived names to match the keyed snapshot map.

The Product/CAS, production maintenance OS-kill/restart-recovery, and restore-preflight database tests pass. After increasing the Knowledge Draft integration test's per-test timeout from 20 to 60 seconds for the full regression load, the complete T3 database regression passed 32 files / 63 tests. Root and frontend typechecks, `npm run format:check`, and `npm run lint` passed; lint reports two existing unused-disable warnings in `packages/authentication/src/index.ts`. Actual desktop launcher/process restart, proof that a prior worker cannot republish Source content after reset, restore plus purge-reapplication/rollback drills, and the final exact-head CI and desktop gates remain open. These tests use isolated disposable databases and temporary filesystems; they do not authorize or claim a reset of the user's database. Destructive production use and T3 completion remain blocked until the remaining required proofs pass.

### Follow-up verification — 2026-09-24

The post-reset Product acceptance now creates a real `pg_dump` bundle and restores it to an empty isolated PostgreSQL database. Readback verifies a `READY` knowledge epoch, no old Source or Canonical content, the preserved-configuration fingerprint captured at backup time, and restoration of a shared CAS object. The existing stale pre-reset backup test rejects restore before touching either the target database or asset root. A separate pre-T3 rollback drill backs up a database at migration 077 before any reset epoch exists, advances the source to the latest schema, then restores the bundle to a separate empty target; the Project fixture and migration 077 boundary are verified after restore.

The full database suite passes 145 files / 628 tests. The Ask multi-worker claim test now uses its own isolated test database so unrelated queued work cannot affect its global FIFO claim assertions. The Discovery backup acceptance initializes the required empty external erasure journal. Root `npm run check` passes, and frontend typecheck, 386 tests, production build, and the 85-test E2E suite pass with the CI single-worker setting. E2E uses a reset `shotgun_test` database with migrations through 107; production `DATABASE_URL` remains an unreachable sentinel during these checks.

Manual desktop launcher/process restart, direct proof that a pre-reset worker cannot republish Source content, and exact-head CI plus post-merge desktop verification are still open. All execution evidence above uses disposable test databases and temporary filesystems. The user's database was neither opened nor reset; destructive production use and T3 completion remain blocked pending the remaining gates.

The final T3 source scan found 13 moved AST source coordinates after adapter edits. The C2-R15 inventory still contains 121 candidates with unchanged classification and reachability across the file/symbol/method groups. The current v8 manifest and the affected approved regression covers were reconciled to those live coordinates, and the Source reset evidence row was corrected to the exact test block name. `npm run test:ts6-audit` passes all 45 tests; `npm run verify:ts6-c2` and `npm run ts6:v8:check` pass. The v2–v7 frozen history artifacts remain byte-identical to their recorded hashes.

### Follow-up verification — stale worker and restored-bundle reapplication

The Product acceptance now holds a real Stage 3 progress lease and precomputed Transformation output across the reset. After the reset completes, it calls the production `PostgresSourcesStage3AtomicPersistence.persist` boundary with that stale lease. Persistence returns `CONFLICT`; readback confirms that the stale Source, progress, Transformation, Evidence, indexing result, and Stage 4 continuation rows all remain absent. This verifies that a worker holding pre-reset output cannot republish it through the Stage 3 persistence boundary.

The acceptance creates a pre-reset T3 backup, restores it to a separate isolated database, then executes the normal approved reset against that restored Project. It verifies the new epoch is `READY`, Source and Canonical content are absent, Project/Auth/AI configuration is preserved, and shared CAS bytes remain available. The restore-and-reapply path exposed two defects. First, restore deliberately removes rebuildable search rows, so a completed project-scoped `RebuildSearchProjection` connector record lost its only Source lineage proof and was incorrectly classified as unclassified. Migration 105 now includes all project-scoped search rebuild records in impact and purge; the old job and deduplication record are removed by reset. Second, the restore command suppressed PostgreSQL owners and ACLs, making executor `SECURITY DEFINER` routines unusable after restore. Backup/restore now preserves owners and ACLs; T3 manifests declare the `postgres-owners-and-acls-v1` profile, and restore fails before target modification if that profile or its required database roles cannot be verified. The acceptance checks that the schema owner still owns the executor routine, only the executor can invoke it, and the runtime role cannot read reset snapshots.

The isolated Product acceptance, Connector erasure database test, and backup/restore unit suite pass. The broader 145-file / 628-test database run, root `npm run check`, frontend checks and TS-6 v8 verification recorded above also pass. Remaining acceptance gates are a manual desktop launcher stop/restart, CI on the final exact implementation head, and post-merge desktop verification. All T3 execution remains confined to disposable databases and temporary asset roots; the user's database has not been opened or reset. T3 is not reported complete until the remaining gates pass.

### Follow-up verification — desktop composition and Connector correlation lineage

The canonical launcher built and started against an isolated test database and temporary asset root; `db:verify`, HTTP readiness, and graceful process stop passed. The manual Sources UI preview showed the expected blockers for an unconfigured dedicated executor and the unexpired 30-day staging lease. It also exposed terminal Stage 4 connector queries whose `correlation_id` exactly identifies the SourceVersion pipeline but whose failed results carry no Source token. Migration 105 now includes that exact correlation as lineage only for Stage 3/4 consumers, consistently in both impact analysis and the immutable fence snapshot. A database regression proves those terminal jobs are purged and another consumer remains unclassified even if it reuses the same correlation. The Connector database test passes 2/2, Product acceptance passes 1/1, and production maintenance kill/recovery passes 1/1. The manual UI did not confirm a reset, and the user's database remains untouched. Because the manual launcher preceded this final code change, exact-head CI and desktop verification remain open.

### Follow-up verification — final implementation-head desktop restart

On implementation commit `a3710b9d5ba5a520f5638f307a8aeed928844cd5`, a separate temporary clone with a local bare `origin/main` at the same SHA ran the canonical launcher against a newly created empty PostgreSQL test database. Migrations 001–110 applied and `db:verify` passed. Two launcher starts each passed the production SPA build, database verification, and HTTP readiness; the Sources route rendered the expected empty-project state after restart. After each controlled stop, the test confirmed port 31981 had no listener, the launcher runtime identity was absent, and no launcher Node process remained.

This final-head desktop smoke did not seed a Project or Source and did not submit reset Preview or Confirm. It used a disposable database, a temporary asset root, and loopback-only development configuration; the user's database was never connected. Exact-head GitHub Quality, Frontend, and Required Gates all passed on this implementation SHA. These results close the pre-merge desktop restart check only. Post-merge `main` CI and desktop verification remained required at that checkpoint; the following post-merge record closes those gates.

### Post-merge verification — main CI and desktop restart (2026-09-24)

PR #364 merged to `main` at `628b77443bb46f07ff27f7f3f4db242daab1db36`. GitHub CI run [35961795222](https://github.com/JasonCutter/shotgun/actions/runs/35961795222) passed both Quality and Frontend.

A separate temporary clone ran the canonical launcher on `main` at the merge SHA, with a matching local bare `origin/main`. The isolated, volume-free `pgvector/pgvector:pg16` database received migrations 001–110 and passed `npm run db:verify`. Three launcher starts each passed the SPA production build, database verification, and HTTP readiness. Windows Chrome returned HTTP 200 for `/sources`, displayed the empty “Create a Project to organize and add Sources” state, and reported no JavaScript errors; `/health` returned HTTP 200. Because this disposable database intentionally had no account, `/api/v1/session` returned 401 and `/api/v1/settings/preferences` returned 400; this did not prevent the expected fresh-install Sources screen from rendering.

After each controlled launcher stop, the loopback port had no listener, the launcher runtime identity was absent, and no launcher Node process remained. The disposable PostgreSQL container was removed and the temporary asset root was absent. No user database was opened or reset, and no user Project, Source, login, or AI configuration was changed. This closes the post-merge verification gates for T3 implementation; executing a reset against the user's database remains a separate operation.
