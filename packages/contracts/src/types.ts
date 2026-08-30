export type MessageKind = 'command' | 'event' | 'query' | 'query-result';

export type Actor = {
  readonly type: 'user' | 'service' | 'system';
  readonly id: string;
};

export type SecurityContext = {
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly dataClassification: string;
};

export type ProvenanceContext = {
  readonly sourceVersionIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly policyVersion?: string;
};

export type JobContext = {
  readonly jobId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
};

export type ReplayContext = {
  readonly replayId: string;
  readonly reason: string;
};

export type BaseEnvelope<TPayload = unknown> = {
  readonly messageId: string;
  readonly messageType: string;
  readonly messageKind: MessageKind;
  readonly schemaVersion: string;
  readonly producerModule: string;
  readonly producerVersion: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly projectId?: string;
  readonly actor?: Actor;
  /** Server-bound principal identity when an actor can be distinct from its principal. */
  readonly principalId?: string;
  readonly security?: SecurityContext;
  readonly provenance?: ProvenanceContext;
  readonly job?: JobContext;
  readonly payload: TPayload;
  readonly createdAt: string;
  readonly traceId: string;
  readonly orderingKey?: string;
  readonly sequence?: number;
  readonly replay?: ReplayContext;
};

export type CommandEnvelope<TPayload = unknown> = BaseEnvelope<TPayload> & {
  readonly messageKind: 'command';
  readonly idempotencyKey: string;
};

export type EventEnvelope<TPayload = unknown> = BaseEnvelope<TPayload> & {
  readonly messageKind: 'event';
  readonly idempotencyKey: string;
};

export type QueryEnvelope<TPayload = unknown> = BaseEnvelope<TPayload> & {
  readonly messageKind: 'query';
};

export type QueryResultEnvelope<TPayload = unknown> = BaseEnvelope<TPayload> & {
  readonly messageKind: 'query-result';
};

export type AnyEnvelope = CommandEnvelope | EventEnvelope | QueryEnvelope | QueryResultEnvelope;

export type AssetReference = {
  readonly assetId: string;
  readonly versionId: string;
  readonly mediaType: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly storageUri: string;
  readonly accessScope: readonly string[];
};
