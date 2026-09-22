# TS-6 Phase B C2-R9 — Parallel Resource Contention Attribution and Controlled Vitest A/B Resumption

Date: 2026-09-21 (Asia/Seoul)

## Final disposition

R9 = AUDIT_PASS / REMEDIATION_REQUIRED / STOP
PRODUCT_CHANGE = NO
REAL_DEPENDENCY_CHANGE = NO
VITEST_CONFIG_CHANGE = NO
R9-SCOPE = root-cause attribution and controlled sandbox evidence only

R8's four new failures are not intrinsic to the affected assertions or files. Each exact assertion passed 5/5 under forks maxWorkers=1/fileParallelism=false and 3/3 under threads maxWorkers=1/fileParallelism=false. The three affected files passed isolated, pairwise, three-file, forks-4, forks-default, threads-1, threads-2 and threads-4 runs. The standalone validator unit/audit/verify also passed with the frozen metrics.

The real-worktree official full suite still exits 1 because Vitest 3.2.7 emits one unhandled onTaskUpdate RPC timeout after all 156 files and 1256 assertions pass. Disposable same-source sandboxes add the remaining evidence: Vitest 3.2.7 and Vitest 4.1.10 both time out F4's 20-second validator case during the full suite, while the V4 sandbox emits no RPC error. Therefore V4 removes the known RPC symptom in the controlled A/B, but it does not remove the suite-wide validator capacity timeout. Migration is not a sole closure and is not applied to the real worktree.

## Frozen identity

Worktree: C:\dev\shotgun-ts6-phase-b
Branch: codex/ts6-postgres-transaction-phase-b
HEAD: 1f821ea371b308d8cecede4a98ebe27960873b21
main: 1f821ea371b308d8cecede4a98ebe27960873b21
Active root Vitest: 3.2.7
Declared test:unit: vitest run tests/unit
Declared Vitest: ^3.2.2
Fixture SHA: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD

R7's one-line 15_000 ms timeout correction remains unchanged. No Product, dependency, lockfile, Vitest configuration, CI, fixture, database, commit, push, PR, Ready status, or TS-7 transition was performed.

## Attribution evidence

1. Exact isolated assertions: F1 5/5, F2 5/5, F3 5/5, F4 5/5; all exit 0 with no semantic failure.
2. Affected files: Stage 8 3/3, TS-1 3/3, validator 3/3 under forks-1; all exit 0.
3. Pairwise P1/P2/P3: each 3/3 under forks-2; all exit 0.
4. Three-file set: 3/3 under forks-3; all exit 0.
5. Affected set: forks-4 2/2 and forks-default 2/2; all exit 0.
6. Threads: exact assertions 3/3 each at threads-1; affected files 2/2 each at threads-1; affected set 2/2 at threads-2 and 2/2 at threads-4; all exit 0.
7. Official whole suite: 156/156 files and 1256/1256 assertions pass, but one onTaskUpdate unhandled RPC error makes exit 1.
8. Standalone validator: 24/24 unit tests, audit and verify pass; candidate=120, rawSiteCount=11, TX_BOUNDARY=100, TX_PARTICIPANT=0, TX_DELEGATE=0, NON_TX=7, TEST_ONLY_OR_DEAD=13, REVIEW_REQUIRED=0, issueCount=0, fixtureMutation=false.

## Controlled A/B

The first disposable copy attempt was invalid because robocopy dereferenced workspace junctions and excluded required evidence directories. It is excluded from the A/B conclusion. Rebuilt V3 and V4 sandboxes used npm ci, copied the required evidence directories, and ran the same npm run test:unit command.

- V3 sandbox: 155/156 files pass, 1255/1256 tests pass; F4 times out at the existing 20_000 ms source timeout; no RPC error in the valid rebuilt run.
- V4 sandbox: 155/156 files pass, 1255/1256 tests pass; the same F4 timeout remains; no RPC error.

This is a multi-cause result: the upstream Vitest RPC defect is supported and V4 removes that symptom in A/B, but suite-wide resource/contention capacity remains. No migration is applied as the sole remediation.

## Gates and next action

R9 intentionally does not claim Stage COMPLETE. Database tests, test:ci, final OSS/SBOM, Stage 12, migration/rollback rehearsal on the real worktree, and final closure gates remain outside this stopped audit. Recommended next request: obtain explicit controller approval for a separately scoped remediation experiment that keeps Product and Canonical boundaries unchanged, first addressing suite resource/contention (test scheduling or bounded worker policy) and separately evaluating Vitest 4 migration with full contract, golden, security, replacement, migration and rollback gates.
