import {
  emptySurferSemanticRun,
  assertSurferSemanticRunTransition,
  type SurferSemanticRunState,
  type SurferSemanticRunStorePort,
} from '../../../packages/contracts/src/surfer-semantic-run.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
export class InMemorySurferSemanticRunStore implements SurferSemanticRunStorePort {
  private readonly states = new Map<string, SurferSemanticRunState>();
  async transaction<T>(runId: string, apply: (s: SurferSemanticRunState) => T): Promise<T> {
    if (!runId || runId.length > 256) throw surferFailure('Invalid semantic run id.');
    const original = this.states.get(runId) ?? emptySurferSemanticRun(runId),
      draft = structuredClone(original),
      value = structuredClone(apply(draft));
    assertSurferSemanticRunTransition(original, draft);
    if (
      draft.approvalRef &&
      [...this.states.values()].some(
        (s) => s.runId !== runId && s.approvalRef === draft.approvalRef,
      )
    )
      throw surferFailure('Semantic approval already belongs to another run.');
    this.states.set(runId, structuredClone(draft));
    return value;
  }
}
