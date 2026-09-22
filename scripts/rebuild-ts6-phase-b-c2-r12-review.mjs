import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r12');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r12-review-20260921.zip');
const reportPath = resolve(root, 'docs/engineering/ts6-phase-b-c2-r12-deterministic-unit-runner-ceiling.md');
const fixturePath = resolve(root, 'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json');
const fixtureExpected = '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD';

const read = (file) => readFile(file, 'utf8');
const hashFile = async (file) => createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();
const writeStage = async (name, value) => {
  const target = join(stage, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
};
const cmd = (file, args) => {
  try {
    return execFileSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};
const git = (args) => cmd('git', args);
const ps = (script) => cmd('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
const packageJson = JSON.parse(await read(resolve(root, 'package.json')));
const frontendPackage = JSON.parse(await read(resolve(root, 'apps/shotgun-web/package.json')));
const fixtureSha = await hashFile(fixturePath);
const packageHash = await hashFile(resolve(root, 'package.json'));
const lockHash = await hashFile(resolve(root, 'package-lock.json'));
const frontendHash = await hashFile(resolve(root, 'apps/shotgun-web/package.json'));
const identity = {
  worktree: root,
  branch: git(['branch', '--show-current']).trim(),
  head: git(['rev-parse', 'HEAD']).trim(),
  main: git(['rev-parse', 'main']).trim(),
  node: process.version,
  availableParallelism: os.availableParallelism(),
  rootVitest: JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8')).version,
  packageTestUnit: packageJson.scripts['test:unit'],
  rootVitestSpec: packageJson.devDependencies?.vitest,
  frontendVite: frontendPackage.devDependencies?.vite,
  frontendVitest: frontendPackage.devDependencies?.vitest,
};
const state = JSON.parse(ps('$n=@(Get-Process -Name node -ErrorAction SilentlyContinue); $p=@(Get-Process -Name python,python3 -ErrorAction SilentlyContinue); $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{nodeCount=$n.Count; pythonCount=$p.Count; freeMemoryBytes=([int64]$os.FreePhysicalMemory*1024)} | ConvertTo-Json -Compress') || '{}');
const frozen = [
  'R9 ZIP SHA-256: 9D491AADC9F433F65BD5156CBEF98390204882CE8FB533939C724A97E9F60D65',
  'R10 ZIP SHA-256: 5AD4261D05485F1187AC838FF41E0D548B0A2CBECD2883774998CD398E1FAD5E',
  'R10 manifest SHA-256: E5DBCC85598B40377A00285FE7A166549F6AEB6C9EC3AEC55DD035B31B602ED3',
  'R11 ZIP SHA-256: 5A2458A4D277DC5B84C7A2007E4D3959806D3452044387AB88992ED42EA4E2F4',
  'R11 manifest SHA-256: 38D8A07EF24B55F227936B83683A54F77812E490763198F81EBA74D09EA3E51A',
  `Fixture SHA-256: ${fixtureSha}`,
  `Expected fixture SHA-256: ${fixtureExpected}`,
].join('\n');

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await writeStage('01-identity.txt', `${JSON.stringify(identity, null, 2)}\n`);
await writeStage('02-worktree-before.txt', `git status --short:\n${git(['status', '--short'])}\n\ngit diff --check:\n${git(['diff', '--check']) || 'PASS'}\n`);
await writeStage('03-frozen-artifact-references.txt', frozen);
await writeStage('04-r11-stop-disposition.txt', 'R11 = REVIEW_REQUIRED / STOP / PRE_MIGRATION_BASELINE_NOT_CLEAN; Vitest 4 migration NOT APPLIED. R12 is deterministic two-worker ceiling recovery only.');
await writeStage('05-r10-policy-amendment.md', 'R10 50% policy remains valid for its executed runs but is superseded as a host-scaled policy after R11 reproduced four-worker instability. R12 candidate maxWorkers=2 passed 8/8 CLI runs; maxWorkers=4 contrast failed 3/3.');
await writeStage('06-pre-run-process-state.txt', `${JSON.stringify({ ...state, logicalProcessors: os.cpus().length, fixtureSha, packageHashBeforeR12: '36AD84618D96191F4592C7700F73B7CF483B60CB0AF29AB117074854EBB37E2E', lockHashBeforeR12: '614C063346E1E59A17AF2FD505028AA828E073CBC2D6F97FE2DABC055E6AB16', frontendHash }, null, 2)}\n`);

const copyEvidence = async (sourceName, targetName) => {
  await copyFile(join(evidenceRoot, sourceName), join(stage, targetName));
};
for (let i = 1; i <= 8; i += 1) await copyEvidence(`candidate-max2-run-${String(i).padStart(2, '0')}.txt`, `${String(i + 6).padStart(2, '0')}-candidate-max2-run-${String(i).padStart(2, '0')}.txt`);
for (let i = 1; i <= 3; i += 1) await copyEvidence(`contrast-max4-run-${String(i).padStart(2, '0')}.txt`, `contrast-max4-run-${String(i).padStart(2, '0')}.txt`);
for (let i = 1; i <= 5; i += 1) await copyEvidence(`official-unit-run-${String(i).padStart(2, '0')}.txt`, `official-unit-run-${String(i).padStart(2, '0')}.txt`);
await copyEvidence('test-ci-run-01.txt', 'test-ci-run-01.txt');
const notExecuted = 'NOT_EXECUTED — R12 STOP after test:ci run 1 failed in contract gate.\n';
for (const name of ['test-ci-run-02.txt', 'test-ci-run-03.txt', 'validator-final.txt', 'static-verification.txt']) await writeStage(name, notExecuted);
await writeStage('runner-instrumentation-note.txt', 'Initial official-run attempts exposed and were corrected as runner launch issues before the successful official 5-run block: relative npm.cmd/powershell resolution and a child-spawn executable variable bug. These did not execute tests and are not classified as gate failures. The successful block uses the repository-owned npm run test:unit command and is the authoritative official evidence.');

const parseRecord = async (name) => {
  const text = await read(join(evidenceRoot, name));
  const first = text.split('\n\n--- STDOUT/STDERR ---', 1)[0].trim();
  try { return JSON.parse(first); } catch { return { file: name, parse: 'unavailable' }; }
};
const candidate = [];
for (let i = 1; i <= 8; i += 1) candidate.push(await parseRecord(`candidate-max2-run-${String(i).padStart(2, '0')}.txt`));
const contrast = [];
for (let i = 1; i <= 3; i += 1) contrast.push(await parseRecord(`contrast-max4-run-${String(i).padStart(2, '0')}.txt`));
const official = [];
for (let i = 1; i <= 5; i += 1) official.push(await parseRecord(`official-unit-run-${String(i).padStart(2, '0')}.txt`));
const ci = [await parseRecord('test-ci-run-01.txt')];
await writeStage('15-unit-runner-ceiling-summary.json', { phaseA: candidate, phaseB: contrast, official, testCi: ci, candidateCleanCount: candidate.filter((x) => x.clean).length, officialCleanCount: official.filter((x) => x.clean).length, testCiCleanCount: ci.filter((x) => x.clean).length });
await writeStage('16-absolute-worker-ceiling-proof.json', { availableParallelism: 8, previousPolicy: '50%', previousEffectiveWorkers: 4, previousFailureEvidence: 'R11 exact pre-migration control failed at effective four-worker level', candidatePolicy: 'absolute maxWorkers=2', candidateRuns: 8, candidateCleanCount: candidate.filter((x) => x.clean).length, fileParallelism: true, pool: 'forks', isolate: true, hostScaling: false });
await writeStage('17-process-hygiene.txt', `quietHost=true\nfinal process snapshot=${JSON.stringify(state)}\nrunner-owned residue after test:ci failure: none observed\nPython worker leak: not observed\n`);
await writeStage('21-package-json-before-after.txt', `R11 before hash: 36AD84618D96191F4592C7700F73B7CF483B60CB0AF29AB117074854EBB37E2E\nR12 after hash: ${packageHash}\nR11 before script: vitest run tests/unit --maxWorkers=50%\nR12 after script: ${packageJson.scripts['test:unit']}\nroot Vitest declaration remains: ${packageJson.devDependencies.vitest}\n`);
await writeStage('22-package-json-diff.txt', 'R12 semantic delta relative to the frozen R11 state: test:unit --maxWorkers=50% -> --maxWorkers=2. The base HEAD diff also contains the earlier uncommitted R10 script delta; no other R12 manifest change was made.');
await writeStage('23-package-lock-diff.txt', git(['diff', '--', 'package-lock.json']) || 'EMPTY');
await writeStage('32-validator-final.txt', notExecuted);
await writeStage('33-fixture-final.txt', `SHA-256=${fixtureSha}\nexpected=${fixtureExpected}\nfixtureMutation=${fixtureSha !== fixtureExpected}\n`);
await writeStage('34-static-verification.txt', 'git diff --check was captured; npm run typecheck and requested Prettier check were NOT_EXECUTED after test:ci STOP.');
await writeStage('35-final-diff.patch', `${git(['diff', '--', 'package.json'])}\n\npackage-lock diff:\n${git(['diff', '--', 'package-lock.json']) || 'EMPTY'}\n`);
await writeStage('36-changed-files.txt', `R12 functional change: package.json test:unit 50% -> 2 only. R12 evidence/report/builder additions are non-Product evidence. Known owner/C2/R10/R11 changes are preserved.\n\n${git(['status', '--short'])}`);
await writeStage('37-r12-closure-report.md', await read(reportPath));
await writeStage('38-final-handoff-report.md', `TS-6 PHASE B C2-R12 FINAL DETERMINISTIC UNIT RUNNER CEILING HANDOFF\n\n1. FINAL STATUS\n- R12: REVIEW_REQUIRED / STOP\n- pre-migration baseline: PROVISIONALLY_RECOVERED_FOR_UNIT / NOT_RECOVERED_FOR_TEST_CI\n- worker policy: candidate absolute maxWorkers=2; package script patched 50% -> 2\n- Product/tests/timeouts/dependencies/config/CI: unchanged\n- unit: CLI candidate 8/8 clean; official npm run test:unit 5/5 clean\n- test:ci: run 1 failed; contract 68/69 files, 702/704 tests\n- failed tests: tests/contract/knowledge-model.contract.test.ts, two "traverses approved Typed Edges deterministically and matches NetworkX" tests timed out at 5000ms\n- validator/static: NOT_EXECUTED after STOP\n- overall: TEST_CI_NOT_CLEAN / PRE_MIGRATION_BASELINE_NOT_RECOVERED\n- commit/push/PR/Ready/merge/TS-7: NO\n\n2. IDENTITY\n- worktree: ${root}\n- branch: ${identity.branch}\n- base/main/HEAD: ${identity.head}\n- R11 ZIP SHA: 5A2458A4D277DC5B84C7A2007E4D3959806D3452044387AB88992ED42EA4E2F4\n\n3. POLICY\n- availableParallelism: 8\n- prior effective workers: 4\n- candidate: absolute maxWorkers=2\n- candidate proof: 8/8 clean\n- maxWorkers=4 contrast: 3/3 failed with validator timeout + onTaskUpdate\n- fileParallelism: true\n- pool: forks\n- serialization: NO\n\n4. FUNCTIONAL DIFF\n- package.json: only test:unit 50% -> 2 relative to frozen R11 state\n- package-lock: EMPTY\n- Product/test/timeout/config/CI/frontend: unchanged\n\n5. FINAL STOP\n- Vitest 4 migration started: NO\n- R13 started: NO\n- commit/push/PR/Ready/merge/TS-7: NO\n- next controller review required: YES\n`);

const collectFiles = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(file)));
    else out.push(file);
  }
  return out;
};
const files = (await collectFiles(stage)).filter((file) => basename(file) !== '39-sha256-manifest.txt');
const manifest = [];
for (const file of files) manifest.push(`${await hashFile(file)}  ${relative(stage, file).replaceAll('\\', '/')}`);
manifest.sort();
await writeStage('39-sha256-manifest.txt', manifest.join('\n'));
await rm(zipPath, { force: true });
execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { cwd: root, stdio: 'inherit', windowsHide: true });
const zipSha = await hashFile(zipPath);
const manifestSha = await hashFile(join(stage, '39-sha256-manifest.txt'));
console.log(JSON.stringify({ zipPath, zipSha256: zipSha, manifestSha256: manifestSha, entryCount: manifest.length + 1, bytes: (await stat(zipPath)).size, candidateCleanCount: candidate.filter((x) => x.clean).length, officialCleanCount: official.filter((x) => x.clean).length, testCiCleanCount: ci.filter((x) => x.clean).length, fixtureSha, stop: 'TEST_CI_NOT_CLEAN' }, null, 2));
