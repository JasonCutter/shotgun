import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';
import { InMemorySemanticActiveGenerationReader } from '../../adapters/semantic-active-generation-in-memory/src/index.js';
import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import {
  type ProviderEmbeddingConnectivityPort,
  type ProviderEmbeddingRequest,
  type ProviderEmbeddingResponse,
  SemanticEmbeddingAuthorityResolver,
  SemanticEmbeddingRouter,
} from '../../adapters/semantic-embedding-resolution/src/index.js';
import { InMemorySemanticIndexRepository } from '../../adapters/semantic-index-in-memory/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  DeterministicSemanticQueryClassificationPolicy,
  HybridRetrievalCoordinator,
  SemanticRetriever,
} from '../../modules/hybrid-retrieval/src/index.js';
import { SemanticProjectionRefreshService } from '../../modules/semantic-generation/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  initialSemanticEmbeddingRegistry,
  SemanticEmbeddingProfileService,
} from '../../modules/semantic-embedding/src/index.js';
import {
  parseProviderDeploymentCeiling,
  type ProviderExternalTransferApprovalPort,
} from '../../modules/provider-privacy-policy/src/index.js';
import hybridSearchResponseSchema from '../../packages/contracts/schemas/hybrid-search-response.v1.schema.json';
import type {
  EvidenceSpan,
  LexicalCandidateResult,
  LexicalRetrieverPort,
  SemanticCandidateQuery,
  SemanticCandidateResult,
  SemanticCorpusSourceSnapshotReaderPort,
  SemanticExecutionReadiness,
  SemanticEmbeddingProfile,
  SemanticProjectionGeneration,
  SemanticQueryClassificationInput,
  SemanticQueryClassificationPort,
} from '../../packages/contracts/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';

const projectId = 'project-r4-query';
const credentialId = 'credential-r4';

const semanticExecutionReadinessValues = [
  'NOT_EVALUATED',
  'NOT_CONFIGURED',
  'AVAILABLE',
  'CREDENTIAL_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'POLICY_DENIED',
  'TEMPORARILY_UNAVAILABLE',
] as const satisfies readonly SemanticExecutionReadiness[];

class RecordingEmbeddingConnectivity implements ProviderEmbeddingConnectivityPort {
  readonly providerId = 'openai';
  calls = 0;
  secretSeen = '';
  wrongDimension = false;

  async embed(
    request: ProviderEmbeddingRequest,
    credentialBytes: Uint8Array,
  ): Promise<ProviderEmbeddingResponse> {
    this.calls++;
    this.secretSeen = new TextDecoder().decode(credentialBytes);
    const dimension = this.wrongDimension ? request.dimension - 1 : request.dimension;
    const value = 1 / Math.sqrt(dimension);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    return {
      providerId: this.providerId,
      modelId: request.modelId,
      items: inputs.map(() => ({
        vector: new Array(dimension).fill(value),
        dimension,
      })),
    };
  }
}

class RecordingSemanticIndexRepository extends InMemorySemanticIndexRepository {
  nearestNeighborCalls = 0;

  override async findNearestNeighbors(
    query: SemanticCandidateQuery,
  ): Promise<readonly SemanticCandidateResult[]> {
    this.nearestNeighborCalls++;
    return super.findNearestNeighbors(query);
  }
}

const approvalAuthority = (approved = true): ProviderExternalTransferApprovalPort => ({
  getCurrent: async (currentProjectId, providerId) =>
    approved
      ? {
          projectId: currentProjectId,
          providerId: providerId as 'openai',
          approved: true,
          approvalRevision: 1,
          reviewedBy: 'owner-r4',
          reviewedAt: '2026-08-27T00:00:00.000Z',
        }
      : undefined,
  listHistory: async () => [],
  propose: async () => {
    throw new Error('not implemented');
  },
  approve: async () => {
    throw new Error('not implemented');
  },
});

const createGeneration = (profile: SemanticEmbeddingProfile): SemanticProjectionGeneration => ({
  projectId,
  generationId: 'generation-r4',
  sourceProjectionDigest: 'sha256:source-r4',
  canonicalBaseVersion: 7,
  credentialId: profile.credentialId,
  credentialRevision: profile.credentialRevision,
  providerPolicyFingerprint: 'sha256:historical-policy',
  providerId: profile.providerId,
  embeddingModelId: profile.embeddingModelId,
  embeddingProfileId: profile.profileId,
  embeddingProfileRevision: profile.profileRevision,
  providerRegistryRevision: 'historical-provider-registry',
  capabilityCatalogRevision: 'historical-capability-catalog',
  representationVersion: profile.representationVersion,
  dimension: profile.dimension,
  distanceMetric: profile.distanceMetric,
  normalizationPolicy: profile.normalizationPolicy,
  buildStatus: 'READY',
  createdAt: '2026-08-27T00:00:00.000Z',
});

const createRig = async (
  options: {
    readonly classifier?: SemanticQueryClassificationPort;
    readonly watermarkDigest?: string;
    readonly watermarkCanonicalVersion?: number;
    readonly wrongDimension?: boolean;
    readonly activeGeneration?: boolean;
    readonly deploymentAllowsProvider?: boolean;
    readonly projectApproval?: boolean;
  } = {},
) => {
  const providerRegistry = initialProviderRegistry();
  const embeddingRegistry = initialSemanticEmbeddingRegistry();
  const credentialRepository = new InMemoryCredentialVaultRepository();
  const vault = new CredentialVaultService(
    credentialRepository,
    new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 7), keyVersion: 'r4-test' }),
  );
  const credential = await vault.create({
    projectId,
    providerId: 'openai',
    credentialId,
    secret: 'r4-test-secret',
  });
  const profileRepository = new InMemorySemanticEmbeddingProfileRepository();
  const profileService = new SemanticEmbeddingProfileService(
    providerRegistry,
    embeddingRegistry,
    profileRepository,
    vault,
    () => '2026-08-27T00:00:00.000Z',
  );
  const profile = await profileService.createProfile({
    projectId,
    expectedRevision: 0,
    providerId: 'openai',
    embeddingModelId: 'text-embedding-3-small',
    credentialId: credential.credentialId,
    credentialRevision: credential.credentialRevision,
    dimension: 512,
    status: 'ACTIVE',
    updatedBy: 'owner-r4',
    now: '2026-08-27T00:00:00.000Z',
  });
  const approval = approvalAuthority(options.projectApproval ?? true);
  const deployment = parseProviderDeploymentCeiling({
    providerAllowlist: options.deploymentAllowsProvider === false ? 'deepseek' : 'openai',
  });
  const resolver = new SemanticEmbeddingAuthorityResolver(
    providerRegistry,
    embeddingRegistry,
    profileService,
    vault,
    { approvalAuthority: approval, deploymentCeiling: deployment },
  );
  const connectivity = new RecordingEmbeddingConnectivity();
  connectivity.wrongDimension = options.wrongDimension ?? false;
  const router = new SemanticEmbeddingRouter(
    providerRegistry,
    embeddingRegistry,
    vault,
    approval,
    deployment,
    [connectivity],
  );
  const generation = createGeneration(profile);
  const repository = new RecordingSemanticIndexRepository();
  await repository.saveGeneration(generation);
  const activeReader = new InMemorySemanticActiveGenerationReader();
  if (options.activeGeneration !== false) {
    activeReader.setActiveGeneration(generation);
  }
  let watermarkDigest = options.watermarkDigest ?? generation.sourceProjectionDigest;
  let watermarkCanonicalVersion =
    options.watermarkCanonicalVersion ?? generation.canonicalBaseVersion;
  const sourceWatermarkReader = {
    readSnapshot: async () => {
      throw new Error('R4 query path must not read the full source snapshot.');
    },
    readWatermark: async () => ({
      projectId,
      canonicalVersion: watermarkCanonicalVersion,
      canonicalSnapshotDigest: 'sha256:canonical-r4',
      approvedKnowledgeDigest: 'sha256:approved-r4',
      sourceSnapshotDigest: watermarkDigest,
    }),
  } satisfies SemanticCorpusSourceSnapshotReaderPort;
  const retriever = new SemanticRetriever(repository, resolver, router, activeReader, {
    sourceWatermarkReader,
    ...(options.classifier === undefined ? {} : { queryClassifier: options.classifier }),
  });

  return {
    credential,
    profile,
    generation,
    repository,
    vault,
    connectivity,
    retriever,
    activeReader,
    setWatermark: (digest: string, canonicalVersion = generation.canonicalBaseVersion) => {
      watermarkDigest = digest;
      watermarkCanonicalVersion = canonicalVersion;
    },
    profileService,
  };
};

const query = (overrides: Record<string, unknown> = {}) => ({
  projectId,
  query: 'Which semantic source is current?',
  accessScopes: ['project:r4'],
  allowedSensitivities: ['public', 'internal', 'private', 'restricted'] as const,
  actor: { type: 'user' as const, id: 'principal-r4' },
  security: {
    accessScope: ['project:r4'],
    sensitivity: 'restricted' as const,
    dataClassification: 'user-query',
  },
  ...overrides,
});

describe('AKP-1R R4 semantic query runtime authority', () => {
  it('uses the active generation identity while allowing historical audit revisions to change', async () => {
    const rig = await createRig();

    await expect(rig.retriever.retrieve(query())).resolves.toEqual([]);
    expect(rig.connectivity.calls).toBe(1);
    expect(rig.repository.nearestNeighborCalls).toBe(1);
    expect(rig.connectivity.secretSeen).toBe('r4-test-secret');
  });

  it('classifies browser queries conservatively without allowing clearance or markers to downgrade them', () => {
    const policy = new DeterministicSemanticQueryClassificationPolicy();
    const base = {
      projectId,
      actor: { type: 'user' as const, id: 'principal-r4' },
      searchSurface: 'HYBRID_SEARCH' as const,
    };

    for (const sensitivity of ['public', 'internal', 'private', 'restricted'] as const) {
      expect(
        policy.classify({
          ...base,
          security: {
            accessScope: ['project:r4'],
            sensitivity,
            dataClassification: 'user-query',
          },
          query: 'Which semantic source is current?',
        }).classification,
      ).toBe('private');
    }

    expect(
      policy.classify({
        ...base,
        security: query().security,
        query: '[private] Which semantic source is current?',
      }).classification,
    ).toBe('private');
    expect(
      policy.classify({
        ...base,
        security: query().security,
        query: '[internal] Which semantic source is current?',
      }).classification,
    ).toBe('private');
    expect(
      policy.classify({
        ...base,
        security: query().security,
        query: '[public] Which semantic source is current?',
      }).classification,
    ).toBe('private');
    expect(
      policy.classify({
        ...base,
        security: query().security,
        query: '[restricted] Which semantic source is current?',
      }).classification,
    ).toBe('restricted');
  });

  it('keeps the semantic execution readiness TypeScript contract aligned with its JSON schema', () => {
    const schemaExecutionValues = (
      hybridSearchResponseSchema.$defs as unknown as {
        semanticReadiness: { properties: { execution: { enum: readonly string[] } } };
      }
    ).semanticReadiness.properties.execution.enum;

    expect(schemaExecutionValues).toEqual(semanticExecutionReadinessValues);
  });

  it('denies an ordinary private query without deployment permission before provider or Top-K work', async () => {
    const rig = await createRig({ deploymentAllowsProvider: false });

    await expect(rig.retriever.retrieve(query())).rejects.toMatchObject({
      embeddingErrorCode: 'POLICY_DENIED',
    });
    expect(rig.connectivity.calls).toBe(0);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('denies an ordinary private query without Project approval before provider or Top-K work', async () => {
    const rig = await createRig({ projectApproval: false });

    await expect(rig.retriever.retrieve(query())).rejects.toMatchObject({
      embeddingErrorCode: 'POLICY_DENIED',
    });
    expect(rig.connectivity.calls).toBe(0);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('detects known STALE before provider, vault callback, or semantic Top-K work', async () => {
    let classifierCalls = 0;
    const rig = await createRig({
      watermarkDigest: 'sha256:changed-source',
      classifier: {
        classify: () => {
          classifierCalls++;
          return { classification: 'private', policyRevision: 'semantic-query-classification:v1' };
        },
      },
    });

    await expect(rig.retriever.retrieve(query())).rejects.toMatchObject({
      embeddingErrorCode: 'STALE',
    });
    expect(classifierCalls).toBe(0);
    expect(rig.connectivity.calls).toBe(0);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('projects STALE before query classification while preserving healthy lexical results', async () => {
    let classifierCalls = 0;
    const rig = await createRig({
      watermarkDigest: 'sha256:changed-source',
      classifier: {
        classify: () => {
          classifierCalls++;
          return { classification: 'private', policyRevision: 'semantic-query-classification:v1' };
        },
      },
    });
    const lexicalItem: LexicalCandidateResult = {
      claimId: 'claim-r4-stale-lexical',
      commitId: 'commit-r4-stale-lexical',
      revisionId: 'revision-r4-stale-lexical',
      canonicalVersion: 7,
      claimText: 'Lexical results remain available while semantic data is stale.',
      sourceVersionId: 'source-r4-stale-lexical',
      evidenceIds: ['evidence-r4-stale-lexical'],
      accessScope: ['project:r4'],
      sensitivity: 'internal',
      score: 1,
      matchType: 'FULL_TEXT',
      rank: 1,
    };
    const evidence: EvidenceSpan = {
      evidenceId: lexicalItem.evidenceIds[0]!,
      revisionId: lexicalItem.revisionId,
      projectId,
      sourceId: 'source-r4-stale-lexical',
      sourceVersionId: lexicalItem.sourceVersionId,
      pointer: '/blocks/0',
      nodeKind: 'paragraph',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 10, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: lexicalItem.claimText },
      exactHash: 'sha256:stale-quote-r4',
      accessScope: ['project:r4'],
      sensitivity: 'internal',
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const coordinator = new HybridRetrievalCoordinator(
      {
        retrieve: async () => ({
          items: [lexicalItem],
          readiness: {
            status: 'READY' as const,
            projectedCanonicalVersion: 7,
            canonicalVersion: 7,
            lag: 0,
            canonicalSnapshotDigest: 'sha256:canonical-r4',
          },
        }),
      },
      rig.retriever,
      undefined,
      { getEvidenceSpan: async () => evidence },
      {
        getSourceVersion: async () => ({
          sourceVersionId: lexicalItem.sourceVersionId,
          projectId,
          sourceId: evidence.sourceId,
        }),
      },
      rig.activeReader,
    );

    const response = await coordinator.search(query());

    expect(response.items.map((item) => item.resourceId)).toEqual([lexicalItem.claimId]);
    expect(response.readiness.semantic).toMatchObject({
      status: 'STALE',
      data: 'STALE',
      execution: 'NOT_EVALUATED',
    });
    expect(classifierCalls).toBe(0);
    expect(rig.connectivity.calls).toBe(0);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('keeps caller clearance independent from server-owned query egress classification', async () => {
    const inputs: SemanticQueryClassificationInput[] = [];
    const policy = new DeterministicSemanticQueryClassificationPolicy();
    const classifier: SemanticQueryClassificationPort = {
      classify: (input) => {
        inputs.push(input);
        return policy.classify(input);
      },
    };
    const rig = await createRig({ classifier });

    await rig.retriever.retrieve(query({ allowedSensitivities: ['public'] }));
    expect(inputs[0]?.security.sensitivity).toBe('restricted');
    expect(inputs[0]?.query).toBe('Which semantic source is current?');
    expect(inputs[0] && policy.classify(inputs[0]).classification).toBe('private');
    expect(rig.connectivity.calls).toBe(1);
  });

  it('denies a restricted provider egress classification before provider or Top-K work', async () => {
    const rig = await createRig();

    await expect(
      rig.retriever.retrieve(query({ query: '[restricted] Which semantic source is current?' })),
    ).rejects.toMatchObject({
      embeddingErrorCode: 'POLICY_DENIED',
    });
    expect(rig.connectivity.calls).toBe(0);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('blocks an exact revoked credential revision without mutating the READY generation', async () => {
    const rig = await createRig();
    await rig.vault.revoke({
      projectId,
      providerId: 'openai',
      credentialId,
      credentialRevision: 1,
    });

    await expect(rig.retriever.retrieve(query())).rejects.toMatchObject({
      embeddingErrorCode: 'CAPABILITY_UNAVAILABLE',
    });
    expect(rig.connectivity.calls).toBe(0);
    expect(
      (await rig.repository.getGeneration(projectId, rig.generation.generationId))?.buildStatus,
    ).toBe('READY');
  });

  it('rejects a provider response whose vector identity or dimension differs from the generation', async () => {
    const rig = await createRig({ wrongDimension: true });

    await expect(rig.retriever.retrieve(query())).rejects.toMatchObject({
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });
    expect(rig.connectivity.calls).toBe(1);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('keeps lexical search healthy when normal semantic runtime is constructed but no generation exists', async () => {
    const rig = await createRig({ activeGeneration: false });
    const lexicalItem: LexicalCandidateResult = {
      claimId: 'claim-r4-lexical',
      commitId: 'commit-r4-lexical',
      revisionId: 'revision-r4-lexical',
      canonicalVersion: 1,
      claimText: 'Lexical fallback remains available.',
      sourceVersionId: 'source-r4-lexical',
      evidenceIds: ['evidence-r4-lexical'],
      accessScope: ['project:r4'],
      sensitivity: 'internal',
      score: 1,
      matchType: 'FULL_TEXT',
      rank: 1,
    };
    const lexicalRetriever: LexicalRetrieverPort = {
      retrieve: async () => ({
        items: [lexicalItem],
        readiness: {
          status: 'READY',
          projectedCanonicalVersion: 1,
          canonicalVersion: 1,
          lag: 0,
          canonicalSnapshotDigest: 'sha256:lexical',
        },
      }),
    };
    const evidence: EvidenceSpan = {
      evidenceId: lexicalItem.evidenceIds[0]!,
      revisionId: lexicalItem.revisionId,
      projectId,
      sourceId: 'source-r4-lexical',
      sourceVersionId: lexicalItem.sourceVersionId,
      pointer: '/blocks/0',
      nodeKind: 'paragraph',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 10, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Lexical fallback remains available.' },
      exactHash: 'sha256:quote-r4',
      accessScope: ['project:r4'],
      sensitivity: 'internal',
      createdAt: '2026-08-27T00:00:00.000Z',
    };
    const coordinator = new HybridRetrievalCoordinator(
      lexicalRetriever,
      rig.retriever,
      {
        resolveResource: async () => ({
          text: lexicalItem.claimText,
          authority: 'CANONICAL',
          authorityRevision: lexicalItem.canonicalVersion,
          resourceRevision: lexicalItem.canonicalVersion,
          sourceVersionId: lexicalItem.sourceVersionId,
          evidenceIds: lexicalItem.evidenceIds,
          accessScope: lexicalItem.accessScope,
          sensitivity: lexicalItem.sensitivity,
        }),
      },
      { getEvidenceSpan: async () => evidence },
      {
        getSourceVersion: async () => ({
          sourceVersionId: lexicalItem.sourceVersionId,
          projectId,
          sourceId: evidence.sourceId,
        }),
      },
      rig.activeReader,
    );

    const response = await coordinator.search(query());
    expect(response.items.map((item) => item.resourceId)).toEqual([lexicalItem.claimId]);
    expect(response.readiness.lexical.status).toBe('READY');
    expect(response.readiness.semantic).toMatchObject({
      status: 'NOT_CONFIGURED',
      data: 'NO_ACTIVE_GENERATION',
      execution: 'NOT_CONFIGURED',
    });
    expect(rig.connectivity.calls).toBe(0);
    expect(rig.repository.nearestNeighborCalls).toBe(0);
  });

  it('resolves the refresh target profile server-side and delegates to the R3 builder', async () => {
    const rig = await createRig();
    const buildInputs: { projectId: string; targetProfileRevision: number }[] = [];
    const refresh = new SemanticProjectionRefreshService(rig.profileService, {
      build: async (input) => {
        buildInputs.push(input);
        return {
          projectId,
          generationId: 'generation-refresh',
          status: 'ACTIVATED' as const,
          generation: rig.generation,
          itemCount: 0,
          membershipDigest: 'sha256:membership',
        };
      },
    });

    await expect(
      refresh.refresh({
        projectId,
        actor: { type: 'user', id: 'owner-r4' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'internal',
          dataClassification: 'product-command',
        },
      }),
    ).resolves.toMatchObject({
      projectId,
      profileRevision: rig.profile.profileRevision,
      generationId: 'generation-refresh',
    });
    expect(buildInputs).toEqual([
      { projectId, targetProfileRevision: rig.profile.profileRevision },
    ]);
  });

  it('rejects Browser refresh authority fields and derives the project from trusted session context', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'r4-route-owner',
      projectId: 'project-r4-route',
      scopes: ['owner', 'admin'],
      sensitivityClearance: 'internal',
    });
    const principal = await auth.findPrincipalByAccountId('r4-route-owner');
    if (!principal) throw new Error('R4 route principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      'project-r4-route',
      '2099-01-01T00:00:00.000Z',
    );
    const received: string[] = [];
    const app = await createApplication({
      authRepository: auth,
      semanticProjectionRefresh: {
        refresh: async (input) => {
          received.push(input.projectId);
          return {
            projectId: input.projectId,
            profileRevision: 1,
            status: 'ACTIVATED',
            generationId: 'generation-route',
            itemCount: 0,
            membershipDigest: 'sha256:route',
          };
        },
      },
    });
    const headers = {
      cookie: `shotgun_session=${session.sessionToken}`,
      'x-csrf-token': session.csrfToken,
    };

    const rejected = await app.server.inject({
      method: 'POST',
      url: '/projection/semantic/refresh',
      headers,
      payload: { projectId: 'attacker-project', profileRevision: 99 },
    });
    expect(rejected.statusCode).toBe(400);
    expect(received).toEqual([]);

    const accepted = await app.server.inject({
      method: 'POST',
      url: '/projection/semantic/refresh',
      headers,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    expect(received).toEqual(['project-r4-route']);
    await app.server.close();
  });
});
