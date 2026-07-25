import type {
  Actor,
  AnyEnvelope,
  CommandEnvelope,
  EventEnvelope,
  ProvenanceContext,
  QueryEnvelope,
  QueryResultEnvelope,
  SecurityContext,
} from './types.js';

const generateUUID = (): string => {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  return nodeCrypto.randomUUID();
};

type RootContext = {
  readonly producerModule: string;
  readonly producerVersion: string;
  readonly projectId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly provenance?: ProvenanceContext;
  readonly correlationId?: string;
  readonly traceId?: string;
};

type MessageIdentity = {
  readonly messageId?: string;
  readonly createdAt?: string;
};

export const createCommand = <TPayload>(
  input: RootContext &
    MessageIdentity & {
      readonly messageType: string;
      readonly schemaVersion: string;
      readonly idempotencyKey: string;
      readonly payload: TPayload;
      readonly orderingKey?: string;
      readonly sequence?: number;
    },
): CommandEnvelope<TPayload> => ({
  messageId: input.messageId ?? generateUUID(),
  messageType: input.messageType,
  messageKind: 'command',
  schemaVersion: input.schemaVersion,
  producerModule: input.producerModule,
  producerVersion: input.producerVersion,
  correlationId: input.correlationId ?? generateUUID(),
  idempotencyKey: input.idempotencyKey,
  projectId: input.projectId,
  actor: input.actor,
  security: input.security,
  provenance: input.provenance,
  payload: input.payload,
  createdAt: input.createdAt ?? new Date().toISOString(),
  traceId: input.traceId ?? generateUUID(),
  orderingKey: input.orderingKey,
  sequence: input.sequence,
});

export const createQuery = <TPayload>(
  input: RootContext &
    MessageIdentity & {
      readonly messageType: string;
      readonly schemaVersion: string;
      readonly payload: TPayload;
    },
): QueryEnvelope<TPayload> => ({
  messageId: input.messageId ?? generateUUID(),
  messageType: input.messageType,
  messageKind: 'query',
  schemaVersion: input.schemaVersion,
  producerModule: input.producerModule,
  producerVersion: input.producerVersion,
  correlationId: input.correlationId ?? generateUUID(),
  projectId: input.projectId,
  actor: input.actor,
  security: input.security,
  provenance: input.provenance,
  payload: input.payload,
  createdAt: input.createdAt ?? new Date().toISOString(),
  traceId: input.traceId ?? generateUUID(),
});

type ChildInput<TPayload> = MessageIdentity & {
  readonly messageType: string;
  readonly schemaVersion: string;
  readonly producerModule: string;
  readonly producerVersion: string;
  readonly payload: TPayload;
};

const inheritedContext = (parent: AnyEnvelope) => ({
  correlationId: parent.correlationId,
  causationId: parent.messageId,
  projectId: parent.projectId,
  actor: parent.actor,
  security: parent.security,
  provenance: parent.provenance,
  traceId: parent.traceId,
});

export const createChildEvent = <TPayload>(
  parent: AnyEnvelope,
  input: ChildInput<TPayload> & {
    readonly idempotencyKey: string;
    readonly orderingKey?: string;
    readonly sequence?: number;
  },
): EventEnvelope<TPayload> => ({
  messageId: input.messageId ?? generateUUID(),
  messageType: input.messageType,
  messageKind: 'event',
  schemaVersion: input.schemaVersion,
  producerModule: input.producerModule,
  producerVersion: input.producerVersion,
  ...inheritedContext(parent),
  idempotencyKey: input.idempotencyKey,
  payload: input.payload,
  createdAt: input.createdAt ?? new Date().toISOString(),
  orderingKey: input.orderingKey,
  sequence: input.sequence,
});

export const createChildQuery = <TPayload>(
  parent: AnyEnvelope,
  input: ChildInput<TPayload>,
): QueryEnvelope<TPayload> => ({
  messageId: input.messageId ?? generateUUID(),
  messageType: input.messageType,
  messageKind: 'query',
  schemaVersion: input.schemaVersion,
  producerModule: input.producerModule,
  producerVersion: input.producerVersion,
  ...inheritedContext(parent),
  payload: input.payload,
  createdAt: input.createdAt ?? new Date().toISOString(),
});

export const createQueryResult = <TPayload>(
  query: QueryEnvelope,
  input: ChildInput<TPayload>,
): QueryResultEnvelope<TPayload> => ({
  messageId: input.messageId ?? generateUUID(),
  messageType: input.messageType,
  messageKind: 'query-result',
  schemaVersion: input.schemaVersion,
  producerModule: input.producerModule,
  producerVersion: input.producerVersion,
  ...inheritedContext(query),
  payload: input.payload,
  createdAt: input.createdAt ?? new Date().toISOString(),
});
