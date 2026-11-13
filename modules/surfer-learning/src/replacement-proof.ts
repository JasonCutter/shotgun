import {
  assertSurferJson,
  decodeSurferLearningCase,
  decodeSurferRuleCandidate,
  surferDigest,
  surferFailure,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import type {
  SurferDatasetDescriptor,
  SurferAccessContext,
  SurferExperimentReceipt,
  SurferExperimentSpec,
} from '../../../packages/contracts/src/surfer-experiment.js';
import { decodeSurferAccessContext } from '../../../packages/contracts/src/surfer-experiment.js';
import type {
  SurferCognitiveView,
  SurferCognitiveSourcePort,
} from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferExecutionRecord } from '../../../packages/contracts/src/surfer-execution.js';
import {
  decodeSurferRepairDevelopment,
  decodeSurferRepairRequest,
  decodeSurferRepairProposal,
  type SurferRepairDevelopment,
  type SurferRepairRequest,
  type SurferRepairProposal,
} from '../../../packages/contracts/src/surfer-rule-replacement.js';
import {
  validateSurferRuleMemoryBinding,
  readSurferRuleReviewViews,
  type SurferReviewedRuleMemoryPayload,
} from './rule-memory-state.js';
import { validateSurferScopedRuleProof } from './scoped-rule-proof.js';
import { applySurferObservedRule } from './scoped-rule-application.js';
export type SurferReplacementCommand = {
  schemaVersion: '1.0.0';
  contract: 'surfer.rule-replacement.v1';
  runId: string;
  operationId: string;
  expectedArtifact: SurferArtifactRef;
  expectedActiveSnapshotId: string;
  successorId: string;
};
export type SurferReplacementPreparation = {
  contract: 'surfer.rule-replacement-preparation.v1';
  input: SurferReplacementCommand;
  parent: SurferReviewedRuleMemoryPayload;
  scope: SurferScope;
  development: SurferRepairDevelopment;
  descriptor: SurferDatasetDescriptor;
  context: SurferAccessContext;
  sourceDigest: string;
};
export type SurferSupportedFutureReceipt = SurferExperimentReceipt & {
  applicationSupport: {
    contract: 'surfer.observed-support-gate.v1';
    supportDigest: string;
    candidateDigest: string;
    futureDigest: string;
    inputs: { caseId: string; featuresDigest: string }[];
    supported: number;
  };
};
export type SurferReplacementMemoryPayload = {
  contract: 'surfer.rule-replacement-memory.v1';
  prepared: SurferReplacementPreparation;
  execution: SurferExecutionRecord;
  candidate: ReturnType<typeof surferReplacementCandidate>;
  receipt: SurferSupportedFutureReceipt;
};
const exact = (v: object, keys: string) => Object.keys(v).sort().join(',') === keys;
export function decodeSurferReplacementCommand(input: unknown): SurferReplacementCommand {
  assertSurferJson(input);
  const r = structuredClone(input) as SurferReplacementCommand;
  if (
    !r ||
    !exact(
      r,
      'contract,expectedActiveSnapshotId,expectedArtifact,operationId,runId,schemaVersion,successorId',
    ) ||
    r.schemaVersion !== '1.0.0' ||
    r.contract !== 'surfer.rule-replacement.v1' ||
    typeof r.runId !== 'string' ||
    !/^[A-Za-z0-9-]{1,40}$/.test(r.runId) ||
    r.operationId !== 'semantic:' + r.runId + ':replacement' ||
    typeof r.successorId !== 'string' ||
    !r.successorId.length ||
    r.successorId.length > 96 ||
    !r.expectedArtifact ||
    !exact(r.expectedArtifact, 'artifactId,digest,revision') ||
    typeof r.expectedArtifact.artifactId !== 'string' ||
    !r.expectedArtifact.artifactId.length ||
    r.expectedArtifact.artifactId.length > 96 ||
    r.expectedArtifact.artifactId === r.successorId ||
    !Number.isSafeInteger(r.expectedArtifact.revision) ||
    r.expectedArtifact.revision < 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(r.expectedArtifact.digest) ||
    typeof r.expectedActiveSnapshotId !== 'string' ||
    !r.expectedActiveSnapshotId.length ||
    r.expectedActiveSnapshotId.length > 256
  )
    throw surferFailure('Invalid replacement command.');
  return r;
}
export function buildSurferRepairDevelopment(
  parent: SurferReviewedRuleMemoryPayload,
  training: SurferCognitiveView,
  reviews: SurferCognitiveView[],
  datasetId: string,
) {
  validateSurferRuleMemoryBinding(parent);
  validateSurferScopedRuleProof(parent.proof, training);
  if (reviews.length !== parent.reviews.length || !reviews.length)
    throw surferFailure('Replacement requires all grounded reviews.');
  const first = parent.proof.development.cases[0]!,
    witness = (a: SurferCognitiveView['anchors'][number]) => ({
      sourceId: a.source.sourceId,
      sourceVersionId: a.source.sourceVersionId,
      evidenceId: a.source.evidenceId,
      materialDigest: a.source.sourceContentHash,
    }),
    original = parent.proof.development.cases.map((c, i) =>
      decodeSurferLearningCase({
        ...c,
        witnesses: [witness(training.anchors[Math.floor(i / 2)]!)],
      }),
    ),
    added = parent.reviews.map((e, i) => {
      const o = e.observation,
        a = reviews[i]!.anchors[0]!;
      if (
        o.datasetId !== parent.proof.development.datasetId ||
        o.domain !== first.domain ||
        surferDigest(a.scope) !== surferDigest(first.scope)
      )
        throw surferFailure('Replacement review dataset/domain/Source scope differs.');
      return decodeSurferLearningCase({
        schemaVersion: '1.0.0',
        caseId: o.eventId,
        eventGroup: o.eventGroup,
        domain: o.domain,
        scope: first.scope,
        features: o.features,
        observedOutcome: o.observedOutcome,
        witnesses: [witness(a)],
      });
    });
  return decodeSurferRepairDevelopment({
    contract: 'surfer.repair-development.v1',
    datasetId,
    cases: [...original, ...added],
  });
}
export function surferReplacementRequest(p: SurferReplacementPreparation): SurferRepairRequest {
  return decodeSurferRepairRequest({
    contract: 'surfer.replacement-request.v1',
    runId: p.input.runId,
    operationId: p.input.operationId + ':propose',
    spaceId: p.scope.spaceId,
    sourceDigest: p.sourceDigest,
    development: p.development,
  });
}
export function surferReplacementCandidate(
  p: SurferReplacementPreparation,
  proposal: SurferRepairProposal,
  reservationId: string,
) {
  return decodeSurferRuleCandidate({
    schemaVersion: '1.0.0',
    candidateId: 'replacement:' + surferDigest([p, proposal.expression]).slice(7),
    domain: p.development.cases[0]!.domain,
    scope: p.scope,
    origin: 'INDUCTION',
    description: 'Source-grounded finite empirical replacement;not universal or causal fact.',
    conclusionKey: 'observedOutcome',
    expression: proposal.expression,
    developmentCaseIds: p.development.cases.map((c) => c.caseId),
    assumptions: [
      'Observed support digest:' + surferDigest(p.development.cases),
      'New combinations of observed marginal values only;unseen values and categories remain UNKNOWN.',
    ],
    proposer: { provider: 'local-symbolic', model: proposal.revision, executionId: reservationId },
  });
}
export function surferReplacementSpec(
  p: SurferReplacementPreparation,
  candidate: ReturnType<typeof surferReplacementCandidate>,
): SurferExperimentSpec {
  return {
    schemaVersion: '1.0.0',
    experimentId: 'replacement:' + surferDigest([p.input.runId, p.descriptor.datasetId]).slice(7),
    datasetId: p.descriptor.datasetId,
    datasetRevision: p.descriptor.revision,
    partition: 'future',
    selectedCandidateDigest: surferDigest(candidate),
    validatorRevision: 'surfer-typed-rule-validator-v1',
    policy: { minimumCorrect: 16, minimumCoverage: 1, maxOperationsPerCase: 512 },
  };
}
export function assessSurferReplacement(
  p: SurferReplacementPreparation,
  candidate: ReturnType<typeof surferReplacementCandidate>,
) {
  const rows = p.development.cases.map((c) => {
    const r = applySurferObservedRule(candidate, p.development.cases, { ...c.features });
    return {
      caseId: c.caseId,
      outcome: r.outcome,
      correct: r.outcome !== 'UNKNOWN' && (r.outcome === 'TRUE') === c.observedOutcome,
    };
  });
  return {
    total: rows.length,
    correct: rows.filter((r) => r.correct).length,
    unknown: rows.filter((r) => r.outcome === 'UNKNOWN').length,
    originalCorrect: rows.slice(0, 32).filter((r) => r.correct).length,
    reviewCorrect: rows.slice(32).filter((r) => r.correct).length,
    eligible: rows.every((r) => r.correct),
  };
}
export function validateSurferReplacementPreparation(p: SurferReplacementPreparation) {
  assertSurferJson(p);
  if (
    !p ||
    !exact(p, 'context,contract,descriptor,development,input,parent,scope,sourceDigest') ||
    p.contract !== 'surfer.rule-replacement-preparation.v1' ||
    p.parent?.contract !== 'surfer.scoped-rule-memory.v2'
  )
    throw surferFailure('Invalid replacement preparation.');
  decodeSurferReplacementCommand(p.input);
  validateSurferRuleMemoryBinding(p.parent);
  decodeSurferRepairDevelopment(p.development);
  const d = p.descriptor;
  decodeSurferAccessContext(p.context);
  if (
    !d ||
    d.datasetId !== p.development.datasetId ||
    d.datasetId === p.parent.proof.development.datasetId ||
    d.revision !== 1 ||
    d.partitions.future.count !== 16 ||
    d.partitions.locked.count !== 0 ||
    d.domain !== p.development.cases[0]!.domain ||
    surferDigest(d.scope) !== surferDigest(p.scope) ||
    surferDigest(p.scope) !== surferDigest(p.parent.proof.candidate.scope) ||
    surferDigest(d.developmentCaseIds) !== surferDigest(p.development.cases.map((c) => c.caseId)) ||
    surferDigest(d.developmentEventGroups) !==
      surferDigest(p.development.cases.map((c) => c.eventGroup)) ||
    p.context.spaceId !== p.scope.spaceId ||
    !/^sha256:[a-f0-9]{64}$/.test(p.sourceDigest)
  )
    throw surferFailure('Replacement cohort/preparation binding differs.');
  return p;
}
export async function readSurferReplacementSources(
  source: SurferCognitiveSourcePort,
  actor: unknown,
  p: SurferReplacementPreparation,
) {
  validateSurferReplacementPreparation(p);
  const views = await readSurferRuleReviewViews(source, actor, p.parent),
    training = await source.withCurrent(
      actor,
      p.parent.proof.basis,
      p.parent.proof.selections,
      (v) => v,
    ),
    development = buildSurferRepairDevelopment(p.parent, training, views, p.development.datasetId),
    sourceDigest = surferDigest({
      parent: p.input.expectedArtifact,
      basis: p.parent.knowledgeBasis,
      training: training.viewDigest,
      reviews: views.map((v) => v.viewDigest),
    });
  if (surferDigest(development) !== surferDigest(p.development) || sourceDigest !== p.sourceDigest)
    throw surferFailure('Replacement Source/development changed.');
  return [training, ...views];
}
export function validateSurferReplacementExecution(
  p: SurferReplacementPreparation,
  e: SurferExecutionRecord,
) {
  assertSurferJson(e);
  if (!e || !e.request) throw surferFailure('Replacement execution is missing.');
  const request = surferReplacementRequest(p),
    proposal = decodeSurferRepairProposal(e.checkpoint, request);
  if (
    e.state !== 'SETTLED' ||
    e.outcome !== 'SUCCEEDED' ||
    e.request.executionKind !== 'LOCAL_DETERMINISTIC' ||
    e.request.kind !== 'PROPOSE' ||
    e.request.operationId !== request.operationId ||
    e.request.runId !== request.runId ||
    e.request.spaceId !== request.spaceId ||
    e.request.attempt !== 1 ||
    e.requestDigest !== surferDigest(e.request) ||
    e.reservationId !== surferDigest([request.operationId, 1]) ||
    e.request.inputDigest !== surferDigest({ request }) ||
    !e.usage ||
    ['calls', 'inputTokens', 'outputTokens', 'moneyMicros'].some(
      (k) => e.usage![k as 'calls'] !== 0,
    ) ||
    e.resultRef !== surferDigest(proposal)
  )
    throw surferFailure('Replacement execution is not a settled bound proposal.');
  return proposal;
}
export function validateSurferReplacementMemory(input: unknown): SurferReplacementMemoryPayload {
  assertSurferJson(input);
  const m = structuredClone(input) as SurferReplacementMemoryPayload;
  if (
    !m ||
    !exact(m, 'candidate,contract,execution,prepared,receipt') ||
    m.contract !== 'surfer.rule-replacement-memory.v1'
  )
    throw surferFailure('Invalid replacement memory.');
  const p = validateSurferReplacementPreparation(m.prepared),
    e = m.execution,
    proposal = validateSurferReplacementExecution(p, e);
  if (proposal.status !== 'PROPOSED')
    throw surferFailure('Replacement memory has no proposed candidate.');
  const candidate = surferReplacementCandidate(p, proposal, e.reservationId),
    spec = surferReplacementSpec(p, candidate),
    r = m.receipt,
    a = r?.applicationSupport;
  if (
    surferDigest(candidate) !== surferDigest(m.candidate) ||
    !assessSurferReplacement(p, candidate).eligible ||
    !r ||
    r.status !== 'SCOPE_VALIDATED' ||
    r.candidateDigest !== surferDigest(candidate) ||
    r.specDigest !== surferDigest(spec) ||
    r.experimentId !== spec.experimentId ||
    r.datasetDigest !== p.descriptor.partitions.future.digest ||
    surferDigest(r.scope) !== surferDigest(p.scope) ||
    r.validatorRevision !== spec.validatorRevision ||
    r.total !== 16 ||
    r.correct !== 16 ||
    r.unknown !== 0 ||
    r.accuracy !== 1 ||
    r.coverage !== 1 ||
    r.evidenceLevel !== 'CONTROLLED_DATASET_ONLY' ||
    r.semanticAssessment !== 'NOT_EVALUATED' ||
    r.caseResults.length !== 16 ||
    r.caseResults.some((x) => !x.correct || !['TRUE', 'FALSE'].includes(x.prediction)) ||
    !a ||
    a.contract !== 'surfer.observed-support-gate.v1' ||
    a.supportDigest !== surferDigest(p.development.cases) ||
    a.candidateDigest !== r.candidateDigest ||
    a.futureDigest !== r.datasetDigest ||
    a.supported !== 16 ||
    a.inputs.length !== 16 ||
    new Set(a.inputs.map((x) => x.caseId)).size !== 16 ||
    a.inputs.some(
      (x) =>
        !r.caseResults.some((c) => c.caseId === x.caseId) ||
        !/^sha256:[a-f0-9]{64}$/.test(x.featuresDigest),
    )
  )
    throw surferFailure(
      'Replacement did not pass its complete regression and supported future gate.',
    );
  return m;
}
