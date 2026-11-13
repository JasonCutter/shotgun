import {
  decodeSurferInductionDevelopment,
  type SurferInductionDatasetPort,
} from '../../../packages/contracts/src/surfer-induction.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
  type SurferRuleCandidate,
} from '../../../packages/contracts/src/surfer-learning.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import {
  decodeSurferAccessContext,
  type SurferAccessContext,
  type SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  decodeSurferProviderProfile,
  type SurferProviderProfile,
  type SurferProviderGatewayPort,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import { assessSurferInductionDevelopment } from '../../../modules/surfer-learning/src/development-assessment.js';
import { SurferExperimentService } from '../../../modules/surfer-learning/src/experiment-service.js';
import {
  SurferProviderExecutor,
  type SurferProviderCodec,
  type SurferInterpretationTask,
  type SurferInterpretationResult,
} from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import { SurferInductionFeedbackCodec } from '../../surfer-structure-extraction/src/induction-feedback.js';

export type SurferInductionProposalCodecRegistration = {
  readonly revision: string;
  readonly create: (
    development: unknown,
    previous: SurferRuleCandidate | null,
  ) => SurferProviderCodec<SurferRuleCandidate>;
};
type Options = {
  runId: string;
  development: unknown;
  context: SurferAccessContext;
  dataset: SurferInductionDatasetPort;
  experiments: SurferExperimentStorePort;
  source: SurferCognitiveSourcePort;
  ledger: SurferExecutionLedger;
  gateway: SurferProviderGatewayPort;
  profile: SurferProviderProfile;
  proposalCodec?: SurferInductionProposalCodecRegistration;
};
type Step = {
  index: number;
  execution: SurferInterpretationResult<SurferRuleCandidate>;
  assessment: ReturnType<typeof assessSurferInductionDevelopment> | null;
};
/** First eligible checkpoint wins; the atomic experiment claim seals it before holdout read. */
export class SurferInductionFeedbackTrial {
  private readonly o: Options;
  private readonly development: ReturnType<typeof decodeSurferInductionDevelopment>;
  private readonly context: SurferAccessContext;
  private readonly proposalCodec: SurferInductionProposalCodecRegistration;
  constructor(options: Options) {
    this.o = { ...options, profile: decodeSurferProviderProfile(options.profile) };
    this.development = decodeSurferInductionDevelopment(options.development);
    this.context = decodeSurferAccessContext(options.context);
    this.proposalCodec = options.proposalCodec
      ? { ...options.proposalCodec }
      : {
          revision: 'surfer-induction-development-feedback-v1',
          create: (development, previous) =>
            new SurferInductionFeedbackCodec(development, previous),
        };
    if (
      !/^[A-Za-z0-9-]{1,40}$/.test(options.runId) ||
      options.ledger.policy.limits.calls !== 3 ||
      options.ledger.policy.maxConcurrent !== 1 ||
      this.o.profile.maximum.calls !== 1 ||
      this.o.profile.promptRevision !== this.proposalCodec.revision ||
      typeof this.proposalCodec.create !== 'function'
    )
      throw surferFailure(
        'Feedback induction requires a fixed three-step/single-worker budget and profile.',
      );
  }
  async run(actor: unknown, input: SurferInterpretationTask) {
    assertSurferJson(input);
    const task = structuredClone(input),
      request = decodeSurferSourceRequest(actor),
      o = this.o;
    if (
      task.runId !== o.runId ||
      task.operationId !== 'semantic:' + o.runId + ':induction-feedback' ||
      task.attempt !== 1 ||
      task.priority !== 'FOREGROUND' ||
      request.projectId !== this.context.spaceId
    )
      throw surferFailure('Feedback task does not bind the fixed run.');
    const raw = await o.dataset.describe(structuredClone(this.context));
    assertSurferJson(raw);
    const d = structuredClone(raw);
    const proof = await o.dataset.describeDevelopment(structuredClone(this.context));
    assertSurferJson(proof);
    const first = this.development.cases[0]!;
    if (
      d.revision !== 2 ||
      proof.revision !== d.revision ||
      proof.datasetId !== d.datasetId ||
      proof.developmentDigest !== surferDigest(this.development.cases) ||
      d.datasetId !== this.development.datasetId ||
      d.domain !== first.domain ||
      surferDigest(d.scope) !== surferDigest(first.scope) ||
      surferDigest(d.developmentCaseIds) !==
        surferDigest(this.development.cases.map((c) => c.caseId)) ||
      surferDigest(d.developmentEventGroups) !==
        surferDigest(this.development.cases.map((c) => c.eventGroup)) ||
      d.partitions.locked.count !== 16
    )
      throw surferFailure('Feedback evaluator cohort differs.');
    const steps: Step[] = [];
    let previous: SurferRuleCandidate | null = null;
    for (let index = 0; index < 3; index++) {
      const codec = this.proposalCodec.create(
        structuredClone(this.development),
        previous ? structuredClone(previous) : null,
      );
      if (codec.revision !== this.proposalCodec.revision)
        throw surferFailure('Proposal codec registration revision differs.');
      const executor: SurferProviderExecutor<SurferRuleCandidate> = new SurferProviderExecutor(
        o.source,
        o.ledger,
        o.gateway,
        o.profile,
        codec,
        { minimumSensitivity: 'private' },
      );
      const execution: SurferInterpretationResult<SurferRuleCandidate> = await executor.interpret(
        structuredClone(request),
        {
          ...task,
          operationId: task.operationId + ':propose:' + index,
          stepId: 'proposal-' + index,
        },
      );
      if (execution.status !== 'CANDIDATE_NOT_SEMANTICALLY_VALIDATED' || !execution.frame) {
        steps.push({ index, execution, assessment: null });
        return { status: 'PROPOSAL_INCOMPLETE' as const, steps, selection: null, evaluation: null };
      }
      const assessment = assessSurferInductionDevelopment(this.development, execution.frame);
      steps.push({ index, execution, assessment });
      if (!assessment.eligible) {
        previous = execution.frame;
        continue;
      }
      await o.source.withCurrent(structuredClone(request), task.basis, task.selections, () => true);
      const selection = {
        index,
        candidateDigest: assessment.candidateDigest,
        developmentDigest: assessment.developmentDigest,
        assessmentDigest: surferDigest(assessment),
        policyRevision: 'surfer-induction-development-admission-v1',
      };
      const spec = {
        schemaVersion: '1.0.0',
        experimentId:
          'induction-feedback:' + surferDigest([d.datasetId, task.operationId]).slice(7),
        datasetId: d.datasetId,
        datasetRevision: d.revision,
        partition: 'locked',
        selectedCandidateDigest: selection.candidateDigest,
        validatorRevision: 'surfer-typed-rule-validator-v1',
        policy: { minimumCorrect: 14, minimumCoverage: 1, maxOperationsPerCase: 512 },
      };
      const evaluation = await new SurferExperimentService(o.dataset, o.experiments).evaluate(
        execution.frame,
        spec,
        this.context,
      );
      return { status: 'LOCKED_EVALUATED' as const, steps, selection, evaluation };
    }
    return { status: 'DEVELOPMENT_REJECTED' as const, steps, selection: null, evaluation: null };
  }
}
