/**
 * Shotgun Local Launch — owner-facing single command.
 *
 * The canonical owner process reserves the runtime identity and supervises a
 * replaceable application child. A child reports ready only after the normal
 * DB, app and HTTP checks pass. Temporary DB/network failures restart the child
 * with bounded backoff; the owner keeps the runtime identity in `starting`
 * until readiness returns.
 */
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

import { LaunchFailure, openBrowser, runLaunch } from './launch-core.js';
import {
  createDefaultCanonicalLaunchDeps,
  runCanonicalLaunchPreflight,
} from './launch-canonical.js';
import { runtimeWorkerFromChildProcess, superviseRuntime } from './launch-supervisor.js';
import { installSignalShutdown } from '../assemblies/shotgun-app/src/shutdown.js';
import { recoverSourceKnowledgeResetsBeforeRuntime } from './t3-launch-recovery.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeChildEnvironmentKey = 'SHOTGUN_LAUNCH_RUNTIME_CHILD';

const formatFailure = (
  error: unknown,
): {
  readonly type: 'startup-failure';
  readonly code?: string;
  readonly message: string;
  readonly check?: string;
  readonly command?: string;
} => {
  if (error instanceof LaunchFailure) {
    return {
      type: 'startup-failure',
      code: error.code,
      message: error.message,
      check: error.check,
      command: error.command,
    };
  }
  return {
    type: 'startup-failure',
    code: 'BACKEND_START_FAILED',
    message: error instanceof Error ? error.message : String(error),
    check: 'Inspect the application child log for the startup failure.',
    command: 'npm run launch',
  };
};

const runApplicationChild = async (): Promise<void> => {
  let application: Awaited<ReturnType<typeof runLaunch>> | undefined;
  let shutdownRequested = false;
  let disconnected = false;
  let closing = false;

  const closeApplication = (exitCode: number): void => {
    shutdownRequested = true;
    if (!application || closing) {
      if (disconnected && !application) process.exit(exitCode);
      return;
    }
    closing = true;
    void application.close().finally(() => process.exit(exitCode));
  };

  process.on('message', (message: unknown) => {
    if (
      message !== null &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === 'shutdown'
    ) {
      closeApplication(0);
    }
  });
  process.once('disconnect', () => {
    disconnected = true;
    if (application) closeApplication(1);
    else process.exit(1);
  });

  try {
    const { createDefaultLaunchDeps } = await import('./launch-default-deps.js');
    application = await runLaunch(
      {
        noOpen: true,
        noSignals: true,
        port: Number.parseInt(process.env.PORT ?? '3000', 10),
        host: process.env.HOST ?? '127.0.0.1',
        spaDirectory: path.join(rootDirectory, 'apps', 'shotgun-web', 'dist'),
        rootDirectory,
        env: process.env,
        environmentProfile: 'runtime-development',
        beforeApplicationStart: async ({ databaseUrl, rootDirectory, environment }) => {
          await recoverSourceKnowledgeResetsBeforeRuntime({
            databaseUrl,
            rootDirectory,
            environment,
            log: (message) => console.log(message),
          });
        },
      },
      createDefaultLaunchDeps(),
    );
  } catch (error) {
    if (!shutdownRequested && process.connected) {
      process.send?.(formatFailure(error), () => process.exit(1));
    } else {
      process.exit(1);
    }
    return;
  }

  if (shutdownRequested || !process.connected) {
    closeApplication(disconnected ? 1 : 0);
    return;
  }
  process.send?.({ type: 'ready' });
  await new Promise<void>(() => {});
};

const mainOwner = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');
  const canonical = await runCanonicalLaunchPreflight(
    {
      rootDirectory,
      host: process.env.HOST ?? '127.0.0.1',
      port: Number.parseInt(process.env.PORT ?? '3000', 10),
      reexecCount: Number.parseInt(process.env.SHOTGUN_LAUNCH_REEXEC_COUNT ?? '0', 10),
      log: (message) => console.log(message),
    },
    createDefaultCanonicalLaunchDeps(),
  );

  if (canonical.kind === 'reexec') {
    process.exit(canonical.exitCode);
    return;
  }

  if (canonical.kind === 'reuse') {
    if (!noOpen) {
      const result = openBrowser(process.platform, canonical.identity.url);
      if (!result.ok) {
        console.warn(`[launch] WARN  could not open the browser automatically (${result.reason}).`);
      }
    } else {
      console.log('[launch] --no-open: browser open skipped.');
    }
    console.log(`[launch] Open ${canonical.identity.url} manually if the browser did not open.`);
    return;
  }

  const controller = new AbortController();
  const supervisorPromise = superviseRuntime(
    {
      spawnWorker: () => {
        const child = fork(fileURLToPath(import.meta.url), ['--runtime-child'], {
          env: { ...process.env, [runtimeChildEnvironmentKey]: '1' },
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
        return runtimeWorkerFromChildProcess(child);
      },
      markStarting: canonical.runtime.markStarting,
      markReady: canonical.runtime.markReady,
      openBrowser: () => {
        if (noOpen) {
          console.log('[launch] --no-open: browser open skipped.');
          return;
        }
        const result = openBrowser(process.platform, canonical.runtime.identity.url);
        if (!result.ok) {
          console.warn(
            `[launch] WARN  could not open the browser automatically (${result.reason}).`,
          );
        }
        console.log(
          `[launch] Open ${canonical.runtime.identity.url} manually if the browser did not open.`,
        );
      },
      log: (message) => console.log(message),
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

  const close = async (): Promise<void> => {
    controller.abort();
    try {
      await supervisorPromise;
    } finally {
      await canonical.runtime.release();
    }
  };
  const uninstallSignalShutdown = installSignalShutdown({
    close,
    exit: (code) => process.exit(code),
  });

  try {
    await supervisorPromise;
  } catch (error) {
    await canonical.runtime.release().catch(() => {});
    throw error;
  } finally {
    uninstallSignalShutdown();
  }
};

const main = async (): Promise<void> => {
  if (process.env[runtimeChildEnvironmentKey] === '1') {
    await runApplicationChild();
    return;
  }
  await mainOwner();
};

void main().catch((error: unknown) => {
  if (error instanceof LaunchFailure) {
    console.error(`[launch] FAILURE ${error.code}: ${error.message}`);
    console.error(`[launch]   check:  ${error.check}`);
    console.error(`[launch]   action: ${error.command}`);
  } else {
    console.error('[launch] UNEXPECTED', error);
  }
  process.exit(1);
});
