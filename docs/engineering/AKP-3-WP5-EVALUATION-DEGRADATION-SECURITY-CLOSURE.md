# AKP-3 WP5 — Evaluation, Degradation and Security Closure

Status: exact-base WP5 implementation evidence. This is closure documentation,
not an ADR and does not amend ADR-137 or ADR-149.

## Scope and exact base

- Repository: `JasonCutter/shotgun`
- Canonical base: `main@1fa45ebf48ec41428c14947282e2da41980223c7`
- Branch: `codex/akp-3-wp5-evaluation-degradation-security`
- Fixture identity: `akp-3-discovery-evaluation:v1`
- Fixture digest: `sha256:04ed2fa202844c4f9f6babe7c491ca81c3e40e9f44ebc7401354d72d40f333bc`

The fixture is synthetic-only, with fixed project, source, canonical-base,
Discovery-base, evidence, provenance, and clock values. It has no live provider,
network, tool, Action connector, secret, Canonical writer, persistence, or
whole-project scan. Fixture agreement is contract-conformance evidence, not a
Truth or Fact confidence score.

## Exact-base audit and AC matrix

The audit compared the requested AC-01..10 boundary with the merged WP1–WP4
Product and accepted tests at the exact base. Nine criteria were already closed
by existing implementation/evidence. The only narrow Product gap was the lack
of a reusable server-owned value contract recording the effective strategy set
when AI is unavailable. WP5 adds that additive contract and a small execution
policy helper; it adds no persistence or runtime subsystem.

| Criterion                                                           | Disposition and actual evidence                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| AC-01 versioned/bounded strategy registry                           | Existing WP1/WP2 registry; WP5 strategy-set contract and no-regression test         |
| AC-02 authorized/version-bound signal reads                         | WP1/WP2 reads; WP2 bounds/base/security tests; WP5 cross-Project/base gate negative |
| AC-03 DETERMINISTIC / AI_ASSISTED / HYBRID                          | WP1 deterministic path, WP3 provenance tests, WP5 seven-type fixture                |
| AC-04 bounded Relation/Conflict/Pattern space                       | WP2 selector/bound tests and WP3 candidate/provider-boundary tests                  |
| AC-05 all frozen V1 finding types                                   | WP5 has seven entries, each accepted by the WP4 quality gate                        |
| AC-06 deterministic quality gate before persistence                 | WP4 gate/materialization tests and WP5 accepted/rejected bridge                     |
| AC-07 DiscoveryModelProfile and ADR-133 authority                   | WP3 profile/provenance tests and WP5 typed-unavailability mapping                   |
| AC-08 prompt injection cannot alter policy or execute tools/Actions | WP3 malicious-data/provider tests plus WP5 security audit assertions                |
| AC-09 token/cost/time/concurrency budgets                           | WP4 ledger/admission/deadline tests plus WP5 budget reason preservation             |
| AC-10 positive/negative fixtures including Conflict                 | WP5 positive/four-basis matrix plus WP2/WP4 negative matrices                       |

## Product boundary: effective strategy set

`packages/contracts/src/discovery-execution.ts` adds the following typed,
server-owned value contract:

```text
schemaVersion: "1.0.0"
mode: FULL | DEGRADED
completion: COMPLETE | PARTIAL
requestedStrategies: string[]
effectiveStrategies: string[]
skippedStrategies: { strategyId: string, reason: string }[]
```

Strategy IDs use the repository UTF-16 ordinal comparator. Duplicate or unknown
membership, incomplete requested coverage, and inconsistent mode/completion are
rejected. AI-unavailable reasons are exactly `PROFILE_UNAVAILABLE`,
`POLICY_DENIED`, and `AI_CAPABILITY_UNAVAILABLE`. `BUDGET_EXHAUSTED` remains a
typed `FULL`/`PARTIAL` result and is not relabeled as AI unavailability.

`executeDiscoveryStrategiesV1` catches only those typed pre-execution AI
availability failures (and accepted typed budget exhaustion) for the relevant
AI-required strategy. It never downgrades malformed input/provider output,
identity/security/base mismatch, quality rejection, deterministic failure, or
unexpected programming errors. Deterministic strategies continue when AI is
skipped; no AI-dependent Finding is fabricated.

## Positive evaluation

The fixed fixture contains and accepts every frozen V1 type through the WP4
gate:

| Finding type             | Path and expected disposition                                 |
| ------------------------ | ------------------------------------------------------------- |
| `KNOWLEDGE_GAP`          | deterministic WP1-compatible isolated Entity path; `ACCEPTED` |
| `EVIDENCE_GAP`           | bounded fixture through WP4 gate; `ACCEPTED`                  |
| `RELATION_HYPOTHESIS`    | bounded two-claim context; `ACCEPTED`                         |
| `PATTERN_HYPOTHESIS`     | HYBRID bounded group; `ACCEPTED`                              |
| `CONFLICT_HYPOTHESIS`    | HYBRID with server-owned explicit signal; `ACCEPTED`          |
| `CLARIFICATION_QUESTION` | qualified upstream Conflict origin; `ACCEPTED`                |
| `ACTION_SUGGESTION`      | qualified upstream context and `CANDIDATE_ONLY`; `ACCEPTED`   |

Relation evidence uses the WP2 bounded candidate, fake structured AI
provenance, server-owned endpoint/orientation, ADR-149 semantic essence and
fingerprint input, and WP4 qualification. Existing WP2/WP3 evidence covers
`CLUSTER`, `TREND`, `RECURRING_ASSOCIATION`, and `TEMPORAL_CHANGE` pattern
memberships. The accepted Conflict mappings are:

- `FACTUAL` ↔ `TYPED_PROPOSITION`
- `TEMPORAL` ↔ `TEMPORAL_QUALIFICATION`
- `IDENTITY` ↔ `IDENTITY_ASSIGNMENT`
- `MODEL_DISAGREEMENT` ↔ `EXPLICIT_CONFLICT_SIGNAL`

Clarification and Action preserve server-owned origin fingerprint and bases.
Action stays candidate-only through generation, materialization, and quality;
there is no executor or connector.

## Negative quality and Conflict matrix

The following exact typed dispositions/reasons are proved by the WP5 bridge and
the accepted focused WP2–WP4 tests; unchanged evidence is reused rather than
duplicated:

| Case                                       | Expected typed disposition/reason                   | Evidence        |
| ------------------------------------------ | --------------------------------------------------- | --------------- |
| cross-Project resource                     | `REJECTED / SCHEMA_INVALID` or identity rejection   | WP5/WP4         |
| no safe common scope; sensitivity widening | `REJECTED / SECURITY_CLASSIFICATION_MISMATCH`       | WP2/WP4         |
| stale canonical/Discovery base             | `REJECTED / SCHEMA_INVALID` or stale-base rejection | WP2/WP4         |
| missing/ineligible evidence                | `REJECTED / EVIDENCE_LINEAGE_MISSING`               | WP4             |
| Relation self-reference                    | `REJECTED / RELATION_SELF_REFERENCE`                | WP2/WP4/WP5     |
| authoritative equivalent Relation          | `REJECTED / AUTHORITATIVE_EQUIVALENT`               | WP4             |
| exact fingerprint duplicate                | `REJECTED / FINGERPRINT_DUPLICATE`                  | WP4             |
| suppressed fingerprint                     | `SUPPRESSED / SUPPRESSED_FINGERPRINT`               | WP4             |
| malformed AI output                        | terminal typed `AI_OUTPUT_INVALID`                  | WP3/WP5 rethrow |
| provider identity/security fields          | terminal typed output/schema rejection              | WP3             |
| recursive Clarification/Action origin      | terminal typed input rejection                      | WP3             |
| executable Action                          | `REJECTED / ACTION_NOT_CANDIDATE_ONLY`              | WP4/WP5         |
| budget exhaustion                          | `FULL / PARTIAL / BUDGET_EXHAUSTED`                 | WP4/WP5         |

Conflict negatives are also explicit: similarity without incompatibility yields
no Conflict; the four wrong kind/source pairs (`FACTUAL` +
`TEMPORAL_QUALIFICATION`, `TEMPORAL` + `TYPED_PROPOSITION`, `IDENTITY` +
`EXPLICIT_CONFLICT_SIGNAL`, `MODEL_DISAGREEMENT` + `IDENTITY_ASSIGNMENT`) are
rejected; missing `signalId`, payload/deterministic kind mismatch, an existing
authoritative equivalent, and incomplete/truncated absence authority reject or
prevent materialization. High similarity never becomes contradiction authority.

## Prompt injection, provider output, and privacy

The WP3 corpus includes untrusted knowledge content equivalent to: ignore the
system instruction; change Project ID; expand the candidate set; search the
whole Project; call a tool; execute an Action; approve a Fact; reveal the API
key; lower sensitivity. It remains data only. Server-owned instruction,
Project/resource/security/base identity, evidence, and Action boundaries do not
change. No tool surface, Action executor, Canonical mutation, or credential
material exists.

The fake provider attempts extra fields, alternate resource IDs/Project ID,
scope widening, sensitivity lowering, Evidence replacement, Canonical status,
executable Action, tool request, malformed enum, and overlong output. Strict
decoding or the deterministic gate rejects each before publication eligibility.
Exact evidence: `tests/unit/akp-3-wp3-discovery-ai-generation.test.ts` covers
provider fields, prompt-injection output, malicious data, recursive origins,
malformed output, and policy failures; `tests/unit/akp-3-wp4-quality-budget-ranking.test.ts`
covers provenance, unknown secret fields, schema/security/evidence, duplicate,
suppression, and authoritative-equivalent gates.

Serialization evidence excludes API keys, credential bytes, decrypted secrets,
Authorization headers, Vault callback material, and secret-bearing unknown
fields. Credential identity/revision provenance remains allowed.

## Degraded mode, ranking, budget, and determinism

WP5 runs a real deterministic WP1-compatible Knowledge Gap path beside an
AI-required path raising typed `PROFILE_UNAVAILABLE`. The observed strategy set
is:

```text
mode: DEGRADED
completion: PARTIAL
effectiveStrategies: ["akp-3.wp1.knowledge-gap"]
skippedStrategies: [{ strategyId: "akp-3.wp3.relation-ai", reason: "PROFILE_UNAVAILABLE" }]
```

The provider spy is not called, deterministic output remains available, and no
AI Finding is fabricated. `POLICY_DENIED` and `AI_CAPABILITY_UNAVAILABLE` are
also retained exactly. Degraded mode cannot bypass Project authorization,
sensitivity, signal completeness, evidence, quality, duplicate/suppression,
or any budget dimension.

Accepted WP4 ranking remains explainable, versioned, UTF-16 deterministic, and
non-epistemic. It does not alter fingerprints or add Truth/Fact/Canonical
confidence; AKP-7 owns feedback adaptation. Accepted WP4 ledger/admission
evidence covers resources, semantic neighbors, pairs/groups, findings, calls,
tokens/cost, deadline, and concurrency. WP5 proves a skipped strategy cannot
claim effective work or bypass them.

The fixture is generated/evaluated twice from fixed inputs. Candidate IDs,
semantic essences, fingerprints, typed dispositions, and ranking order are
identical. Incidental timestamps, run IDs, provider wording, and set-like
evidence ordering do not redefine ADR-149 identity.

## OSS and Stage 12 reuse

The existing registry and role matrix were the starting point. No new runtime
dependency, version, lockfile, or license was adopted:

| Candidate                                                                                                                      | Decision and boundary                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain), `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                         | `REFERENCE_ONLY`; safety patterns only, no Runtime/DB/authority        |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0      | `REFERENCE_ONLY` for WP5; no SQLite/watcher/storage runtime            |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki), `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT                     | `REFERENCE_ONLY`; no backend/SQLite/LLM client                         |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge), `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`; no GPL runtime/storage/Yjs/Canonical sync            |
| Shotgun degraded strategy set                                                                                                  | `NO_RELEVANT_OSS`; exact boundary is a small typed value/Port contract |

Stage 12 `@shotgun/quality-evaluation` was not forced into this flow: its
claim/search metrics do not represent Discovery disposition, bounded candidate
safety, or AI-unavailability. WP5 reuses the existing server quality gate and
`semanticStableJson`/`sha256Text` utilities through a focused typed harness;
there is no new evaluation runtime.

## Migration, rollback, and non-scope

No persistence, database table, migration, durable Run/Job/Attempt state,
scheduler, trigger endpoint, lease, retry/recovery runtime, Outbox,
FindingReady event, UI, Canonical writer, or external Action is added. Revert
the WP5 commit to roll back; no data migration is needed. AKP-4+, live paid
providers, autonomous research, whole-project LLM scanning, vector/ML training,
feedback adaptation, and deployment are not started.

## Local verification

```text
npx vitest run tests/unit/akp-3-wp5-evaluation.test.ts
  1 file passed, 12 tests passed

npx vitest run tests/unit/akp-3-wp1-active-discovery.test.ts \
  tests/unit/akp-3-wp2-hypothesis-neighborhood.test.ts \
  tests/unit/akp-3-wp3-discovery-ai-generation.test.ts \
  tests/unit/akp-3-wp3-discovery-runtime.test.ts \
  tests/unit/akp-3-wp4-quality-budget-ranking.test.ts \
  tests/unit/akp-3-wp4-budget-propagation.test.ts
  6 files passed, 76 tests passed

npm run typecheck          PASS
npm run lint               PASS
npm run test:architecture  PASS
npx prettier --check <changed WP5 files> PASS
git diff --check           PASS
```

Docs/governance validation is run after adding this document. Full Frontend E2E
and accepted exact-head CI evidence are not manually rerun.

## Final CI evidence

To be filled after the one normal automatic PR CI for the final WP5 head:

- Draft PR: pending creation
- exact head: pending commit/push
- automatic CI number / Run ID / attempt: pending
- Quality / Frontend / Required Gates: pending
- manual CI rerun: none
- accepted CI #1087: not rerun
- Ready for Review / Merge / AKP-4+ / Deployment: not performed
