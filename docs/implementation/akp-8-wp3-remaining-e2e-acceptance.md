# AKP-8 WP3 Remaining End-to-End Acceptance Evidence

Status: `CANDIDATE / CI_PASS` — local acceptance proof and automatic PR CI
passed; Draft PR and exact-head GPT review remain required.

Repository: `JasonCutter/shotgun`

Canonical baseline: `71920f4bc9f0815a8aae251a898bf5af723140c5`

Working branch: `codex/akp-8-wp3-remaining-e2e-acceptance`

## Scope and boundary

This package addresses only the six remaining WP3 scenarios authorized by the
AKP-8 directive:

- `E`: durable restart/reclaim, FindingReady publication, lifecycle history,
  and duplicate-free durable finding persistence.
- `H`: common-scope and highest-sensitivity enforcement across Search,
  Discovery, Graph, Review, Activity, Feedback, and risk-bearing handoffs.
- `J`: Discovery `ACTION_SUGGESTION` remains a governed candidate and cannot
  execute without the Action authority path.
- `K`: Canonical graph relations remain authoritative while Discovery-derived
  relations remain candidate overlays and cannot become Canonical by score.
- `N`: semantic resource invalidation/removal, incremental/full rebuild
  equivalence, vector reuse, and nonmutation of Canonical/audit state.
- `O`: provider/credential/privacy authority, fail-closed restricted/private
  egress, and data-only treatment of generated content.

Accepted scenarios `A/B/C/D/F/G/I/L/M/P` are reused and not duplicated. This
package adds no Product capability, no new authority, no schema migration, no
runtime dependency, no lockfile change, and no external provider acceptance.
The fixtures compose existing production repositories, workers, Product
coordinators, graph authorities, semantic generation builder, and provider
policy services.

The package does not declare AKP v1, AKP-8, or any Stage complete. The final
closure campaign, PAC/AC disposition, Critical/High closure, and GPT exact-head
review remain outside this bounded WP3 candidate.

## Existing OSS review and integration decision

No new OSS runtime is introduced. The repository's reviewed registry and role
matrix remain authoritative for the reference candidates:

| Candidate            | Official repository                      | Fixed review pin                           | License          | WP3 decision                                                                  |
| -------------------- | ---------------------------------------- | ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `gbrain`             | https://github.com/garrytan/gbrain       | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT              | `REFERENCE_ONLY`                                                              |
| `llmwiki`            | https://github.com/lucasastorian/llmwiki | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0       | `EXTRACT` in the audited conversion/evidence boundary; no new extraction here |
| `llm-wiki`           | https://github.com/ddsyasas/llm-wiki     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT              | `REFERENCE_ONLY`                                                              |
| Inkeep OpenKnowledge | https://github.com/inkeep/open-knowledge | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | `REFERENCE_ONLY`                                                              |

These references do not own Shotgun Canonical, Evidence, Approval, Action,
Finding lifecycle, semantic active membership, or provider policy semantics.
Their runtime/database code is not imported by this package. The new
test-only cross-module composition has no relevant OSS implementation to
adopt, extract, or augment: `NO_RELEVANT_OSS`.

There is no package or lockfile change. Replacement is therefore the existing
Port/Adapter contract plus the focused acceptance tests; rollback is a normal
branch/PR revert with no persisted application-data migration.

## Implemented evidence

### E — durable restart/reclaim and FindingReady

`tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts` uses two
real PostgreSQL repositories and the production `PersistentDiscoveryWorker`.
It claims a Job with a short lease using a simulated crashed worker, advances a
deterministic clock beyond expiry, reclaims the work with a higher fencing
token, and completes all seven stages. The same path persists exactly one
durable finding and one FindingReady publication, records Job/Run/Attempt
lifecycle history, releases the lease, and returns `IDLE` on the next worker
run.

### H — common security context

`tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts` composes the
production Product discovery read coordinator with Search/Discovery/Graph/
Review/Activity/Feedback target checks. Only the active project, scope, and
authority-matching finding is visible; foreign-project, out-of-scope,
restricted, and authority-mismatch findings fail closed as `NOT_FOUND` and do
not resolve an authoritative target or Activity binding. The real security
composition also proves scope intersection and highest sensitivity, including
cross-project and no-common-scope negatives.

### J — candidate-only Action path

The deterministic provider double is reached only through the existing
`DiscoveryAIGenerationService`. Generated `ACTION_SUGGESTION` data preserves
an adversarial representation as knowledge data, while the proposal,
`DerivedKnowledgeCandidate`, and Review materialization remain
`CANDIDATE_ONLY`. Governance targets are
`ACTION_CANDIDATE_GOVERNANCE`/`ACTION_CANDIDATE`; Review eligibility requires
the existing validation boundary. The provider surface exposes neither
`execute` nor `callTool`.

### K — Canonical versus Discovery graph authority

The real `PostgresCompiledTruthGraphReadAdapter` and graph read domain preserve
the Canonical edge as `CANONICAL_RELATION` with `CANONICAL` authority and a
Canonical relation reference. The Discovery finding is rendered only through
the overlay as `DISCOVERY_CANDIDATE`; the Product detail remains
`DERIVED_INFERENCE`. No generated relation is promoted by score.

### N — semantic invalidation and rebuild parity

The PostgreSQL test uses the production `SemanticGenerationBuilder` and
`PostgresSemanticIndexRepository` with a mutable source snapshot. A superseded
resource is removed from active membership, the retained resource remains
active, and incremental and full rebuilds produce equal membership digest and
count. The retained vector is reused rather than re-embedded. Sentinel rows in
`canonical.project_state` and `project_audit.project_tombstones` are unchanged,
proving that semantic invalidation does not mutate Canonical or audit authority.

### O — provider, credential, and privacy boundary

The integration test denies Discovery privacy transfer before provider routing
and asserts zero provider calls. It also exercises the existing provider
deployment ceiling and external-transfer policy: restricted data is blocked
with `RESTRICTED_CONTEXT_BLOCKED`, and unapproved private data is blocked with
`PROJECT_APPROVAL_REQUIRED`. The AI fixture uses the deterministic provider
boundary and does not require a live third-party call.

## Acceptance matrix

| Scenario            | Local evidence                                                                                         | Product repair | Disposition                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------ |
| E                   | Real PostgreSQL lease expiry → production worker reclaim → seven stages → durable finding/FindingReady | None           | Candidate proof passed; pending PR/CI/GPT review |
| H                   | Production Product coordinator plus real security composition and negative common-scope cases          | None           | Candidate proof passed; pending PR/CI/GPT review |
| J                   | Production AI generation/candidate/Review normalization with deterministic provider                    | None           | Candidate proof passed; pending PR/CI/GPT review |
| K                   | Production compiled-truth graph adapter/domain plus Discovery overlay                                  | None           | Candidate proof passed; pending PR/CI/GPT review |
| N                   | Real PostgreSQL semantic generation/index incremental/full parity and nonmutation sentinels            | None           | Candidate proof passed; pending PR/CI/GPT review |
| O                   | Production provider policy and privacy-before-routing negatives                                        | None           | Candidate proof passed; pending PR/CI/GPT review |
| A/B/C/D/F/G/I/L/M/P | Existing accepted evidence reused                                                                      | None           | No duplicate testing                             |

## Verification

Focused local command, run against the approved local PostgreSQL test target:

```text
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5433/shotgun_test'
npx vitest run tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts --reporter=verbose
```

Result: **2 test files passed, 8 tests passed** — E/N PostgreSQL acceptance
passed and H/J/K/O integration acceptance passed. No Product or architecture
repair was required.

Final local and remote verification:

- Typecheck, lint, format check, docs validation, and `git diff --check`: passed.
- Architecture/OSS integration suites: not required for this package because
  no architecture, runtime, dependency, or OSS registry file changed; the
  repository and automatic CI gates remain authoritative.
- Draft PR #159 automatic run `33524924773` passed on its pushed candidate
  head: Quality/Database, Frontend/E2E, and Required Gates all succeeded. No
  manual or no-op rerun was performed.

## Change, migration, rollback, and limits

Changed scope is limited to:

- `tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts`
- `tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts`
- this evidence document

No production source, schema, migration, dependency, lockfile, generated
artifact, Canonical row, audit row, or external service state is changed by the
candidate. Test cleanup is project-scoped and uses the existing isolated test
database boundary. Rollback is a normal PR revert; there is no data migration
or compatibility bridge.

Known limits:

- This is WP3 acceptance evidence for E/H/J/K/N/O, not the final A–P campaign.
- Local focused tests do not replace automatic CI on the exact pushed head.
- Draft PR must remain open and Draft until GPT exact-head review; it must not
  be marked Ready or merged as part of this package.
- PAC-01..30, Section AC, Critical/High closure, final Product/browser
  campaign, and AKP v1 completion remain for the separately authorized closure
  work.

The next contract handoff is the exact pushed WP3 head plus automatic CI
results and this evidence matrix for GPT review. If GPT identifies a defect,
the branch remains bounded to E/H/J/K/N/O; a new authority or Product
capability requirement is a `BLOCKED_ARCHITECTURE_GAP`, not an implicit repair.
