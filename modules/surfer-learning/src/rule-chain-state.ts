import {
  assertSurferJson,
  decodeSurferRuleCandidate,
  decodeSurferLearningCase,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
  type SurferRuleCandidate,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferArtifactRef,
  type SurferArtifactRef,
  type SurferKnowledgeArtifact,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferSourceBasisV2,
  type SurferSourceBasisV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferScopedRuleMemorySession } from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  decodeSurferRuleObservation,
  type SurferRuleReviewEntry,
  type SurferRuleUseState,
} from '../../../packages/contracts/src/surfer-rule-review.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import { decodeSurferAccessContext } from '../../../packages/contracts/src/surfer-experiment.js';
import type {
  SurferDatasetDescriptor,
  SurferAccessContext,
  SurferExperimentReceipt,
  SurferExperimentSpec,
} from '../../../packages/contracts/src/surfer-experiment.js';
import type { SurferExecutionRecord } from '../../../packages/contracts/src/surfer-execution.js';
import {
  decodeSurferContinuationDevelopment,
  decodeSurferContinuationProposal,
  type SurferContinuationRequest,
  type SurferContinuationProposal,
} from '../../../packages/contracts/src/surfer-rule-continuation.js';
import {
  validateSurferReplacementMemory,
  readSurferReplacementSources,
  type SurferReplacementMemoryPayload,
} from './replacement-proof.js';
import { diagnoseSurferEmpiricalRule } from './rule-review-diagnosis.js';
import { applySurferObservedRule } from './scoped-rule-application.js';
export const CHAIN_DOMAIN = 'surfer.scoped-rule-memory.v1';
export const CHAIN_BASE = 'surfer.chain-baseline.v1',
  CHAIN_OBSERVATION = 'surfer.chain-observation.v1',
  CHAIN_QUALIFICATION = 'surfer.chain-qualification.v1';
export type ChainObservation = SurferRuleReviewEntry & {
  generation: number;
  contract: typeof CHAIN_OBSERVATION;
};
export type ChainManifest = {
  contract: 'surfer.rule-chain-memory.v1';
  baseline: SurferArtifactRef;
  observations: SurferArtifactRef[];
  qualifications: SurferArtifactRef[];
  generation: number;
  state: SurferRuleUseState;
  previous: SurferArtifactRef;
  transition: 'REVIEW' | 'QUALIFIED';
  knowledgeBasis: SurferSourceBasisV2;
};
export type ChainCommand = {
  schemaVersion: '1.0.0';
  contract: 'surfer.rule-chain-requalify.v1';
  runId: string;
  operationId: string;
  expectedArtifact: SurferArtifactRef;
  expectedActiveSnapshotId: string;
  successorId: string;
};
export type ChainPlan = {
  contract: 'surfer.chain-plan.v1';
  input: ChainCommand;
  generation: number;
  baseline: SurferArtifactRef;
  observations: SurferArtifactRef[];
  qualifications: SurferArtifactRef[];
  descriptor: SurferDatasetDescriptor;
  context: SurferAccessContext;
  lineageDigest: string;
  sourceDigest: string;
  supportDigest: string;
  priorFutureDigest: string;
};
export type ChainReceipt = SurferExperimentReceipt & {
  applicationSupport: {
    contract: 'surfer.observed-support-gate.v2';
    supportDigest: string;
    candidateDigest: string;
    futureDigest: string;
    priorFutureDigest: string;
    inputs: { caseId: string; eventGroup: string; featuresDigest: string }[];
    supported: number;
    novelValuesDigest: string;
    coveredValues: string[];
  };
};
export type ChainQualification = {
  contract: typeof CHAIN_QUALIFICATION;
  plan: ChainPlan;
  request: SurferContinuationRequest;
  execution: SurferExecutionRecord;
  candidate: SurferRuleCandidate;
  receipt: ChainReceipt;
};
export type ChainState = {
  manifest: ChainManifest | null;
  baseline: SurferReplacementMemoryPayload;
  observations: ChainObservation[];
  views: SurferCognitiveView[];
  qualifications: ChainQualification[];
  candidate: SurferRuleCandidate;
  cases: SurferLearningCase[];
  datasetId: string;
  state: SurferRuleUseState;
  generation: number;
  history: ReturnType<typeof futureHistory>;
  diagnoses: ReturnType<typeof diagnoseSurferEmpiricalRule>[];
};
const exact = (o: object, k: string) => Object.keys(o).sort().join(',') === k;
export function chainRefs(m: Pick<ChainManifest, 'baseline' | 'observations' | 'qualifications'>) {
  return [m.baseline, ...m.observations, ...m.qualifications];
}
export function futureHistory(
  base: SurferReplacementMemoryPayload,
  qualifications: ChainQualification[],
) {
  const receipts = [base.receipt, ...qualifications.map((q) => q.receipt)];
  return {
    datasets: receipts.map((r, i) =>
      i === 0
        ? base.prepared.descriptor.datasetId
        : qualifications[i - 1]!.plan.descriptor.datasetId,
    ),
    partitions: receipts.map((r) => r.datasetDigest),
    caseIds: receipts.flatMap((r) => r.applicationSupport.inputs.map((i) => i.caseId)),
    features: [
      ...new Set(receipts.flatMap((r) => r.applicationSupport.inputs.map((i) => i.featuresDigest))),
    ].sort(),
    groups: qualifications.flatMap((q) =>
      q.receipt.applicationSupport.inputs.map((i) => i.eventGroup),
    ),
  };
}
export function validateChainManifest(input: unknown): ChainManifest {
  assertSurferJson(input);
  const m = structuredClone(input) as ChainManifest;
  if (
    !m ||
    !exact(
      m,
      'baseline,contract,generation,knowledgeBasis,observations,previous,qualifications,state,transition',
    ) ||
    m.contract !== 'surfer.rule-chain-memory.v1' ||
    !Array.isArray(m.observations) ||
    m.observations.length < 1 ||
    m.observations.length > 16 ||
    !Array.isArray(m.qualifications) ||
    m.qualifications.length > 2 ||
    m.generation !== m.qualifications.length + 1 ||
    !['ACTIVE', 'QUARANTINED', 'RETRACTED'].includes(m.state) ||
    !['REVIEW', 'QUALIFIED'].includes(m.transition)
  )
    throw surferFailure('Invalid bounded chain manifest.');
  decodeSurferArtifactRef(m.previous);
  assertSurferSourceBasisV2(m.knowledgeBasis);
  for (const r of chainRefs(m)) {
    decodeSurferArtifactRef(r);
    if (r.revision !== 1) throw surferFailure('Chain capsules must remain immutable revision1.');
  }
  if (new Set(chainRefs(m).map((r) => r.artifactId)).size !== chainRefs(m).length)
    throw surferFailure('Duplicate chain capsule reference.');
  return m;
}
export function decodeChainCommand(input: unknown): ChainCommand {
  assertSurferJson(input);
  const r = structuredClone(input) as ChainCommand;
  if (
    !r ||
    !exact(
      r,
      'contract,expectedActiveSnapshotId,expectedArtifact,operationId,runId,schemaVersion,successorId',
    ) ||
    r.schemaVersion !== '1.0.0' ||
    r.contract !== 'surfer.rule-chain-requalify.v1' ||
    typeof r.runId !== 'string' ||
    !/^[A-Za-z0-9-]{1,40}$/.test(r.runId) ||
    r.operationId !== 'semantic:' + r.runId + ':chain' ||
    typeof r.successorId !== 'string' ||
    !r.successorId.length ||
    r.successorId.length > 96 ||
    typeof r.expectedActiveSnapshotId !== 'string' ||
    !r.expectedActiveSnapshotId.length ||
    r.expectedActiveSnapshotId.length > 256
  )
    throw surferFailure('Invalid chain requalification command.');
  decodeSurferArtifactRef(r.expectedArtifact);
  if (r.expectedArtifact.artifactId === r.successorId)
    throw surferFailure('A qualification requires a new successor identity.');
  return r;
}
export function chainSourceDigest(
  m: Pick<ChainManifest, 'baseline' | 'observations' | 'qualifications'>,
  views: SurferCognitiveView[],
) {
  return surferDigest({
    lineage: {
      baseline: m.baseline,
      observations: m.observations,
      qualifications: m.qualifications,
    },
    views: views.map((v) => v.viewDigest),
  });
}
export function chainDevelopment(
  base: SurferReplacementMemoryPayload,
  observations: ChainObservation[],
  views: SurferCognitiveView[],
  datasetId: string,
) {
  const original = base.prepared.development.cases,
    offset = base.prepared.parent.reviews.length + 1;
  const added = observations.map((e, i) => {
    const a = views[offset + i]!.anchors[0]!,
      o = e.observation;
    if (surferDigest(a.scope) !== surferDigest(base.prepared.scope))
      throw surferFailure('Mixed chain Source scope is unsupported.');
    return decodeSurferLearningCase({
      schemaVersion: '1.0.0',
      caseId: o.eventId,
      eventGroup: o.eventGroup,
      domain: o.domain,
      scope: a.scope,
      features: o.features,
      observedOutcome: o.observedOutcome,
      witnesses: [
        {
          sourceId: a.source.sourceId,
          sourceVersionId: a.source.sourceVersionId,
          evidenceId: a.source.evidenceId,
          materialDigest: a.source.sourceContentHash,
        },
      ],
    });
  });
  return decodeSurferContinuationDevelopment({
    contract: 'surfer.continuation-development.v1',
    datasetId,
    cases: [...original, ...added],
  });
}
export function chainRequest(
  plan: ChainPlan,
  cases: SurferLearningCase[],
): SurferContinuationRequest {
  return {
    contract: 'surfer.continuation-request.v1',
    runId: plan.input.runId,
    operationId: plan.input.operationId + ':propose',
    spaceId: plan.context.spaceId,
    sourceDigest: plan.sourceDigest,
    development: decodeSurferContinuationDevelopment({
      contract: 'surfer.continuation-development.v1',
      datasetId: plan.descriptor.datasetId,
      cases,
    }),
  };
}
export function chainCandidate(
  plan: ChainPlan,
  p: SurferContinuationProposal,
  id: string,
  cases: SurferLearningCase[],
) {
  return decodeSurferRuleCandidate({
    schemaVersion: '1.0.0',
    candidateId: 'chain:' + surferDigest([plan, p.expression]).slice(7),
    domain: cases[0]!.domain,
    scope: cases[0]!.scope,
    origin: 'INDUCTION',
    description: 'Bounded flat-lineage empirical requalification;not universal or causal fact.',
    conclusionKey: 'observedOutcome',
    expression: p.expression,
    developmentCaseIds: cases.map((c) => c.caseId),
    assumptions: [
      'Observed support digest:' + plan.supportDigest,
      'Historical future digest:' + plan.priorFutureDigest,
      'Only observed marginal values;declared Source observations are not verified facts.',
    ],
    proposer: { provider: 'local-symbolic', model: p.revision, executionId: id },
  });
}
export function chainSpec(plan: ChainPlan, candidate: SurferRuleCandidate): SurferExperimentSpec {
  return {
    schemaVersion: '1.0.0',
    experimentId: 'chain:' + surferDigest([plan.input.runId, plan.descriptor.datasetId]).slice(7),
    datasetId: plan.descriptor.datasetId,
    datasetRevision: 1,
    partition: 'future',
    selectedCandidateDigest: surferDigest(candidate),
    validatorRevision: 'surfer-typed-rule-validator-v1',
    policy: { minimumCorrect: 16, minimumCoverage: 1, maxOperationsPerCase: 512 },
  };
}
export function chainAssessment(candidate: SurferRuleCandidate, cases: SurferLearningCase[]) {
  const predictions = cases.map(
    (c) => applySurferObservedRule(candidate, cases, { ...c.features }).outcome,
  );
  const rows = cases.map(
    (c, i) => predictions[i] !== 'UNKNOWN' && (predictions[i] === 'TRUE') === c.observedOutcome,
  );
  return {
    total: rows.length,
    unknown: predictions.filter((x) => x === 'UNKNOWN').length,
    correct: rows.filter(Boolean).length,
    baselineCorrect: rows.slice(0, 40).filter(Boolean).length,
    reviewCorrect: rows.slice(40).filter(Boolean).length,
    eligible: rows.every(Boolean),
  };
}
export function chainNovelValues(
  previous: readonly SurferLearningCase[],
  next: readonly SurferLearningCase[],
) {
  const found = new Map<string, { name: string; value: SurferLearningCase['features'][string] }>();
  for (const c of next)
    for (const [name, value] of Object.entries(c.features))
      if (!previous.some((p) => surferDigest(p.features[name]) === surferDigest(value))) {
        const key = surferDigest({ name, value });
        found.set(key, { name, value });
      }
  return [...found]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key, ...value }));
}
export function validateChainExecution(
  plan: ChainPlan,
  cases: SurferLearningCase[],
  execution: SurferExecutionRecord,
) {
  assertSurferJson(execution);
  const request = chainRequest(plan, cases),
    e = execution,
    p = decodeSurferContinuationProposal(e.checkpoint, request);
  if (
    e.state !== 'SETTLED' ||
    e.outcome !== 'SUCCEEDED' ||
    e.request.executionKind !== 'LOCAL_DETERMINISTIC' ||
    e.request.kind !== 'PROPOSE' ||
    e.request.operationId !== request.operationId ||
    e.request.spaceId !== request.spaceId ||
    e.request.attempt !== 1 ||
    e.request.runId !== request.runId ||
    e.reservationId !== surferDigest([request.operationId, 1]) ||
    e.request.inputDigest !== surferDigest({ request }) ||
    e.requestDigest !== surferDigest(e.request) ||
    e.resultRef !== surferDigest(p) ||
    !e.usage ||
    ['calls', 'inputTokens', 'outputTokens', 'moneyMicros'].some(
      (k) => e.usage![k as 'calls'] !== 0,
    )
  )
    throw surferFailure('Chain execution does not bind its durable request.');
  return p;
}
export function validateChainPlan(plan: ChainPlan, state: ChainState) {
  assertSurferJson(plan);
  if (
    !exact(
      plan,
      'baseline,context,contract,descriptor,generation,input,lineageDigest,observations,priorFutureDigest,qualifications,sourceDigest,supportDigest',
    )
  )
    throw surferFailure('Invalid chain plan schema.');
  decodeSurferAccessContext(plan.context);
  decodeChainCommand(plan.input);
  const d = plan.descriptor,
    cases = chainDevelopment(state.baseline, state.observations, state.views, d.datasetId).cases;
  if (
    plan.contract !== 'surfer.chain-plan.v1' ||
    plan.generation !== state.generation + 1 ||
    plan.generation > 3 ||
    !state.manifest ||
    surferDigest({
      baseline: plan.baseline,
      observations: plan.observations,
      qualifications: plan.qualifications,
    }) !==
      surferDigest({
        baseline: state.manifest.baseline,
        observations: state.manifest.observations,
        qualifications: state.manifest.qualifications,
      }) ||
    plan.lineageDigest !==
      surferDigest({
        baseline: plan.baseline,
        observations: plan.observations,
        qualifications: plan.qualifications,
      }) ||
    plan.sourceDigest !== chainSourceDigest(state.manifest, state.views) ||
    plan.supportDigest !== surferDigest(cases) ||
    plan.priorFutureDigest !== surferDigest(state.history) ||
    state.observations.length <= (state.qualifications.at(-1)?.plan.observations.length ?? 0) ||
    state.observations
      .slice(state.qualifications.at(-1)?.plan.observations.length ?? 0)
      .some(
        (e) =>
          e.observation.datasetId !== state.datasetId ||
          e.observation.domain !== state.candidate.domain,
      ) ||
    d.revision !== 1 ||
    d.partitions.future.count !== 16 ||
    d.partitions.locked.count !== 0 ||
    d.domain !== state.candidate.domain ||
    surferDigest(d.scope) !== surferDigest(state.candidate.scope) ||
    state.history.datasets.includes(d.datasetId) ||
    state.history.partitions.includes(d.partitions.future.digest) ||
    surferDigest(d.developmentCaseIds) !== surferDigest(cases.map((c) => c.caseId)) ||
    surferDigest(d.developmentEventGroups) !== surferDigest(cases.map((c) => c.eventGroup)) ||
    plan.context.spaceId !== state.candidate.scope.spaceId
  )
    throw surferFailure('Chain plan changed lineage,capacity or fresh future identity.');
  return cases;
}
export function validateChainQualification(q: ChainQualification, state: ChainState) {
  assertSurferJson(q);
  if (
    !exact(q, 'candidate,contract,execution,plan,receipt,request') ||
    q.contract !== CHAIN_QUALIFICATION
  )
    throw surferFailure('Invalid chain qualification capsule schema.');
  const cases = validateChainPlan(q.plan, state),
    request = chainRequest(q.plan, cases);
  if (surferDigest(q.request) !== surferDigest(request))
    throw surferFailure('Qualification request differs.');
  const proposal = validateChainExecution(q.plan, cases, q.execution),
    candidate = chainCandidate(q.plan, proposal, q.execution.reservationId, cases),
    r = q.receipt,
    spec = chainSpec(q.plan, candidate),
    gate = r?.applicationSupport;
  if (
    proposal.status !== 'PROPOSED' ||
    !chainAssessment(candidate, cases).eligible ||
    surferDigest(candidate) !== surferDigest(q.candidate) ||
    !r ||
    r.status !== 'SCOPE_VALIDATED' ||
    r.total !== 16 ||
    r.correct !== 16 ||
    r.unknown !== 0 ||
    r.accuracy !== 1 ||
    r.coverage !== 1 ||
    r.caseResults.length !== 16 ||
    r.caseResults.some((x) => !x.correct || !['TRUE', 'FALSE'].includes(x.prediction)) ||
    r.validatorRevision !== spec.validatorRevision ||
    r.experimentId !== spec.experimentId ||
    surferDigest(r.scope) !== surferDigest(candidate.scope) ||
    r.candidateDigest !== surferDigest(candidate) ||
    r.specDigest !== surferDigest(spec) ||
    r.datasetDigest !== q.plan.descriptor.partitions.future.digest ||
    r.semanticAssessment !== 'NOT_EVALUATED' ||
    r.evidenceLevel !== 'CONTROLLED_DATASET_ONLY' ||
    !gate ||
    gate.contract !== 'surfer.observed-support-gate.v2' ||
    gate.supportDigest !== q.plan.supportDigest ||
    gate.priorFutureDigest !== q.plan.priorFutureDigest ||
    gate.candidateDigest !== r.candidateDigest ||
    gate.futureDigest !== r.datasetDigest ||
    gate.supported !== 16 ||
    gate.novelValuesDigest !== surferDigest(chainNovelValues(state.cases, cases)) ||
    surferDigest([...gate.coveredValues].sort()) !==
      surferDigest(
        chainNovelValues(state.cases, cases)
          .map((v) => v.key)
          .sort(),
      ) ||
    gate.inputs.length !== 16 ||
    new Set(gate.inputs.map((x) => x.caseId)).size !== 16 ||
    new Set(gate.inputs.map((x) => x.eventGroup)).size !== 16 ||
    gate.inputs.some(
      (x) =>
        state.history.features.includes(x.featuresDigest) ||
        state.history.caseIds.includes(x.caseId) ||
        state.history.groups.includes(x.eventGroup) ||
        cases.some(
          (c) =>
            c.caseId === x.caseId ||
            c.eventGroup === x.eventGroup ||
            surferDigest(c.features) === x.featuresDigest,
        ) ||
        !r.caseResults.some(
          (c) => c.caseId === x.caseId && c.correct && c.prediction !== 'UNKNOWN',
        ),
    )
  )
    throw surferFailure('Qualification failed complete regression/supported fresh future proof.');
  return { cases, candidate };
}
async function capsule(s: SurferScopedRuleMemorySession, ref: SurferArtifactRef, domain: string) {
  const a = await s.readArtifact(ref);
  if (a.kind !== 'EPISODE' || a.origin !== 'EXPERIENCE' || a.revision !== 1 || a.domain !== domain)
    throw surferFailure('Invalid immutable chain capsule.');
  return a;
}
export async function readSurferChainState(
  s: SurferScopedRuleMemorySession,
  actor: unknown,
  stored: SurferKnowledgeArtifact,
): Promise<ChainState> {
  const raw = stored.payload as { contract?: string };
  if (raw.contract === 'surfer.rule-replacement-memory.v1') {
    const base = validateSurferReplacementMemory(raw),
      views = await readSurferReplacementSources(s.source, actor, base.prepared);
    if (
      base.prepared.development.cases.length !== 40 ||
      stored.revision !== 1 ||
      surferDigest(stored.basis) !== surferDigest(base.prepared.parent.knowledgeBasis.coreBasis)
    )
      throw surferFailure('Baseline successor binding differs.');
    return {
      manifest: null,
      baseline: base,
      observations: [],
      views,
      qualifications: [],
      candidate: base.candidate,
      cases: base.prepared.development.cases,
      datasetId: base.prepared.development.datasetId,
      state: 'ACTIVE',
      generation: 1,
      history: futureHistory(base, []),
      diagnoses: [],
    };
  }
  const m = validateChainManifest(raw);
  if (
    (m.transition === 'REVIEW' &&
      (m.previous.artifactId !== stored.artifactId ||
        m.previous.revision + 1 !== stored.revision)) ||
    (m.transition === 'QUALIFIED' &&
      (m.previous.artifactId === stored.artifactId || stored.revision !== 1)) ||
    surferDigest(stored.basis) !== surferDigest(m.knowledgeBasis.coreBasis)
  )
    throw surferFailure('Chain manifest revision/basis differs.');
  const b = await capsule(s, m.baseline, CHAIN_BASE),
    base = validateSurferReplacementMemory((b.payload as { memory: unknown }).memory),
    views = await readSurferReplacementSources(s.source, actor, base.prepared),
    observations: ChainObservation[] = [],
    quals: ChainQualification[] = [];
  if (
    !exact(b.payload, 'contract,memory') ||
    b.payload.contract !== CHAIN_BASE ||
    base.prepared.development.cases.length !== 40 ||
    surferDigest(b.basis) !== surferDigest(base.prepared.parent.knowledgeBasis.coreBasis)
  )
    throw surferFailure('Baseline capsule lost its Source premises.');
  for (const ref of m.observations) {
    const a = await capsule(s, ref, CHAIN_OBSERVATION),
      e = a.payload as unknown as ChainObservation;
    assertSurferJson(e);
    if (
      !exact(e, 'action,basis,contract,generation,observation,observationDigest,selections') ||
      e.contract !== CHAIN_OBSERVATION ||
      !Number.isSafeInteger(e.generation) ||
      e.generation < 1 ||
      e.generation > 3 ||
      e.selections.length !== 1
    )
      throw surferFailure('Invalid chain observation.');
    const v = await s.source.withCurrent(actor, e.basis, e.selections, (v) => v),
      o = decodeSurferRuleObservation(JSON.parse(v.anchors[0]!.rawLiteral));
    if (surferDigest(o) !== e.observationDigest || surferDigest(o) !== surferDigest(e.observation))
      throw surferFailure('Chain observation differs from current Source.');
    observations.push(e);
    views.push(v);
  }
  if (
    new Set(observations.map((e) => e.observation.eventId)).size !== observations.length ||
    new Set(observations.map((e) => e.observation.eventGroup)).size !== observations.length
  )
    throw surferFailure('Duplicate chain events.');
  for (const ref of m.qualifications) {
    const a = await capsule(s, ref, CHAIN_QUALIFICATION);
    quals.push(a.payload as unknown as ChainQualification);
  }
  let state: ChainState = {
      manifest: { ...m, observations: [], qualifications: [], generation: 1, state: 'ACTIVE' },
      baseline: base,
      observations: [],
      views: views.slice(0, base.prepared.parent.reviews.length + 1),
      qualifications: [],
      candidate: base.candidate,
      cases: base.prepared.development.cases,
      datasetId: base.prepared.development.datasetId,
      state: 'ACTIVE',
      generation: 1,
      history: futureHistory(base, []),
      diagnoses: [],
    },
    cursor = 0;
  for (let i = 0; i < quals.length; i++) {
    const q = quals[i]!;
    assertSurferJson(q);
    if (
      q.contract !== CHAIN_QUALIFICATION ||
      q.plan.observations.length <= cursor ||
      q.plan.observations.length > observations.length
    )
      throw surferFailure('Invalid chain qualification order.');
    const end = q.plan.observations.length;
    for (; cursor < end; cursor++) {
      const e = observations[cursor]!;
      if (e.generation !== state.generation)
        throw surferFailure('Review references another generation.');
      state.state = diagnoseSurferEmpiricalRule(
        state.candidate,
        state.cases,
        state.datasetId,
        e.observation,
        e.action,
        state.state,
      ).nextState;
    }
    state = {
      ...state,
      observations: observations.slice(0, end),
      views: views.slice(0, base.prepared.parent.reviews.length + 1 + end),
      manifest: {
        ...m,
        observations: m.observations.slice(0, end),
        qualifications: m.qualifications.slice(0, i),
        generation: state.generation,
        state: state.state,
      },
    };
    const { cases, candidate } = validateChainQualification(q, state);
    state = {
      ...state,
      candidate,
      cases,
      datasetId: q.plan.descriptor.datasetId,
      state: 'ACTIVE',
      generation: state.generation + 1,
      qualifications: quals.slice(0, i + 1),
      history: futureHistory(base, quals.slice(0, i + 1)),
    };
  }
  const diagnoses = [];
  for (; cursor < observations.length; cursor++) {
    const e = observations[cursor]!;
    if (e.generation !== state.generation)
      throw surferFailure('Pending review generation differs.');
    const d = diagnoseSurferEmpiricalRule(
      state.candidate,
      state.cases,
      state.datasetId,
      e.observation,
      e.action,
      state.state,
    );
    state.state = d.nextState;
    diagnoses.push(d);
  }
  const refs = chainRefs(m),
    sources = [
      ...new Map(views.flatMap((v) => v.basis.sources).map((x) => [x.sourceId, x])).values(),
    ].sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)),
    ids = sources.map((x) => x.sourceId),
    kb = m.knowledgeBasis;
  if (
    (quals.length > 0 && stored.artifactId !== quals.at(-1)!.plan.input.successorId) ||
    (quals.length === 0 && stored.artifactId !== base.prepared.input.successorId) ||
    (m.transition === 'QUALIFIED' &&
      surferDigest(m.previous) !==
        surferDigest(quals.at(-1)?.plan.input.expectedArtifact ?? null)) ||
    m.generation !== state.generation ||
    m.state !== state.state ||
    surferDigest(kb.sources) !== surferDigest(sources) ||
    surferDigest(kb.coreBasis.artifacts) !== surferDigest(refs) ||
    surferDigest(kb.dependencies.map((d) => d.artifact)) !== surferDigest(refs) ||
    kb.queries.length !== 1 ||
    kb.queries[0]?.kind !== 'EXPLICIT_SOURCE_SET' ||
    surferDigest(kb.queries[0].sourceIds) !== surferDigest(ids) ||
    surferDigest(stored.scope) !== surferDigest(base.prepared.scope)
  )
    throw surferFailure('Chain manifest lost its Source/capsule/state premises.');
  return { ...state, manifest: m, observations, views, qualifications: quals, diagnoses };
}
