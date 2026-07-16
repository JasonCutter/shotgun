import { randomUUID } from 'node:crypto';

import type { AnyEnvelope, ErrorCode, MessageKind } from '../../contracts/src/index.js';

export type TraceStatus =
  'published' | 'started' | 'succeeded' | 'failed' | 'duplicate' | 'dead-letter';

export type TraceRecord = {
  readonly recordId: string;
  readonly traceId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly messageKind: MessageKind;
  readonly consumerModule: string;
  readonly attemptNumber: number;
  readonly status: TraceStatus;
  readonly errorCode?: ErrorCode;
  readonly recordedAt: string;
};

export class InMemoryTraceStore {
  private readonly records: TraceRecord[] = [];

  record(
    envelope: AnyEnvelope,
    input: Omit<
      TraceRecord,
      | 'recordId'
      | 'traceId'
      | 'correlationId'
      | 'causationId'
      | 'messageId'
      | 'messageType'
      | 'messageKind'
      | 'recordedAt'
    >,
  ): TraceRecord {
    const record: TraceRecord = {
      recordId: randomUUID(),
      traceId: envelope.traceId,
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      messageKind: envelope.messageKind,
      recordedAt: new Date().toISOString(),
      ...input,
    };
    this.records.push(record);
    return record;
  }

  findByTraceId(traceId: string): readonly TraceRecord[] {
    return this.records.filter((record) => record.traceId === traceId);
  }

  list(): readonly TraceRecord[] {
    return [...this.records];
  }
}

export type AuditRecord = {
  readonly auditId: string;
  readonly category: string;
  readonly actorId: string;
  readonly projectId: string;
  readonly traceId: string;
  readonly correlationId: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly messageKind: MessageKind;
  readonly moduleId: string;
  readonly status: 'published' | 'started' | 'succeeded' | 'failed' | 'duplicate' | 'dead-letter';
  readonly errorCode?: ErrorCode;
  readonly occurredAt: string;
};

export class InMemoryAuditStore {
  private readonly records: AuditRecord[] = [];

  append(input: Omit<AuditRecord, 'auditId' | 'occurredAt'>): AuditRecord {
    const record = {
      auditId: randomUUID(),
      occurredAt: new Date().toISOString(),
      ...input,
    };
    this.records.push(record);
    return record;
  }

  list(): readonly AuditRecord[] {
    return [...this.records];
  }

  findByTraceId(traceId: string): readonly AuditRecord[] {
    return this.records.filter((record) => record.traceId === traceId);
  }
}
