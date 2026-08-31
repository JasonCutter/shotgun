import {
  FRONTEND_REVIEW_DOMAIN_VERSION,
  sha256Text,
  stableJson,
  type ReviewTargetKindV1,
} from '@shotgun/api-client';

/**
 * The Review route accepts a stable resource identity and resolves its
 * server-issued context revision from the existing Review queue. The browser
 * never treats the derived value as authority; it is only a deep-link key.
 */
export const reviewContextIdForResource = (
  targetKind: ReviewTargetKindV1,
  reviewResourceId: string,
): string =>
  sha256Text(
    stableJson({
      domain: 'frontend-review',
      version: FRONTEND_REVIEW_DOMAIN_VERSION,
      kind: 'context',
      targetKind,
      reviewResourceId,
    }),
  );
