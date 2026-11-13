/** Development build of the static trusted worker. Never installs dependencies or selects user code. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd(),
  out = path.resolve(root, '.data/surfer-bounded-worker-build');
if (
  !fs.existsSync(path.join(root, 'packages/contracts/src/surfer-bounded-induction.ts')) ||
  !out.startsWith(root + path.sep)
)
  throw Error('Repository-local worker output required.');
fs.mkdirSync(out, { recursive: true });
const config = path.join(out, 'tsconfig.json');
fs.writeFileSync(
  config,
  JSON.stringify({
    extends: path.join(root, 'tsconfig.json'),
    compilerOptions: { noEmit: false, rootDir: root, outDir: out, declaration: false },
    include: [
      path.join(root, 'adapters/surfer-symbolic-proposer/src/worker.ts'),
      path.join(root, 'adapters/surfer-symbolic-proposer/src/replacement-worker.ts'),
      path.join(root, 'adapters/surfer-symbolic-proposer/src/continuation-worker.ts'),
    ],
    exclude: [path.join(root, 'node_modules')],
  }),
);
const built = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    config,
    '--listEmittedFiles',
    '--pretty',
    'false',
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 60000 },
);
if (built.stdout) process.stdout.write(built.stdout);
if (built.stderr) process.stderr.write(built.stderr);
if (built.status !== 0) process.exitCode = built.status ?? 1;
else {
  const files = (built.stdout ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('TSFILE: '))
    .map((line) => path.resolve(line.slice(8)));
  const pins: Record<string, { emittedSha256: string; sourceSha256: string }> = {};
  for (const file of files) {
    if (!file.startsWith(out + path.sep) || !file.endsWith('.js'))
      throw Error('Unexpected emitted worker file.');
    const relative = path.relative(out, file),
      source = path.join(root, relative.replace(/\.js$/, '.ts'));
    pins[relative.replaceAll('\\', '/')] = {
      emittedSha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    };
  }
  fs.writeFileSync(
    path.join(out, 'build-manifest.json'),
    JSON.stringify(
      {
        schema: 'surfer-static-worker-build-v1',
        node: process.version,
        compilerVersion: JSON.parse(
          fs.readFileSync(path.join(root, 'node_modules/typescript/package.json'), 'utf8'),
        ).version,
        files: pins,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      worker: path.join(out, 'adapters/surfer-symbolic-proposer/src/worker.js'),
      providerCalls: 0,
    }),
  );
}
