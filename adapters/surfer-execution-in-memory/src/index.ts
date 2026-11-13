import {
  emptySurferExecutionState,
  assertSurferExecutionTransition,
  type SurferExecutionState,
  type SurferExecutionStorePort,
} from '../../../packages/contracts/src/surfer-execution.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

export class InMemorySurferExecutionStore implements SurferExecutionStorePort {
  private states = new Map<string, SurferExecutionState>();
  private tails = new Map<string, Promise<void>>();
  async transaction<T>(budgetId: string, apply: (state: SurferExecutionState) => T): Promise<T> {
    if (!budgetId || budgetId.length > 256) throw surferFailure('Invalid budget identity.');
    const previous = this.tails.get(budgetId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(budgetId, tail);
    await previous;
    try {
      const original = this.states.get(budgetId) ?? emptySurferExecutionState(budgetId);
      const draft = structuredClone(original),
        result = structuredClone(apply(draft));
      assertSurferExecutionTransition(original, draft);
      this.states.set(budgetId, structuredClone(draft));
      return result;
    } finally {
      release();
      if (this.tails.get(budgetId) === tail) this.tails.delete(budgetId);
    }
  }
}
