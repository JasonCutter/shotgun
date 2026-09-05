import { describe, expect, it, vi } from 'vitest';

import {
  ComparisonShortlistV2Service,
  type ComparisonShortlistV2Dependencies,
} from '../../modules/comparison/src/shortlist-v2.js';
import {
  canonicalSnapshotDigest,
  type CanonicalSnapshot,
  type HybridCandidateResult,
  type HybridSearchResponse,
  type LexicalCandidateResult,
  type ProjectionReadiness,
  type SemanticProjectionGeneration,
  type SemanticReadiness,
  type SecurityContext,
} from '../../packages/contracts/src/index.js';

const projectId = 'project-1';
const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'internal',
};
const actor = { type: 'user' as const, id: 'user-1' };
const claim = {
  claimId: 'claim-1',
  text: 'Canonical claim text',
  revisionNumber: 2,
  evidenceIds: ['evidence-1'],
} as const;

const snapshot: CanonicalSnapshot = {
  snapshotId: 'snapshot-7',
  projectId,
  version: 7,
  digest: canonicalSnapshotDigest(projectId, 7, [claim]),
  claims: [claim],
  createdAt: '2026-09-05T00:00:00.000Z',
};

const lexicalReadiness = (overrides: Partial<ProjectionReadiness> = {}): ProjectionReadiness => ({
  status: 'READY',
  projectedCanonicalVersion: snapshot.version,
  canonicalVersion: snapshot.version,
  lag: 0,
  projectedSnapshotDigest: snapshot.digest,
  canonicalSnapshotDigest: snapshot.digest,
  lastCommitId: 'commit-7',
  updatedAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

const lexicalItem = (overrides: Partial<LexicalCandidateResult> = {}): LexicalCandidateResult => ({
  claimId: claim.claimId,
  commitId: 'commit-7',
  revisionId: 'revision-2',
  canonicalVersion: snapshot.version,
  claimText: claim.text,
  sourceVersionId: 'source-1',
  evidenceIds: [...claim.evidenceIds],
  accessScope: [...security.accessScope],
  sensitivity: security.sensitivity,
  score: 1,
  matchType: 'FULL_TEXT',
  rank: 1,
  ...overrides,
});

const generation: SemanticProjectionGeneration = {
  projectId,
  generationId: 'generation-7',
  sourceProjectionDigest: 'sha256:semantic-projection-7',
  canonicalBaseVersion: snapshot.version,
  credentialId: 'credential-1',
  credentialRevision: 1,
  providerPolicyFingerprint: 'policy-fingerprint-1',
  providerId: 'provider-1',
  embeddingModelId: 'model-1',
  embeddingProfileId: 'profile-1',
  embeddingProfileRevision: 1,
  providerRegistryRevision: 'registry-1',
  capabilityCatalogRevision: 'catalog-1',
  representationVersion: 'representation-1',
  dimension: 3,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  buildStatus: 'READY',
  createdAt: '2026-09-05T00:00:00.000Z',
};

const semanticReadiness = (overrides: Partial<SemanticReadiness> = {}): SemanticReadiness => ({
  status: 'READY',
  data: 'READY',
  execution: 'AVAILABLE',
  activeGenerationId: generation.generationId,
  ...overrides,
});

const hybridItem = (overrides: Partial<HybridCandidateResult> = {}): HybridCandidateResult => ({
  resourceType: 'CLAIM',
  resourceId: claim.claimId,
  text: claim.text,
  authority: 'CANONICAL',
  authorityRevision: claim.revisionNumber,
  resourceRevision: claim.revisionNumber,
  canonicalVersion: snapshot.version,
  evidenceIds: [...claim.evidenceIds],
  citations: [
    {
      evidenceId: claim.evidenceIds[0]!,
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      revisionId: 'revision-2',
      exactQuote: claim.text,
    },
  ],
  accessScope: [...security.accessScope],
  sensitivity: security.sensitivity,
  signals: ['HYBRID'],
  fusionRank: 1,
  fusionScore: 1,
  ...overrides,
});

const hybridResponse = (
  items: readonly HybridCandidateResult[] = [hybridItem()],
  overrides: Partial<HybridSearchResponse> = {},
): HybridSearchResponse => ({
  schemaVersion: '1.0.0',
  projectId,
  query: 'candidate text',
  items,
  fusionPolicy: { version: 'rrf:v1', k: 60 },
  readiness: {
    lexical: lexicalReadiness(),
    semantic: semanticReadiness(),
    degraded: false,
  },
  generatedAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

const request = (claimText = 'Candidate text', k = 2) => ({
  projectId,
  candidate: { candidateId: 'candidate-1', projectId, claimText },
  actor,
  security,
  k,
});

const dependencies = (overrides: Partial<ComparisonShortlistV2Dependencies> = {}) => {
  const lexicalRetriever = {
    retrieve: vi.fn(async () => ({
      items: [lexicalItem({ claimText: 'different' })],
      readiness: lexicalReadiness(),
    })),
  };
  const hybridRetrieval = {
    search: vi.fn(async () => hybridResponse()),
  };
  const activeGenerationReader = {
    getActiveGeneration: vi.fn(async () => generation),
  };
  const deps: ComparisonShortlistV2Dependencies = {
    canonicalSnapshot: { getSnapshot: vi.fn(async () => structuredClone(snapshot)) },
    lexicalRetriever,
    hybridRetrieval,
    activeGenerationReader,
    ...overrides,
  };
  return { deps, lexicalRetriever, hybridRetrieval, activeGenerationReader };
};

describe('ComparisonShortlistV2Service', () => {
  it('S3-01 returns an exact duplicate before any hybrid/semantic call', async () => {
    const { deps, lexicalRetriever, hybridRetrieval } = dependencies();
    lexicalRetriever.retrieve.mockResolvedValue({
      items: [lexicalItem()],
      readiness: lexicalReadiness(),
    });
    const service = new ComparisonShortlistV2Service(deps);

    const result = await service.build(request(claim.text));

    expect(result).toEqual({
      status: 'EXACT_DUPLICATE',
      exactDuplicateTarget: {
        resourceType: 'CLAIM',
        resourceId: claim.claimId,
        resourceRevision: claim.revisionNumber,
        canonicalSnapshot: {
          id: snapshot.snapshotId,
          version: snapshot.version,
          digest: snapshot.digest,
        },
      },
    });
    expect(hybridRetrieval.search).not.toHaveBeenCalled();
  });

  it('S3-02 does not expose an inaccessible lexical exact result', async () => {
    const { deps, lexicalRetriever, hybridRetrieval } = dependencies();
    lexicalRetriever.retrieve.mockResolvedValue({
      items: [
        lexicalItem({
          claimId: 'secret-claim',
          claimText: 'secret-text',
          accessScope: ['restricted'],
          sensitivity: 'restricted',
        }),
      ],
      readiness: lexicalReadiness(),
    });
    hybridRetrieval.search.mockResolvedValue(hybridResponse([]));
    const result = await new ComparisonShortlistV2Service(deps).build(request('secret-text'));

    expect(result.status).toBe('BLOCKED');
    expect(JSON.stringify(result)).not.toContain('secret-claim');
    expect(JSON.stringify(result)).not.toContain('secret-text');
  });

  it('S3-03 builds a valid Claim-only READY audit with bounded targets', async () => {
    const { deps, hybridRetrieval } = dependencies();
    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([
        hybridItem(),
        hybridItem({
          resourceType: 'ENTITY',
          resourceId: 'entity-1',
          authority: 'APPROVED_KNOWLEDGE',
          authorityRevision: 1,
          resourceRevision: 1,
        }),
      ]),
    );
    const result = await new ComparisonShortlistV2Service(deps).build(request('Candidate text', 2));

    expect(result.status).toBe('READY');
    if (result.status !== 'READY') return;
    expect(result.shortlist.selectedTargetIdentities).toEqual([
      { resourceType: 'CLAIM', resourceId: claim.claimId, resourceRevision: claim.revisionNumber },
    ]);
    expect(result.shortlist.selectedTargetIdentities.length).toBeLessThanOrEqual(2);
    expect(result.shortlist.semanticGenerationId).toBe(generation.generationId);
    expect(result.shortlist.canonicalSnapshot).toEqual({
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    });
  });

  it('S3-04 produces the same shortlist digest on deterministic replay', async () => {
    const { deps } = dependencies();
    const service = new ComparisonShortlistV2Service(deps);

    const first = await service.build(request());
    const second = await service.build(request());

    expect(first.status).toBe('READY');
    expect(second.status).toBe('READY');
    if (first.status !== 'READY' || second.status !== 'READY') return;
    expect(first.shortlistDigest).toBe(second.shortlistDigest);
  });

  it('S3-05 blocks a stale lexical projection', async () => {
    const { deps, lexicalRetriever, hybridRetrieval } = dependencies();
    lexicalRetriever.retrieve.mockResolvedValue({
      items: [],
      readiness: lexicalReadiness({ status: 'STALE', lag: 1 }),
    });

    const result = await new ComparisonShortlistV2Service(deps).build(request());

    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'LEXICAL_STALE' });
    expect(hybridRetrieval.search).not.toHaveBeenCalled();
  });

  it('S3-06 blocks unavailable semantic readiness', async () => {
    const { deps, hybridRetrieval } = dependencies();
    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([], {
        readiness: {
          lexical: lexicalReadiness(),
          semantic: semanticReadiness({ status: 'UNAVAILABLE', activeGenerationId: undefined }),
          degraded: true,
        },
      }),
    );

    const result = await new ComparisonShortlistV2Service(deps).build(request());

    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'SEMANTIC_UNAVAILABLE' });
  });

  it('S3-07 blocks a semantic generation mismatch', async () => {
    const { deps, hybridRetrieval } = dependencies();
    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([hybridItem()], {
        readiness: {
          lexical: lexicalReadiness(),
          semantic: semanticReadiness({ activeGenerationId: 'generation-other' }),
          degraded: false,
        },
      }),
    );

    const result = await new ComparisonShortlistV2Service(deps).build(request());

    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'GENERATION_MISMATCH' });
  });

  it('S3-08 blocks a Claim missing from the pinned snapshot or at the wrong revision', async () => {
    const { deps, hybridRetrieval } = dependencies();
    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([hybridItem({ resourceId: 'stale-claim', text: 'stale' })]),
    );
    const missing = await new ComparisonShortlistV2Service(deps).build(request());
    expect(missing).toMatchObject({ status: 'BLOCKED', reason: 'SNAPSHOT_INTEGRITY' });

    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([hybridItem({ resourceRevision: 99, authorityRevision: 99 })]),
    );
    const wrongRevision = await new ComparisonShortlistV2Service(deps).build(request());
    expect(wrongRevision).toMatchObject({ status: 'BLOCKED', reason: 'SNAPSHOT_INTEGRITY' });
  });

  it('S3-09 over-fetches deterministically and blocks insufficient Claim coverage', async () => {
    const { deps, hybridRetrieval } = dependencies();
    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([
        hybridItem(),
        ...Array.from({ length: 7 }, (_, index) =>
          hybridItem({
            resourceType: 'ENTITY',
            resourceId: `entity-${index}`,
            authority: 'APPROVED_KNOWLEDGE',
            authorityRevision: 1,
            resourceRevision: 1,
          }),
        ),
      ]),
    );
    const result = await new ComparisonShortlistV2Service(deps).build(request('Candidate text', 2));

    expect(result).toMatchObject({
      status: 'BLOCKED',
      reason: 'INSUFFICIENT_CLAIM_COVERAGE',
    });
    expect(hybridRetrieval.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 8 }));
  });

  it('S3-10 blocks an unauthorized hybrid result without exposing its identity', async () => {
    const { deps, hybridRetrieval } = dependencies();
    hybridRetrieval.search.mockResolvedValue(
      hybridResponse([
        hybridItem({
          resourceId: claim.claimId,
          text: 'protected-text',
          accessScope: ['restricted'],
          sensitivity: 'restricted',
        }),
      ]),
    );

    const result = await new ComparisonShortlistV2Service(deps).build(request());

    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'POLICY_INTEGRITY' });
    expect(JSON.stringify(result)).not.toContain('protected-text');
  });
});
