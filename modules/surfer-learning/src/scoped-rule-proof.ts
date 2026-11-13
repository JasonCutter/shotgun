import type { SurferScopedRuleProof } from '../../../packages/contracts/src/surfer-rule-memory.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import { decodeSurferObservationSelections } from '../../../packages/contracts/src/surfer-cognition.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  decodeSurferInductionDevelopment,
  surferInductionPages,
} from '../../../packages/contracts/src/surfer-induction.js';
import {
  assertSurferJson,
  decodeSurferRuleCandidate,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { assessSurferInductionDevelopment } from './development-assessment.js';

/** Structural/content checks supplement the trusted execution/experiment owner, never replace it. */
export function surferScopedRuleSourceMatches(
  development: unknown,
  view: SurferCognitiveView,
): boolean {
  // JSONB may reorder payload object keys. Compare parsed page content while the execution
  // request's Source/view digest continues to pin the original raw bytes and positions.
  try {
    const pages = surferInductionPages(development);
    return (
      view.anchors.length === pages.length &&
      pages.every(
        (page, i) =>
          surferDigest(JSON.parse(page)) === surferDigest(JSON.parse(view.anchors[i]!.rawLiteral)),
      )
    );
  } catch {
    return false;
  }
}
export function validateSurferScopedRuleProof(
  input: unknown,
  view: SurferCognitiveView,
): SurferScopedRuleProof {
  assertSurferJson(input);
  const p = structuredClone(input) as SurferScopedRuleProof;
  if (
    !p ||
    Object.keys(p).sort().join(',') !==
      'basis,candidate,contract,development,executionRequestDigest,proofId,proposalDigest,receipt,selections' ||
    p.contract !== 'surfer.scoped-rule-proof.v1' ||
    [p.proofId, p.proposalDigest, p.executionRequestDigest].some(
      (v) => typeof v !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v),
    )
  )
    throw surferFailure('Invalid scoped rule proof.');
  assertSurferSourceBasisV2(p.basis);
  p.selections = decodeSurferObservationSelections({
    schemaVersion: '1.0.0',
    selections: p.selections,
  }).selections;
  p.development = decodeSurferInductionDevelopment(p.development);
  p.candidate = decodeSurferRuleCandidate(p.candidate);
  const r = p.receipt,
    levels = { public: 0, internal: 1, private: 2, restricted: 3 },
    scope = {
      spaceId: p.basis.authority.projectId,
      accessScope: [...new Set(view.anchors.flatMap((a) => a.scope.accessScope))].sort(),
      sensitivity: view.anchors.reduce(
        (s, a) => (levels[a.scope.sensitivity] > levels[s] ? a.scope.sensitivity : s),
        'public' as keyof typeof levels,
      ),
    };
  if (
    !p.selections.length ||
    p.selections.length > 16 ||
    surferDigest(view.basis) !== surferDigest(p.basis) ||
    !surferScopedRuleSourceMatches(p.development, view) ||
    surferDigest(scope) !== surferDigest(p.candidate.scope) ||
    p.candidate.proposer.provider !== 'local-symbolic' ||
    !assessSurferInductionDevelopment(p.development, p.candidate).eligible ||
    !r ||
    r.status !== 'SCOPE_VALIDATED' ||
    r.candidateDigest !== surferDigest(p.candidate) ||
    surferDigest(r.scope) !== surferDigest(scope) ||
    r.total !== 16 ||
    !Number.isSafeInteger(r.correct) ||
    r.correct < 14 ||
    r.correct > 16 ||
    r.unknown !== 0 ||
    r.accuracy !== r.correct / r.total ||
    r.coverage !== 1 ||
    r.evidenceLevel !== 'CONTROLLED_DATASET_ONLY' ||
    r.semanticAssessment !== 'NOT_EVALUATED' ||
    r.validatorRevision !== 'surfer-typed-rule-validator-v1' ||
    !Array.isArray(r.caseResults) ||
    r.caseResults.length !== 16 ||
    new Set(r.caseResults.map((c) => c.caseId)).size !== 16 ||
    r.caseResults.some(
      (c) => !['TRUE', 'FALSE'].includes(c.prediction) || typeof c.correct !== 'boolean',
    ) ||
    r.caseResults.filter((c) => c.correct).length !== r.correct
  )
    throw surferFailure('Scoped rule proof is unvalidated or differs from current Source.');
  return p;
}
