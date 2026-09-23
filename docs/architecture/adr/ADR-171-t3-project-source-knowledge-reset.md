# ADR-171 — T3 Project Source Knowledge Reset

- Status: **T3 DESIGN BASELINE — implementation not started**
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
