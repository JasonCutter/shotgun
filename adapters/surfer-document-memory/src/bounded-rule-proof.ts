import { decodeSurferInductionDevelopment } from '../../../packages/contracts/src/surfer-induction.js';
import {
  decodeSurferBoundedProposal,
  SURFER_BOUNDED_LIMITS,
  type SurferBoundedRequest,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferDatasetDescriptor } from '../../../packages/contracts/src/surfer-experiment.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferCompletedExperimentPort,
  SurferScopedRuleProofPort,
} from '../../../packages/contracts/src/surfer-rule-memory.js';
import type { SurferInterpretationTask } from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import {
  surferBoundedCandidate,
  surferBoundedExperimentSpec,
} from '../../../modules/surfer-learning/src/bounded-candidate.js';
import {
  validateSurferScopedRuleProof,
  surferScopedRuleSourceMatches,
} from '../../../modules/surfer-learning/src/scoped-rule-proof.js';

/** Reconstructs only an already-completed run. Cannot generate a proposal or open an evaluator. */
export class SurferBoundedRuleProofReader implements SurferScopedRuleProofPort {
  readonly proofId: string;
  private readonly p;
  constructor(
    prepared: {
      task: SurferInterpretationTask;
      development: unknown;
      descriptor: SurferDatasetDescriptor;
    },
    private readonly ledger: Pick<SurferExecutionLedger, 'read'>,
    private readonly completed: SurferCompletedExperimentPort,
  ) {
    assertSurferJson(prepared);
    this.p = structuredClone({
      ...prepared,
      development: decodeSurferInductionDevelopment(prepared.development),
    });
    const { task: t, development: dev, descriptor: d } = this.p;
    if (
      !/^[A-Za-z0-9-]{1,40}$/.test(t.runId) ||
      t.operationId !== 'semantic:' + t.runId + ':bounded-induction' ||
      t.attempt !== 1 ||
      t.priority !== 'FOREGROUND' ||
      d.datasetId !== dev.datasetId ||
      d.domain !== dev.cases[0]!.domain ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 1 ||
      d.partitions.locked.count !== 16 ||
      surferDigest(d.scope) !== surferDigest(dev.cases[0]!.scope) ||
      surferDigest(d.developmentCaseIds) !== surferDigest(dev.cases.map((c) => c.caseId)) ||
      surferDigest(d.developmentEventGroups) !== surferDigest(dev.cases.map((c) => c.eventGroup))
    )
      throw surferFailure('Prepared rule proof cohort/task differs.');
    this.proofId = surferDigest({ prepared: this.p, limits: SURFER_BOUNDED_LIMITS });
  }
  prepared(proofId: string) {
    if (proofId !== this.proofId) throw surferFailure('Unknown prepared rule proof.');
    return structuredClone({ basis: this.p.task.basis, selections: this.p.task.selections });
  }
  async read(proofId: string, currentView: SurferCognitiveView) {
    this.prepared(proofId);
    assertSurferJson(currentView);
    const view = structuredClone(currentView),
      { task, development, descriptor } = this.p;
    if (
      surferDigest(view.basis) !== surferDigest(task.basis) ||
      !surferScopedRuleSourceMatches(development, view)
    )
      throw surferFailure('Rule proof Source/development binding differs.');
    const request: SurferBoundedRequest = {
        contract: 'surfer.bounded-induction-request.v1',
        runId: task.runId,
        operationId: task.operationId + ':propose',
        spaceId: task.basis.authority.projectId,
        sourceDigest: surferDigest({
          basis: task.basis,
          selections: task.selections,
          viewDigest: view.viewDigest,
        }),
        development: structuredClone(development),
      },
      record = await this.ledger.read(surferDigest([request.operationId, 1]), request.spaceId);
    if (
      record.state !== 'SETTLED' ||
      record.outcome !== 'SUCCEEDED' ||
      record.request.kind !== 'PROPOSE' ||
      record.request.executionKind !== 'LOCAL_DETERMINISTIC' ||
      record.request.operationId !== request.operationId ||
      record.request.runId !== request.runId ||
      record.request.spaceId !== request.spaceId ||
      record.request.attempt !== 1 ||
      record.request.inputDigest !== surferDigest({ request, limits: SURFER_BOUNDED_LIMITS }) ||
      !record.usage ||
      ['calls', 'inputTokens', 'outputTokens', 'moneyMicros'].some(
        (k) => record.usage![k as 'calls'] !== 0,
      )
    )
      throw surferFailure('Rule proof has no settled local execution.');
    const proposal = decodeSurferBoundedProposal(record.checkpoint, request, SURFER_BOUNDED_LIMITS);
    if (proposal.status !== 'PROPOSED' || record.resultRef !== surferDigest(proposal))
      throw surferFailure('Rule proof checkpoint differs.');
    const candidate = surferBoundedCandidate(
        development,
        task.operationId,
        proposal,
        record.reservationId,
      ),
      spec = surferBoundedExperimentSpec(
        development,
        task.operationId,
        descriptor.revision,
        candidate,
      ),
      receipt = await this.completed.readCompleted(spec.experimentId);
    if (
      !receipt ||
      receipt.specDigest !== surferDigest(spec) ||
      receipt.datasetDigest !== descriptor.partitions.locked.digest
    )
      throw surferFailure('Rule proof requires its already-completed locked experiment.');
    return validateSurferScopedRuleProof(
      {
        contract: 'surfer.scoped-rule-proof.v1',
        proofId,
        basis: task.basis,
        selections: task.selections,
        development,
        candidate,
        receipt,
        proposalDigest: surferDigest(proposal),
        executionRequestDigest: record.requestDigest,
      },
      view,
    );
  }
}
