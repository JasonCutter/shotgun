# Runtime/Data Integrity WP-12 — Final Exact-SHA Acceptance

- Work package: WP-12
- Issue: [#189](https://github.com/JasonCutter/shotgun/issues/189)
- Canonical plan: [runtime-data-integrity-canonical-implementation-plan-2026-09-03.md](../runtime-data-integrity-canonical-implementation-plan-2026-09-03.md)
- Frozen canonical base: `main@cda65780d9f7116dae3045695455038684099f65`
- Authorized branch: `codex/wp12-final-exact-sha-acceptance`
- Evidence capture date: 2026-09-05 (Asia/Seoul)
- Current disposition: `IN_PROGRESS / DRAFT_CANDIDATE`
- Final recommendation at this capture point: `BLOCKED` until the final WP-12 PR
  exact-head Quality, Frontend, and Required Gates run and controller review completes.

## 1. Authority and frozen scope

WP-12 is a final acceptance and evidence-aggregation work package. It does not
add Product behavior, a new migration, a new runtime, a new provider or a real
Action call. The controller START authorization is Issue #189 comment
[5542232411](https://github.com/JasonCutter/shotgun/issues/189#issuecomment-5542232411).
The environment resume authorization is recorded at
[5542536713](https://github.com/JasonCutter/shotgun/issues/189#issuecomment-5542536713).

Only the following new file is in scope:

`docs/implementation/stage-validations/runtime-data-integrity-wp12-final-acceptance.md`

No Product, module, adapter, assembly, frontend, API-client, package,
migration, script, or test file was changed. No real external AI provider or
external Action connector was invoked; existing deterministic fakes and fault
injection are the authority for those scenarios.

## 2. Exact-SHA evidence reuse matrix

Each listed PR had an exact-head CI run with `Quality=SUCCESS`,
`Frontend=SUCCESS`, and `Required Gates=SUCCESS`. The merge SHA is the
canonical descendant used by the next work package. Existing tests are reused;
WP-12 does not clone them.

| WP    | PR / merge SHA                                                                                       | Exact-head CI                                                                                                                                                             | Reused evidence (representative paths)                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-01 | [#168](https://github.com/JasonCutter/shotgun/pull/168) / `c89fd80cd6b980b21ab57e3bdc8a0be9566fd0ac` | [33732908772](https://github.com/JasonCutter/shotgun/actions/runs/33732908772)                                                                                            | `packages/runtime-configuration`; `tests/unit/runtime-configuration.test.ts`; `tests/integration/recovery-harness-isolation.test.ts`                             |
| WP-02 | [#170](https://github.com/JasonCutter/shotgun/pull/170) / `3a5e7a96f11c484d14bc9fe764cbea3c63fa0ec2` | [33735617443](https://github.com/JasonCutter/shotgun/actions/runs/33735617443)                                                                                            | `tests/database/runtime-advisory-lock.database.test.ts`; PostgreSQL 64-bit advisory-lock guard                                                                   |
| WP-03 | [#172](https://github.com/JasonCutter/shotgun/pull/172) / `c3e35c7f20c685c91495efe78fad87548982a10e` | [33741416618](https://github.com/JasonCutter/shotgun/actions/runs/33741416618)                                                                                            | `tests/unit/runtime-data-integrity-wp03.test.ts`; lifecycle/cancellation contract and Discovery worker recovery                                                  |
| WP-04 | [#174](https://github.com/JasonCutter/shotgun/pull/174) / `48dac5e0e6c963531033e27b5d48d7dfb883f89b` | [33756946856](https://github.com/JasonCutter/shotgun/actions/runs/33756946856)                                                                                            | `tests/unit/sources-stage3-continuation.test.ts`; `tests/database/runtime-data-integrity-wp04-schema.test.ts`; Source/Evidence continuation/replay               |
| WP-05 | [#176](https://github.com/JasonCutter/shotgun/pull/176) / `a6c570b3ad7d241b1b4c61ef7d38cfad5f0a9ca9` | [33834206816](https://github.com/JasonCutter/shotgun/actions/runs/33834206816)                                                                                            | `tests/integration/connector-reliability.test.ts`; durable job/dedup/DLQ/outcome-unknown behavior                                                                |
| WP-06 | [#178](https://github.com/JasonCutter/shotgun/pull/178) / `2164519f9acb4de0a76fe9b448a6d34435376659` | [33839785698](https://github.com/JasonCutter/shotgun/actions/runs/33839785698)                                                                                            | `tests/database/frontend-ask-claim-concurrency.test.ts`; 64/2x32, 10/2x32, savepoint isolation                                                                   |
| WP-07 | [#180](https://github.com/JasonCutter/shotgun/pull/180) / `448f20804305b430a024676b403cd222717ca9f0` | [33848182418](https://github.com/JasonCutter/shotgun/actions/runs/33848182418)                                                                                            | `tests/contract/handoff-topology.contract.test.ts`; `tests/unit/handoff-policy.test.ts`; manifest disposition                                                    |
| WP-08 | [#182](https://github.com/JasonCutter/shotgun/pull/182) / `466ef178e47aa3d555fbed381133534e0483f396` | [33853003646](https://github.com/JasonCutter/shotgun/actions/runs/33853003646)                                                                                            | `tests/unit/canonical-projection-recovery.test.ts`; `tests/unit/health.test.ts`; readiness/recovery registry                                                     |
| WP-09 | [#184](https://github.com/JasonCutter/shotgun/pull/184) / `8f2ad307a7bffafe6dded748a62be5221b1dc97a` | [33859672127](https://github.com/JasonCutter/shotgun/actions/runs/33859672127)                                                                                            | `tests/unit/http-boundary-validation.test.ts`; malformed-body, 500-negative and side-effect guards                                                               |
| WP-10 | [#186](https://github.com/JasonCutter/shotgun/pull/186) / `24897104386d02af9fcd4d1012ef0976566f6139` | [33875855621](https://github.com/JasonCutter/shotgun/actions/runs/33875855621)                                                                                            | `tests/contract/runtime-data-integrity-wp10-action-feedback.contract.test.ts`; WP-10 database/activity/diagnostic suites                                         |
| WP-11 | [#188](https://github.com/JasonCutter/shotgun/pull/188) / `cda65780d9f7116dae3045695455038684099f65` | [33881509460](https://github.com/JasonCutter/shotgun/actions/runs/33881509460); post-merge [33882208199](https://github.com/JasonCutter/shotgun/actions/runs/33882208199) | `tests/contract/runtime-data-integrity-wp11-legacy-disposition.contract.test.ts`; `tests/integration/runtime-data-integrity-wp11-legacy-routes.test.ts`; ADR-159 |

WP-00 is the governance baseline, not a numbered implementation row:
[PR #164](https://github.com/JasonCutter/shotgun/pull/164), merge
`aa353fb942c11c1823edec34d23d91e3d92de423`, exact-head CI
[33728149505](https://github.com/JasonCutter/shotgun/actions/runs/33728149505).

The current canonical base is therefore proven by WP-11 post-merge CI run
`33882208199`; the WP-12 PR head will receive a new automatic exact-head run.

## 3. Reused versus newly executed evidence

### Reused exact-head evidence

- Repository-wide unit, contract, integration, architecture, security/OSS,
  Stage 12 package, and database evidence is reused from the listed exact-head
  CI runs.
- Frontend typecheck, unit, build, and E2E evidence is reused from the same
  exact-head `Frontend` jobs.
- WP-specific fault/replay coverage is mapped to the existing suites in the
  matrix: Source/Evidence (WP-04), Connector (WP-05), Ask claim (WP-06),
  handoff topology (WP-07), recovery/readiness (WP-08), malformed HTTP (WP-09),
  Action/Discovery (WP-10), and legacy compatibility (WP-11).
- No same-head PASS test was rerun solely to duplicate evidence.

### Newly executed operational evidence

The two gates below are not supplied by the repository-wide exact-head CI and
were therefore executed once on the frozen base. They changed no tracked file.

## 4. Backup / restore drill — PASS

Issue #189 required `npm run backup:drill`; the drill itself creates and removes
isolated source/target databases and must not touch the normal `shotgun` data.

Environment and command:

```text
docker compose up -d --wait db
DATABASE_URL=postgres://shotgun:shotgun@localhost:5432/shotgun
SHOTGUN_PG_TOOL_MODE=docker-compose
npm run backup:drill
```

Observed result on exact base `cda65780d9f7116dae3045695455038684099f65`:

```json
{
  "status": "PASS",
  "backupFormat": "shotgun-backup-v1",
  "migrations": 65,
  "originalAssets": 1,
  "contracts": 109,
  "canonicalProjects": 1,
  "recovered": {
    "outboxStatus": "published",
    "searchStatus": "READY",
    "compiledVersion": 1,
    "searchClaimIdsCount": 1
  },
  "durationMs": 11636
}
```

The actual claim identifier is intentionally not promoted to a contract; only
the observed count is recorded. The drill proves the deterministic recovery
shape, Original Asset byte identity, clean projection restore, and isolated cleanup. The result was recorded in
Issue #189 comment
[5542579767](https://github.com/JasonCutter/shotgun/issues/189#issuecomment-5542579767).

## 5. Migration / rollback rehearsal — PASS

The rehearsal used the isolated Compose `db-test` service (`shotgun_test` on
port 5433), not the normal `shotgun` database:

```text
docker compose up -d --wait db-test
TEST_DATABASE_URL=postgres://shotgun:shotgun@localhost:5433/shotgun_test
npm run db:test:reset
npm run db:test:verify
```

Observed database state:

| Observation                           | Result                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                            | 16.15                                                                                                                                           |
| `current_database()`                  | `shotgun_test`                                                                                                                                  |
| `runtime.schema_migrations`           | 65 rows, `001_stage0_runtime.sql` through `065_runtime_data_integrity_wp10_action_review_discovery.sql`                                         |
| Required-table verification           | `Database bootstrap verified.` / PASS                                                                                                           |
| Durable work before worker activation | 0 rows in Connector jobs/dedup/DLQ/replay, Source Stage 3 progress, Evidence Stage 4 continuation, Discovery jobs/stages, and Action executions |
| Worker activation                     | Not started                                                                                                                                     |
| Down migration                        | None created or executed; repository policy is forward-only/additive                                                                            |

The observed rollback classification is `SAFE_BEFORE_ACTIVATION`: the additive
schema remains available while a compatible binary is rolled back because no
worker was activated and no durable work existed. If durable work exists, the
same policy changes eligibility to `FORWARD_FIX_REQUIRED`: pause, drain, and
reconcile before any application rollback; a destructive down migration is not
permitted. This follows the [developer workflow contract](../../engineering/developer-workflow-contract-260728001.md)
and [Stage 12.1 hardening strategy](../../engineering/stage-12-1-hardening-strategy.md).

The rehearsal result and resume condition were reported to the controller. No
migration or script was edited.

## 6. Ten acceptance layers

| Layer                | Disposition           | Evidence pointer                                                                                        |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit                 | `PASS / REUSED`       | WP-01, WP-03, WP-08, WP-09, WP-10 exact-head suites                                                     |
| Contract             | `PASS / REUSED`       | WP-01 configuration, WP-07 handoff, WP-09 decoder, WP-11 compatibility contracts                        |
| Database             | `PASS / REUSED + NEW` | WP-02/04/05/06/07/10 database suites; Section 5 migration rehearsal                                     |
| Integration          | `PASS / REUSED`       | WP-03/04/05/06/08/10 integration and database suites                                                    |
| Replay / Idempotency | `PASS / REUSED`       | WP-04 continuation, WP-05 outcome-unknown, WP-06 claim, WP-10 Action feedback and WP-11 route telemetry |
| Golden Corpus        | `PASS / REUSED`       | Quality exact-head Stage 4/corpus and digest checks in runs listed above                                |
| Security Negative    | `PASS / REUSED`       | WP-01 environment guards, WP-05/07 scope checks, WP-09 malformed input, WP-10 redaction                 |
| Migration / Rollback | `PASS / NEW`          | Sections 4–5; isolated backup/restore and additive rollback boundary                                    |
| E2E                  | `PASS / REUSED`       | Final-base `Frontend` E2E in post-merge run `33882208199`; no real provider/action                      |
| Architecture         | `PASS / REUSED`       | WP-07 topology/disposition and repository Quality/Stage/OSS gates                                       |

## 7. Required completion metrics

The values below are recorded only where the existing exact-head tests assert
them; no unsupported production volume is inferred.

| Metric                                                                 | Result                                                | Existing authority                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Restart leaves no silent Source Stage 3 orphan                         | `PASS`; unresolved state is explicit terminal/unknown | WP-04 continuation/recovery tests                                              |
| Duplicate semantic SourceVersion/Candidate/provider/Action side effect | `0` in covered replay scenarios                       | WP-04, WP-05, WP-10 suites                                                     |
| Connector timeout same-key handler executions                          | `1`                                                   | `tests/integration/connector-reliability.test.ts`                              |
| Ask 64/2x32 and 10/2x32 intersection/missing                           | intersection `0`; missing `0`                         | `tests/database/frontend-ask-claim-concurrency.test.ts`                        |
| Zero-Evidence corpus Stage 4 calls                                     | `0` in covered corpus                                 | WP-04 Source/Evidence tests and Quality gate                                   |
| Malformed public request HTTP 500 / side effects                       | `0 / 0` in covered routes                             | `tests/unit/http-boundary-validation.test.ts`                                  |
| Shutdown grace bound                                                   | `PASS` within configured test bound                   | `tests/unit/runtime-data-integrity-wp03.test.ts`                               |
| Producer events without consumer or intentional disposition            | `0`                                                   | `tests/contract/handoff-topology.contract.test.ts`, WP-11 disposition contract |
| Recovery failure missing from readiness/activity                       | `0` in covered failure fixtures                       | WP-08 health/recovery and WP-10 activity suites                                |

## 8. OSS and safety boundary

Decision for WP-12 is `NO_RELEVANT_OSS`: this is an acceptance aggregation and
operational verification package, not a runtime capability. The four reviewed
references (gbrain, lucasastorian/llmwiki, ddsyasas/llm-wiki, Inkeep
OpenKnowledge) remain `REFERENCE_ONLY` under the repository Open-Source Role
Matrix. No package, version, lockfile, adapter, or fork was introduced.

No external provider or Action connector was called. The only runtime services
used were the pinned local PostgreSQL/pgvector Compose images and deterministic
test fixtures.

## 9. Final-head gate and completion decision

The final WP-12 PR exact head is the commit that adds this artifact. Its SHA is
reported by `git rev-parse HEAD` at delivery and must be the exact SHA attached
to the automatic PR CI. At this capture point the branch CI has not yet run,
so the artifact deliberately does not claim a PASS on a future SHA.

Before `PASS_FOR_COMPLETION`, the controller must verify on the same final PR
head:

1. `Quality=SUCCESS`;
2. `Frontend=SUCCESS`;
3. `Required Gates=SUCCESS`;
4. Draft PR exact-head review has no blocker; and
5. post-merge `main` CI is successful before `FINAL_AFTER_MERGE`.

Current recommendation: **`BLOCKED` — awaiting final exact-head CI and
controller review only.** This is a delivery checkpoint, not a Product defect.
