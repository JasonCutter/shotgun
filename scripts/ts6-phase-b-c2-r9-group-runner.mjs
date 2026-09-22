import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'artifacts/ts6-phase-b-c2-r9/groups');
await mkdir(outDir, { recursive: true });
const [id, flagsText, repeatText, ...files] = process.argv.slice(2);
if (!id || !repeatText || files.length === 0) throw new Error('usage: node ... <id> <flags-json> <repeat> <file...>');
const flags = JSON.parse(flagsText);
const repeat = Number(repeatText);

function run(label) {
  return new Promise((resolveRun) => {
    const args = [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', ...files, ...flags];
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const finish = async (exitCode, error = '') => {
      if (error) output += error;
      const result = {
        label,
        command: `${process.execPath} ${args.join(' ')}`,
        exitCode: exitCode ?? -1,
        durationMs: Date.now() - startedAt,
        timedOut: output.includes('Test timed out'),
        onTaskUpdate: output.includes('Timeout calling "onTaskUpdate"'),
        output,
      };
      await writeFile(resolve(outDir, `${label}.txt`), output, 'utf8');
      resolveRun(result);
    };
    child.on('close', (code) => { void finish(code); });
    child.on('error', (error) => { void finish(-1, String(error)); });
  });
}

const results = [];
for (let i = 1; i <= repeat; i += 1) results.push(await run(`${id}-r${i}`));
await writeFile(resolve(outDir, `${id}.json`), JSON.stringify({ id, flags, files, repeat, results: results.map(({ output, ...rest }) => rest) }, null, 2), 'utf8');
console.log(JSON.stringify({ id, flags, files, results: results.map(({ output, ...rest }) => rest) }, null, 2));
