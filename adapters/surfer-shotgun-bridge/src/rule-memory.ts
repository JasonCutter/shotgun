import type {
  SurferScopedRuleMemorySessionPort,
  SurferScopedRuleMemorySession,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import type { SurferSourceSessionPortV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunSurferDirectiveMemorySession } from './directive-memory.js';
import { ShotgunSurferSourceBridgeV2 } from './v2.js';

/** Existing generic memory session plus fixed learned-footprint capture in the same Source transaction. */
export class ShotgunSurferScopedRuleMemorySession implements SurferScopedRuleMemorySessionPort {
  constructor(private readonly sessions: SurferSourceSessionPortV2) {}
  async withSession<T>(
    actor: unknown,
    apply: (session: SurferScopedRuleMemorySession) => Promise<T>,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withSnapshotV2(request, async (current) => {
      let active = true;
      const bound: SurferSourceSessionPortV2 = {
        withSnapshotV2: async (r, action) => {
          if (!active || surferDigest(decodeSurferSourceRequest(r)) !== surferDigest(request))
            throw surferFailure('Rule memory session escaped its Source transaction.');
          return action(current);
        },
      };
      try {
        return await new ShotgunSurferDirectiveMemorySession(bound).withSession(request, (s) =>
          apply({
            ...s,
            captureChain: (input) =>
              new ShotgunSurferSourceBridgeV2(bound).captureChain(request, input),
            captureRule: (input) =>
              new ShotgunSurferSourceBridgeV2(bound).captureRule(request, input),
          }),
        );
      } finally {
        active = false;
      }
    });
  }
}
