import { describe, expect, it } from 'vitest';
import {
  type SemanticActiveGenerationReaderPort,
  type SemanticCandidateQuery,
  type SemanticCandidateResult,
  type SemanticEmbeddingExecutionPort,
  type SemanticEmbeddingModelDescriptor,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingResolverPort,
  type SemanticIndexRepositoryPort,
  type SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import { SemanticRetriever } from '../../modules/hybrid-retrieval/src/index.js';
import { DeterministicFakeEmbeddingAdapter } from '../../modules/semantic-embedding/src/index.js';

const createSampleProfile = (
  overrides: Partial<SemanticEmbeddingProfile> = {},
): SemanticEmbeddingProfile => ({
  profileId: 'prof-1',
  projectId: 'proj-alpha',
  profileRevision: 1,
  providerId: 'openai',
  embeddingModelId: 'text-embedding-3-small',
  credentialId: 'cred-1',
  credentialRevision: 1,
  representationVersion: 'semantic-representation:v1',
  dimension: 768,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  status: 'ACTIVE',
  createdAt: '2026-08-18T10:00:00.000Z',
  activatedAt: '2026-08-18T10:00:00.000Z',
  updatedBy: 'user-admin',
  updatedAt: '2026-08-18T10:00:00.000Z',
  ...overrides,
});

const createSampleModelDescriptor = (
  overrides: Partial<SemanticEmbeddingModelDescriptor> = {},
): SemanticEmbeddingModelDescriptor => ({
  providerId: 'openai',
  modelId: 'text-embedding-3-small',
  displayName: 'Text Embedding 3 Small',
  providerDefaultDimension: 1536,
  shotgunDefaultDimension: 768,
  shotgunAllowedDimensions: [768, 1536],
  shotgunBatchLimit: 100,
  capabilityRevision: 'semantic-embedding-catalog:v1',
  supportedDistanceMetrics: ['cosine', 'dot_product', 'euclidean'],
  defaultDistanceMetric: 'cosine',
  defaultNormalizationPolicy: 'unit_length',
  ...overrides,
});

const createSampleGeneration = (
  overrides: Partial<SemanticProjectionGeneration> = {},
): SemanticProjectionGeneration => ({
  projectId: 'proj-alpha',
  generationId: 'gen-001',
  sourceProjectionDigest: 'sha256:source-proj',
  canonicalBaseVersion: 1,
  credentialId: 'cred-1',
  credentialRevision: 1,
  providerPolicyFingerprint: 'sha256:policy-fp',
  providerId: 'openai',
  embeddingModelId: 'text-embedding-3-small',
  embeddingProfileId: 'prof-1',
  embeddingProfileRevision: 1,
  providerRegistryRevision: 'prov-reg:v1',
  capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
  representationVersion: 'semantic-representation:v1',
  dimension: 768,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  buildStatus: 'READY',
  createdAt: '2026-08-18T10:00:00.000Z',
  ...overrides,
});

describe('SemanticRetriever Unit Tests', () => {
  const createRig = (options?: {
    readonly profile?: SemanticEmbeddingProfile;
    readonly generation?: SemanticProjectionGeneration | null;
    readonly nearestNeighbors?: readonly SemanticCandidateResult[];
    readonly executionPort?: SemanticEmbeddingExecutionPort;
  }) => {
    const profile = options?.profile ?? createSampleProfile();
    const model = createSampleModelDescriptor();
    const generation =
      options?.generation === null ? undefined : (options?.generation ?? createSampleGeneration());

    const fakeEmbedder =
      options?.executionPort ??
      new DeterministicFakeEmbeddingAdapter({
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        dimension: profile.dimension,
      });

    const recordedResolutions: unknown[] = [];
    const resolver: SemanticEmbeddingResolverPort = {
      resolveExecution: async (input) => {
        recordedResolutions.push(input);
        return {
          pin: {
            projectId: input.projectId,
            providerId: profile.providerId,
            embeddingModelId: profile.embeddingModelId,
            embeddingProfileId: profile.profileId,
            embeddingProfileRevision: profile.profileRevision,
            credentialId: profile.credentialId,
            credentialRevision: profile.credentialRevision,
            providerRegistryRevision: 'prov-reg:v1',
            capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
            providerPolicyFingerprint: 'sha256:policy-fp',
            representationVersion: profile.representationVersion,
            createdAt: '2026-08-18T10:00:00.000Z',
          },
          profile,
          model,
        };
      },
    };

    const recordedQueries: SemanticCandidateQuery[] = [];
    const repository: SemanticIndexRepositoryPort = {
      saveGeneration: async () => 'CREATED',
      getGeneration: async () => generation,
      listGenerations: async () => (generation ? [generation] : []),
      deleteGeneration: async () => true,
      upsertItem: async () => {},
      upsertItems: async () => {},
      getItem: async () => undefined,
      getItemBySemanticId: async () => undefined,
      deleteItem: async () => true,
      deleteItemsByGeneration: async () => 0,
      findNearestNeighbors: async (query) => {
        recordedQueries.push(query);
        return options?.nearestNeighbors ?? [];
      },
    };

    const activeGenerationReader: SemanticActiveGenerationReaderPort = {
      getActiveGeneration: async (projectId: string) => {
        if (generation && generation.projectId === projectId) {
          return generation;
        }
        return undefined;
      },
    };

    const retriever = new SemanticRetriever(
      repository,
      resolver,
      fakeEmbedder,
      activeGenerationReader,
    );

    return {
      retriever,
      recordedResolutions,
      recordedQueries,
      fakeEmbedder,
      profile,
      generation,
    };
  };

  it('validates input parameters and rejects invalid requests', async () => {
    const { retriever } = createRig();

    await expect(
      retriever.retrieve({
        projectId: '',
        query: 'test query',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow('Project ID and query are required');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: '   ',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow('Project ID and query are required');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test',
        accessScopes: [],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow('Access scopes must be a non-empty array');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test',
        accessScopes: ['public'],
        allowedSensitivities: [],
      }),
    ).rejects.toThrow('Allowed sensitivities must be provided');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: 0,
      }),
    ).rejects.toThrow('Limit must be a positive integer');

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
        limit: 101,
      }),
    ).rejects.toThrow('Limit must be a positive integer <= 100');
  });

  it('resolves execution using the highest sensitivity requested', async () => {
    const { retriever, recordedResolutions } = createRig();

    await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'what is our revenue?',
      accessScopes: ['finance', 'admin'],
      allowedSensitivities: ['public', 'internal', 'private'],
    });

    expect(recordedResolutions).toHaveLength(1);
    expect(recordedResolutions[0]).toEqual({
      projectId: 'proj-alpha',
      sensitivity: 'private',
    });
  });

  it('fails with CAPABILITY_UNAVAILABLE when no active generation exists for project', async () => {
    const { retriever } = createRig({ generation: null });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow(
      "No ready active semantic projection generation was found for project 'proj-alpha'",
    );
  });

  it('fails with CAPABILITY_UNAVAILABLE when active generation status is BUILDING or FAILED', async () => {
    const buildingGen = createSampleGeneration({ buildStatus: 'BUILDING' });
    const { retriever } = createRig({ generation: buildingGen });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow(
      "No ready active semantic projection generation was found for project 'proj-alpha'",
    );
  });

  it('fails with VALIDATION_FAILURE when active generation does not match resolved profile', async () => {
    const incompatibleGen = createSampleGeneration({
      embeddingProfileId: 'prof-different',
    });
    const { retriever } = createRig({ generation: incompatibleGen });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow(
      'Active semantic projection generation is incompatible with the resolved embedding profile',
    );
  });

  it('embeds the query with resourceType QUERY and enforces Security-before-Top-K in repository query', async () => {
    const expectedCandidate: SemanticCandidateResult = {
      semanticItemId: 'sem-1',
      projectId: 'proj-alpha',
      generationId: 'gen-001',
      resourceType: 'CLAIM',
      resourceId: 'claim-100',
      sourceProjectionDigest: 'sha256:source-proj',
      canonicalVersion: 1,
      semanticTextDigest: 'sha256:item-text',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      representationVersion: 'semantic-representation:v1',
      distance: 0.12,
      dimension: 768,
      evidenceIds: ['ev-1'],
      accessScope: ['finance'],
      sensitivity: 'internal',
      indexedAt: '2026-08-18T10:00:00.000Z',
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };

    const { retriever, recordedQueries } = createRig({
      nearestNeighbors: [expectedCandidate],
    });

    const results = await retriever.retrieve({
      projectId: 'proj-alpha',
      query: 'revenue for Q2 2026',
      accessScopes: ['finance', 'engineering'],
      allowedSensitivities: ['internal', 'public'],
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expectedCandidate);

    expect(recordedQueries).toHaveLength(1);
    const query = recordedQueries[0]!;
    expect(query.projectId).toBe('proj-alpha');
    expect(query.generationId).toBe('gen-001');
    expect(query.dimension).toBe(768);
    expect(query.queryVector).toHaveLength(768);
    expect(query.accessScopes).toEqual(['finance', 'engineering']);
    expect(query.allowedSensitivities).toEqual(['internal', 'public']);
    expect(query.limit).toBe(5);
  });

  it('validates query vector dimensions and unit length normalization', async () => {
    const badDimensionEmbedder: SemanticEmbeddingExecutionPort = {
      identity: { providerId: 'openai', embeddingModelId: 'test', dimension: 512 },
      embed: async () => ({
        vector: Array.from({ length: 512 }, () => 0.1),
        dimension: 512,
        modelId: 'test',
        providerId: 'openai',
      }),
      embedBatch: async () => [],
    };

    const { retriever } = createRig({ executionPort: badDimensionEmbedder });

    await expect(
      retriever.retrieve({
        projectId: 'proj-alpha',
        query: 'test query',
        accessScopes: ['public'],
        allowedSensitivities: ['public'],
      }),
    ).rejects.toThrow('Query vector dimension 512 does not match generation dimension 768');
  });
});
