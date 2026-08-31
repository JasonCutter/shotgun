import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendDiscoveryProductReadSource } from '../../adapters/frontend-discovery-product-postgres/src/index.js';
import type {
  ReviewDiscoveryCandidateDerivedSourceV1,
  ReviewDiscoveryCandidateReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';

const derivedCandidate = (
  findingId: string,
  findingRevision: number,
): ReviewDiscoveryCandidateDerivedSourceV1 =>
  ({
    origin: 'DERIVED_DISCOVERY',
    reviewResourceId: 'review-resource-1',
    resourceRevision: 2,
    candidateId: 'candidate-1',
    candidateRevision: 1,
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    content: {},
    evidence: [],
    impact: [],
    lineage: {
      projectId: 'project-1',
      effectiveProjectId: 'project-1',
      findingId,
      findingRevision,
    },
    contentDigest: 'sha256:content',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  }) as unknown as ReviewDiscoveryCandidateDerivedSourceV1;

describe('PostgreSQL Discovery Product Review lookup', () => {
  it('uses one exact Finding identity lookup and never falls back to a project scan', async () => {
    const calls: unknown[] = [];
    const reader: ReviewDiscoveryCandidateReader = {
      list: async () => {
        throw new Error('project-wide Review list must not be used');
      },
      find: async () => undefined,
      findByFinding: async (projectId, findingId, findingRevision) => {
        calls.push({ projectId, findingId, findingRevision });
        return derivedCandidate(findingId, findingRevision);
      },
    };
    const source = new PostgresFrontendDiscoveryProductReadSource({} as Pool, {
      reviewReader: reader,
    });
    await expect(
      source.findReviewBinding({
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 3,
      }),
    ).resolves.toMatchObject({
      projectId: 'project-1',
      findingId: 'finding-1',
      findingRevision: 3,
      resourceRevision: 2,
    });
    expect(calls).toEqual([{ projectId: 'project-1', findingId: 'finding-1', findingRevision: 3 }]);
  });

  it('fails closed when the exact reader returns a lineage mismatch', async () => {
    const reader: ReviewDiscoveryCandidateReader = {
      list: async () => {
        throw new Error('project-wide Review list must not be used');
      },
      find: async () => undefined,
      findByFinding: async () => derivedCandidate('other-finding', 1),
    };
    const source = new PostgresFrontendDiscoveryProductReadSource({} as Pool, {
      reviewReader: reader,
    });
    await expect(
      source.findReviewBinding({
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 3,
      }),
    ).resolves.toBeUndefined();
  });
});
