import { readSurferKnowledgeState } from '../../../packages/contracts/src/surfer-knowledge.js';
import { readSurferBindingStateV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferSourceSessionPortV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type {
  SurferDirectiveMemorySessionPort,
  SurferDirectiveMemorySession,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunSurferSourceBridgeV2 } from './v2.js';
import { ShotgunSurferCognitiveSource } from './cognition.js';
import { SurferKnowledgeService } from '../../../modules/surfer-core/src/index.js';
/** Reuses all existing Source/binding/knowledge operations inside one caller-owned MVCC transaction. */
export class ShotgunSurferDirectiveMemorySession implements SurferDirectiveMemorySessionPort {
  constructor(private readonly sessions: SurferSourceSessionPortV2) {}
  async withSession<T>(
    actor: unknown,
    apply: (session: SurferDirectiveMemorySession) => Promise<T>,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withSnapshotV2(request, async (session) => {
      let active = true;
      const bound: SurferSourceSessionPortV2 = {
        withSnapshotV2: async (r, action) => {
          if (!active || surferDigest(decodeSurferSourceRequest(r)) !== surferDigest(request))
            throw surferFailure('Memory session escaped its Source actor/transaction.');
          return action(session);
        },
      };
      const bridge = new ShotgunSurferSourceBridgeV2(bound),
        source = new ShotgunSurferCognitiveSource(bridge);
      try {
        return structuredClone(
          await apply({
            source,
            capture: (input) => bridge.capture(request, input),
            readArtifact: async (ref) => {
              await bridge.capture(request, {
                schemaVersion: '2.0.0',
                sourceIds: [],
                artifacts: [ref],
                queries: [],
              });
              return (
                await new SurferKnowledgeService(session.store).readArtifact(
                  ref,
                  'CURRENT',
                  session.snapshot.context,
                )
              ).artifact;
            },
            findCommit: async (operationId) => {
              if (!active) throw surferFailure('Memory session escaped its Source transaction.');
              await readSurferBindingStateV2(
                session.bindingStore,
                session.snapshot.context.spaceId,
                () => null,
              );
              return readSurferKnowledgeState(
                session.store,
                session.snapshot.context.spaceId,
                (st) => st.commands.find((c) => c.operationId === operationId)?.commit ?? null,
              );
            },
            priorCreatedAt: async (operationId) => {
              if (!active) throw surferFailure('Memory session escaped its Source transaction.');
              // Match the existing bridge lock order: binding owner before knowledge owner.
              await readSurferBindingStateV2(
                session.bindingStore,
                session.snapshot.context.spaceId,
                () => null,
              );
              return readSurferKnowledgeState(
                session.store,
                session.snapshot.context.spaceId,
                (state) => {
                  const prior = state.commands.find(
                    (c) => c.operationId === operationId && c.commit.subjectKind === 'ARTIFACT',
                  );
                  return prior
                    ? (state.artifacts.find(
                        (a) =>
                          a.artifactId === prior.commit.subjectId &&
                          a.revision === prior.commit.revision &&
                          a.digest === prior.commit.digest,
                      )?.createdAt ?? null)
                    : null;
                },
              );
            },
            commit: (e) => bridge.execute(request, e),
            read: (id) => bridge.readCurrentSnapshot(request, id),
          }),
        );
      } finally {
        active = false;
      }
    });
  }
}
