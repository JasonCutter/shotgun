import {
  decodeSurferAccessContext,
  type SurferAccessContext,
  type SurferExperimentDatasetPort,
  type SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import type {
  SurferScopedRuleMemorySessionPort,
  SurferScopedRuleMemorySession,
  SurferCompletedExperimentPort,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import type { SurferContinuationProposerPort } from '../../../packages/contracts/src/surfer-rule-continuation.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  chainStale,
  artifactRef,
  appendChainCapsule,
} from '../../../modules/surfer-learning/src/rule-chain-review.js';
import {
  CHAIN_DOMAIN,
  CHAIN_QUALIFICATION,
  chainRefs,
  readSurferChainState,
  decodeChainCommand,
  chainSourceDigest,
  chainDevelopment,
  validateChainPlan,
  chainRequest,
  chainCandidate,
  chainAssessment,
  validateChainExecution,
  validateChainQualification,
  type ChainCommand,
  type ChainPlan,
  type ChainQualification,
  type ChainManifest,
} from '../../../modules/surfer-learning/src/rule-chain-state.js';
import { evaluateSurferChainFuture } from './chain-evaluator.js';
type Options = {
  sessions: SurferScopedRuleMemorySessionPort;
  context: SurferAccessContext;
  execution: Pick<SurferExecutionLedger, 'read'>;
  proposer: SurferContinuationProposerPort;
  dataset: SurferExperimentDatasetPort;
  experiments: SurferExperimentStorePort & SurferCompletedExperimentPort;
};
export class SurferRuleChainTrial {
  private readonly context;
  constructor(private readonly o: Options) {
    this.context = decodeSurferAccessContext(o.context);
  }
  private async replay(s: SurferScopedRuleMemorySession, actor: unknown, r: ChainCommand) {
    const prior = await s.findCommit(r.operationId + ':publish');
    if (!prior) return null;
    const read = await s.read(prior.subjectId);
    if (read.status !== 'CURRENT') throw chainStale();
    const stored = read.result.artifacts.find((a) => a.artifactId === r.successorId);
    if (!stored) throw chainStale();
    const state = await readSurferChainState(s, actor, stored),
      last = state.qualifications.at(-1);
    if (
      !last ||
      surferDigest(last.plan.input) !== surferDigest(r) ||
      surferDigest(last.plan.context) !== surferDigest(this.context)
    )
      throw surferFailure('Chain replay changed meaning.');
    return {
      status: 'PUBLISHED',
      artifact: artifactRef(stored),
      snapshotId: read.result.snapshot.snapshotId,
      generation: state.generation,
      regression: chainAssessment(state.candidate, state.cases),
      receipt: last.receipt,
      replayed: true,
      modelCalls: 0,
    } as const;
  }
  async run(actor: unknown, input: unknown, signal?: AbortSignal) {
    const r = decodeChainCommand(input),
      o = this.o,
      replay = await o.sessions.withSession(actor, async (s) => {
        const replay = await this.replay(s, actor, r);
        if (replay) return replay;
        const read = await s.read(r.expectedActiveSnapshotId);
        if (read.status !== 'CURRENT' || !read.result.isActive) throw chainStale();
        const parent = read.result.artifacts.find(
          (a) => a.artifactId === r.expectedArtifact.artifactId,
        );
        if (!parent || surferDigest(artifactRef(parent)) !== surferDigest(r.expectedArtifact))
          throw chainStale();
        const state = await readSurferChainState(s, actor, parent);
        if (!state.manifest)
          throw surferFailure(
            'A successor must have a current Source review before requalification.',
          );
        if (state.generation >= 3)
          throw surferFailure('Bounded chain generation capacity reached;history is retained.');
        return null;
      });
    if (replay) return replay;
    const raw = await o.dataset.describe(this.context);
    assertSurferJson(raw);
    const descriptor = structuredClone(raw);
    const prepared = await o.sessions.withSession(actor, async (s) => {
      const read = await s.read(r.expectedActiveSnapshotId);
      if (read.status !== 'CURRENT' || !read.result.isActive) throw chainStale();
      const parent = read.result.artifacts.find(
        (a) => a.artifactId === r.expectedArtifact.artifactId,
      );
      if (!parent || surferDigest(artifactRef(parent)) !== surferDigest(r.expectedArtifact))
        throw chainStale();
      const state = await readSurferChainState(s, actor, parent),
        m = state.manifest;
      if (!m) throw surferFailure('Chain review manifest missing.');
      const cases = chainDevelopment(
          state.baseline,
          state.observations,
          state.views,
          descriptor.datasetId,
        ).cases,
        refs = {
          baseline: m.baseline,
          observations: m.observations,
          qualifications: m.qualifications,
        },
        plan: ChainPlan = {
          contract: 'surfer.chain-plan.v1',
          input: r,
          generation: state.generation + 1,
          ...refs,
          descriptor,
          context: this.context,
          lineageDigest: surferDigest(refs),
          sourceDigest: chainSourceDigest(m, state.views),
          supportDigest: surferDigest(cases),
          priorFutureDigest: surferDigest(state.history),
        };
      validateChainPlan(plan, state);
      const prior = await s.findCommit(r.operationId + ':prepare');
      if (prior) {
        const a = await s.readArtifact({
          artifactId: prior.subjectId,
          revision: prior.revision,
          digest: prior.digest,
        });
        if (surferDigest(a.payload) !== surferDigest(plan))
          throw surferFailure('Chain preparation changed meaning.');
      } else
        await appendChainCapsule(
          s,
          r.operationId + ':prepare',
          'chain-plan:' + surferDigest(r.operationId).slice(7),
          'surfer.chain-preparation.v1',
          plan,
          m.knowledgeBasis,
          parent.scope,
          parent.producer,
          new Date().toISOString(),
        );
      return { plan, state, cases };
    });
    const { plan, state, cases } = prepared,
      request = chainRequest(plan, cases),
      rawResult = await o.proposer.propose(request, signal);
    assertSurferJson(rawResult);
    const result = structuredClone(rawResult);
    if (!result.proposal) return { status: 'EXECUTION_INCOMPLETE', modelCalls: 0 } as const;
    const durable = await o.execution.read(result.execution.reservationId, request.spaceId);
    if (surferDigest(durable) !== surferDigest(result.execution))
      throw surferFailure('Chain result differs from durable execution owner.');
    const proposal = validateChainExecution(plan, cases, result.execution);
    if (surferDigest(proposal) !== surferDigest(result.proposal))
      throw surferFailure('Chain checkpoint differs.');
    if (proposal.status !== 'PROPOSED')
      return { status: 'NO_CANDIDATE', reason: proposal.reason, modelCalls: 0 } as const;
    const candidate = chainCandidate(plan, proposal, result.execution.reservationId, cases),
      regression = chainAssessment(candidate, cases);
    if (!regression.eligible)
      return { status: 'REGRESSION_REJECTED', regression, modelCalls: 0 } as const;
    await o.sessions.withSession(actor, async (s) => {
      const read = await s.read(r.expectedActiveSnapshotId);
      if (read.status !== 'CURRENT' || !read.result.isActive) throw chainStale();
      const parent = read.result.artifacts.find(
        (a) => a.artifactId === r.expectedArtifact.artifactId,
      );
      if (!parent || surferDigest(artifactRef(parent)) !== surferDigest(r.expectedArtifact))
        throw chainStale();
      validateChainPlan(plan, await readSurferChainState(s, actor, parent));
    });
    const receipt = await evaluateSurferChainFuture(
      plan,
      state,
      cases,
      candidate,
      o.dataset,
      o.experiments,
    );
    if (receipt.status !== 'SCOPE_VALIDATED')
      return { status: 'FUTURE_REJECTED', regression, receipt, modelCalls: 0 } as const;
    const qualification: ChainQualification = {
      contract: CHAIN_QUALIFICATION,
      plan,
      request,
      execution: result.execution,
      candidate,
      receipt,
    };
    validateChainQualification(qualification, state);
    return o.sessions.withSession(actor, async (s) => {
      const replay = await this.replay(s, actor, r);
      if (replay) return replay;
      const read = await s.read(r.expectedActiveSnapshotId);
      if (read.status !== 'CURRENT' || !read.result.isActive) throw chainStale();
      const parent = read.result.artifacts.find(
        (a) => a.artifactId === r.expectedArtifact.artifactId,
      );
      if (!parent || surferDigest(artifactRef(parent)) !== surferDigest(r.expectedArtifact))
        throw chainStale();
      const current = await readSurferChainState(s, actor, parent);
      validateChainPlan(plan, current);
      const m = current.manifest!;
      const createdAt = new Date().toISOString(),
        qRef = await appendChainCapsule(
          s,
          r.operationId + ':qualification',
          'chain-qualified:' + surferDigest(r.operationId).slice(7),
          CHAIN_QUALIFICATION,
          qualification,
          m.knowledgeBasis,
          parent.scope,
          parent.producer,
          createdAt,
        ),
        refs = {
          baseline: m.baseline,
          observations: m.observations,
          qualifications: [...m.qualifications, qRef],
        },
        sourceIds = m.knowledgeBasis.sources.map((x) => x.sourceId).sort(),
        captured = await s.captureChain({
          schemaVersion: '2.0.0',
          sourceIds,
          artifacts: chainRefs(refs),
          queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds }],
        }),
        manifest: ChainManifest = {
          contract: 'surfer.rule-chain-memory.v1',
          ...refs,
          generation: plan.generation,
          state: 'ACTIVE',
          previous: r.expectedArtifact,
          transition: 'QUALIFIED',
          knowledgeBasis: captured.basis,
        },
        appended = await s.commit({
          schemaVersion: '2.0.0',
          basis: captured.basis,
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
              scope: captured.knowledgeScope,
              domain: CHAIN_DOMAIN,
              createdAt,
              observedAt: captured.basis.readWatermark.observedAt,
              producer: {
                ...parent.producer,
                engineRevision: 'surfer.rule-chain.v1',
                modelRevision: candidate.proposer.model,
                executionId: candidate.proposer.executionId,
              },
              payloadSchema: 'surfer.opaque.v1',
              payload: manifest,
              basis: captured.basis.coreBasis,
            },
          },
        }),
        artifact = {
          artifactId: appended.commit.subjectId,
          revision: appended.commit.revision,
          digest: appended.commit.digest,
        };
      await s.commit({
        schemaVersion: '2.0.0',
        basis: m.knowledgeBasis,
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
            domain: CHAIN_DOMAIN,
            createdAt,
            observedAt: m.knowledgeBasis.readWatermark.observedAt,
            producer: { ...parent.producer, engineRevision: 'surfer.rule-chain.v1' },
            payloadSchema: 'surfer.opaque.v1',
            payload: {
              contract: 'surfer.superseded-rule-memory.v1',
              previous: r.expectedArtifact,
              successor: artifact,
              chain: m,
            },
            basis: m.knowledgeBasis.coreBasis,
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
          engineRevision: 'surfer.rule-chain.v1',
          createdAt,
        },
      });
      return {
        status: 'PUBLISHED',
        artifact,
        snapshotId,
        generation: plan.generation,
        regression,
        receipt,
        replayed: false,
        modelCalls: 0,
      } as const;
    });
  }
}
