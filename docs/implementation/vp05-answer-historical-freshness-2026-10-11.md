# VP-05 AnswerRun Historical Freshness Correction

Started 2026-10-11; verified 2026-10-12 KST. Base: ADR-173 / Canonical
`23be30072521b99fbe2469e66ee066930985f9b7`.

## Result and root cause

Local implementation and product verification PASS. Canonical publication and
operating activation remain unapproved. This is not completion of all VP-05 or
certification of real AI semantic accuracy.

`PostgresAskWorkspaceProjection.loadConversation` previously constructed every
AnswerRun with literal `stale: false`. Its citation query read stored citations
and Evidence selectors without comparing the cited SourceVersion to the Source's
current version. The same loader serves AnswerRun GET, Conversation, Branch and
selected Workspace. Successful execution and historical freshness were therefore
conflated at the read projection; extraction and current-question selection were
already correct.

## Minimal correction and existing contracts

- Compare actual citation SourceVersion IDs to the highest `version_number` of
  the same Source, using existing `asset.sources`, `asset.source_versions` and
  `evidence.spans`. Do not use project-wide epochs or `created_at` ordering.
- Read citation identity, project ownership, visibility and latest version inside
  the existing REPEATABLE READ / READ ONLY transaction. A run is stale if any
  actual citation is superseded. Unrelated Source changes do not affect it.
- Check cited version and Evidence scopes/sensitivity against server-resolved
  resource authority. Active-project scopes cannot authorize another project.
  Missing/inaccessible citation authority returns NOT_FOUND, without answer text.
  DB errors propagate; there is no error-to-`stale=false` fallback.
- An accessible historical citation whose latest version is inaccessible stays
  historical, without revealing the latest version ID. Current inaccessible
  citations are denied. Existing foreign keys prohibit deleting referenced
  Evidence; they are neither disabled nor changed.
- Single AnswerRun GET checks that run's citations, so an inaccessible different
  turn does not block an independently accessible current answer. Aggregate reads
  fail closed if their returned history contains inaccessible citations; no new
  partial-redaction contract is introduced.
- Preserve stored answer text, citations, SourceVersion IDs, revisions, execution
  state, attempts and provenance. SUCCEEDED remains SUCCEEDED when stale. Existing
  support-state-derived capabilities, export, retry and governed proposal paths
  remain intact; the freshness bit adds no automatic retry or write authority.
- Render the existing freshness bit as an English/Korean historical-answer notice.
  No public schema version, migration, new freshness authority or dependency.

Product diff: PostgreSQL projection 63 lines, existing presentation 5 lines and
localization 4 lines. Add focused PostgreSQL regression tests and extend the
existing UI test for both boolean values. Update three current TS6 v8 files for
coordinates `180 -> 182`, `652 -> 674` and derived caller references. Classification,
evidence grades, validator rules and immutable v2-v7 history are unchanged.

## Verification and evidence

Evidence directory: `C:/dev/artifacts/vp05-answer-freshness-2026-10-11`.

| Verification                                                       | Result                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Actual application + workers + isolated PostgreSQL + Fake Provider | 13/13 PASS (`app-release/result.json`)                                               |
| Reused original product scenarios                                  | 10/10 PASS; three additional read/authority scenarios                                |
| Final read projection, uploaded-source and Ask write DB tests      | 5/5 PASS (`final-read-scope-tests.log`)                                              |
| Unit / Contract                                                    | 1,360 / 775 PASS                                                                     |
| Integration                                                        | 516 PASS, 6 SKIP; live/restart opt-ins not enabled                                   |
| Frontend, with installed pinned frontend tools                     | 394 PASS; typecheck and build PASS                                                   |
| Final browser E2E, separate fresh DB                               | 86 PASS, 6 live-provider SKIP                                                        |
| PostgreSQL full run                                                | Initial 620 PASS, 67 FAIL, 5 SKIP; all nine failing files rechecked: 80 PASS, 2 SKIP |
| PostgreSQL distinct combined outcomes                              | 687 PASS, 5 SKIP out of 692; no remaining assertion failure in rechecked files       |
| TS6 release/inventory/frozen-history verification                  | PASS (`ts6-final-release.log`)                                                       |
| TS6 semantic assertions                                            | 45/45 PASS with local 20-second default timeout                                      |
| Architecture / standalone packages / Stage12 reuse and operations  | PASS                                                                                 |
| Docs governance, formatting, root typecheck                        | PASS                                                                                 |
| Lint                                                               | Exit 0; two warnings in unchanged authentication eslint-disable comments             |
| OSS audit / OSS gate / secret scan                                 | PASS                                                                                 |
| SBOM                                                               | Immutable lockfile SBOM JSON verified, 428 components                                |

Actual flow proved A v1/42 -> answer -> A v2/43 -> old run `stale=true`, new run
`stale=false`, agreement across all four read projections, identical saved history
hash/text/citations/revisions/capabilities, and no false positive from an unrelated
Source revision. Actual GET returns 404 for an ungranted cited-version scope and
500 for injected authority-query failure; neither returns an answer nor calls the
provider. Additional DB coverage includes backdated v2 ordering, sensitivity and
scope denial, inaccessible latest version, preserved FK deletion rejection, and
a readable current turn sharing a Conversation with an inaccessible old turn.

Initial failures and their logs are preserved. Sharing a test DB with the browser
contaminated legacy TRUNCATE fixtures and caused contention. Other failures came
from child-process preload loss, a hardcoded `shotgun_test` parent expectation,
PostgreSQL tool routing and pipe EOF cleanup. Rechecks use the existing network-none
test container, independent databases, guarded PG clients/tools and synthetic
credentials. No production implementation was changed to recover these tests.

The standard local TS6 default 5-second timeout still fails some AST-heavy cases
(final serial run: 36 PASS, 9 timeouts). The 20-second invocation verifies identical
assertions; it does **not** establish standard Required Gates success. Repository
timeouts and CI configuration remain unchanged. Exact-head CI on publication is
still required. Linked installed dependencies also prevent tree-based local SBOM
generation; the separately verified lockfile SBOM must not be described as a fresh
`npm ci` installation proof.

## Reuse, boundaries and rollback

Reused existing [pg](https://github.com/brianc/node-postgres) 8.22.0/MIT,
the pinned [pgvector PG16 image](https://github.com/pgvector/pgvector), transaction helper, SourceVersion
authority, Ask projection/DTO, localization and product acceptance runner.
Existing [gbrain](https://github.com/garrytan/gbrain)
`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`/MIT decision remains
REFERENCE_ONLY; no runtime/DB adoption. SourceVersion/Evidence freshness is a
Shotgun-owned contract. No new OSS implementation or Role Matrix change.

Operating product/authority read-only snapshots preserve all data/catalogs across
207 + 212 tables. Main remains at the approved base; original VP/P0 worktrees,
32 protected files and six stashes are unchanged. Test-generated P0 proof files
are archived separately and restored to their original tracked bytes. Only the
pre-existing isolated test container was started and returned to stopped state.

Real provider calls 0. Operating DB/Authority/Vault/configuration/environment
writes 0. No operating app/worker start, v11/SSC/model/prompt/classification/search
change, frozen experiment resume, Gold-B-7 opening, VP-06, push, PR or merge.

Rollback is a code revert; no DB rollback is needed. Reversion restores the known
historical freshness defect, so it is not a product acceptance success. Remaining
conditions are review/publication authorization, standard exact-head CI and the
separate product/semantic acceptance work. No broader infrastructure work or
architecture experiment is part of this correction.
