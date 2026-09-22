import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r14');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const runs = Number(process.argv[2] ?? 5);
const prefix = process.argv[3] ?? 'max1-contract-run';

const psState = async () => new Promise((resolveState) => {
  const script = '$n=@(Get-Process -Name node -ErrorAction SilentlyContinue); $p=@(Get-Process -Name python,python3 -ErrorAction SilentlyContinue); $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{nodeCount=$n.Count; pythonCount=$p.Count; freeMemoryBytes=([int64]$os.FreePhysicalMemory*1024)} | ConvertTo-Json -Compress';
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.on('close', () => {
    try { resolveState(JSON.parse(stdout)); } catch { resolveState({ nodeCount: null, pythonCount: null, freeMemoryBytes: null }); }
  });
});

const runOne = async (index) => {
  const startedAt = Date.now();
  const start = await psState();
  let peakNode = start.nodeCount;
  let peakPython = start.pythonCount;
  let minimumMemory = start.freeMemoryBytes;
  const samples = [];
  const monitor = setInterval(async () => {
    const state = await psState();
    samples.push({ atMs: Date.now() - startedAt, ...state });
    if (Number.isFinite(state.nodeCount)) peakNode = Math.max(peakNode ?? 0, state.nodeCount);
    if (Number.isFinite(state.pythonCount)) peakPython = Math.max(peakPython ?? 0, state.pythonCount);
    if (Number.isFinite(state.freeMemoryBytes)) minimumMemory = Math.min(minimumMemory ?? state.freeMemoryBytes, state.freeMemoryBytes);
  }, 500);
  const executable = process.execPath;
  const args = ['node_modules/vitest/vitest.mjs', 'run', 'tests/contract', '--maxWorkers=1'];
  const result = await new Promise((resolveRun) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (exitCode, signal) => resolveRun({ exitCode, signal, stdout, stderr }));
    child.on('error', (error) => resolveRun({ exitCode: null, signal: null, stdout, stderr: `${stderr}\n${error.stack ?? error.message}` }));
  });
  clearInterval(monitor);
  const end = await psState();
  const combined = `${result.stdout}\n${result.stderr}`;
  const fileMatch = combined.match(/Test Files\s+(?:(\d+) failed \| )?(\d+) passed/);
  const testMatch = combined.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/);
  const failedFiles = Number(fileMatch?.[1] ?? 0);
  const passedFiles = Number(fileMatch?.[2] ?? 0);
  const failedTests = Number(testMatch?.[1] ?? 0);
  const passedTests = Number(testMatch?.[2] ?? 0);
  const unhandled = combined.match(/Unhandled Errors?\s+(\d+)/i)?.[1] ?? '0';
  const timeout = /(?:Test timed out|timed out in|Timeout calling)/i.test(combined);
  const record = {
    phase: prefix,
    index,
    command: `${executable} ${args.join(' ')}`,
    maxWorkers: 1,
    fileParallelism: true,
    pool: 'forks (default)',
    start,
    end,
    peakNodeProcesses: peakNode,
    peakPythonProcesses: peakPython,
    minimumAvailableMemory: minimumMemory,
    durationMs: Date.now() - startedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    failedFiles,
    passedFiles,
    failedTests,
    passedTests,
    unhandledErrors: unhandled,
    onTaskUpdate: /Timeout calling ["']?onTaskUpdate|onTaskUpdate.*(?:error|timeout)/i.test(combined) ? 'present' : '0',
    timeouts: timeout ? 'present' : '0',
    clean: result.exitCode === 0 && failedFiles === 0 && failedTests === 0 && unhandled === '0' && !timeout && !/Timeout calling ["']?onTaskUpdate/i.test(combined),
    samples,
  };
  await writeFile(join(evidenceRoot, `${prefix}-${String(index).padStart(2, '0')}.txt`), `${JSON.stringify(record, null, 2)}\n\n--- STDOUT/STDERR ---\n${combined}`, 'utf8');
  return record;
};

await mkdir(evidenceRoot, { recursive: true });
const records = [];
for (let index = 1; index <= runs; index += 1) {
  const record = await runOne(index);
  records.push(record);
  console.log(JSON.stringify({ index, clean: record.clean, exitCode: record.exitCode, durationMs: record.durationMs, failedFiles: record.failedFiles, passedFiles: record.passedFiles, failedTests: record.failedTests, passedTests: record.passedTests, peakNode: record.peakNodeProcesses, peakPython: record.peakPythonProcesses }));
  if (!record.clean) break;
}
console.log(JSON.stringify({ requestedRuns: runs, executedRuns: records.length, cleanCount: records.filter((record) => record.clean).length, allClean: records.length === runs && records.every((record) => record.clean) }, null, 2));
process.exitCode = records.length === runs && records.every((record) => record.clean) ? 0 : 1;
