import { Worker } from 'node:worker_threads';
import type {
  SurferLocalWorkerPort,
  SurferWorkerResult,
} from '../../../packages/contracts/src/surfer-execution.js';
import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';

/** Composition selects the static trusted worker URL; input cannot select code.
 * Workers receive no inherited environment. This is not a network/FS sandbox. */
export class SurferWorkerThreads implements SurferLocalWorkerPort {
  private readonly workerUrl: URL;
  constructor(workerUrl: URL) {
    this.workerUrl = new URL(workerUrl.href);
    if (workerUrl.protocol !== 'file:')
      throw surferFailure('Only a static trusted file worker is accepted.');
  }
  async run(
    input: unknown,
    checkpoint: unknown,
    signal: AbortSignal,
    profile: { unitMaxMs: number; workerMemoryMb: number },
    onCheckpoint?: (checkpoint: unknown, sequence: number) => Promise<void>,
  ): Promise<SurferWorkerResult> {
    if (
      !Number.isInteger(profile.workerMemoryMb) ||
      profile.workerMemoryMb < 8 ||
      profile.workerMemoryMb > 4096 ||
      !Number.isInteger(profile.unitMaxMs) ||
      profile.unitMaxMs < 1 ||
      profile.unitMaxMs > 60000
    )
      throw surferFailure('Invalid trusted worker profile.');
    assertSurferJson({ input, checkpoint });
    if (signal.aborted) return { outcome: 'YIELDED', checkpoint, resultRef: null };
    const worker = new Worker(this.workerUrl, {
      workerData: { input, checkpoint },
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: profile.workerMemoryMb, stackSizeMb: 4 },
    });
    return new Promise((resolve, reject) => {
      let finished = false,
        latest = checkpoint,
        count = 0,
        checkpointSequence = 0;
      let checkpointWrites = Promise.resolve();
      const finish = (outcome: SurferWorkerResult['outcome'], resultRef: string | null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        // No checkpoint/settlement until the old worker can no longer execute.
        void worker
          .terminate()
          .then(async () => {
            await checkpointWrites;
            resolve({ outcome, checkpoint: latest, resultRef });
          })
          .catch(reject); // ambiguous checkpoint writes keep the ledger reservation held
      };
      const abort = () => finish('YIELDED', null);
      const timer = setTimeout(() => finish('FAILED', null), profile.unitMaxMs);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      worker.on('message', (message: unknown) => {
        if (finished) return;
        try {
          assertSurferJson(message);
          if (
            ++count > 1024 ||
            Buffer.byteLength(JSON.stringify(message)) > 65536 ||
            !message ||
            typeof message !== 'object'
          )
            throw surferFailure('Worker message budget exceeded.');
          const m = message as Record<string, unknown>;
          if (m.type === 'checkpoint' && Object.keys(m).sort().join(',') === 'checkpoint,type') {
            latest = structuredClone(m.checkpoint);
            const saved = latest,
              sequence = ++checkpointSequence;
            checkpointWrites = checkpointWrites.then(() => onCheckpoint?.(saved, sequence));
            void checkpointWrites.catch(() => finish('FAILED', null));
          } else if (
            m.type === 'complete' &&
            Object.keys(m).sort().join(',') === 'checkpoint,resultRef,type' &&
            typeof m.resultRef === 'string' &&
            m.resultRef.length <= 256
          ) {
            latest = structuredClone(m.checkpoint);
            finish('SUCCEEDED', m.resultRef);
          } else throw surferFailure('Invalid worker protocol.');
        } catch {
          finish('FAILED', null);
        }
      });
      worker.once('error', () => finish('FAILED', null));
      worker.once('exit', () => {
        if (!finished) finish('FAILED', null);
      });
    });
  }
}
