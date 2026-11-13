import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  decodeSurferLearningCase,
  decodeSurferRuleCandidate,
  surferDigest,
  surferFailure,
  type SurferScope,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferAccessContext,
  decodeSurferExperimentSpec,
  type SurferAccessContext,
  type SurferExperimentDatasetPort,
  type SurferExperimentReceipt,
  type SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import { evaluateSurferRule } from './rule-interpreter.js';

const sensitivity = { public: 0, internal: 1, private: 2, restricted: 3 };
function authorize(context: SurferAccessContext, scope: SurferScope): void {
  if (
    context.spaceId !== scope.spaceId ||
    !scope.accessScope.every((s) => context.accessScope.includes(s)) ||
    sensitivity[context.clearance] < sensitivity[scope.sensitivity]
  ) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Surfer experiment scope is not authorized.',
      module: 'surfer',
      operation: 'authorize-experiment',
    });
  }
}
const scopeDigest = (scope: SurferScope): string =>
  surferDigest({ ...scope, accessScope: [...scope.accessScope].sort() });

export class SurferExperimentService {
  constructor(
    private readonly dataset: SurferExperimentDatasetPort,
    private readonly store: SurferExperimentStorePort,
  ) {}

  async evaluate(
    candidateInput: unknown,
    specInput: unknown,
    contextInput: unknown,
  ): Promise<{ readonly receipt: SurferExperimentReceipt; readonly replayed: boolean }> {
    const candidate = decodeSurferRuleCandidate(candidateInput);
    const spec = decodeSurferExperimentSpec(specInput);
    const context = decodeSurferAccessContext(contextInput);
    authorize(context, candidate.scope);
    const descriptorInput = await this.dataset.describe(context);
    assertSurferJson(descriptorInput);
    const descriptor = structuredClone(descriptorInput);
    authorize(context, descriptor.scope);
    if (
      descriptor.datasetId !== spec.datasetId ||
      descriptor.revision !== spec.datasetRevision ||
      descriptor.domain !== candidate.domain ||
      scopeDigest(descriptor.scope) !== scopeDigest(candidate.scope)
    ) {
      throw surferFailure('Experiment/candidate/dataset binding mismatch.');
    }
    const candidateDigest = surferDigest(candidate);
    if (
      spec.selectedCandidateDigest !== candidateDigest ||
      candidate.developmentCaseIds.some((id) => !descriptor.developmentCaseIds.includes(id))
    ) {
      throw surferFailure('Candidate is not bound to the selected development data.');
    }
    const partition = descriptor.partitions[spec.partition];
    const reservation = {
      experimentId: spec.experimentId,
      selectionKey: surferDigest({
        datasetId: spec.datasetId,
        partition: spec.partition,
        partitionDigest: partition.digest,
        scopeDigest: scopeDigest(descriptor.scope),
      }),
      meaningDigest: surferDigest({ spec, candidateDigest, partition, scope: descriptor.scope }),
    };
    const claim = await this.store.claim(reservation);
    if (claim.state === 'COMPLETED')
      return { receipt: structuredClone(claim.receipt), replayed: true };
    if (claim.state !== 'CLAIMED') {
      throw new ShotgunError({
        code: claim.state === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'CONFLICT',
        safeMessage:
          'Experiment is already running or terminal; a holdout cannot be silently reused.',
        module: 'surfer',
        operation: 'claim-experiment',
      });
    }
    let receipt: SurferExperimentReceipt;
    try {
      const rawInput = await this.dataset.read(context, spec.partition);
      assertSurferJson(rawInput);
      const raw = structuredClone(rawInput);
      const inputIds = raw.inputs.map((item) => item.caseId),
        expectedIds = raw.expected.map((item) => item.caseId);
      const groups = raw.inputs.map((item) => item.eventGroup);
      if (
        raw.inputs.length !== partition.count ||
        new Set(inputIds).size !== inputIds.length ||
        new Set(expectedIds).size !== expectedIds.length ||
        new Set(groups).size !== groups.length ||
        inputIds.length !== expectedIds.length ||
        inputIds.some(
          (id) => !expectedIds.includes(id) || descriptor.developmentCaseIds.includes(id),
        ) ||
        groups.some((g) => descriptor.developmentEventGroups.includes(g))
      ) {
        throw surferFailure(
          'Evaluation data overlaps development, duplicates events, or is incomplete.',
        );
      }
      const cases = raw.inputs.map((input) =>
        decodeSurferLearningCase({
          ...input,
          observedOutcome: raw.expected.find((item) => item.caseId === input.caseId)?.outcome,
        }),
      );
      for (const row of cases) {
        authorize(context, row.scope);
        if (
          row.domain !== candidate.domain ||
          scopeDigest(row.scope) !== scopeDigest(descriptor.scope)
        )
          throw surferFailure('Evaluation row is outside the bound domain/scope.');
      }
      if (surferDigest(cases) !== partition.digest)
        throw surferFailure('Evaluation dataset digest changed.');
      let totalOperations = 0;
      const caseResults = cases.map((row) => {
        const result = evaluateSurferRule(candidate.expression, row.features, {
          maxOperations: spec.policy.maxOperationsPerCase,
        });
        totalOperations += result.operations;
        return {
          caseId: row.caseId,
          prediction: result.outcome,
          correct:
            result.outcome !== 'UNKNOWN' && (result.outcome === 'TRUE') === row.observedOutcome,
          reasons: result.reasons,
        };
      });
      const total = cases.length,
        unknown = caseResults.filter((row) => row.prediction === 'UNKNOWN').length;
      const correct = caseResults.filter((row) => row.correct).length;
      const coverage = total ? (total - unknown) / total : null;
      const status =
        !total || !coverage || coverage < spec.policy.minimumCoverage
          ? 'INSUFFICIENT'
          : correct >= spec.policy.minimumCorrect
            ? 'SCOPE_VALIDATED'
            : 'REFUTED';
      receipt = {
        experimentId: spec.experimentId,
        candidateDigest,
        specDigest: surferDigest(spec),
        datasetDigest: partition.digest,
        validatorRevision: spec.validatorRevision,
        scope: structuredClone(descriptor.scope),
        status,
        total,
        correct,
        unknown,
        accuracy: total ? correct / total : null,
        coverage,
        totalOperations,
        evidenceLevel: 'CONTROLLED_DATASET_ONLY',
        semanticAssessment: 'NOT_EVALUATED',
        caseResults,
      };
    } catch (error) {
      await this.store.fail(reservation, 'FAILED');
      throw error;
    }
    try {
      await this.store.complete(reservation, receipt);
    } catch (error) {
      await this.store.fail(reservation, 'OUTCOME_UNKNOWN');
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage:
          'Experiment completion could not be confirmed; do not re-evaluate the holdout.',
        module: 'surfer',
        operation: 'complete-experiment',
        cause: error,
      });
    }
    return { receipt: structuredClone(receipt), replayed: false };
  }
}
