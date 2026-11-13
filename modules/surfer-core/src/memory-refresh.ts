import type {
  SurferMemoryRefreshIntent,
  SurferMemoryRefreshRequest,
  SurferMemoryRefreshSession,
  SurferMemoryRefreshSessionPort,
  SurferMemoryReplacementPlan,
} from '../../../packages/contracts/src/surfer-memory-refresh.js';
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
  const r = structuredClone(input) as SurferMemoryRefreshRequest;
  const keys =
    'basis,contract,expectedActiveSnapshotId,operationId,' +
    (packet ? 'packet,' : '') +
    'replaces,schemaVersion,selections';
  if (
    !r ||
    Object.keys(r).sort().join(',') !== keys ||
    r.schemaVersion !== '1.0.0' ||
    r.contract !== 'surfer.memory-refresh.v1' ||
    typeof r.operationId !== 'string' ||
    !r.operationId.length ||
    r.operationId.length > 112 ||
    typeof r.expectedActiveSnapshotId !== 'string' ||
    !r.expectedActiveSnapshotId.length ||
    r.expectedActiveSnapshotId.length > 256
  )
    throw surferFailure('Invalid memory refresh request.');
  r.replaces = decodeSurferArtifactRef(r.replaces);
  if (r.replaces.artifactId.length > 96)
    throw surferFailure('Refresh memory ID exceeds its bounded profile.');
  assertSurferSourceBasisV2(r.basis);
  r.selections = decodeSurferObservationSelections({
    schemaVersion: '1.0.0',
    selections: r.selections,
  }).selections;
  if (
    r.basis.sources.length !== 1 ||
    !r.selections.length ||
    r.selections.length > 8 ||
    r.selections.some((v) => v.sourceId !== r.basis.sources[0]!.sourceId)
  )
    throw surferFailure('Refresh requires selections from exactly one direct Source.');
  return r;
}
function intent(
  r: SurferMemoryRefreshRequest | SurferMemoryRefreshIntent,
): SurferMemoryRefreshIntent {
  return {
    schemaVersion: r.schemaVersion,
    contract: r.contract,
    operationId: r.operationId,
    expectedActiveSnapshotId: r.expectedActiveSnapshotId,
    replaces: r.replaces,
    basis: r.basis,
    selections: r.selections,
  };
}
/** A narrowly scoped replacement: historical metadata never supplies an answer or model input. */
export class SurferDirectiveMemoryRefreshService {
  constructor(
    private readonly sessions: SurferMemoryRefreshSessionPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  private async plan(s: SurferMemoryRefreshSession, actor: unknown, r: SurferMemoryRefreshIntent) {
    await s.source.withCurrent(actor, r.basis, r.selections, () => null);
    const tag = 'surfer.memory-refresh.v1:' + surferDigest(r),
      prior = await s.findCommit(r.operationId + ':refresh');
    if (prior) {
      if (prior.subjectKind !== 'SNAPSHOT')
        throw surferFailure('Refresh replay points to a non-snapshot command.');
      const read = await s.read(prior.subjectId);
      if (read.status !== 'CURRENT' || read.result.snapshot.engineRevision !== tag)
        throw surferFailure('Refresh replay intent or current premises changed.');
      const next = read.result.snapshot.entries.find((e) => e.artifactId === r.replaces.artifactId);
      if (!next || next.revision !== r.replaces.revision + 1)
        throw surferFailure('Refresh replay target revision changed.');
      const plan: SurferMemoryReplacementPlan = {
        snapshotId: read.result.snapshot.snapshotId,
        snapshotDigest: read.result.snapshot.digest,
        target: r.replaces,
        retained: read.result.snapshot.entries
          .filter((e) => e.artifactId !== r.replaces.artifactId)
          .map((e) => ({ ...e })),
        sourceId: r.basis.sources[0]!.sourceId,
      };
      return { plan, tag, replayed: true };
    }
    return {
      plan: await s.planReplacement({
        snapshotId: r.expectedActiveSnapshotId,
        target: r.replaces,
        basis: r.basis,
      }),
      tag,
      replayed: false,
    };
  }
  inspect(actor: unknown, input: unknown) {
    const r = intent(parse(input, false));
    return this.sessions.withRefreshSession(actor, async (s) => {
      const result = await this.plan(s, actor, r);
      return { ...result.plan, intentDigest: surferDigest(r), replayed: result.replayed };
    });
  }
  refresh(actor: unknown, input: unknown) {
    const r = parse(input, true),
      i = intent(r);
    return this.sessions.withRefreshSession(actor, async (s) => {
      const { plan, tag } = await this.plan(s, actor, i);
      const single = await new SurferDirectiveMemoryService(
        { withSession: (_a, apply) => apply(s) },
        this.scenarios,
      ).remember(actor, {
        schemaVersion: '1.0.0',
        contract: 'surfer.directive-memory.v1',
        operationId: r.operationId,
        memoryId: r.replaces.artifactId,
        expectedRevision: r.replaces.revision,
        expectedActiveSnapshotId: r.expectedActiveSnapshotId,
        basis: r.basis,
        selections: r.selections,
        packet: r.packet,
      });
      const entries = [...plan.retained, single.artifact].sort((a, b) =>
        a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0,
      );
      const createdAt = await s.priorCreatedAt(r.operationId + ':append');
      if (!createdAt) throw surferFailure('Refresh append receipt is unavailable.');
      const snapshotId = r.replaces.artifactId + ':refresh:' + single.artifact.revision;
      const published = await s.commit({
        schemaVersion: '2.0.0',
        basis: null,
        command: {
          action: 'PUBLISH_SNAPSHOT',
          operationId: r.operationId + ':refresh',
          snapshotId,
          expectedActiveSnapshotId: single.snapshotId,
          entries,
          engineRevision: tag,
          createdAt,
        },
      });
      return {
        ...single,
        snapshotId,
        snapshotDigest: published.commit.digest,
        replayed: single.replayed && published.replayed,
        memoryCount: entries.length,
        replaced: r.replaces,
        intentDigest: surferDigest(i),
      };
    });
  }
}
