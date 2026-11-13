import {
  decodeSurferRepairRequest,
  SURFER_REPLACEMENT_REVISION,
  type SurferRepairProposal,
} from '../../../packages/contracts/src/surfer-rule-replacement.js';
import {
  decodeSurferBoundedLimits,
  SURFER_BOUNDED_LIMITS,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { searchSurferFiniteComparison } from './finite-comparison.js';
export function proposeSurferReplacement(input: unknown): SurferRepairProposal {
  const request = decodeSurferRepairRequest(input),
    limits = decodeSurferBoundedLimits(SURFER_BOUNDED_LIMITS);
  return {
    contract: 'surfer.replacement-proposal.v1',
    revision: SURFER_REPLACEMENT_REVISION,
    requestDigest: surferDigest(request),
    limitsDigest: surferDigest(limits),
    developmentDigest: surferDigest(request.development),
    ...searchSurferFiniteComparison(request.development.cases, limits),
  };
}
