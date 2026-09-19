import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../../adapters/postgres-maintenance-lock/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

type ReadyMessage = { readonly pid: number; readonly port: number };
type ChildResult = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const childFixture = path.resolve('tests/database/fixtures/runtime-maintenance-session-child.ts');
const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const waitForChild = (child: ChildProcess): Promise<ChildResult> =>
  new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

const waitForChildMessage = (child: ChildProcess, expected: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (child.stdout === null) {
      reject(new Error('C4 child stdout was not piped.'));
      return;
    }
    let buffered = '';
    const timer = setTimeout(() => {
      child.stdout?.off('data', onData);
      reject(new Error(`C4 child did not emit ${expected}.`));
    }, 10_000);
    const onData = (chunk: Buffer | string): void => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      if (!lines.some((line) => line === expected)) return;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      resolve();
    };
    child.stdout.on('data', onData);
  });

const waitForReady = (child: ChildProcess): Promise<ReadyMessage> =>
  new Promise((resolve, reject) => {
    if (child.stdout === null || child.stderr === null) {
      reject(new Error('C4 child stdio was not piped.'));
      return;
    }
    let stderr = '';
    const output = createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      output.close();
      child.stdout?.resume();
      reject(new Error(`C4 child did not become ready. stderr=${stderr}`));
    }, 30_000);
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    output.on('line', (line) => {
      if (!line.startsWith('READY ')) return;
      clearTimeout(timer);
      output.close();
      child.stdout?.resume();
      try {
        resolve(JSON.parse(line.slice('READY '.length)) as ReadyMessage);
      } catch (error) {
        reject(error);
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      output.close();
      child.stdout?.resume();
      reject(
        new Error(`C4 child exited before ready: code=${code} signal=${signal} stderr=${stderr}`),
      );
    });
  });

const launchChild = async (
  assetRoot: string,
): Promise<{
  readonly child: ChildProcess;
  readonly ready: ReadyMessage;
  readonly stderr: () => string;
}> => {
  const child = spawn(process.execPath, [tsxCli, childFixture], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      SHOTGUN_C4_DATABASE_URL: databaseUrl!,
      SHOTGUN_C4_ASSET_ROOT: assetRoot,
      SHOTGUN_C4_PORT: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  return { child, ready: await waitForReady(child), stderr: () => stderr };
};

const findMaintenanceBackend = async (pid: number): Promise<number> => {
  const result = await pool!.query<{ pid: number }>(
    `SELECT pid
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND application_name = $1
       AND pid <> pg_backend_pid()`,
    [`shotgun-runtime-maintenance:${pid}`],
  );
  const backendPid = result.rows[0]?.pid;
  if (backendPid === undefined)
    throw new Error(`C4 maintenance backend for child ${pid} not found.`);
  return backendPid;
};

const expectHealth = async (port: number): Promise<void> => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  expect(response.ok).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
};

const expectExclusiveAvailable = async (): Promise<void> => {
  const client = await pool!.connect();
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await acquireMaintenanceLock(client, 'exclusive', true)) {
        await releaseMaintenanceLock(client, 'exclusive');
        return;
      }
      await wait(100);
    }
  } finally {
    client.release();
  }
  throw new Error('C4 exclusive maintenance lock did not become available.');
};

describe.runIf(pool)('TS-5 runtime maintenance session loss', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('fails stopped after the dedicated PostgreSQL session is terminated', async () => {
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-c4-loss-'));
    let child: ChildProcess | undefined;
    try {
      const launched = await launchChild(assetRoot);
      child = launched.child;
      await expectHealth(launched.ready.port);

      const lockProbe = await pool!.connect();
      try {
        expect(await acquireMaintenanceLock(lockProbe, 'exclusive', true)).toBe(false);
      } finally {
        lockProbe.release();
      }

      const backendPid = await findMaintenanceBackend(launched.ready.pid);
      const terminated = await pool!.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated',
        [backendPid],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);

      const result = await waitForChild(child);
      expect(result.code).toBe(1);
      expect(result.signal).toBeNull();
      await expectExclusiveAvailable();
      expect(launched.stderr()).toContain('fail-stopping');
    } finally {
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await waitForChild(child);
      }
      await rm(assetRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('treats normal shutdown as expected and releases the shared lock', async () => {
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-c4-close-'));
    let child: ChildProcess | undefined;
    try {
      const launched = await launchChild(assetRoot);
      child = launched.child;
      await expectHealth(launched.ready.port);

      const lockProbe = await pool!.connect();
      try {
        expect(await acquireMaintenanceLock(lockProbe, 'exclusive', true)).toBe(false);
      } finally {
        lockProbe.release();
      }

      child.stdin?.write('CLOSE\n');
      const result = await waitForChild(child);
      expect(result.code, launched.stderr()).toBe(0);
      expect(result.signal).toBeNull();
      await expectExclusiveAvailable();
      expect(launched.stderr()).not.toContain('fail-stopping');
    } finally {
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await waitForChild(child);
      }
      await rm(assetRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('marks shutdown intent before an in-flight request drains', async () => {
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-c4-overlap-'));
    let child: ChildProcess | undefined;
    let holdRequest: Promise<Response> | undefined;
    try {
      const launched = await launchChild(assetRoot);
      child = launched.child;
      await expectHealth(launched.ready.port);

      let holdFailure: string | undefined;
      holdRequest = fetch(`http://127.0.0.1:${launched.ready.port}/health?c4_hold=1`, {
        headers: { connection: 'close' },
      }).then((response) => {
        if (!response.ok) throw new Error(`hold request returned ${response.status}`);
        return response;
      });
      void holdRequest.catch((error: unknown) => {
        holdFailure = error instanceof Error ? error.message : String(error);
      });
      try {
        await waitForChildMessage(child, 'HOLDING');
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ${holdFailure ?? ''}`,
        );
      }
      child.stdin?.write('CLOSE\n');
      await waitForChildMessage(child, 'CLOSE_STARTED');

      const backendPid = await findMaintenanceBackend(launched.ready.pid);
      const terminated = await pool!.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated',
        [backendPid],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      await wait(300);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();

      const childExit = waitForChild(child);
      child.stdin?.write('RELEASE\n');
      await expect(holdRequest).resolves.toMatchObject({ ok: true });
      const result = await childExit;
      expect(result.code, launched.stderr()).toBe(0);
      expect(result.signal).toBeNull();
      await expectExclusiveAvailable();
      expect(launched.stderr()).not.toContain('fail-stopping');
    } finally {
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        child.stdin?.write('RELEASE\n');
        child.kill('SIGTERM');
        await waitForChild(child);
      }
      await rm(assetRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
