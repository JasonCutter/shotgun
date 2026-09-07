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
import { InMemoryOrderingStore } from '../../packages/connector-runtime/src/stores.js';
import type {
  ConnectorRuntimeStatePort,
  ConnectorSemanticIdentity,
  DedupBeginResult,
  DedupRecord,
  DedupStorePort,
  JobRuntimePort,
} from '../../packages/connector-runtime/src/ports.js';
import type { DeadLetterEntry } from '../../packages/connector-runtime/src/stores.js';
import type {
  AttemptRecord,
  JobRecord,
  JobRunResult,
} from '../../packages/job-runtime/src/index.js';
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
    produces: { events: [], handoffs: [] },
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

const pingWithConsumer = (consumerId: string, required = false) => {
  const ping = createPingModule();
  return {
    ...ping,
    module: {
      ...ping.module,
      manifest: {
        ...ping.module.manifest,
        produces: {
          ...ping.module.manifest.produces,
          handoffs: [
            ...ping.module.manifest.produces.handoffs,
            {
              event: { name: 'PongEvent', range: '>=1.0.0 <2.0.0' },
              target: { kind: 'consumer' as const, moduleId: consumerId },
              tags: required ? (['REQUIRED_ACK'] as const) : (['INTENTIONAL_BEST_EFFORT'] as const),
              ...(required
                ? {}
                : {
                    dispositionEvidence: {
                      owner: consumerId,
                      retention: 'test retention',
                      observability: 'test observability',
                    },
                  }),
            },
          ],
        },
      },
    },
  };
};

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
  it('keeps a post-handler ordering ambiguity unknown and never re-enters the handler', async () => {
    class AmbiguousOrderingStore extends InMemoryOrderingStore {
      override async commit(): Promise<void> {
        throw new Error('ordering acknowledgement lost after handler success');
      }
    }

    let calls = 0;
    const consumer = eventConsumer('stage1.ordering-ambiguous', async () => {
      calls += 1;
    });
    const state = {
      dedup: new TestDedupStore(),
      jobs: new TestJobRuntime(),
      deadLetters: {
        add: async (
          input: Omit<DeadLetterEntry, 'deadLetterId' | 'createdAt' | 'status' | 'replays'>,
        ): Promise<DeadLetterEntry> => ({
          ...input,
          deadLetterId: 'test-dead-letter',
          createdAt: new Date().toISOString(),
          status: 'open',
          replays: [],
        }),
      },
      ordering: new AmbiguousOrderingStore(),
    } as unknown as ConnectorRuntimeStatePort;
    const kernel = new ShotgunKernel(new InProcessTransport(), {
      connectorRuntimeState: state,
    });
    kernel.register(
      pingWithConsumer('stage1.ordering-ambiguous').module,
      createPongModule().module,
      consumer,
    );
    await kernel.start();

    const event = pongEvent('ordering-ack-loss');
    const first = await kernel.connector.publishEvent(event);
    expect(
      first.consumers.some(
        (consumerResult) =>
          consumerResult.consumerId === 'stage1.ordering-ambiguous' &&
          consumerResult.status === 'dead-letter' &&
          consumerResult.errorCode === 'OUTCOME_UNKNOWN',
      ),
    ).toBe(true);
    expect(calls).toBe(1);

    const second = await kernel.connector.publishEvent(event);
    expect(
      second.consumers.some(
        (consumerResult) =>
          consumerResult.consumerId === 'stage1.ordering-ambiguous' &&
          consumerResult.status === 'dead-letter' &&
          consumerResult.errorCode === 'OUTCOME_UNKNOWN',
      ),
    ).toBe(true);
    expect(calls).toBe(1);
    await kernel.shutdown();
  });

  const durableKey = (identity: ConnectorSemanticIdentity): string =>
    [
      identity.projectId,
      identity.securityScope,
      identity.consumerId,
      identity.messageKind,
      identity.messageType,
      identity.semanticKey,
    ].join('\u0000');

  class TestDedupStore implements DedupStorePort {
    private readonly records = new Map<string, DedupRecord<unknown>>();

    async begin<TResult>(
      input: ConnectorSemanticIdentity & { readonly jobId: string },
    ): Promise<DedupBeginResult<TResult>> {
      const key = durableKey(input);
      const current = this.records.get(key);
      if (!current) {
        const record: DedupRecord<TResult> = {
          ...input,
          state: 'IN_PROGRESS',
          jobId: input.jobId,
          fenceToken: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.records.set(key, record);
        return { kind: 'ACQUIRED', record };
      }
      if (current.fingerprint !== input.fingerprint) {
        return { kind: 'CONFLICT', record: current as DedupRecord<TResult> };
      }
      return { kind: 'DUPLICATE', record: current as DedupRecord<TResult> };
    }

    async complete<TResult>(input: {
      readonly identity: ConnectorSemanticIdentity;
      readonly fenceToken: number;
      readonly jobId: string;
      readonly result: TResult;
    }): Promise<void> {
      const record = this.records.get(durableKey(input.identity));
      if (!record || record.fenceToken !== input.fenceToken || record.jobId !== input.jobId) {
        throw new Error('test dedup completion was not fenced');
      }
      this.records.set(durableKey(input.identity), {
        ...record,
        state: 'COMPLETED',
        result: input.result,
        updatedAt: new Date().toISOString(),
      });
    }

    async fail(input: {
      readonly identity: ConnectorSemanticIdentity;
      readonly fenceToken: number;
      readonly jobId: string;
      readonly safeErrorCode: string;
      readonly safeErrorMessage: string;
    }): Promise<void> {
      const record = this.records.get(durableKey(input.identity));
      if (!record || record.fenceToken !== input.fenceToken || record.jobId !== input.jobId) return;
      this.records.set(durableKey(input.identity), {
        ...record,
        state: 'FAILED',
        safeErrorCode: input.safeErrorCode,
        safeErrorMessage: input.safeErrorMessage,
        updatedAt: new Date().toISOString(),
      });
    }

    async markOutcomeUnknown(input: {
      readonly identity: ConnectorSemanticIdentity;
      readonly fenceToken: number;
      readonly jobId: string;
      readonly safeErrorMessage: string;
    }): Promise<void> {
      const record = this.records.get(durableKey(input.identity));
      if (!record || record.fenceToken !== input.fenceToken || record.jobId !== input.jobId) return;
      this.records.set(durableKey(input.identity), {
        ...record,
        state: 'OUTCOME_UNKNOWN',
        safeErrorCode: 'OUTCOME_UNKNOWN',
        safeErrorMessage: input.safeErrorMessage,
        updatedAt: new Date().toISOString(),
      });
    }

    async reconcile<TResult>(): Promise<DedupRecord<TResult> | undefined> {
      return undefined;
    }

    async get<TResult>(
      identity: ConnectorSemanticIdentity,
    ): Promise<DedupRecord<TResult> | undefined> {
      return this.records.get(durableKey(identity)) as DedupRecord<TResult> | undefined;
    }
  }

  class TestJobRuntime implements JobRuntimePort {
    private readonly jobs = new Map<string, JobRecord>();

    async enqueue(): Promise<JobRecord> {
      throw new Error('not used by this test');
    }

    async claim(): Promise<
      { readonly fencingToken: number; readonly leaseExpiresAt: string } | undefined
    > {
      return undefined;
    }

    async renew(): Promise<boolean> {
      return false;
    }

    async complete(): Promise<boolean> {
      return false;
    }

    async retry(): Promise<boolean> {
      return false;
    }

    async terminal(): Promise<boolean> {
      return false;
    }

    async cancel(): Promise<boolean> {
      return false;
    }

    async run<TResult>(
      identity: ConnectorSemanticIdentity,
      _correlationId: string,
      operation: (attempt: AttemptRecord) => Promise<TResult>,
    ): Promise<JobRunResult<TResult>> {
      const job: JobRecord = {
        jobId: identity.semanticKey,
        idempotencyKey: identity.semanticKey,
        consumerId: identity.consumerId,
        createdAt: new Date().toISOString(),
        status: 'running',
        attempts: [],
      };
      this.jobs.set(durableKey(identity), job);
      const attempt: AttemptRecord = {
        attemptId: `${identity.semanticKey}:attempt`,
        jobId: job.jobId,
        attemptNumber: 1,
        startedAt: new Date().toISOString(),
        status: 'running',
        scheduledDelayMs: 0,
      };
      job.attempts.push(attempt);
      try {
        const result = await operation(attempt);
        attempt.status = 'succeeded';
        attempt.finishedAt = new Date().toISOString();
        job.status = 'succeeded';
        return { result, job };
      } catch (error) {
        attempt.status = 'failed';
        attempt.finishedAt = new Date().toISOString();
        job.status =
          error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN'
            ? 'outcome-unknown'
            : 'failed';
        throw error;
      }
    }

    async list(): Promise<readonly JobRecord[]> {
      return [...this.jobs.values()];
    }

    async find(identity: ConnectorSemanticIdentity): Promise<JobRecord | undefined> {
      return this.jobs.get(durableKey(identity));
    }
  }

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
    const ping = pingWithConsumer('stage1.flaky');
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
    const ping = pingWithConsumer('stage1.recovering');
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
      pingWithConsumer('stage1.optional-failure').module,
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
      pingWithConsumer('stage1.required-failure', true).module,
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
        produces: { events: [], handoffs: [] },
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

    // The late handler promise must not clear the semantic tombstone and
    // make a second side effect eligible after the timeout.
    await delay(40);
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
