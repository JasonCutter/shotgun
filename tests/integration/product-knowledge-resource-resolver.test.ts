import { describe, expect, it } from 'vitest';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  type CompiledTruthProjection,
  type HybridCandidateResult,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
  type SemanticProjectionGeneration,
  type SemanticRetrieverPort,
} from '../../packages/contracts/src/index.js';
import type { EvidenceCandidate } from '../../modules/evidence/src/index.js';
import { InMemorySemanticActiveGenerationReader } from '../../adapters/semantic-active-generation-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';

describe('ProductKnowledgeResourceResolver & Application Composition Tests', () => {
  it('resolves all six frozen semantic resource types in Product composition', async () => {
    const projectId = 'proj-product-test';

    const activeGen: SemanticProjectionGeneration = {
      projectId,
      generationId: 'gen-prod-001',
      sourceProjectionDigest: 'sha256:src-digest',
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
    };

    const activeGenerationReader = new InMemorySemanticActiveGenerationReader();
    activeGenerationReader.setActiveGeneration(activeGen);

    const semanticRetriever: SemanticRetrieverPort = {
      retrieve: async () => [],
    };

    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'test-owner',
      projectId,
      scopes: ['owner', 'admin', 'member', 'finance'],
      sensitivityClearance: 'restricted',
    });
    const principal = await auth.findPrincipalByAccountId('test-owner');
    if (!principal) throw new Error('Fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );

    const app = await createApplication({
      production: false,
      authRepository: auth,
      semanticRetriever,
      semanticActiveGenerationReader: activeGenerationReader,
    });

    const { repositories, server } = app;

    // 1. Populate Original Asset & SourceVersion
    const stored = await repositories.originalAsset.store({
      submissionId: 'sub-100',
      projectId,
      actorId: 'test-owner',
      channel: 'file_upload',
      materialKind: 'document',
      mediaType: 'application/pdf',
      originalFileName: 'report.pdf',
      contentHash: 'sha256:asset',
      sizeBytes: 1024,
      storageKey: 'assets/100',
      accessScope: ['finance'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
    });

    const sourceVersionId = stored.sourceVersionId;
    const sourceId = stored.sourceId;

    // 2. Populate EvidenceSpan
    const evidenceCandidate: EvidenceCandidate = {
      revisionId: 'rev-100',
      projectId,
      sourceId,
      sourceVersionId,
      pointer: '/blocks/0',
      nodeKind: 'paragraph',
      origin: 'source',
      position: { type: 'TextPositionSelector', start: 0, end: 40, unit: 'unicode-code-point' },
      quote: { type: 'TextQuoteSelector', exact: 'Quarterly financial report evidence.' },
      exactHash: 'sha256:exact',
      accessScope: ['finance'],
      sensitivity: 'internal',
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    const indexedEvidence = await repositories.evidence.index([evidenceCandidate]);
    const evidenceSpan = indexedEvidence.items[0]!;
    const evidenceId = evidenceSpan.evidenceId;

    // Configure semantic retriever to return semantic candidates for all 6 frozen types
    (semanticRetriever as { retrieve: () => Promise<readonly unknown[]> }).retrieve = async () => [
      {
        semanticItemId: 'sem-claim',
        projectId,
        generationId: 'gen-prod-001',
        resourceType: 'CLAIM',
        resourceId: 'claim-100',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-claim',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.1,
        dimension: 768,
        evidenceIds: [evidenceId],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-entity',
        projectId,
        generationId: 'gen-prod-001',
        resourceType: 'ENTITY',
        resourceId: 'entity-100',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-entity',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.11,
        dimension: 768,
        evidenceIds: [evidenceId],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-rel',
        projectId,
        generationId: 'gen-prod-001',
        resourceType: 'RELATION',
        resourceId: 'rel-100',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-rel',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.12,
        dimension: 768,
        evidenceIds: [evidenceId],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-event',
        projectId,
        generationId: 'gen-prod-001',
        resourceType: 'EVENT',
        resourceId: 'event-100',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-event',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.13,
        dimension: 768,
        evidenceIds: [evidenceId],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-dec',
        projectId,
        generationId: 'gen-prod-001',
        resourceType: 'DECISION',
        resourceId: 'dec-100',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-dec',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.14,
        dimension: 768,
        evidenceIds: [evidenceId],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        semanticItemId: 'sem-fact',
        projectId,
        generationId: 'gen-prod-001',
        resourceType: 'FACT',
        resourceId: 'fact-100',
        sourceProjectionDigest: 'sha256:src-digest',
        canonicalVersion: 1,
        semanticTextDigest: 'sha256:text-fact',
        embeddingProfileId: 'prof-1',
        embeddingProfileRevision: 1,
        representationVersion: 'semantic-representation:v1',
        distance: 0.15,
        dimension: 768,
        evidenceIds: [evidenceId],
        accessScope: ['finance'],
        sensitivity: 'internal',
        indexedAt: '2026-08-18T10:00:00.000Z',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ];

    // 3. Populate Canonical Knowledge for CLAIM
    const snapshot = await repositories.canonical.getSnapshot(projectId);
    await repositories.canonical.commitFrontendDraft({
      commitId: 'commit-frontend-100',
      revisionId: 'rev-front-100',
      historyEventId: 'hist-front-100',
      outboxId: 'outbox-front-100',
      projectId,
      expectedCanonicalVersion: snapshot.version,
      snapshotDigest: snapshot.digest,
      operation: 'ADD_CLAIM',
      claimId: 'claim-100',
      claimText: 'Canonical claim statement from repository.',
      sourceVersionId,
      evidenceIds: [evidenceId],
      accessScope: ['finance'],
      sensitivity: 'internal',
      actor: { type: 'user', id: 'user-admin' },
      authority: {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: 'appr-100',
        approvalBindingDigest: 'sha256:appr',
        reviewContextId: 'rc-100',
        contextRevision: 1,
        draftId: 'draft-100',
        draftRevision: 1,
        draftContentDigest: 'sha256:draft',
        approvedItemIds: ['claim-100'],
      },
      reason: 'Approved in review',
      committedAt: '2026-08-18T10:00:00.000Z',
    });

    // 4. Populate Knowledge Model for ENTITY, RELATION, EVENT, DECISION
    const entityCand: KnowledgeCandidate = {
      candidateId: 'entity-100',
      candidateType: 'ENTITY',
      name: 'Global Tech Holdings',
      entityKind: 'ORGANIZATION',
      aliases: [],
      resolution: { status: 'NEW' },
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [],
    };

    const relCand: KnowledgeCandidate = {
      candidateId: 'rel-100',
      candidateType: 'RELATION',
      fromCandidateId: 'entity-100',
      toCandidateId: 'entity-200',
      relationType: 'OPERATES_IN',
      direction: 'DIRECTED',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [],
    };

    const eventCand: KnowledgeCandidate = {
      candidateId: 'event-100',
      candidateType: 'EVENT',
      title: 'Q2 Earnings Call',
      participantCandidateIds: ['entity-100'],
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [],
    };

    const decCand: KnowledgeCandidate = {
      candidateId: 'dec-100',
      candidateType: 'DECISION',
      decisionText: 'Authorized expansion into new market.',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [],
    };

    const reviewGroup: KnowledgeReviewGroup = {
      groupId: 'grp-100',
      projectId,
      revisionNumber: 1,
      sourceVersionId,
      contentDigest: 'sha256:grp-100',
      status: 'APPROVED',
      accessScope: ['finance'],
      sensitivity: 'internal',
      items: [entityCand, relCand, eventCand, decCand],
      decisions: [],
      createdAt: '2026-08-18T10:00:00.000Z',
      updatedAt: '2026-08-18T10:00:00.000Z',
    };
    await repositories.knowledge.saveGroup(reviewGroup);

    // 5. Populate Compiled Truth for FACT
    const compiledProjection: CompiledTruthProjection = {
      projectId,
      projectorVersion: '1.0.0',
      sourceSnapshotDigest: 'sha256:snap-digest',
      logicalDigest: 'sha256:logical-digest',
      canonicalVersion: 1,
      items: [
        {
          id: 'fact-100',
          type: 'CLAIM',
          label: 'Revenue: $500M in Q2',
          state: 'CURRENT',
          source: 'APPROVED_KNOWLEDGE',
          evidenceIds: [evidenceId],
          accessScope: ['finance'],
          sensitivity: 'internal',
        },
      ],
      graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
      projectedAt: '2026-08-18T10:00:00.000Z',
      buildMode: 'FULL_REBUILD',
    };
    await repositories.compiledTruth.synchronize(compiledProjection);

    // Query via Product /search/hybrid endpoint
    const response = await server.inject({
      method: 'POST',
      url: '/search/hybrid',
      headers: {
        cookie: `shotgun_session=${session.sessionToken}`,
        'x-csrf-token': session.csrfToken,
      },
      payload: {
        query: 'comprehensive knowledge search',
        limit: 10,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const hybridSearch = body.hybridSearch;
    expect(hybridSearch).toBeDefined();

    expect(hybridSearch.items).toHaveLength(6);

    const typeMap = new Map(
      (hybridSearch.items as readonly HybridCandidateResult[]).map((i) => [i.resourceType, i]),
    );

    // CLAIM
    const claim = typeMap.get('CLAIM');
    expect(claim).toBeDefined();
    expect(claim!.text).toBe('Canonical claim statement from repository.');
    expect(claim!.citations).toHaveLength(1);
    expect(claim!.citations[0]!.evidenceId).toBe(evidenceId);

    // ENTITY
    const entity = typeMap.get('ENTITY');
    expect(entity).toBeDefined();
    expect(entity!.text).toBe('Global Tech Holdings');
    expect(entity!.citations).toHaveLength(1);

    // RELATION
    const relation = typeMap.get('RELATION');
    expect(relation).toBeDefined();
    expect(relation!.text).toBe('entity-100 OPERATES_IN entity-200');
    expect(relation!.citations).toHaveLength(1);

    // EVENT
    const event = typeMap.get('EVENT');
    expect(event).toBeDefined();
    expect(event!.text).toBe('Q2 Earnings Call');
    expect(event!.citations).toHaveLength(1);

    // DECISION
    const decision = typeMap.get('DECISION');
    expect(decision).toBeDefined();
    expect(decision!.text).toBe('Authorized expansion into new market.');
    expect(decision!.citations).toHaveLength(1);

    // FACT
    const fact = typeMap.get('FACT');
    expect(fact).toBeDefined();
    expect(fact!.text).toBe('Revenue: $500M in Q2');
    expect(fact!.canonicalVersion).toBe(1);
    expect(fact!.citations).toHaveLength(1);
  });
});
