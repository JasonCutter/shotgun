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
import type {
  ConnectorRuntimeStatePort,
  ConnectorSemanticIdentity,
  ReplayAuthorization,
} from './ports.js';

export type RuntimeOptions = {
  readonly jobs?: InMemoryJobRuntime;
  readonly traces?: InMemoryTraceStore;
  readonly audit?: InMemoryAuditStore;
  readonly dedup?: InMemoryDedupStore;
  readonly ordering?: InMemoryOrderingStore;
  readonly deadLetters?: InMemoryDeadLetterStore;
  /** Optional production durability authority. In-memory stores remain the
   * default for unit/contract compositions. */
  readonly state?: ConnectorRuntimeStatePort;
};

export type ReplayRequest = ReplayAuthorization;

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

const securityScopeFor = (envelope: AnyEnvelope): string => {
  const security = envelope.security ?? {
    accessScope: [],
    sensitivity: 'public' as const,
    dataClassification: 'unspecified',
  };
  return JSON.stringify({
    accessScope: [...security.accessScope].sort(),
    sensitivity: security.sensitivity,
    dataClassification: security.dataClassification,
  });
};

const withTimeout = async <TResult>(
  operation: () => Promise<TResult>,
  timeoutMs: number | undefined,
  envelope: AnyEnvelope,
  moduleId: string,
  onTimeout?: () => void,
): Promise<TResult> => {
  if (!timeoutMs) {
    return operation();
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(
            new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage: 'The handler timed out and its final outcome is unknown.',
              module: moduleId,
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            }),
          );
        }, timeoutMs);
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
  private readonly durableState?: ConnectorRuntimeStatePort;

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
    this.durableState = options.state;
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
      const delivery = this.durableState
        ? await this.executeDeduplicatedDurable<TResult>(envelope, route, 'command')
        : await this.executeDeduplicated<TResult>(envelope, route, 'command');
      return {
        status: delivery.duplicate ? 'duplicate' : 'processed',
        envelope,
        result: delivery.result.result,
        jobId: delivery.result.jobId,
      };
    } catch (error) {
      if (this.durableState) {
        await this.addDeadLetterDurable('command', envelope, route.module.manifest.id, error);
      } else {
        this.addDeadLetter('command', envelope, route.module.manifest.id, error);
      }
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
        const delivery = this.durableState
          ? await this.executeDeduplicatedDurable<void>(envelope, route, 'event')
          : await this.executeDeduplicated<void>(envelope, route, 'event');
        consumers.push({
          consumerId: route.module.manifest.id,
          status: delivery.duplicate ? 'duplicate' : 'processed',
          ...(route.handler.requiredForPublisherAcknowledgement === true
            ? { requiredForPublisherAcknowledgement: true }
            : {}),
        });
      } catch (error) {
        const entry = this.durableState
          ? await this.addDeadLetterDurable('event', envelope, route.module.manifest.id, error)
          : this.addDeadLetter('event', envelope, route.module.manifest.id, error);
        consumers.push({
          consumerId: route.module.manifest.id,
          status: 'dead-letter',
          deadLetterId: entry.deadLetterId,
          errorCode: entry.error.code,
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
    if (this.durableState) {
      return this.queryDurable<TResult>(envelope, route);
    }
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

  async replay(deadLetterId: string, request: ReplayRequest | string): Promise<void> {
    const entry = this.durableState
      ? await this.durableState.deadLetters.get(deadLetterId)
      : this.deadLetters.get(deadLetterId);
    const authorization: ReplayAuthorization =
      typeof request === 'string'
        ? {
            actor: { type: 'system', id: 'legacy-in-memory-replay' },
            projectId: entry.projectId,
            securityScope: entry.securityScope,
            reason: request,
          }
        : request;
    if (this.durableState) {
      await this.durableState.deadLetters.authorizeReplay(deadLetterId, authorization);
    } else {
      this.deadLetters.authorizeReplay(deadLetterId, authorization);
    }
    if (!authorization.reason.trim()) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'A replay reason is required.',
        module: 'connector-runtime',
        operation: 'replay',
      });
    }
    const expectedIdentity = this.semanticIdentity(
      entry.envelope as CommandEnvelope | EventEnvelope,
      entry.identity.consumerId,
      entry.identity.messageKind,
      entry.identity.semanticKey,
    );
    if (
      expectedIdentity.projectId !== entry.identity.projectId ||
      expectedIdentity.securityScope !== entry.identity.securityScope ||
      expectedIdentity.messageType !== entry.identity.messageType ||
      expectedIdentity.fingerprint !== entry.identity.fingerprint
    ) {
      throw this.replayBlocked(entry);
    }
    const replay: ReplayRecord = {
      replayId: randomUUID(),
      attemptedAt: new Date().toISOString(),
      status: 'running',
      reason: authorization.reason,
      actorId: authorization.actor.id,
      actorType: authorization.actor.type,
      projectId: authorization.projectId,
      securityScope: authorization.securityScope,
      originalFingerprint: entry.identity.fingerprint,
    };
    if (this.durableState) {
      await this.durableState.deadLetters.appendReplay(deadLetterId, replay);
    } else {
      entry.replays.push(replay);
    }
    const envelope = {
      ...entry.envelope,
      replay: {
        replayId: replay.replayId,
        reason: authorization.reason,
      },
    };

    try {
      validateEnvelope(envelope);
      this.registry.schemas.validateInput(
        envelope.messageType,
        envelope.schemaVersion,
        envelope.payload,
      );
      if (entry.kind === 'command' && envelope.messageKind === 'command') {
        const route = this.registry.getCommandHandler(envelope.messageType, envelope.schemaVersion);
        if (
          entry.identity.consumerId !==
          consumerId(route.module.manifest.id, 'command', envelope.messageType)
        ) {
          throw this.replayBlocked(entry);
        }
        if (this.durableState) {
          await this.executeDeduplicatedDurable(envelope, route, 'command');
        } else {
          await this.executeDeduplicated(envelope, route, 'command');
        }
      } else if (entry.kind === 'event' && envelope.messageKind === 'event') {
        const route = this.registry
          .getEventHandlers(envelope.messageType, envelope.schemaVersion)
          .find(
            (candidate) =>
              entry.identity.consumerId ===
              consumerId(candidate.module.manifest.id, 'event', envelope.messageType),
          );
        if (!route) {
          throw this.replayBlocked(entry);
        }
        if (this.durableState) {
          await this.executeDeduplicatedDurable(envelope, route, 'event');
        } else {
          await this.executeDeduplicated(envelope, route, 'event');
        }
      } else {
        throw this.replayBlocked(entry);
      }

      replay.status = 'succeeded';
      if (this.durableState) {
        await this.durableState.deadLetters.updateReplay(replay.replayId, 'succeeded');
        await this.durableState.deadLetters.resolve(deadLetterId);
      } else {
        entry.status = 'resolved';
      }
    } catch (error) {
      replay.status = 'failed';
      if (this.durableState) {
        await this.durableState.deadLetters.updateReplay(replay.replayId, 'failed');
      }
      throw error;
    }
  }

  /** Resolve an OUTCOME_UNKNOWN tombstone using an authoritative provider or
   * operator observation. This is the only API that can reopen the durable
   * semantic outcome; replay never calls a handler for an unknown identity. */
  async reconcileOutcome<TResult>(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly result?: TResult;
    readonly safeErrorCode?: string;
    readonly safeErrorMessage?: string;
  }): Promise<unknown> {
    if (!this.durableState) {
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'Durable outcome reconciliation is unavailable for an in-memory runtime.',
        module: 'connector-runtime',
        operation: 'reconcile-outcome',
      });
    }
    return this.durableState.dedup.reconcile(input);
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
          this.ordering.commitLegacy(id, envelope);
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

  /** Durable equivalent of executeDeduplicated.  The dedup record is opened
   * before invoking the handler and is fenced on every terminal transition;
   * therefore a timeout/ack-loss cannot make a second request eligible. */
  private async executeDeduplicatedDurable<TResult>(
    envelope: CommandEnvelope | EventEnvelope,
    route: RegisteredCommandHandler | RegisteredEventHandler,
    kind: 'command' | 'event',
  ): Promise<{ duplicate: boolean; result: ExecutedHandler<TResult> }> {
    const state = this.durableState!;
    this.authorize(envelope, route);
    const id = consumerId(route.module.manifest.id, kind, envelope.messageType);
    const identity = this.semanticIdentity(envelope, id, kind, envelope.idempotencyKey);
    const jobId = randomUUID();
    const began = await state.dedup.begin<TResult>({ ...identity, jobId });
    if (began.kind === 'CONFLICT') {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: `Idempotency key '${envelope.idempotencyKey}' was reused for a different message.`,
        module: 'connector-runtime',
        operation: 'deduplicate-message',
        correlationId: envelope.correlationId,
      });
    }
    if (began.kind === 'DUPLICATE') {
      if (began.record.state === 'COMPLETED') {
        return {
          duplicate: true,
          result: { result: began.record.result as TResult, jobId: began.record.jobId ?? jobId },
        };
      }
      if (began.record.state === 'OUTCOME_UNKNOWN') {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'The previous delivery outcome is unknown and requires reconciliation.',
          module: 'connector-runtime',
          operation: envelope.messageType,
          correlationId: envelope.correlationId,
        });
      }
      if (began.record.state === 'IN_PROGRESS') {
        // A concurrent duplicate never invokes the handler. Give the owner a
        // bounded opportunity to publish its terminal state, then require
        // reconciliation instead of guessing or replacing the side effect.
        for (let attempt = 0; attempt < 100; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          const current = await state.dedup.get<TResult>(identity);
          if (current?.state === 'COMPLETED') {
            return {
              duplicate: true,
              result: { result: current.result as TResult, jobId: current.jobId ?? jobId },
            };
          }
          if (current?.state === 'OUTCOME_UNKNOWN') {
            throw new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage: 'The previous delivery outcome is unknown and requires reconciliation.',
              module: 'connector-runtime',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
        }
        throw new ShotgunError({
          code: 'RETRYABLE_DEPENDENCY',
          safeMessage: 'The delivery is still owned by another active worker.',
          module: 'connector-runtime',
          operation: envelope.messageType,
          correlationId: envelope.correlationId,
          retryable: true,
        });
      }
    }

    let orderingFence: { readonly fencingToken: number } | undefined;
    try {
      const execution = await state.jobs.run(identity, envelope.correlationId, async (attempt) => {
        const acquiredFence = await state.ordering.acquireNext(
          identity,
          envelope,
          attempt.jobId,
          300_000,
        );
        orderingFence = acquiredFence;
        let active = true;
        const deliveredEnvelope = {
          ...envelope,
          job: {
            jobId: attempt.jobId,
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
          },
        };
        const operation =
          kind === 'command'
            ? () =>
                (route as RegisteredCommandHandler).handler.handle(
                  deliveredEnvelope as CommandEnvelope,
                  this.context(route, deliveredEnvelope, attempt, () => active),
                )
            : () =>
                (route as RegisteredEventHandler).handler.handle(
                  deliveredEnvelope as EventEnvelope,
                  this.context(route, deliveredEnvelope, attempt, () => active),
                );
        try {
          const result = await this.invoke(route, deliveredEnvelope, attempt, operation, () => {
            active = false;
          });
          active = false;
          await state.ordering.commit(identity, envelope, acquiredFence.fencingToken);
          orderingFence = undefined;
          return result as TResult;
        } catch (error) {
          const handlerError = toShotgunError(error, {
            code: 'TERMINAL_FAILURE',
            safeMessage: 'The durable connector handler failed.',
            module: route.module.manifest.id,
            operation: envelope.messageType,
            correlationId: envelope.correlationId,
          });
          if (handlerError.code !== 'OUTCOME_UNKNOWN' && orderingFence) {
            await state.ordering.release(identity, envelope, acquiredFence.fencingToken);
            orderingFence = undefined;
          }
          throw handlerError;
        }
      });
      await state.dedup.complete({
        identity,
        fenceToken: began.record.fenceToken,
        jobId: began.record.jobId ?? execution.job.jobId,
        result: execution.result,
      });
      return {
        duplicate: false,
        result: { result: execution.result, jobId: execution.job.jobId },
      };
    } catch (error) {
      const shotgunError = toShotgunError(error, {
        code: 'TERMINAL_FAILURE',
        safeMessage: 'The durable connector handler failed.',
        module: route.module.manifest.id,
        operation: envelope.messageType,
        correlationId: envelope.correlationId,
      });
      if (shotgunError.code !== 'OUTCOME_UNKNOWN' && orderingFence) {
        await state.ordering.release(identity, envelope, orderingFence.fencingToken);
        orderingFence = undefined;
      }
      if (shotgunError.code === 'OUTCOME_UNKNOWN') {
        await state.dedup.markOutcomeUnknown({
          identity,
          fenceToken: began.record.fenceToken,
          jobId: began.record.jobId ?? jobId,
          safeErrorMessage: shotgunError.safeMessage,
        });
      } else {
        await state.dedup.fail({
          identity,
          fenceToken: began.record.fenceToken,
          jobId: began.record.jobId ?? jobId,
          safeErrorCode: shotgunError.code,
          safeErrorMessage: shotgunError.safeMessage,
        });
      }
      throw shotgunError;
    }
  }

  private semanticIdentity(
    envelope: CommandEnvelope | EventEnvelope | QueryEnvelope,
    id: string,
    kind: 'command' | 'event' | 'query',
    semanticKey: string,
  ): ConnectorSemanticIdentity {
    return {
      projectId: envelope.projectId ?? 'global',
      securityScope: securityScopeFor(envelope),
      consumerId: id,
      messageKind: kind,
      messageType: envelope.messageType,
      semanticKey,
      fingerprint:
        kind === 'query'
          ? envelope.messageId
          : messageFingerprint(envelope as CommandEnvelope | EventEnvelope),
    };
  }

  private async queryDurable<TResult>(
    envelope: QueryEnvelope,
    route: RegisteredQueryHandler,
  ): Promise<QueryDelivery<TResult>> {
    const state = this.durableState!;
    const id = consumerId(route.module.manifest.id, 'query', envelope.messageType);
    const semanticKey = `query:${envelope.messageId}`;
    const identity = this.semanticIdentity(envelope, id, 'query', semanticKey);
    const began = await state.dedup.begin<TResult>({ ...identity, jobId: randomUUID() });
    if (began.kind === 'CONFLICT') {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The query idempotency identity conflicts with a prior request.',
        module: 'connector-runtime',
        operation: envelope.messageType,
        correlationId: envelope.correlationId,
      });
    }
    let result: TResult;
    let jobId: string;
    if (began.kind === 'DUPLICATE') {
      if (began.record.state === 'COMPLETED') {
        result = began.record.result as TResult;
        jobId = began.record.jobId ?? randomUUID();
      } else {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'The previous query outcome requires reconciliation.',
          module: 'connector-runtime',
          operation: envelope.messageType,
          correlationId: envelope.correlationId,
        });
      }
    } else {
      try {
        const execution = await state.jobs.run(
          identity,
          envelope.correlationId,
          async (attempt) => {
            let active = true;
            const deliveredEnvelope = {
              ...envelope,
              job: {
                jobId: attempt.jobId,
                attemptId: attempt.attemptId,
                attemptNumber: attempt.attemptNumber,
              },
            };
            const value = await this.invoke(
              route,
              deliveredEnvelope,
              attempt,
              () =>
                route.handler.handle(
                  deliveredEnvelope,
                  this.context(route, deliveredEnvelope, attempt, () => active),
                ),
              () => {
                active = false;
              },
            );
            active = false;
            this.registry.schemas.validateOutput(
              envelope.messageType,
              envelope.schemaVersion,
              value,
            );
            return value as TResult;
          },
        );
        result = execution.result;
        jobId = execution.job.jobId;
        await state.dedup.complete({
          identity,
          fenceToken: began.record.fenceToken,
          jobId: began.record.jobId ?? jobId,
          result,
        });
      } catch (error) {
        const shotgunError = toShotgunError(error, {
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The durable query failed.',
          module: route.module.manifest.id,
          operation: envelope.messageType,
          correlationId: envelope.correlationId,
        });
        if (shotgunError.code === 'OUTCOME_UNKNOWN') {
          await state.dedup.markOutcomeUnknown({
            identity,
            fenceToken: began.record.fenceToken,
            jobId: began.record.jobId ?? '',
            safeErrorMessage: shotgunError.safeMessage,
          });
        } else {
          await state.dedup.fail({
            identity,
            fenceToken: began.record.fenceToken,
            jobId: began.record.jobId ?? '',
            safeErrorCode: shotgunError.code,
            safeErrorMessage: shotgunError.safeMessage,
          });
        }
        throw shotgunError;
      }
    }
    const queryResult = {
      ...createQueryResult(envelope, {
        messageType: `${envelope.messageType}Result`,
        schemaVersion: envelope.schemaVersion,
        producerModule: route.module.manifest.id,
        producerVersion: route.module.manifest.version,
        payload: result,
      }),
      job: { jobId, attemptId: randomUUID(), attemptNumber: 1 },
    };
    return { envelope, result: queryResult, jobId };
  }

  private async addDeadLetterDurable(
    kind: 'command' | 'event',
    envelope: CommandEnvelope | EventEnvelope,
    moduleId: string,
    error: unknown,
  ): Promise<DeadLetterEntry> {
    const state = this.durableState!;
    const id = consumerId(moduleId, kind, envelope.messageType);
    const identity = this.semanticIdentity(envelope, id, kind, envelope.idempotencyKey);
    const shotgunError = toShotgunError(error, {
      code: 'TERMINAL_FAILURE',
      safeMessage: 'The message was moved to dead-letter.',
      module: moduleId,
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
    const job = await state.jobs.find(identity);
    this.traces.record(envelope, {
      consumerModule: moduleId,
      attemptNumber: job?.attempts.length ?? 0,
      status: 'dead-letter',
      errorCode: shotgunError.code,
    });
    this.auditEnvelope(envelope, moduleId, 'dead-letter', shotgunError.code);
    return state.deadLetters.add({
      projectId: identity.projectId,
      securityScope: identity.securityScope,
      kind,
      consumerId: moduleId,
      identity,
      messageType: identity.messageType,
      semanticKey: identity.semanticKey,
      fingerprint: identity.fingerprint,
      envelope,
      error: shotgunError,
      ...(job ? { job } : {}),
    });
  }

  private async invoke<TResult>(
    route: RegisteredCommandHandler | RegisteredEventHandler | RegisteredQueryHandler,
    envelope: CommandEnvelope | EventEnvelope | QueryEnvelope,
    attempt: AttemptRecord,
    operation: () => Promise<TResult> | TResult,
    onTimeout?: () => void,
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
          onTimeout,
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
    isActive?: () => boolean,
  ): HandlerContext {
    return {
      moduleId: route.module.manifest.id,
      attemptNumber: attempt.attemptNumber,
      publish: async (input) => {
        if (isActive && !isActive()) {
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The parent delivery outcome is unknown; child publication is fenced.',
            module: route.module.manifest.id,
            operation: input.messageType,
            correlationId: parent.correlationId,
          });
        }
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
        if (isActive && !isActive()) {
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The parent delivery outcome is unknown; child query is fenced.',
            module: route.module.manifest.id,
            operation: input.messageType,
            correlationId: parent.correlationId,
          });
        }
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
    const identity = this.semanticIdentity(envelope, id, kind, envelope.idempotencyKey);
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
      projectId: identity.projectId,
      securityScope: identity.securityScope,
      kind,
      consumerId: moduleId,
      identity,
      messageType: identity.messageType,
      semanticKey: identity.semanticKey,
      fingerprint: identity.fingerprint,
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
