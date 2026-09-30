# VP-05 relation-pair scale characterization — 2026-09-29

**Status: characterization only; VP-05 remains open.** No relation-pair
pruning or production behavior changed in this measurement.

## Scope and current behavior

The target is `VPRelationJobStorePort.enqueueCurrentPairs` in the PostgreSQL
adapter. It considers every pair of current assertions in one project when the
claim text, access scopes, and sensitivity pass the query predicates. It does
not exclude same-source pairs. `pg_trgm.similarity()` only orders the work; it
does not remove pairs. The queue inserts at most 128 jobs per call, while the
worker's daily provider-attempt ceiling defaults to 100.

## OSS integration decision

| Candidate                                                                                   | Pin / license                                                                                                                                                                                                                                               | Decision and boundary                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PostgreSQL `pg_trgm`](https://github.com/postgres/postgres/tree/REL_16_14/contrib/pg_trgm) | Existing source pin commit `0d1c00c624fa7367d4a895f44381887757289682`, PostgreSQL License. Test runtime: `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`; PostgreSQL 16.15, `pg_trgm` 1.6, pgvector 0.8.6. | Existing `AUGMENT` decision. Reuse the database behind `VPRelationJobStorePort`; `pg_trgm` remains a ranking signal only. No external runtime, schema, or OSS-owned identifier is introduced. The checked-in source registry pins `pg_trgm` to PostgreSQL 16.14 while the current `pgvector/pg16` test image reports 16.15; reconcile this version record before the VP-10 OSS gate. |
| Other relation-ranking packages                                                             | None added                                                                                                                                                                                                                                                  | `NO_RELEVANT_OSS` for this measurement-only change. The existing adapter and SQL query are being characterized; no new ranking implementation is selected.                                                                                                                                                                                                                           |

The test uses the existing Vitest/PostgreSQL integration setup and creates an
isolated disposable database. The data are synthetic. No live provider was
called, no user database was changed, and the Open-source Role Matrix remains
unchanged. Rollback is removal of the characterization test and this report;
there is no production migration or data change.

## Measurement

The isolated PostgreSQL test seeded 64 assertions across 64 sources, with one
eligible security scope. Every pair passed the current query predicates.

| Measure                                   |                              Result |
| ----------------------------------------- | ----------------------------------: |
| Eligible pairs, `64 × 63 / 2`             |                               2,016 |
| Jobs inserted                             |                               2,016 |
| Bounded enqueue batches                   |             16 at 128 jobs per call |
| Enqueue time across isolated runs         | 3,479–12,965 ms (latest: 12,965 ms) |
| Provider decisions made                   |                                   0 |
| At 100 attempts/day, one attempt per pair |                     21 days minimum |

The enqueue duration characterizes only this test machine and small dataset; it
is not a production latency target. It does show that job materialization
retains every eligible pair. The theoretical all-pairs upper bound for the
actual PDF's 112 current assertions would be 6,216 pairs before excluding equal
claim text or scope differences. At the current daily ceiling, processing that
many one-attempt pairs would take up to 63 days, before retries or other
projects consume the shared budget.

## `pg_trgm` threshold trial

The first v1.1 trial counted only `EQUIVALENT`, `QUALIFIES`, and
`CONTRADICTS` as strict relations, leaving exact `RELATED` labels out of recall.
That denominator was incomplete for VP because `RELATED` is also a stored
relation; the decision contract now also stores directional `SUPPORTS`. The
updated trial measures every single-choice label except `UNRESOLVED`, including
`RELATED` and `SUPPORTS`, across the synthetic relation corpus v1.2 and the
finance source-backed candidate corpus v1.2. Both remain `CANDIDATE`; this is a
filter-risk characterization, not approved quality evidence.

| Minimum similarity | Synthetic retained | Synthetic exact-relation recall | Finance retained | Finance exact-relation recall |
| -----------------: | -----------------: | ------------------------------: | ---------------: | ----------------------------: |
|               0.01 |              16/16 |                           10/10 |            14/14 |                         13/13 |
|               0.05 |              15/16 |                            9/10 |            14/14 |                         13/13 |
|               0.10 |              14/16 |                            9/10 |            13/14 |                         13/13 |
|               0.15 |              14/16 |                            9/10 |            13/14 |                         13/13 |
|               0.20 |              14/16 |                            9/10 |             9/14 |                          9/13 |
|               0.30 |              13/16 |                            9/10 |             8/14 |                          8/13 |

At `0.05`, the cross-language equivalent remains a false negative in the
synthetic corpus (score `0.0213`). In the finance corpus, a threshold of `0.20`
removes four of thirteen exact relation pairs while reducing the 14 candidates
to nine. At `0.15`, all thirteen finance pairs remain, but only one of fourteen
candidates is removed. This small candidate set shows no useful threshold
frontier with demonstrated recall and meaningful reduction. No threshold
filter was enabled. The v1.1 8/8 denominator is retained as historical output,
not treated as a complete recall measure.

## VP-specific pgvector reuse decision

The repository already contains the `pgvector/pgvector` adapter and
`SemanticIndexRepositoryPort`; its existing registered image pin is
`pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`
(PostgreSQL License). This test image reports PostgreSQL 16.15, `pg_trgm` 1.6,
and pgvector 0.8.6. Existing semantic-index tests cover project/access-scope
filtering before Top-K and deterministic tie-breaking. See the
[OSS source registry](./oss-source-registry.json) for the upstream and prior
integration record.

**Decision for VP-05: `DEFER` adapting semantic retrieval to VP relation
candidate generation.** Target boundary would be `VPRelationJobStorePort`;
the current semantic index serves its separately owned projection and is not
connected to VP assertion pairs. It may not discard relations based on vector
distance without a versioned, authorized embedding profile and an expanded,
reviewed relation-retrieval corpus. Current embedding models are OpenAI and
Gemini; the VP relation flow uses DeepSeek for decisions. No new provider
egress, runtime, or schema is introduced here. This is a VP-specific deferral;
it does not change the existing pgvector registration for semantic search.
Re-evaluate when an embedding profile is configured under the applicable
egress policy and pair recall is measured on same-meaning, contradiction,
qualification, temporal, and cross-language cases. Rollback is unnecessary
because no VP vector data or production behavior changed. The existing
role-matrix/registry status difference should be reconciled at VP-10.

Reproduction:

```powershell
node --env-file-if-exists=.env --env-file-if-exists=.env.test node_modules/vitest/vitest.mjs run tests/database/vp-relation-priority.database.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=120000 --hookTimeout=60000
```

## Verification and next work

All nine tests in `vp-relation-priority.database.test.ts` passed on
2026-09-30. On 2026-10-01 the focused frontier test also passed against the
isolated PostgreSQL 16.15 runtime (`pg_trgm` 1.6, pgvector 0.8.6), now measuring
both pinned v1.2 candidate corpora and counting exact `RELATED`/`SUPPORTS`
labels in recall. A database regression test also paged all six eligible pairs
from four claims and confirmed the low-similarity cross-language pair (`0.0213`)
and finance present-value pair (`0.1633`) were eventually enqueued. This verifies
the current adapter uses similarity for ordering and does not discard these
pairs; it does not validate their labels independently. The existing
priority case still chooses an evidenced cross-source match before an older
unrelated pair. The scale case verifies the complete 2,016-pair set is
materialized in bounded batches and that job creation itself consumes no
provider-attempt budget. The synthetic corpus digest is
`sha256:5ec7ce2f2b2613057c205d6033dbfd3c1df66054061c3f98ce52a067ab1b05b3`;
the finance corpus digest is
`sha256:7f46918b7570441c9cd13c635d8ef668ee55e1874f06bba14656a8ca93388e45`.
The finance corpus retains all 13 exact relation pairs through threshold 0.15,
but this removes just one candidate. At threshold 0.20, four exact relation
pairs are missed. These are candidate-label results, not an approved
production-recall bound.

The complete relation DB suite passed 10/10 and both relation-corpus contract
suites passed 8/8 on 2026-10-01. In that run, 64 assertions produced the full
2,016 eligible pairs in 16 enqueue batches in 7,369 ms with zero provider calls.
That single-machine duration is a measurement, not a production latency target.

The existing `SemanticIndexRepositoryPort`/pgvector path is not connected to
VP relation jobs; it indexes the semantic corpus used by its own retrieval
flow. The current embedding catalog offers OpenAI and Gemini models, while the
VP relation worker uses the configured DeepSeek decision model. No VP-specific
embedding profile, candidate port, or approved labeled retrieval corpus exists.
The VP-specific vector candidate path is therefore **DEFERRED** pending a
provider/credential/egress decision and a broader cross-language relation
corpus. No similarity filter is enabled.

The 14-pair DeepSeek run and token-based price estimate are recorded in the
[live DeepSeek report](./vp-deepseek-live-metrics-2026-09-29.md); that is not a
large-scale classification run or billing-ledger readback. VP-05 stays open.
Next, obtain independent labels on a broader relation-retrieval corpus before
considering a candidate-reduction policy. Report pair recall and false
negatives separately from ranking, then measure actual provider calls, retries,
latency percentiles, and account billing before changing the production queue.

## 2026-09-30 one-request batch prototype — candidate measurements

An opt-in test path compares the existing 14 individual
`GeneralAIVPDecisionAdapter` calls with structured provider requests that group
the same pairs. It records request count, provider-reported input/output
tokens and latency, schema completeness, candidate-label agreement, and
agreement with the individual run. The shared relation rules and source-data
egress checks are retained. Batch responses are not written to VP relation
jobs, receipts, assertions, or canonical records; production queue and call
semantics are unchanged.

To run it after the isolated VP database and configured Vault credential are
available:

```powershell
$env:VP_LIVE_DEEPSEEK = '1'
$env:VP_RELATION_CORPUS_ID = 'shotgun-vp-finance-relation-candidate'
$env:VP_RELATION_BATCH_PROTOTYPE = '1'
$env:VP_RELATION_BATCH_SIZE = '4'
node --env-file-if-exists=.env --env-file-if-exists=.env.test node_modules/vitest/vitest.mjs run tests/integration/vp-deepseek-live.integration.test.ts --maxWorkers=1 --testTimeout=180000 --reporter=verbose
```

The batch size defaults to all 14 cases when `VP_RELATION_BATCH_SIZE` is not
set; values `7` and `4` issue two and four structured requests. The comparison
reports serial provider-call time for the 14 individual requests, total time
for the batch calls, and batch end-to-end time including credential resolution
separately.

**Integration decision:** `NO_RELEVANT_OSS` for this measurement-only test
change. No external batching package or runtime is needed; the existing
`DecisionProviderPort`/DeepSeek adapter is used for benchmark calls.
There is no new dependency, migration, or production adapter decision. Any
durable production batching would still require a separate Port/Adapter design,
per-job execution identity, atomic receipt/replay semantics, failure isolation,
and Contract, idempotency, security, and replacement tests before adoption.

Five paired live runs completed on `deepseek/deepseek-flash`, each comparing
the same 14 individual decisions with batches of size 14 (three times), 7, and 4.
All individual runs except one separate failed attempt passed 14/14 candidate
safe choices and 10/10 exact candidate labels. The full batch passed 12/14 in
one run and 14/14 in the other two; the size-7 and size-4 batches each passed
13/14. The same non-strict `finance-profit-cash-coexistence` case was the
out-of-envelope result in both smaller-batch runs. All five batch responses
were complete and valid under the VP relation schema. The fixture remains
`CANDIDATE`; these counts are not approved quality or calibration results.

| Batch size | Individual input/output tokens | Batch input/output tokens |  Calls | Combined token reduction | Individual serial provider time | Batch provider time | Batch allowed/exact labels | Estimated off-peak cost, individual → batch |
| ---------: | -----------------------------: | ------------------------: | -----: | -----------------------: | ------------------------------: | ------------------: | -------------------------: | ------------------------------------------: |
| 14 (run 1) |                      7,017/888 |                 1,496/955 | 14 → 1 |                   68.99% |                       11,527 ms |            3,027 ms |                12/14, 9/10 |                       $0.001022 → $0.000797 |
| 14 (run 2) |                      7,017/833 |                 1,496/993 | 14 → 1 |                   68.29% |                       11,686 ms |            3,100 ms |               14/14, 10/10 |                       $0.000989 → $0.000632 |
| 14 (run 3) |                      7,017/863 |                 1,496/993 | 14 → 1 |                   68.41% |                       11,301 ms |            2,928 ms |               14/14, 10/10 |                       $0.001007 → $0.000632 |
|          7 |                      7,017/911 |                 2,038/999 | 14 → 2 |                   61.69% |                       10,219 ms |            3,609 ms |               13/14, 10/10 |                       $0.001036 → $0.000886 |
|          4 |                      7,017/857 |                 3,122/993 | 14 → 4 |                   47.74% |                       10,615 ms |            5,432 ms |               13/14, 10/10 |                       $0.001003 → $0.001026 |

The full batch reduced requests by 92.86%; sizes 7 and 4 reduced them by
85.71% and 71.43%. For these serial runs, the individual-call time was 3.77–3.81
times the single full-batch call, 2.83 times the size-7 calls, and 1.95 times
the size-4 calls. These one-machine results do not include production
parallelism, retries, or full job completion. Batch output tokens were higher
than individual output tokens in every paired run.

## Candidate-label audit: profit/cash example

The repeated size-7 and size-4 out-of-envelope result was
`finance-profit-cash-coexistence`. Its left assertion states that higher
accounting profit does not imply an equal increase in cash. Its right assertion
is a specific example where profit rises and cash is unchanged. The example is
consistent with, and supplies evidence for, the broader non-implication; it is
not a contradiction. The most informative relation is directional support from
the example (right) to the general assertion (left).

The accepted relation vocabulary in [ADR-172](../architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md)
includes `SUPPORTS`, but the current `DecisionProviderPort` choice set does not.
The current worker also declines to persist `QUALIFIES` because the stored
relation has no direction/qualifier contract and records it as
`QUALIFIER_NOT_MODELED`. Therefore the observed `QUALIFIES` choice is not
enough evidence to call this a model error, and it would not have become an
active stored relation in the production path. The fixture's `RELATED` /
`UNRESOLVED` envelope is not a reviewed gold label for this pair either: it
cannot express the likely directional support relation.

Keep the five live measurements and their original candidate-denominator
counts unchanged. Do not promote the current fixture or retroactively broaden
its allowed labels to match provider output. Before using this case as a quality
gate, define directed `SUPPORTS` and `QUALIFIES` semantics in the VP decision and
ledger contracts, then independently review and version the candidate labels.
This contract gap blocks a reliable interpretation of the current relation
quality counts; it does not change the measured call, token, latency, or tariff
figures. The existing VP-specific OSS boundary remains: gbrain is
`REFERENCE_ONLY`, and PostgreSQL remains behind the Shotgun-owned relation
store Port. No OSS runtime was added by this audit.

The estimated costs use the provider-reported cache-hit, cache-miss, and output
tokens with DeepSeek's published off-peak `deepseek-flash` rates of $0.003,
$0.15, and $0.60 per million tokens. Calls occurred at 13:28–13:43 UTC, outside
the provider's published weekday peak windows. The provider's pricing page
states that prices may change, and the cache guide says cache hits are
best-effort. Consequently, fewer total tokens did not always mean lower
estimated cost: batch size 4 used 47.74% fewer tokens but estimated 2.30%
higher cost; size 7 estimated 14.44% lower cost; the three size-14 runs
estimated 21.98%, 36.10%, and 37.24% lower cost. These are tariff-based
estimates, not ledger readbacks or guaranteed savings. See [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
and [DeepSeek Context Caching](https://api-docs.deepseek.com/guides/kv_cache/).

One intervening individual-only attempt returned a probability distribution
whose values summed to 1.05 for the NPV pair. The VP validator rejected it and
the run stopped before its batch request. This is the expected fail-closed
behavior, and it adds evidence that output validity must be reported separately
from the model's selected label.

The corpus/DecisionProvider Contract tests passed 13/13; the relation
worker/router tests passed 17/17; ESLint, Prettier, documentation validation,
and `oss:verify` passed. The repository-wide TypeScript check reports only the
unrelated, untracked TS-7 cross-section fixture errors. The full-batch speed
and token reductions do not justify a production change while the candidate
label result varied from 12/14 to 14/14. Keep production relation handling
one-job-per-provider-call until a reviewed, broader corpus and repeated
quality/error-limit evidence support a durable batch protocol. VP-05 remains
open; no production queue, migration, or provider-call semantics changed.

## 2026-09-30 directional-support prompt follow-up

The candidate-label audit exposed a contract gap, so Migration 125 and
`vp-deepseek-relation-v5` added stored direction for `SUPPORTS` and
`QUALIFIES`. The v5 prompt now includes the exact semantic shape of the
profit/cash case: a concrete right-side example supports the broader left-side
non-implication, so the expected relation is `SUPPORTS` with
`RIGHT_TO_LEFT`. The v4 model run had chosen `SUPPORTS` but reversed direction
for an individual call; its full-batch call returned the expected direction.

After the v5 prompt change, two fresh live runs used finance candidate corpus
1.1.0 (`sha256:c9fb7c0d514f6bcdf25038030616ea1feaa1ac31eaa4df39b8dedf46c800e9a4`)
with 14 individual requests plus one full-batch request each. All 30 provider
responses were HTTP 200 and valid under the closed relation schema. In both
runs, individual and batch paths passed the candidate allowed-label envelope
14/14 and exact labels 11/11; the support case was correctly directed by both.
All 14 batch results agreed with their individual result in both runs. The
corpus remains `CANDIDATE`; this is not independent label review, calibration,
or a production batch protocol.

| Run | Input/output tokens, individual → batch | Cache-hit/miss input, individual → batch |  Calls | Provider time, individual → batch | Allowed / exact labels, individual and batch | Tariff cost estimate, individual → batch |
| --- | --------------------------------------: | ---------------------------------------: | -----: | --------------------------------: | -------------------------------------------: | ---------------------------------------: |
| 1   |               9,663/1,013 → 1,685/1,008 |                    6,656/3,007 → 0/1,685 | 14 → 1 |                 12,372 → 2,829 ms |                                 14/14, 11/11 |                    $0.001079 → $0.000858 |
| 2   |               9,663/1,014 → 1,685/1,176 |                  6,656/3,007 → 1,536/149 | 14 → 1 |                 11,824 → 3,408 ms |                                 14/14, 11/11 |                    $0.001079 → $0.000733 |

Across the two runs, the token reduction was 73.20–74.78%, request reduction
was 92.86%, and the batch provider call took 3.47–4.37 times less time than
the sum of serial individual calls. Estimated cost was 20.51–32.13% lower,
using the provider-reported cache breakdown and the published off-peak
`deepseek-flash` rates ($0.003 per million cache-hit input tokens, $0.15 per
million cache-miss input tokens, and $0.60 per million output tokens). The
requests were sent at approximately 23:23 and 23:27 UTC, outside the published
weekday peak windows. The official pricing page says rates can change; cache
hits are best-effort. These are estimates, not billing ledger readbacks. See
[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/).

The live test wrote no VP ledger records. Contract and database regression
tests passed after the policy change. Do not activate durable batching from
these results: the finance corpus is small and still candidate-labeled, and
candidate pruning recall, reviewed multi-document quality, retries, production
parallelism, a cost ceiling, and billing reconciliation remain open under
VP-04/05/06.

## 2026-10-01 finance v1.2 batch repeat

The opt-in live comparison above was rerun twice against finance relation
candidate corpus v1.2 (`sha256:7f46918b7570441c9cd13c635d8ef668ee55e1874f06bba14656a8ca93388e45`).
Each run made 14 individual `deepseek-flash` requests and one structured batch
request for all 14 pairs. The individual and batch paths each returned valid
closed-schema results, passed the candidate safe-choice set 14/14 and the 13
single-choice labels 13/13, and agreed case-by-case 14/14. HTTP status was 200
for all 30 requests. The fixture remains `CANDIDATE`, and the test wrote no VP
ledger records.

| Run | Individual input/output tokens | One-batch input/output tokens |  Calls | Token reduction | Serial individual / batch provider time | p50 / p95 individual latency | Allowed / exact labels, both paths | Off-peak tariff estimate, individual → batch |
| --: | -----------------------------: | ----------------------------: | -----: | --------------: | --------------------------------------: | ---------------------------: | ---------------------------------: | -------------------------------------------: |
|   1 |                    9,663 / 997 |                 1,685 / 1,108 | 14 → 1 |          73.80% |                       11,999 / 3,129 ms |               831 / 1,059 ms |                       14/14, 13/13 |                        $0.000994 → $0.000692 |
|   2 |                  9,663 / 1,032 |                 1,685 / 1,176 | 14 → 1 |          73.25% |                       11,961 / 3,384 ms |               811 / 1,109 ms |                       14/14, 13/13 |                        $0.001015 → $0.000733 |

Both requests ran Wednesday 2026-09-30 at approximately 16:19 UTC, outside the
published weekday peak windows. Estimates use the API-reported cache counts
(individual 7,168 hit / 2,495 miss tokens; batch 1,536 hit / 149 miss tokens)
and the published `deepseek-flash` off-peak prices: $0.003 per million cache
hit input tokens, $0.15 per million cache miss input tokens, and $0.60 per
million output tokens. DeepSeek notes prices can change and cache hits are
best-effort, so these figures are not billing readbacks or a guaranteed
savings rate. See [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
and [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/).

This repeated run updates the v1.2 comparison, not its adjudication status.
It strengthens the measured case for fewer provider requests and lower
token-based tariff estimates in this 14-pair sample. It does not test
production parallelism, retries, durable batch receipts, outage recovery,
large relation queues, or actual account billing. Keep this as a benchmark
prototype until the labels are independently reviewed and a durable batch
protocol passes the Port contract, idempotency, security, replacement, and
rollback gates. No production queue or migration changed.
