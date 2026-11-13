import {
  decodeSurferInductionDevelopment,
  type SurferInductionDatasetPort,
} from '../../../packages/contracts/src/surfer-induction.js';
import {
  decodeSurferAccessContext,
  type SurferExperimentStorePort,
  type SurferAccessContext,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
  type SurferRuleCandidate,
} from '../../../packages/contracts/src/surfer-learning.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import {
  SurferProviderExecutor,
  type SurferInterpretationTask,
} from '../../../modules/surfer-execution/src/provider-executor.js';
import { SurferExperimentService } from '../../../modules/surfer-learning/src/experiment-service.js';
import { SurferInductionCodec } from '../../surfer-structure-extraction/src/induction.js';

/** Trusted isolated assembly. Evaluator capabilities never cross the codec/model boundary. */
type TrialOptions = {
  runId: string;
  development: unknown;
  context: SurferAccessContext;
  dataset: SurferInductionDatasetPort;
  experiments: SurferExperimentStorePort;
  source: SurferCognitiveSourcePort;
  ledger: SurferExecutionLedger;
  gateway: SurferProviderGatewayPort;
  profile: SurferProviderProfile;
};
export class SurferInductionTrial {
  private readonly development: ReturnType<typeof decodeSurferInductionDevelopment>;
  private readonly context: SurferAccessContext;
  private readonly executor: SurferProviderExecutor<SurferRuleCandidate>;
  private readonly options: TrialOptions;
  constructor(options: TrialOptions) {
    this.options = { ...options };
    if (
      !/^[A-Za-z0-9-]{1,40}$/.test(options.runId) ||
      options.ledger.policy.limits.calls !== 1 ||
      options.ledger.policy.maxConcurrent !== 1 ||
      options.profile.maximum.calls !== 1
    )
      throw surferFailure(
        'Initial induction requires one fixed run and a single-call/single-worker budget.',
      );
    this.development = decodeSurferInductionDevelopment(options.development);
    this.context = decodeSurferAccessContext(options.context);
    this.executor = new SurferProviderExecutor(
      options.source,
      options.ledger,
      options.gateway,
      options.profile,
      new SurferInductionCodec(this.development),
      { minimumSensitivity: 'private' },
    );
  }
  async run(actor: unknown, task: SurferInterpretationTask) {
    // Copy before awaiting an adapter so caller mutations cannot rebind the later holdout.
    assertSurferJson(task);
    const bound = structuredClone(task),
      request = decodeSurferSourceRequest(actor),
      o = this.options;
    if (
      bound.runId !== o.runId ||
      bound.operationId !== 'semantic:' + o.runId + ':induction' ||
      bound.attempt !== 1 ||
      request.projectId !== this.context.spaceId
    )
      throw surferFailure('Induction task is outside its fixed single-proposal run.');
    const d = await o.dataset.describe(structuredClone(this.context)),
      first = this.development.cases[0]!;
    const proof = await o.dataset.describeDevelopment(structuredClone(this.context));
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
      throw surferFailure('Induction evaluator is not bound to this development cohort.');
    const execution = await this.executor.interpret(request, bound);
    if (!execution.frame)
      return { status: 'PROPOSAL_INCOMPLETE' as const, execution, evaluation: null };
    await o.source.withCurrent(request, bound.basis, bound.selections, () => true);
    const spec = {
      schemaVersion: '1.0.0',
      experimentId:
        'induction:' + surferDigest([this.development.datasetId, bound.operationId]).slice(7),
      datasetId: d.datasetId,
      datasetRevision: d.revision,
      partition: 'locked',
      selectedCandidateDigest: surferDigest(execution.frame),
      validatorRevision: 'surfer-typed-rule-validator-v1',
      policy: { minimumCorrect: 14, minimumCoverage: 1, maxOperationsPerCase: 512 },
    };
    const evaluation = await new SurferExperimentService(o.dataset, o.experiments).evaluate(
      execution.frame,
      spec,
      this.context,
    );
    return { status: 'LOCKED_EVALUATED' as const, execution, evaluation };
  }
}
