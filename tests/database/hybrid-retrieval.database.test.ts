import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import { InMemorySemanticActiveGenerationReader } from '../../adapters/semantic-active-generation-in-memory/src/index.js';
import {
  type EvidenceSpan,
  type KnowledgeResourceResolverPort,
  type LexicalRetrieverPort,
  type SemanticEmbeddingResolverPort,
  type SemanticProjectionGeneration,
  type SemanticProjectionItem,
  type SourceVersionResolverPort,
} from '../../packages/contracts/src/index.js';
import {
  type EvidenceSpanResolverPort,
  HybridRetrievalCoordinator,
  SemanticRetriever,
} from '../../modules/hybrid-retrieval/src/index.js';
import { DeterministicFakeEmbeddingAdapter } from '../../modules/semantic-embedding/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe('AKP-1 WP3: Hybrid Retrieval Database Integration Tests', () => {
  if (!pool) {
    it.skip('PostgreSQL test database not available', () => {});
    return;
  }

  const postgresIndexRepo = new PostgresSemanticIndexRepository(pool);
  const activeGenReader = new InMemorySemanticActiveGenerationReader();
  const fakeEmbedder = new DeterministicFakeEmbeddingAdapter({
    providerId: 'openai',
    embeddingModelId: 'text-embedding-3-small',
    dimension: 768,
  });

  const testProject = 'project-hybrid-db-test';

  const sampleGeneration: SemanticProjectionGeneration = {
    projectId: testProject,
    generationId: 'gen-hybrid-001',
    sourceProjectionDigest: 'sha256:' + '1'.repeat(64),
    canonicalBaseVersion: 1,
    credentialId: 'cred-db-1',
    credentialRevision: 1,
    providerPolicyFingerprint: 'sha256:' + '2'.repeat(64),
    providerId: 'openai',
    embeddingModelId: 'text-embedding-3-small',
    embeddingProfileId: 'prof-db-1',
    embeddingProfileRevision: 1,
    providerRegistryRevision: 'prov-reg:v1',
    capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
    representationVersion: 'semantic-representation:v1',
    dimension: 768,
    distanceMetric: 'cosine',
    normalizationPolicy: 'unit_length',
    buildStatus: 'READY',
    createdAt: '2026-08-18T10:00:00.000Z',
  };

  const resolver: SemanticEmbeddingResolverPort = {
    resolveExecution: async (input) => ({
      pin: {
        projectId: input.projectId,
        providerId: sampleGeneration.providerId,
        embeddingModelId: sampleGeneration.embeddingModelId,
        embeddingProfileId: sampleGeneration.embeddingProfileId,
        embeddingProfileRevision: sampleGeneration.embeddingProfileRevision,
        credentialId: sampleGeneration.credentialId,
        credentialRevision: sampleGeneration.credentialRevision,
        providerRegistryRevision: sampleGeneration.providerRegistryRevision,
        capabilityCatalogRevision: sampleGeneration.capabilityCatalogRevision,
        providerPolicyFingerprint: sampleGeneration.providerPolicyFingerprint,
        representationVersion: sampleGeneration.representationVersion,
        dimension: sampleGeneration.dimension,
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      profile: {
        profileId: sampleGeneration.embeddingProfileId,
        projectId: input.projectId,
        profileRevision: sampleGeneration.embeddingProfileRevision,
        providerId: sampleGeneration.providerId,
        embeddingModelId: sampleGeneration.embeddingModelId,
        credentialId: sampleGeneration.credentialId,
        credentialRevision: sampleGeneration.credentialRevision,
        representationVersion: sampleGeneration.representationVersion,
        dimension: sampleGeneration.dimension,
        distanceMetric: sampleGeneration.distanceMetric,
        normalizationPolicy: sampleGeneration.normalizationPolicy,
        status: 'ACTIVE',
        createdAt: '2026-08-18T10:00:00.000Z',
        activatedAt: '2026-08-18T10:00:00.000Z',
        updatedBy: 'admin',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      model: {
        providerId: sampleGeneration.providerId,
        modelId: sampleGeneration.embeddingModelId,
        displayName: 'Text Embedding 3 Small',
        providerDefaultDimension: 1536,
        shotgunDefaultDimension: 768,
        shotgunAllowedDimensions: [768],
        shotgunBatchLimit: 100,
        capabilityRevision: sampleGeneration.capabilityCatalogRevision,
        supportedDistanceMetrics: ['cosine'],
        defaultDistanceMetric: 'cosine',
        defaultNormalizationPolicy: 'unit_length',
      },
    }),
    resolveCompatibility: async (input) => input,
  };

  beforeEach(async () => {
    activeGenReader.clearActiveGeneration(testProject);
    await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id = $1`, [
      testProject,
    ]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM projection.semantic_generations WHERE project_id = $1`, [
        testProject,
      ]);
      await pool.end();
    }
  });

  it('performs end-to-end Hybrid retrieval with PostgreSQL persistence, Security-before-Top-K, and RRF fusion', async () => {
    await postgresIndexRepo.saveGeneration(sampleGeneration);
    activeGenReader.setActiveGeneration(sampleGeneration);

    // Embed and insert semantic items into PostgreSQL
    const embed1 = await fakeEmbedder.embed({
      text: 'Annual recurring revenue increased 40%',
      resourceType: 'CLAIM',
    });
    const embed2 = await fakeEmbedder.embed({
      text: 'Gross margin improved by 5 percentage points',
      resourceType: 'CLAIM',
    });

    const item1: SemanticProjectionItem = {
      semanticItemId: 'sem-pg-1',
      projectId: testProject,
      generationId: sampleGeneration.generationId,
      resourceType: 'CLAIM',
      resourceId: 'claim-pg-1',
      sourceProjectionDigest: sampleGeneration.sourceProjectionDigest,
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '3'.repeat(64),
      embeddingProfileId: sampleGeneration.embeddingProfileId,
      embeddingProfileRevision: sampleGeneration.embeddingProfileRevision,
      representationVersion: sampleGeneration.representationVersion,
      vector: embed1.vector,
      dimension: 768,
      evidenceIds: ['ev-pg-1'],
      accessScope: ['finance'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const item2: SemanticProjectionItem = {
      semanticItemId: 'sem-pg-2',
      projectId: testProject,
      generationId: sampleGeneration.generationId,
      resourceType: 'CLAIM',
      resourceId: 'claim-pg-2',
      sourceProjectionDigest: sampleGeneration.sourceProjectionDigest,
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:' + '4'.repeat(64),
      embeddingProfileId: sampleGeneration.embeddingProfileId,
      embeddingProfileRevision: sampleGeneration.embeddingProfileRevision,
      representationVersion: sampleGeneration.representationVersion,
      vector: embed2.vector,
      dimension: 768,
      evidenceIds: ['ev-pg-2'],
      accessScope: ['finance'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    await postgresIndexRepo.upsertItems([item1, item2]);

    const semanticRetriever = new SemanticRetriever(
      postgresIndexRepo,
      resolver,
      fakeEmbedder,
      activeGenReader,
    );

    const lexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: [
          {
            claimId: 'claim-pg-1',
            commitId: 'commit-pg-1',
            revisionId: 'rev-pg-1',
            canonicalVersion: 1,
            claimText: 'Annual recurring revenue increased 40%',
            sourceVersionId: 'src-ver-pg-1',
            evidenceIds: ['ev-pg-1'],
            accessScope: ['finance'],
            sensitivity: 'internal',
            score: 0.95,
            matchType: 'FULL_TEXT',
            rank: 1,
          },
        ],
        readiness: {
          status: 'READY',
          projectedCanonicalVersion: 1,
          canonicalVersion: 1,
          lag: 0,
          canonicalSnapshotDigest: 'sha256:snap-pg',
        },
      }),
    };

    const evidenceMap: Record<string, EvidenceSpan> = {
      'ev-pg-1': {
        evidenceId: 'ev-pg-1',
        revisionId: 'rev-pg-1',
        projectId: testProject,
        sourceId: 'src-doc-1',
        sourceVersionId: 'src-ver-pg-1',
        pointer: '/blocks/0',
        nodeKind: 'paragraph',
        origin: 'source',
        position: { type: 'TextPositionSelector', start: 0, end: 40, unit: 'unicode-code-point' },
        quote: { type: 'TextQuoteSelector', exact: 'Annual recurring revenue increased 40%' },
        exactHash: 'sha256:exact-pg1',
        accessScope: ['finance'],
        sensitivity: 'internal',
        createdAt: '2026-08-18T10:00:00.000Z',
      },
      'ev-pg-2': {
        evidenceId: 'ev-pg-2',
        revisionId: 'rev-pg-2',
        projectId: testProject,
        sourceId: 'src-doc-2',
        sourceVersionId: 'src-ver-pg-2',
        pointer: '/blocks/0',
        nodeKind: 'paragraph',
        origin: 'source',
        position: { type: 'TextPositionSelector', start: 0, end: 40, unit: 'unicode-code-point' },
        quote: { type: 'TextQuoteSelector', exact: 'Gross margin improved by 5 percentage points' },
        exactHash: 'sha256:exact-pg2',
        accessScope: ['finance'],
        sensitivity: 'internal',
        createdAt: '2026-08-18T10:00:00.000Z',
      },
    };

    const evidenceResolver: EvidenceSpanResolverPort = {
      getEvidenceSpan: async (_pId, evId) => evidenceMap[evId],
    };

    const sourceVersionResolver: SourceVersionResolverPort = {
      getSourceVersion: async (_pId, sourceVersionId) => ({
        sourceVersionId,
        projectId: testProject,
        sourceId: sourceVersionId === 'src-ver-pg-2' ? 'src-doc-2' : 'src-doc-1',
      }),
    };

    const resourceResolver: KnowledgeResourceResolverPort = {
      resolveResource: async (_pId, resourceType, resourceId) => ({
        text: `Authoritative ${resourceType}:${resourceId}`,
        canonicalVersion: 1,
        evidenceIds: [`ev-${resourceId.replace('claim-', '')}`],
        sourceVersionId: 'src-ver-pg-1',
      }),
    };

    const coordinator = new HybridRetrievalCoordinator(
      lexicalRetriever,
      semanticRetriever,
      resourceResolver,
      evidenceResolver,
      sourceVersionResolver,
      activeGenReader,
      undefined,
      { clock: () => '2026-08-18T12:00:00.000Z' },
    );

    const response = await coordinator.search({
      projectId: testProject,
      query: 'recurring revenue growth',
      accessScopes: ['finance'],
      allowedSensitivities: ['internal'],
      limit: 10,
    });

    expect(response.readiness.degraded).toBe(false);
    expect(response.readiness.semantic.status).toBe('READY');
    expect(response.items.length).toBeGreaterThanOrEqual(1);

    // claim-pg-1 matched in both lexical (rank 1) and semantic
    const topItem = response.items[0]!;
    expect(topItem.resourceId).toBe('claim-pg-1');
    expect(topItem.signals).toContain('HYBRID');
    expect(topItem.citations).toHaveLength(1);
    expect(topItem.citations[0]!.exactQuote).toBe('Annual recurring revenue increased 40%');
  });
});
