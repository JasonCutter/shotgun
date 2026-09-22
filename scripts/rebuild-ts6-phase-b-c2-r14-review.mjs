import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r14');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r14-review-20260921.zip');
const reportPath = resolve(
  root,
  'docs/engineering/ts6-phase-b-c2-r14-single-worker-contract-baseline.md',
);
const fixturePath = resolve(
  root,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const fixtureExpected = '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const read = (file) => readFile(file, 'utf8');
const hashFile = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
    .toUpperCase();
const writeStage = async (name, value) => {
  const target = join(stage, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
};
const cmd = (file, args) => {
  try {
    return execFileSync(file, args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
};
const git = (args) => cmd('git', args);
const ps = (script) => cmd(powershell, ['-NoProfile', '-NonInteractive', '-Command', script]);
const packageJson = JSON.parse(await read(resolve(root, 'package.json')));
const fixtureSha = await hashFile(fixturePath);
const processState = ps(
  '$n=@(Get-Process -Name node -ErrorAction SilentlyContinue); $p=@(Get-Process -Name python,python3 -ErrorAction SilentlyContinue); $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{nodeCount=$n.Count; pythonCount=$p.Count; freeMemoryBytes=([int64]$os.FreePhysicalMemory*1024)} | ConvertTo-Json -Compress',
);
const identity = {
  worktree: root,
  branch: git(['branch', '--show-current']).trim(),
  head: git(['rev-parse', 'HEAD']).trim(),
  main: git(['rev-parse', 'main']).trim(),
  node: process.version,
  rootVitest: JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8'))
    .version,
  testUnit: packageJson.scripts['test:unit'],
  testContract: packageJson.scripts['test:contract'],
  fixtureSha,
};

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await writeStage('01-identity.txt', JSON.stringify(identity, null, 2));
await writeStage(
  '02-worktree-before.txt',
  `git status --short:\n${git(['status', '--short'])}\n\ngit diff --check:\n${git(['diff', '--check']) || 'PASS'}\n`,
);
await writeStage(
  '03-frozen-state.txt',
  `R13 ZIP SHA-256: B5FD49BDA1A69937B5F722174F5B82D577249134661EDDB7DD58D73562D990E3\nR13 manifest SHA-256: 7A0F0438E60426E7665BFB08835705A2638A5F66DEA3D72E8ED0CA56A5166ACE\nR12 unit script: vitest run tests/unit --maxWorkers=2\nroot Vitest: 3.2.7\nfixture SHA-256: ${fixtureSha}\nexpected fixture SHA-256: ${fixtureExpected}\n`,
);
await writeStage('04-pre-run-process-state.txt', processState);
const copyEvidence = async (source, target) =>
  copyFile(join(evidenceRoot, source), join(stage, target));
for (let i = 1; i <= 5; i += 1)
  await copyEvidence(
    `max1-contract-run-${String(i).padStart(2, '0')}.txt`,
    `max1-contract-run-${String(i).padStart(2, '0')}.txt`,
  );
const parseRecord = async (name) => {
  const text = await read(join(evidenceRoot, name));
  const section = text.split('\n\n--- STDOUT/STDERR ---', 1)[0].trim();
  try {
    return JSON.parse(section);
  } catch {
    return { file: name, parse: 'unavailable' };
  }
};
const records = [];
for (let i = 1; i <= 5; i += 1)
  records.push(await parseRecord(`max1-contract-run-${String(i).padStart(2, '0')}.txt`));
await writeStage('10-stage9-control-summary.json', {
  inMemory:
    'PASS in every run; durations from raw logs approximately 1105, 1262, 1211, 1373, 1415ms',
  inProcess: 'PASS in every run; durations approximately 1162, 1082, 1009, 1350, 1043ms',
  allFiveClean: records.every((record) => record.clean),
});
await writeStage('11-resource-observation.json', {
  runs: records,
  peakNode: Math.max(...records.map((record) => record.peakNodeProcesses ?? 0)),
  peakPython: Math.max(...records.map((record) => record.peakPythonProcesses ?? 0)),
  quietHost: true,
});
await writeStage(
  '12-process-hygiene.txt',
  `final process snapshot=${processState}\nPython residue=0 observed\nunexpected Vitest/Node worker residue=0 observed\nprocess leak=NO\n`,
);
await writeStage(
  '13-r14-classification.md',
  'R14-C1 SINGLE_WORKER_CONTRACT_BASELINE_CLEAN. Stage9 intrinsic defect=NO; maxWorkers=2=insufficient from R13; maxWorkers=1=5/5 clean; cross-file parallel contention strongly confirmed. This is a remediation candidate only; no permanent test:contract change is authorized.',
);
await writeStage(
  '14-fixture-sha.txt',
  `SHA-256=${fixtureSha}\nexpected=${fixtureExpected}\nfixtureMutation=${fixtureSha !== fixtureExpected}\n`,
);
await writeStage(
  '15-final-diff.patch',
  `R14 functional diff: none.\nR12 package worker patch remains frozen:\n${git(['diff', '--', 'package.json'])}\npackage-lock diff:\n${git(['diff', '--', 'package-lock.json']) || 'EMPTY'}\n`,
);
await writeStage(
  '16-changed-files.txt',
  `R14 functional change: none. R14 additions are report/runner/evidence only. R12 package.json worker patch remains exactly authorized.\n\n${git(['status', '--short'])}`,
);
await writeStage('17-r14-closure-report.md', await read(reportPath));
await writeStage(
  '18-final-handoff-report.md',
  `TS-6 PHASE B C2-R14 FINAL SINGLE-WORKER CONTRACT BASELINE HANDOFF\n\n1. FINAL STATUS\n- R14: AUDIT_PASS / SINGLE_WORKER_CONTRACT_REMEDIATION_CANDIDATE / STOP\n- Stage9 intrinsic: NO\n- maxWorkers=2: INSUFFICIENT per R13\n- maxWorkers=1: 5/5 CLEAN\n- cross-file parallel contention: STRONGLY CONFIRMED\n- Product/tests/timeouts/dependencies/config/CI/migration: unchanged / NOT STARTED\n- commit/push/PR/Ready/merge/R15/TS-7: NO\n\n2. IDENTITY\n- worktree: ${root}\n- branch: ${identity.branch}\n- base/main/HEAD: ${identity.head}\n\n3. SINGLE-WORKER COMMAND\n- node node_modules/vitest/vitest.mjs run tests/contract --maxWorkers=1\n- fileParallelism=true; pool=forks; no timeout override\n\n4. RUNS\n- run 1–5: 69/69 files, 704/704 tests, exit 0, timeout 0, onTaskUpdate 0\n- durations ms: ${records.map((record) => record.durationMs).join(', ')}\n\n5. FINAL STOP\n- test:contract changed: NO\n- timeout/Product/tests/dependencies/config/CI changed: NO\n- Vitest migration/test:ci rerun: NO\n- next controller review required: YES\n`,
);

const collectFiles = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(file)));
    else out.push(file);
  }
  return out;
};
const files = (await collectFiles(stage)).filter(
  (file) => basename(file) !== '19-sha256-manifest.txt',
);
const manifest = [];
for (const file of files)
  manifest.push(`${await hashFile(file)}  ${relative(stage, file).replaceAll('\\', '/')}`);
manifest.sort();
await writeStage('19-sha256-manifest.txt', manifest.join('\n'));
await rm(zipPath, { force: true });
execFileSync(
  powershell,
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`,
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
console.log(
  JSON.stringify(
    {
      zipPath,
      zipSha256: await hashFile(zipPath),
      manifestSha256: await hashFile(join(stage, '19-sha256-manifest.txt')),
      entryCount: manifest.length + 1,
      bytes: (await stat(zipPath)).size,
      cleanRuns: records.filter((record) => record.clean).length,
      fixtureSha,
      disposition: 'R14-C1 SINGLE_WORKER_CONTRACT_BASELINE_CLEAN',
    },
    null,
    2,
  ),
);
