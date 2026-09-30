import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fork } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import { afterEach, describe, expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import {
  runtimeWorkerFromChildProcess,
  superviseRuntime,
} from '../../scripts/launch-supervisor.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const enabled = process.env.VP_RUNTIME_POSTGRES_CONTAINER_RESTART === '1';
const execFileAsync = promisify(execFile);
const postgresImage =
  'pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b';
const childScript = fileURLToPath(
  new URL('../fixtures/vp-supervised-app-child.mjs', import.meta.url),
);
const temporaryAssetRoots: string[] = [];
const temporaryServers: Server[] = [];

afterEach(async () => {
  const closingServers = temporaryServers.splice(0).map(
    (server) =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const deletingAssets = temporaryAssetRoots
    .splice(0)
    .map((root) => rm(root, { recursive: true, force: true }));
  await Promise.all([...closingServers, ...deletingAssets]);
});

const docker = async (...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('docker', args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1_000_000,
    windowsHide: true,
  });
  return stdout.trim();
};

const listenOnEphemeralPort = async (server: Server): Promise<number> => {
  temporaryServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const waitForPostgres = async (databaseUrl: string): Promise<void> => {
  const deadline = Date.now() + 60_000;
  let lastFailure: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastFailure = error;
      await client.end().catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${String(lastFailure)}`);
};

const readProjectThroughAppAfterReconnect = async (
  baseUrl: string,
  projectId: string,
  diagnostics: () => string,
): Promise<void> => {
  const deadline = Date.now() + 120_000;
  let sessionCookie: string | undefined;
  let lastFailure = 'app has not returned a database-backed project list';
  while (Date.now() < deadline) {
    try {
      if (!sessionCookie) {
        const bootstrap = await fetch(`${baseUrl}/api/v1/session/local-bootstrap`, {
          method: 'POST',
          headers: {
            Origin: baseUrl,
            Referer: `${baseUrl}/`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        if (bootstrap.ok) {
          const cookieHeader = bootstrap.headers.get('set-cookie');
          const cookieValue = cookieHeader?.match(/(?:^|,\s*)shotgun_session=([^;]+)/u)?.[1];
          if (cookieValue) sessionCookie = `shotgun_session=${cookieValue}`;
          if (!sessionCookie) lastFailure = 'local session bootstrap returned no session cookie';
        } else {
          lastFailure = `local session bootstrap returned HTTP ${bootstrap.status}: ${await bootstrap.text()}`;
        }
      }
      if (sessionCookie) {
        const response = await fetch(`${baseUrl}/api/v1/projects`, {
          headers: { Cookie: sessionCookie },
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            readonly projects?: readonly { readonly id?: string }[];
          };
          if (payload.projects?.some((project) => project.id === projectId)) return;
          lastFailure = 'database-backed project list omitted the persisted project';
        } else {
          lastFailure = `database-backed project list returned HTTP ${response.status}`;
        }
      }
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const causeCode =
        cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : undefined;
      lastFailure = `${error instanceof Error ? error.message : String(error)}${causeCode ? ` (${causeCode})` : ''}`;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `App did not read persisted data after PostgreSQL recovered: ${lastFailure}. ${diagnostics()}`,
  );
};

describe.skipIf(!enabled)('VP-07 PostgreSQL server restart recovery', () => {
  it('restarts the actual PostgreSQL container and restores app readiness with persisted data', async () => {
    const containerName = `shotgun-vp-pg-restart-${Date.now()}-${randomBytes(4).toString('hex')}`;
    let containerCreated = false;
    let isolatedPool: ReturnType<typeof createPostgresPool> | undefined;
    let verificationPool: ReturnType<typeof createPostgresPool> | undefined;
    let controller: AbortController | undefined;
    let supervisor: Promise<void> | undefined;

    try {
      const databasePort = await listenOnEphemeralPort(createServer());
      await docker(
        'run',
        '--detach',
        '--name',
        containerName,
        '--label',
        'com.shotgun.test=vp-postgres-server-restart',
        '--env',
        'POSTGRES_DB=shotgun_test',
        '--env',
        'POSTGRES_USER=shotgun',
        '--env',
        'POSTGRES_PASSWORD=shotgun',
        '--publish',
        `127.0.0.1:${databasePort}:5432`,
        postgresImage,
      );
      containerCreated = true;

      expect(Number.isSafeInteger(databasePort)).toBe(true);
      expect(databasePort).toBeGreaterThan(0);
      const databaseUrl = `postgres://shotgun:shotgun@127.0.0.1:${databasePort}/shotgun_test`;
      await waitForPostgres(databaseUrl);
      await requireTestDatabaseTarget({ environment: { TEST_DATABASE_URL: databaseUrl } });
      await migrateUpTo(undefined, databaseUrl);

      isolatedPool = createPostgresPool(databaseUrl);
      const authRepository = new PostgresAuthRepository(isolatedPool);
      const principal = await authRepository.bootstrapLocalOwnerPrincipal({
        accountId: 'local-owner',
      });
      const projectId = `vp-pg-restart-${randomUUID()}`;
      await new PostgresProjectAdministrationRepository(isolatedPool).createProject({
        commandId: randomUUID(),
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectId,
        name: 'VP PostgreSQL server restart recovery',
        description: 'test data must remain after a real database server restart',
        actorPrincipalId: principal.principalId,
        expectedProjectRevision: 0,
      });
      await authRepository.createProjectOwnerMembership({
        principalId: principal.principalId,
        projectId,
        scopes: ['owner', 'admin', 'read', 'write'],
        sensitivityClearance: 'restricted',
      });
      const beforeRestart = await isolatedPool.query<{ started_at: Date }>(
        'SELECT pg_postmaster_start_time() AS started_at',
      );
      await isolatedPool.end();
      isolatedPool = undefined;

      const port = await listenOnEphemeralPort(createServer());
      const assetRoot = await mkdtemp(path.join(tmpdir(), 'shotgun-vp-server-restart-assets-'));
      temporaryAssetRoots.push(assetRoot);
      controller = new AbortController();
      let readyCount = 0;
      let resolveFirstReady: (() => void) | undefined;
      const firstReady = new Promise<void>((resolve) => {
        resolveFirstReady = resolve;
      });
      const logs: string[] = [];
      let childOutput = '';
      let childCount = 0;

      supervisor = superviseRuntime(
        {
          spawnWorker: () => {
            childCount += 1;
            const child = fork(childScript, [], {
              cwd: path.resolve('.'),
              execArgv: ['--import', 'tsx'],
              env: {
                ...process.env,
                DATABASE_URL: databaseUrl,
                SOURCES_STAGING_SECRET: randomBytes(32).toString('hex'),
                HOST: '127.0.0.1',
                PORT: String(port),
                ASSET_STORAGE_ROOT: assetRoot,
                NODE_ENV: 'development',
              },
              stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            });
            const capture = (chunk: Buffer | string): void => {
              childOutput = (childOutput + chunk.toString()).slice(-20_000);
            };
            child.stdout?.on('data', capture);
            child.stderr?.on('data', capture);
            return runtimeWorkerFromChildProcess(child);
          },
          markStarting: async () => {},
          markReady: async () => {
            readyCount += 1;
            if (readyCount === 1) resolveFirstReady?.();
          },
          openBrowser: () => {},
          log: (message) => logs.push(message),
          delay: (milliseconds, signal) =>
            new Promise<void>((resolve) => {
              if (signal.aborted) return resolve();
              const timer = setTimeout(resolve, milliseconds);
              signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  resolve();
                },
                { once: true },
              );
            }),
        },
        controller.signal,
      );
      const supervisorFailure = supervisor.then(
        () => new Promise<never>(() => {}),
        (error: unknown) => Promise.reject(error),
      );

      await withTimeout(
        Promise.race([firstReady, supervisorFailure]),
        120_000,
        `initial app readiness. Child log: ${childOutput.replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, 'postgres://[redacted]@')}`,
      );
      await docker('stop', '--time', '1', containerName);
      await waitFor(
        () => childOutput.includes('[postgres] DATABASE_IDLE_CLIENT_ERROR'),
        120_000,
        'the app pool to handle PostgreSQL idle-session termination',
      );
      expect(readyCount).toBe(1);
      expect(childCount).toBe(1);

      await docker('start', containerName);
      await waitForPostgres(databaseUrl);
      await Promise.race([
        readProjectThroughAppAfterReconnect(
          `http://127.0.0.1:${port}`,
          projectId,
          () =>
            `readyCount=${readyCount}; childCount=${childCount}; supervisorLogs=${JSON.stringify(logs)}; childOutput=${childOutput.replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, 'postgres://[redacted]@')}`,
        ),
        supervisorFailure,
      ]);
      controller.abort();
      await supervisor;

      verificationPool = createPostgresPool(databaseUrl);
      const afterRestart = await verificationPool.query<{ started_at: Date }>(
        'SELECT pg_postmaster_start_time() AS started_at',
      );
      const persistedProject = await verificationPool.query<{
        readonly id: string;
        readonly name: string;
      }>('SELECT id, name FROM project_admin.projects WHERE id = $1', [projectId]);
      expect(afterRestart.rows[0]?.started_at.getTime()).toBeGreaterThan(
        beforeRestart.rows[0]!.started_at.getTime(),
      );
      expect(persistedProject.rows).toEqual([
        { id: projectId, name: 'VP PostgreSQL server restart recovery' },
      ]);
      expect(readyCount).toBeGreaterThanOrEqual(2);
      expect(childCount).toBeGreaterThanOrEqual(2);
      expect(logs.some((message) => message.includes('[launch] RECOVERY'))).toBe(true);
      expect(childOutput).not.toContain("Unhandled 'error' event");
    } finally {
      controller?.abort();
      await supervisor?.catch(() => {});
      await verificationPool?.end();
      await isolatedPool?.end();
      if (containerCreated) await docker('rm', '--force', containerName);
    }
  }, 300_000);
});
