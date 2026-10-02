import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  runtimeWorkerFromChildProcess,
  superviseRuntime,
} from '../../scripts/launch-supervisor.js';

const workerScript = fileURLToPath(
  new URL('../fixtures/launch-supervisor-worker.mjs', import.meta.url),
);

describe('launch supervisor child process IPC', () => {
  it('restarts a real Node child after startup failure and shuts the recovered child down', async () => {
    const controller = new AbortController();
    const children: ReturnType<typeof fork>[] = [];
    const marks: string[] = [];
    const delays: number[] = [];
    const openBrowser = vi.fn();
    let attempt = 0;

    const running = superviseRuntime(
      {
        spawnWorker: () => {
          attempt += 1;
          const child = fork(workerScript, [], {
            cwd: path.dirname(workerScript),
            env: {
              ...process.env,
              SHOTGUN_TEST_WORKER_FAIL: attempt === 1 ? '1' : '0',
            },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          });
          children.push(child);
          return runtimeWorkerFromChildProcess(child);
        },
        markStarting: async () => {
          marks.push('starting');
        },
        markReady: async () => {
          marks.push('ready');
          if (marks.filter((phase) => phase === 'ready').length === 1) controller.abort();
        },
        openBrowser,
        log: () => {},
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
      controller.signal,
    );

    await running;

    expect(attempt).toBe(2);
    expect(delays).toEqual([1_000]);
    expect(marks).toEqual(['starting', 'starting', 'ready', 'starting']);
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(children.every((child) => child.exitCode !== null)).toBe(true);
  }, 10_000);
});
