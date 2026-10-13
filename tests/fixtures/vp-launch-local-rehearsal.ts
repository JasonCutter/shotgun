/** Verification entry only: existing Canonical/core/supervisor ports, recovery assembly. */
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCanonicalLaunchPreflight,
  createDefaultCanonicalLaunchDeps,
} from '../../scripts/launch-canonical.js';
import { LaunchFailure, runLaunch } from '../../scripts/launch-core.js';
import {
  runtimeWorkerFromChildProcess,
  superviseRuntime,
} from '../../scripts/launch-supervisor.js';

const entry = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(entry), '../..');
const port = Number(process.env.PORT);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^shotgun_test_iso_/u.test(new URL(databaseUrl).pathname.slice(1))) {
  throw new Error('Distribution rehearsal requires a generated isolated test database.');
}
if (
  process.env.GEMINI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.DEEPSEEK_API_KEY ||
  process.env.VP_GLOBAL_DATABASE_URL ||
  process.env.SHOTGUN_CREDENTIAL_MASTER_KEY
) {
  throw new Error('Provider and operating authority environment is forbidden in this rehearsal.');
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.hostname !== '127.0.0.1' || url.port !== String(port))
    throw new Error('REHEARSAL_EGRESS_FORBIDDEN');
  return originalFetch(input, init);
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--runtime-child')) {
    // Import only after the owner has completed the real Canonical boundary.
    const { createDefaultLaunchDeps } = await import('../../scripts/launch-default-deps.js');
    const { startShotgunApplication } =
      await import('../../assemblies/shotgun-app/src/application.js');
    const { recoverSourceKnowledgeResetsBeforeRuntime } =
      await import('../../scripts/t3-launch-recovery.js');
    // The disconnect handler must tolerate startup before a handle exists.
    // eslint-disable-next-line prefer-const
    let app: Awaited<ReturnType<typeof runLaunch>> | undefined;
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      if (app) void app.close().finally(() => process.exit(0));
      else process.exit(1);
    };
    process.once('disconnect', close);
    process.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'shutdown'
      )
        close();
    });
    const deps = createDefaultLaunchDeps();
    app = await runLaunch(
      {
        rootDirectory: root,
        spaDirectory: path.join(root, 'apps/shotgun-web/dist'),
        host: '127.0.0.1',
        port,
        noOpen: true,
        noSignals: true,
        env: process.env,
        environmentProfile: 'recovery',
        beforeApplicationStart: async (input) => {
          await recoverSourceKnowledgeResetsBeforeRuntime(input);
        },
      },
      {
        ...deps,
        startApplication: async (options) => {
          const application = await startShotgunApplication({
            ...options,
            databaseUrl,
            assetRoot: process.env.ASSET_STORAGE_ROOT,
            environmentProfile: 'recovery',
            recoveryIntervalMs: false,
            disableAskWorker: true,
            aiDurableMaterializationRecoveryEnabled: false,
          });
          if (application.askWorkerStarted)
            throw new Error('Recovery rehearsal started an Ask worker.');
          process.send?.({
            type: 'recovery-observed',
            askWorkerStarted: application.askWorkerStarted,
            canonicalProjects: await application.readCanonicalProjectIds(),
          });
          return application;
        },
      },
    );
    if (!process.connected || closing) return close();
    process.send?.({ type: 'ready' });
    return;
  }
  const canonical = await runCanonicalLaunchPreflight(
    { rootDirectory: root, host: '127.0.0.1', port, reexecCount: 0 },
    createDefaultCanonicalLaunchDeps(),
  );
  if (canonical.kind === 'reuse') {
    process.send?.({ type: 'rehearsal-reuse', identity: canonical.identity }, () =>
      process.exit(0),
    );
    return;
  }
  if (canonical.kind !== 'start') throw new Error('Rehearsal unexpectedly needed a reexec.');
  const controller = new AbortController();
  let child: ReturnType<typeof fork>;
  let generation = 0;
  process.once('disconnect', () => controller.abort());
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const type = (message as { type?: unknown }).type;
    if (type === 'shutdown') controller.abort();
    if (type === 'crash-child') child?.kill();
  });
  try {
    await superviseRuntime(
      {
        spawnWorker: () => {
          generation += 1;
          child = fork(entry, ['--runtime-child'], {
            cwd: root,
            env: process.env,
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          });
          child.on('message', (message: unknown) => {
            if (
              message &&
              typeof message === 'object' &&
              ['recovery-observed', 'startup-failure'].includes(
                String((message as { type?: unknown }).type),
              )
            )
              process.send?.(message);
          });
          return runtimeWorkerFromChildProcess(child);
        },
        markStarting: async () => {
          await canonical.runtime.markStarting();
          process.send?.({ type: 'rehearsal-starting', generation });
        },
        markReady: async () => {
          await canonical.runtime.markReady();
          process.send?.({
            type: 'rehearsal-ready',
            generation,
            childPid: child.pid,
            identity: canonical.runtime.identity,
          });
        },
        openBrowser: () => {},
        log: console.log,
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
  } finally {
    await canonical.runtime.release();
  }
  process.exit(0);
};
void main().catch((error: unknown) => {
  process.send?.(
    {
      type: 'startup-failure',
      code: error instanceof LaunchFailure ? error.code : 'BACKEND_START_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
    () => process.exit(1),
  );
});
