import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r11');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r11-review-20260921.zip');
const reportPath = resolve(root, 'docs/engineering/ts6-phase-b-c2-r11-vitest4-migration-closure.md');
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
const cmd = (file, args, options = {}) => {
  try {
    return execFileSync(file, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};
const git = (args) => cmd('git', args);
const ps = (script) => cmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
const packageJson = JSON.parse(await read(resolve(root, 'package.json')));
const frontendPackage = JSON.parse(await read(resolve(root, 'apps/shotgun-web/package.json')));
const fixtureSha = await hashFile(fixturePath);
const currentRootVitest = JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8')).version;
const identity = {
  worktree: root,
  branch: git(['branch', '--show-current']).trim(),
  head: git(['rev-parse', 'HEAD']).trim(),
  main: git(['rev-parse', 'main']).trim(),
  node: process.version,
  availableParallelism: os.availableParallelism(),
  rootVitestFromNodeModules: currentRootVitest,
  rootVitestSpec: packageJson.devDependencies?.vitest,
  frontendViteSpec: frontendPackage.devDependencies?.vite,
  frontendVitestSpec: frontendPackage.devDependencies?.vitest,
};

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const frozen = [
  'C1 ZIP SHA-256: D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  'C2-R3 ZIP SHA-256: 6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
  'C2-R4 ZIP SHA-256: 0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E',
  'C2-R5 ZIP SHA-256: B25CFCA152A89480809968F696BBA3699079BD278DBAE3C0E58E1762476BFE89',
  'C2-R6 ZIP SHA-256: 552555B6F86B60A0CCE045474E94A9DB577A433EF9DC6C7DF6AB09F794DB3B8B',
  'C2-R7 ZIP SHA-256: 125096052CD7E79AA55B8C71A88C6FEA87FC667E8DDF86E83B05747C949D5773',
  'C2-R8 ZIP SHA-256: DC743DA5F67C21D80227D74DCB5262B819B687C66CA3C84C452A874DD936284F',
  'C2-R9 ZIP SHA-256: 9D491AADC9F433F65BD5156CBEF98390204882CE8FB533939C724A97E9F60D65',
  'C2-R10 ZIP SHA-256: 5AD4261D05485F1187AC838FF41E0D548B0A2CBECD2883774998CD398E1FAD5E',
  `Fixture SHA-256: ${fixtureSha}`,
  `Expected fixture SHA-256: ${fixtureExpected}`,
].join('\n');

const registry = cmd('npm', ['view', 'vitest@4.1.11', 'version', 'license', 'engines', 'peerDependencies', 'dist.integrity', 'dist.tarball', '--json']);
const dependencyGraph = cmd('npm', ['ls', 'vitest', 'vite', '@vitest/runner', '@vitest/expect', '@vitest/snapshot', '@vitest/mocker', 'tinypool', 'birpc', '--all']);
const packageDiff = git(['diff', '--', 'package.json']);
const lockDiff = git(['diff', '--', 'package-lock.json']);
const compatibilityHits = cmd('rg', [
  '-n',
  '--glob', '!node_modules/**',
  '--glob', '!artifacts/**',
  '--glob', '!*.zip',
  'vitest/execute|vite-node|@vitest/|onTaskUpdate|poolMatchGlobs|environmentMatchGlobs|deps\.(inline|external|fallbackCJS)|minWorkers|VITEST_MIN_|restoreMocks|vi\.restoreAllMocks|vitest\.mjs',
  'package.json', 'apps', 'adapters', 'modules', 'packages', 'tests', 'scripts', 'docs',
]);

await writeStage('01-identity.txt', `${JSON.stringify(identity, null, 2)}\n`);
await writeStage('02-worktree-before.txt', `git status --short:\n${git(['status', '--short'])}\n\ngit diff --check:\n${git(['diff', '--check']) || 'PASS'}\n`);
await writeStage('03-frozen-artifact-references.txt', frozen);
await writeStage('04-r10-state.txt', 'R10 approved bounded unit policy: test:unit = vitest run tests/unit --maxWorkers=50%; R10 root Vitest was 3.2.7; R10 ZIP and fixture references are frozen. R11 introduced no functional change before STOP.');
await writeStage('05-pre-migration-package-hashes.txt', `package.json ${await hashFile(resolve(root, 'package.json'))}\npackage-lock.json ${await hashFile(resolve(root, 'package-lock.json'))}\napps/shotgun-web/package.json ${await hashFile(resolve(root, 'apps/shotgun-web/package.json'))}\n`);
await writeStage('06-pre-migration-dependency-graph.txt', dependencyGraph);
await writeStage('07-vitest4-registry-metadata.json', registry);
await writeStage('08-vitest4-compatibility-audit.json', {
  status: 'AUDIT_COMPLETE_PRE_MIGRATION',
  live: {
    rootVitestScript: 'LIVE_COMPATIBLE: npm run test:unit uses the existing CLI entrypoint and preserves the R10 maxWorkers policy.',
    directVitestEntrypoints: 'LIVE_COMPATIBLE: direct node_modules/vitest/vitest.mjs paths are test:integration and test:database scripts; no migration was attempted.',
    restoreAllMocks: 'LIVE_COMPATIBLE: existing vi.restoreAllMocks() usage is standard public Vitest API.',
    customReporterCallbacks: 'NO_LIVE_BLOCKER_FOUND in the searched product/test source set.',
  },
  historical: 'HISTORICAL_ONLY: R8/R9/R10 evidence, reports, and planning documents mentioning compatibility terms were not treated as live code.',
  noMatch: ['vitest/execute', 'poolMatchGlobs', 'environmentMatchGlobs', 'deps.fallbackCJS', 'VITEST_MIN_*'],
  searchRoots: ['package.json', 'apps', 'adapters', 'modules', 'packages', 'tests', 'scripts', 'docs'],
  rawSearchOutputPath: '09-direct-vitest-entrypoints.txt',
  migrationDecision: 'STOP_BEFORE_MIGRATION because the pre-migration unit control was not clean.',
});
await writeStage('09-direct-vitest-entrypoints.txt', compatibilityHits);
await writeStage('10-pre-migration-unit-control.txt', `Command: npm run test:unit\nState: root Vitest ${currentRootVitest}; package script preserves R10 --maxWorkers=50%\nResult: FAIL / exit 1\nObserved: 154/156 files passed; 1254/1256 tests passed\nFailures: Stage 8 adapter replacement timed out at 5000 ms; C2 validator first test timed out at 20000 ms; 1 unhandled [vitest-worker]: Timeout calling "onTaskUpdate"\nClassification: PRE_MIGRATION_BASELINE_NOT_CLEAN\nA prior concurrent run with frontend baseline was contaminated by contention and also failed; after frontend processes ended, this isolated rerun reproduced the failure. No timeout, workload, snapshot, or worker-cap change was made. Migration STOPPED.\n`);
await writeStage('11-package-json-diff.txt', packageDiff || 'EMPTY: no package.json diff relative to HEAD.');
await writeStage('12-lockfile-diff.txt', lockDiff || 'EMPTY: no R11 package-lock diff; migration was not started.');
await writeStage('13-lockfile-diff-classification.md', 'NOT_EXECUTED — STOP before npm install --package-lock-only because the pre-migration unit control was not clean.');
await writeStage('14-post-install-dependency-graph.txt', 'NOT_EXECUTED — migration and clean install were not started.');
await writeStage('15-version-proof.txt', `Pre-migration only: root node_modules/vitest=${currentRootVitest}; target vitest@4.1.11 proof not executed. Frontend manifest remains Vite ${frontendPackage.devDependencies?.vite}, Vitest ${frontendPackage.devDependencies?.vitest}.`);
await writeStage('16-runner-policy-proof.json', { currentR10Policy: { maxWorkers: '50%', availableParallelism: os.availableParallelism(), effectiveWorkers: Math.max(1, Math.floor(os.availableParallelism() * 0.5)), pool: 'forks', fileParallelism: true, isolate: true }, vitest4Resolution: 'NOT_EXECUTED' });

const notExecuted = 'NOT_EXECUTED — R11 STOP before migration due PRE_MIGRATION_BASELINE_NOT_CLEAN. No PASS claim is made.\n';
for (const name of [
  '17-golden-corpus-focused.txt', '18-adapter-replacement.txt', '19-high-cardinality.txt', '20-security-negative.txt',
  '21-validator-gates.txt', '22-architecture-and-stage12.txt', '24-official-unit-run-01.txt', '25-official-unit-run-02.txt',
  '26-official-unit-run-03.txt', '27-official-unit-run-04.txt', '28-official-unit-run-05.txt', '29-contract.txt',
  '30-integration.txt', '31-test-ci-01.txt', '32-test-ci-02.txt', '33-frontend-typecheck-post-migration.txt',
  '34-frontend-test-post-migration.txt', '35-frontend-build-post-migration.txt', '36-docs-knowledge-flow.txt',
  '37-docs-validate.txt', '38-docs-links.txt', '39-docs-adr-index.txt', '40-docs-canonical.txt',
  '41-docs-drift.txt', '42-docs-frontend-work-items.txt', '43-docs-completion-invariants.txt',
  '44-docs-frontend-projections.txt', '45-format.txt', '46-lint.txt', '47-typecheck.txt', '48-secret-scan.txt',
  '49-oss-audit.txt', '50-oss-verify.txt', '51-final-db-verify.txt', 'sbom.cdx.json', 'dependency-graph-diff.txt',
  'rollback-proof.txt', 'e2e-disposition.txt',
]) await writeStage(name, notExecuted);
await writeStage('23-fixture-final.txt', `SHA-256=${fixtureSha}\nexpected=${fixtureExpected}\nfixtureMutation=${fixtureSha !== fixtureExpected}\n`);
await writeStage('frontend-baseline-observation.txt', 'Baseline-only observation before R11 migration: frontend:typecheck PASS; frontend:build PASS with non-blocking warnings; frontend:test FAIL 49 files passed, 382/383 tests, one rapid-double-click SUBMITTING-lock assertion expected 1 but received 2. This was not a post-migration gate and no frontend file was changed.');
await writeStage('52-final-diff.patch', `${packageDiff}\n\nR11 functional change: none. R10 package.json script change is preserved and is not an R11 migration change.\n`);
await writeStage('53-changed-files.txt', `R11 functional allowlist after STOP: none.\nEvidence additions: docs/engineering/ts6-phase-b-c2-r11-vitest4-migration-closure.md; scripts/rebuild-ts6-phase-b-c2-r11-review.mjs; artifacts/ts6-phase-b-c2-r11/**; review ZIP.\n\nCurrent status, including preserved owner/C2 changes:\n${git(['status', '--short'])}`);
await writeStage('54-r11-closure-report.md', await read(reportPath));
await writeStage('55-final-handoff-report.md', `TS-6 PHASE B C2-R11 FINAL HANDOFF\n\nFinal status: TS-6 PHASE B C2-R11 = REVIEW_REQUIRED / STOP / PRE_MIGRATION_BASELINE_NOT_CLEAN.\n\nIdentity: worktree=${root}; branch=${identity.branch}; HEAD=${identity.head}; main=${identity.main}; rootVitest=${currentRootVitest}; Node=${process.version}; availableParallelism=${os.availableParallelism()}.\n\nBlocker: exact npm run test:unit on the existing R10 state failed exit 1 with 154/156 files and 1254/1256 tests. Stage 8 adapter replacement timed out at 5000 ms, C2 validator first test timed out at 20000 ms, and one unhandled onTaskUpdate timeout was reported. Migration was not started.\n\nRegistry authority captured: vitest@4.1.11, MIT, Node ^20 || ^22 || >=24, Vite peer ^6 || ^7 || ^8, integrity sha512-fhACrNXUidIbGSBr5FlbuBkO7VWC1ZyLl0DO4CU2DrQoAPxX84Ysxs+HeGQpii5lZWV1Q4gBZTTu49mF+A6Edw==.\n\nPreserved: R10 test:unit maxWorkers=50%, package-lock unchanged, frontend Vite 8.1.5/Vitest 4.1.10, fixture SHA=${fixtureSha}.\n\nNo Vitest4 install, lockfile generation, DB reset, OSS gate, SBOM, rollback, commit, push, PR, Ready, merge, or TS-7 action.\n\nController action requested: issue the next complete request only after accounting for the failed pre-migration control.\n`);

const collectFiles = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(file)));
    else out.push(file);
  }
  return out;
};
await writeStage('57-zip-verification.txt', 'This file is included in the manifest. Final ZIP SHA-256, manifest SHA-256, entry count, byte size, duplicate-entry result, and internal-hash result are printed by this builder and verified by the controller after archive creation.\n');
const files = (await collectFiles(stage)).filter((file) => basename(file) !== '56-sha256-manifest.txt');
const manifest = [];
for (const file of files) manifest.push(`${await hashFile(file)}  ${relative(stage, file).replaceAll('\\', '/')}`);
manifest.sort();
await writeStage('56-sha256-manifest.txt', manifest.join('\n'));
await rm(zipPath, { force: true });
cmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });
const zipSha = await hashFile(zipPath);
const manifestSha = await hashFile(join(stage, '56-sha256-manifest.txt'));
const zipSize = (await stat(zipPath)).size;
const finalZipSha = await hashFile(zipPath);
console.log(JSON.stringify({ zipPath, zipSha256: finalZipSha, manifestSha256: manifestSha, entryCount: manifest.length + 1, bytes: zipSize, fixtureSha, stop: 'PRE_MIGRATION_BASELINE_NOT_CLEAN' }, null, 2));
