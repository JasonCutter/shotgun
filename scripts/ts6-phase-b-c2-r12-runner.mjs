import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = resolve(root, 'artifacts/ts6-phase-b-c2-r12');
const maxWorkers = Number(process.argv[2] ?? 2);
const runs = Number(process.argv[3] ?? 8);
const prefix = process.argv[4] ?? `candidate-max${maxWorkers}-run`;
const stopOnFailure = process.argv[5] !== 'continue';
const commandKind = process.argv[6] ?? 'vitest';

const psState = async () => {
  const script = `$n=@(Get-Process -Name node -ErrorAction SilentlyContinue); $p=@(Get-Process -Name python,python3 -ErrorAction SilentlyContinue); $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{nodeCount=$n.Count; pythonCount=$p.Count; freeMemoryBytes=([int64]$os.FreePhysicalMemory*1024)} | ConvertTo-Json -Compress`;
  return new Promise((resolveState) => {
    const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', () => {
      try { resolveState(JSON.parse(stdout)); } catch { resolveState({ nodeCount: null, pythonCount: null, freeMemoryBytes: null }); }
    });
  });
};

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
  const executable = commandKind === 'vitest' ? process.execPath : 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const args = commandKind === 'vitest'
    ? ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit', `--maxWorkers=${maxWorkers}`]
    : ['-NoProfile', '-NonInteractive', '-Command', `npm run ${commandKind === 'ci' ? 'test:ci' : 'test:unit'}`];
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
  const durationMs = Date.now() - startedAt;
  const combined = `${result.stdout}\n${result.stderr}`;
  const files = Number(combined.match(/Test Files\s+(\d+) passed/)?.[1] ?? 0);
  const tests = Number(combined.match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
  const unhandledMatch = combined.match(/Unhandled Errors?\s+(\d+)/i);
  const timeoutMatch = combined.match(/(\d+) timed out/i);
  const record = {
    phase: prefix,
    index,
    command: `${executable} ${args.join(' ')}`,
    commandKind,
    maxWorkers,
    fileParallelism: true,
    pool: 'forks (default)',
    start,
    end,
    peakNodeProcesses: peakNode,
    peakPythonProcesses: peakPython,
    minimumAvailableMemory: minimumMemory,
    durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    filesReported: files,
    testsReported: tests,
    unhandledErrors: unhandledMatch?.[1] ?? '0',
    onTaskUpdate: /Timeout calling ["']?onTaskUpdate|onTaskUpdate.*(?:error|timeout)/i.test(combined) ? 'present' : '0',
    timeouts: timeoutMatch?.[1] ?? (/(?:timed out|Timeout calling)/i.test(combined) ? 'present' : '0'),
    clean: result.exitCode === 0 && (commandKind === 'ci' || (files === 156 && tests === 1256)) && (unhandledMatch?.[1] ?? '0') === '0' && !/Timeout calling ["']?onTaskUpdate|onTaskUpdate.*(?:error|timeout)/i.test(combined) && !/(?:\d+) timed out/i.test(combined) && !/Test Files\s+\d+ failed|Tests\s+\d+ failed/i.test(combined),
    samples,
  };
  const file = join(evidenceRoot, `${prefix}-${String(index).padStart(2, '0')}.txt`);
  const text = `${JSON.stringify(record, null, 2)}\n\n--- STDOUT/STDERR ---\n${combined}`;
  await writeFile(file, text, 'utf8');
  return record;
};

await mkdir(evidenceRoot, { recursive: true });
const records = [];
for (let index = 1; index <= runs; index += 1) {
  const record = await runOne(index);
  records.push(record);
  console.log(JSON.stringify({ index, maxWorkers, clean: record.clean, exitCode: record.exitCode, durationMs: record.durationMs, files: record.filesReported, tests: record.testsReported, peakNode: record.peakNodeProcesses, peakPython: record.peakPythonProcesses, minMemory: record.minimumAvailableMemory }));
  if (stopOnFailure && !record.clean) break;
}
console.log(JSON.stringify({ maxWorkers, requestedRuns: runs, executedRuns: records.length, cleanCount: records.filter((record) => record.clean).length, allClean: records.length === runs && records.every((record) => record.clean) }, null, 2));
process.exitCode = records.length === runs && records.every((record) => record.clean) ? 0 : 1;
