# RUS-2-C5 Initial V2 Recompare Product Entry

## Scope

This correction adds the first Product entry for existing `READY` Claim
Candidates. Source Detail now reads a bounded, exact `sourceId` +
`sourceVersionId` candidate projection and offers an independent semantic
recompare action for each candidate when the server reports semantic readiness
and `V2_ACTIVE` rollout.

The browser submits only the existing Candidate identity and a client
idempotency key to the existing `RecompareClaimCandidate@1.0.0` authority. The
server derives Project, Principal, membership, Source security, sensitivity, and
policy context. The candidate read path never exposes provider-call payloads,
access scope, sensitivity, or internal repository identifiers. The action does
not create a fake Review, write Comparison rows directly, or bypass the
existing V1/V2 execution path.

The product gap was that C4 made semantic comparison `READY` and `V2_ACTIVE`,
but existing READY Candidates had no initial Product entry point. The `/review`
route correctly remained guarded until a real comparison produced Review
attention, so a Source Detail action was required.

The C5 correction also records the exact first CI failure. On reviewed head
`0cb92d74b9cf3de5df3b1debce7e34688831f4b1`, CI `34965962023` failed in
`tests/database/comparison-reentry-product-postgres.test.ts`, test
`Stage 5 Product re-entry on PostgreSQL application composition > executes V2 through the authenticated Product route and reuses the persisted lineage before provider execution`.
The assertion expected the Candidate Product GET to return `200` but received
`500`. The fixture supplied an object with only `getProjectSettingValue`; the
Sources Product route's authenticated scope builder also requires
`getSettingsSnapshot`. This was classified as a test fixture/Product
composition fixture defect, not a Product authority defect. The correction uses
the normal `InMemorySettingsRepository` and overrides only its rollout getter.

## OSS integration decision

`NO_RELEVANT_OSS` for the new bounded Product read/action entry and its
server-authority boundary. The existing Shotgun Candidate repository, typed
API client, `RecompareClaimCandidate@1.0.0` command, semantic rollout status,
and Review convergence contract are the required reusable boundaries. No new
package, lockfile entry, license exception, migration, or ADR is introduced.

The four verified references were reviewed before implementation and remain
pattern references only for this correction:

| Candidate            | Repository and pinned review                                                                             | Decision for C5  | Reason                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gbrain               | https://github.com/garrytan/gbrain · `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` · MIT                    | `REFERENCE_ONLY` | Retry/idempotency patterns are informative; its Runtime, DB, and job authority cannot own Shotgun Candidate, Evidence, or Approval semantics.                   |
| llmwiki              | https://github.com/lucasastorian/llmwiki · `ad626a3d81be1480e35ef4e94234de8dbb27a61e` · Apache-2.0       | `REFERENCE_ONLY` | Evidence/reconcile patterns are informative; the extracted locator is unrelated to this Product entry and the upstream SQLite/VaultFS runtime remains excluded. |
| llm-wiki             | https://github.com/ddsyasas/llm-wiki · `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` · MIT                  | `REFERENCE_ONLY` | Action-centered busy/error and source-navigation UX is informative; its backend, storage, and LLM client are not integrated.                                    |
| Inkeep OpenKnowledge | https://github.com/inkeep/open-knowledge · `f2834c237639e2cff603817ed88182b33f83cf91` · GPL-3.0-or-later | `REFERENCE_ONLY` | Review/activity presentation patterns are informative; GPL runtime, Canonical model, and Yjs are excluded.                                                      |

The registry's pinned license, security, and maintenance evidence remains the
source of truth. Any future adoption must introduce an explicit Adapter or
Extract decision with a fixed version, Contract Test, replacement test, and
license/security review.

## Contract and authority boundary

- `SourceCandidateListView@1.0.0` is an exact Source/SourceVersion projection;
  the server masks an unauthorized or mismatched identity as `NOT_FOUND`.
- Candidate output is bounded to `candidateId`, `revisionNumber`, `status`,
  bounded `claimText`, `sourceVersionId`, and `createdAt`.
- The action is available only for Candidate `READY`, selected SourceVersion
  `READY`, semantic status `READY`, and rollout `V2_ACTIVE`.
- The action calls the existing `ShotgunApiClient.recompareCandidate` and
  accepts success only when the response is `V2_ACTIVE`, `v1Executed: false`,
  V2 analysis is `COMPLETED`, and Review is `DRAFT_CREATED`.
- Each candidate has an independent pending guard. A response-loss error
  retains the exact Project/Source/SourceVersion/Candidate identity and the
  same idempotency key in session storage; remount does not auto-execute and a
  user retry reuses that key.
- A successful action invalidates the existing Source, Review, and Home query
  state and links to the normal `/review` surface. No browser field supplies
  Project, Principal, access, sensitivity, AI provider, policy, or rollout
  authority.

No database schema or runtime dependency change is required. Rollback is a
normal branch/PR rollback; existing Source, Candidate, Comparison, Review, and
semantic configuration rows remain durable. The new read projection can be
removed independently because it does not alter Canonical or Candidate
lineage.

## Verification and safety

Focused verification covers:

- two independent READY candidates, exact candidate IDs and distinct keys,
  duplicate-click prevention, success convergence, and normal Review entry;
- response-loss preservation of the exact command identity and same-key retry,
  with no automatic execution after remount;
- bounded Product API projection, server-derived authorization, cross-version
  masking, and rejection of technical/provider/security fields;
- transport response-loss mapping to typed `OUTCOME_INDETERMINATE` while
  preserving the client request key;
- existing V1/V2 comparison, Review, semantic readiness, and stale-flow
  regressions.

Observed focused gates on this branch:

- frontend Source Detail recompare regression: 2 tests passed;
- API client and Sources Product API regression: 28 tests passed;
- `npm run frontend:typecheck`: passed;
- `npm run frontend:test` baseline suite before the new file: 49 files, 376
  tests passed; the new focused file adds 2 passing tests;
- the historical PostgreSQL re-entry regression remains covered, and the
  separate `tests/database/rus-2-c5-initial-v2-product-postgres.test.ts` adds
  the required fresh initial-entry lifecycle. It creates one active Project,
  one Source/SourceVersion, three usable Evidence spans, exactly two READY
  Candidates at revision 1, and starts with `comparison.results_v2 = 0` and
  zero Review V2 drafts. The test uses the Product-returned Candidate list
  identities for both actions; it does not look up Candidate identity from
  PostgreSQL after that read.
- the same fresh flow proves a READY/current deterministic semantic generation
  and `V2_ACTIVE`, pre-action Home has no `REVIEW_DECISION` attention and
  `/review` returns `FEATURE_UNAVAILABLE`, Candidate A returns the exact
  `V2_ACTIVE` / `v1Executed: false` / `COMPLETED` / `DRAFT_CREATED` tuple,
  authoritative Comparison V2 and Review V2 lineage binds Candidate revision,
  Canonical version/digest, and semantic generation identity, and the post-A
  Home projection exposes `REVIEW_DECISION` while `/review` returns `ALLOW`.
  Candidate B then creates its own Comparison V2 and Review V2 draft with a
  distinct key. A same-key A replay returns the duplicate logical outcome with
  exactly two V2 comparisons and two Review V2 drafts, while Canonical version,
  digest, claims, and commit count remain unchanged.
- the repository's exact-head CI `34970226495` for
  `9be4505a9e693e523affce6f499caf722b780d2d` passed Quality (including real
  PostgreSQL DB tests), Frontend, Frontend E2E, and Required Gates. The CI
  included the fresh regression; the local guarded run skips both PostgreSQL
  tests when `TEST_DATABASE_URL` is absent.

The full repository quality, documentation, secret-scan, OSS, frontend build,
and CI-equivalent gates must pass before merge. This PR intentionally stops
before merge and before resuming the live J4 owner journey.

## Limits and handoff

Changed files since the reviewed C5 head are limited to the fixture-only
settings correction in `tests/database/comparison-reentry-product-postgres.test.ts`,
the fresh regression in
`tests/database/rus-2-c5-initial-v2-product-postgres.test.ts`, and this
validation record. No migration, dependency, ADR, Product authority, route
guard policy, Canonical write, or live J4 state changed. The correction is
reversible by reverting the three files; the existing durable data contracts
and runtime remain unchanged.

This is a narrow Product-entry correction, not a declaration that the full
RUS-2 journey is complete. The branch must receive GPT review, pass post-merge
CI on `main`, and then resume the real J4 journey with the already configured
embedding credential. The contract handed forward is
`SourceCandidateListView@1.0.0` plus the existing recompare command and
`SemanticComparisonStatusView`; no Canonical, Evidence, Approval, or Action
authority is transferred to the browser.
