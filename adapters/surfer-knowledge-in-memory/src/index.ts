import {
  emptySurferKnowledgeState,
  type SurferKnowledgeState,
  type SurferKnowledgeStorePort,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

export class InMemorySurferKnowledgeStore implements SurferKnowledgeStorePort {
  private readonly states = new Map<string, SurferKnowledgeState>();
  private readonly tails = new Map<string, Promise<void>>();

  async transaction<T>(spaceId: string, apply: (state: SurferKnowledgeState) => T): Promise<T> {
    const previous = this.tails.get(spaceId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(spaceId, tail);
    await previous;
    try {
      const original = this.states.get(spaceId) ?? emptySurferKnowledgeState(spaceId);
      const draft = structuredClone(original);
      const result = structuredClone(apply(draft)); // rejects async/non-cloneable callbacks before commit
      if (
        draft.spaceId !== spaceId ||
        draft.schemaVersion !== '1.0.0' ||
        !Number.isSafeInteger(draft.sequence) ||
        draft.sequence < original.sequence ||
        draft.sequence > original.sequence + 1 ||
        (draft.sequence === original.sequence && surferDigest(draft) !== surferDigest(original))
      )
        throw surferFailure('Knowledge transaction changed identity/schema/sequence.');
      surferDigest(draft); // bounded, finite plain JSON only
      this.states.set(spaceId, structuredClone(draft));
      return result;
    } finally {
      release();
      if (this.tails.get(spaceId) === tail) this.tails.delete(spaceId);
    }
  }
}
