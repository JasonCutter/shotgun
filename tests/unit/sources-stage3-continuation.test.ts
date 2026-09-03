import { describe, expect, it } from 'vitest';

import {
  SourcesStage3Pipeline,
  SourcesStage4ContinuationDispatcher,
} from '../../adapters/sources-stage3-pipeline/src/index.js';
import type {
  SourcesStage3EvidenceIndexedInput,
  SourcesStage4ContinuationPort,
  SourcesStage4ContinuationStorePort,
} from '../../modules/frontend-sources-write/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';

const continuation: SourcesStage3EvidenceIndexedInput = {
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'version-1',
  revisionId: 'revision-1',
  evidenceCount: 1,
  reusedCount: 0,
  accessScope: ['owner'],
  sensitivity: 'public',
  dataClassification: 'source-content',
};

class MemoryContinuationStore implements SourcesStage4ContinuationStorePort {
  state: 'PENDING' | 'RETRYABLE_FAILED' | 'COMPLETED' = 'PENDING';
  attempts = 0;
  failures: Array<{ retryable: boolean; code: string }> = [];

  async claimNext() {
    if (this.state === 'COMPLETED') return { status: 'EMPTY' as const };
    this.state = 'PENDING';
    this.attempts += 1;
    return {
      status: 'CLAIMED' as const,
      continuation,
      continuationId: 'continuation-1',
      leaseToken: `lease-${this.attempts}`,
      fencingToken: this.attempts,
    };
  }

  async complete() {
    this.state = 'COMPLETED';
  }

  async fail(input: Parameters<SourcesStage4ContinuationStorePort['fail']>[0]) {
    this.failures.push({ retryable: input.retryable, code: input.code });
    this.state = input.retryable ? 'RETRYABLE_FAILED' : 'COMPLETED';
  }

  async recoverExpired() {
    return 0;
  }
}

describe('durable Sources Stage 4 continuation dispatcher', () => {
  it('rejects malformed Stage 3 input before invoking storage or transformation', async () => {
    let reads = 0;
    const pipeline = new SourcesStage3Pipeline({
      storage: {
        put: async () => 'unused',
        read: async () => {
          reads += 1;
          return new Uint8Array();
        },
      },
      transformer: {
        identity: { id: 'test', version: '1' },
        transform: async () => {
          throw new Error('must not be called');
        },
      },
      locator: { locate: () => undefined },
      transformationRepository: {
        save: async () => {
          throw new Error('must not be called');
        },
        findTransformationRevisionSecurity: async () => undefined,
        findBySourceVersion: async () => undefined,
      },
      evidenceRepository: {
        index: async () => {
          throw new Error('must not be called');
        },
        listBySourceVersion: async () => [],
        findById: async () => undefined,
      },
    });

    await expect(
      pipeline.runForSourceVersion({
        projectId: 'project-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        storageKey: 'asset/1',
        mediaType: 'text/plain',
        contentHash: 'not-a-sha256',
        accessScope: ['owner'],
        sensitivity: 'public',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(reads).toBe(0);
  });

  it('retries a retryable failure and completes the same continuation', async () => {
    const store = new MemoryContinuationStore();
    let publishes = 0;
    const publisher: SourcesStage4ContinuationPort = {
      onEvidenceIndexed: async () => {
        publishes += 1;
        if (publishes === 1) throw new Error('provider unavailable');
      },
    };
    const dispatcher = new SourcesStage4ContinuationDispatcher(store, publisher);

    await expect(dispatcher.dispatchOnce()).resolves.toBe('FAILED');
    expect(store.failures).toEqual([{ retryable: true, code: 'STAGE4_RETRYABLE_FAILURE' }]);
    await expect(dispatcher.dispatchOnce()).resolves.toBe('SUCCEEDED');
    expect(store.state).toBe('COMPLETED');
    expect(store.attempts).toBe(2);
  });

  it('does not retry policy or validation failures', async () => {
    const store = new MemoryContinuationStore();
    const publisher: SourcesStage4ContinuationPort = {
      onEvidenceIndexed: async () => {
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: 'policy denied',
          module: 'test',
          operation: 'publish',
        });
      },
    };
    const dispatcher = new SourcesStage4ContinuationDispatcher(store, publisher);

    await expect(dispatcher.dispatchOnce()).resolves.toBe('FAILED');
    expect(store.failures).toEqual([{ retryable: false, code: 'POLICY_DENIED' }]);
  });
});
