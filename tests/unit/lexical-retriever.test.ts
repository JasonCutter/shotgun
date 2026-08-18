import { describe, expect, it } from 'vitest';
import {
  type CanonicalSearchResult,
  type CanonicalSnapshot,
  type ProjectionWatermark,
} from '../../packages/contracts/src/index.js';
import type { SearchProjectionRepositoryPort } from '../../modules/projection-search/src/index.js';
import { LexicalRetriever } from '../../modules/hybrid-retrieval/src/index.js';

describe('LexicalRetriever Unit Tests', () => {
  const createRig = (options?: {
    readonly snapshot?: CanonicalSnapshot;
    readonly watermark?: ProjectionWatermark;
    readonly searchResults?: readonly CanonicalSearchResult[];
  }) => {
    const snapshot: CanonicalSnapshot = options?.snapshot ?? {
      snapshotId: 'snap-1',
      projectId: 'proj-alpha',
      version: 2,
      digest: 'sha256:snap-2',
      claims: [],
      createdAt: '2026-08-18T10:00:00.000Z',
    };

    const watermark: ProjectionWatermark = options?.watermark ?? {
      projectId: 'proj-alpha',
      canonicalVersion: 2,
      snapshotDigest: 'sha256:snap-2',
      status: 'READY',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const recordedSearches: unknown[] = [];
    const repository: SearchProjectionRepositoryPort = {
      applyCommit: async () => {},
      rebuild: async () => {},
      markDegraded: async () => {},
      findWatermark: async (projectId: string) =>
        watermark.projectId === projectId ? watermark : undefined,
      search: async (projectId, query, limit, accessScopes) => {
        recordedSearches.push({ projectId, query, limit, accessScopes });
        return options?.searchResults ?? [];
      },
    };

    const retriever = new LexicalRetriever(repository, async () => snapshot);

    return { retriever, repository, recordedSearches, snapshot, watermark };
  };

  it('validates input parameters', async () => {
    const { retriever } = createRig();

    await expect(
      retriever.retrieve({
        projectId: '',
        query: 'revenue',
        accessScopes: ['public'],
      }),
    ).rejects.toThrow('Project ID and query are required for lexical retrieval.');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: '   ',
        accessScopes: ['public'],
      }),
    ).rejects.toThrow('Project ID and query are required for lexical retrieval.');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'revenue',
        accessScopes: [],
      }),
    ).rejects.toThrow('Access scopes must be a non-empty array for lexical retrieval.');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'revenue',
        accessScopes: ['public'],
        limit: 0,
      }),
    ).rejects.toThrow('Limit must be a positive integer');
  });

  it('returns empty items when projection readiness is STALE or DEGRADED', async () => {
    const { retriever } = createRig({
      snapshot: {
        snapshotId: 'snap-5',
        projectId: 'proj-alpha',
        version: 5,
        digest: 'sha256:snap-5',
        claims: [],
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      watermark: {
        projectId: 'proj-alpha',
        canonicalVersion: 2,
        snapshotDigest: 'sha256:snap-2',
        status: 'READY',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    });

    const result = await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'revenue',
      accessScopes: ['finance'],
    });

    expect(result.readiness.status).toBe('STALE');
    expect(result.items).toHaveLength(0);
  });

  it('delegates to Stage 7 repository when READY and maps to LexicalCandidateResult with ranks', async () => {
    const sampleResults: CanonicalSearchResult[] = [
      {
        projectId: 'proj-alpha',
        claimId: 'claim-1',
        commitId: 'commit-1',
        revisionId: 'rev-1',
        canonicalVersion: 2,
        claimText: 'Revenue grew 25% year-over-year.',
        sourceVersionId: 'src-ver-1',
        evidenceIds: ['ev-100'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        projectedAt: '2026-08-18T10:00:00.000Z',
        score: 0.95,
        matchType: 'FULL_TEXT',
      },
      {
        projectId: 'proj-alpha',
        claimId: 'claim-2',
        commitId: 'commit-2',
        revisionId: 'rev-2',
        canonicalVersion: 2,
        claimText: 'Net profit increased by 15%.',
        sourceVersionId: 'src-ver-2',
        evidenceIds: ['ev-200'],
        accessScope: ['finance'],
        sensitivity: 'internal',
        projectedAt: '2026-08-18T10:00:00.000Z',
        score: 0.75,
        matchType: 'TRIGRAM',
      },
    ];

    const { retriever, recordedSearches } = createRig({
      searchResults: sampleResults,
    });

    const result = await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'revenue profit',
      accessScopes: ['finance'],
      limit: 10,
    });

    expect(result.readiness.status).toBe('READY');
    expect(result.items).toHaveLength(2);

    expect(result.items[0]).toEqual({
      claimId: 'claim-1',
      commitId: 'commit-1',
      revisionId: 'rev-1',
      canonicalVersion: 2,
      claimText: 'Revenue grew 25% year-over-year.',
      sourceVersionId: 'src-ver-1',
      evidenceIds: ['ev-100'],
      accessScope: ['finance'],
      sensitivity: 'internal',
      score: 0.95,
      matchType: 'FULL_TEXT',
      rank: 1,
    });

    expect(result.items[1]).toEqual({
      claimId: 'claim-2',
      commitId: 'commit-2',
      revisionId: 'rev-2',
      canonicalVersion: 2,
      claimText: 'Net profit increased by 15%.',
      sourceVersionId: 'src-ver-2',
      evidenceIds: ['ev-200'],
      accessScope: ['finance'],
      sensitivity: 'internal',
      score: 0.75,
      matchType: 'TRIGRAM',
      rank: 2,
    });

    expect(recordedSearches).toHaveLength(1);
    expect(recordedSearches[0]).toEqual({
      projectId: 'proj-alpha',
      query: 'revenue profit',
      limit: 10,
      accessScopes: ['finance'],
    });
  });
});
