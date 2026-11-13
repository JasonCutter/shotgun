import { mkdir, open, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type {
  SurferExperimentClaim,
  SurferExperimentReceipt,
  SurferExperimentReservation,
  SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import { InMemorySurferExperimentStore } from '../../surfer-experiment-in-memory/src/index.js';

type Entry =
  | { action: 'claim'; reservation: SurferExperimentReservation }
  | {
      action: 'complete';
      reservation: SurferExperimentReservation;
      receipt: SurferExperimentReceipt;
    }
  | {
      action: 'fail';
      reservation: SurferExperimentReservation;
      status: 'FAILED' | 'OUTCOME_UNKNOWN';
    };

/** Local isolated experiments only. Interrupted locks require operator inspection, never automatic stealing.
 * fsync covers journal data; OS/power-loss recovery and network filesystems are not certified here. */
export class LocalSurferExperimentStore implements SurferExperimentStorePort {
  private readonly root: string;
  constructor(directory: string) {
    this.root = path.resolve(directory);
  }

  private async transaction<T>(
    operation: (store: InMemorySurferExperimentStore) => Promise<{ result: T; entry?: Entry }>,
  ): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const lock = path.join(this.root, 'writer.lock');
    try {
      await mkdir(lock);
    } catch (cause) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'Local experiment store is locked; an interrupted writer requires inspection.',
        module: 'surfer',
        operation: 'lock-local-experiment',
        cause,
      });
    }
    try {
      const journal = path.join(this.root, 'experiments.jsonl');
      let content = '';
      try {
        content = await readFile(journal, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (content && !content.endsWith('\n'))
        throw surferFailure('Experiment journal has an incomplete write; recovery is required.');
      const store = new InMemorySurferExperimentStore();
      for (const line of content.split('\n').filter(Boolean)) {
        const entry: Entry = JSON.parse(line) as Entry;
        assertSurferJson(entry);
        if (entry.action === 'claim') {
          if ((await store.claim(entry.reservation)).state !== 'CLAIMED')
            throw surferFailure('Duplicate claim in experiment journal.');
        } else if (entry.action === 'complete')
          await store.complete(entry.reservation, entry.receipt);
        else if (entry.action === 'fail' && ['FAILED', 'OUTCOME_UNKNOWN'].includes(entry.status))
          await store.fail(entry.reservation, entry.status);
        else throw surferFailure('Unknown experiment journal operation.');
      }
      const { result, entry } = await operation(store);
      if (entry) {
        assertSurferJson(entry);
        const file = await open(journal, 'a', 0o600);
        try {
          await file.writeFile(`${JSON.stringify(entry)}\n`, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
      }
      return result;
    } finally {
      await rmdir(lock);
    }
  }

  async claim(input: SurferExperimentReservation): Promise<SurferExperimentClaim> {
    const reservation = structuredClone(input);
    return this.transaction(async (store) => {
      const result = await store.claim(reservation);
      return {
        result,
        ...(result.state === 'CLAIMED' ? { entry: { action: 'claim' as const, reservation } } : {}),
      };
    });
  }
  async readCompleted(experimentId: string): Promise<SurferExperimentReceipt | null> {
    return this.transaction(async (store) => ({ result: await store.readCompleted(experimentId) }));
  }
  async complete(
    input: SurferExperimentReservation,
    receipt: SurferExperimentReceipt,
  ): Promise<void> {
    const entry = structuredClone({ action: 'complete' as const, reservation: input, receipt });
    await this.transaction(async (store) => {
      await store.complete(entry.reservation, entry.receipt);
      return { result: undefined, entry };
    });
  }
  async fail(
    input: SurferExperimentReservation,
    status: 'FAILED' | 'OUTCOME_UNKNOWN',
  ): Promise<void> {
    const entry = structuredClone({ action: 'fail' as const, reservation: input, status });
    await this.transaction(async (store) => {
      await store.fail(entry.reservation, entry.status);
      return { result: undefined, entry };
    });
  }
}
