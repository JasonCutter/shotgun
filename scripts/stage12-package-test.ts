import { spawnSync } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('npm_execpath is required to run the standalone package verification.');
}

const run = (command: string, args: readonly string[], cwd: string): string => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout.trim();
};

const runNpm = (args: readonly string[], cwd: string): string =>
  run(process.execPath, [npmCli, ...args], cwd);

const temp = await mkdtemp(path.join(os.tmpdir(), 'shotgun-stage12-package-'));
try {
  const packageDirectory = path.join(root, 'packages/lucas-text-locator');
  const packOutput = runNpm(['pack', '.', '--pack-destination', temp], packageDirectory);
  const tarballName = packOutput.split(/\r?\n/u).at(-1);
  if (!tarballName) {
    throw new Error('npm pack did not return a tarball name.');
  }
  const tarball = path.join(temp, tarballName);
  const project = path.join(temp, 'consumer');
  await cp(path.join(root, 'examples/lucas-text-locator-consumer'), project, {
    recursive: true,
  });
  const packagePath = path.join(project, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dependencies: Record<string, string>;
  };
  manifest.dependencies['@shotgun/lucas-text-locator'] = `file:${tarball.replaceAll('\\', '/')}`;
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], project);
  const installedPackage = path.join(project, 'node_modules/@shotgun/lucas-text-locator');
  await Promise.all([
    access(path.join(installedPackage, 'LICENSE')),
    access(path.join(installedPackage, 'THIRD_PARTY_NOTICES.md')),
  ]);
  const output = run(process.execPath, ['src/main.mjs'], project);
  const result = JSON.parse(output) as {
    package: string;
    shotgunApplicationInstalled: boolean;
  };
  if (
    result.package !== '@shotgun/lucas-text-locator' ||
    result.shotgunApplicationInstalled !== false
  ) {
    throw new Error(`Standalone consumer returned an invalid result: ${output}`);
  }
  const tree = JSON.parse(runNpm(['ls', '--all', '--json'], project)) as {
    dependencies?: Record<string, unknown>;
  };
  if (Object.keys(tree.dependencies ?? {}).join(',') !== '@shotgun/lucas-text-locator') {
    throw new Error('Standalone consumer installed packages outside the Stage 12 minimal set.');
  }
  console.log(`Stage 12 standalone package verified: ${tarballName}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
