import { fork, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const run = (
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = 180_000,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Distribution command timed out: ${path.basename(command)} ${args[0]}`));
    }, timeout);
    child.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    child.stderr.on('data', (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `Distribution command failed (${code}): ${stdout.slice(-8_000)} ${stderr.slice(-8_000)}`,
          ),
        );
    });
  });
const waitFor = async <T>(
  read: () => Promise<T | undefined>,
  description: string,
  timeout = 90_000,
): Promise<T> => {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Distribution rehearsal timeout: ${description}`);
};
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No loopback port allocated.');
      server.close(() => resolve(address.port));
    });
  });
type RehearsalMessage = {
  type: string;
  generation?: number;
  childPid?: number;
  askWorkerStarted?: boolean;
  canonicalProjects?: unknown;
  identity?: { pid: number; ownershipNonce: string; sha: string; repoRoot: string };
  code?: string;
  message?: string;
};

it.skipIf(!process.env.TEST_DATABASE_URL)(
  'installs an allowlisted whole application into synthetic origin/main and rehearses real launcher identity, readiness, child restart and owner crash recovery',
  async () => {
    for (const name of ['.env', '.env.test'])
      if (existsSync(path.join(root, name)))
        throw new Error(
          'Distribution proof requires an isolated worktree without environment files.',
        );
    const directory = await mkdtemp(path.join(os.tmpdir(), 'shotgun-vp-application-distribution-'));
    const seed = path.join(directory, 'seed'),
      origin = path.join(directory, 'origin.git'),
      installed = path.join(directory, 'installed');
    const environment: NodeJS.ProcessEnv = {
      CI: 'true',
      npm_config_update_notifier: 'false',
      npm_config_userconfig: path.join(directory, 'empty-user.npmrc'),
      npm_config_globalconfig: path.join(directory, 'empty-global.npmrc'),
      npm_config_cache: path.join(directory, 'npm-cache'),
      npm_config_registry: 'https://registry.npmjs.org',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(directory, 'empty-gitconfig'),
      GIT_TERMINAL_PROMPT: '0',
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
    ])
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    const npmCli = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ].find((value): value is string => Boolean(value && existsSync(value)));
    if (!npmCli) throw new Error('Existing npm executable is required.');
    let db: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>> | undefined;
    const owners: ChildProcess[] = [];
    const observations: RehearsalMessage[] = [];
    let processOutput = '';
    const launch = (mode?: string): { child: ChildProcess; messages: RehearsalMessage[] } => {
      const messages: RehearsalMessage[] = [];
      const child = fork(
        path.join(installed, 'tests/fixtures/vp-launch-local-rehearsal.ts'),
        mode ? [mode] : [],
        {
          cwd: installed,
          env: environment,
          execArgv: ['--import', 'tsx'],
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      );
      owners.push(child);
      child.stdout?.on('data', (bytes: Buffer) => {
        processOutput += bytes.toString();
      });
      child.stderr?.on('data', (bytes: Buffer) => {
        processOutput += bytes.toString();
      });
      child.on('message', (raw: unknown) => {
        const message = raw as RehearsalMessage;
        messages.push(message);
        observations.push(message);
      });
      return { child, messages };
    };
    const awaitMessage = async (
      owner: ReturnType<typeof launch>,
      type: string,
      generation?: number,
    ): Promise<RehearsalMessage> =>
      waitFor(
        async () => {
          const result = owner.messages.find(
            (message) =>
              message.type === type &&
              (generation === undefined || message.generation === generation),
          );
          if (result) return result;
          const failure = owner.messages.find((message) => message.type === 'startup-failure');
          if (failure || owner.child.exitCode !== null || owner.child.signalCode !== null)
            throw new Error(
              `Distribution launcher failed: ${JSON.stringify(failure)} ${processOutput.slice(-8_000)}`,
            );
          return undefined;
        },
        `${type} generation ${generation ?? '*'}`,
      ).catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ${processOutput.slice(-8_000)}`,
        );
      });
    try {
      await mkdir(seed);
      await Promise.all(
        [
          environment.npm_config_userconfig!,
          environment.npm_config_globalconfig!,
          environment.GIT_CONFIG_GLOBAL!,
        ].map((filename) => writeFile(filename, '')),
      );
      const sourceSha = await run('git', ['rev-parse', 'HEAD'], root, environment);
      const sourceCommitTime = await run(
        'git',
        ['show', '-s', '--format=%cI', 'HEAD'],
        root,
        environment,
      );
      environment.GIT_AUTHOR_DATE = sourceCommitTime;
      environment.GIT_COMMITTER_DATE = sourceCommitTime;
      const tracked = (
        await run(
          'git',
          ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
          root,
          environment,
        )
      )
        .split('\0')
        .filter(Boolean);
      const runtimeFiles = tracked
        .filter((filename) => {
          const allowed =
            [
              'package.json',
              'package-lock.json',
              'tsconfig.json',
              '.gitignore',
              '.env.example',
              'compose.yaml',
            ].includes(filename) ||
            /^(?:apps\/shotgun-web|packages|modules|adapters|assemblies)\//u.test(filename) ||
            /^db\/migrations\/[^/]+\.sql$/u.test(filename) ||
            /^scripts\/(?:launch-[^/]+|t3-[^/]+|source-erasure-journal|database|database-target-guard|isolated-postgres-database|bootstrap|auth-bootstrap-owner|backup-owner|backup-owner-core|backup-restore|asset-cas-gc|stage12-1-restore-drill)\.ts$/u.test(
              filename,
            );
          return (
            allowed &&
            (filename === '.env.example' ||
              !/(?:^|\/)(?:node_modules|dist|\.env[^/]*|\.data|artifacts|fixtures|test|tests|examples)(?:\/|$)|\.(?:test|spec)\.[^/]+$|Gold-B-7|frozen/iu.test(
                filename,
              ))
          );
        })
        .sort();
      expect(runtimeFiles).toContain('scripts/launch-local.ts');
      expect(runtimeFiles).toContain('assemblies/shotgun-app/src/application.ts');
      expect(runtimeFiles).toContain('package-lock.json');
      expect(runtimeFiles).toContain('scripts/bootstrap.ts');
      expect(runtimeFiles).toContain('scripts/backup-owner-core.ts');
      expect(runtimeFiles).toContain('adapters/document-format-python/requirements.lock');
      const sampleEnvironment = await readFile(path.join(root, '.env.example'), 'utf8');
      for (const key of [
        'GEMINI_API_KEY',
        'AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS',
        'SHOTGUN_CREDENTIAL_MASTER_KEY',
      ])
        expect(sampleEnvironment).toMatch(new RegExp(`^${key}=$`, 'mu'));
      expect(sampleEnvironment).toMatch(/^SOURCES_STAGING_SECRET=replace-with-/mu);
      expect(sampleEnvironment).toMatch(/^SHOTGUN_BOOTSTRAP_PASSWORD=replace-with-/mu);
      const sourceManifest: { path: string; sha256: string }[] = [];
      for (const filename of runtimeFiles) {
        const bytes = await readFile(path.join(root, filename));
        await mkdir(path.dirname(path.join(seed, filename)), { recursive: true });
        await writeFile(path.join(seed, filename), bytes);
        sourceManifest.push({ path: filename, sha256: sha256(bytes) });
      }
      await mkdir(path.join(seed, 'tests/fixtures'), { recursive: true });
      const verificationFiles = [
        'tests/fixtures/vp-launch-local-rehearsal.ts',
        'tests/fixtures/vp-distribution-pg-bridge.cjs',
        'tests/fixtures/vp-installed-product-journey.ts',
        'tests/helpers/vp-full-application-fixture.ts',
        'tests/helpers/isolated-postgres-test-database.ts',
      ];
      for (const filename of verificationFiles) {
        await mkdir(path.dirname(path.join(seed, filename)), { recursive: true });
        await copyFile(path.join(root, filename), path.join(seed, filename));
      }
      const sourceDigest = sha256(JSON.stringify(sourceManifest));
      await writeFile(
        path.join(seed, 'distribution-manifest.json'),
        `${JSON.stringify({ scope: 'SYNTHETIC_MAIN_RECOVERY_ASSEMBLY_ONLY', sourceBaseSha: sourceSha, sourceSnapshotIncludesLocalChanges: true, sourceDigest, sourceManifest }, null, 2)}\n`,
      );
      await run('git', ['init', '--initial-branch=main'], seed, environment);
      await run('git', ['add', '.'], seed, environment);
      await run(
        'git',
        [
          '-c',
          'user.name=Isolated Rehearsal',
          '-c',
          'user.email=rehearsal@invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-m',
          'Synthetic application distribution rehearsal',
        ],
        seed,
        environment,
      );
      const syntheticSha = await run('git', ['rev-parse', 'HEAD'], seed, environment);
      const archive = path.join(directory, 'shotgun-application.tar');
      await run(
        'git',
        ['archive', '--format=tar', `--output=${archive}`, 'HEAD'],
        seed,
        environment,
      );
      const archiveFiles = (await run('tar', ['-tf', archive], directory, environment))
        .split(/\r?\n/u)
        .filter((filename) => !filename.endsWith('/'));
      expect(archiveFiles.sort()).toEqual(
        [...runtimeFiles, 'distribution-manifest.json', ...verificationFiles].sort(),
      );
      await run('git', ['clone', '--bare', seed, origin], directory, environment);
      await run('git', ['clone', origin, installed], directory, environment);
      // A completely fresh npm cache and independent node_modules: no operating
      // dependencies, credentials, install lifecycle scripts or global config.
      await run(
        process.execPath,
        [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        installed,
        environment,
        300_000,
      );
      expect(
        await run(
          process.execPath,
          [npmCli, 'run', 'bootstrap', '--', '--help'],
          installed,
          environment,
        ),
      ).toContain('Usage: npm run bootstrap');
      for (const entry of sourceManifest)
        expect(sha256(await readFile(path.join(installed, entry.path)))).toBe(entry.sha256);
      const lock = JSON.parse(
        await readFile(path.join(installed, 'package-lock.json'), 'utf8'),
      ) as { packages: Record<string, { version?: string; integrity?: string }> };
      expect(Object.keys(lock.packages).some((key) => key === 'node_modules/fastify')).toBe(true);
      expect(lock.packages['node_modules/fastify']?.integrity).toMatch(/^sha512-/u);
      db = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
      Object.assign(environment, {
        DATABASE_URL: db.databaseUrl,
        SOURCES_STAGING_SECRET: 'isolated-distribution-staging-secret-0001',
        ASSET_STORAGE_ROOT: path.join(directory, 'assets'),
        PORT: String(await freePort()),
        HOST: '127.0.0.1',
        SHOTGUN_PG_TOOL_MODE: 'local',
      });
      if (process.env.NODE_OPTIONS?.includes('pg-bridge.cjs'))
        environment.NODE_OPTIONS = `--require=${JSON.stringify(path.join(installed, 'tests/fixtures/vp-distribution-pg-bridge.cjs'))}`;
      await mkdir(environment.ASSET_STORAGE_ROOT!);
      await writeFile(
        path.join(environment.ASSET_STORAGE_ROOT!, 'isolated-marker.txt'),
        sourceDigest,
      );
      await run(process.execPath, [npmCli, 'run', 'db:migrate'], installed, environment);
      const pool = db.createPool();
      await pool.query(
        'CREATE TABLE public.distribution_rehearsal_marker (digest text PRIMARY KEY)',
      );
      await pool.query('INSERT INTO public.distribution_rehearsal_marker VALUES ($1)', [
        sourceDigest,
      ]);
      const identityPath = path.join(installed, '.data/launcher/runtime.json');
      const first = launch();
      const ready = await awaitMessage(first, 'rehearsal-ready', 1);
      const readIdentity = async () =>
        JSON.parse(await readFile(identityPath, 'utf8')) as {
          phase: string;
          pid: number;
          sha: string;
          repoRoot: string;
          ownershipNonce: string;
        };
      const identity = await readIdentity();
      expect(identity).toMatchObject({
        phase: 'ready',
        pid: first.child.pid,
        sha: syntheticSha,
        repoRoot: installed,
      });
      const url = `http://127.0.0.1:${environment.PORT}`;
      expect((await fetch(`${url}/health`)).ok).toBe(true);
      const html = await (await fetch(url)).text();
      expect(html).toContain('<div id="root">');
      const asset = html.match(/src="([^"]+\.js)"/u)?.[1];
      expect(asset).toBeDefined();
      expect((await fetch(new URL(asset!, url))).ok).toBe(true);
      expect((await fetch(`${url}/product-api/ask/workspace`)).status).toBe(401);
      const reuse = launch();
      expect((await awaitMessage(reuse, 'rehearsal-reuse')).identity).toMatchObject({
        pid: first.child.pid,
        ownershipNonce: identity.ownershipNonce,
        sha: syntheticSha,
      });
      await waitFor(async () => (reuse.child.exitCode === 0 ? true : undefined), 'reuse exit');
      expect(await readIdentity()).toEqual(identity);
      first.child.send({ type: 'crash-child' });
      await awaitMessage(first, 'rehearsal-starting', 1);
      expect((await readIdentity()).phase).toBe('starting');
      const restarted = await awaitMessage(first, 'rehearsal-ready', 2);
      expect(restarted.childPid).not.toBe(ready.childPid);
      expect(await readIdentity()).toEqual(identity);
      expect((await fetch(`${url}/health`)).ok).toBe(true);
      expect(
        (await pool.query('SELECT digest FROM public.distribution_rehearsal_marker')).rows,
      ).toEqual([{ digest: sourceDigest }]);
      first.child.kill();
      await waitFor(
        async () =>
          first.child.exitCode !== null || first.child.signalCode !== null ? true : undefined,
        'owned owner exit',
      );
      await waitFor(async () => {
        try {
          process.kill(restarted.childPid!, 0);
          return undefined;
        } catch {
          return true;
        }
      }, 'orphan recovery child exits on owner disconnect');
      const second = launch();
      await awaitMessage(second, 'rehearsal-ready', 1);
      const recoveredIdentity = await readIdentity();
      expect(recoveredIdentity.pid).toBe(second.child.pid);
      expect(recoveredIdentity.ownershipNonce).not.toBe(identity.ownershipNonce);
      expect(recoveredIdentity.sha).toBe(syntheticSha);
      expect((await fetch(`${url}/health`)).ok).toBe(true);
      second.child.send({ type: 'shutdown' });
      await waitFor(
        async () => (second.child.exitCode === 0 ? true : undefined),
        'graceful owner shutdown',
      );
      expect(existsSync(identityPath)).toBe(false);
      expect(
        await readFile(path.join(environment.ASSET_STORAGE_ROOT!, 'isolated-marker.txt'), 'utf8'),
      ).toBe(sourceDigest);
      expect(observations.filter((message) => message.type === 'recovery-observed')).toHaveLength(
        3,
      );
      expect(
        observations
          .filter((message) => message.type === 'recovery-observed')
          .every(
            (message) =>
              message.askWorkerStarted === false &&
              Array.isArray(message.canonicalProjects) &&
              message.canonicalProjects.length === 0,
          ),
      ).toBe(true);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM vp_global_budget.authority_store'))
          .rows[0]?.count,
      ).toBe(0);
      expect(
        await run(
          'git',
          ['status', '--porcelain=v1', '--untracked-files=all'],
          installed,
          environment,
        ),
      ).toBe('');
      await mkdir(path.join(installed, 'tests/integration'), { recursive: true });
      await writeFile(
        path.join(installed, 'tests/integration/vp-installed-product-journey.test.ts'),
        `import { it } from 'vitest';\nimport { runInstalledProductJourney } from '../fixtures/vp-installed-product-journey.js';\nit('uses the fresh installed artifact for the normal-worker HTTP A/B/revision Ask journey', runInstalledProductJourney, 240000);\n`,
      );
      const normalEnvironment: NodeJS.ProcessEnv = {
        ...environment,
        TEST_DATABASE_URL: db.databaseUrl,
        VP_INSTALLED_APPLICATION_PROOF: 'true',
      };
      for (const key of [
        'DATABASE_URL',
        'ASSET_STORAGE_ROOT',
        'PORT',
        'HOST',
        'SOURCES_STAGING_SECRET',
      ])
        delete normalEnvironment[key];
      const normalOutput = await run(
        process.execPath,
        [
          path.join(installed, 'node_modules/vitest/vitest.mjs'),
          'run',
          'tests/integration/vp-installed-product-journey.test.ts',
          '--maxWorkers=1',
          '--fileParallelism=false',
          '--testTimeout=240000',
          '--hookTimeout=60000',
        ],
        installed,
        normalEnvironment,
        300_000,
      );
      expect(normalOutput).toContain('INSTALLED_ARTIFACT_NORMAL_PRODUCT_HTTP_FAKE_ONLY');
      console.log(normalOutput);
      console.log(
        JSON.stringify({
          proof: 'SYNTHETIC_APPLICATION_DISTRIBUTION_RECOVERY_AND_NORMAL_FAKE_PRODUCT',
          sourceBaseSha: sourceSha,
          sourceSnapshotIncludesLocalChanges: true,
          sourceDigest,
          syntheticSha,
          runtimeFiles: runtimeFiles.length,
          archiveSha256: sha256(await readFile(archive)),
          node: process.version,
          installedPackageCount: Object.keys(lock.packages).length,
          childGenerations: 3,
          sameShaReuse: true,
          ownerCrashRecovery: true,
          liveProviderCalls: 0,
          installedNormalProductJourneyPassed: true,
          operatingCanonicalInstalled: false,
          desktopShortcutProven: false,
          windowsRebootProven: false,
        }),
      );
    } finally {
      for (const owner of owners) {
        if (owner.connected) owner.send({ type: 'shutdown' });
        if (owner.exitCode === null && owner.signalCode === null) {
          await waitFor(
            async () => (owner.exitCode !== null || owner.signalCode !== null ? true : undefined),
            'owned fixture shutdown',
            15_000,
          ).catch(() => {
            owner.kill();
          });
        }
      }
      await db?.dispose();
      const assertCleanupRoot = (): void => {
        if (
          !path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
          !path.basename(directory).startsWith('shotgun-vp-application-distribution-')
        )
          throw new Error('Unsafe distribution cleanup root.');
      };
      assertCleanupRoot();
      if (process.env.VP_DISTRIBUTION_PROOF_KEEP_TEMP === 'true') {
        console.log(
          JSON.stringify({
            retainedOwnedDistributionDirectory: directory,
            processesAndDatabasesCleaned: true,
            scope: 'SYNTHETIC_DEVELOPER_PROOF_ONLY',
          }),
        );
      } else {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  900_000,
);
