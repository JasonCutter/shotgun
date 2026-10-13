import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageDirectory = path.join(root, 'packages/vp-relation-evaluation');

it('packs the offline VP evaluation package and imports it in a fresh consumer without Shotgun runtime dependencies', async () => {
  const npmCli = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find((value): value is string => Boolean(value && existsSync(value)));
  if (!npmCli)
    throw new Error('The existing npm CLI is required for standalone package acceptance.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shotgun-vp-release-package-'));
  // No operating/provider environment is inherited by any build/install/import.
  const environment: NodeJS.ProcessEnv = {
    CI: 'true',
    npm_config_update_notifier: 'false',
    npm_config_userconfig: path.join(directory, 'empty-user.npmrc'),
    npm_config_globalconfig: path.join(directory, 'empty-global.npmrc'),
    npm_config_cache: path.join(directory, 'npm-cache'),
  };
  for (const key of [
    'SystemRoot',
    'SYSTEMROOT',
    'SystemDrive',
    'COMSPEC',
    'PATH',
    'Path',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOME',
    'LOCALAPPDATA',
    'APPDATA',
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  const run = (args: readonly string[], cwd: string) =>
    execFileSync(process.execPath, [...args], {
      cwd,
      env: environment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 2_000_000,
    }).trim();
  try {
    await writeFile(environment.npm_config_userconfig!, '');
    await writeFile(environment.npm_config_globalconfig!, '');
    const staged = path.join(directory, 'package');
    const consumer = path.join(directory, 'consumer');
    await mkdir(staged);
    await mkdir(consumer);
    const manifest = JSON.parse(
      await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
    ) as {
      name: string;
      exports: { '.': { import: string; types: string } };
      dependencies?: Record<string, string>;
    };
    expect(manifest.name).toBe('@shotgun/vp-relation-evaluation');
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
    await cp(path.join(packageDirectory, 'package.json'), path.join(staged, 'package.json'));
    // Build the real project, overriding only the output destination. Relative
    // contracts/quality imports must be emitted into the declared package tree.
    run(
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        path.join(packageDirectory, 'tsconfig.build.json'),
        '--outDir',
        path.join(staged, 'dist'),
      ],
      root,
    );
    expect(existsSync(path.join(staged, manifest.exports['.'].import))).toBe(true);
    expect(existsSync(path.join(staged, manifest.exports['.'].types))).toBe(true);
    const packed = JSON.parse(
      run(
        [
          npmCli,
          'pack',
          '.',
          '--json',
          '--ignore-scripts',
          '--offline',
          '--pack-destination',
          directory,
        ],
        staged,
      ),
    ) as { filename: string; files: { path: string }[] }[];
    expect(packed).toHaveLength(1);
    const files = packed[0]!.files.map((file) => file.path);
    expect(files.every((file) => file === 'package.json' || file.startsWith('dist/'))).toBe(true);
    expect(
      files.some((file) =>
        /(?:\.env|\.data|artifacts\/|adapters\/|assemblies\/|Gold-B)/u.test(file),
      ),
    ).toBe(false);
    const tarball = path.join(directory, packed[0]!.filename);
    await writeFile(
      path.join(consumer, 'package.json'),
      JSON.stringify({
        name: 'isolated-vp-package-consumer',
        private: true,
        type: 'module',
        dependencies: { [manifest.name]: `file:${tarball.replaceAll('\\', '/')}` },
      }),
    );
    run([npmCli, 'install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], consumer);
    const entry = path.join(consumer, 'check.mjs');
    await writeFile(
      entry,
      `import assert from 'node:assert/strict';
import { RELATION_MEASUREMENT_VERSION, accountRelationExecutions, relationArtifactDigest } from '@shotgun/vp-relation-evaluation';
const report=accountRelationExecutions([],[]);
assert.equal(report.billing.coverage.value,null);
assert.equal(report.latency.p50Milliseconds,null);
assert.equal(report.billing.totalPaidCost,null);
assert.match(relationArtifactDigest({synthetic:'package-only'}),/^sha256:[0-9a-f]{64}$/u);
console.log(JSON.stringify({version:RELATION_MEASUREMENT_VERSION,emptyDenominator:report.billing.coverage.value,shotgunApplicationInstalled:false}));
`,
    );
    expect(JSON.parse(run([entry], consumer))).toEqual({
      version: 'VP05_RELATION_MEASUREMENT_0.1',
      emptyDenominator: null,
      shotgunApplicationInstalled: false,
    });
    const tree = JSON.parse(run([npmCli, 'ls', '--all', '--json', '--offline'], consumer)) as {
      dependencies?: Record<string, unknown>;
    };
    expect(Object.keys(tree.dependencies ?? {})).toEqual([manifest.name]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
