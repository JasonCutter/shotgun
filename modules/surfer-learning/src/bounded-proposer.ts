import {
  decodeSurferBoundedRequest,
  decodeSurferBoundedLimits,
  SURFER_BOUNDED_REVISION,
  type SurferBoundedProposal,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { searchSurferFiniteComparison } from './finite-comparison.js';
/** Original v1 envelope and limits remain unchanged. */
export function proposeSurferBoundedComparison(
  requestInput: unknown,
  limitsInput: unknown,
): SurferBoundedProposal {
  const request = decodeSurferBoundedRequest(requestInput),
    limits = decodeSurferBoundedLimits(limitsInput);
  return {
    contract: 'surfer.bounded-induction-proposal.v1',
    revision: SURFER_BOUNDED_REVISION,
    requestDigest: surferDigest(request),
    limitsDigest: surferDigest(limits),
    developmentDigest: surferDigest(request.development),
    ...searchSurferFiniteComparison(request.development.cases, limits),
  };
}
