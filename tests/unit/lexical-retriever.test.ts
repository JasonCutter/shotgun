import { describe, expect, it } from 'vitest';
import {
  type CanonicalSearchResult,
  type CanonicalSnapshot,
  type ProjectionWatermark,
} from '../../packages/contracts/src/index.js';
import {
  type LexicalSearchProjectionRepositoryPort,
  LexicalRetriever,
} from '../../modules/hybrid-retrieval/src/index.js';

describe('LexicalRetriever Unit Tests', () => {
  const createRig = (options?: {
    readonly snapshot?: CanonicalSnapshot;
    readonly watermark?: ProjectionWatermark | null;
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

    const watermark: ProjectionWatermark | undefined =
      options?.watermark === null
        ? undefined
        : (options?.watermark ?? {
            projectId: 'proj-alpha',
            canonicalVersion: 2,
            snapshotDigest: 'sha256:snap-2',
            status: 'READY',
            updatedAt: '2026-08-18T10:00:00.000Z',
          });

    const recordedSearches: unknown[] = [];
    const repository: LexicalSearchProjectionRepositoryPort = {
      findWatermark: async (projectId: string) =>
        watermark && watermark.projectId === projectId ? watermark : undefined,
      search: async (
        projectId: string,
        query: string,
        limit: number,
        accessScopes: readonly string[],
      ) => {
        recordedSearches.push({ projectId, query, limit, accessScopes });
        return options?.searchResults ?? [];
      },
    };

    const retriever = new LexicalRetriever(repository, async () => snapshot);

    return { retriever, repository, recordedSearches, snapshot, watermark };
  };

  it('validates input parameters with typed ShotgunError', async () => {
    const { retriever } = createRig();

    await expect(
      retriever.retrieve({
        projectId: '',
        query: 'revenue',
        accessScopes: ['public'],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Project ID is required'),
    });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: '   ',
        accessScopes: ['public'],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Query is required'),
    });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'revenue',
        accessScopes: [],
      }),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      message: expect.stringContaining('Access scopes must be a non-empty array'),
    });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'revenue',
        accessScopes: ['public'],
        limit: 0,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('Limit must be a positive integer'),
    });
  });

  it('preserves Stage-7 empty project readiness: canonical version 0 + no watermark => READY', async () => {
    const { retriever } = createRig({
      snapshot: {
        snapshotId: 'snap-0',
        projectId: 'proj-alpha',
        version: 0,
        digest: 'sha256:empty-digest',
        claims: [],
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      watermark: null, // No watermark yet
    });

    const result = await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'anything',
      accessScopes: ['public'],
    });

    expect(result.readiness.status).toBe('READY');
    expect(result.readiness.canonicalVersion).toBe(0);
    expect(result.readiness.projectedCanonicalVersion).toBe(0);
    expect(result.readiness.lag).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('preserves Stage-7 unbuilt projection readiness: non-empty canonical (version > 0) + no watermark => STALE', async () => {
    const { retriever } = createRig({
      snapshot: {
        snapshotId: 'snap-5',
        projectId: 'proj-alpha',
        version: 5,
        digest: 'sha256:snap-5',
        claims: [],
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      watermark: null, // No watermark yet
    });

    const result = await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'revenue',
      accessScopes: ['finance'],
    });

    expect(result.readiness.status).toBe('STALE');
    expect(result.readiness.canonicalVersion).toBe(5);
    expect(result.readiness.projectedCanonicalVersion).toBe(0);
    expect(result.readiness.lag).toBe(5);
    expect(result.readiness.reason).toBe(
      'Search Projection has not processed the Canonical Commit.',
    );
    expect(result.items).toHaveLength(0);
  });

  it('preserves DEGRADED watermark status and lastError reason', async () => {
    const { retriever } = createRig({
      snapshot: {
        snapshotId: 'snap-2',
        projectId: 'proj-alpha',
        version: 2,
        digest: 'sha256:snap-2',
        claims: [],
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      watermark: {
        projectId: 'proj-alpha',
        canonicalVersion: 2,
        snapshotDigest: 'sha256:snap-2',
        status: 'DEGRADED',
        lastError: 'Search index corruption detected.',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    });

    const result = await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'revenue',
      accessScopes: ['finance'],
    });

    expect(result.readiness.status).toBe('DEGRADED');
    expect(result.readiness.reason).toBe('Search index corruption detected.');
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
