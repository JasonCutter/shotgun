import { describe, expect, it } from 'vitest';

import { comparisonV2ReviewProductFailure } from '../../assemblies/shotgun-app/src/product-api/review-v2-failure.js';
import type { ComparisonV2ReviewBridgeBlockedReason } from '../../modules/change-set-review/src/index.js';

const reasons: readonly ComparisonV2ReviewBridgeBlockedReason[] = [
  'INVALID_REQUEST',
  'AUTHORITY_NOT_ACTIVE',
  'AUTHORITY_CONFLICT',
  'AGGREGATE_NOT_FOUND',
  'AGGREGATE_INVALID',
  'EVENT_LINEAGE_MISMATCH',
  'ACCESS_DENIED',
  'FRESHNESS_UNAVAILABLE',
  'STALE_COMPARISON',
  'REVIEW_NOT_ELIGIBLE',
  'DECISION_UNAVAILABLE',
  'DECISION_CONFLICT',
  'DECISION_STALE',
];

describe('Comparison V2 Review Product failure mapping', () => {
  it('maps every bridge blocked reason to the shared Product error contract', () => {
    for (const reason of reasons) {
      const failure = comparisonV2ReviewProductFailure(reason);
      expect(failure.code).toBeTruthy();
      expect(failure.message).not.toContain(reason);
    }
  });

  it('maps freshness unavailability to actionable Review staleness', () => {
    expect(comparisonV2ReviewProductFailure('FRESHNESS_UNAVAILABLE')).toEqual({
      code: 'REVIEW_CONTEXT_STALE',
      message:
        'This Review is no longer fresh. Refresh or recompare the Candidate before approving it.',
    });
  });

  it('keeps draft/event lineage mismatch distinct from freshness unavailability', () => {
    expect(comparisonV2ReviewProductFailure('EVENT_LINEAGE_MISMATCH')).toEqual({
      code: 'REVIEW_TARGET_CHANGED',
      message: 'The reviewed target changed. Refresh before retrying.',
    });
  });
});
