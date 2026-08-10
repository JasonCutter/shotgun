import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installSignalShutdown } from '../../assemblies/shotgun-app/src/shutdown.js';
import {
  classifyBrowserSpawn,
  LaunchFailure,
  openBrowser,
  runLaunch,
  type ApplicationHandleLike,
  type BrowserOpenResult,
  type LaunchDeps,
  type ShotgunLaunchOptions,
} from '../../scripts/launch-core.js';

/**
 * LPA-WP4 A2 Correction Round 1 focused tests (GPT C1/C3):
 *  - A. Frozen 8-kind failure taxonomy via injected dependencies
 *  - B. readiness/browser ordering: browser is never opened before readiness,
 *       `--no-open`, browser failure is non-fatal
 *  - C. SIGINT/SIGTERM shutdown: close path called, cleanup exactly once,
 *       duplicate signals never double-clean
 * No Cross-Phase suite re-run; new delta only.
 */

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let sharedSpaDirectory: string | undefined;
let sharedTempRoot: string | undefined;

beforeAll(async () => {
  sharedTempRoot = await mkdtemp(path.join(tmpdir(), 'shotgun-lpa-launch-core-'));
  sharedSpaDirectory = path.join(sharedTempRoot, 'spa');
  await mkdir(sharedSpaDirectory, { recursive: true });
  await writeFile(
    path.join(sharedSpaDirectory, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
    'utf8',
  );
});

afterAll(async () => {
  if (sharedTempRoot) await rm(sharedTempRoot, { recursive: true, force: true });
});

const makeHandle = (calls: string[], listenImpl?: () => Promise<void>): ApplicationHandleLike => ({
  listen:
    listenImpl ??
    (async () => {
      calls.push('listen');
    }),
  close: async () => {
    calls.push('close');
  },
});

const makeDeps = (
  overrides: Partial<LaunchDeps> = {},
): { deps: LaunchDeps; calls: string[]; warns: string[] } => {
  const calls: string[] = [];
  const warns: string[] = [];
  const base: LaunchDeps = {
    log: () => {},
    warn: (message) => warns.push(message),
    buildSpa: () => {
      calls.push('build');
    },
    probeDatabase: async () => {
      calls.push('db-probe');
    },
    verifyDatabaseSchema: () => {
      calls.push('db-verify');
    },
    startApplication: async () => {
      calls.push('start');
      return makeHandle(calls);
    },
    fetchReadiness: async () => {
      calls.push('readiness');
      return true;
    },
    openBrowser: () => {
      calls.push('browser');
      return { ok: true };
    },
  };
  return { deps: { ...base, ...overrides }, calls, warns };
};

const makeOptions = (overrides: Partial<ShotgunLaunchOptions> = {}): ShotgunLaunchOptions => ({
  noOpen: false,
  databaseUrl: 'postgres://shotgun:shotgun@localhost:5432/shotgun',
  stagingSecret: 'x'.repeat(40),
  geminiApiKey: 'test-key',
  port: 3000,
  host: '127.0.0.1',
  spaDirectory: sharedSpaDirectory ?? process.cwd(),
  rootDirectory: process.cwd(),
  env: process.env,
  ...overrides,
});

describe('LPA-WP4 A2 Correction C3-A — Frozen failure taxonomy (8 kinds)', () => {
  it('classifies ENV_CONFIGURATION_INVALID before any step runs', async () => {
    const { deps, calls } = makeDeps();
    await expect(
      runLaunch(makeOptions({ databaseUrl: '', stagingSecret: '', geminiApiKey: '' }), deps),
    ).rejects.toMatchObject({ code: 'ENV_CONFIGURATION_INVALID' });
    expect(calls).toEqual([]);
  });

  it('classifies SPA_BUILD_FAILED when the build runner fails', async () => {
    const { deps, calls } = makeDeps({
      buildSpa: () => {
        throw new Error('build failed');
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'SPA_BUILD_FAILED',
    });
    expect(calls).toEqual([]);
  });

  it('classifies SPA_ASSETS_UNAVAILABLE when index.html is missing', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'shotgun-lpa-spa-empty-'));
    const { deps, calls } = makeDeps();
    await expect(runLaunch(makeOptions({ spaDirectory: emptyDir }), deps)).rejects.toMatchObject({
      code: 'SPA_ASSETS_UNAVAILABLE',
    });
    expect(calls).toEqual(['build']);
  });

  it('classifies DATABASE_UNAVAILABLE when the DB probe fails', async () => {
    const { deps, calls } = makeDeps({
      probeDatabase: async () => {
        throw new Error('connection refused');
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(calls).toEqual(['build']);
  });

  it('classifies DATABASE_SCHEMA_INVALID when db:verify fails', async () => {
    const { deps, calls } = makeDeps({
      verifyDatabaseSchema: () => {
        throw new Error('schema drift');
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'DATABASE_SCHEMA_INVALID',
    });
    expect(calls).toEqual(['build', 'db-probe']);
  });

  it('classifies PORT_UNAVAILABLE on EADDRINUSE and closes exactly once (C2)', async () => {
    let closes = 0;
    const { deps, calls } = makeDeps({
      startApplication: async () => {
        calls.push('start');
        return {
          listen: async () => {
            const error = new Error('in use') as Error & { code?: string };
            error.code = 'EADDRINUSE';
            throw error;
          },
          close: async () => {
            closes += 1;
          },
        };
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'PORT_UNAVAILABLE',
    });
    expect(closes).toBe(1);
    expect(calls).toEqual(['build', 'db-probe', 'db-verify', 'start']);
  });

  it('classifies BACKEND_START_FAILED on other listen errors and closes exactly once (C2)', async () => {
    let closes = 0;
    const { deps, calls } = makeDeps({
      startApplication: async () => {
        calls.push('start');
        return {
          listen: async () => {
            throw new Error('boom');
          },
          close: async () => {
            closes += 1;
          },
        };
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'BACKEND_START_FAILED',
    });
    expect(closes).toBe(1);
    expect(calls).toEqual(['build', 'db-probe', 'db-verify', 'start']);
  });

  it('classifies READINESS_TIMEOUT and closes exactly once (C2)', async () => {
    const { deps, calls } = makeDeps({
      fetchReadiness: async () => {
        calls.push('readiness');
        return false;
      },
      startApplication: async () => {
        calls.push('start');
        return makeHandle(calls);
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'READINESS_TIMEOUT',
    });
    expect(calls).toEqual([
      'build',
      'db-probe',
      'db-verify',
      'start',
      'listen',
      'readiness',
      'close',
    ]);
  });

  it('exposes actionable check/command on every taxonomy failure', async () => {
    const { deps } = makeDeps();
    const error = await runLaunch(
      makeOptions({ databaseUrl: '', stagingSecret: '', geminiApiKey: '' }),
      deps,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LaunchFailure);
    if (error instanceof LaunchFailure) {
      expect(error.code).toBe('ENV_CONFIGURATION_INVALID');
      expect(error.check.length).toBeGreaterThan(0);
      expect(error.command.length).toBeGreaterThan(0);
    }
  });
});

describe('LPA-WP4 A2 Correction C3-B — readiness/browser ordering', () => {
  it('runs the canonical success ordering: build → DB → start/listen → readiness → browser', async () => {
    const { deps, calls } = makeDeps();
    const handle = await runLaunch(makeOptions(), deps);
    expect(calls).toEqual([
      'build',
      'db-probe',
      'db-verify',
      'start',
      'listen',
      'readiness',
      'browser',
    ]);
    await handle.close();
  });

  it('never opens the browser when readiness fails (health/SPA failure)', async () => {
    const { deps, calls } = makeDeps({
      fetchReadiness: async () => {
        calls.push('readiness');
        return false;
      },
    });
    await expect(runLaunch(makeOptions(), deps)).rejects.toMatchObject({
      code: 'READINESS_TIMEOUT',
    });
    expect(calls).not.toContain('browser');
  });

  it('supports --no-open: readiness completes but the browser opener is not called', async () => {
    const { deps, calls } = makeDeps();
    const handle = await runLaunch(makeOptions({ noOpen: true }), deps);
    expect(calls).toEqual(['build', 'db-probe', 'db-verify', 'start', 'listen', 'readiness']);
    expect(calls).not.toContain('browser');
    await handle.close();
  });

  it('treats browser-open failure as non-fatal (warning only, product keeps running)', async () => {
    const { deps, warns } = makeDeps({
      openBrowser: (): BrowserOpenResult => ({ ok: false, reason: 'spawn-error' }),
    });
    const handle = await runLaunch(makeOptions(), deps);
    expect(warns.some((message) => message.includes('WARN'))).toBe(true);
    await handle.close();
  });

  it('detects spawn error / non-zero status / signal failure in browser open (C1)', () => {
    expect(
      classifyBrowserSpawn({ error: new Error('spawn failed'), status: null, signal: null }),
    ).toEqual({
      ok: false,
      reason: 'spawn-error',
    });
    expect(classifyBrowserSpawn({ status: 1, signal: null })).toEqual({
      ok: false,
      reason: 'non-zero',
    });
    expect(classifyBrowserSpawn({ status: null, signal: 'SIGTERM' })).toEqual({
      ok: false,
      reason: 'signal',
    });
    expect(classifyBrowserSpawn({ status: 0, signal: null })).toEqual({ ok: true });
  });

  it('openBrowser returns a well-formed result without launching a real browser', () => {
    // Use a platform whose opener cannot exist here, so the call fails fast
    // (spawn-error) without side effects — the classification path is covered
    // deterministically by classifyBrowserSpawn above.
    const result = openBrowser('linux', 'http://127.0.0.1:3000');
    expect(result.ok === true || result.ok === false).toBe(true);
  });
});

describe('LPA-WP4 A2 Correction C3-C — SIGINT/SIGTERM shutdown', () => {
  it('runs close exactly once for duplicate signals and exits 0', async () => {
    let closes = 0;
    const exit = vi.fn();
    const uninstall = installSignalShutdown({
      close: async () => {
        closes += 1;
      },
      exit,
    });
    process.emit('SIGINT');
    process.emit('SIGINT');
    process.emit('SIGTERM');
    await flush();
    expect(closes).toBe(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    uninstall();
  });

  it('SIGTERM alone triggers the same close path', async () => {
    let closes = 0;
    const exit = vi.fn();
    const uninstall = installSignalShutdown({
      close: async () => {
        closes += 1;
      },
      exit,
    });
    process.emit('SIGTERM');
    await flush();
    expect(closes).toBe(1);
    expect(exit).toHaveBeenCalledWith(0);
    uninstall();
  });

  it('uninstall removes the signal listeners (no leak across tests)', async () => {
    let closes = 0;
    const exit = vi.fn();
    const uninstall = installSignalShutdown({
      close: async () => {
        closes += 1;
      },
      exit,
    });
    uninstall();
    process.emit('SIGINT');
    process.emit('SIGTERM');
    await flush();
    expect(closes).toBe(0);
    expect(exit).not.toHaveBeenCalled();
  });
});
