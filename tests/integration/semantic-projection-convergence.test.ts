import { describe, expect, it, vi } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  createChildEvent,
  createCommand,
  SemanticEmbeddingError,
} from '../../packages/contracts/src/index.js';

describe('C7 CanonicalCommitted semantic convergence handoff', () => {
  it('dead-letters semantic provider failure without making the consumer required', async () => {
    const converge = vi.fn().mockRejectedValue(
      new SemanticEmbeddingError({
        code: 'PROVIDER_FAILURE',
        safeMessage: 'Embedding provider is unavailable.',
        operation: 'c7-test-provider',
        retryable: true,
      }),
    );
    const app = await createApplication({
      semanticProjectionConvergence: { converge },
      canonicalProjectionRecoveryIntervalMs: false,
    });
    converge.mockClear();

    try {
      const parent = createCommand({
        messageType: 'C7TestCommand',
        schemaVersion: '1.0.0',
        producerModule: 'c7-test',
        producerVersion: '1.0.0',
        idempotencyKey: 'c7-test-parent',
        projectId: 'project-c7-event',
        actor: { type: 'service', id: 'c7-test' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'restricted',
          dataClassification: 'c7-test',
        },
        payload: {},
      });
      const event = createChildEvent(parent, {
        messageType: 'CanonicalCommitted',
        schemaVersion: '1.0.0',
        producerModule: 'stage6.canonical-knowledge',
        producerVersion: '1.0.0',
        idempotencyKey: 'c7-test-canonical-event',
        payload: {
          commitId: 'commit-c7',
          manifestId: null,
          changeSetId: null,
          operation: 'NO_OP',
          status: 'NO_OP',
          canonicalVersion: 1,
          snapshotDigest: `sha256:${'c'.repeat(64)}`,
          actorId: 'c7-test',
          accessScope: ['owner'],
          sensitivity: 'restricted',
        },
      });

      const delivery = await app.kernel.connector.publishEvent(event);
      const semantic = delivery.consumers.find(
        (consumer) => consumer.consumerId === 'stage7.semantic-projection-convergence',
      );
      expect(converge).toHaveBeenCalled();
      expect(semantic).toMatchObject({
        consumerId: 'stage7.semantic-projection-convergence',
        status: 'dead-letter',
      });
      expect(semantic?.requiredForPublisherAcknowledgement).toBeUndefined();
    } finally {
      await app.server.close();
    }
  });
});
