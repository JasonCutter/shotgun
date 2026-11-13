import type {
  SurferMemoryRefreshDiscoveryPort,
  SurferMemoryRefreshDiscoveryPlan,
} from '../../../packages/contracts/src/surfer-memory-refresh-discovery.js';
import {
  decodeSurferArtifactRef,
  type SurferKnowledgeArtifact,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';

function payload(artifact: SurferKnowledgeArtifact) {
  const p = artifact.payload as {
    contract: string;
    plan: SurferMemoryRefreshDiscoveryPlan;
    planDigest: string;
    basis: unknown;
  };
  if (
    artifact.kind !== 'EPISODE' ||
    artifact.domain !== 'surfer.memory-refresh-discovery.v1' ||
    !p ||
    Object.keys(p).sort().join(',') !== 'basis,contract,plan,planDigest' ||
    p.contract !== 'surfer.memory-refresh-discovery.v1' ||
    !p.plan ||
    p.plan.status !== 'REFRESH_REQUIRED' ||
    surferDigest(p.plan) !== p.planDigest
  )
    throw surferFailure('Invalid refresh discovery artifact.');
  assertSurferSourceBasisV2(p.basis);
  if (surferDigest(p.basis.coreBasis) !== surferDigest(artifact.basis))
    throw surferFailure('Discovery job premises differ from its artifact.');
  return p;
}
/** Persists reconciliation metadata only. A selector resolver is required before model dispatch. */
export class SurferMemoryRefreshDiscoveryService {
  constructor(private readonly sessions: SurferMemoryRefreshDiscoveryPort) {}
  scan(actor: unknown, input: unknown) {
    assertSurferJson(input);
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).sort().join(',') !== 'contract,schemaVersion' ||
      (input as { schemaVersion?: unknown }).schemaVersion !== '1.0.0' ||
      (input as { contract?: unknown }).contract !== 'surfer.memory-refresh-scan.v1'
    )
      throw surferFailure('Invalid refresh scan request.');
    return this.sessions.withDiscoverySession(actor, async (s) => {
      const discovered = await s.discoverActive(),
        { plan, basis, scope } = discovered;
      const planDigest = surferDigest(plan);
      if (plan.status !== 'REFRESH_REQUIRED')
        return { status: plan.status, plan, planDigest, job: null, replayed: false, modelCalls: 0 };
      if (!basis || !scope) throw surferFailure('Refresh candidates lack current Source premises.');
      const artifactId = 'refresh-job:' + planDigest.slice(7),
        operationId = 'refresh-job:' + planDigest.slice(7);
      const prior = await s.findCommit(operationId);
      if (prior) {
        if (prior.subjectKind !== 'ARTIFACT')
          throw surferFailure('Discovery replay is not an artifact.');
        const ref = { artifactId: prior.subjectId, revision: prior.revision, digest: prior.digest };
        const stored = payload(await s.readArtifact(ref));
        if (stored.planDigest !== planDigest)
          throw surferFailure('Discovery replay intent differs.');
        return { status: plan.status, plan, planDigest, job: ref, replayed: true, modelCalls: 0 };
      }
      const result = await s.commit({
        schemaVersion: '2.0.0',
        basis,
        command: {
          action: 'APPEND_ARTIFACT',
          operationId,
          expectedRevision: null,
          draft: {
            schemaVersion: '1.0.0',
            artifactId,
            revision: 1,
            kind: 'EPISODE',
            origin: 'EXPERIENCE',
            scope,
            domain: 'surfer.memory-refresh-discovery.v1',
            createdAt: basis.readWatermark.observedAt,
            observedAt: basis.readWatermark.observedAt,
            producer: {
              engineRevision: 'surfer.memory-refresh-discovery.v1',
              modelRevision: 'NONE_METADATA_ONLY',
              policyRevision: basis.authority.policyRevision,
              executionId: planDigest,
            },
            payloadSchema: 'surfer.opaque.v1',
            payload: { contract: 'surfer.memory-refresh-discovery.v1', planDigest, plan, basis },
            basis: basis.coreBasis,
          },
        },
      });
      return {
        status: plan.status,
        plan,
        planDigest,
        job: {
          artifactId: result.commit.subjectId,
          revision: result.commit.revision,
          digest: result.commit.digest,
        },
        replayed: result.replayed,
        modelCalls: 0,
      };
    });
  }
  async load(actor: unknown, input: unknown) {
    const ref = decodeSurferArtifactRef(input);
    try {
      return await this.sessions.withDiscoverySession(actor, async (s) => {
        const stored = payload(await s.readArtifact(ref));
        const current = await s.discoverActive();
        if (
          current.plan.status !== 'REFRESH_REQUIRED' ||
          surferDigest(current.plan) !== stored.planDigest
        )
          return { status: 'SUPERSEDED' as const, job: null, modelCalls: 0 };
        return {
          status: 'CURRENT' as const,
          job: ref,
          plan: stored.plan,
          planDigest: stored.planDigest,
          requires: 'CURRENT_SOURCE_SELECTION_AND_IMMUTABLE_TASK' as const,
          modelCalls: 0,
        };
      });
    } catch (error) {
      if (error instanceof ShotgunError && ['STALE_VERSION', 'POLICY_DENIED'].includes(error.code))
        return { status: 'UNAVAILABLE' as const, job: null, modelCalls: 0 };
      throw error;
    }
  }
}
