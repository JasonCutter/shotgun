import {
  assertSurferBindingTransitionV2,
  emptySurferBindingStateV2,
  type SurferBindingStateV2,
  type SurferBindingStorePortV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
export class InMemorySurferBindingStoreV2 implements SurferBindingStorePortV2 {
  private states = new Map<string, SurferBindingStateV2>();
  private tails = new Map<string, Promise<void>>();
  async transaction<T>(spaceId: string, apply: (state: SurferBindingStateV2) => T): Promise<T> {
    if (!spaceId || spaceId.length > 256) throw surferFailure('Invalid binding space.');
    const previous = this.tails.get(spaceId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((r) => {
      release = r;
    });
    this.tails.set(spaceId, tail);
    await previous;
    try {
      const old = this.states.get(spaceId) ?? emptySurferBindingStateV2(spaceId),
        next = structuredClone(old);
      const result = structuredClone(apply(next));
      assertSurferBindingTransitionV2(old, next);
      this.states.set(spaceId, structuredClone(next));
      return result;
    } finally {
      release();
      if (this.tails.get(spaceId) === tail) this.tails.delete(spaceId);
    }
  }
}
