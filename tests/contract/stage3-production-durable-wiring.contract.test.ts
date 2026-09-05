import { describe, expect, it } from 'vitest';

import { createProductionStage3Pipeline } from '../../adapters/sources-stage3-pipeline/src/index.js';

describe('Stage 3 production durability contract', () => {
  it('requires the durable progress and atomic persistence ports at the type boundary', () => {
    const shared = {
      storage: {
        put: async () => 'asset-key',
        read: async () => new Uint8Array(),
      },
      transformer: {
        identity: { id: 'contract-test', version: '1' },
        transform: async () => {
          throw new Error('not used');
        },
      },
      locator: { locate: () => undefined },
      transformationRepository: {
        save: async () => {
          throw new Error('not used');
        },
        findTransformationRevisionSecurity: async () => undefined,
        findBySourceVersion: async () => undefined,
      },
      evidenceRepository: {
        index: async () => ({ items: [], reusedCount: 0 }),
        listBySourceVersion: async () => [],
        findById: async () => undefined,
      },
    };

    // @ts-expect-error Production Stage 3 cannot be constructed without durable progress.
    createProductionStage3Pipeline(shared);

    const pipeline = createProductionStage3Pipeline({
      ...shared,
      progress: {
        ensureMaterialized: async () => undefined,
        claim: async () => ({ status: 'DEFERRED', reason: 'RETRY_NOT_DUE' as const }),
        recordPreClaimFailure: async () => undefined,
        finalize: async () => undefined,
        markRetryable: async () => undefined,
        markFailure: async () => undefined,
        findRecoverable: async () => [],
      },
      atomicPersistence: {
        persist: async () => {
          throw new Error('not used');
        },
      },
    });

    expect(pipeline).toBeDefined();
  });
});
