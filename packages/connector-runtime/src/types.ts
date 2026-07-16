import type {
  CommandEnvelope,
  EventEnvelope,
  QueryEnvelope,
  QueryResultEnvelope,
} from '../../contracts/src/index.js';

export type MessageTransport = {
  readonly name: 'in-memory' | 'in-process';
  execute<TResult>(operation: () => Promise<TResult>): Promise<TResult>;
};

export type CommandDelivery<TResult = unknown> = {
  readonly status: 'processed' | 'duplicate';
  readonly envelope: CommandEnvelope;
  readonly result: TResult;
  readonly jobId: string;
};

export type EventConsumerDelivery = {
  readonly consumerId: string;
  readonly status: 'processed' | 'duplicate' | 'dead-letter';
  readonly deadLetterId?: string;
};

export type EventDelivery = {
  readonly envelope: EventEnvelope;
  readonly consumers: readonly EventConsumerDelivery[];
};

export type QueryDelivery<TResult = unknown> = {
  readonly envelope: QueryEnvelope;
  readonly result: QueryResultEnvelope<TResult>;
  readonly jobId: string;
};
