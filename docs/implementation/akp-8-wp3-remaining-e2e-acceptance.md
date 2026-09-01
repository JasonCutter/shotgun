# AKP-8 WP3 Remaining End-to-End Acceptance Evidence

Status: `CANDIDATE / CORRECTION_VERIFIED_LOCALLY` — local acceptance proof is
green after the N06 remediation and the H/J/K/O correction evidence. The final
exact-head GPT review and automatic PR CI are still required.

Repository: `JasonCutter/shotgun`

Canonical baseline: `71920f4bc9f0815a8aae251a898bf5af723140c5`

Working branch: `codex/akp-8-wp3-remaining-e2e-acceptance`

## Scope and boundary

This package addresses the six WP3 scenarios authorized by the AKP-8
directive:

- `E`: durable restart/reclaim, FindingReady publication, lifecycle history,
  and duplicate-free durable finding persistence.
- `H`: common-scope and highest-sensitivity enforcement across the Product
  Search, Discovery, Graph, Review, Activity/Attention, and Feedback surfaces.
- `J`: the actual Discovery `ACTION_SUGGESTION` handoff remains a governed
  candidate and cannot execute through the External Action authority.
- `K`: Canonical graph relations remain authoritative while
  `APPROVED_TYPED_EDGE` and Discovery-derived relations remain non-Canonical.
- `N`: source eligibility change, semantic rebuild parity, safe generation
  retention, vector reuse, active retrieval, and Canonical/audit nonmutation.
- `O`: exact embedding/Discovery resolver pins, provider policy, credential
  authority, fail-closed privacy, and data-only AI output handling.

Accepted scenarios `A/B/C/D/F/G/I/L/M/P` are reused and not duplicated. This
package adds no schema migration, vector store, queue, scheduler, lockfile
change, live provider call, Canonical write path, Approval path, or External
Action capability.

The package does not declare AKP v1, AKP-8, or any Stage complete. Final
closure, PAC/AC disposition, Critical/High closure, and GPT exact-head review
remain outside this bounded WP3 candidate.

## N06 gap confirmation and authorized remediation

The GPT correction review confirmed:

`N06 = CONFIRMED MISSING_PRODUCT_CAPABILITY`.

No new ADR was required. The remediation is bounded by existing ADR-135 and
ADR-142 Product semantics: `SemanticGenerationBuilder` now owns the
server-owned retention decision and calls the existing
`SemanticIndexRepositoryPort.deleteGeneration` primitive. Normal application
composition already instantiates this builder; no new retention subsystem,
worker, scheduler, outbox, queue, or table was introduced.

Retention rules implemented in the builder are:

1. `pruneBefore` is an explicit server-owned cutoff; it is not browser input
   and no fixed 7/30-day or N-generation policy is embedded.
2. Active generations and `BUILDING` generations are always protected.
3. The newest inactive `READY` generation compatible with the active source,
   Canonical base, and current embedding execution identity is the rollback
   target and is protected.
4. Generations at or after the cutoff are protected.
5. If no safe rollback target can be established, old generations are
   retained rather than deleted.
6. Physical deletion uses the existing generation delete so PostgreSQL's
   generation foreign key cascades its semantic items atomically. The active
   pointer foreign key remains `ON DELETE RESTRICT`.
7. A pointer change detected between validation and deletion causes bounded
   skips; the implementation never force-deletes or destructively retries.
8. Canonical, Evidence, audit, Discovery, Review, and History state is not
   mutated by pruning.

## Existing OSS review and integration decision

No new OSS runtime is introduced. The reviewed registry and role matrix remain
authoritative:

| Candidate            | Official repository                      | Fixed review pin                           | License          | WP3 decision                                                          |
| -------------------- | ---------------------------------------- | ------------------------------------------ | ---------------- | --------------------------------------------------------------------- |
| `gbrain`             | https://github.com/garrytan/gbrain       | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT              | `REFERENCE_ONLY`                                                      |
| `llmwiki`            | https://github.com/lucasastorian/llmwiki | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0       | `EXTRACT` only in the previously audited conversion/evidence boundary |
| `llm-wiki`           | https://github.com/ddsyasas/llm-wiki     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT              | `REFERENCE_ONLY`                                                      |
| Inkeep OpenKnowledge | https://github.com/inkeep/open-knowledge | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | `REFERENCE_ONLY`                                                      |

These references do not own Shotgun Canonical, Evidence, Approval, Action,
Finding lifecycle, semantic active membership, or provider policy semantics.
No reference runtime or database model is imported here. The implementation
uses the existing Shotgun Port/Adapter boundaries; the relevant decision for
the new retention capability is `NO_RELEVANT_OSS`.

## Implemented evidence

### E — durable restart/reclaim and FindingReady

`tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts` uses two
real PostgreSQL runtime repositories and the production
`PersistentDiscoveryWorker`. It simulates lease expiry, reclaims with a higher
fencing token, completes all seven stages, publishes exactly one durable
Finding and FindingReady record, records lifecycle history, releases the
lease, and returns `IDLE` on the next run.

### H — production security and product-surface handoff

The existing production PostgreSQL causal acceptance in
`tests/database/akp-8-wp2-cross-section-causal-acceptance.database.test.ts`
is reused for the actual Product/Review/Feedback/Activity handoff. It
composes the production source, Discovery worker, semantic Search, Product
read coordinator, Review coordinator, Feedback coordinator, and Discovery
Activity adapter. It proves common access scope and sensitivity are
server-derived and that Feedback/Attention changes do not mutate Canonical.

The actual PostgreSQL Product read acceptance in
`tests/database/frontend-knowledge-product-read-postgres.test.ts` additionally
proves authorized Search visibility and absence of foreign-project,
no-common-scope, and over-clearance (`restricted`) matches. The actual Graph
adapter acceptance in
`tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts` proves foreign
project, scope-denied, and over-clearance nodes and edges are absent. The WP3
Discovery Product negative remains bounded to its actual coordinator/source
contract. No browser-provided project or authority value is promoted.

### J — actual candidate-only Action chain

`tests/database/akp-8-wp3-final-acceptance-correction.database.test.ts`
exercises the actual chain:

`DiscoveryAIGenerationService → durable ACTION_SUGGESTION Finding/FindingReady → DiscoveryReentryConsumer → validation → persisted Derived candidate → DiscoveryReviewMaterializer → ACTION_CANDIDATE`.

The final External Action authority is not called and no Action execution
manifest, approval, preflight, or attempt is created. The WP3 integration test
also preserves adversarial generated text as data, keeps the governance target
candidate-only, and verifies no provider object exposes `execute` or
`callTool`.

### K — source-aware Graph authority

`adapters/frontend-knowledge-graph-postgres/compiled-truth-graph-read.ts`
now maps the persisted Compiled Truth source explicitly:

- `CANONICAL_RELATION` → `CANONICAL_RELATION`, `CANONICAL`, provenance
  `CANONICAL`.
- `APPROVED_TYPED_EDGE` → `DERIVED_INFERENCE`, `DERIVED_INFERENCE`, provenance
  `COMPILED_TRUTH`.
- Canonical claim nodes remain Canonical; approved Knowledge nodes are
  `DERIVED_INFERENCE` projection nodes.
- Discovery relations remain `DISCOVERY_CANDIDATE` overlay edges.

The WP3 Graph acceptance uses the production adapter and Graph read domain for
both mappings and proves foreign, scope-denied, and restricted resources are
filtered before edges are returned. The actual PostgreSQL Product Workspace
acceptance runs after a Discovery job and proves the Workspace/Search
authority contains only normal Canonical/Approved/Compiled/Derived resources;
a Discovery finding is never promoted by score. Existing Canonical relation
contract tests remain green.

### N — semantic source change, retention, and retrieval

The PostgreSQL N journey uses the real
`PostgresSemanticCorpusSourceSnapshotReader`, real Canonical state and claim
rows, real approved Knowledge groups, `SemanticGenerationBuilder`,
`PostgresSemanticIndexRepository`, and `SemanticRetriever`.

The old source resource is made ineligible through the real source input path
(`knowledge.review_groups` changes from `APPROVED` to `REJECTED`); the source
snapshot no longer contains it while the Canonical snapshot digest remains
unchanged. The sequence then proves:

- incremental and full builds have equal membership digest and count;
- the retained vector is reused and not re-embedded;
- the production prune authority deletes only the old inactive, unprotected
  generation;
- generation deletion removes its semantic items through the existing FK
  cascade;
- active, `BUILDING`, rollback-protected, and cutoff-window generations stay;
- the active pointer is unchanged and active semantic retrieval remains healthy;
- Canonical project state and the audit sentinel are byte-for-byte unchanged by
  prune.

Unit coverage additionally proves no-safe-rollback retention and the bounded
concurrent-pointer-change stop condition.

### O — exact resolver and privacy authority

The correction acceptance uses the actual production policy-backed Discovery
composition: `AskProviderPolicyResolver`,
`PostgresAskProviderPolicyAuthorityReader`,
`ProviderExternalTransferApprovalService`, real project AI configuration and
credential metadata, `EffectiveAIConfigurationResolver`, and
`DiscoveryAIExecutionResolver`. A deterministic provider double is used; no
live provider is used. An unapproved restricted/private transfer fails closed
before provider routing/generation with zero provider calls. The allowed case
asserts the exact project/profile/revision/provider/model/capability/config,
credential, policy-fingerprint, privacy, data-policy, prompt, and output-schema
bindings without exposing secrets in the prompt.

The existing R5 PostgreSQL production-chain acceptance is reused for the real
`SemanticEmbeddingAuthorityResolver` and `SemanticEmbeddingRouter` composition
with a deterministic connectivity adapter. Restricted or unapproved private
context is rejected before provider connectivity/credential execution. The
WP3 correction acceptance records zero provider calls for denied Discovery
generation and keeps generated content in the data-only path.

## Acceptance matrix

| Scenario            | Local evidence                                                                                     | Product repair                                      | Disposition                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| E                   | Real PostgreSQL lease expiry → production reclaim → seven stages → durable Finding/FindingReady    | None                                                | Candidate proof passed; exact-head CI/GPT review pending |
| H                   | PostgreSQL causal Product/Review/Feedback/Activity plus actual Search and Graph security negatives | None                                                | Candidate proof passed; exact-head CI/GPT review pending |
| J                   | Actual PostgreSQL ACTION_SUGGESTION → FindingReady → re-entry → Derived → Review chain             | None                                                | Candidate proof passed; exact-head CI/GPT review pending |
| K                   | Production Graph adapter/domain mapping plus actual PostgreSQL Workspace non-promotion             | Small bounded adapter mapping repair                | Candidate proof passed; exact-head CI/GPT review pending |
| N                   | Real PostgreSQL source change, rebuild parity, prune cascade/safety, active retrieval, nonmutation | Existing-ADR bounded Product capability remediation | Candidate proof passed; exact-head CI/GPT review pending |
| O                   | Production Ask policy/config/credential resolver chain plus R5 semantic resolver/router            | None                                                | Candidate proof passed; exact-head CI/GPT review pending |
| A/B/C/D/F/G/I/L/M/P | Existing accepted evidence reused                                                                  | None                                                | No duplicate testing                                     |

## Verification

Focused N/unit command against the approved local PostgreSQL target:

```text
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5433/shotgun_test'
npx vitest run tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts tests/unit/semantic-generation-lifecycle.test.ts --testTimeout=30000 --reporter=verbose
```

Result: **2 test files passed, 14 tests passed**.

Focused WP3 Graph/AI command:

```text
npx vitest run tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts tests/integration/frontend-knowledge-graph-production-composition.test.ts tests/contract/akp-8-wp2a-canonical-relation-projection.contract.test.ts --reporter=verbose
```

Result: **3 test files passed, 20 tests passed**.

Focused H/J/K/O correction commands:

```text
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5433/shotgun_test'
npx vitest run tests/database/akp-8-wp3-final-acceptance-correction.database.test.ts --testTimeout=30000 --reporter=verbose
npx vitest run tests/database/frontend-knowledge-product-read-postgres.test.ts --testTimeout=30000 --reporter=verbose
npx vitest run tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts --reporter=verbose
```

Result: **correction DB 1 file/2 tests passed; Graph 1 file/8 tests passed;
Workspace/PostgreSQL root test 2 tests passed**. The Workspace command also
discovered isolated `.worktrees` copies in the local checkout; all discovered
copies passed.

The reused actual production causal handoff was also run independently with a
bounded 30-second test timeout:

```text
$env:TEST_DATABASE_URL='postgres://shotgun:shotgun@localhost:5433/shotgun_test'
npx vitest run tests/database/akp-8-wp2-cross-section-causal-acceptance.database.test.ts --testTimeout=30000 --reporter=verbose
```

Result: **1 test passed**. The test is long-running but bounded and needs no
manual CI rerun.

Typecheck and `git diff --check` passed during remediation. Final lint,
format, documentation validation, OSS gate, exact branch diff, push, and
automatic PR CI must be run once after all bounded changes are complete. No
manual rerun, workflow dispatch, no-op rerun, Ready-for-review transition,
merge, or final closure is authorized by this package.

## Change, migration, rollback, and limits

Changed scope is limited to:

- `modules/semantic-generation/src/index.ts`
- `adapters/frontend-knowledge-graph-postgres/compiled-truth-graph-read.ts`
- `tests/unit/semantic-generation-lifecycle.test.ts`
- `tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts`
- `tests/database/akp-8-wp3-final-acceptance-correction.database.test.ts`
- `tests/integration/akp-8-wp3-remaining-e2e-acceptance.test.ts`
- `tests/database/frontend-knowledge-product-read-postgres.test.ts`
- this evidence document

No database migration, dependency, lockfile, generated artifact, external
provider state, or production Canonical state is changed. Test cleanup is
project-scoped and uses the isolated PostgreSQL acceptance target. Rollback is
a normal PR revert; no persisted application-data migration or compatibility
bridge exists.

Known limits:

- This is WP3 acceptance evidence for E/H/J/K/N/O, not the final A–P campaign.
- Local focused tests do not replace automatic CI on the final pushed exact
  head.
- PR #159 must remain open and Draft until GPT exact-head review; it must not
  be marked Ready or merged as part of this package.
- PAC-01..30, Section AC, Critical/High closure, final Product/browser
  campaign, and AKP v1 completion remain separately authorized work.

The next contract handoff is the final pushed WP3 head, automatic CI result,
and this evidence matrix for GPT review. A new Product capability or authority
requirement outside the bounded repairs remains a `BLOCKED_ARCHITECTURE_GAP`.
