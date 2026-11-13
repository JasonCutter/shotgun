import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type {
  SurferDirectiveMemorySessionPort,
  SurferDirectiveScenarioEvaluationPort,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  SurferDirectiveMemoryService,
  type SurferRememberDirectiveRequest,
} from './directive-memory.js';
function stale(): never {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'The memory collection is no longer current.',
    module: 'surfer.core',
    operation: 'remember-collection',
  });
}
/** Retains a bounded current memory collection in the same Source/knowledge transaction as append/publication. */
export class SurferDirectiveMemoryCollectionService {
  constructor(
    private readonly sessions: SurferDirectiveMemorySessionPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  async remember(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as SurferRememberDirectiveRequest;
    if (
      !r ||
      Object.keys(r).sort().join(',') !==
        'basis,contract,expectedActiveSnapshotId,expectedRevision,memoryId,operationId,packet,schemaVersion,selections' ||
      typeof r.memoryId !== 'string' ||
      !r.memoryId.length ||
      r.memoryId.length > 96 ||
      typeof r.operationId !== 'string' ||
      !r.operationId.length ||
      r.operationId.length > 112 ||
      (r.expectedActiveSnapshotId !== null &&
        (typeof r.expectedActiveSnapshotId !== 'string' ||
          !r.expectedActiveSnapshotId.length ||
          r.expectedActiveSnapshotId.length > 256))
    )
      throw surferFailure('Invalid bounded collection memory command.');
    return this.sessions.withSession(actor, async (s) => {
      const prior = await s.findCommit(r.operationId + ':collection');
      let retained: SurferArtifactRef[] = [];
      const selected = prior?.subjectId ?? r.expectedActiveSnapshotId;
      if (prior && prior.subjectKind !== 'SNAPSHOT')
        throw surferFailure('Collection replay command has an invalid subject.');
      if (selected) {
        const read = await s.read(selected);
        if (read.status !== 'CURRENT' || (!prior && !read.result.isActive)) return stale();
        retained = read.result.snapshot.entries.map((entry) => {
          const a = read.result.artifacts.find(
            (a) =>
              a.artifactId === entry.artifactId &&
              a.revision === entry.revision &&
              a.digest === entry.digest,
          );
          if (!a || a.kind !== 'INTERPRETATION' || a.domain !== 'surfer.directive-memory.v1')
            throw surferFailure(
              'A memory collection cannot silently drop or import unrelated artifacts.',
            );
          return { ...entry };
        });
      }
      const single = await new SurferDirectiveMemoryService(
        { withSession: (_a, apply) => apply(s) },
        this.scenarios,
      ).remember(actor, r);
      const entries = [
        ...retained.filter((e) => e.artifactId !== single.artifact.artifactId),
        single.artifact,
      ].sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0));
      if (entries.length > 16)
        throw surferFailure('Memory collection exceeds the current 16-entry query profile.');
      const createdAt = await s.priorCreatedAt(r.operationId + ':append');
      if (!createdAt) throw surferFailure('Appended memory has no durable creation receipt.');
      const snapshotId = r.memoryId + ':collection:' + single.artifact.revision;
      const published = await s.commit({
        schemaVersion: '2.0.0',
        basis: null,
        command: {
          action: 'PUBLISH_SNAPSHOT',
          operationId: r.operationId + ':collection',
          snapshotId,
          expectedActiveSnapshotId: single.snapshotId,
          entries,
          engineRevision: 'surfer.directive-memory-collection.v1',
          createdAt,
        },
      });
      if (prior && surferDigest(prior) !== surferDigest(published.commit))
        throw surferFailure('Collection replay changed its original commit.');
      return {
        ...single,
        snapshotId,
        snapshotDigest: published.commit.digest,
        replayed: single.replayed && published.replayed,
        memoryCount: entries.length,
      };
    });
  }
}
