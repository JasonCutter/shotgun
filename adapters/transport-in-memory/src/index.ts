import { AsyncLocalStorage } from 'node:async_hooks';

import type { MessageTransport } from '../../../packages/connector-runtime/src/index.js';

type QueueItem = {
  readonly operation: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
};

export class InMemoryTransport implements MessageTransport {
  readonly name = 'in-memory' as const;

  private readonly activeDelivery = new AsyncLocalStorage<boolean>();
  private readonly queue: QueueItem[] = [];
  private processing = false;

  execute<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    if (this.activeDelivery.getStore()) {
      return operation();
    }

    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({
        operation,
        resolve: (value) => resolve(value as TResult),
        reject,
      });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      let item = this.queue.shift();
      while (item) {
        try {
          const result = await this.activeDelivery.run(true, item.operation);
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
        item = this.queue.shift();
      }
    } finally {
      this.processing = false;
    }
  }
}
