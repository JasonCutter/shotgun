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

const packPackage = (directory: string, destination: string): string => {
  const output = runNpm(['pack', '.', '--pack-destination', destination], directory);
  const tarballName = output.split(/\r?\n/u).at(-1);
  if (!tarballName) {
    throw new Error(`npm pack did not return a tarball name for '${directory}'.`);
  }
  return path.join(destination, tarballName);
};

const installConsumer = async (
  temp: string,
  example: string,
  packageName: string,
  tarball: string,
): Promise<{ readonly tarballName: string; readonly output: Record<string, unknown> }> => {
  const project = path.join(temp, `consumer-${packageName.split('/').at(-1)}`);
  await cp(path.join(root, 'examples', example), project, { recursive: true });
  const packagePath = path.join(project, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dependencies: Record<string, string>;
  };
  manifest.dependencies[packageName] = `file:${tarball.replaceAll('\\', '/')}`;
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], project);
  const output = JSON.parse(run(process.execPath, ['src/main.mjs'], project)) as Record<
    string,
    unknown
  >;
  if (output.package !== packageName || output.shotgunApplicationInstalled !== false) {
    throw new Error(
      `${packageName} consumer returned an invalid result: ${JSON.stringify(output)}`,
    );
  }
  const tree = JSON.parse(runNpm(['ls', '--all', '--json'], project)) as {
    dependencies?: Record<string, unknown>;
  };
  if (Object.keys(tree.dependencies ?? {}).join(',') !== packageName) {
    throw new Error(`${packageName} consumer installed another top-level package.`);
  }
  return { tarballName: path.basename(tarball), output };
};

const temp = await mkdtemp(path.join(os.tmpdir(), 'shotgun-stage12-package-'));
try {
  const locatorTarball = packPackage(path.join(root, 'packages/lucas-text-locator'), temp);
  const locatorInstalled = path.join(
    temp,
    'consumer-lucas-text-locator',
    'node_modules/@shotgun/lucas-text-locator',
  );
  const locator = await installConsumer(
    temp,
    'lucas-text-locator-consumer',
    '@shotgun/lucas-text-locator',
    locatorTarball,
  );
  await Promise.all([
    access(path.join(locatorInstalled, 'LICENSE')),
    access(path.join(locatorInstalled, 'THIRD_PARTY_NOTICES.md')),
  ]);

  const qualityTarball = packPackage(path.join(root, 'packages/quality-evaluation'), temp);
  const quality = await installConsumer(
    temp,
    'quality-evaluation-consumer',
    '@shotgun/quality-evaluation',
    qualityTarball,
  );

  console.log(
    JSON.stringify({
      status: 'PASS',
      packages: [
        { name: '@shotgun/lucas-text-locator', tarball: locator.tarballName },
        {
          name: '@shotgun/quality-evaluation',
          tarball: quality.tarballName,
          exactRatio: quality.output.exactRatio,
        },
      ],
      shotgunApplicationInstalled: false,
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
