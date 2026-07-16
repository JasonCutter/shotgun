import type { MessageTransport } from '../../../packages/connector-runtime/src/index.js';

export class InProcessTransport implements MessageTransport {
  readonly name = 'in-process' as const;

  execute<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    return operation();
  }
}
