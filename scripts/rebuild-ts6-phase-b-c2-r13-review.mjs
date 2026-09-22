import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r13');
const stage = resolve(evidenceRoot, '.zip-staging');
const zipPath = resolve(root, 'shotgun-ts6-phase-b-c2-r13-review-20260921.zip');
const reportPath = resolve(root, 'docs/engineering/ts6-phase-b-c2-r13-contract-capacity-boundary.md');
const fixturePath = resolve(root, 'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json');
const fixtureExpected = '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const read = (file) => readFile(file, 'utf8');
const hashFile = async (file) => createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();
const writeStage = async (name, value) => {
  const target = join(stage, name);
  await mkdir(resolve(target, '..'), { recursive: true });
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
};
const cmd = (file, args) => {
  try { return execFileSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { return `${error.stdout ?? ''}${error.stderr ?? ''}`; }
};
const git = (args) => cmd('git', args);
const ps = (script) => cmd(powershell, ['-NoProfile', '-NonInteractive', '-Command', script]);
const packageJson = JSON.parse(await read(resolve(root, 'package.json')));
const fixtureSha = await hashFile(fixturePath);
const processState = ps('$n=@(Get-Process -Name node -ErrorAction SilentlyContinue); $p=@(Get-Process -Name python,python3 -ErrorAction SilentlyContinue); $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{nodeCount=$n.Count; pythonCount=$p.Count; freeMemoryBytes=([int64]$os.FreePhysicalMemory*1024)} | ConvertTo-Json -Compress');
const identity = {
  worktree: root,
  branch: git(['branch', '--show-current']).trim(),
  head: git(['rev-parse', 'HEAD']).trim(),
  main: git(['rev-parse', 'main']).trim(),
  node: process.version,
  rootVitest: JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'), 'utf8')).version,
  testUnit: packageJson.scripts['test:unit'],
  testContract: packageJson.scripts['test:contract'],
  fixtureSha,
};

await mkdir(evidenceRoot, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await writeStage('01-identity.txt', JSON.stringify(identity, null, 2));
await writeStage('02-worktree-before.txt', `git status --short:\n${git(['status', '--short'])}\n\ngit diff --check:\n${git(['diff', '--check']) || 'PASS'}\n`);
await writeStage('03-frozen-state.txt', `R12 ZIP SHA-256: F0E76A3A9E3FDB0C45D1AF60946EB6C635E16F64AF556095CEF1123860EB870E\nR12 manifest SHA-256: 8288FFC58FB8DAD0637BCC2EAE3701713E5A6BE0DFE8C3793E118EDDECE774A2\nR12 unit script: vitest run tests/unit --maxWorkers=2\nroot Vitest: 3.2.7\nfixture SHA-256: ${fixtureSha}\nexpected fixture SHA-256: ${fixtureExpected}\n`);
await writeStage('04-stage9-contract-source-audit.md', `Source: tests/contract/knowledge-model.contract.test.ts\n\nThe exact failing assertion is the parameterized Stage 9 test "traverses approved Typed Edges deterministically and matches NetworkX" for transports in-memory and in-process. It stages Evidence, typed candidates, approval, recursive impact, and relation edges, then invokes spawnSync with the platform Python executable and adapters/networkx-impact-oracle/oracle.py. The source-defined test timeout remains Vitest default 5000ms. The oracle performs sorted-edge NetworkX DiGraph construction and bounded BFS, then returns JSON for equality comparison. No source was changed.\n`);

const copyEvidence = async (source, target) => copyFile(join(evidenceRoot, source), join(stage, target));
for (let i = 1; i <= 5; i += 1) await copyEvidence(`isolated-stage9-run-${String(i).padStart(2, '0')}.txt`, `${String(i + 4).padStart(2, '0')}-isolated-stage9-run-${String(i).padStart(2, '0')}.txt`);
for (let i = 1; i <= 3; i += 1) await copyEvidence(`default-contract-run-${String(i).padStart(2, '0')}.txt`, `${String(i + 9).padStart(2, '0')}-default-contract-run-${String(i).padStart(2, '0')}.txt`);
await copyEvidence('max2-contract-run-01.txt', '13-max2-contract-run-01.txt');
const notExecuted = 'NOT_EXECUTED — R13 STOP after the first full-contract maxWorkers=2 run failed (R13-C4 MAX_WORKERS_2_INSUFFICIENT).\n';
for (let i = 2; i <= 8; i += 1) await writeStage(`${String(i + 12).padStart(2, '0')}-max2-contract-run-${String(i).padStart(2, '0')}.txt`, notExecuted);
await writeStage('21-contract-process-observation.json', { isolated: { peakPython: 1 }, defaultContract: { peakNode: 25, peakPython: 2 }, max2Contract: { peakNode: 22, peakPython: 1 }, final: processState, leak: false, quietHost: true });
await writeStage('22-python-contract-inventory.md', `Contract search result:\n- direct node:child_process + Python oracle invocation: tests/contract/knowledge-model.contract.test.ts (1 file)\n- direct NetworkX oracle: 1 contract file\n- other search hits in stage-8/document-format surfaces are unrelated to this Stage 9 contract boundary\n- maximum observed concurrent Python processes: isolated 1; default contract up to 2; max2 failed run 1\n- Python residue after runs: none observed\n`);
await writeStage('23-stage9-timing-observation.json', { isolatedRuns: 'clean; file duration approximately 10.7-11.0s; both transport assertions pass', defaultRuns: 'contract duration approximately 52-60s; Stage 9 timeout reproduced', max2Run1: 'contract duration 112.23s; in-memory timeout at 6037ms; in-process passed at 1476ms', timeout: 'existing 5000ms; unchanged', oracle: 'spawnSync Python NetworkX oracle' });
await writeStage('24-contract-capacity-classification.md', 'R13-C4 MAX_WORKERS_2_INSUFFICIENT. The exact file is stable in isolation, default full-contract execution reproduces the known Stage 9 timeout, and full contract maxWorkers=2 still fails on the first run. A permanent contract runner change is not authorized; the evidence is diagnostic only.');
await writeStage('25-fixture-sha.txt', `SHA-256=${fixtureSha}\nexpected=${fixtureExpected}\nfixtureMutation=${fixtureSha !== fixtureExpected}\n`);
await writeStage('26-final-diff.patch', `R13 functional diff: none.\nCurrent R12 package diff relative to HEAD:\n${git(['diff', '--', 'package.json'])}\npackage-lock diff:\n${git(['diff', '--', 'package-lock.json']) || 'EMPTY'}\n`);
await writeStage('27-changed-files.txt', `R13 functional change: none. R12 package.json worker patch remains authorized and unchanged. R13 additions: report, builder, artifacts only.\n\n${git(['status', '--short'])}`);
await writeStage('28-r13-closure-report.md', await read(reportPath));
await writeStage('29-final-handoff-report.md', `TS-6 PHASE B C2-R13 FINAL CONTRACT CAPACITY BOUNDARY HANDOFF\n\n1. FINAL STATUS\n- R13: REVIEW_REQUIRED / STOP\n- Stage9 intrinsic: NO under 5/5 isolated file runs\n- default contract: 3/3 reproduce Stage9 timeout\n- maxWorkers=2 contract: first run failed 68/69 files, 703/704 tests; remaining 7 NOT_EXECUTED\n- classification: R13-C4 MAX_WORKERS_2_INSUFFICIENT\n- Product/tests/timeouts/dependencies/config/CI: unchanged\n- migration/commit/push/PR/Ready/merge/R14/TS-7: NO\n\n2. SOURCE\n- transports: in-memory and in-process\n- Python invocation: spawnSync(platform python, oracle.py)\n- oracle: sorted NetworkX DiGraph + bounded BFS JSON\n- existing timeout: 5000ms\n\n3. EVIDENCE\n- isolated: 5/5 clean, 1 file / 12 tests\n- default: 3/3 failed with known Stage9 timeout; no new semantic failure\n- max2 full contract run 1: in-memory timeout at 5000ms; in-process passed; 68/69 files, 703/704 tests\n- process leak: none observed\n\n4. FINAL STOP\n- package script changed in R13: NO\n- timeout changed: NO\n- Product/test/dependency/config/CI changed: NO\n- Vitest migration started: NO\n- next controller review required: YES\n`);

const collectFiles = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(file)));
    else out.push(file);
  }
  return out;
};
const files = (await collectFiles(stage)).filter((file) => basename(file) !== '30-sha256-manifest.txt');
const manifest = [];
for (const file of files) manifest.push(`${await hashFile(file)}  ${relative(stage, file).replaceAll('\\', '/')}`);
manifest.sort();
await writeStage('30-sha256-manifest.txt', manifest.join('\n'));
await rm(zipPath, { force: true });
execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { cwd: root, stdio: 'inherit', windowsHide: true });
console.log(JSON.stringify({ zipPath, zipSha256: await hashFile(zipPath), manifestSha256: await hashFile(join(stage, '30-sha256-manifest.txt')), entryCount: manifest.length + 1, bytes: (await stat(zipPath)).size, fixtureSha, disposition: 'R13-C4 MAX_WORKERS_2_INSUFFICIENT' }, null, 2));
