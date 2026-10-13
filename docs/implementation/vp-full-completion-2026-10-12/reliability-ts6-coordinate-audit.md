# TS-6 current transaction authority reconciliation

Date: 2026-10-12. Mechanical code/contract acceptance under the user's delegated
implementation authority. This is not independent human semantic Gold approval.

## Source delta

The current live AST has 143 candidates and 129 transaction owners, versus the
prior current v8 manifest's 140/126. Three new safe transaction owners are real
source additions:

| Owner                                  | Preserved qualified production grade       | Direct PostgreSQL evidence                                                        |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `PostgresSourceRefreshStore.claimNext` | PORT_INFERRED                              | `claims one job across independent connections and fences duplicate activation`   |
| `PostgresCandidateFrontier.ensure`     | PROVEN, constructed in relation-job caller | `persists empty completeness instead of returning an unpersisted random identity` |
| `PostgresCandidateFrontier.status`     | PROVEN, constructed in relation-job caller | Same case; direct constructed Frontier receiver                                   |

The refresh claim case already invokes a directly constructed adapter. The
Frontier empty-completeness case now invokes an explicitly constructed Frontier
for ensure/status, retaining wrapper/restart assertions. All three approved
relations use DIRECT_BOUNDARY, qualified owner identities and exact test block
names. Generic legacy name matching suggested unrelated tests; none of those
heuristic suggestions was used as current approved evidence.

The 126 existing owners are mapped uniquely by file, class, method and ownership
kind. Every existing qualified reachability grade remains unchanged. Existing
approved regression relations retain their test identities, paths and coverage
kinds; only current source coordinates move. Reconciliation is recorded in
`C:/dev/artifacts/vp-full-completion-2026-10-12/ts6-coordinate-remap.json`.

Current classifications: TX_BOUNDARY 19, PORT_INFERRED 92, NON_TX 14,
TEST_ONLY_OR_DEAD 18, REVIEW_REQUIRED 0. There is one participant and 21 raw
transaction statement sites. Current-source legacy method-name scoring has
116 TX_BOUNDARY, 14 NON_TX and 13 TEST_ONLY_OR_DEAD; this is live legacy scoring,
not the frozen historical scoreboard.

## Exact scope

Only current v8 authority manifest, approved relation coordinates/new direct
relations, derived v8 lineage and explicit current-count test assertions change.
Frozen v2-v7, their hash manifest, historical 87-row reconciliation, base commit,
validator, reachability/evidence resolver, negative rules and timeout limits
remain unchanged. Historical fixtures keep their own recorded 100/120/etc.
counts. No inferred owner is promoted to PROVEN to obtain a passing Gate.

The standard v8 builder verifies frozen hashes, exact current classifications,
bidirectional evidence relations and independent source/test resolution before
writing derived v8. Release verification and the standard audit tests are run
without assertion weakening or timeout expansion. Results are recorded by the
parent alongside combined Required Gates.

The standard audit suite passed **45/45** with one worker and unchanged per-test
timeout limits. v8 rebuild and TS-6 C2 release verification passed; the release
gate independently checks immutable-history hashes, current classifications,
qualified relations and byte-for-byte regeneration. Explicit review-provenance
text was appended to the current manifests and the derivative was regenerated
afterward; no historical approval is represented as approval of a new owner.
