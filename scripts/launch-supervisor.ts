import type { ChildProcess } from 'node:child_process';

import { LaunchFailure, type LaunchFailureCode } from './launch-core.js';

export type RuntimeWorkerMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'startup-failure';
      readonly code?: LaunchFailureCode;
      readonly message: string;
      readonly check?: string;
      readonly command?: string;
    };

export type RuntimeWorker = {
  onMessage(listener: (message: unknown) => void): () => void;
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
  send(message: { readonly type: 'shutdown' }): void;
  kill(): void;
};

export type RuntimeSupervisorDeps = {
  spawnWorker(): RuntimeWorker;
  markStarting(): Promise<void>;
  markReady(): Promise<void>;
  openBrowser(): void;
  log(message: string): void;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
  shutdownTimeoutMs?: number;
};

export const runtimeWorkerFromChildProcess = (child: ChildProcess): RuntimeWorker => ({
  onMessage: (listener) => {
    const handler = (message: unknown): void => listener(message);
    child.on('message', handler);
    return () => child.off('message', handler);
  },
  onExit: (listener) => {
    const handler = (code: number | null, signal: NodeJS.Signals | null): void =>
      listener(code, signal);
    child.once('exit', handler);
    return () => child.off('exit', handler);
  },
  send: (message) => {
    if (child.connected) child.send(message);
  },
  kill: () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  },
});

const RETRYABLE_STARTUP_FAILURES = new Set<LaunchFailureCode>([
  'DATABASE_UNAVAILABLE',
  'BACKEND_START_FAILED',
  'READINESS_TIMEOUT',
]);

const TERMINAL_STARTUP_FAILURES = new Set<LaunchFailureCode>([
  'ENV_CONFIGURATION_INVALID',
  'DATABASE_SCHEMA_INVALID',
  'PORT_UNAVAILABLE',
  'SPA_BUILD_FAILED',
  'SPA_ASSETS_UNAVAILABLE',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isLaunchFailureCode = (value: unknown): value is LaunchFailureCode =>
  typeof value === 'string' &&
  [
    'ENV_CONFIGURATION_INVALID',
    'DATABASE_UNAVAILABLE',
    'DATABASE_SCHEMA_INVALID',
    'PORT_UNAVAILABLE',
    'SPA_BUILD_FAILED',
    'SPA_ASSETS_UNAVAILABLE',
    'BACKEND_START_FAILED',
    'READINESS_TIMEOUT',
    'CANONICAL_BRANCH_INVALID',
    'LAUNCHER_WORKTREE_UNSAFE',
    'GIT_FETCH_FAILED',
    'GIT_FF_ONLY_FAILED',
    'CANONICAL_SHA_MISMATCH',
    'RUNTIME_IDENTITY_INVALID',
    'RUNTIME_OWNERSHIP_UNVERIFIED',
    'RUNTIME_START_IN_PROGRESS',
    'STALE_RUNTIME_STOP_FAILED',
    'CANONICAL_REEXEC_FAILED',
  ].includes(value);

const decodeMessage = (value: unknown): RuntimeWorkerMessage | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready') return { type: 'ready' };
  if (value.type !== 'startup-failure' || typeof value.message !== 'string') return undefined;
  return {
    type: 'startup-failure',
    message: value.message,
    ...(isLaunchFailureCode(value.code) ? { code: value.code } : {}),
    ...(typeof value.check === 'string' ? { check: value.check } : {}),
    ...(typeof value.command === 'string' ? { command: value.command } : {}),
  };
};

const restartDelay = (restartNumber: number): number =>
  Math.min(1_000 * 2 ** Math.min(Math.max(0, restartNumber - 1), 5), 30_000);

const waitForWorker = async (
  worker: RuntimeWorker,
  deps: RuntimeSupervisorDeps,
  signal: AbortSignal,
  browserAlreadyOpened: boolean,
): Promise<{
  readonly ready: boolean;
  readonly startupFailure?: RuntimeWorkerMessage & { readonly type: 'startup-failure' };
}> =>
  new Promise((resolve, reject) => {
    let ready = false;
    let readyMessageSeen = false;
    let startupFailure: (RuntimeWorkerMessage & { readonly type: 'startup-failure' }) | undefined;
    let lifecycleError: unknown;
    let lifecycle = Promise.resolve();
    let exitSeen = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let removeMessage = (): void => undefined;
    let removeExit = (): void => undefined;

    const cleanup = (): void => {
      removeMessage();
      removeExit();
      signal.removeEventListener('abort', onAbort);
      if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
    };

    const onAbort = (): void => {
      worker.send({ type: 'shutdown' });
      shutdownTimer = setTimeout(() => worker.kill(), deps.shutdownTimeoutMs ?? 10_000);
      shutdownTimer.unref?.();
    };

    const finishAfterExit = async (): Promise<void> => {
      if (exitSeen) return;
      exitSeen = true;
      try {
        await lifecycle;
        if (ready) await deps.markStarting();
        cleanup();
        if (lifecycleError !== undefined) reject(lifecycleError);
        else resolve({ ready, ...(startupFailure ? { startupFailure } : {}) });
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    removeMessage = worker.onMessage((rawMessage) => {
      const message = decodeMessage(rawMessage);
      if (message?.type === 'startup-failure') {
        startupFailure = message;
        return;
      }
      if (message?.type !== 'ready' || readyMessageSeen) return;
      readyMessageSeen = true;
      lifecycle = lifecycle.then(async () => {
        await deps.markReady();
        ready = true;
        if (!browserAlreadyOpened) deps.openBrowser();
      });
      void lifecycle.catch((error: unknown) => {
        lifecycleError = error;
        worker.kill();
      });
    });

    removeExit = worker.onExit(() => {
      void finishAfterExit();
    });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });

const throwStartupFailure = (
  failure: RuntimeWorkerMessage & { readonly type: 'startup-failure' },
): never => {
  throw new LaunchFailure(
    failure.code ?? 'BACKEND_START_FAILED',
    failure.message,
    failure.check ?? 'Inspect the runtime child log for its startup failure.',
    failure.command ?? 'npm run launch',
  );
};

/**
 * Keeps the canonical launcher process and its identity alive while replacing
 * a failed application child. Startup readiness is reported only after the
 * child has passed the normal database, application and HTTP readiness checks.
 */
export const superviseRuntime = async (
  deps: RuntimeSupervisorDeps,
  signal: AbortSignal,
): Promise<void> => {
  let restartNumber = 0;
  let browserOpened = false;

  while (!signal.aborted) {
    await deps.markStarting();
    const worker = deps.spawnWorker();
    const result = await waitForWorker(worker, deps, signal, browserOpened);
    if (result.ready) {
      browserOpened = true;
      restartNumber = 0;
    }
    if (signal.aborted) return;

    if (result.startupFailure?.code && TERMINAL_STARTUP_FAILURES.has(result.startupFailure.code)) {
      throwStartupFailure(result.startupFailure);
    }
    if (
      result.startupFailure?.code &&
      !RETRYABLE_STARTUP_FAILURES.has(result.startupFailure.code)
    ) {
      throwStartupFailure(result.startupFailure);
    }

    restartNumber += 1;
    const delayMs = restartDelay(restartNumber);
    const reason = result.startupFailure
      ? `${result.startupFailure.code ?? 'UNCLASSIFIED'}: ${result.startupFailure.message}`
      : 'application child exited unexpectedly';
    deps.log(`[launch] RECOVERY attempt=${restartNumber} delay=${delayMs}ms reason=${reason}`);
    await deps.delay(delayMs, signal);
  }
};
