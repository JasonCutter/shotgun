# VP relation provider and database failure probes — 2026-09-29

**Status: commit-ack readback, stored-output replay, ambiguous-provider response
fencing, and a process kill after synthetic HTTP success are tested; VP-06
remains open.**

## Scope

Four failure boundaries use a disposable isolated PostgreSQL database seeded
with synthetic, evidence-backed assertions. First, a test `PoolClient`
forwards the real `COMMIT` and then drops its acknowledgement; the Worker reads
back the committed receipt, relation, and job. Second, a provider output is
committed, then the Worker loses control before writing the relation; a fresh
Worker instance replays the stored output. Third, the provider connection
fails after request submission; the durable call is marked unknown and cannot
be claimed again. Fourth, a child worker receives HTTP 200 from a local
synthetic provider, reports that boundary to the parent, and is force-killed
before its adapter can return or persist output. After lease expiry, a fresh
worker must mark both job and provider-call rows `OUTCOME_UNKNOWN` and must not
send a second request. All provider responses are deterministic local stubs, so
these tests make no billable AI request.

## OSS integration decision

| Candidate                 | Version / license                                                                                                                                                                                                                                                                                               | Decision and boundary                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                | Existing pinned PostgreSQL 16 image; PostgreSQL License. This test runtime reported PostgreSQL 16.15 and pgvector 0.8.6 from `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`. The source registry separately records PostgreSQL 16.14; reconcile before VP-10. | Existing `ADOPT`/`AUGMENT`; VP retains relation-job and provider-call state. Migration 123 adds provider-call records within this boundary.              |
| `garrytan/gbrain`         | Commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                                                                                                                                                                                                                                                          | Existing `REFERENCE_ONLY`; retry/idempotency patterns only. No runtime, DB, identity, or canonical authority imported.                                   |
| Failure-injection helpers | No package added                                                                                                                                                                                                                                                                                                | `NO_RELEVANT_OSS`; test-only `PoolClient` wrapper, local HTTP stub, and child-process kill exercise Shotgun's existing database and provider boundaries. |

The data are synthetic and the database is disposable. Migration 123 is part
of the product schema; rollback must retain its provider-call rows and use a
forward migration if any call records exist.

## Result

`tests/database/vp-relation-priority.database.test.ts` passed all nine tests
on 2026-09-30, including all four probes. After the injected commit
acknowledgement loss:

- first worker dispatch returned `DECIDED` after authoritative readback;
- the stored job remained `COMPLETED` with one decision receipt and one relation;
- second dispatch returned `EMPTY`;
- the provider stub was invoked once.

After output persistence followed by simulated worker loss, a fresh Worker
replayed the stored result and wrote exactly one receipt and one relation; its
provider stub was also called once. For the lost-response case, the job and
call became `OUTCOME_UNKNOWN`, the fresh Adapter could not claim it, and replay
reported the queue incomplete with one unknown job. T3 status reported one
provider call and reset cascaded deletion through the owning relation job.

For the process-kill case, the local HTTP stub recorded exactly one accepted
request. The test killed the child after HTTP 200 but before output persistence.
Before recovery, the provider-call row was still `RUNNING`; the expired-lease
recovery then changed both the job and call to `OUTCOME_UNKNOWN`, recorded
`WORKER_LEASE_EXPIRED_AFTER_PROVIDER_START` on the call, and preserved exactly
one accepted request. A fresh worker did not resolve or call a provider, and
queue replay remained incomplete with one unknown job. This exposed and fixed
a recovery inconsistency where the job became unknown but its call record
remained `RUNNING`.

The worker unit tests also cover readback confirming completion, reusing the
already received decision while the same lease remains active, and returning
`OUTCOME_UNKNOWN` without scheduling a provider retry when state cannot be
confirmed. These paths never ask the provider for a second decision.

## Limits and next fault cases

The child-process probe exercises Shotgun's worker boundary against a local
HTTP stub. It does not kill the installed product while using DeepSeek or
reconcile DeepSeek's actual billing. If the provider response is lost before
Shotgun stores it, the system preserves `OUTCOME_UNKNOWN` and avoids a duplicate
request; it cannot recover the missing answer automatically. Full Runtime
restart after a real database/network failure and user-visible recovery status
remain VP-06/VP-07 work. See the
[retry cap design and verification](./vp-relation-retry-cap-design-2026-09-29.md).
