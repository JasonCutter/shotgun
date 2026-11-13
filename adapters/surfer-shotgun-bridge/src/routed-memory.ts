import type {
  SurferRoutedSourceSessionsPort,
  SurferRowsSourceSessionsPort,
} from '../../../packages/contracts/src/surfer-source-rows.js';
import type { SurferSourceSessionPortV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type {
  SurferScopedRuleMemorySession,
  SurferScopedRuleMemorySessionPort,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunSurferScopedRuleMemorySession } from './rule-memory.js';
import { ShotgunSurferSourceRowsBridge } from './rows.js';
import { ShotgunSurferCognitiveSource } from './cognition.js';

/** Storage choice is server-owned and fixed for one Source MVCC transaction. */
export class ShotgunSurferRoutedMemorySession implements SurferScopedRuleMemorySessionPort {
  constructor(private readonly sessions: SurferRoutedSourceSessionsPort) {}
  withSession<T>(actor: unknown, apply: (s: SurferScopedRuleMemorySession) => Promise<T>) {
    return this.open(actor, 'WRITE', apply);
  }
  withReadSession<T>(actor: unknown, apply: (s: SurferScopedRuleMemorySession) => Promise<T>) {
    return this.open(actor, 'READ', apply);
  }
  private async open<T>(
    actor: unknown,
    intent: 'READ' | 'WRITE',
    apply: (s: SurferScopedRuleMemorySession) => Promise<T>,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withRoutedSnapshot(request, intent, async (routed) => {
      let active = true;
      const check = (a: unknown = request) => {
        if (!active || surferDigest(decodeSurferSourceRequest(a)) !== surferDigest(request))
          throw surferFailure('Routed memory escaped its actor/transaction.');
      };
      const write = () => {
        check();
        if (intent === 'READ') throw surferFailure('Read-only memory session cannot write.');
      };
      const guard = (s: SurferScopedRuleMemorySession): SurferScopedRuleMemorySession => ({
        source: {
          observe: (a, i) => {
            write();
            check(a);
            return s.source.observe(a, i);
          },
          withCurrent: (a, b, v, fn) => {
            check(a);
            return s.source.withCurrent(a, b, v, fn);
          },
        },
        capture: (i) => {
          write();
          return s.capture(i);
        },
        captureRule: (i) => {
          write();
          return s.captureRule(i);
        },
        captureChain: (i) => {
          write();
          return s.captureChain(i);
        },
        commit: (e) => {
          write();
          return s.commit(e);
        },
        findCommit: (id) => {
          check();
          return s.findCommit(id);
        },
        priorCreatedAt: (id) => {
          check();
          return s.priorCreatedAt(id);
        },
        readArtifact: (r) => {
          check();
          return s.readArtifact(r);
        },
        read: (id) => {
          check();
          return s.read(id);
        },
      });
      try {
        if (routed.profile === 'LEGACY') {
          const bound: SurferSourceSessionPortV2 = {
            withSnapshotV2: async (r, fn) => {
              check(r);
              return fn(routed.session);
            },
          };
          return await new ShotgunSurferScopedRuleMemorySession(bound).withSession(request, (s) =>
            apply(guard(s)),
          );
        }
        const current = routed.session,
          bound: SurferRowsSourceSessionsPort = {
            withRowsSnapshot: async (r, mode, fn) => {
              check(r);
              if (mode === 'WRITE') write();
              return fn(current);
            },
          },
          bridge = new ShotgunSurferSourceRowsBridge(bound);
        return structuredClone(
          await apply(
            guard({
              source: new ShotgunSurferCognitiveSource(bridge),
              capture: (i) => bridge.capture(request, i),
              captureRule: (i) => bridge.captureRule(request, i),
              captureChain: (i) => bridge.captureChain(request, i),
              findCommit: (id) => current.core.findCommit(id),
              priorCreatedAt: (id) => current.core.priorCreatedAt(id),
              readArtifact: async (ref) =>
                (await bridge.readCurrentArtifact(request, ref)).artifact,
              commit: (e) =>
                bridge.execute(request, {
                  contract: 'surfer.source-rows.v1',
                  schemaVersion: '1.0.0',
                  command: e.command,
                  basis: e.basis,
                }),
              read: async (id) => {
                const r = await bridge.readCurrentSnapshot(request, id);
                return r.status === 'CURRENT'
                  ? {
                      status: 'CURRENT',
                      result: {
                        snapshot: r.result.snapshot!,
                        artifacts: r.result.artifacts,
                        isActive: r.result.isActive,
                      },
                      readReceipt: r.readReceipt,
                    }
                  : { status: 'UNAVAILABLE', readReceipt: r.readReceipt };
              },
            }),
          ),
        );
      } finally {
        active = false;
      }
    });
  }
}
