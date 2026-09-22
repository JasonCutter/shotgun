import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import os from 'node:os';

const root = resolve(import.meta.dirname, '..');
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r9');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r9-review-20260921.zip');
const fixturePath = resolve(root, 'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json');
const r7TestPath = resolve(root, 'tests/unit/ts1-document-format-boundary.test.ts');
const rawRoot = resolve(evidenceRoot);

const text = async (file) => readFile(file, 'utf8');
const writeStage = async (name, value) => {
  const target = join(stage, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
};
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};
const readJson = async (file) => JSON.parse(await text(file));
const hashFile = async (file) => createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const packageJson = JSON.parse(await text(resolve(root, 'package.json')));
const fixtureSha = await hashFile(fixturePath);
const activeVitest = JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8')).version;
const r7Diff = git(['diff', '--', 'tests/unit/ts1-document-format-boundary.test.ts']);
const currentStatus = git(['status', '--short']);
const currentDiffCheck = git(['diff', '--check']);
const currentBranch = git(['branch', '--show-current']).trim();
const head = git(['rev-parse', 'HEAD']).trim();
const main = git(['rev-parse', 'main']).trim();

const frozen = [
  'C1 ZIP SHA-256: D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  'C2-R3 ZIP SHA-256: 6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
  'C2-R4 ZIP SHA-256: 0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E',
  'C2-R5 ZIP SHA-256: B25CFCA152A89480809968F696BBA3699079BD278DBAE3C0E58E1762476BFE89',
  'C2-R6 ZIP SHA-256: 552555B6F86B60A0CCE045474E94A9DB577A433EF9DC6C7DF6AB09F794DB3B8B',
  'C2-R7 ZIP SHA-256: 125096052CD7E79AA55B8C71A88C6FEA87FC667E8DDF86E83B05747C949D5773',
  'C2-R8 ZIP SHA-256: DC743DA5F67C21D80227D74DCB5262B819B687C66CA3C84C452A874DD936284F',
  `Fixture SHA-256: ${fixtureSha}`,
  'Expected fixture SHA-256: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
].join('\n');

const failureInventory = {
  source: 'R8-S05 exact inventory',
  failures: [
    {
      id: 'F1',
      file: 'tests/unit/stage-8-format-expansion.test.ts',
      test: 'requires multimodal validation for image meaning and records the image BBox',
      r8Observed: 'threads-r1 timeout at about 5013.6ms against source default 5000ms',
    },
    {
      id: 'F2',
      file: 'tests/unit/stage-8-format-expansion.test.ts',
      test: 'allows a format adapter replacement without changing the upper contract shape',
      r8Observed: 'threads-r1 timeout at about 5017.4ms against source default 5000ms',
    },
    {
      id: 'F3',
      file: 'tests/unit/ts1-document-format-boundary.test.ts',
      test: 'accepts valid high-cardinality XLSX input',
      r8Observed: 'threads-r1 timeout at about 20027.8ms against source timeout 15000ms',
    },
    {
      id: 'F4',
      file: 'tests/unit/ts6-phase-b-transaction-authority-validator.test.ts',
      test: 'derives the complete C2-R1 candidate set and canonical inventory',
      r8Observed: 'threads-r1 timeout at about 22266ms against source timeout 20000ms',
    },
  ],
};

const stage8Audit = `# Stage 8 source audit

- F1 is a Python-backed image transform. The test first asserts the policy rejection MULTIMODAL_VALIDATION_REQUIRED, then enables multimodal validation and verifies document text plus a 320x180 px BoundingBoxSelector.
- F2 constructs the first output through the fixture helper, constructs a replacement PythonDocumentFormatAdapter, and compares the upper contract keys for the output, documentIR, and sourceMap.
- Neither test changes Product code, dependency versions, Vitest config, or the fixture. Both run through the same adapter boundary and intentionally exercise subprocess-backed transformation.
- Source locations: tests/unit/stage-8-format-expansion.test.ts:113 and :201.
- R9 result: F1 and F2 each passed 5/5 exact forks-1 runs, 3/3 threads-1 exact runs, and their containing Stage 8 file passed all isolated/pairwise/group runs. No intrinsic semantic failure was observed.
`;
const ts1Audit = `# TS-1 XLSX source audit

- F3 is the high-cardinality XLSX case in tests/unit/ts1-document-format-boundary.test.ts. The source timeout is the existing 15_000 ms case timeout.
- The same file also contains the R7-frozen 15_000 ms timeout for the combined valid 1600-cell CSV plus invalid 8193-cell CSV test. R9 did not modify that line.
- The test asserts only the format boundary: valid high-cardinality input produces at least the required block count. It does not write Canonical data or call a database.
- Source locations: tests/unit/ts1-document-format-boundary.test.ts:260 and :289.
- R9 result: F3 passed 5/5 exact forks-1 runs, 3/3 threads-1 exact runs, and the entire TS-1 file passed all isolated/pairwise/group runs. No intrinsic semantic failure was observed.
`;
const validatorAudit = `# C2 validator source audit

- F4 calls buildAuditShape(ROOT) and asserts 120 candidate identities, 11 raw transaction sites, 113 boundaries, 1 participant, and the frozen crosswalk counts.
- The validator reads repository source and the frozen JSON fixture; it is CPU/filesystem-heavy but has no database or external service dependency.
- The source timeout is the existing 20_000 ms case timeout at tests/unit/ts6-phase-b-transaction-authority-validator.test.ts:41.
- R9 result: F4 passed 5/5 exact forks-1 runs, 3/3 threads-1 exact runs, the validator file passed forks-1 and threads-1 runs, and standalone unit/audit/verify all passed. The only R9 reproduction was during full-suite sandbox contention, where the same test exceeded 20s under both V3 and V4.
`;

const runSummary = (files, flags, repeats, status, note) => ({ files, flags, repeats, status, note });

const classifications = {
  generatedAt: new Date().toISOString(),
  overall: 'ALL_FOUR_NOT_INTRINSIC_UNDER_ISOLATION; SUITE_WIDE_CONTENTION_AND_CAPACITY_REMAINS',
  failures: {
    F1: { classification: 'SUITE_WIDE_CONTENTION_ARTIFACT', isolated: '5/5 pass', fileAndPairwise: 'all pass', semanticFailure: false, confidence: 'high' },
    F2: { classification: 'SUITE_WIDE_CONTENTION_ARTIFACT', isolated: '5/5 pass', fileAndPairwise: 'all pass', semanticFailure: false, confidence: 'high' },
    F3: { classification: 'SUITE_WIDE_CONTENTION_ARTIFACT', isolated: '5/5 pass', fileAndPairwise: 'all pass', semanticFailure: false, confidence: 'high' },
    F4: { classification: 'SUITE_WIDE_CONTENTION_ARTIFACT_PLUS_ENVIRONMENT_CAPACITY_LIMIT', isolated: '5/5 pass; standalone validator pass', fileAndPairwise: 'all real-worktree groups pass; sandbox whole-suite timeout under V3 and V4', semanticFailure: false, confidence: 'high' },
  },
  noNewProductFailure: true,
  noFifthAssertionFailure: true,
  rpc: {
    realWorktreeVitest3: 'one unhandled onTaskUpdate RPC timeout; 156/156 files and 1256/1256 assertions pass; exit 1',
    sandboxVitest3: 'no RPC error in valid rebuilt sandbox; one F4 timeout',
    sandboxVitest4: 'no RPC error; one F4 timeout',
  },
};

const closureReport = `# TS-6 Phase B C2-R9 — Parallel Resource Contention Attribution and Controlled Vitest A/B Resumption

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

Worktree: C:\\dev\\shotgun-ts6-phase-b
Branch: ${currentBranch}
HEAD: ${head}
main: ${main}
Active root Vitest: ${activeVitest}
Declared test:unit: ${packageJson.scripts['test:unit']}
Declared Vitest: ${packageJson.devDependencies.vitest}
Fixture SHA: ${fixtureSha}

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
`;

const finalHandoff = `TS-6 PHASE B C2-R9 FINAL HANDOFF

Disposition: AUDIT_PASS / REMEDIATION_REQUIRED / STOP

All four R8 failures are classified as non-intrinsic under isolation. The real Vitest 3.2.7 suite remains assertion-clean but exits 1 on one onTaskUpdate RPC error. Controlled rebuilt sandboxes show V3 and V4 both retain the full-suite F4 validator timeout; V4 removes the RPC error but does not close the contention/capacity problem. This is multi-cause remediation, not a migration-only closure.

No real-worktree Product, dependency, lockfile, config, CI, fixture, database or R7 functional change was made. No commit, push, PR, Ready, Stage COMPLETE, or TS-7 transition.

Artifacts: shotgun-ts6-phase-b-c2-r9-review-20260921.zip
ZIP and manifest hashes are printed by the rebuild script and recorded in the controller report.
`;

await writeStage('01-identity.txt', `worktree=C:\\dev\\shotgun-ts6-phase-b\nbranch=${currentBranch}\nHEAD=${head}\nmain=${main}\nrootVitest=${activeVitest}\nnode=${process.version}\nparallelism=${os.availableParallelism()}\n`);
await writeStage('02-worktree-before.txt', `${currentStatus}\n\ngit diff --check:\n${currentDiffCheck || 'PASS'}\n`);
await writeStage('03-frozen-artifact-references.txt', frozen);
await writeStage('04-r7-functional-diff.txt', r7Diff || 'R7 functional diff unavailable; inherited one-line timeout correction is recorded in the closure report.');
await writeStage('05-r8-new-failure-inventory.json', failureInventory);
await writeStage('06-stage8-source-audit.md', stage8Audit);
await writeStage('07-ts1-xlsx-source-audit.md', ts1Audit);
await writeStage('08-validator-source-audit.md', validatorAudit);
await writeStage('09-default-worker-count.txt', `Node os.availableParallelism()=${os.availableParallelism()}\nVitest 3.2.7 source: node_modules/vitest/dist/chunks/coverage.DfSpMS-b.js:2609-2613\nNon-watch default threadsCount=max(numCpus-1,1)=7\nDefault config pool=forks; equivalent maxForks resolves from config.maxWorkers or threadsCount, so effective default capacity is 7 on this host when no CLI override is supplied.\nObserved: forks-default affected set 2/2 clean; official whole-suite default produced one RPC error; exact worker ownership is not inferred from global process counts.`);
await writeStage('10-isolated-assertion-runs.txt', [
  runSummary('F1', 'forks maxWorkers=1 fileParallelism=false', '5', 'PASS 5/5', 'not intrinsic'),
  runSummary('F2', 'forks maxWorkers=1 fileParallelism=false', '5', 'PASS 5/5', 'not intrinsic'),
  runSummary('F3', 'forks maxWorkers=1 fileParallelism=false', '5', 'PASS 5/5', 'not intrinsic'),
  runSummary('F4', 'forks maxWorkers=1 fileParallelism=false', '5', 'PASS 5/5', 'not intrinsic'),
].map((x) => JSON.stringify(x)).join('\n'));
await writeStage('11-isolated-file-runs.txt', [
  runSummary('Stage8', 'forks maxWorkers=1 fileParallelism=false', '3', 'PASS 3/3', 'all 13 tests'),
  runSummary('TS1', 'forks maxWorkers=1 fileParallelism=false', '3', 'PASS 3/3', 'all 18 tests'),
  runSummary('validator', 'forks maxWorkers=1 fileParallelism=false', '3', 'PASS 3/3', 'all 24 tests'),
].map((x) => JSON.stringify(x)).join('\n'));
await writeStage('12-pairwise-contention-runs.txt', [
  runSummary('P1 Stage8+TS1', 'forks maxWorkers=2 fileParallelism=true', '3', 'PASS 3/3', 'no RPC'),
  runSummary('P2 Stage8+validator', 'forks maxWorkers=2 fileParallelism=true', '3', 'PASS 3/3', 'no RPC'),
  runSummary('P3 TS1+validator', 'forks maxWorkers=2 fileParallelism=true', '3', 'PASS 3/3', 'no RPC'),
].map((x) => JSON.stringify(x)).join('\n'));
await writeStage('13-three-file-contention-runs.txt', JSON.stringify(runSummary('Stage8+TS1+validator', 'forks maxWorkers=3 fileParallelism=true', '3', 'PASS 3/3', 'no RPC'), null, 2));
await writeStage('14-forks-scale-runs.txt', [
  JSON.stringify(runSummary('affected-set', 'forks maxWorkers=4 fileParallelism=true', '2', 'PASS 2/2', 'no RPC')),
  JSON.stringify(runSummary('affected-set', 'forks default worker count', '2', 'PASS 2/2', 'no RPC')),
].join('\n'));
await writeStage('15-whole-suite-default.txt', `Command: npm run test:unit\nPool: installed default forks; no CLI overrides\nReal worktree result: 156/156 test files passed; 1256/1256 tests passed; 1 unhandled [vitest-worker]: Timeout calling "onTaskUpdate"; exitCode=1.\nThis is an error-only failure, not an assertion failure.\n`);
await writeStage('16-threads-isolated-runs.txt', [
  'F1/F2/F3/F4 exact assertions: each 3/3 at threads maxWorkers=1 fileParallelism=false; PASS.',
  'Affected files Stage8/TS1/validator: each 2/2 at threads maxWorkers=1 fileParallelism=false; PASS.',
].join('\n'));
await writeStage('17-threads-scale-runs.txt', [
  'Affected set threads maxWorkers=2 fileParallelism=true: 2/2 PASS.',
  'Affected set threads maxWorkers=4 fileParallelism=true: 2/2 PASS.',
  'No semantic failure, per-test timeout, or onTaskUpdate error in these controlled runs.',
].join('\n'));
await writeStage('18-resource-contention-observation.json', {
  host: { availableParallelism: os.availableParallelism(), cpuCount: os.cpus().length, node: process.version },
  realWorktreePostRun: { timestamp: '2026-09-21T02:06:37.5852421+09:00', nodeCount: 14, pythonCount: 0, freeMemoryMB: 5937.6, totalMemoryMB: 16267.6 },
  inheritedR8MachineSamples: { peakGlobalNodeByMatrix: { M1: 17, M2: 18, M3: 21, M4: 23 }, minFreeMemoryGB: 4.4, note: 'coarse global samples including desktop processes' },
  r9ControlledRuns: { affectedForksAndThreads: 'all PASS', realDefault: 'RPC error after assertion-clean completion', v3Sandbox: 'F4 timeout', v4Sandbox: 'F4 timeout' },
  interpretation: 'capacity/contention signal; memory pressure is not proven as sole cause; no process leak observed',
});
await writeStage('19-process-hygiene.txt', 'After R9 runs, Python process count was 0 and the global Node count returned to the pre/post desktop baseline of 14. No orphaned test subprocess attributable to the runner was observed.');
await writeStage('20-failure-classification.json', classifications);
await writeStage('21-validator-final.txt', `Standalone validator unit: PASS 24/24\nAudit: PASS\nVerify: PASS\ncandidateCount=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0; missingRegression=0; fixtureMutation=false\nFixture SHA=${fixtureSha}`);
await writeStage('22-fixture-final.txt', `SHA-256=${fixtureSha}\nexpected=256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD\nfixtureMutation=false`);
await writeStage('23-sandbox-source-identity.txt', `Valid A/B source: C:\\dev\\shotgun-ts6-phase-b with current R7/C2 source files and required evidence directories copied to disposable sandboxes. V3 and V4 used npm ci in isolated directories. Invalid preliminary copy attempt was excluded because robocopy dereferenced workspace junctions and omitted required artifacts; it produced setup-only missing-module/artifact errors and is not part of classification.`);
await writeStage('24-sandbox-vitest3.txt', `Sandbox: C:\\dev\\shotgun-ts6-phase-b-r9-sandbox-v3\nVitest: 3.2.7\nCommand: npm run test:unit\nResult: 155/156 files passed; 1255/1256 tests passed; F4 existing 20_000 ms case timeout; no RPC error in valid rebuilt run; exitCode=1.`);
await writeStage('25-sandbox-vitest4.txt', `Sandbox: C:\\dev\\shotgun-ts6-phase-b-r9-sandbox-v4\nVitest: 4.1.10 (sandbox-only; real package.json/lockfile unchanged)\nCommand: npm run test:unit\nResult: 155/156 files passed; 1255/1256 tests passed; same F4 existing 20_000 ms case timeout; no RPC error; exitCode=1.`);
await writeStage('26-vitest-version-ab-resumed.json', { realWorktree: { vitest: activeVitest, changed: false }, sandbox: { vitest3: '3.2.7', vitest4: '4.1.10', sourceSame: true, productChanged: false, lockfileChangedRealWorktree: false }, result: { v3: 'F4 timeout, no RPC', v4: 'F4 timeout, no RPC', rpcRemovedByV4InSandbox: true, contentionRemains: true } });
await writeStage('27-root-cause-decision.md', `# Root-cause decision

The R8 failures are not intrinsic. The first known RPC path is a Vitest 3.2.7 bundled birpc timeout; upstream #8297 is the relevant fix and V4 removes that RPC error in the controlled sandbox. The remaining F4 timeout appears under the full-suite V3 and V4 sandboxes and disappears in all isolated/affected-set runs, so it is a separate suite-wide contention/capacity issue. No single Vitest migration is sufficient closure.
`);
await writeStage('28-remediation-recommendation.md', `# Remediation recommendation

1. Keep the real worktree unchanged and do not raise individual test timeouts again.
2. Run a separately approved resource/scheduling remediation experiment: bound the official suite's worker policy or split high-cost suites while retaining the same test contracts; measure total duration, max RSS, process counts, and failure/replay behavior.
3. Evaluate a Vitest 4 migration in a separate branch/sandbox, pin an exact version, run Contract, Golden Corpus, Security Negative, Adapter Replacement, Migration/Rollback and OSS Integration gates. Treat V4 as RPC remediation only, not as the suite-capacity fix.
4. Preserve the R7 line and all Canonical/Evidence/Approval/Action boundaries. No Stage COMPLETE or TS-7 transition until all required gates pass.
`);
await writeStage('29-final-diff.patch', r7Diff || 'No new R9 Product diff. R7 frozen functional diff is the only scoped test correction.');
await writeStage('30-changed-files.txt', `R9-added-or-updated:\n- docs/engineering/ts6-phase-b-c2-r9-parallel-resource-contention-audit.md\n- scripts/rebuild-ts6-phase-b-c2-r9-review.mjs\n- scripts/ts6-phase-b-c2-r9-targeted-runner.mjs (R9 runner metadata only)\n- scripts/ts6-phase-b-c2-r9-group-runner.mjs\n- artifacts/ts6-phase-b-c2-r9/**\n- shotgun-ts6-phase-b-c2-r9-review-20260921.zip\n\nReal-worktree pre-existing owner/C2 status is preserved below:\n${currentStatus}`);
await writeStage('31-r9-closure-report.md', closureReport);
await writeStage('32-final-handoff-report.md', finalHandoff);

await cp(resolve(evidenceRoot, 'targeted'), join(stage, 'raw', 'targeted'), { recursive: true });
await cp(resolve(evidenceRoot, 'groups'), join(stage, 'raw', 'groups'), { recursive: true });
await writeStage('raw/invalid-sandbox-attempt.txt', 'Excluded setup attempt: robocopy-dereferenced workspace junctions and omitted evidence directories; no result from this attempt is used in R9 classification.');

const collectFiles = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(file));
    else out.push(file);
  }
  return out;
};
const allStageFiles = (await collectFiles(stage)).filter((file) => basename(file) !== '33-sha256-manifest.txt');
const manifest = [];
for (const file of allStageFiles) manifest.push(`${await hashFile(file)}  ${relative(stage, file).replaceAll('\\', '/')}`);
manifest.sort();
await writeStage('33-sha256-manifest.txt', manifest.join('\n'));

await writeFile(resolve(root, 'docs/engineering/ts6-phase-b-c2-r9-parallel-resource-contention-audit.md'), closureReport, 'utf8');
await rm(zipPath, { force: true });
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { cwd: root, stdio: 'inherit', windowsHide: true });
const zipHash = await hashFile(zipPath);
const manifestHash = await hashFile(resolve(stage, '33-sha256-manifest.txt'));
console.log(JSON.stringify({ zipPath, zipSha256: zipHash, manifestSha256: manifestHash, entryCount: manifest.length + 1, bytes: (await stat(zipPath)).size }, null, 2));
