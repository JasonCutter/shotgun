import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runtimeWorkerFromChildProcess,
  superviseRuntime,
} from '../../scripts/launch-supervisor.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL?.trim());
const childScript = fileURLToPath(
  new URL('../fixtures/vp-supervised-app-child.mjs', import.meta.url),
);
const temporaryAssetRoots: string[] = [];
const temporaryProxyServers: Server[] = [];
const temporaryDatabaseDisposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  const closingServers = temporaryProxyServers.splice(0).map(
    (server) =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const disposingDatabases = temporaryDatabaseDisposals.splice(0).map((dispose) => dispose());
  const deletingAssets = temporaryAssetRoots
    .splice(0)
    .map((root) => rm(root, { recursive: true, force: true }));
  await Promise.all([...closingServers, ...disposingDatabases, ...deletingAssets]);
});

const listenOnEphemeralPort = async (server: Server, closeAfterListen = false): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
  const port = address.port;
  if (closeAfterListen) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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

describe.skipIf(!enabled)('VP-07 real PostgreSQL recovery through the launched app', () => {
  it('restarts the app after its database session is lost and resumes after connectivity returns', async () => {
    const isolated = await createIsolatedPostgresTestDatabase();
    temporaryDatabaseDisposals.push(isolated.dispose);
    const originalDatabaseUrl = new URL(isolated.databaseUrl);
    let forwardDatabase = true;
    const proxySockets = new Set<Socket>();
    const proxy = createServer((client) => {
      proxySockets.add(client);
      client.once('close', () => proxySockets.delete(client));
      client.on('error', () => {});
      if (!forwardDatabase) {
        client.destroy();
        return;
      }
      const databaseSocket = connect({
        host: originalDatabaseUrl.hostname,
        port: Number(originalDatabaseUrl.port),
      });
      proxySockets.add(databaseSocket);
      databaseSocket.once('close', () => proxySockets.delete(databaseSocket));
      databaseSocket.on('error', () => client.destroy());
      client.pipe(databaseSocket);
      databaseSocket.pipe(client);
    });
    temporaryProxyServers.push(proxy);
    const proxyPort = await listenOnEphemeralPort(proxy);
    const proxiedDatabaseUrl = new URL(isolated.databaseUrl);
    proxiedDatabaseUrl.hostname = '127.0.0.1';
    proxiedDatabaseUrl.port = String(proxyPort);
    const port = await listenOnEphemeralPort(createServer(), true);
    const assetRoot = await mkdtemp(path.join(tmpdir(), 'shotgun-vp-supervisor-assets-'));
    temporaryAssetRoots.push(assetRoot);
    const controller = new AbortController();
    let readyCount = 0;
    let resolveFirstReady: (() => void) | undefined;
    let resolveRecoveredReady: (() => void) | undefined;
    const firstReady = new Promise<void>((resolve) => {
      resolveFirstReady = resolve;
    });
    const recoveredReady = new Promise<void>((resolve) => {
      resolveRecoveredReady = resolve;
    });
    const logs: string[] = [];
    let childOutput = '';
    let childCount = 0;

    const supervisor = superviseRuntime(
      {
        spawnWorker: () => {
          childCount += 1;
          const child = fork(childScript, [], {
            cwd: path.resolve('.'),
            execArgv: ['--import', 'tsx'],
            env: {
              ...process.env,
              DATABASE_URL: proxiedDatabaseUrl.toString(),
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
          if (readyCount === 2) {
            resolveRecoveredReady?.();
            controller.abort();
          }
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

    try {
      await withTimeout(
        Promise.race([firstReady, supervisorFailure]),
        120_000,
        `initial app readiness. Child log: ${childOutput.replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, 'postgres://[redacted]@')}`,
      );
      forwardDatabase = false;
      for (const socket of proxySockets) socket.destroy();

      await Promise.race([
        waitFor(
          () => logs.some((message) => message.includes('DATABASE_UNAVAILABLE')),
          120_000,
          'a supervised startup retry while PostgreSQL connectivity is blocked',
        ),
        supervisorFailure,
      ]);
      expect(readyCount).toBe(1);
      expect(childCount).toBeGreaterThanOrEqual(2);

      forwardDatabase = true;
      await withTimeout(
        Promise.race([recoveredReady, supervisorFailure]),
        120_000,
        `app recovery after database connectivity returned. Child log: ${childOutput.replace(/postgres(?:ql)?:\/\/[^@\s]+@/giu, 'postgres://[redacted]@')}`,
      );
      await supervisor;
      expect(readyCount).toBe(2);
      expect(childCount).toBeGreaterThanOrEqual(3);
      expect(logs.some((message) => message.includes('RECOVERY'))).toBe(true);
    } finally {
      controller.abort();
      await supervisor.catch(() => {});
      for (const socket of proxySockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await isolated.dispose();
    }
  }, 300_000);
});
