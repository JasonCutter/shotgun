import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'artifacts/ts6-phase-b-c2-r9/targeted');
await mkdir(outDir, { recursive: true });

const [id, file, pattern, repeatText = '5'] = process.argv.slice(2);
if (!id || !file || !pattern) throw new Error('usage: node ... <id> <file> <pattern> [repeat]');
const repeat = Number(repeatText);
const pool = process.env.R9_POOL ?? 'forks';
const poolFlags = pool === 'threads' ? ['--pool=threads'] : ['--pool=forks'];

function run(label) {
  return new Promise((resolveRun) => {
    const args = [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run', file,
      ...poolFlags, '--maxWorkers=1', '--fileParallelism=false',
      `--testNamePattern=${pattern}`,
    ];
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', async (exitCode) => {
      const result = {
        label,
      command: `${process.execPath} ${args.join(' ')}`,
      pool,
        exitCode: exitCode ?? -1,
        durationMs: Date.now() - startedAt,
        timedOut: output.includes('Test timed out'),
        semanticFailure: /FAIL|AssertionError|expected .* to/i.test(output),
        output,
      };
      await writeFile(resolve(outDir, `${label}.txt`), output, 'utf8');
      resolveRun(result);
    });
    child.on('error', async (error) => {
      const result = { label, command: `${process.execPath} ${args.join(' ')}`, pool, exitCode: -1, durationMs: Date.now() - startedAt, timedOut: false, semanticFailure: true, output: String(error) };
      await writeFile(resolve(outDir, `${label}.txt`), result.output, 'utf8');
      resolveRun(result);
    });
  });
}

const results = [];
for (let i = 1; i <= repeat; i += 1) results.push(await run(`${id}-r${i}`));
await writeFile(resolve(outDir, `${id}.json`), JSON.stringify({ id, file, pattern, repeat, pool, results: results.map(({ output, ...rest }) => rest) }, null, 2), 'utf8');
console.log(JSON.stringify({ id, file, pattern, repeat, pool, results: results.map(({ output, ...rest }) => rest) }, null, 2));
