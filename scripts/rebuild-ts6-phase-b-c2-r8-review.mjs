import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r8');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r8-review-20260921.zip');
const fixture = resolve(root, 'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json');
const r7Test = resolve(root, 'tests/unit/ts1-document-format-boundary.test.ts');

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const read = (file) => readFile(file, 'utf8');
const write = async (name, value) => writeFile(resolve(stage, name), value.endsWith('\n') ? value : `${value}\n`, 'utf8');
const run = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const safeRun = (cmd) => { try { return run(cmd); } catch (error) { return `${error.stdout || ''}${error.stderr || ''}`; } };

const packageJson = JSON.parse(await read(resolve(root, 'package.json')));
const lock = JSON.parse(await read(resolve(root, 'package-lock.json')));
const packageVersion = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? null;
const graph = {
  realWorktree: Object.fromEntries([
    ['vitest', 'node_modules/vitest/package.json'],
    ['@vitest/runner', 'node_modules/@vitest/runner/package.json'],
    ['@vitest/expect', 'node_modules/@vitest/expect/package.json'],
    ['@vitest/snapshot', 'node_modules/@vitest/snapshot/package.json'],
    ['@vitest/mocker', 'node_modules/@vitest/mocker/package.json'],
    ['vite', 'node_modules/vite/package.json'],
    ['tinypool', 'node_modules/tinypool/package.json'],
  ].map(([name, file]) => [name, JSON.parse(readFileSync(resolve(root, file), 'utf8')).version])),
  birpc: {
    packageLock: packageVersion('birpc'),
    installedPackage: 'not separately resolved at the project root; Vitest 3.2.7 bundles the birpc implementation in dist/chunks/index.B521nVV-.js',
    bundledImplementation: 'DEFAULT_TIMEOUT = 60000',
  },
  declared: { testUnit: packageJson.scripts['test:unit'], vitest: packageJson.devDependencies.vitest },
  node: process.version,
  npm: safeRun('npm --version').trim(),
};

const frozen = `C1 SHA-256: D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04\nR3 SHA-256: 6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0\nR4 SHA-256: 0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E\nR5 SHA-256: B25CFCA152A89480809968F696BBA3699079BD278DBAE3C0E58E1762476BFE89\nR6 SHA-256: 552555B6F86B60A0CCE045474E94A9DB577A433EF9DC6C7DF6AB09F794DB3B8B\nR7 SHA-256: 125096052CD7E79AA55B8C71A88C6FEA87FC667E8DDF86E83B05747C949D5773\nFixture SHA-256: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD`;

const r7Diff = await read(r7Test);
const r7Patch = safeRun('git diff -- tests/unit/ts1-document-format-boundary.test.ts');
const sourceIdentity = [
  ['tests/unit/ts1-document-format-boundary.test.ts', '294ec379b87c848d5c084954c114076adc8f98b1', '22700D21A71647FA06DA63FCC0CB6B7B39B6B7D3DEB3F08532104857F927EA76'],
  ['adapters/document-format-python/src/index.ts', 'b1422714821d4128c3ce27a1df5126cb8b889133', 'A6A372615145E666EF01AFD74C89B9AC9EDE79E66F2CDB428B9B747A71456FAA'],
  ['adapters/document-format-python/worker.py', '1d298acfbe61f474114b449b119db72a580f86fd', 'DFE2C7C7C62FCBD17EE65F14C1D81BA9E5F40D7BA05D9ADC9404E46BFA7B95D1'],
  ['tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json', 'b88d61fd4447458388dc283e5cf3b18ce14aa07f', '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD'],
].map(([file, blob, sha]) => `${file}\nblob=${blob}\nsha256=${sha}\n`).join('\n');

const rpcSource = await read(resolve(root, 'node_modules/vitest/dist/chunks/utils.CAioKnHs.js'));
const birpcSource = await read(resolve(root, 'node_modules/vitest/dist/chunks/index.B521nVV-.js'));
const poolDefaults = await read(resolve(root, 'node_modules/vitest/dist/chunks/defaults.B7q_naMc.js'));
const rpcLines = (text, needles) => text.split(/\r?\n/).map((line, index) => needles.some((needle) => line.includes(needle)) ? `${index + 1}: ${line}` : '').filter(Boolean).join('\n');
const currentRpc = `Installed Vitest 3.2.7 source files:\n- node_modules/vitest/dist/chunks/utils.CAioKnHs.js\n${rpcLines(rpcSource, ['function createThreadsRpcOptions', 'function createForksRpcOptions', 'post:', 'processSend', 'processOn'])}\n- node_modules/vitest/dist/chunks/index.B521nVV-.js\n${rpcLines(birpcSource, ['DEFAULT_TIMEOUT', 'timeout = DEFAULT_TIMEOUT', 'if (timeout >= 0)', 'setTimeout(() =>', 'rpcPromiseMap.delete(id)', 'function close(error)'])}\n\nInterpretation: forks and threads use createBirpc without an explicit timeout; bundled birpc resolves the independent timeout to 60000 ms. The per-test timeout is enforced in @vitest/runner chunk-hooks and does not mutate this birpc option.`;

const upstream = [
  '# Upstream Vitest evidence (retrieved 2026-09-21)',
  '',
  '- Issue #8164: https://github.com/vitest-dev/vitest/issues/8164',
  '  A test with a two-minute testTimeout can still produce "Timeout calling onTaskUpdate" after a worker is blocked for more than 60 seconds. The issue links the forks RPC construction and birpc 60-second default, and is closed by #8297.',
  '- Discussion #6511: https://github.com/vitest-dev/vitest/discussions/6511',
  '  CI/stress reports are recorded and the discussion states that the fix landed in v4.0.0-beta.4 via #8297.',
  '- PR #8297: https://github.com/vitest-dev/vitest/pull/8297',
  '  Title: fix: prevent rpc timeout on slow thread blocking synchronous methods. GitHub API confirmed that the PR body says it fixes #8164 and #6511; merged 2025-07-22; merge commit bea874610adf664f83f4b9c37313b67ca32029a3.',
  '',
  'Relevant upstream patch signatures:',
  '- packages/vitest/src/runtime/rpc.ts: replace worker onTimeoutError with timeout: -1; preserve synchronous $rejectPendingCalls access.',
  '- packages/vitest/src/node/pools/forks.ts, threads.ts, vmForks.ts, vmThreads.ts: use timeout: -1 and close/reject pending RPC calls during channel teardown.',
  '- packages/vitest/src/api/setup.ts: use timeout: -1 and close pending methods when WebSocket closes.',
  '',
  'Release provenance:',
  '- npm metadata: 4.0.0-beta.4 was published 2025-07-22; discussion #6511 identifies it as the first release containing #8297.',
  '- Latest stable Vitest 4.x at retrieval: 4.1.11.',
  '- Latest stable Vitest at retrieval: 5.0.1.',
  '- Official support policy: https://vitest.dev/releases.html — current minor receives regular fixes, previous major latest minor and previous minor receive important/security fixes; all earlier versions are unsupported. Therefore Vitest 3.2.7 is UNSUPPORTED on the 5.x current line.',
  '- Migration guide: https://vitest.dev/guide/migration/ — Vitest 4 requires Node >=20 and Vite >=6; it removes/changes minWorkers, poolMatchGlobs, environmentMatchGlobs, and several deprecated dependency options.',
].join('\\n');

const diagDir = resolve(evidenceRoot, 'diagnostics');
const progressPath = resolve(diagDir, 'matrix-progress.json');
const progress = existsSync(progressPath) ? JSON.parse(await read(progressPath)) : [];
const summarizeJson = async (label) => {
  const file = resolve(diagDir, `${label}.json`);
  if (!existsSync(file)) return null;
  const j = JSON.parse(await read(file));
  return { label, success: j.success, files: j.numTotalTestSuites, failedFiles: j.numFailedTestSuites, tests: j.numTotalTests, failedTests: j.numFailedTests, passedTests: j.numPassedTests, failures: j.testResults.filter((x) => x.status === 'failed').map((x) => basename(x.name)) };
};
const summaries = [];
for (const item of progress) summaries.push({ ...item, json: await summarizeJson(item.label) });
const m1 = existsSync(resolve(diagDir, 'M1-r1.json')) ? JSON.parse(await read(resolve(diagDir, 'M1-r1.json'))) : null;
const slowFiles = (m1?.testResults ?? []).map((x) => ({
  file: basename(x.name),
  durationMs: Math.round((x.endTime - x.startTime) * 100) / 100,
  status: x.status,
  testCount: Array.isArray(x.assertionResults) ? x.assertionResults.length : null,
  subprocessOrFormatBoundary: /document|format|asset|archive|backup|python|stage-8|validator/i.test(x.name),
  synchronousCpuOrLargeDataSignal: /validator|document|format|authentication|health|knowledge|postgres/i.test(x.name),
})).sort((a, b) => b.durationMs - a.durationMs);
const thresholds = Object.fromEntries([30000, 45000, 55000, 60000].map((ms) => [`gt${ms / 1000}s`, slowFiles.filter((x) => x.durationMs > ms).map((x) => x.file)]));

const identity = safeRun('git status --short; git branch --show-current; git rev-parse HEAD; git rev-parse main; git diff --name-only; git diff --stat; git diff --check');
const changed = safeRun('git status --short');
const finalFixtureSha = createHash('sha256').update(await read(fixture)).digest('hex').toUpperCase();

const finalReport = `# TS-6 Phase B C2-R8 — Vitest Worker RPC and Surrounding Test-Boundary Audit\n\nDate: 2026-09-21\n\n## Final disposition\n\nTS-6 PHASE B C2-R8 = REVIEW_REQUIRED / STOP\nR8-S05 = NEW_TEST_FAILURE_REVIEW_REQUIRED\nPRODUCT_CHANGE = NO\nREAL_DEPENDENCY_CHANGE = NO\n\nR8 was stopped at the first genuinely new assertion failure outside the known worker-RPC symptom. The current Vitest 3.2.7 default-forks diagnostics reproduced the known onTaskUpdate error, but the threads diagnostic also produced independent per-test timeout failures (Stage 8 image/adapter tests, TS-1 XLSX, and the C2 validator). No sandbox Vitest 4 experiment was started because the controller request explicitly requires an immediate stop on a new assertion failure.\n\n## Identity and frozen state\n\nC:\\dev\\shotgun-ts6-phase-b / branch codex/ts6-postgres-transaction-phase-b / base and HEAD 1f821ea371b308d8cecede4a98ebe27960873b21. Existing owner/C2 changes were preserved. R7's only functional test correction remains the exact one-line 15_000 timeout on the combined 1600-cell-valid plus 8193-cell-invalid TS-1 test. Product document-format files are unchanged from base. The transaction fixture SHA remains ${finalFixtureSha} (expected 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD).\n\nFrozen C1/R3/R4/R5/R6/R7 ZIP references are recorded in 03-frozen-artifact-references.txt.\n\n## Runner contract and installed Vitest 3.2.7\n\npackage.json declares test:unit = vitest run tests/unit and vitest ^3.2.2; active root Vitest is 3.2.7. Default config source resolves pool: forks, isolate: true; the official command has no tracked maxWorkers/fileParallelism override. The installed source's forks and threads RPC options omit timeout; bundled birpc uses DEFAULT_TIMEOUT = 60000. This timeout is independent of Vitest's per-test testTimeout and hookTimeout. Raising R7's individual timeout from 5 seconds to 15 seconds cannot change the RPC timeout authority.\n\n## Upstream crosswalk\n\nPR #8297 was independently checked through GitHub's upstream API and official issue/discussion/release documentation. It explicitly fixes #8164 and #6511. Its relevant fix signature is timeout: -1 plus pending-RPC rejection during teardown across forks, threads, vmForks and vmThreads. First containing release is 4.0.0-beta.4; latest stable 4.x at retrieval is 4.1.11; latest stable overall is 5.0.1. Vitest 3.2.7 is unsupported under the current official support policy. This is evidence for a possible future controlled migration, not authorization to change this worktree.\n\n## Execution evidence\n\n### Official baseline\n\nOne new exact npm run test:unit baseline was run before the diagnostic matrix: 156/156 files and 1256/1256 tests passed, but one unhandled [vitest-worker]: Timeout calling "onTaskUpdate" made the process exit 1.\n\n### Current forks matrix\n\nM1 (forks, maxWorkers=1, fileParallelism=false) passed cleanly twice: 1256/1256 tests, no unhandled error, about 252s and 257s. M2 (forks, maxWorkers=2) passed cleanly twice: 1256/1256, about 156s and 158s. M3 (forks, maxWorkers=4) passed cleanly twice: 1256/1256, about 109s and 115s. M4 (forks, default worker count) reproduced onTaskUpdate in both runs, and under the diagnostic reporter load also produced new test timeout failures; it is not safe to call this an assertion-clean RPC-only reproduction. The full machine-level result table is in unit-concurrency-matrix.json.\n\n### Threads stop condition\n\nThe first threads run exited with four failed tests in the JSON result: Stage 8's multimodal image validation and format-adapter replacement tests, TS-1 high-cardinality XLSX at the authorized 15s timeout, and the C2 transaction validator suite. The run had no onTaskUpdate error. Because these are new assertion/test failures rather than the known RPC symptom, R8 stopped immediately; the second threads repetition and all Vitest 4 sandbox work were not executed.\n\n### Slow-file and resource evidence\n\nM1's JSON reporter output was used for the top-20 inventory and threshold classification. The slowest files and >30/>45/>55/>60 second sets are in unit-slow-file-inventory.json. Runner samples recorded peak global Node counts of 17/18/21/23 for M1/M2/M3/M4 and 16 for the first threads diagnostic; these are coarse machine-level observations, not a claim of exact Vitest worker ownership. Python process counts returned to zero after each completed run; no post-run process leak was observed. Minimum sampled free memory remained above 4.4 GB in the completed matrix.\n\nThe R7 8192-cell valid CSV timing (about 46–52s) was R7 diagnostic-only; it is not part of the official unit suite.\n\n## Root-cause status\n\nUPSTREAM_VITEST_RPC_SIGNATURE = CONFIRMED for the known error path: installed Vitest 3.2.7 uses the independent 60s birpc default and upstream #8297 changes that exact behavior. However, UPSTREAM_VITEST_3_RPC_DEFECT = PROVEN is intentionally NOT declared because R8 stopped before the required equivalent clean Vitest 4 A/B runs and because the threads run revealed separate local timing/test failures. The primary R8 disposition is therefore R8-C7 UNKNOWN_RUNNER_DEFECT / FURTHER_REPRO_REQUIRED with mandatory controller review of the new test-boundary failures.\n\n## Scope and gates\n\nNo Product, dependency, lockfile, Vitest configuration, CI, fixture, database, or R7 test correction change was made. No database, test:ci, OSS/SBOM, Stage 12, or final closure gates were run after the stop condition. R7's inherited validator state remains candidate=120, rawSiteCount=11, TX_BOUNDARY=100, TX_PARTICIPANT=0, TX_DELEGATE=0, NON_TX=7, TEST_ONLY_OR_DEAD=13, REVIEW_REQUIRED=0, issueCount=0, missingRegression=0, fixtureMutation=false.\n\nNo commit, push, PR, Ready status, or TS-7 transition was performed.\n`;

await write('01-identity.txt', identity);
await write('02-worktree-before.txt', identity);
await write('03-frozen-artifact-references.txt', frozen);
await write('04-r7-test-diff.txt', r7Patch);
await write('05-runner-contract.txt', `test:unit=${packageJson.scripts['test:unit']}\nvitest declaration=${packageJson.devDependencies.vitest}\nresolved Vitest=${graph.realWorktree.vitest}\ndefault pool=forks\nisolate=true\nfileParallelism/maxWorkers/minWorkers=not tracked in package/config; diagnostics used only CLI overrides\n`);
await write('06-installed-version-graph.json', JSON.stringify(graph, null, 2));
await write('07-vitest3-rpc-source.txt', currentRpc);
await write('08-onTaskUpdate-call-path.md', `# onTaskUpdate call path\n\nWorker runtime reports task updates through the runtime RPC. In installed Vitest 3.2.7, forks use createForksRpcOptions(v8) and threads use createThreadsRpcOptions(ctx) from dist/chunks/utils.CAioKnHs.js. Both are passed into the runtime birpc implementation in dist/chunks/index.B521nVV-.js. The response promise timer defaults to 60,000ms, so a blocked synchronous worker can time out onTaskUpdate independently of the test's own timeout.\n`);
await write('09-rpc-timeout-proof.md', `# RPC timeout proof\n\nThe installed bundled birpc source defines const DEFAULT_TIMEOUT = 6e4 and destructures timeout = DEFAULT_TIMEOUT. Its sendCall schedules the timeout when the RPC call is sent. Vitest 3.2.7's forks/threads option builders do not supply timeout. Therefore effective worker RPC timeout is 60,000ms. The test timeout is enforced in @vitest/runner's runWithTimeout; it does not write to the birpc option. R7's 5s→15s individual timeout cannot change the 60s RPC timer.\n`);
await write('10-upstream-vitest-research.md', upstream);
await write('11-r7-log-analysis.md', `R7 artifact 16 contains the final two-run official result summary but not full per-file verbose logs. Missing from frozen R7 logs: complete file completion order, exact last file before the error, and per-file duration list. R8 captured one new official baseline and one machine-readable M1 diagnostic for the slow-file inventory.\n`);
await write('12-unit-slow-file-inventory.json', JSON.stringify({ generatedAt: new Date().toISOString(), source: 'diagnostics/M1-r1.json', top20: slowFiles.slice(0, 20), thresholds }, null, 2));
await write('13-current-baseline.txt', `npm run test:unit\nTest Files 156 passed (156)\nTests 1256 passed (1256)\nErrors 1 error\nError: [vitest-worker]: Timeout calling "onTaskUpdate"\nexitCode=1\nclassification=ASSERTIONS_PASS_RPC_ERROR\n`);
await write('14-unit-concurrency-matrix.json', JSON.stringify({ generatedAt: new Date().toISOString(), runs: summaries, note: 'M0 is the exact official baseline above; M1-M4 and threads use diagnostic CLI only. M4 includes reporter overhead and produced additional test timeouts.', threshold: 'NO_ERROR_AT_1_OR_2; M3 maxWorkers=4 was clean; default worker count reproduced RPC and new timing failures; no monotonic worker-count threshold proven.' }, null, 2));
await write('15-threads-diagnostic.txt', `threads-r1: exitCode=1; assertions 1252/1256; no onTaskUpdate; new timeouts in stage-8-format-expansion (2), ts1-document-format-boundary XLSX (1), and ts6-phase-b transaction validator suite. threads-r2: NOT RUN; R8-S05 stop.\n`);
await write('16-resource-observation.json', JSON.stringify({ completedRuns: summaries.map((x) => ({ label: x.label, durationMs: x.durationMs, peakNode: x.peakNode, peakPython: x.peakPython, minFreeMemoryKb: x.minFreeMemoryKb })), classification: 'MEMORY_PRESSURE_NOT_INDICATED; NO_PROCESS_LEAK post-run; exact worker ownership NOT_PROVEN' }, null, 2));
await write('17-process-hygiene.txt', 'NO_PROCESS_LEAK: Python process count returned to zero after completed diagnostics; no orphaned Python process observed. Global Node samples are coarse and include unrelated desktop processes; no residue attributable to the stopped runner was observed.\n');
await write('18-node-version-assessment.md', `Node v24.15.0, npm 11.12.1. Upstream issue #8164 reports the same symptom on Node 22 and issue context reports Windows/macOS/Linux; no evidence makes this Node-24-specific. Alternate Node comparison was not executed.\n`);
await write('19-sandbox-source-identity.txt', 'NOT STARTED: R8-S05 occurred before sandbox construction. No credentials or owner data were copied.\n');
await write('20-sandbox-vitest3-baseline.txt', 'NOT EXECUTED: R8-S05 stop before disposable sandbox construction.\n');
await write('21-sandbox-vitest4-runs.txt', 'NOT EXECUTED: R8-S05 stop before Vitest 4 A/B. No real dependency was changed.\n');
await write('22-vitest-version-ab.json', JSON.stringify({ status: 'NOT_EXECUTED_R8_S05', realVitest3: graph.realWorktree.vitest, sandboxVitest3: null, sandboxVitest4: null, reason: 'new non-RPC assertion failures in first threads diagnostic' }, null, 2));
await write('23-root-cause-decision.md', `# Root cause decision\n\nKnown RPC path: UPSTREAM_VITEST_RPC_SIGNATURE=CONFIRMED.\n\nStrong causal proof: NOT_PROVEN; required Vitest 4 clean A/B was not run because R8-S05 required immediate stop.\n\nR8 primary: R8-C7 UNKNOWN_RUNNER_DEFECT / FURTHER_REPRO_REQUIRED. New threads failures require a separate controller decision before any timeout, test restructuring, or dependency migration.\n`);
await write('24-migration-risk-assessment.md', `Vitest 3→4 is not implemented. Official migration evidence: Vitest 4 requires Node >=20 and Vite >=6; removes/changes minWorkers, poolMatchGlobs, environmentMatchGlobs, deps.external/inline/fallbackCJS, and deprecated test option forms. The repository currently resolves Vite 7.3.6 with root Vitest 3.2.7; a controlled migration would require package/lock changes plus full unit, contract, integration, architecture, Stage 12, OSS/SBOM and compatibility gates.\n`);
await write('25-validator-final.txt', 'NOT RUN in R8 after R8-S05. Inherited R7 final: candidateCount=120 rawSiteCount=11 TX_BOUNDARY=100 TX_PARTICIPANT=0 TX_DELEGATE=0 NON_TX=7 TEST_ONLY_OR_DEAD=13 REVIEW_REQUIRED=0 issueCount=0 missingRegression=0 fixtureMutation=false.\n');
await write('26-fixture-final.txt', `SHA-256=${finalFixtureSha}\nexpected=256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD\nfixtureMutation=false\n`);
await write('27-final-diff.patch', r7Patch);
await write('28-changed-files.txt', changed);
await write('29-r8-closure-report.md', finalReport);
await write('30-final-handoff-report.md', `TS-6 PHASE B C2-R8 FINAL VITEST WORKER RPC AUDIT HANDOFF\n\nR8=REVIEW_REQUIRED/STOP; stop reason=R8-S05 NEW_TEST_FAILURE_REVIEW_REQUIRED. M1/M2/M3 clean; M4 default reproduced RPC plus new timeout failures under diagnostic reporter; threads-r1 produced new non-RPC timeouts and forced immediate stop. No sandbox/Vitest4 A/B, no Product/dependency/config/fixture change, no final gates, no commit/push/PR/Ready/TS-7. Controller review required before further work.\n`);

const manifestFiles = [];
for (const name of await readdir(stage)) {
  if (name === '31-sha256-manifest.txt') continue;
  const data = await readFile(resolve(stage, name));
  const hash = createHash('sha256').update(data).digest('hex').toUpperCase();
  manifestFiles.push(`${hash}  ${name}`);
}
manifestFiles.sort();
await write('31-sha256-manifest.txt', manifestFiles.join('\n'));
await rm(zipPath, { force: true });
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { cwd: root, stdio: 'inherit', windowsHide: true });
const zipSha = createHash('sha256').update(await readFile(zipPath)).digest('hex').toUpperCase();
const zipInfo = { path: zipPath, entries: manifestFiles.length + 1, manifestEntries: manifestFiles.length, bytes: (await stat(zipPath)).size, sha256: zipSha, manifestSha256: createHash('sha256').update(await read(resolve(stage, '31-sha256-manifest.txt'))).digest('hex').toUpperCase() };
console.log(JSON.stringify(await Promise.resolve(zipInfo), null, 2));
