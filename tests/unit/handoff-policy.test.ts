import { describe, expect, it } from 'vitest';

import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { HandoffPolicy, ShotgunModule } from '../../packages/module-sdk/src/index.js';
import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';

const pingWithHandoffs = (handoffs: readonly HandoffPolicy[]) => {
  const ping = createPingModule();
  return {
    ...ping,
    module: {
      ...ping.module,
      manifest: {
        ...ping.module.manifest,
        produces: { ...ping.module.manifest.produces, handoffs },
      },
    },
  };
};

const pongWithRequiredHandler = (): ShotgunModule => {
  const pong = createPongModule();
  return {
    ...pong.module,
    handlers: {
      ...pong.module.handlers,
      events: pong.module.handlers.events.map((handler) => ({
        ...handler,
        requiredForPublisherAcknowledgement: true,
      })),
    },
  };
};

const edge = (
  target: string,
  tags: HandoffPolicy['tags'] = ['INTENTIONAL_BEST_EFFORT'],
): HandoffPolicy => ({
  event: { name: 'PongEvent', range: '>=1.0.0 <2.0.0' },
  target: { kind: 'consumer', moduleId: target },
  tags,
  ...(tags.includes('DURABLE_JOB') ? { authority: 'test.job-authority' } : {}),
  ...(tags.includes('INTENTIONAL_BEST_EFFORT')
    ? {
        dispositionEvidence: {
          owner: target,
          retention: 'test retention',
          observability: 'test observability',
        },
      }
    : {}),
});

describe('Module handoff policy', () => {
  it('requires every produced event to have an edge or intentional disposition', async () => {
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(pingWithHandoffs([]).module, createPongModule().module);

    await expect(kernel.start()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('rejects unknown tags and incompatible event ranges', async () => {
    const unknownTag = pingWithHandoffs([
      edge('stage1.pong', ['NOT_A_HANDOFF_TAG'] as unknown as HandoffPolicy['tags']),
    ]).module;
    const unknownKernel = new ShotgunKernel(new InProcessTransport());
    unknownKernel.register(unknownTag, createPongModule().module);
    await expect(unknownKernel.start()).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    const incompatible = pingWithHandoffs([
      {
        ...edge('stage1.pong'),
        event: { name: 'PongEvent', range: '>=2.0.0 <3.0.0' },
      },
    ]).module;
    const incompatibleKernel = new ShotgunKernel(new InProcessTransport());
    incompatibleKernel.register(incompatible, createPongModule().module);
    await expect(incompatibleKernel.start()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('resolves each declared consumer edge to a registered handler', async () => {
    const pong = createPongModule();
    const noHandlerPong: ShotgunModule = {
      ...pong.module,
      handlers: { ...pong.module.handlers, events: [] },
    };
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(pingWithHandoffs([edge('stage1.pong')]).module, noHandlerPong);

    await expect(kernel.start()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enforces REQUIRED_ACK and required-handler flags in both directions', async () => {
    const requiredPing = pingWithHandoffs([edge('stage1.pong', ['REQUIRED_ACK'])]).module;
    const missingFlagKernel = new ShotgunKernel(new InProcessTransport());
    missingFlagKernel.register(requiredPing, createPongModule().module);
    await expect(missingFlagKernel.start()).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    const requiredPong = pongWithRequiredHandler();
    const missingEdgePing = pingWithHandoffs([]).module;
    const missingEdgeKernel = new ShotgunKernel(new InProcessTransport());
    missingEdgeKernel.register(missingEdgePing, requiredPong);
    await expect(missingEdgeKernel.start()).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    const matchingKernel = new ShotgunKernel(new InProcessTransport());
    matchingKernel.register(requiredPing, requiredPong);
    await expect(matchingKernel.start()).resolves.toBeUndefined();
  });

  it('allows a consumer-only partial assembly when its producer is not composed', async () => {
    const kernel = new ShotgunKernel(new InProcessTransport());
    const pong = pongWithRequiredHandler();
    kernel.register({
      ...pong,
      manifest: { ...pong.manifest, requires: { capabilities: [] } },
    });

    await expect(kernel.start()).resolves.toBeUndefined();
  });

  it('requires replay metadata and explicit authority for durability claims', async () => {
    const reconstructable = pingWithHandoffs([
      {
        ...edge('stage1.pong', ['RECONSTRUCTABLE']),
        replayEvidence: {
          replaySource: '',
          deterministicIdentity: 'requestId',
          idempotencyEvidence: 'pong:requestId',
        },
      },
    ]).module;
    const reconstructableKernel = new ShotgunKernel(new InProcessTransport());
    reconstructableKernel.register(reconstructable, createPongModule().module);
    await expect(reconstructableKernel.start()).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    const durable = pingWithHandoffs([edge('stage1.pong', ['DURABLE_JOB'])]).module;
    const durableKernel = new ShotgunKernel(new InProcessTransport());
    durableKernel.register(durable, createPongModule().module);
    await expect(durableKernel.start()).resolves.toBeUndefined();
  });
});
