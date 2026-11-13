import type {
  SurferMemoryBatchRefreshIntent,
  SurferMemoryBatchRefreshRequest,
  SurferMemoryBatchRefreshSession,
  SurferMemoryBatchRefreshSessionPort,
  SurferMemoryBatchReplacementPlan,
} from '../../../packages/contracts/src/surfer-memory-batch-refresh.js';
import type { SurferDirectiveScenarioEvaluationPort } from '../../../packages/contracts/src/surfer-directive-memory.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import { decodeSurferObservationSelections } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { SurferDirectiveMemoryService } from './directive-memory.js';

function parse(input: unknown, packet: boolean) {
  assertSurferJson(input);
  const r = structuredClone(input) as SurferMemoryBatchRefreshRequest;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      'contract,expectedActiveSnapshotId,operationId,schemaVersion,targets' ||
    r.schemaVersion !== '1.0.0' ||
    r.contract !== 'surfer.memory-batch-refresh.v1' ||
    typeof r.operationId !== 'string' ||
    !r.operationId.length ||
    r.operationId.length > 80 ||
    typeof r.expectedActiveSnapshotId !== 'string' ||
    !r.expectedActiveSnapshotId.length ||
    r.expectedActiveSnapshotId.length > 256 ||
    !Array.isArray(r.targets) ||
    r.targets.length < 2 ||
    r.targets.length > 8
  )
    throw surferFailure('Invalid bounded memory batch refresh.');
  for (const t of r.targets) {
    if (
      !t ||
      Object.keys(t).sort().join(',') !==
        (packet ? 'basis,packet,replaces,selections' : 'basis,replaces,selections')
    )
      throw surferFailure('Invalid batch target.');
    t.replaces = decodeSurferArtifactRef(t.replaces);
    if (t.replaces.artifactId.length > 96) throw surferFailure('Batch memory ID is too long.');
    assertSurferSourceBasisV2(t.basis);
    t.selections = decodeSurferObservationSelections({
      schemaVersion: '1.0.0',
      selections: t.selections,
    }).selections;
    if (
      t.basis.sources.length !== 1 ||
      !t.selections.length ||
      t.selections.length > 8 ||
      t.selections.some((v) => v.sourceId !== t.basis.sources[0]!.sourceId)
    )
      throw surferFailure('Each batch target requires one direct Source.');
  }
  if (new Set(r.targets.map((t) => t.replaces.artifactId)).size !== r.targets.length)
    throw surferFailure('Duplicate memory batch target.');
  r.targets.sort((a, b) =>
    a.replaces.artifactId < b.replaces.artifactId
      ? -1
      : a.replaces.artifactId > b.replaces.artifactId
        ? 1
        : 0,
  );
  return r;
}
function intent(r: SurferMemoryBatchRefreshRequest): SurferMemoryBatchRefreshIntent {
  return {
    ...r,
    targets: r.targets.map(({ replaces, basis, selections }) => ({ replaces, basis, selections })),
  };
}
/** All new packets publish together; model execution belongs outside this transaction. */
export class SurferDirectiveMemoryBatchRefreshService {
  constructor(
    private readonly sessions: SurferMemoryBatchRefreshSessionPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  private async plan(
    s: SurferMemoryBatchRefreshSession,
    actor: unknown,
    r: SurferMemoryBatchRefreshIntent,
  ) {
    for (const t of r.targets) await s.source.withCurrent(actor, t.basis, t.selections, () => null);
    const tag = 'surfer.memory-batch-refresh.v1:' + surferDigest(r),
      prior = await s.findCommit(r.operationId + ':batch');
    if (prior) {
      if (prior.subjectKind !== 'SNAPSHOT') throw surferFailure('Batch replay is not a snapshot.');
      const read = await s.read(prior.subjectId);
      if (read.status !== 'CURRENT' || read.result.snapshot.engineRevision !== tag)
        throw surferFailure('Batch replay intent or premises changed.');
      for (const t of r.targets) {
        const next = read.result.snapshot.entries.find(
          (e) => e.artifactId === t.replaces.artifactId,
        );
        if (!next || next.revision !== t.replaces.revision + 1)
          throw surferFailure('Batch replay target changed.');
      }
      const plan: SurferMemoryBatchReplacementPlan = {
        snapshotId: read.result.snapshot.snapshotId,
        snapshotDigest: read.result.snapshot.digest,
        targets: r.targets.map((t) => t.replaces),
        retained: read.result.snapshot.entries.filter(
          (e) => !r.targets.some((t) => t.replaces.artifactId === e.artifactId),
        ),
        sourceIds: [...new Set(r.targets.map((t) => t.basis.sources[0]!.sourceId))].sort(),
      };
      return { plan, tag, replayed: true };
    }
    return {
      plan: await s.planReplacements({
        snapshotId: r.expectedActiveSnapshotId,
        targets: r.targets,
      }),
      tag,
      replayed: false,
    };
  }
  inspect(actor: unknown, input: unknown) {
    const r = intent(parse(input, false));
    return this.sessions.withBatchRefreshSession(actor, async (s) => {
      const { plan, replayed } = await this.plan(s, actor, r);
      return { ...plan, intentDigest: surferDigest(r), replayed };
    });
  }
  refresh(actor: unknown, input: unknown) {
    const r = parse(input, true),
      i = intent(r);
    return this.sessions.withBatchRefreshSession(actor, async (s) => {
      const { plan, tag } = await this.plan(s, actor, i);
      const owner = new SurferDirectiveMemoryService(
        { withSession: (_a, apply) => apply(s) },
        this.scenarios,
      );
      let activeSnapshot = r.expectedActiveSnapshotId,
        replayed = true;
      const artifacts = [];
      for (const [index, t] of r.targets.entries()) {
        const single = await owner.remember(actor, {
          schemaVersion: '1.0.0',
          contract: 'surfer.directive-memory.v1',
          operationId: r.operationId + ':item:' + index,
          memoryId: t.replaces.artifactId,
          expectedRevision: t.replaces.revision,
          expectedActiveSnapshotId: activeSnapshot,
          basis: t.basis,
          selections: t.selections,
          packet: t.packet,
        });
        artifacts.push(single.artifact);
        activeSnapshot = single.snapshotId;
        replayed &&= single.replayed;
      }
      const entries = [...plan.retained, ...artifacts].sort((a, b) =>
        a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0,
      );
      const createdAt = await s.priorCreatedAt(r.operationId + ':item:0:append');
      if (!createdAt) throw surferFailure('Batch append receipt is unavailable.');
      const snapshotId = 'batch-refresh:' + surferDigest(i).slice(7);
      const published = await s.commit({
        schemaVersion: '2.0.0',
        basis: null,
        command: {
          action: 'PUBLISH_SNAPSHOT',
          operationId: r.operationId + ':batch',
          snapshotId,
          expectedActiveSnapshotId: activeSnapshot,
          entries,
          engineRevision: tag,
          createdAt,
        },
      });
      return {
        schemaVersion: '1.0.0' as const,
        artifacts,
        snapshotId,
        snapshotDigest: published.commit.digest,
        replayed: replayed && published.replayed,
        memoryCount: entries.length,
        replaced: i.targets.map((t) => t.replaces),
        intentDigest: surferDigest(i),
        semanticAssessment: 'NOT_EVALUATED' as const,
        modelCalls: 0,
      };
    });
  }
}
