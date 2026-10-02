import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  superviseRuntime,
  type RuntimeWorker,
  type RuntimeWorkerMessage,
} from '../../scripts/launch-supervisor.js';

type FakeWorker = RuntimeWorker & {
  sendMessage(message: RuntimeWorkerMessage): void;
  exit(code?: number): void;
};

const makeWorker = (): FakeWorker => {
  const events = new EventEmitter();
  let exited = false;
  return {
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    onExit: (listener) => {
      events.once('exit', listener);
      return () => events.off('exit', listener);
    },
    send: () => {
      if (!exited) {
        exited = true;
        events.emit('exit', 0, null);
      }
    },
    kill: () => {
      if (!exited) {
        exited = true;
        events.emit('exit', 1, null);
      }
    },
    sendMessage: (message) => events.emit('message', message),
    exit: (code = 1) => {
      if (exited) return;
      exited = true;
      events.emit('exit', code, null);
    },
  };
};

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('launch runtime supervisor', () => {
  it('retries a transient DB startup failure and opens the browser once after readiness', async () => {
    const controller = new AbortController();
    const workers: FakeWorker[] = [];
    const starting = vi.fn(async () => {});
    const ready = vi.fn(async () => {});
    const openBrowser = vi.fn();
    const delays: number[] = [];

    const running = superviseRuntime(
      {
        spawnWorker: () => {
          const worker = makeWorker();
          workers.push(worker);
          if (workers.length < 3) {
            queueMicrotask(() => {
              worker.sendMessage({
                type: 'startup-failure',
                code: 'DATABASE_UNAVAILABLE',
                message: 'PostgreSQL is not reachable.',
              });
              worker.exit(1);
            });
          } else if (workers.length === 3) {
            queueMicrotask(() => worker.sendMessage({ type: 'ready' }));
          } else {
            throw new Error('supervisor should not restart before the test aborts');
          }
          return worker;
        },
        markStarting: starting,
        markReady: ready,
        openBrowser,
        log: () => {},
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
      controller.signal,
    );

    for (let attempt = 0; attempt < 20 && ready.mock.calls.length === 0; attempt += 1) {
      await flush();
    }
    expect(ready).toHaveBeenCalledTimes(1);
    controller.abort();
    await running;

    expect(workers).toHaveLength(3);
    expect(delays).toEqual([1_000, 2_000]);
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(starting).toHaveBeenCalledTimes(4);
  });

  it('does not retry terminal configuration or schema failures', async () => {
    const worker = makeWorker();
    const spawnWorker = vi.fn(() => {
      queueMicrotask(() => {
        worker.sendMessage({
          type: 'startup-failure',
          code: 'DATABASE_SCHEMA_INVALID',
          message: 'Schema migration is missing.',
          check: 'Run migrations.',
          command: 'npm run db:migrate',
        });
        worker.exit(1);
      });
      return worker;
    });
    const delay = vi.fn(async () => {});

    await expect(
      superviseRuntime(
        {
          spawnWorker,
          markStarting: async () => {},
          markReady: async () => {},
          openBrowser: () => {},
          log: () => {},
          delay,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: 'LaunchFailure',
      code: 'DATABASE_SCHEMA_INVALID',
      check: 'Run migrations.',
      command: 'npm run db:migrate',
    });

    expect(spawnWorker).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('returns to starting after an app crash and does not reopen the browser on recovery', async () => {
    const controller = new AbortController();
    const workers: FakeWorker[] = [];
    const ready = vi.fn(async () => {});
    const openBrowser = vi.fn();
    const phases: string[] = [];

    const running = superviseRuntime(
      {
        spawnWorker: () => {
          const worker = makeWorker();
          workers.push(worker);
          if (workers.length < 3) queueMicrotask(() => worker.sendMessage({ type: 'ready' }));
          else throw new Error('unexpected extra runtime child');
          return worker;
        },
        markStarting: async () => {
          phases.push('starting');
        },
        markReady: async () => {
          phases.push('ready');
          ready();
        },
        openBrowser,
        log: () => {},
        delay: async () => {},
      },
      controller.signal,
    );

    for (let attempt = 0; attempt < 20 && ready.mock.calls.length === 0; attempt += 1) {
      await flush();
    }
    workers[0]?.exit(1);
    for (let attempt = 0; attempt < 20 && workers.length < 2; attempt += 1) {
      await flush();
    }
    for (let attempt = 0; attempt < 20 && ready.mock.calls.length < 2; attempt += 1) {
      await flush();
    }
    expect(ready).toHaveBeenCalledTimes(2);
    controller.abort();
    await running;

    expect(workers).toHaveLength(2);
    expect(phases).toEqual(['starting', 'ready', 'starting', 'starting', 'ready', 'starting']);
    expect(openBrowser).toHaveBeenCalledTimes(1);
  });
});
