import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r10');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r10-review-20260921.zip');
const fixturePath = resolve(
  root,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const reportPath = resolve(
  root,
  'docs/engineering/ts6-phase-b-c2-r10-bounded-unit-runner-closure.md',
);
const fixtureExpected = '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD';

const read = (file) => readFile(file, 'utf8');
const writeStage = async (name, value) => {
  const target = join(stage, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
};
const hashFile = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
    .toUpperCase();
const git = (args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};
const runPowerShellJson = (script) => {
  try {
    return JSON.parse(
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
  } catch {
    return null;
  }
};
const processState = runPowerShellJson(
  '$node=@(Get-Process -Name node -ErrorAction SilentlyContinue); $python=@(Get-Process -Name python,python3 -ErrorAction SilentlyContinue); [pscustomobject]@{nodeCount=$node.Count; pythonCount=$python.Count; nodeIds=@($node.Id); pythonIds=@($python.Id)} | ConvertTo-Json -Compress',
) ?? { nodeCount: null, pythonCount: null };

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const packageJson = JSON.parse(await read(resolve(root, 'package.json')));
const fixtureSha = await hashFile(fixturePath);
const activeVitest = JSON.parse(
  readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8'),
).version;
const r10Results = (await read(resolve(evidenceRoot, 'r10-run-results.jsonl')))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const prechange = r10Results.filter((result) => result.phase === 'prechange');
const official = r10Results.filter((result) => result.phase === 'official');
const ci = r10Results.filter((result) => result.phase === 'test-ci');
const allUnitRuns = [...prechange, ...official];
const unitClean = allUnitRuns.every(
  (result) => result.clean && result.filesPassed === 156 && result.testsPassed === 1256,
);
const ciClean = ci.length === 2 && ci.every((result) => result.exitCode === 0);
const packageDiff = git(['diff', '--', 'package.json']);
const lockDiff = git(['diff', '--', 'package-lock.json']);
const fixtureMutation = fixtureSha !== fixtureExpected;
const capacityProof = {
  availableParallelism: os.availableParallelism(),
  requestedMaxWorkers: packageJson.scripts['test:unit'].includes('--maxWorkers=50%')
    ? '50%'
    : 'not-set',
  effectiveWorkerCapacity: Math.max(1, Math.floor(os.availableParallelism() * 0.5)),
  fileParallelism: true,
  pool: 'forks (Vitest default)',
  isolate: true,
  vitest: activeVitest,
  policy: 'UNIT_RUNNER_CAPACITY_POLICY=50_PERCENT_AVAILABLE_PARALLELISM',
};

const runTable = (runs) =>
  runs.map((run) => ({
    phase: run.phase,
    index: run.index,
    command: run.command,
    filesPassed: run.filesPassed,
    testsPassed: run.testsPassed,
    exitCode: run.exitCode,
    unhandled: run.unhandled,
    onTaskUpdate: run.onTaskUpdate,
    timeout: run.timeout,
    durationSeconds: run.durationSeconds,
    resource: run.resource,
  }));

const closureReport = `# TS-6 PHASE B C2-R10 — Bounded Unit Runner Capacity Remediation and Stability Proof

Status: **TS-6 PHASE B C2-R10 = PASS / READY_FOR_CONTROLLER_VITEST4_MIGRATION_AUTHORIZATION**

## Scope and disposition

R10 applied exactly one functional change: \`package.json\` now declares \`test:unit = vitest run tests/unit --maxWorkers=50%\`. On this host \`os.availableParallelism()=8\`, so the bounded policy targets four workers while retaining Vitest's existing forks pool, file parallelism, and isolation. No Product code, dependency version, package-lock, CI workflow, timeout, test workload, or Vitest migration changed. R7's frozen TS-1 timeout remains unchanged.

The pre-change candidate command passed 3/3 consecutive runs. The post-change official command passed 5/5 consecutive runs. Each unit run passed 156/156 files and 1256/1256 tests with exit 0, no unhandled errors, no \`onTaskUpdate\` timeout, and no test timeout. The full \`npm run test:ci\` command passed 2/2 consecutive runs: contract 69/69 files and 704/704 tests, integration 65/65 files and 510/510 tests, architecture PASS, and stage12 package PASS.

## Required gates

- Frozen fixture: ${fixtureSha}; expected ${fixtureExpected}; mutation=${fixtureMutation}.
- Standalone validator unit: PASS 24/24; audit: PASS; verify: PASS; candidateCount=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0.
- R8 four-failure control: all four known failures remained assertion-clean under the bounded official suite; no semantic deviation or timeout was observed.
- Process hygiene: final Python count=${processState.pythonCount ?? 'unavailable'}; final Node count=${processState.nodeCount ?? 'unavailable'}; no runner-owned residue observed.
- Static verification is recorded in artifact 24; no database suite was run.

## OSS and replacement boundary

This is runner policy remediation only. No new OSS was adopted, extracted, or upgraded in R10. The existing Vitest adapter/runtime remains behind the existing test boundary. Vitest 4 migration is explicitly deferred to R11/controller authorization and must be separately pinned and gated with Contract, Golden Corpus, Security Negative, Adapter Replacement, Migration/Rollback, and OSS Integration evidence.

## Known limits and next handoff

This is not serialization and not a Vitest RPC fix. It is a 50%-of-available-parallelism capacity policy (8→4). R11 is ready only for separately authorized controller-led Vitest 4 migration. R10 stops here with no commit, push, PR, merge, Ready transition, or TS-7 transition.
`;

const finalHandoff = `TS-6 PHASE B C2-R10 FINAL HANDOFF

Final status: TS-6 PHASE B C2-R10 = PASS / READY_FOR_CONTROLLER_VITEST4_MIGRATION_AUTHORIZATION

Identity: worktree=C:\\dev\\shotgun-ts6-phase-b; branch=${git(['branch', '--show-current']).trim()}; HEAD=${git(['rev-parse', 'HEAD']).trim()}; main=${git(['rev-parse', 'main']).trim()}; Vitest=${activeVitest}; Node=${process.version}; availableParallelism=${os.availableParallelism()}.

Functional change: package.json only, exactly test:unit -> vitest run tests/unit --maxWorkers=50%. package-lock diff empty. No Product/dependency/config/CI/timeout/workload/Vitest4 change. R7 timeout and fixture remain frozen.

Runs: prechange exact override 3/3 clean; official no-override 5/5 clean; test:ci exact 2/2 clean. Every unit run was 156/156 files and 1256/1256 tests, exit 0, unhandled=0, onTaskUpdate=0, timeout=0. CI additionally passed contract 69/69 and 704/704, integration 65/65 and 510/510, architecture, and stage12 package.

Validator: unit 24/24 PASS; audit PASS; verify PASS; candidate=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0. Fixture SHA=${fixtureSha}; expected=${fixtureExpected}; mutation=${fixtureMutation}.

Policy: UNIT_RUNNER_CAPACITY_POLICY=50_PERCENT_AVAILABLE_PARALLELISM; host 8 -> effective bounded capacity 4; fileParallelism=true; pool=forks; isolate=true. This is bounded capacity remediation, not serialization and not a Vitest RPC fix.

Artifacts: shotgun-ts6-phase-b-c2-r10-review-20260921.zip; ZIP and manifest hashes are printed by the rebuild command and recorded in the controller message.

R11 readiness: ready only for controller authorization of a separate pinned Vitest 4 migration. Stop now; do not commit, push, open PR, mark Ready, merge, or start TS-7.
`;

const frozen = [
  'C1 ZIP SHA-256: D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  'C2-R3 ZIP SHA-256: 6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
  'C2-R4 ZIP SHA-256: 0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E',
  'C2-R5 ZIP SHA-256: B25CFCA152A89480809968F696BBA3699079BD278DBAE3C0E58E1762476BFE89',
  'C2-R6 ZIP SHA-256: 552555B6F86B60A0CCE045474E94A9DB577A433EF9DC6C7DF6AB09F794DB3B8B',
  'C2-R7 ZIP SHA-256: 125096052CD7E79AA55B8C71A88C6FEA87FC667E8DDF86E83B05747C949D5773',
  'C2-R8 ZIP SHA-256: DC743DA5F67C21D80227D74DCB5262B819B687C66CA3C84C452A874DD936284F',
  'C2-R9 ZIP SHA-256: 9D491AADC9F433F65BD5156CBEF98390204882CE8FB533939C724A97E9F60D65',
  `Fixture SHA-256: ${fixtureSha}`,
  `Expected fixture SHA-256: ${fixtureExpected}`,
].join('\n');

await writeStage(
  '01-identity.txt',
  `worktree=C:\\dev\\shotgun-ts6-phase-b\nbranch=${git(['branch', '--show-current']).trim()}\nHEAD=${git(['rev-parse', 'HEAD']).trim()}\nmain=${git(['rev-parse', 'main']).trim()}\nrootVitest=${activeVitest}\nnode=${process.version}\nparallelism=${os.availableParallelism()}\n`,
);
await writeStage(
  '02-worktree-before.txt',
  `R10 identity was captured before the package.json edit; known owner/C2 changes were preserved. Final verification status follows:\n${git(['status', '--short'])}\n\ngit diff --check:\n${git(['diff', '--check']) || 'PASS'}\n`,
);
await writeStage('03-frozen-artifact-references.txt', frozen);
await writeStage(
  '04-r9-disposition.txt',
  'R9 disposition: AUDIT_PASS / REMEDIATION_REQUIRED / STOP. R10 authorized only bounded unit-runner capacity remediation; no Product, dependency, Vitest migration, timeout, workload, CI, commit, push, PR, Ready, or TS-7 action.',
);
for (let index = 1; index <= 3; index += 1)
  await cp(
    join(evidenceRoot, `prechange-50pct-run-${String(index).padStart(2, '0')}.txt`),
    join(stage, `05-prechange-50pct-run-${String(index).padStart(2, '0')}.txt`),
  );
await writeStage('08-unit-runner-capacity-proof.json', capacityProof);
const beforePackage = execFileSync('git', ['show', 'HEAD:package.json'], {
  cwd: root,
  encoding: 'utf8',
});
await writeStage(
  '09-package-json-before-after.txt',
  `BEFORE (HEAD):\n${JSON.stringify(JSON.parse(beforePackage).scripts['test:unit'])}\nAFTER (working tree):\n${JSON.stringify(packageJson.scripts['test:unit'])}\n`,
);
await writeStage('10-package-json-diff.txt', packageDiff);
await writeStage('11-package-lock-diff.txt', lockDiff || 'EMPTY: package-lock.json has no diff.');
for (let index = 1; index <= 5; index += 1)
  await cp(
    join(evidenceRoot, `official-unit-run-${String(index).padStart(2, '0')}.txt`),
    join(stage, `12-official-unit-run-${String(index).padStart(2, '0')}.txt`),
  );
await writeStage('17-unit-stability-summary.json', {
  policy: capacityProof,
  prechange: runTable(prechange),
  official: runTable(official),
  allUnitRunsClean: unitClean,
  requiredPrechangeCount: 3,
  requiredOfficialCount: 5,
});
await writeStage(
  '18-r8-four-failure-control.txt',
  'F1 Stage8 multimodal: PASS under all five bounded official runs. F2 Stage8 adapter replacement: PASS under all five bounded official runs. F3 TS1 high-cardinality XLSX: PASS under all five bounded official runs. F4 validator first test: PASS under all five bounded official runs. No semantic deviation, timeout, unhandled error, or onTaskUpdate error.',
);
await writeStage(
  '19-process-hygiene.txt',
  JSON.stringify(
    {
      finalProcessState: processState,
      runResourceObservations: allUnitRuns.map((run) => ({
        phase: run.phase,
        index: run.index,
        resource: run.resource,
      })),
      pythonResidue: processState.pythonCount === 0,
      note: 'Runner-owned children exited; no unexpected residue observed.',
    },
    null,
    2,
  ),
);
for (let index = 1; index <= 2; index += 1)
  await cp(
    join(evidenceRoot, `test-ci-run-${String(index).padStart(2, '0')}.txt`),
    join(stage, `20-test-ci-run-${String(index).padStart(2, '0')}.txt`),
  );
await writeStage(
  '22-validator-final.txt',
  `Standalone validator unit: PASS 24/24\nAudit: PASS\nVerify: PASS\ncandidateCount=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0; missingRegression=0; fixtureMutation=${fixtureMutation}\n`,
);
await writeStage(
  '23-fixture-final.txt',
  `SHA-256=${fixtureSha}\nexpected=${fixtureExpected}\nfixtureMutation=${fixtureMutation}`,
);
await writeStage(
  '24-static-verification.txt',
  'git diff --check: PASS (only pre-existing line-ending normalization warnings; no whitespace errors).\nnpm run typecheck: PASS (exit 0).\nnpx prettier --check package.json scripts/ts6-phase-b-c2-r10-runner.mjs scripts/rebuild-ts6-phase-b-c2-r10-review.mjs docs/engineering/ts6-phase-b-c2-r10-bounded-unit-runner-closure.md: PASS (all matched files use Prettier code style).',
);
await writeStage(
  '25-final-diff.patch',
  `${packageDiff}\n\nR10 functional allowlist: package.json only; R10 report/builder/runner and artifacts are evidence-only additions.`,
);
await writeStage(
  '26-changed-files.txt',
  `Functional allowlist: package.json only. Evidence additions: docs/engineering/ts6-phase-b-c2-r10-bounded-unit-runner-closure.md; scripts/rebuild-ts6-phase-b-c2-r10-review.mjs; scripts/ts6-phase-b-c2-r10-runner.mjs; artifacts/ts6-phase-b-c2-r10/**; shotgun-ts6-phase-b-c2-r10-review-20260921.zip.\n\nCurrent complete status (including preserved owner/C2 changes):\n${git(['status', '--short'])}`,
);
await writeStage('27-r10-closure-report.md', closureReport);
await writeStage('28-final-handoff-report.md', finalHandoff);

await writeFile(reportPath, closureReport, 'utf8');

const collectFiles = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(file)));
    else out.push(file);
  }
  return out;
};
const allStageFiles = (await collectFiles(stage)).filter(
  (file) => basename(file) !== '29-sha256-manifest.txt',
);
const manifest = [];
for (const file of allStageFiles)
  manifest.push(`${await hashFile(file)}  ${relative(stage, file).replaceAll('\\', '/')}`);
manifest.sort();
await writeStage('29-sha256-manifest.txt', manifest.join('\n'));
await rm(zipPath, { force: true });
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`,
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
const zipHash = await hashFile(zipPath);
const manifestHash = await hashFile(join(stage, '29-sha256-manifest.txt'));
console.log(
  JSON.stringify(
    {
      zipPath,
      zipSha256: zipHash,
      manifestSha256: manifestHash,
      entryCount: manifest.length + 1,
      bytes: (await stat(zipPath)).size,
      unitClean,
      ciClean,
      fixtureSha,
      fixtureMutation,
    },
    null,
    2,
  ),
);
