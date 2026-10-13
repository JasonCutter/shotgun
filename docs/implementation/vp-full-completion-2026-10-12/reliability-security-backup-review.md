# Independent backup and VP security review

Date: 2026-10-12. This review supplements the parent application's isolated
acceptance/recovery evidence; it makes no live AI or operating deployment claim.

## Backup integrity profile review

The new `vp-execution-v2` profile measures all actual `vp` and `vp_global_budget`
base tables, Ask runs/attempts/events/evidence/citations, intake and acquisition
receipts, source progress/refresh journals, credential/configuration revisions,
standing policy and provider-transfer approvals. Migration 130 adds binding
columns/indexes to already measured `vp.relation_provider_calls`; it adds no
omitted table. Profile selection is migration-gated, and each measured row is
hashed in full, including new binding fields. Derived views are regenerated;
they do not replace durable Ledger or execution history.

The parent observed 134 measured tables. This is a specified subset, not an
all-table readback certificate. For example, migration 017 preference command
history and project lifecycle commands, and settings history payload metadata
from migration 032 are outside that subset. Whole-database pg_dump bytes still
include those tables and have a separate dump SHA-256. A dedicated global
authority database needs its own backup/restore evidence; an empty copy of its
schema inside the workload database is insufficient.

Vault ciphertext may be present in the database dump. The external master key
is excluded and must be available through the existing key authority before
restored credentials can be used. `secretsIncluded=false` is not a statement
that encrypted Vault rows are absent. No secret or operating Vault was read by
this review.

Historical `shotgun-backup-v1` manifests without `integrity.profile` continue
to select the original `legacy-v1` measured-table subset. They are not relabeled
as full VP verification. Current profile manifests select their migration-bound
current set. Unsupported profiles previously passed bundle verification and
failed later at restore; the minimal correction now rejects them in
`readManifest`, so owner automatic bundle verification cannot certify an
unsupported profile. Exact table-set validation remains at restore as before;
historical fixtures were not retroactively changed.

Backup unit suite **14/14 PASS**, including unsupported profile rejection,
historical absence compatibility, migration gating, dump/asset corruption,
owner/ACL requirements, reset epochs and in-place restore refusal. Reuses
PostgreSQL pg_dump/pg_restore ADOPT and Shotgun's existing backup Port; no new
backup system, format, migration or restore authority.

## VP-09 deterministic safety boundaries

Existing source context is JSON data under a system instruction that marks
Evidence and SourceVersion text untrusted. Provider citation references must
resolve to issued references in the authorized context. Source-only context
cannot invent Evidence citations. Current project membership, sensitivity,
SourceVersion visibility, deployment ceiling and transfer approval are checked
by existing Port/adapter boundaries. AI output is rendered as text, and no
source instruction authorizes an Action or executes a URL/tool.

One concrete final adapter guard defect was found: `eligible=false` blocked
private context, but public/internal context could pass the adapter's final
guard when invoked directly. The service already checked eligibility, so this
was a gap in independent adapter enforcement. The adapter now rejects every
ineligible request before any stream or structured provider call. Private and
restricted restrictions remain; prompt, schema, request identity and policy
rules are unchanged.

Focused fake/no-egress suites:

- Provider policy and stream boundary: **18/18 PASS**, including public,
  internal and private denied eligibility with zero provider calls.
- Preflight authorization: **4/4 PASS**, including masking inaccessible
  SourceVersion/Evidence before provider policy evaluation.
- Citation binding: **13/13 PASS**, including unissued references,
  source-only constraints, malicious-source placement and exact context binding.
- Combined backup/security run: **49/49 PASS** through the sanitized test wrapper.

These tests prove deterministic authorization, payload and citation constraints.
They do not prove an AI model ignores every malicious instruction, answers
semantically correctly or never produces harmful text. The historical single
live canary remains narrow evidence, not a general prompt-injection defense rate.
Parent actual-app project isolation and readback tests complement these adapter
tests. Final real-provider quality and billing are separate evidence gates.

## Preservation and rollback

Both corrections reuse existing Ports and pinned dependencies; no new OSS
runtime or schema was adopted. Unsupported-profile rollback restores the former
reader, with later restore rejection still present. Eligibility-guard rollback
restores the former adapter and would reopen its final-boundary gap. No database
rollback or source-history rewriting is involved. Operating DB/authority/Vault,
frozen corpus/results, Gold-B-7, stash, push, PR and merge were untouched.
