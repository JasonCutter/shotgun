import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'artifacts/ts6-phase-b-c2-r8/diagnostics');
await mkdir(outDir, { recursive: true });

const commands = [
  ['M1-r1', ['--pool=forks', '--maxWorkers=1', '--fileParallelism=false']],
  ['M1-r2', ['--pool=forks', '--maxWorkers=1', '--fileParallelism=false']],
  ['M2-r1', ['--pool=forks', '--maxWorkers=2']],
  ['M2-r2', ['--pool=forks', '--maxWorkers=2']],
  ['M3-r1', ['--pool=forks', '--maxWorkers=4']],
  ['M3-r2', ['--pool=forks', '--maxWorkers=4']],
  ['M4-r1', ['--pool=forks']],
  ['M4-r2', ['--pool=forks']],
  ['threads-r1', ['--pool=threads']],
  ['threads-r2', ['--pool=threads']],
];

function psSnapshot() {
  return new Promise((resolveSnapshot) => {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          '$p=Get-Process -Name node,python,python3,py -ErrorAction SilentlyContinue;',
          '$mem=Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty FreePhysicalMemory;',
          '[pscustomobject]@{node=($p|Where-Object ProcessName -eq "node").Count;python=(($p|Where-Object {$_.ProcessName -in @("python","python3","py")}).Count);freeMemoryKb=$mem} | ConvertTo-Json -Compress',
        ].join(''),
      ],
      { windowsHide: true },
    );
    let output = '';
    ps.stdout.on('data', (chunk) => {
      output += chunk;
    });
    ps.on('close', () => {
      try {
        resolveSnapshot(JSON.parse(output.trim() || '{}'));
      } catch {
        resolveSnapshot({});
      }
    });
    ps.on('error', () => resolveSnapshot({}));
  });
}

async function run(label, flags) {
  const logPath = resolve(outDir, `${label}.txt`);
  const jsonPath = resolve(outDir, `${label}.json`);
  const args = [
    resolve(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    'tests/unit',
    ...flags,
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${jsonPath}`,
  ];
  const startedAt = Date.now();
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true });
  let output = '';
  const samples = [];
  const sample = async () => {
    const snapshot = await psSnapshot();
    samples.push({
      atMs: Date.now() - startedAt,
      node: snapshot.node ?? null,
      python: snapshot.python ?? null,
      freeMemoryKb: snapshot.freeMemoryKb ?? null,
    });
  };
  const timer = setInterval(() => {
    void sample();
  }, 1000);
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exitCode = await new Promise((resolveExit) => {
    child.on('close', (code) => resolveExit(code ?? -1));
    child.on('error', () => resolveExit(-1));
  });
  clearInterval(timer);
  await sample();
  const finishedAt = Date.now();
  await writeFile(logPath, output, 'utf8');
  return {
    label,
    flags,
    command: `${process.execPath} ${args.join(' ')}`,
    exitCode,
    durationMs: finishedAt - startedAt,
    outputBytes: Buffer.byteLength(output),
    hasOnTaskUpdate: output.includes('Timeout calling "onTaskUpdate"'),
    hasUnhandled: output.includes('Unhandled Errors'),
    hasAssertionFailure: /Test Files\s+[1-9]\d* failed|Tests\s+[1-9]\d* failed|\bFAIL\b/.test(
      output,
    ),
    samples,
    peakNode: Math.max(0, ...samples.map((s) => Number(s.node) || 0)),
    peakPython: Math.max(0, ...samples.map((s) => Number(s.python) || 0)),
    minFreeMemoryKb: Math.min(
      ...samples.map((s) => Number(s.freeMemoryKb)).filter(Number.isFinite),
    ),
  };
}

const results = [];
for (const [label, flags] of commands) {
  results.push(await run(label, flags));
  await writeFile(
    resolve(outDir, 'matrix-progress.json'),
    JSON.stringify(results, null, 2),
    'utf8',
  );
}
await writeFile(
  resolve(outDir, 'matrix.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(JSON.stringify(results, null, 2));
