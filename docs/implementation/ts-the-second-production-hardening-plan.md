# TS — The Second: Production Boundary, Reliability & Scale Hardening

Status: PLAN FREEZE CANDIDATE  
Canonical baseline: `main@187d27b364238444912c97747d0b8b8e9249ef8d`  
Tracking issue: #344

## 1. Objective

TS hardens Shotgun for sustained real-world use after v1.0 and The First. It corrects only evidence-backed production-boundary, reliability, cancellation, scale, URL-acquisition, CAS-lifecycle, and transaction-outcome risks.

TS does not create a new approval authority, Canonical authority, truth layer, or automatic Candidate-to-Canonical promotion path.

## 2. Program completion authority

A TS work package is not `COMPLETE / FINAL_AFTER_MERGE` until all applicable checks pass:

1. focused proof and minimum correction complete;
2. exact-head CI PASS;
3. merge to `main`;
4. post-merge `main` CI PASS;
5. local `main == origin/main`;
6. actual desktop shortcut `C:\Users\lhm24\Desktop\Shotgun.lnk` executes the merged main;
7. exactly one listener exists on `127.0.0.1:3000`;
8. `/health` returns HTTP 200 with `status=ok`;
9. readiness is `READY`;
10. relevant recovery/projection runners are `HEALTHY / CURRENT` with no unexpected retryable, terminal, or outcome-unknown work.

TS itself closes only after TS-7 proves the cross-section acceptance path on the final TS main.

## 3. Frozen audit disposition

### 3.1 FIX

| Finding | Disposition | Work package |
| --- | --- | --- |
| PDF word-per-block segmentation | FIX | TS-1 |
| Python document worker timeout/output containment | FIX | TS-1 |
| Discovery lease-loss cancellation propagation | FIX | TS-2 |
| AI provider AbortSignal propagation | FIX | TS-2 |
| Candidate Evidence N+1 read amplification | FIX | TS-3 |
| insecure duplicate URL-fetch path (`NodeSafeUrlFetchAdapter`) | FIX or REMOVE after reachability proof | TS-4 |
| CAS orphan blob lifecycle | FIX | TS-5 |

### 3.2 PROOF_FIRST

| Finding | Disposition | Work package |
| --- | --- | --- |
| remaining raw PostgreSQL transaction surfaces / COMMIT acknowledgement ambiguity | build fault matrix first; correct only RED paths | TS-6 |

### 3.3 NO_CHANGE unless new concrete proof appears

- Discovery feedback PK collision claim;
- removing `runId` from Finding identity;
- adding `NEW -> DISMISSED`;
- rewriting the existing Dismiss split-transaction resolution flow;
- rewriting Candidate resume provider behavior when durable output reuse already applies;
- changing provider budget error accounting from `FINALIZED` to `CANCELLED` without expenditure proof;
- treating JSON-pointer prototype names as a proven production prototype-pollution defect.

### 3.4 ALREADY_FIXED / stale audit report item

- Stage5 `transitionAnalysisRevision` COMMIT ambiguity;
- recovery-harness test classification.

## 4. Work packages

### TS-0 — Baseline & Audit Disposition Freeze

Purpose: freeze this program boundary before Product changes.

Deliverables:
- this plan;
- tracking issue #344;
- disposition matrix above;
- explicit no-change list;
- permanent completion criterion.

Exit condition: plan merged without Product behavior changes.

### TS-1 — Document Format Boundary Hardening

Priority: P0.

Treat PDF segmentation, Python child-process containment, and Python-to-TypeScript mapping as one boundary.

Required invariant:

`1 Python worker block == 1 DocumentIR paragraph`

PDF work must preserve the existing worker whitespace-normalization boundary so a single worker block cannot create multiple TypeScript paragraph nodes through blank-line splitting.

Proof corpus must cover:
- existing `golden.pdf`;
- multiline paragraph PDF;
- multicolumn PDF;
- multipage PDF;
- large valid PDF;
- corrupt PDF;
- encrypted PDF;
- intentionally hanging worker;
- stdout overflow worker;
- stderr overflow worker;
- malformed worker result.

Required worker containment:
- execution timeout;
- stdout byte ceiling;
- stderr byte ceiling;
- single-settlement protection;
- timeout/overflow termination;
- child exit/reap confirmation;
- typed safe failure classification.

Do not accept a paragraph-grouping change that breaks selector determinism or SourceMap round-trip evidence.

### TS-2 — Runtime Cancellation & Lease Hardening

Priority: P1.

Discovery:
- authoritative lease `STALE` / `NOT_FOUND` must abort active work;
- stale work must not publish or persist a result;
- distinguish proven lease loss from transient heartbeat transport error;
- verify lease/fence authority before durable stage completion.

AI provider:
- propagate request deadline/cancellation through runtime -> GenerateStructured -> provider routing -> adapter -> actual SDK/network request;
- late provider completion after cancellation must not become durable authority.

### TS-3 — Candidate Generation Scale Hardening

Priority: P1.

Prove the current Evidence read query amplification, then replace per-Evidence reads with a bounded server-authoritative batch read.

Preserve:
- project scope;
- access scope;
- sensitivity;
- Evidence identity;
- exact text/hash;
- deterministic ordering.

Acceptance must show that Evidence counts such as 10/100/500 do not cause O(N) query count growth at the Candidate generation boundary.

### TS-4 — URL Acquisition Authority Consolidation

Priority: P1.

First prove runtime/import reachability of `NodeSafeUrlFetchAdapter`.

If runtime-dead, remove the legacy adapter and its obsolete direct tests.

If HTML URL-format functionality must remain, share an approved-address pinned transport primitive with the production URL acquisition path while keeping media-type policy separate.

Do not simply delegate HTML format acquisition to `SecureUrlAcquisitionCoordinator` because its current media-type contract differs.

Exit condition: no repository runtime path performs a security pre-check followed by an unconstrained hostname re-resolution through generic fetch.

### TS-5 — Asset CAS Lifecycle & Garbage Collection

Priority: P2.

Do not delete a content-addressed blob directly when a DB write fails; a reused blob may already belong to another SourceVersion.

Prefer a separate maintenance GC boundary over Product write-time reference counting.

Minimum safe flow:
1. scan CAS;
2. mark DB live-set from `asset.original_assets.storage_key`;
3. identify unreferenced candidates;
4. apply grace period;
5. re-check DB authority;
6. move candidate atomically to quarantine;
7. retain for a second safety period;
8. re-check and finally delete;
9. record count/bytes/hash audit evidence.

Required controls:
- dry run;
- backup/restore mutual exclusion;
- stale `.tmp` policy;
- no new Canonical/Product authority.

### TS-6 — Residual PostgreSQL Transaction Audit & Correction

Priority: P1.

Do not start with semantic rewrites.

Enumerate every remaining raw PostgreSQL transaction surface and fault-inject COMMIT acknowledgement loss.

Classify each path:
- `SAFE_ALREADY`;
- `RED_FALSE_FAILURE`;
- `RED_STALE_CONFLICT`;
- `RED_UNSAFE_RETRY`.

Correct only RED paths. Reuse `withSafePostgresTransaction` as the transaction-outcome authority where applicable, with exact durable readback only where needed.

If ADR-169 scope expands, append a dated amendment; do not silently rewrite the original decision.

### TS-7 — Cross-Section Final Acceptance

Run the final TS main through the real owner path:

`Desktop Shortcut -> Source -> document/PDF transform -> Evidence -> AI Candidate -> Comparison/Review -> Canonical -> Projection -> Ask -> shutdown -> desktop restart -> persistence/readback`

Re-run TS-specific fault surfaces:
- large PDF;
- worker hang/overflow;
- lease loss;
- AI timeout/cancel;
- high Evidence cardinality;
- URL DNS change/pinning;
- CAS orphan candidate;
- COMMIT acknowledgement loss.

TS closes only when the final desktop runtime satisfies the permanent completion authority in section 2.

## 5. Non-goals

- broad refactoring unrelated to an evidence-backed TS finding;
- unrelated formatting cleanup;
- approval/Candidate/Canonical semantic redesign;
- silent change to Finding identity/lifecycle authority;
- second URL-security authority;
- second transaction-outcome authority;
- automatic Canonical writes from AI output.

## 6. Execution rule

Execute one work package at a time:

`proof -> minimum design -> implementation -> focused verification -> independent patch review -> exact-head CI -> merge -> post-main CI -> actual desktop acceptance`.

A failed gate stops downstream progression. Historical decisions and rejected alternatives remain recorded; they are not silently overwritten.
