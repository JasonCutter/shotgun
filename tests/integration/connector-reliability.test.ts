import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import pongEventSchema from '../../packages/contracts/schemas/pong-event.v1.schema.json';
import {
  createChildEvent,
  createCommand,
  ShotgunError,
  ShotgunKernel,
} from '../../packages/kernel/src/index.js';
import type { EventHandlerDefinition, ShotgunModule } from '../../packages/module-sdk/src/index.js';
import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';
import { createStage1Harness, securePingCommand } from '../helpers/stage-1.js';

const eventConsumer = (
  id: string,
  handle: EventHandlerDefinition['handle'],
  requiredForPublisherAcknowledgement = false,
): ShotgunModule => ({
  manifest: {
    id,
    version: '1.0.0',
    owner: 'Reliability test',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [{ name: 'PongEvent', range: '>=1.0.0 <2.0.0' }],
    },
    deployment: { modes: ['in_process'] },
    dataOwnership: {
      owns: [`${id}-state`],
      readsViaPorts: [],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'PongEvent', range: '>=1.0.0 <2.0.0' }],
    },
    produces: { events: [] },
    provides: { queries: [], capabilities: [] },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: {
      canWriteCanonical: false,
      canExecuteExternalAction: false,
    },
  },
  contracts: [
    {
      name: 'PongEvent',
      version: '1.0.0',
      kind: 'event',
      inputSchema: pongEventSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'PongEvent',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        ...(requiredForPublisherAcknowledgement
          ? { requiredForPublisherAcknowledgement: true }
          : {}),
        handle,
      },
    ],
    queries: [],
  },
});

const pongEvent = (requestId: string, sequence = 1) =>
  createChildEvent(securePingCommand(`parent:${requestId}`), {
    messageType: 'PongEvent',
    schemaVersion: '1.0.0',
    producerModule: 'reliability-test',
    producerVersion: '1.0.0',
    idempotencyKey: `pong:${requestId}`,
    orderingKey: requestId,
    sequence,
    payload: {
      requestId,
      reply: 'pong:reliability',
    },
  });

describe('Connector reliability', () => {
  it('detects a missing partial-order sequence and quarantines the event', async () => {
    const { kernel, pong } = await createStage1Harness(new InProcessTransport());

    const delivery = await kernel.connector.publishEvent(pongEvent('ordering', 2));

    expect(delivery.consumers[0]?.status).toBe('dead-letter');
    expect(kernel.connector.deadLetters.list()[0]?.error.code).toBe('STALE_VERSION');
    expect(pong.eventSideEffects).toBe(0);
  });

  it('creates a new Attempt for retryable failures and eventually succeeds', async () => {
    let calls = 0;
    const flaky = eventConsumer('stage1.flaky', () => {
      calls += 1;
      if (calls < 3) {
        throw new ShotgunError({
          code: 'RETRYABLE_DEPENDENCY',
          safeMessage: 'Temporary dependency failure.',
          module: 'stage1.flaky',
          operation: 'PongEvent',
          retryable: true,
        });
      }
    });
    const ping = createPingModule();
    const pong = createPongModule();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(ping.module, pong.module, flaky);
    await kernel.start();

    const delivery = await kernel.connector.publishEvent(pongEvent('retry'));
    const job = kernel.connector.jobs
      .list()
      .find((candidate) => candidate.consumerId.startsWith('stage1.flaky'));

    expect(delivery.consumers).toContainEqual({
      consumerId: 'stage1.flaky',
      status: 'processed',
    });
    expect(calls).toBe(3);
    expect(job?.attempts.map((attempt) => attempt.status)).toEqual([
      'failed',
      'failed',
      'succeeded',
    ]);
  });

  it('preserves partial success and safely replays a dead-lettered consumer', async () => {
    let available = false;
    let sideEffects = 0;
    const recovering = eventConsumer('stage1.recovering', () => {
      if (!available) {
        throw new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'Consumer is unavailable.',
          module: 'stage1.recovering',
          operation: 'PongEvent',
        });
      }
      sideEffects += 1;
    });
    const ping = createPingModule();
    const pong = createPongModule();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(ping.module, pong.module, recovering);
    await kernel.start();

    const delivery = await kernel.connector.publishEvent(pongEvent('replay'));
    const deadLetterId = delivery.consumers.find(
      (consumer) => consumer.consumerId === 'stage1.recovering',
    )?.deadLetterId;

    expect(delivery.consumers).toContainEqual({
      consumerId: 'stage1.pong',
      status: 'processed',
    });
    expect(deadLetterId).toBeDefined();
    expect(pong.state.eventSideEffects).toBe(1);
    expect(sideEffects).toBe(0);

    available = true;
    await kernel.connector.replay(deadLetterId!, 'Dependency restored');

    const entry = kernel.connector.deadLetters.get(deadLetterId!);
    expect(sideEffects).toBe(1);
    expect(entry.status).toBe('resolved');
    expect(entry.replays).toHaveLength(1);
    expect(entry.replays[0]?.status).toBe('succeeded');
  });

  it('propagates only opt-in required event failures to the parent publication', async () => {
    const optionalKernel = new ShotgunKernel(new InProcessTransport());
    optionalKernel.register(
      createPingModule().module,
      createPongModule().module,
      eventConsumer('stage1.optional-failure', () => {
        throw new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'Optional consumer failed.',
          module: 'stage1.optional-failure',
          operation: 'PongEvent',
        });
      }),
    );
    await optionalKernel.start();

    await expect(
      optionalKernel.connector.sendCommand(securePingCommand('optional-parent')),
    ).resolves.toBeDefined();
    expect(
      optionalKernel.connector.deadLetters
        .list()
        .some((entry) => entry.consumerId === 'stage1.optional-failure'),
    ).toBe(true);

    const requiredKernel = new ShotgunKernel(new InProcessTransport());
    requiredKernel.register(
      createPingModule().module,
      createPongModule().module,
      eventConsumer(
        'stage1.required-failure',
        () => {
          throw new ShotgunError({
            code: 'TERMINAL_FAILURE',
            safeMessage: 'Required consumer failed.',
            module: 'stage1.required-failure',
            operation: 'PongEvent',
          });
        },
        true,
      ),
    );
    await requiredKernel.start();

    await expect(
      requiredKernel.connector.sendCommand(securePingCommand('required-parent')),
    ).rejects.toMatchObject({ code: 'TERMINAL_FAILURE' });
    expect(
      requiredKernel.connector.deadLetters
        .list()
        .some((entry) => entry.consumerId === 'stage1.required-failure'),
    ).toBe(true);
  });

  it('does not retry a timed-out command with an unknown outcome', async () => {
    let calls = 0;
    const slowModule: ShotgunModule = {
      manifest: {
        id: 'stage1.slow',
        version: '1.0.0',
        owner: 'Reliability test',
        compatibility: {
          runtime: '>=1.0.0 <2.0.0',
          contracts: [{ name: 'SlowCommand', range: '>=1.0.0 <2.0.0' }],
        },
        deployment: { modes: ['in_process'] },
        dataOwnership: {
          owns: ['slow-state'],
          readsViaPorts: [],
          directSchemaAccess: false,
        },
        consumes: {
          commands: [{ name: 'SlowCommand', range: '>=1.0.0 <2.0.0' }],
          events: [],
        },
        produces: { events: [] },
        provides: { queries: [], capabilities: [] },
        requires: { capabilities: [] },
        security: {
          requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
          defaultOnMissingContext: 'deny',
        },
        approvalPolicy: {
          canWriteCanonical: false,
          canExecuteExternalAction: false,
        },
      },
      contracts: [
        {
          name: 'SlowCommand',
          version: '1.0.0',
          kind: 'command',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
          },
        },
      ],
      handlers: {
        commands: [
          {
            messageType: 'SlowCommand',
            version: '1.0.0',
            timeoutMs: 5,
            async handle() {
              calls += 1;
              await delay(30);
            },
          },
        ],
        events: [],
        queries: [],
      },
    };
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(slowModule);
    await kernel.start();
    const command = createCommand({
      messageType: 'SlowCommand',
      schemaVersion: '1.0.0',
      producerModule: 'reliability-test',
      producerVersion: '1.0.0',
      idempotencyKey: 'slow:1',
      projectId: 'shotgun',
      actor: { type: 'user', id: 'owner' },
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'personal',
      },
      payload: {},
    });

    await expect(kernel.connector.sendCommand(command)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });

    const job = kernel.connector.jobs.list()[0];
    expect(calls).toBe(1);
    expect(job?.attempts).toHaveLength(1);
    expect(job?.status).toBe('outcome-unknown');
  });

  it('rejects invalid payloads before a module side effect', async () => {
    const { kernel, ping } = await createStage1Harness(new InProcessTransport());
    const command = securePingCommand('invalid');
    const invalid = {
      ...command,
      payload: {
        requestId: 'invalid',
      },
    };

    await expect(kernel.connector.sendCommand(invalid)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(ping.commandSideEffects).toBe(0);
  });
});
