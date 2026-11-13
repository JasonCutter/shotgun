import {
  decodeSurferInductionDevelopment,
  surferInductionPages,
  type SurferInductionDatasetPort,
} from '../../../packages/contracts/src/surfer-induction.js';
import {
  decodeSurferAccessContext,
  type SurferAccessContext,
  type SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type {
  SurferBoundedProposerPort,
  SurferBoundedRequest,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferInterpretationTask } from '../../../modules/surfer-execution/src/provider-executor.js';
import { assessSurferInductionDevelopment } from '../../../modules/surfer-learning/src/development-assessment.js';
import {
  surferBoundedCandidate,
  surferBoundedExperimentSpec,
} from '../../../modules/surfer-learning/src/bounded-candidate.js';
import { SurferExperimentService } from '../../../modules/surfer-learning/src/experiment-service.js';

type Options = {
  runId: string;
  development: unknown;
  context: SurferAccessContext;
  source: SurferCognitiveSourcePort;
  proposer: SurferBoundedProposerPort;
  dataset: SurferInductionDatasetPort;
  experiments: SurferExperimentStorePort;
};
/** Source-bound local algorithm induction; never masquerades as a model response. */
export class SurferBoundedInductionTrial {
  private readonly o: Options;
  private readonly development;
  private readonly context;
  constructor(options: Options) {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(options.runId))
      throw surferFailure('Invalid local induction run.');
    this.o = { ...options };
    this.development = decodeSurferInductionDevelopment(options.development);
    this.context = decodeSurferAccessContext(options.context);
  }
  async run(actor: unknown, input: SurferInterpretationTask, signal?: AbortSignal) {
    assertSurferJson(input);
    const task = structuredClone(input),
      request = decodeSurferSourceRequest(actor),
      o = this.o;
    if (
      task.runId !== o.runId ||
      task.operationId !== 'semantic:' + o.runId + ':bounded-induction' ||
      task.attempt !== 1 ||
      task.priority !== 'FOREGROUND' ||
      request.projectId !== this.context.spaceId
    )
      throw surferFailure('Local induction task does not bind the fixed run.');
    const raw = await o.dataset.describe(structuredClone(this.context));
    assertSurferJson(raw);
    const d = structuredClone(raw),
      proof = await o.dataset.describeDevelopment(structuredClone(this.context)),
      first = this.development.cases[0]!;
    assertSurferJson(proof);
    if (
      !Number.isSafeInteger(d.revision) ||
      d.revision < 1 ||
      d.datasetId !== this.development.datasetId ||
      d.domain !== first.domain ||
      surferDigest(d.scope) !== surferDigest(first.scope) ||
      proof.datasetId !== d.datasetId ||
      proof.revision !== d.revision ||
      proof.developmentDigest !== surferDigest(this.development.cases) ||
      d.partitions.locked.count !== 16 ||
      surferDigest(d.developmentCaseIds) !==
        surferDigest(this.development.cases.map((c) => c.caseId)) ||
      surferDigest(d.developmentEventGroups) !==
        surferDigest(this.development.cases.map((c) => c.eventGroup))
    )
      throw surferFailure('Local evaluator cohort differs.');
    const binding = await o.source.withCurrent(request, task.basis, task.selections, (view) => {
      if (
        surferDigest(view.anchors.map((a) => a.rawLiteral)) !==
        surferDigest(surferInductionPages(this.development))
      )
        throw surferFailure('Local induction Source differs from development.');
      return surferDigest({
        basis: task.basis,
        selections: task.selections,
        viewDigest: view.viewDigest,
      });
    });
    const proposalRequest: SurferBoundedRequest = {
      contract: 'surfer.bounded-induction-request.v1',
      runId: task.runId,
      operationId: task.operationId + ':propose',
      spaceId: request.projectId,
      sourceDigest: binding,
      development: structuredClone(this.development),
    };
    const rawResult = await o.proposer.propose(proposalRequest, signal);
    assertSurferJson(rawResult);
    const result = structuredClone(rawResult);
    if (
      result.execution.request.executionKind !== 'LOCAL_DETERMINISTIC' ||
      result.execution.request.kind !== 'PROPOSE' ||
      result.execution.request.operationId !== proposalRequest.operationId ||
      result.execution.request.spaceId !== request.projectId ||
      (result.execution.usage &&
        ['calls', 'inputTokens', 'outputTokens', 'moneyMicros'].some(
          (k) => result.execution.usage![k as 'calls'] !== 0,
        ))
    )
      throw surferFailure('Local proposal execution binding differs.');
    if (!result.proposal)
      return {
        status: 'EXECUTION_INCOMPLETE' as const,
        result,
        candidate: null,
        assessment: null,
        evaluation: null,
      };
    const p = result.proposal;
    if (
      result.execution.state !== 'SETTLED' ||
      result.execution.outcome !== 'SUCCEEDED' ||
      result.execution.resultRef !== surferDigest(p)
    )
      throw surferFailure('Local proposal was not durably completed.');
    if (
      p.requestDigest !== surferDigest(proposalRequest) ||
      p.developmentDigest !== surferDigest(this.development)
    )
      throw surferFailure('Local proposal belongs to another input.');
    await o.source.withCurrent(request, task.basis, task.selections, () => true);
    if (p.status !== 'PROPOSED' || !p.expression)
      return {
        status: 'NO_CANDIDATE' as const,
        result,
        candidate: null,
        assessment: null,
        evaluation: null,
      };
    const candidate = surferBoundedCandidate(
      this.development,
      task.operationId,
      p,
      result.execution.reservationId,
    );
    const assessment = assessSurferInductionDevelopment(this.development, candidate);
    if (!assessment.eligible)
      return {
        status: 'DEVELOPMENT_REJECTED' as const,
        result,
        candidate,
        assessment,
        evaluation: null,
      };
    const evaluation = await new SurferExperimentService(o.dataset, o.experiments).evaluate(
      candidate,
      surferBoundedExperimentSpec(this.development, task.operationId, d.revision, candidate),
      this.context,
    );
    return { status: 'LOCKED_EVALUATED' as const, result, candidate, assessment, evaluation };
  }
}
