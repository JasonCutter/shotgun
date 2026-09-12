import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresOriginalAssetRepository,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresEvidenceRepository } from '../../adapters/postgres-stage3/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import {
  PostgresSemanticActiveGenerationReader,
  PostgresSemanticIndexRepository,
} from '../../adapters/semantic-index-postgres/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';
import {
  AskCommandCoordinator,
  type AskReadScope,
} from '../../modules/frontend-ask-write/src/index.js';
import type { AskExecutionScope } from '../../modules/frontend-ask-execution/src/index.js';
import {
  HybridRetrievalCoordinator,
  LexicalRetriever,
  ProductKnowledgeResourceResolver,
  SemanticRetriever,
} from '../../modules/hybrid-retrieval/src/index.js';
import { askExecutionContextDigest } from '../../modules/frontend-ask-execution/src/index.js';
import type {
  HybridCandidateResult,
  HybridRetrievalCoordinatorPort,
  HybridSearchResponse,
  HybridRetrievalInput,
  SemanticEmbeddingResolverPort,
  SemanticEmbeddingRouterPort,
  SemanticProjectionGeneration,
  SemanticProjectionItem,
} from '../../packages/contracts/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  canonicalSnapshotDigest,
  sha256Text,
  type CanonicalClaim,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

type AskFixture = {
  readonly projectId: string;
  readonly principalId: string;
  readonly readScope: AskReadScope;
  readonly scope: AskExecutionScope;
  readonly workspace: PostgresAskWorkspaceProjection;
  readonly coordinator: AskCommandCoordinator;
};

const createFixture = async (label: string): Promise<AskFixture> => {
  const suffix = randomUUID();
  const projectId = `issue-277-${label}-${suffix}`;
  const accountId = `issue-277-account-${suffix}`;
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId,
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: `issue-277-project-command-${suffix}`,
    clientRequestId: `issue-277-project-request-${suffix}`,
    idempotencyKey: `issue-277-project-idempotency-${suffix}`,
    projectId,
    name: `Issue 277 ${label}`,
    description: 'Focused Ask CANONICAL_ONLY hybrid retrieval fixture',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  await new PostgresAuthRepository(pool).createProjectOwnerMembership({
    principalId: principal.principalId,
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });

  const scope: AskExecutionScope = {
    principalId: principal.principalId,
    projectId,
    accessRevision: `issue-277-access-${suffix}`,
    policyContextRevision: `issue-277-policy-${suffix}`,
    sensitivityClearance: 'private',
    accessScope: ['owner'],
  };
  const readScope: AskReadScope = {
    ...scope,
    sessionId: `issue-277-session-${suffix}`,
    activeProject: {
      id: projectId,
      label: `Issue 277 ${label}`,
      isOwner: true,
      sensitivityClearance: 'private',
    },
    accessibleProjects: [
      {
        id: projectId,
        label: `Issue 277 ${label}`,
        isOwner: true,
        sensitivityClearance: 'private',
      },
    ],
    executionAuthorities: {
      [projectId]: {
        projectId,
        accessRevision: scope.accessRevision,
        policyContextRevision: scope.policyContextRevision,
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
    },
  };
  const workspace = new PostgresAskWorkspaceProjection(pool);
  const coordinator = new AskCommandCoordinator(
    new PostgresFrontendCommandGateway(pool),
    new PostgresAskConversationRepository(pool),
    workspace,
    new PostgresAskSourceSelectionValidator(pool),
    { enqueue: async () => undefined },
  );
  return {
    projectId,
    principalId: principal.principalId,
    readScope,
    scope,
    workspace,
    coordinator,
  };
};

const makeCandidate = (input: {
  readonly resourceType?: HybridCandidateResult['resourceType'];
  readonly authority?: HybridCandidateResult['authority'];
  readonly accessScope?: readonly string[];
  readonly sensitivity?: HybridCandidateResult['sensitivity'];
  readonly citations?: HybridCandidateResult['citations'];
}): HybridCandidateResult => ({
  resourceType: input.resourceType ?? 'CLAIM',
  resourceId: `${input.resourceType ?? 'CLAIM'}-${randomUUID()}`,
  text: 'Canonical claim fixture text.',
  authority: input.authority ?? 'CANONICAL',
  authorityRevision: 1,
  canonicalVersion: 3,
  evidenceIds: (input.citations ?? []).map((citation) => citation.evidenceId),
  citations: input.citations ?? [],
  accessScope: input.accessScope ?? ['owner'],
  sensitivity: input.sensitivity ?? 'private',
  signals: ['HYBRID'],
  fusionRank: 1,
  fusionScore: 1,
});

const makeResponse = (
  input: HybridRetrievalInput,
  items: readonly HybridCandidateResult[],
): HybridSearchResponse => ({
  schemaVersion: '1.0.0',
  projectId: input.projectId,
  query: input.query,
  items,
  fusionPolicy: { version: 'rrf:v1', k: 60 },
  readiness: {
    lexical: {
      status: 'READY',
      projectedCanonicalVersion: 3,
      canonicalVersion: 3,
      lag: 0,
      canonicalSnapshotDigest: 'sha256:canonical-fixture',
    },
    semantic: {
      status: 'READY',
      data: 'READY',
      execution: 'AVAILABLE',
      activeGenerationId: 'generation-fixture',
      embeddingProfileId: 'profile-fixture',
      dimension: 3,
    },
    degraded: false,
  },
  generatedAt: '2026-09-12T00:00:00.000Z',
});

const seedRealHybridChain = async (fixture: AskFixture) => {
  const suffix = randomUUID();
  const now = '2026-09-12T00:00:00.000Z';
  const sourceText = `Orion operational facts ${suffix}.`;
  const originalAssets = new PostgresOriginalAssetRepository(pool);
  const stored = await originalAssets.store({
    submissionId: `issue-277-source-${suffix}`,
    projectId: fixture.projectId,
    actorId: fixture.principalId,
    channel: 'direct_text',
    materialKind: 'plain_text',
    mediaType: 'text/plain',
    contentHash: sha256Text(sourceText),
    sizeBytes: Buffer.byteLength(sourceText),
    storageKey: `issue-277/${suffix}/source.txt`,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: now,
  });
  const revisionId = randomUUID();
  const claimDrafts: readonly Omit<CanonicalClaim, 'evidenceIds'>[] = [
    {
      claimId: `issue-277-claim-backup-${suffix}`,
      projectId: fixture.projectId,
      revisionNumber: 1,
      claimText: 'Orion backups start at 02:00 every day.',
      sourceVersionId: stored.sourceVersionId,
      createdFromManifestId: null,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: now,
    },
    {
      claimId: `issue-277-claim-deploy-${suffix}`,
      projectId: fixture.projectId,
      revisionNumber: 1,
      claimText: 'Orion production deployments use the stable channel.',
      sourceVersionId: stored.sourceVersionId,
      createdFromManifestId: null,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: now,
    },
  ];
  const evidenceByClaim = new Map<string, string>();
  for (const claim of claimDrafts) evidenceByClaim.set(claim.claimId, randomUUID());
  const claims: CanonicalClaim[] = claimDrafts.map((claim) => ({
    ...claim,
    evidenceIds: [evidenceByClaim.get(claim.claimId)!],
  }));
  const sourceHash = sha256Text(sourceText);
  await pool.query(
    `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, 'issue-277-fixture', '1.0.0', $6::jsonb, $7::jsonb,
             $5, $8, $9, 'private', $10)`,
    [
      revisionId,
      fixture.projectId,
      stored.sourceId,
      stored.sourceVersionId,
      sourceHash,
      JSON.stringify({ mediaType: 'text/plain' }),
      JSON.stringify({}),
      sha256Text('issue-277-source-map'),
      ['owner'],
      now,
    ],
  );
  for (const claim of claims) {
    const evidenceId = evidenceByClaim.get(claim.claimId)!;
    const quote = claim.claimText;
    await pool.query(
      `INSERT INTO evidence.spans
         (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
          node_kind, origin, position, quote, selectors, exact_hash, access_scope,
          sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'sentence', 'source', $7::jsonb,
               $8::jsonb, '[]'::jsonb, $9, $10, 'private', $11)`,
      [
        evidenceId,
        revisionId,
        fixture.projectId,
        stored.sourceId,
        stored.sourceVersionId,
        `/claims/${claim.claimId}`,
        JSON.stringify({
          type: 'TextPositionSelector',
          start: 0,
          end: Array.from(quote).length,
          unit: 'unicode-code-point',
        }),
        JSON.stringify({ type: 'TextQuoteSelector', exact: quote }),
        sha256Text(quote),
        ['owner'],
        now,
      ],
    );
  }
  const snapshotDigest = canonicalSnapshotDigest(
    fixture.projectId,
    claims.length,
    claims.map((claim) => ({
      claimId: claim.claimId,
      text: claim.claimText,
      revisionNumber: claim.revisionNumber,
      evidenceIds: claim.evidenceIds,
    })),
  );
  await pool.query(
    `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
     VALUES ($1, $2, $3, $4)`,
    [fixture.projectId, claims.length, snapshotDigest, now],
  );
  for (const claim of claims) {
    await pool.query(
      `INSERT INTO canonical.claims
         (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        claim.claimId,
        fixture.projectId,
        stored.sourceVersionId,
        randomUUID(),
        JSON.stringify(claim),
        now,
      ],
    );
  }
  const commitIds: string[] = [];
  for (const claim of claims) {
    const commitId = randomUUID();
    commitIds.push(commitId);
    await pool.query(
      `INSERT INTO projection.search_documents
         (project_id, claim_id, commit_id, revision_id, canonical_version, claim_text,
          source_version_id, evidence_ids, access_scope, sensitivity, projected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'private', $10)`,
      [
        fixture.projectId,
        claim.claimId,
        commitId,
        `issue-277-projection-${claim.claimId}`,
        claims.length,
        claim.claimText,
        stored.sourceVersionId,
        claim.evidenceIds,
        ['owner'],
        now,
      ],
    );
  }
  await pool.query(
    `INSERT INTO projection.watermarks
       (project_id, last_commit_id, canonical_version, snapshot_digest, status, updated_at)
     VALUES ($1, $2, $3, $4, 'READY', $5)`,
    [fixture.projectId, commitIds.at(-1), claims.length, snapshotDigest, now],
  );

  const corpusWatermark = await new PostgresSemanticCorpusSourceSnapshotReader(pool).readWatermark(
    fixture.projectId,
  );
  const generationId = randomUUID();
  const generation: SemanticProjectionGeneration = {
    projectId: fixture.projectId,
    generationId,
    sourceProjectionDigest: corpusWatermark.sourceSnapshotDigest,
    canonicalBaseVersion: claims.length,
    credentialId: 'issue-277-deterministic-credential',
    credentialRevision: 1,
    providerPolicyFingerprint: sha256Text('issue-277-provider-policy'),
    providerId: 'openai',
    embeddingModelId: 'text-embedding-3-small',
    embeddingProfileId: 'issue-277-profile',
    embeddingProfileRevision: 1,
    providerRegistryRevision: 'provider-registry:v1',
    capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
    representationVersion: 'semantic-representation:v2',
    dimension: 3,
    distanceMetric: 'cosine',
    normalizationPolicy: 'unit_length',
    buildStatus: 'READY',
    createdAt: now,
  };
  const semanticRepository = new PostgresSemanticIndexRepository(pool);
  await semanticRepository.saveGeneration(generation);
  const semanticItems: SemanticProjectionItem[] = claims.map((claim) => ({
    semanticItemId: `issue-277-semantic-${claim.claimId}`,
    projectId: fixture.projectId,
    generationId,
    resourceType: 'CLAIM',
    resourceId: claim.claimId,
    sourceProjectionDigest: corpusWatermark.sourceSnapshotDigest,
    canonicalVersion: claims.length,
    semanticTextDigest: sha256Text(claim.claimText),
    embeddingProfileId: generation.embeddingProfileId,
    embeddingProfileRevision: generation.embeddingProfileRevision,
    representationVersion: generation.representationVersion,
    vector: [1, 0, 0],
    dimension: generation.dimension,
    evidenceIds: claim.evidenceIds,
    accessScope: ['owner'],
    sensitivity: 'private',
    providerId: generation.providerId,
    embeddingModelId: generation.embeddingModelId,
    normalizationPolicy: generation.normalizationPolicy,
    authority: 'CANONICAL',
    provenance: {
      authority: 'CANONICAL',
      resourceBaseId: claim.claimId,
      resourceRevision: claim.revisionNumber,
      baseCanonicalVersion: claims.length,
      sourceVersionId: claim.sourceVersionId,
      evidenceIds: claim.evidenceIds,
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    indexedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  await semanticRepository.upsertItems(semanticItems);
  await semanticRepository.activateGeneration({
    projectId: fixture.projectId,
    generationId,
    expectedPointer: { kind: 'NONE' },
    sourceProjectionDigest: generation.sourceProjectionDigest,
    canonicalBaseVersion: generation.canonicalBaseVersion,
    updatedAt: now,
  });

  const lexicalRetriever = new LexicalRetriever(
    new PostgresSearchProjectionRepository(pool),
    (projectId) => new PostgresCanonicalKnowledgeRepository(pool).getSnapshot(projectId),
  );
  const semanticResolver: SemanticEmbeddingResolverPort = {
    resolveCompatibility: async (input) => input,
    resolveExecution: async () => {
      throw new Error('The deterministic router path must not call resolveExecution.');
    },
  };
  const semanticRouter: SemanticEmbeddingRouterPort = {
    embed: async (pin) => ({
      vector: [1, 0, 0],
      dimension: pin.dimension,
      modelId: pin.embeddingModelId,
      providerId: pin.providerId,
    }),
    embedBatch: async (pin, payloads) =>
      payloads.map(() => ({
        vector: [1, 0, 0],
        dimension: pin.dimension,
        modelId: pin.embeddingModelId,
        providerId: pin.providerId,
      })),
  };
  const activeGenerationReader = new PostgresSemanticActiveGenerationReader(semanticRepository);
  const semanticRetriever = new SemanticRetriever(
    semanticRepository,
    semanticResolver,
    semanticRouter,
    activeGenerationReader,
    { sourceWatermarkReader: new PostgresSemanticCorpusSourceSnapshotReader(pool) },
  );
  const hybrid = new HybridRetrievalCoordinator(
    lexicalRetriever,
    semanticRetriever,
    new ProductKnowledgeResourceResolver(new PostgresCanonicalKnowledgeRepository(pool)),
    {
      getEvidenceSpan: async (projectId, evidenceId) =>
        new PostgresEvidenceRepository(pool).findById(projectId, evidenceId),
    },
    {
      getSourceVersion: async (projectId, sourceVersionId) => {
        const original = await new PostgresOriginalAssetRepository(pool).findByVersion(
          projectId,
          sourceVersionId,
        );
        return original
          ? { projectId: original.projectId, sourceId: original.sourceId, sourceVersionId }
          : undefined;
      },
    },
    activeGenerationReader,
  );
  return { claims, generation, hybrid, lexicalRetriever };
};

const submitCanonicalOnly = async (fixture: AskFixture, question: string) =>
  fixture.coordinator.submitQuestion({
    ...fixture.readScope,
    request: {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: `issue-277-request-${randomUUID()}`,
      idempotencyKey: `issue-277-idempotency-${randomUUID()}`,
      question,
      mode: 'CANONICAL_ONLY',
      sourceSelections: [],
    },
  });

const sourceCitation = (input: {
  readonly evidenceId: string;
  readonly sourceId?: string;
  readonly sourceVersionId?: string;
  readonly exactQuote?: string;
}) => ({
  evidenceId: input.evidenceId,
  sourceId: input.sourceId ?? 'source-fixture',
  sourceVersionId: input.sourceVersionId ?? 'source-version-fixture',
  revisionId: 'revision-fixture',
  exactQuote: input.exactQuote ?? `Exact quote for ${input.evidenceId}.`,
});

describe('Issue #277 Ask CANONICAL_ONLY hybrid retrieval boundary', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('uses the shared Hybrid authority, filters to Canonical Claims, and preserves citations', async () => {
    const fixture = await createFixture('supported');
    const question =
      'What are the Orion backup time, deployment channel, and archival policy in one answer?';
    const chain = await seedRealHybridChain(fixture);
    const lexical = await chain.lexicalRetriever.retrieve({
      projectId: fixture.projectId,
      query: question,
      accessScopes: ['owner'],
      limit: 100,
    });
    expect(lexical.items).toEqual([]);
    const hybridResponse = await chain.hybrid.search({
      projectId: fixture.projectId,
      query: question,
      accessScopes: ['owner'],
      allowedSensitivities: ['public', 'internal', 'private'],
      actor: { type: 'user', id: fixture.principalId },
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'ask-canonical-only',
      },
      limit: 100,
    });
    expect(hybridResponse.readiness).toMatchObject({
      degraded: false,
      lexical: { status: 'READY', lag: 0 },
      semantic: {
        status: 'READY',
        data: 'READY',
        execution: 'AVAILABLE',
        activeGenerationId: chain.generation.generationId,
      },
    });
    expect(hybridResponse.items.map((item) => item.resourceType)).toEqual(['CLAIM', 'CLAIM']);
    expect(hybridResponse.items.every((item) => item.authority === 'CANONICAL')).toBe(true);
    const repository = new PostgresAskAnswerExecutionRepository(
      pool,
      fixture.workspace,
      { resolve: async () => undefined },
      chain.hybrid,
    );
    const submission = await submitCanonicalOnly(fixture, question);
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context).toMatchObject({
      contextStatus: 'SUPPORTED',
      queryPlanRevision: 'ask-query-plan-v5',
    });
    expect(context?.evidence.map((item) => item.evidenceId)).toEqual(
      chain.claims.flatMap((claim) => claim.evidenceIds).sort(),
    );
    expect(context?.evidence[0]).toMatchObject({
      sourceId: expect.any(String),
      sourceVersionId: expect.any(String),
      exactQuote: expect.stringContaining('Orion'),
      sensitivity: 'private',
    });
    expect(context?.context.every((item) => item.kind === 'EVIDENCE')).toBe(true);
  });

  it('fails closed for non-Canonical resources and unauthorized scope or sensitivity', async () => {
    const fixture = await createFixture('policy');
    const hybrid: HybridRetrievalCoordinatorPort = {
      search: async (input) =>
        makeResponse(input, [
          makeCandidate({
            resourceType: 'ENTITY',
            citations: [sourceCitation({ evidenceId: 'evidence-entity' })],
          }),
          makeCandidate({
            accessScope: ['admin'],
            citations: [sourceCitation({ evidenceId: 'evidence-admin' })],
          }),
          makeCandidate({
            sensitivity: 'restricted',
            citations: [sourceCitation({ evidenceId: 'evidence-restricted' })],
          }),
          makeCandidate({
            authority: 'COMPILED_TRUTH',
            citations: [sourceCitation({ evidenceId: 'evidence-compiled' })],
          }),
        ]),
    };
    const repository = new PostgresAskAnswerExecutionRepository(
      pool,
      fixture.workspace,
      { resolve: async () => undefined },
      hybrid,
    );
    const submission = await submitCanonicalOnly(fixture, 'Unauthorized canonical context');
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context).toMatchObject({
      contextStatus: 'NO_SUPPORTED_ANSWER',
      queryPlanRevision: 'ask-query-plan-v5',
      evidence: [],
      context: [],
    });
  });

  it('returns NO_SUPPORTED_ANSWER for a genuine hybrid miss without a Source fallback', async () => {
    const fixture = await createFixture('miss');
    const hybrid: HybridRetrievalCoordinatorPort = {
      search: async (input) => makeResponse(input, []),
    };
    const repository = new PostgresAskAnswerExecutionRepository(
      pool,
      fixture.workspace,
      {
        resolve: async () => {
          throw new Error('CANONICAL_ONLY must not resolve SourceVersion context.');
        },
      },
      hybrid,
    );
    const submission = await submitCanonicalOnly(fixture, 'No matching canonical claim');
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context).toMatchObject({
      contextStatus: 'NO_SUPPORTED_ANSWER',
      queryPlanRevision: 'ask-query-plan-v5',
      evidence: [],
      context: [],
    });
  });

  it('fails closed when a fresh run has no shared coordinator instead of falling back to v4 SQL', async () => {
    const fixture = await createFixture('missing-authority');
    const repository = new PostgresAskAnswerExecutionRepository(pool, fixture.workspace, {
      resolve: async () => undefined,
    });
    const submission = await submitCanonicalOnly(fixture, 'Legacy v4 compatibility miss');
    const context = await repository.getRunContext(fixture.scope, submission.answerRun.answerRunId);

    expect(context?.queryPlanRevision).toBe('ask-query-plan-v5');
    expect(context?.contextStatus).toBe('NO_SUPPORTED_ANSWER');
    expect(context?.evidence).toEqual([]);
  });

  it('replays a persisted historical v4 attempt without rebuilding it as v5', async () => {
    const fixture = await createFixture('v4-replay');
    const repository = new PostgresAskAnswerExecutionRepository(pool, fixture.workspace, {
      resolve: async () => undefined,
    });
    const question = 'Historical v4 context replay';
    const submission = await submitCanonicalOnly(fixture, question);
    const first = await repository.claimInitial(
      fixture.scope,
      submission.answerRun.answerRunId,
      'issue-277-v4-worker-1',
    );
    expect(first?.attempt.queryPlanRevision).toBe('ask-query-plan-v5');
    const historicalDigest = askExecutionContextDigest({
      queryPlanRevision: 'ask-query-plan-v4',
      projectId: fixture.projectId,
      mode: 'CANONICAL_ONLY',
      question,
      context: [],
    });
    await pool.query(
      `UPDATE frontend_ask.answer_run_attempts
          SET query_plan_revision = 'ask-query-plan-v4', resolved_context_digest = $4
        WHERE answer_run_id = $1 AND project_id = $2 AND attempt_number = $3`,
      [
        submission.answerRun.answerRunId,
        fixture.projectId,
        first!.attempt.attemptNumber,
        historicalDigest,
      ],
    );
    await repository.fail({
      scope: fixture.scope,
      answerRunId: submission.answerRun.answerRunId,
      attemptNumber: first!.attempt.attemptNumber,
      state: 'OUTCOME_UNKNOWN',
      failure: {
        code: 'OUTCOME_UNKNOWN',
        message: 'Historical v4 replay fixture failure.',
        retryable: false,
        outcomeUnknown: true,
      },
      workerId: 'issue-277-v4-worker-1',
    });
    const retry = await repository.retryAndClaim({
      scope: fixture.scope,
      answerRunId: submission.answerRun.answerRunId,
      mode: 'SAME_CONTEXT',
      workerId: 'issue-277-v4-worker-2',
    });
    expect(retry.attempt.queryPlanRevision).toBe('ask-query-plan-v4');
    expect(retry.attempt.resolvedContextDigest).toBe(historicalDigest);
  });
});
