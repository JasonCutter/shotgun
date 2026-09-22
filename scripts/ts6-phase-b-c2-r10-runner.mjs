import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifactDir = join(root, 'artifacts', 'ts6-phase-b-c2-r10');
mkdirSync(artifactDir, { recursive: true });

const [, , phase = 'prechange', countArg = '1'] = process.argv;
const count = Number.parseInt(countArg, 10);

const phases = {
  prechange: {
    command: 'npm.cmd',
    args: ['run', 'test:unit', '--', '--maxWorkers=50%'],
    filePrefix: 'prechange-50pct-run',
  },
  official: {
    command: 'npm.cmd',
    args: ['run', 'test:unit'],
    filePrefix: 'official-unit-run',
  },
  'test-ci': {
    command: 'npm.cmd',
    args: ['run', 'test:ci'],
    filePrefix: 'test-ci-run',
  },
};

if (!phases[phase] || !Number.isInteger(count) || count < 1) {
  throw new Error(`Usage: node ${process.argv[1]} <prechange|official|test-ci> <positive-count>`);
}

function processSnapshot() {
  const script = [
    '$node = @(Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { $_.WorkingSet64 })',
    '$python = @(Get-Process -Name python,python3 -ErrorAction SilentlyContinue | ForEach-Object { $_.WorkingSet64 })',
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$cpu = $null',
    'try { $cpu = (Get-Counter "\\Processor(_Total)\\% Processor Time" -ErrorAction Stop).CounterSamples[0].CookedValue } catch {}',
    '$nodePeak = if ($node.Count) { [int64](($node | Measure-Object -Maximum).Maximum) } else { 0 }',
    '$pythonPeak = if ($python.Count) { [int64](($python | Measure-Object -Maximum).Maximum) } else { 0 }',
    '[pscustomobject]@{ nodeCount=$node.Count; nodeWorkingSet=$nodePeak; pythonCount=$python.Count; pythonWorkingSet=$pythonPeak; availableMemory=$os.FreePhysicalMemory * 1KB; cpuPercent=$cpu } | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      },
    ).trim();
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

function parseOutput(text) {
  const files = text.match(/Test Files\s+(\d+)\s+passed/i);
  const tests = text.match(/Tests\s+(\d+)\s+passed/i);
  return {
    filesPassed: files ? Number(files[1]) : null,
    testsPassed: tests ? Number(tests[1]) : null,
    unhandled: /Unhandled Errors|Vitest caught .* unhandled|Error:\s*\[vitest-worker\]/i.test(text),
    onTaskUpdate: /Timeout calling ["']onTaskUpdate["']/i.test(text),
    timeout: /Test timed out in|test timeout/i.test(text),
  };
}

function writeJson(name, value) {
  writeFileSync(join(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runOne(index) {
  const config = phases[phase];
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const snapshots = [];
  let pollTimer;
  let childOutput = '';

  const child = spawn(config.command, config.args, {
    cwd: root,
    env: process.env,
    windowsHide: true,
    shell: true,
  });

  const collect = (chunk) => {
    const text = chunk.toString();
    childOutput += text;
    process.stdout.write(text);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  pollTimer = setInterval(() => {
    const snapshot = processSnapshot();
    if (snapshot) snapshots.push({ at: new Date().toISOString(), ...snapshot });
  }, 1000);

  const exitCode = await new Promise((resolveExit) => {
    child.on('close', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
    child.on('error', () => resolveExit(1));
  });
  clearInterval(pollTimer);

  const endedAt = new Date().toISOString();
  const parsed = parseOutput(childOutput);
  const resource = {
    peakNodeWorkingSet: snapshots.length
      ? Math.max(...snapshots.map((s) => s.nodeWorkingSet || 0))
      : null,
    peakPythonWorkingSet: snapshots.length
      ? Math.max(...snapshots.map((s) => s.pythonWorkingSet || 0))
      : null,
    minAvailableMemory: snapshots.length
      ? Math.min(...snapshots.map((s) => s.availableMemory || Number.POSITIVE_INFINITY))
      : null,
    peakCpuPercent: snapshots.length ? Math.max(...snapshots.map((s) => s.cpuPercent || 0)) : null,
    maxNodeCount: snapshots.length ? Math.max(...snapshots.map((s) => s.nodeCount || 0)) : null,
    maxPythonCount: snapshots.length ? Math.max(...snapshots.map((s) => s.pythonCount || 0)) : null,
    sampleCount: snapshots.length,
  };
  const result = {
    phase,
    index,
    command: [config.command, ...config.args].join(' '),
    startedAt,
    endedAt,
    durationSeconds: Number(((Date.now() - startMs) / 1000).toFixed(3)),
    exitCode,
    ...parsed,
    clean:
      exitCode === 0 &&
      parsed.filesPassed === 156 &&
      parsed.testsPassed === 1256 &&
      !parsed.unhandled &&
      !parsed.onTaskUpdate &&
      !parsed.timeout,
    resource,
  };
  const outputPath = join(
    artifactDir,
    `${config.filePrefix}-${String(index).padStart(2, '0')}.txt`,
  );
  writeFileSync(
    outputPath,
    `${JSON.stringify(result, null, 2)}\n\n===== COMMAND OUTPUT =====\n${childOutput}`,
    'utf8',
  );
  writeJson(`${config.filePrefix}-${String(index).padStart(2, '0')}.json`, result);
  appendFileSync(join(artifactDir, 'r10-run-results.jsonl'), `${JSON.stringify(result)}\n`, 'utf8');
  return result;
}

const results = [];
for (let index = 1; index <= count; index += 1) {
  const result = await runOne(index);
  results.push(result);
  if (result.exitCode !== 0 || (phase !== 'test-ci' && !result.clean)) break;
}

writeJson(`${phase}-summary.json`, { phase, requestedCount: count, results });
if (results.some((result) => result.exitCode !== 0 || (phase !== 'test-ci' && !result.clean)))
  process.exitCode = 1;
