import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import type {
  SurferScopedRuleMemorySessionPort,
  SurferCompletedExperimentPort,
  SurferScopedRuleMemorySession,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  decodeSurferAccessContext,
  type SurferAccessContext,
  type SurferExperimentDatasetPort,
  type SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import type { SurferRepairProposerPort } from '../../../packages/contracts/src/surfer-rule-replacement.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  SURFER_RULE_MEMORY_DOMAIN,
  validateSurferRuleMemoryBinding,
  readSurferRuleReviewViews,
  type SurferReviewedRuleMemoryPayload,
} from '../../../modules/surfer-learning/src/rule-memory-state.js';
import {
  validateSurferReplacementExecution,
  decodeSurferReplacementCommand,
  buildSurferRepairDevelopment,
  validateSurferReplacementPreparation,
  readSurferReplacementSources,
  surferReplacementRequest,
  surferReplacementCandidate,
  assessSurferReplacement,
  validateSurferReplacementMemory,
  type SurferReplacementPreparation,
  type SurferReplacementCommand,
  type SurferReplacementMemoryPayload,
} from '../../../modules/surfer-learning/src/replacement-proof.js';
import { evaluateSurferReplacementFuture } from './replacement-evaluator.js';
const stale = () =>
  new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'Replacement parent or active snapshot changed.',
    module: 'surfer.learning',
    operation: 'replace-rule',
  });
type Options = {
  sessions: SurferScopedRuleMemorySessionPort;
  execution: Pick<SurferExecutionLedger, 'read'>;
  proposer: SurferRepairProposerPort;
  dataset: SurferExperimentDatasetPort;
  experiments: SurferExperimentStorePort & SurferCompletedExperimentPort;
  context: SurferAccessContext;
};
export class SurferRuleReplacementTrial {
  private readonly context;
  constructor(private readonly o: Options) {
    this.context = decodeSurferAccessContext(o.context);
  }
  private async replay(
    s: SurferScopedRuleMemorySession,
    actor: unknown,
    r: SurferReplacementCommand,
  ) {
    const prior = await s.findCommit(r.operationId + ':publish');
    if (!prior) return null;
    const read = await s.read(prior.subjectId);
    if (read.status !== 'CURRENT') throw stale();
    const stored = read.result.artifacts.find((a) => a.artifactId === r.successorId);
    if (!stored) throw stale();
    const m = validateSurferReplacementMemory(stored.payload);
    if (
      surferDigest(m.prepared.input) !== surferDigest(r) ||
      surferDigest(m.prepared.context) !== surferDigest(this.context) ||
      surferDigest(stored.basis) !== surferDigest(m.prepared.parent.knowledgeBasis.coreBasis)
    )
      throw surferFailure('Replacement replay changed meaning.');
    await readSurferReplacementSources(s.source, actor, m.prepared);
    return {
      status: 'PUBLISHED',
      artifact: { artifactId: stored.artifactId, revision: stored.revision, digest: stored.digest },
      snapshotId: read.result.snapshot.snapshotId,
      replayed: true,
      regression: assessSurferReplacement(m.prepared, m.candidate),
      receipt: m.receipt,
      modelCalls: 0,
    } as const;
  }
  async run(actor: unknown, input: unknown, signal?: AbortSignal) {
    const r = decodeSurferReplacementCommand(input),
      o = this.o;
    const replay = await o.sessions.withSession(actor, (s) => this.replay(s, actor, r));
    if (replay) return replay;
    const raw = await o.dataset.describe(this.context);
    assertSurferJson(raw);
    const descriptor = structuredClone(raw);
    const p = await o.sessions.withSession(actor, async (s) => {
      const read = await s.read(r.expectedActiveSnapshotId);
      if (read.status !== 'CURRENT' || !read.result.isActive) throw stale();
      const parent = read.result.artifacts.find(
        (a) =>
          a.artifactId === r.expectedArtifact.artifactId &&
          a.kind === 'RULE' &&
          a.domain === SURFER_RULE_MEMORY_DOMAIN,
      );
      if (
        !parent ||
        surferDigest({
          artifactId: parent.artifactId,
          revision: parent.revision,
          digest: parent.digest,
        }) !== surferDigest(r.expectedArtifact)
      )
        throw stale();
      const payload = validateSurferRuleMemoryBinding(
        parent.payload as unknown as SurferReviewedRuleMemoryPayload,
      );
      if (
        payload.contract !== 'surfer.scoped-rule-memory.v2' ||
        surferDigest(parent.basis) !== surferDigest(payload.knowledgeBasis.coreBasis) ||
        surferDigest(parent.scope) !== surferDigest(payload.proof.candidate.scope)
      )
        throw surferFailure(
          'Only current homogeneous-scope reviewed first-generation rules can be replaced.',
        );
      const reviews = await readSurferRuleReviewViews(s.source, actor, payload),
        training = await s.source.withCurrent(
          actor,
          payload.proof.basis,
          payload.proof.selections,
          (v) => v,
        ),
        development = buildSurferRepairDevelopment(
          payload,
          training,
          reviews,
          descriptor.datasetId,
        ),
        prepared: SurferReplacementPreparation = {
          contract: 'surfer.rule-replacement-preparation.v1',
          input: r,
          parent: payload,
          scope: parent.scope,
          development,
          descriptor,
          context: this.context,
          sourceDigest: surferDigest({
            parent: r.expectedArtifact,
            basis: payload.knowledgeBasis,
            training: training.viewDigest,
            reviews: reviews.map((v) => v.viewDigest),
          }),
        };
      validateSurferReplacementPreparation(prepared);
      const prior = await s.findCommit(r.operationId + ':prepare');
      if (prior) {
        const old = await s.readArtifact({
          artifactId: prior.subjectId,
          revision: prior.revision,
          digest: prior.digest,
        });
        if (surferDigest(old.payload) !== surferDigest(prepared))
          throw surferFailure('Replacement preparation changed meaning.');
        return prepared;
      }
      await s.commit({
        schemaVersion: '2.0.0',
        basis: payload.knowledgeBasis,
        command: {
          action: 'APPEND_ARTIFACT',
          operationId: r.operationId + ':prepare',
          expectedRevision: null,
          draft: {
            schemaVersion: '1.0.0',
            artifactId: 'replacement-prep:' + surferDigest(r.operationId).slice(7),
            revision: 1,
            kind: 'EPISODE',
            origin: 'EXPERIENCE',
            scope: parent.scope,
            domain: 'surfer.rule-replacement-preparation.v1',
            createdAt: training.readReceipt.observedAt,
            observedAt: payload.knowledgeBasis.readWatermark.observedAt,
            producer: { ...parent.producer, engineRevision: 'surfer.rule-replacement.v1' },
            payloadSchema: 'surfer.opaque.v1',
            payload: prepared,
            basis: payload.knowledgeBasis.coreBasis,
          },
        },
      });
      return prepared;
    });
    const rawResult = await o.proposer.propose(surferReplacementRequest(p), signal);
    assertSurferJson(rawResult);
    const result = structuredClone(rawResult);
    if (!result.proposal) return { status: 'EXECUTION_INCOMPLETE', modelCalls: 0 } as const;
    const durable = await o.execution.read(result.execution.reservationId, p.scope.spaceId);
    if (surferDigest(durable) !== surferDigest(result.execution))
      throw surferFailure('Replacement proposer result differs from the durable execution owner.');
    const validated = validateSurferReplacementExecution(p, result.execution);
    if (surferDigest(validated) !== surferDigest(result.proposal))
      throw surferFailure('Replacement proposer disagrees with its checkpoint.');
    if (result.proposal.status !== 'PROPOSED')
      return { status: 'NO_CANDIDATE', reason: result.proposal.reason, modelCalls: 0 } as const;
    const candidate = surferReplacementCandidate(
        p,
        result.proposal,
        result.execution.reservationId,
      ),
      regression = assessSurferReplacement(p, candidate);
    if (!regression.eligible)
      return { status: 'REGRESSION_REJECTED', regression, modelCalls: 0 } as const;
    // Both long-running capabilities stay outside the Source transaction. No future feedback returns to the proposer.
    await o.sessions.withSession(actor, async (s) => {
      await readSurferReplacementSources(s.source, actor, p);
      const read = await s.read(r.expectedActiveSnapshotId);
      if (read.status !== 'CURRENT' || !read.result.isActive) throw stale();
    });
    const receipt = await evaluateSurferReplacementFuture(p, candidate, o.dataset, o.experiments);
    if (receipt.status !== 'SCOPE_VALIDATED')
      return { status: 'FUTURE_REJECTED', regression, receipt, modelCalls: 0 } as const;
    const memory: SurferReplacementMemoryPayload = {
      contract: 'surfer.rule-replacement-memory.v1',
      prepared: p,
      execution: result.execution,
      candidate,
      receipt,
    };
    validateSurferReplacementMemory(memory);
    return o.sessions.withSession(actor, async (s) => {
      const already = await this.replay(s, actor, r);
      if (already) return already;
      const read = await s.read(r.expectedActiveSnapshotId);
      if (read.status !== 'CURRENT' || !read.result.isActive) throw stale();
      const parent = read.result.artifacts.find(
        (a) => a.artifactId === r.expectedArtifact.artifactId,
      );
      if (
        !parent ||
        parent.revision !== r.expectedArtifact.revision ||
        parent.digest !== r.expectedArtifact.digest
      )
        throw stale();
      await readSurferReplacementSources(s.source, actor, p);
      const createdAt =
          (await s.priorCreatedAt(r.operationId + ':successor')) ?? new Date().toISOString(),
        basis = p.parent.knowledgeBasis,
        added = await s.commit({
          schemaVersion: '2.0.0',
          basis,
          command: {
            action: 'APPEND_ARTIFACT',
            operationId: r.operationId + ':successor',
            expectedRevision: null,
            draft: {
              schemaVersion: '1.0.0',
              artifactId: r.successorId,
              revision: 1,
              kind: 'RULE',
              origin: 'INDUCTION',
              scope: p.scope,
              domain: SURFER_RULE_MEMORY_DOMAIN,
              createdAt,
              observedAt: basis.readWatermark.observedAt,
              producer: {
                ...parent.producer,
                engineRevision: 'surfer.rule-replacement.v1',
                modelRevision: candidate.proposer.model,
                executionId: candidate.proposer.executionId,
              },
              payloadSchema: 'surfer.opaque.v1',
              payload: memory,
              basis: basis.coreBasis,
            },
          },
        }),
        artifact: SurferArtifactRef = {
          artifactId: added.commit.subjectId,
          revision: added.commit.revision,
          digest: added.commit.digest,
        };
      await s.commit({
        schemaVersion: '2.0.0',
        basis,
        command: {
          action: 'APPEND_ARTIFACT',
          operationId: r.operationId + ':supersede',
          expectedRevision: parent.revision,
          draft: {
            schemaVersion: '1.0.0',
            artifactId: parent.artifactId,
            revision: parent.revision + 1,
            kind: 'RULE',
            origin: 'INDUCTION',
            scope: parent.scope,
            domain: SURFER_RULE_MEMORY_DOMAIN,
            createdAt,
            observedAt: basis.readWatermark.observedAt,
            producer: { ...parent.producer, engineRevision: 'surfer.rule-replacement.v1' },
            payloadSchema: 'surfer.opaque.v1',
            payload: {
              contract: 'surfer.superseded-rule-memory.v1',
              previous: r.expectedArtifact,
              successor: artifact,
              parent: p.parent,
              knowledgeBasis: basis,
            },
            basis: basis.coreBasis,
          },
        },
      });
      const snapshotId = r.successorId + ':rule-snapshot:1',
        entries = [
          ...read.result.snapshot.entries.filter((e) => e.artifactId !== parent.artifactId),
          artifact,
        ].sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0));
      await s.commit({
        schemaVersion: '2.0.0',
        basis: null,
        command: {
          action: 'PUBLISH_SNAPSHOT',
          operationId: r.operationId + ':publish',
          snapshotId,
          expectedActiveSnapshotId: r.expectedActiveSnapshotId,
          entries,
          engineRevision: 'surfer.rule-replacement.v1',
          createdAt,
        },
      });
      return {
        status: 'PUBLISHED',
        artifact,
        snapshotId,
        replayed: false,
        regression,
        receipt,
        modelCalls: 0,
      } as const;
    });
  }
}
