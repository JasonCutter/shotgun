import type { SurferInductionDevelopment } from '../../../packages/contracts/src/surfer-induction.js';
import type { SurferBoundedProposal } from '../../../packages/contracts/src/surfer-bounded-induction.js';
import type { SurferExperimentSpec } from '../../../packages/contracts/src/surfer-experiment.js';
import {
  decodeSurferRuleCandidate,
  surferDigest,
  type SurferRuleCandidate,
} from '../../../packages/contracts/src/surfer-learning.js';

/** Shared with trial and read-only proof reconstruction; preserves original candidate/spec digests. */
export function surferBoundedCandidate(
  development: SurferInductionDevelopment,
  operationId: string,
  proposal: SurferBoundedProposal,
  reservationId: string,
) {
  const first = development.cases[0]!;
  return decodeSurferRuleCandidate({
    schemaVersion: '1.0.0',
    candidateId:
      'bounded-induction:' +
      surferDigest([development.datasetId, operationId, proposal.expression]).slice(7),
    domain: first.domain,
    scope: first.scope,
    origin: 'INDUCTION',
    description:
      'Finite grammar candidate consistent with observed development;not causal or universal truth.',
    conclusionKey: 'observedOutcome',
    expression: proposal.expression,
    developmentCaseIds: development.cases.map((c) => c.caseId),
    assumptions: [
      'Finite comparison/Boolean grammar;unseen values/categories and causal validity are unvalidated.',
    ],
    proposer: { provider: 'local-symbolic', model: proposal.revision, executionId: reservationId },
  });
}
export function surferBoundedExperimentSpec(
  development: SurferInductionDevelopment,
  operationId: string,
  revision: number,
  candidate: SurferRuleCandidate,
): SurferExperimentSpec {
  return {
    schemaVersion: '1.0.0',
    experimentId:
      'bounded-induction:' + surferDigest([development.datasetId, operationId]).slice(7),
    datasetId: development.datasetId,
    datasetRevision: revision,
    partition: 'locked',
    selectedCandidateDigest: surferDigest(candidate),
    validatorRevision: 'surfer-typed-rule-validator-v1',
    policy: { minimumCorrect: 14, minimumCoverage: 1, maxOperationsPerCase: 512 },
  };
}
