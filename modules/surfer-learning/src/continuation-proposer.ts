import {
  decodeSurferContinuationRequest,
  SURFER_CONTINUATION_REVISION,
  type SurferContinuationProposal,
} from '../../../packages/contracts/src/surfer-rule-continuation.js';
import {
  decodeSurferBoundedLimits,
  SURFER_BOUNDED_LIMITS,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { searchSurferFiniteComparison } from './finite-comparison.js';
export function proposeSurferContinuation(input: unknown): SurferContinuationProposal {
  const request = decodeSurferContinuationRequest(input),
    limits = decodeSurferBoundedLimits(SURFER_BOUNDED_LIMITS);
  return {
    contract: 'surfer.continuation-proposal.v1',
    revision: SURFER_CONTINUATION_REVISION,
    requestDigest: surferDigest(request),
    limitsDigest: surferDigest(limits),
    developmentDigest: surferDigest(request.development),
    ...searchSurferFiniteComparison(request.development.cases, limits),
  };
}
