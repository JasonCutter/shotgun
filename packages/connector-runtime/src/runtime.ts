import { randomUUID } from 'node:crypto';

import {
  type AnyEnvelope,
  type CommandEnvelope,
  createChildEvent,
  createChildQuery,
  createQueryResult,
  type EventEnvelope,
  type QueryEnvelope,
  ShotgunError,
  toShotgunError,
  validateEnvelope,
} from '../../contracts/src/index.js';
import { InMemoryJobRuntime, type AttemptRecord } from '../../job-runtime/src/index.js';
import type {
  DispatchQueryInput,
  HandlerContext,
  RegisteredCommandHandler,
  RegisteredEventHandler,
  RegisteredQueryHandler,
} from '../../module-sdk/src/index.js';
import type { ModuleRegistry } from '../../module-sdk/src/index.js';
import { InMemoryAuditStore, InMemoryTraceStore } from '../../observability/src/index.js';
import { assertSecurityContext } from '../../policy/src/index.js';
import {
  InMemoryDeadLetterStore,
  InMemoryDedupStore,
  InMemoryOrderingStore,
  type DeadLetterEntry,
  type ReplayRecord,
} from './stores.js';
import type {
  CommandDelivery,
  EventConsumerDelivery,
  EventDelivery,
  MessageTransport,
  QueryDelivery,
} from './types.js';

type RuntimeOptions = {
  readonly jobs?: InMemoryJobRuntime;
  readonly traces?: InMemoryTraceStore;
  readonly audit?: InMemoryAuditStore;
  readonly dedup?: InMemoryDedupStore;
  readonly ordering?: InMemoryOrderingStore;
  readonly deadLetters?: InMemoryDeadLetterStore;
};

type ExecutedHandler<TResult> = {
  readonly result: TResult;
  readonly jobId: string;
};

const consumerId = (moduleId: string, kind: 'command' | 'event' | 'query', messageType: string) =>
  `${moduleId}:${kind}:${messageType}`;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

const messageFingerprint = (envelope: CommandEnvelope | EventEnvelope): string =>
  JSON.stringify(
    stableValue({
      messageType: envelope.messageType,
      messageKind: envelope.messageKind,
      schemaVersion: envelope.schemaVersion,
      projectId: envelope.projectId,
      actor: envelope.actor,
      principalId: envelope.principalId,
      security: envelope.security,
      payload: envelope.payload,
      orderingKey: envelope.orderingKey,
      sequence: envelope.sequence,
    }),
  );

const withTimeout = async <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number | undefined,
  envelope: AnyEnvelope,
  moduleId: string,
): Promise<TResult> => {
  if (!timeoutMs) {
    return operation();
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ShotgunError({
                code: 'OUTCOME_UNKNOWN',
                safeMessage: 'The handler timed out and its final outcome is unknown.',
                module: moduleId,
                operation: envelope.messageType,
                correlationId: envelope.correlationId,
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export class ConnectorRuntime {
  readonly jobs: InMemoryJobRuntime;
  readonly traces: InMemoryTraceStore;
  readonly audit: InMemoryAuditStore;
  readonly deadLetters: InMemoryDeadLetterStore;

  private readonly dedup: InMemoryDedupStore;
  private readonly ordering: InMemoryOrderingStore;

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly transport: MessageTransport,
    options: RuntimeOptions = {},
  ) {
    this.jobs = options.jobs ?? new InMemoryJobRuntime();
    this.traces = options.traces ?? new InMemoryTraceStore();
    this.audit = options.audit ?? new InMemoryAuditStore();
    this.dedup = options.dedup ?? new InMemoryDedupStore();
    this.ordering = options.ordering ?? new InMemoryOrderingStore();
    this.deadLetters = options.deadLetters ?? new InMemoryDeadLetterStore();
  }

  async sendCommand<TResult = unknown>(
    envelope: CommandEnvelope,
  ): Promise<CommandDelivery<TResult>> {
    validateEnvelope(envelope);
    this.registry.schemas.validateInput(
      envelope.messageType,
      envelope.schemaVersion,
      envelope.payload,
    );
    const route = this.registry.getCommandHandler(envelope.messageType, envelope.schemaVersion);

    try {
      const delivery = await this.executeDeduplicated<TResult>(envelope, route, 'command');
      return {
        status: delivery.duplicate ? 'duplicate' : 'processed',
        envelope,
        result: delivery.result.result,
        jobId: delivery.result.jobId,
      };
    } catch (error) {
      this.addDeadLetter('command', envelope, route.module.manifest.id, error);
      throw error;
    }
  }

  async publishEvent(envelope: EventEnvelope): Promise<EventDelivery> {
    validateEnvelope(envelope);
    this.registry.schemas.validateInput(
      envelope.messageType,
      envelope.schemaVersion,
      envelope.payload,
    );
    const routes = this.registry.getEventHandlers(envelope.messageType, envelope.schemaVersion);
    const consumers: EventConsumerDelivery[] = [];
    this.traces.record(envelope, {
      consumerModule: envelope.producerModule,
      attemptNumber: envelope.job?.attemptNumber ?? 0,
      status: 'published',
    });
    this.auditEnvelope(envelope, envelope.producerModule, 'published');

    for (const route of routes) {
      try {
        const delivery = await this.executeDeduplicated<void>(envelope, route, 'event');
        consumers.push({
          consumerId: route.module.manifest.id,
          status: delivery.duplicate ? 'duplicate' : 'processed',
          ...(route.handler.requiredForPublisherAcknowledgement === true
            ? { requiredForPublisherAcknowledgement: true }
            : {}),
        });
      } catch (error) {
        const entry = this.addDeadLetter('event', envelope, route.module.manifest.id, error);
        consumers.push({
          consumerId: route.module.manifest.id,
          status: 'dead-letter',
          deadLetterId: entry.deadLetterId,
          ...(route.handler.requiredForPublisherAcknowledgement === true
            ? { requiredForPublisherAcknowledgement: true }
            : {}),
        });
      }
    }

    return { envelope, consumers };
  }

  async query<TResult = unknown>(envelope: QueryEnvelope): Promise<QueryDelivery<TResult>> {
    validateEnvelope(envelope);
    this.registry.schemas.validateInput(
      envelope.messageType,
      envelope.schemaVersion,
      envelope.payload,
    );
    const route = this.registry.getQueryHandler(envelope.messageType, envelope.schemaVersion);
    this.authorize(envelope, route);
    const id = consumerId(route.module.manifest.id, 'query', envelope.messageType);

    const execution = await this.jobs.run(
      `query:${envelope.messageId}`,
      id,
      envelope.correlationId,
      async (attempt) => {
        const deliveredEnvelope = {
          ...envelope,
          job: {
            jobId: attempt.jobId,
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
          },
        };
        const result = await this.invoke(route, deliveredEnvelope, attempt, () =>
          route.handler.handle(deliveredEnvelope, this.context(route, deliveredEnvelope, attempt)),
        );
        this.registry.schemas.validateOutput(envelope.messageType, envelope.schemaVersion, result);
        return result as TResult;
      },
    );

    const result = {
      ...createQueryResult(envelope, {
        messageType: `${envelope.messageType}Result`,
        schemaVersion: envelope.schemaVersion,
        producerModule: route.module.manifest.id,
        producerVersion: route.module.manifest.version,
        payload: execution.result,
      }),
      job: {
        jobId: execution.job.jobId,
        attemptId: execution.job.attempts.at(-1)?.attemptId ?? randomUUID(),
        attemptNumber: execution.job.attempts.at(-1)?.attemptNumber ?? 1,
      },
    };

    return {
      envelope,
      result,
      jobId: execution.job.jobId,
    };
  }

  async replay(deadLetterId: string, reason: string): Promise<void> {
    const entry = this.deadLetters.get(deadLetterId);
    const replay: ReplayRecord = {
      replayId: randomUUID(),
      attemptedAt: new Date().toISOString(),
      status: 'running',
    };
    entry.replays.push(replay);
    const envelope = {
      ...entry.envelope,
      replay: {
        replayId: replay.replayId,
        reason,
      },
    };

    try {
      if (entry.kind === 'command' && envelope.messageKind === 'command') {
        const route = this.registry.getCommandHandler(envelope.messageType, envelope.schemaVersion);
        if (route.module.manifest.id !== entry.consumerId) {
          throw this.replayBlocked(entry);
        }
        await this.executeDeduplicated(envelope, route, 'command');
      } else if (entry.kind === 'event' && envelope.messageKind === 'event') {
        const route = this.registry
          .getEventHandlers(envelope.messageType, envelope.schemaVersion)
          .find((candidate) => candidate.module.manifest.id === entry.consumerId);
        if (!route) {
          throw this.replayBlocked(entry);
        }
        await this.executeDeduplicated(envelope, route, 'event');
      } else {
        throw this.replayBlocked(entry);
      }

      replay.status = 'succeeded';
      entry.status = 'resolved';
    } catch (error) {
      replay.status = 'failed';
      throw error;
    }
  }

  private async executeDeduplicated<TResult>(
    envelope: CommandEnvelope | EventEnvelope,
    route: RegisteredCommandHandler | RegisteredEventHandler,
    kind: 'command' | 'event',
  ) {
    this.authorize(envelope, route);
    const id = consumerId(route.module.manifest.id, kind, envelope.messageType);
    const key = `${id}:${envelope.idempotencyKey}`;

    const delivery = await this.dedup.runOnce(key, messageFingerprint(envelope), async () => {
      const execution = await this.jobs.run(
        envelope.idempotencyKey,
        id,
        envelope.correlationId,
        async (attempt) => {
          this.ordering.assertNext(id, envelope);
          const deliveredEnvelope = {
            ...envelope,
            job: {
              jobId: attempt.jobId,
              attemptId: attempt.attemptId,
              attemptNumber: attempt.attemptNumber,
            },
          };
          const handlerOperation =
            kind === 'command'
              ? () =>
                  (route as RegisteredCommandHandler).handler.handle(
                    deliveredEnvelope as CommandEnvelope,
                    this.context(route, deliveredEnvelope, attempt),
                  )
              : () =>
                  (route as RegisteredEventHandler).handler.handle(
                    deliveredEnvelope as EventEnvelope,
                    this.context(route, deliveredEnvelope, attempt),
                  );
          const result = await this.invoke(route, deliveredEnvelope, attempt, () =>
            handlerOperation(),
          );
          this.ordering.commit(id, envelope);
          return result as TResult;
        },
      );
      return {
        result: execution.result,
        jobId: execution.job.jobId,
      } satisfies ExecutedHandler<TResult>;
    });

    if (delivery.duplicate) {
      this.traces.record(envelope, {
        consumerModule: route.module.manifest.id,
        attemptNumber: 0,
        status: 'duplicate',
      });
      this.auditEnvelope(envelope, route.module.manifest.id, 'duplicate');
    }
    return delivery;
  }

  private async invoke<TResult>(
    route: RegisteredCommandHandler | RegisteredEventHandler | RegisteredQueryHandler,
    envelope: CommandEnvelope | EventEnvelope | QueryEnvelope,
    attempt: AttemptRecord,
    operation: () => Promise<TResult> | TResult,
  ): Promise<TResult> {
    this.traces.record(envelope, {
      consumerModule: route.module.manifest.id,
      attemptNumber: attempt.attemptNumber,
      status: 'started',
    });
    this.auditEnvelope(envelope, route.module.manifest.id, 'started');
    try {
      const result = await this.transport.execute(() =>
        withTimeout(
          async () => operation(),
          route.handler.timeoutMs,
          envelope,
          route.module.manifest.id,
        ),
      );
      this.traces.record(envelope, {
        consumerModule: route.module.manifest.id,
        attemptNumber: attempt.attemptNumber,
        status: 'succeeded',
      });
      this.auditEnvelope(envelope, route.module.manifest.id, 'succeeded');
      return result;
    } catch (error) {
      const shotgunError = toShotgunError(error, {
        code: 'TERMINAL_FAILURE',
        safeMessage: 'The handler failed.',
        module: route.module.manifest.id,
        operation: envelope.messageType,
        correlationId: envelope.correlationId,
      });
      this.traces.record(envelope, {
        consumerModule: route.module.manifest.id,
        attemptNumber: attempt.attemptNumber,
        status: 'failed',
        errorCode: shotgunError.code,
      });
      this.auditEnvelope(envelope, route.module.manifest.id, 'failed', shotgunError.code);
      throw shotgunError;
    }
  }

  private context(
    route: RegisteredCommandHandler | RegisteredEventHandler | RegisteredQueryHandler,
    parent: CommandEnvelope | EventEnvelope | QueryEnvelope,
    attempt: AttemptRecord,
  ): HandlerContext {
    return {
      moduleId: route.module.manifest.id,
      attemptNumber: attempt.attemptNumber,
      publish: async (input) => {
        const event = {
          ...createChildEvent(parent, {
            ...input,
            producerModule: route.module.manifest.id,
            producerVersion: route.module.manifest.version,
          }),
          job: {
            jobId: attempt.jobId,
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
          },
        };
        const delivery = await this.publishEvent(event);
        const requiredDeadLetter = delivery.consumers.find(
          (consumer) =>
            consumer.status === 'dead-letter' &&
            consumer.requiredForPublisherAcknowledgement === true,
        );
        if (requiredDeadLetter) {
          throw new ShotgunError({
            code: 'TERMINAL_FAILURE',
            safeMessage:
              'A required child event consumer failed; the parent delivery remains retryable.',
            module: route.module.manifest.id,
            operation: input.messageType,
            correlationId: parent.correlationId,
          });
        }
      },
      query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
        const query = createChildQuery(parent, {
          ...input,
          producerModule: route.module.manifest.id,
          producerVersion: route.module.manifest.version,
        });
        const delivery = await this.query<TResult>(query);
        return delivery.result;
      },
    };
  }

  private authorize(
    envelope: AnyEnvelope,
    route: RegisteredCommandHandler | RegisteredEventHandler | RegisteredQueryHandler,
  ): void {
    assertSecurityContext(
      envelope,
      route.module.manifest.security.requiredContext,
      route.handler.requiredAccessScopes,
    );
  }

  private addDeadLetter(
    kind: 'command' | 'event',
    envelope: CommandEnvelope | EventEnvelope,
    moduleId: string,
    error: unknown,
  ): DeadLetterEntry {
    const id = consumerId(moduleId, kind, envelope.messageType);
    const shotgunError = toShotgunError(error, {
      code: 'TERMINAL_FAILURE',
      safeMessage: 'The message was moved to dead-letter.',
      module: moduleId,
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
    this.traces.record(envelope, {
      consumerModule: moduleId,
      attemptNumber: this.jobs.find(id, envelope.idempotencyKey)?.attempts.length ?? 0,
      status: 'dead-letter',
      errorCode: shotgunError.code,
    });
    this.auditEnvelope(envelope, moduleId, 'dead-letter', shotgunError.code);
    return this.deadLetters.add({
      kind,
      consumerId: moduleId,
      envelope,
      error: shotgunError,
      job: this.jobs.find(id, envelope.idempotencyKey),
    });
  }

  private replayBlocked(entry: DeadLetterEntry): ShotgunError {
    return new ShotgunError({
      code: 'REPLAY_BLOCKED',
      safeMessage: `Dead-letter '${entry.deadLetterId}' cannot be replayed because its route is unavailable.`,
      module: 'connector-runtime',
      operation: 'replay',
      correlationId: entry.envelope.correlationId,
    });
  }

  private auditEnvelope(
    envelope: AnyEnvelope,
    moduleId: string,
    status: 'published' | 'started' | 'succeeded' | 'failed' | 'duplicate' | 'dead-letter',
    errorCode?: ShotgunError['code'],
  ): void {
    this.audit.append({
      category: `message.${status}`,
      actorId: envelope.actor?.id ?? 'system',
      projectId: envelope.projectId ?? 'global',
      traceId: envelope.traceId,
      correlationId: envelope.correlationId,
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      messageKind: envelope.messageKind,
      moduleId,
      status,
      errorCode,
    });
  }
}
