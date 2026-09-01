import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import {
  PostgresCanonicalCommittedSourceAdapter,
  PostgresDiscoveryScheduleRepository,
  PostgresDiscoveryProjectionReadinessAdapter,
} from '../../adapters/discovery-trigger-coordinator/src/index.js';
import {
  PostgresDiscoveryAuthoringBridge,
  PostgresDiscoveryReviewResourceRepository,
  PostgresFrontendReviewRepository,
  createPostgresReviewDiscoveryCandidateReader,
  createPostgresReviewDraftTargetAdapter,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { PostgresFrontendDiscoveryProductReadSource } from '../../adapters/frontend-discovery-product-postgres/src/index.js';
import {
  DiscoveryCandidateReviewTargetAdapter,
  type ReviewDiscoveryCandidateReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftTargetResolver } from '../../adapters/frontend-knowledge-draft-api-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import {
  PostgresDiscoveryApprovedResourceRevisionResolver,
  PostgresDiscoveryReentryRepository,
} from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { PostgresDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import { PostgresEvidenceRepository } from '../../adapters/postgres-stage3/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import { PostgresSemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-postgres/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';
import {
  PostgresSemanticActiveGenerationReader,
  PostgresSemanticIndexRepository,
} from '../../adapters/semantic-index-postgres/src/index.js';
import type { ProviderEmbeddingConnectivityPort } from '../../adapters/semantic-embedding-resolution/src/router.js';
import { SemanticEmbeddingAuthorityResolver } from '../../adapters/semantic-embedding-resolution/src/index.js';
import { SemanticEmbeddingRouter } from '../../adapters/semantic-embedding-resolution/src/router.js';
import { DiscoveryAIGenerationService } from '../../modules/discovery-ai-generation/src/index.js';
import {
  createProductDiscoveryExecution,
  observeDiscoveryReconciliation,
} from '../../adapters/discovery-runtime-product/src/index.js';
import {
  PostgresKnowledgeModelRepository,
  PostgresTypedPropositionConflictAssertionRepository,
  PostgresTypedPropositionConflictRuleRepository,
} from '../../adapters/postgres-stage9/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReviewMaterializer,
} from '../../modules/discovery-reentry/src/index.js';
import { DiscoveryBudgetControllerV1 } from '../../modules/discovery-quality-gate/src/index.js';
import {
  createDefaultDiscoveryTriggerPolicyV1,
  DiscoveryTriggerCoordinator,
  PersistentDiscoveryScheduler,
  StaticDiscoveryTriggerPolicy,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import { PersistentDiscoveryWorker } from '../../modules/discovery-runtime/src/index.js';
import type {
  DiscoveryCompetingResourcePortV1,
  DiscoveryTemporalCompatibilityPortV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import { DiscoveryActivityAdapter } from '../../adapters/frontend-activity-discovery/src/index.js';
import {
  FrontendReviewProductCoordinator,
  type FrontendReviewScopeV1,
} from '../../modules/frontend-review/src/index.js';
import {
  discoverySemanticFamilyKeyV1,
  FrontendDiscoveryProductReadCoordinator,
} from '../../modules/frontend-discovery-product/src/index.js';
import {
  DiscoveryFeedbackProductCoordinator,
  type DiscoveryFeedbackProductCommandScopeV1,
} from '../../modules/discovery-feedback/src/index.js';
import {
  FrontendKnowledgeDraftProductCoordinator,
  type FrontendKnowledgeDraftCommandScopeV1,
  type FrontendKnowledgeDraftCommitDependenciesV1,
} from '../../modules/frontend-knowledge-draft/src/product-api.js';
import { SemanticGenerationBuilder } from '../../modules/semantic-generation/src/index.js';
import {
  ProductKnowledgeResourceResolver,
  SemanticRetriever,
} from '../../modules/hybrid-retrieval/src/index.js';
import {
  ProviderExternalTransferApprovalService,
  parseProviderDeploymentCeiling,
} from '../../modules/provider-privacy-policy/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  SemanticEmbeddingProfileService,
  initialSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';
import { dispatchCanonicalOutbox } from '../../modules/canonical-knowledge/src/index.js';
import { createTypedPropositionConflictDiscoveryPort } from '../../assemblies/shotgun-app/src/application.js';
import { TypedPropositionConflictRuleService } from '../../modules/knowledge-model/src/index.js';
import {
  approvalTokenDigest,
  approvedChangeSetManifestDigest,
  canonicalSnapshotDigest,
  changeSetContentDigest,
  claimCandidateDigest,
  knowledgeCandidateDigest,
  SEMANTIC_REPRESENTATION_VERSION_V2,
  sha256Text,
  type ApprovedChangeSetManifest,
  type CanonicalCommitResult,
  type CanonicalCommittedPayload,
  type CompiledTruthProjection,
  type DiscoveryCanonicalCommittedEventEnvelopeV1,
  type DiscoveryModelProfileServicePort,
  type DiscoveryAIExecutionResolverPort,
  type DiscoveryStructuredProviderPort,
  type RelationCandidate,
  type SemanticEmbeddingRouterPort,
  decodeDiscoveryFeedbackProductCommandRequestV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const now = '2026-09-01T03:00:00.000Z';
const digest = (value: string): string => sha256Text(value);

const providerEmbeddingDouble = (dimension: number): ProviderEmbeddingConnectivityPort => ({
  providerId: 'openai',
  embed: async (request) => {
    const values = Array.isArray(request.input) ? request.input : [request.input];
    const vector = new Array<number>(dimension).fill(0);
    vector[0] = 1;
    return {
      providerId: 'openai',
      modelId: request.modelId,
      items: values.map(() => ({ vector, dimension, tokenCount: 1 })),
      totalTokens: values.length,
    };
  },
});

const discoveryProviderDouble: DiscoveryStructuredProviderPort = {
  identity: {
    provider: 'akp-8-external-ai-double',
    model: 'akp-8-discovery-model',
    adapterVersion: 'akp-8-provider-double:v1',
    dataPolicyVersion: 'akp-8-provider-policy:v1',
    supportsOutputTokenLimit: true,
    supportsCancellation: true,
  },
  async generateStructured(request) {
    const task = (JSON.parse(request.prompt) as { readonly task: string }).task;
    const output =
      task === 'RELATION_HYPOTHESIS'
        ? { proposedRelationType: 'related-to', orientation: 'UNDIRECTED' }
        : task === 'PATTERN_HYPOTHESIS'
          ? {
              patternKind: 'CLUSTER',
              patternIdentity: 'akp-8-approved-cluster',
              patternStatement: 'The approved resources form a bounded candidate cluster.',
            }
          : task === 'CONFLICT_HYPOTHESIS'
            ? { possibleContradiction: 'The typed propositions may be incompatible.' }
            : task === 'CLARIFICATION_QUESTION'
              ? {
                  question: 'Should these approved resources be related?',
                  context: 'The bounded candidate links two approved resources.',
                  proposedNextStep: 'Review and confirm the intended relation.',
                }
              : {
                  suggestedAction: 'Review the bounded candidate with an approver.',
                  rationale: 'The candidate remains derived until Canonical approval.',
                  riskContext: 'No side effect is authorized by this candidate.',
                };
    return {
      rawText: JSON.stringify(output),
      providerResponseId: `akp-8-response:${task}`,
      modelVersion: 'akp-8-discovery-model:v1',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
    };
  },
  async generateStructuredWithSignal(request) {
    return this.generateStructured(request);
  },
};

const createDiscoveryGenerationFactory = (projectId: string) => {
  const profiles = {
    getActive: async () => ({
      schemaVersion: '1.0.0' as const,
      profileId: 'profile:akp-8-discovery',
      projectId,
      profileRevision: 1,
      aiConfigurationRevision: 1,
      providerId: discoveryProviderDouble.identity.provider,
      modelId: discoveryProviderDouble.identity.model,
      providerRegistryRevision: 'provider-registry:akp-8',
      modelCapabilityRevision: 'model-capability:akp-8',
      promptVersion: 'discovery-ai-prompt:v1',
      outputSchemaVersion: 'discovery-ai-output:v1',
      status: 'ACTIVE' as const,
      createdBy: 'akp-8-owner',
      createdAt: now,
      activatedAt: now,
    }),
  } as unknown as DiscoveryModelProfileServicePort;
  return (ledger: ConstructorParameters<typeof DiscoveryBudgetControllerV1>[0]) =>
    new DiscoveryAIGenerationService(
      profiles,
      {
        resolve: async () => ({
          pin: {
            projectId,
            profileId: 'profile:akp-8-discovery',
            profileRevision: 1,
            providerId: discoveryProviderDouble.identity.provider,
            modelId: discoveryProviderDouble.identity.model,
            modelCapabilityRevision: 'model-capability:akp-8',
            aiConfigurationRevision: 1,
            credentialId: 'credential:akp-8-discovery',
            credentialRevision: 1,
            providerPolicyFingerprint: digest('akp-8-discovery-policy'),
            privacyPolicyRevision: 'privacy-policy:akp-8',
            dataPolicyRevision: 'akp-8-provider-policy:v1',
            promptVersion: 'discovery-ai-prompt:v1',
            outputSchemaVersion: 'discovery-ai-output:v1',
          },
          modelVersion: 'akp-8-discovery-model:v1',
        }),
      } as unknown as DiscoveryAIExecutionResolverPort,
      { resolve: async () => discoveryProviderDouble },
      new DiscoveryBudgetControllerV1(
        ledger,
        { revision: 'akp-8-token-estimator:v1', estimateUpperBound: () => 100 },
        { revision: 'akp-8-cost-estimator:v1', estimate: () => 1 },
        undefined,
        () => Date.parse(now),
      ),
    );
};

const cleanupProject = async (database: Pool, projectId: string): Promise<void> => {
  const client = await database.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await client.query(
      `TRUNCATE frontend_review.context_revision,
                frontend_review.item,
                frontend_review.dependency,
                frontend_review.decision,
                frontend_review.comment,
                frontend_review.approval
       CASCADE`,
    );
    for (const [table, column] of [
      ['discovery.finding_ready', 'project_id'],
      ['discovery.reentry_review_resources', 'project_id'],
      ['discovery.reentry_review_roots', 'project_id'],
      ['discovery.reentry_consumption', 'project_id'],
      ['discovery.reentry_candidates', 'project_id'],
      ['discovery.reentry_manifests', 'project_id'],
      ['discovery.provider_budget_reservations', 'project_id'],
      ['discovery.stage_outputs', 'project_id'],
      ['discovery.work_budget_checkpoints', 'project_id'],
      ['discovery.stage_history', 'project_id'],
      ['discovery.stages', 'project_id'],
      ['discovery.attempt_lifecycle_history', 'project_id'],
      ['discovery.attempts', 'project_id'],
      ['discovery.run_lifecycle_history', 'project_id'],
      ['discovery.runs', 'project_id'],
      ['discovery.job_lifecycle_history', 'project_id'],
      ['discovery.jobs', 'project_id'],
      ['discovery.finding_lifecycle_history', 'project_id'],
      ['discovery.finding_lifecycle_current', 'project_id'],
      ['discovery.findings', 'project_id'],
      ['discovery.suppression_semantic_family_projection', 'project_id'],
      ['discovery.suppression_directives', 'project_id'],
      ['discovery.feedback_events', 'project_id'],
      ['projection.semantic_generation_pointers', 'project_id'],
      ['projection.semantic_items', 'project_id'],
      ['projection.semantic_generations', 'project_id'],
      ['projection.compiled_truth', 'project_id'],
      ['frontend_knowledge_draft.artifact_refs', 'resource_project_id'],
      ['frontend_knowledge_draft.materializations', 'resource_project_id'],
      ['frontend_knowledge_draft.operations', 'resource_project_id'],
      ['frontend_knowledge_draft.revisions', 'resource_project_id'],
      ['frontend_knowledge_draft.drafts', 'resource_project_id'],
      ['frontend_command.command_ledger', 'target_project_id'],
      ['canonical.outbox', 'project_id'],
      ['canonical.history_events', 'project_id'],
      ['canonical.revisions', 'project_id'],
      ['canonical.relation_precursors', 'project_id'],
      ['canonical.relations', 'project_id'],
      ['canonical.commits', 'project_id'],
      ['canonical.claims', 'project_id'],
      ['canonical.project_state', 'project_id'],
      ['knowledge.review_groups', 'project_id'],
      ['evidence.spans', 'project_id'],
      ['transformation.revisions', 'project_id'],
      ['asset.storage_receipts', 'project_id'],
      ['auth.project_memberships', 'project_id'],
    ] as const) {
      await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [projectId]);
    }
    const source = await client.query<{ source_id: string; original_asset_id: string }>(
      `SELECT source_id::text, original_asset_id::text
         FROM asset.source_versions
        WHERE source_id IN (SELECT source_id FROM asset.sources WHERE project_id = $1)`,
      [projectId],
    );
    await client.query(
      `DELETE FROM asset.source_versions
        WHERE source_id IN (SELECT source_id FROM asset.sources WHERE project_id = $1)`,
      [projectId],
    );
    await client.query('DELETE FROM asset.sources WHERE project_id = $1', [projectId]);
    await client.query(
      `DELETE FROM asset.original_assets
        WHERE asset_id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM asset.source_versions WHERE original_asset_id = asset.original_assets.asset_id)`,
      [source.rows.map((row) => row.original_asset_id)],
    );
    await client.query('DELETE FROM auth.sessions WHERE active_project_id = $1', [projectId]);
    await client.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

describe.runIf(databaseUrl)('AKP-8 WP2 cross-section causal PostgreSQL acceptance', () => {
  const projectId = `akp-8-wp2-causal-${randomUUID()}`;
  let sourceId: string;
  let sourceVersionId: string;
  let evidenceIds: readonly [string, string];
  let principalId: string;

  it('proves the production Canonical → Discovery → Review → Draft → Canonical journey', async () => {
    await migrateUpTo(undefined, databaseUrl!);
    const auth = new PostgresAuthRepository(pool!);
    const principal = await auth.bootstrapLocalOwnerPrincipal({ accountId: `${projectId}:owner` });
    principalId = principal.principalId;
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-8 WP2 causal acceptance', 'ACTIVE', true)`,
      [projectId],
    );
    await pool!.query(
      `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
       VALUES ($1, $2, ARRAY['owner', 'review'], 'private', true)`,
      [principalId, projectId],
    );

    const sourceText = 'Alpha service is related to the Beta database.';
    const stored = await new PostgresOriginalAssetRepository(pool!).store({
      submissionId: `${projectId}:source`,
      projectId,
      actorId: principalId,
      channel: 'direct_text',
      materialKind: 'plain_text',
      mediaType: 'text/plain',
      contentHash: digest(sourceText),
      sizeBytes: Buffer.byteLength(sourceText),
      storageKey: `${projectId}/source.txt`,
      accessScope: ['owner', 'review'],
      sensitivity: 'private',
      createdAt: now,
    });
    sourceId = stored.sourceId;
    sourceVersionId = stored.sourceVersionId;
    const revisionId = randomUUID();
    const firstEvidence = randomUUID();
    const secondEvidence = randomUUID();
    evidenceIds = [firstEvidence, secondEvidence];
    await pool!.query(
      `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, 'akp-8-fixture', '1', $6::jsonb, $7::jsonb,
               $5, $8, $9, 'private', $10)`,
      [
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        digest(sourceText),
        JSON.stringify({ mediaType: 'text/plain' }),
        JSON.stringify({}),
        digest('akp-8-source-map'),
        ['owner', 'review'],
        now,
      ],
    );
    for (const [index, evidenceId] of evidenceIds.entries()) {
      const quote = index === 0 ? 'Alpha service' : 'Beta database';
      await pool!.query(
        `INSERT INTO evidence.spans
         (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
          node_kind, origin, position, quote, selectors, exact_hash, access_scope,
          sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'paragraph', 'source', $7::jsonb,
                 $8::jsonb, '[]'::jsonb, $9, $10, 'private', $11)`,
        [
          evidenceId,
          revisionId,
          projectId,
          sourceId,
          sourceVersionId,
          `/paragraphs/${index + 1}`,
          JSON.stringify({
            type: 'TextPositionSelector',
            start: index,
            end: index + quote.length,
            unit: 'unicode-code-point',
          }),
          JSON.stringify({ type: 'TextQuoteSelector', exact: quote }),
          digest(quote),
          ['owner', 'review'],
          now,
        ],
      );
    }

    const claimId = `akp-8-baseline-claim-${randomUUID()}`;
    const claim = {
      claimId,
      projectId,
      revisionNumber: 1 as const,
      claimText: 'The AKP-8 causal acceptance baseline is governed.',
      sourceVersionId,
      evidenceIds: [firstEvidence],
      createdFromManifestId: null,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['owner', 'review'],
      sensitivity: 'private' as const,
      createdAt: now,
    };
    const baselineDigest = canonicalSnapshotDigest(projectId, 1, [
      { claimId, text: claim.claimText, revisionNumber: 1, evidenceIds: claim.evidenceIds },
    ]);
    await pool!.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 1, $2, $3)`,
      [projectId, baselineDigest, now],
    );
    const manifestId = randomUUID();
    const commitId = randomUUID();
    const changeSetId = randomUUID();
    const baselineCommit: CanonicalCommitResult = {
      commitId,
      projectId,
      manifestId,
      manifestDigest: digest(`manifest:${commitId}`),
      changeSetId,
      authorityId: null,
      authorityDigest: null,
      operation: 'ADD_CLAIM',
      status: 'COMMITTED',
      beforeVersion: 0,
      afterVersion: 1,
      snapshotDigest: baselineDigest,
      claimId,
      revisionId: `revision:${commitId}`,
      historyEventId: `history:${commitId}`,
      outboxId: `outbox:${commitId}`,
      committedAt: now,
    };
    const baselinePayload: CanonicalCommittedPayload = {
      commitId,
      manifestId,
      changeSetId,
      operation: 'ADD_CLAIM',
      status: 'COMMITTED',
      canonicalVersion: 1,
      snapshotDigest: baselineDigest,
      claimId,
      actorId: principalId,
      accessScope: ['owner', 'review'],
      sensitivity: 'private',
    };
    await pool!.query(
      `INSERT INTO canonical.claims
       (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [claimId, projectId, sourceVersionId, manifestId, JSON.stringify(claim), now],
    );
    await pool!.query(
      `INSERT INTO canonical.commits
       (commit_id, project_id, manifest_id, manifest_digest, change_set_id, result_json, committed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        commitId,
        projectId,
        manifestId,
        baselineCommit.manifestDigest,
        changeSetId,
        JSON.stringify(baselineCommit),
        now,
      ],
    );
    await pool!.query(
      `INSERT INTO canonical.revisions
       (revision_id, project_id, commit_id, revision_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [`revision:${commitId}`, projectId, commitId, JSON.stringify(baselineCommit), now],
    );
    await pool!.query(
      `INSERT INTO canonical.history_events
       (history_event_id, project_id, commit_id, event_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [`history:${commitId}`, projectId, commitId, JSON.stringify(baselineCommit), now],
    );
    await pool!.query(
      `INSERT INTO canonical.outbox
       (outbox_id, project_id, aggregate_id, event_type, payload_json, status, attempts, available_at)
       VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, 'pending', 0, $5)`,
      [`outbox:${commitId}`, projectId, commitId, JSON.stringify(baselinePayload), now],
    );

    const entities = [
      {
        candidateId: 'entity-alpha',
        candidateType: 'ENTITY' as const,
        revisionNumber: 1 as const,
        sourceVersionId,
        evidenceIds: [firstEvidence],
        modelOutputs: [],
        name: 'Alpha service',
        entityKind: 'CONCEPT' as const,
        aliases: [],
        resolution: { status: 'NEW' as const },
      },
      {
        candidateId: 'entity-beta',
        candidateType: 'ENTITY' as const,
        revisionNumber: 1 as const,
        sourceVersionId,
        evidenceIds: [secondEvidence],
        modelOutputs: [],
        name: 'Beta database',
        entityKind: 'CONCEPT' as const,
        aliases: [],
        resolution: { status: 'NEW' as const },
      },
    ];
    await pool!.query(
      `INSERT INTO knowledge.review_groups
       (project_id, group_id, source_version_id, revision_number, status, content_digest,
        items, decisions, access_scope, sensitivity, created_at, updated_at)
       VALUES ($1, 'akp-8-approved-entities', $2, 1, 'APPROVED', $3, $4::jsonb,
               '[]'::jsonb, $5, 'private', $6, $6)`,
      [
        projectId,
        sourceVersionId,
        digest(JSON.stringify(entities)),
        JSON.stringify(entities),
        ['owner', 'review'],
        now,
      ],
    );

    const sourceReader = new PostgresSemanticCorpusSourceSnapshotReader(pool!);
    const watermark = await sourceReader.readWatermark(projectId);
    const items = [
      {
        id: claimId,
        type: 'CLAIM' as const,
        label: claim.claimText,
        state: 'CURRENT' as const,
        source: 'CANONICAL_CLAIM' as const,
        evidenceIds: claim.evidenceIds,
        accessScope: claim.accessScope,
        sensitivity: claim.sensitivity,
      },
      ...entities.map((entity) => ({
        id: entity.candidateId,
        type: 'ENTITY' as const,
        revisionNumber: entity.revisionNumber,
        sourceVersionId: entity.sourceVersionId,
        label: entity.name,
        state: 'CURRENT' as const,
        source: 'APPROVED_KNOWLEDGE' as const,
        evidenceIds: entity.evidenceIds,
        accessScope: ['owner', 'review'],
        sensitivity: 'private' as const,
      })),
    ];
    const projection: CompiledTruthProjection = {
      projectId,
      projectorVersion: 'akp-8-causal-projector:v1',
      sourceSnapshotDigest: watermark.sourceSnapshotDigest,
      logicalDigest: digest('akp-8-projection-v1'),
      canonicalVersion: watermark.canonicalVersion,
      items,
      graph: {
        nodes: items,
        edges: [],
        fallback: { available: true, modes: ['LIST', 'TABLE'] },
      },
      projectedAt: now,
      buildMode: 'FULL_REBUILD',
    };
    const compiledTruth = new PostgresCompiledTruthRepository(pool!);
    await compiledTruth.synchronize(projection);

    const vault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool!),
      new StaticCredentialMasterKeyAuthority({
        key: Buffer.alloc(32, 8),
        keyVersion: 'akp-8-test',
      }),
    );
    const credential = await vault.create({
      projectId,
      providerId: 'openai',
      secret: 'akp-8-embedding-double-secret',
      now,
    });
    const providerRegistry = initialProviderRegistry();
    const approvalService = new ProviderExternalTransferApprovalService(
      new PostgresProviderExternalTransferApprovalRepository(pool!),
      providerRegistry,
    );
    const proposal = await approvalService.propose({
      projectId,
      providerId: 'openai',
      approved: true,
      expectedApprovalRevision: 0,
      proposedBy: principalId,
    });
    await approvalService.approve({
      proposalId: proposal.proposalId,
      projectId,
      providerId: 'openai',
      expectedApprovalRevision: 0,
      reviewedBy: principalId,
    });
    const profileService = new SemanticEmbeddingProfileService(
      providerRegistry,
      initialSemanticEmbeddingRegistry(),
      new PostgresSemanticEmbeddingProfileRepository(pool!),
      vault,
    );
    const profile = await profileService.createProfile({
      projectId,
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
      representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
      dimension: 512,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      status: 'PREPARED',
      updatedBy: principalId,
      now,
    });
    await profileService.activateProfile({
      projectId,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      updatedBy: principalId,
      now,
    });
    const deploymentCeiling = parseProviderDeploymentCeiling({
      providerAllowlist: 'openai',
      legacyGeminiAllowed: false,
    });
    const semanticResolver = new SemanticEmbeddingAuthorityResolver(
      providerRegistry,
      initialSemanticEmbeddingRegistry(),
      profileService,
      vault,
      { deploymentCeiling, approvalAuthority: approvalService },
    );
    const embeddingConnectivity = providerEmbeddingDouble(512);
    const semanticRouter = new SemanticEmbeddingRouter(
      providerRegistry,
      initialSemanticEmbeddingRegistry(),
      vault,
      approvalService,
      deploymentCeiling,
      [embeddingConnectivity],
    );
    const semanticIndex = new PostgresSemanticIndexRepository(pool!);
    const semanticBuilder = new SemanticGenerationBuilder(
      semanticIndex,
      sourceReader,
      semanticResolver,
      semanticRouter,
      profileService,
      { now: () => now, generationId: () => `generation:${projectId}:v1` },
    );
    expect(
      (await semanticBuilder.build({ projectId, targetProfileRevision: profile.profileRevision }))
        .status,
    ).toBe('ACTIVATED');

    const canonical = new PostgresCanonicalKnowledgeRepository(pool!);
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    const findingRepository = new PostgresDiscoveryFindingRepository(pool!);
    const evidenceRepository = new PostgresEvidenceRepository(pool!);
    const reviewReader = createPostgresReviewDiscoveryCandidateReader(pool!);
    const canonicalSource = new PostgresCanonicalCommittedSourceAdapter(canonical, sourceReader);
    const trigger = new DiscoveryTriggerCoordinator(
      canonicalSource,
      new PostgresDiscoveryProjectionReadinessAdapter(compiledTruth, semanticIndex),
      runtime,
      new StaticDiscoveryTriggerPolicy({
        ...createDefaultDiscoveryTriggerPolicyV1(),
        waitTimeoutMs: 60_000,
      }),
      { now: () => now },
      {
        jobId: () => `job:${randomUUID()}`,
        currentAuthority: {
          resolve: (requestedProjectId: string) =>
            canonicalSource.resolveCurrentAuthority(requestedProjectId),
        },
      },
    );
    const semanticRetriever = new SemanticRetriever(
      semanticIndex,
      semanticResolver,
      semanticRouter as SemanticEmbeddingRouterPort,
      new PostgresSemanticActiveGenerationReader(semanticIndex),
      { sourceWatermarkReader: sourceReader },
    );
    const execution = createProductExecution({
      projectId,
      compiledTruth,
      findingRepository,
      runtime,
      evidenceRepository,
      semanticRetriever,
      reviewReader,
    });
    const worker = new PersistentDiscoveryWorker(runtime, execution, {
      workerId: `akp-8-worker:${projectId}`,
      leaseDurationMs: 30_000,
      clock: () => new Date(now),
    });
    const runWorkerToCompletion = async (): Promise<void> => {
      for (let run = 0; run < 20; run += 1) {
        const result = await worker.runOnce();
        if (result === 'COMPLETED') return;
        if (result !== 'PARTIAL') {
          throw new Error(`Discovery worker did not complete: ${result}`);
        }
      }
      throw new Error('Discovery worker exceeded the bounded reconciliation drain.');
    };
    const baselineEvent = eventFor(projectId, baselinePayload, `outbox:${commitId}`);
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          await trigger.coordinateCanonicalCommitted(baselineEvent);
        },
      },
      projectId,
      1,
      now,
    );
    await runWorkerToCompletion();

    const schedules = new PostgresDiscoveryScheduleRepository(pool!);
    const dueSchedule = {
      schemaVersion: '1.0.0' as const,
      projectId,
      scheduleId: 'weekly-causal-acceptance',
      scheduleRevision: '1',
      status: 'ENABLED' as const,
      timezone: 'UTC',
      dayOfWeek: 2,
      localTime: '02:00',
      nextOccurrenceAt: '2026-09-01T02:00:00.000Z',
      nextOccurrenceKey: '2026-09-01T02:00@UTC',
      updatedAt: now,
    };
    expect(await schedules.saveSchedule(dueSchedule)).toBe('CREATED');
    const schedulerTick = await new PersistentDiscoveryScheduler(schedules, trigger, {
      now: () => now,
    }).tick();
    expect(schedulerTick).toMatchObject({
      schedulesObserved: 1,
      jobsAccepted: 1,
      occurrencesAdvanced: 1,
    });
    const scheduledJob = await runtime.findJobByTriggerIdentity({
      projectId,
      triggerClass: 'SCHEDULED_FULL_SCAN',
      scheduleId: dueSchedule.scheduleId,
      scheduleRevision: dueSchedule.scheduleRevision,
      occurrenceKey: dueSchedule.nextOccurrenceKey,
    });
    expect(scheduledJob).toMatchObject({
      requestedScanMode: 'FULL_SCAN',
      effectiveScanMode: 'FULL_SCAN',
    });
    await runWorkerToCompletion();
    const scheduledRuntimeIds = await pool!.query<{ run_id: string; attempt_id: string }>(
      `SELECT r.run_id, a.attempt_id
         FROM discovery.runs r
         JOIN discovery.attempts a
           ON a.project_id = r.project_id AND a.run_id = r.run_id AND a.job_id = r.job_id
        WHERE r.project_id = $1 AND r.job_id = $2
        ORDER BY a.attempt_number DESC
        LIMIT 1`,
      [projectId, scheduledJob!.jobId],
    );
    expect(scheduledRuntimeIds.rows).toHaveLength(1);
    const scheduledRun = await runtime.findRun({
      projectId,
      jobId: scheduledJob!.jobId,
      runId: scheduledRuntimeIds.rows[0]!.run_id,
    });
    expect(scheduledRun?.effectiveScanMode).toBe('FULL_SCAN');
    const scheduledStages = await runtime.listStages({
      projectId,
      runId: scheduledRuntimeIds.rows[0]!.run_id,
      attemptId: scheduledRuntimeIds.rows[0]!.attempt_id,
    });
    expect(scheduledStages).toHaveLength(7);
    expect(scheduledStages.every((stage) => stage.state === 'SUCCEEDED')).toBe(true);

    const findings = await findingRepository.listByProject(projectId);
    const relationFinding = findings.find(
      (finding) => finding.findingType === 'RELATION_HYPOTHESIS',
    );
    expect(relationFinding).toBeDefined();
    const publication = await runtime.findFindingReady({
      projectId,
      findingId: relationFinding!.findingId,
      findingRevision: relationFinding!.findingRevision,
    });
    expect(publication).toBeDefined();

    const reentry = new PostgresDiscoveryReentryRepository(pool!, {
      lifecycleRepository: findingRepository,
    });
    const resolver = new PostgresDiscoveryApprovedResourceRevisionResolver(pool!, {
      canonicalKnowledgeRepository: canonical,
      knowledgeModelRepository: new PostgresKnowledgeModelRepository(pool!),
      compiledTruthRepository: compiledTruth,
    });
    const consumed = await new DiscoveryReentryConsumer(
      reentry,
      resolver,
      () => new Date(now),
    ).consume(publication!);
    expect(['CREATED', 'IDEMPOTENT']).toContain(consumed.status);
    const logicalIdentityKey =
      'logicalIdentityKey' in consumed ? consumed.logicalIdentityKey : undefined;
    if (!logicalIdentityKey) throw new Error('re-entry did not create an intake');
    const materialized = await new DiscoveryReviewMaterializer(
      reentry,
      new PostgresDiscoveryReviewResourceRepository(pool!),
      undefined,
      {
        resolve: async ({ projectId: evidenceProjectId, evidenceIds: ids }) =>
          Promise.all(
            ids.map(async (evidenceId) => {
              const evidence = await evidenceRepository.findById(evidenceProjectId, evidenceId);
              if (!evidence) throw new Error('fixture evidence disappeared');
              return {
                schemaVersion: '1.0.0' as const,
                evidenceId,
                sourceId: evidence.sourceId,
                sourceVersionId: evidence.sourceVersionId,
                evidenceSpanId: evidence.evidenceId,
              };
            }),
          ),
      },
    ).materialize({ logicalIdentityKey });
    expect(materialized.status).toBe('CREATED');

    const feedbackRepository = new PostgresDiscoveryFeedbackRepository(pool!, {
      semanticFamilyKeyResolver: async ({
        projectId: feedbackProjectId,
        findingId,
        findingRevision,
      }) => {
        const source = await findingRepository.findRevision({
          projectId: feedbackProjectId,
          findingId,
          findingRevision,
        });
        return source === undefined ? undefined : discoverySemanticFamilyKeyV1(source);
      },
    });
    const feedbackGateway = new PostgresFrontendCommandGateway(pool!);
    let feedbackNow = '2026-09-01T03:00:00.000Z';
    const feedbackCoordinator = new DiscoveryFeedbackProductCoordinator(
      feedbackRepository,
      () => feedbackNow,
    );
    const productScope = {
      principalId,
      sessionId: `${projectId}:product-session`,
      activeProject: {
        id: projectId,
        label: 'AKP-8 WP2 causal acceptance',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
      accessibleProjects: [
        {
          id: projectId,
          label: 'AKP-8 WP2 causal acceptance',
          isOwner: true,
          sensitivityClearance: 'private' as const,
        },
      ],
      accessRevision: `${projectId}:access`,
      policyContextRevision: `${projectId}:policy`,
      accessScope: ['owner', 'review'],
    };
    const feedbackScope: DiscoveryFeedbackProductCommandScopeV1 = {
      principalId,
      projectId,
      accessRevision: productScope.accessRevision,
      policyContextRevision: productScope.policyContextRevision,
    };
    const productSource = new PostgresFrontendDiscoveryProductReadSource(pool!, {
      reviewReader,
      resourceResolver: new ProductKnowledgeResourceResolver(
        canonical,
        new PostgresKnowledgeModelRepository(pool!),
        compiledTruth,
      ),
      evidenceRepository,
    });
    const productRead = new FrontendDiscoveryProductReadCoordinator(productSource, {
      feedbackRepository,
      rankingAuthority: (inputs) => inputs.map(({ candidate }) => ({ candidate, scoreMicros: 0 })),
      now: () => '2026-09-01T04:00:00.000Z',
    });
    const authoritativeFinding = await productRead.findAuthoritativeFinding({
      ...productScope,
      request: {
        schemaVersion: '1.0.0',
        findingId: relationFinding!.findingId,
        findingRevision: relationFinding!.findingRevision,
      },
    });
    expect(authoritativeFinding).toBeDefined();
    const canonicalBeforeFeedback = await canonical.getSnapshot(projectId);
    const snoozeRequest = decodeDiscoveryFeedbackProductCommandRequestV1({
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:snooze`,
      idempotencyKey: `${projectId}:snooze`,
      findingId: relationFinding!.findingId,
      findingRevision: relationFinding!.findingRevision,
      feedbackClass: 'UTILITY',
      feedbackKind: 'SNOOZE',
      scope: 'FINDING',
      snoozeUntil: '2099-01-01T00:00:00.000Z',
    });
    const similarRequest = decodeDiscoveryFeedbackProductCommandRequestV1({
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:suppress-similar`,
      idempotencyKey: `${projectId}:suppress-similar`,
      findingId: relationFinding!.findingId,
      findingRevision: relationFinding!.findingRevision,
      feedbackClass: 'UTILITY',
      feedbackKind: 'SUPPRESS_SIMILAR',
      scope: 'PROJECT',
    });
    await feedbackCoordinator.submit({
      scope: feedbackScope,
      request: snoozeRequest,
      finding: authoritativeFinding!,
      gateway: feedbackGateway,
    });
    feedbackNow = '2026-09-01T03:00:01.000Z';
    await feedbackCoordinator.submit({
      scope: feedbackScope,
      request: similarRequest,
      finding: authoritativeFinding!,
      gateway: feedbackGateway,
    });
    const feedbackState = await feedbackCoordinator.readState(feedbackScope, authoritativeFinding!);
    expect(feedbackState.feedbackHistory.map((entry) => entry.feedbackKind)).toEqual([
      'SNOOZE',
      'SUPPRESS_SIMILAR',
    ]);
    expect(feedbackState.suppressionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ suppressionKind: 'SNOOZE', matcherKind: 'NONE' }),
        expect.objectContaining({
          suppressionKind: 'SUPPRESS_SIMILAR',
          matcherKind: 'SEMANTIC_FAMILY',
        }),
      ]),
    );
    const laterEvaluation = await productRead.listFindings({
      ...productScope,
      request: { schemaVersion: '1.0.0', limit: 50 },
    });
    expect(
      laterEvaluation.findings.some((finding) => finding.findingId === relationFinding!.findingId),
    ).toBe(false);
    expect(await canonical.getSnapshot(projectId)).toEqual(canonicalBeforeFeedback);

    const reviewStore = new PostgresFrontendReviewRepository(pool!);
    const bridge = new PostgresDiscoveryAuthoringBridge(
      new PostgresFrontendKnowledgeDraftRepository(pool!),
    );
    const reviewCoordinator = new FrontendReviewProductCoordinator(
      reviewStore,
      new PostgresFrontendCommandGateway(pool!),
      [
        new DiscoveryCandidateReviewTargetAdapter(reviewReader),
        createPostgresReviewDraftTargetAdapter(pool!),
      ],
      () => new Date(now),
      bridge,
    );
    const reviewScope: FrontendReviewScopeV1 = {
      principalId,
      sessionId: `${projectId}:session`,
      activeProjectId: projectId,
      accessRevision: `${projectId}:access`,
      policyContextRevision: `${projectId}:policy`,
      sensitivityClearance: 'private',
      accessScope: ['owner', 'review'],
    };
    const candidateQueue = await reviewCoordinator.listReviewQueue(reviewScope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const candidateItem = candidateQueue.items.find(
      (item) => item.targetKind === 'DISCOVERY_CANDIDATE',
    );
    expect(candidateItem).toBeDefined();
    const candidateContext = await reviewCoordinator.getReviewContext(reviewScope, {
      schemaVersion: '1.0.0',
      reviewContextId: candidateItem!.reviewContextId,
      contextRevision: candidateItem!.contextRevision,
    });
    const accepted = await reviewCoordinator.recordReviewDecisions(reviewScope, {
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:candidate-approve`,
      idempotencyKey: `${projectId}:candidate-approve`,
      reviewContextId: candidateItem!.reviewContextId,
      expectedContextRevision: candidateItem!.contextRevision,
      expectedTargetRevision: '1',
      expectedTargetDigest: candidateContext.context.targetDigest,
      itemDecisions: [
        {
          schemaVersion: '1.0.0',
          reviewItemId: 'item-1',
          intent: 'APPROVE',
          reason: 'The bounded relation is ready for authoring.',
        },
      ],
    });
    expect(accepted.acceptedForAuthoring).toBe(true);
    expect(accepted.draft).toBeDefined();

    const draftRepository = new PostgresFrontendKnowledgeDraftRepository(pool!);
    const draftScope: FrontendKnowledgeDraftCommandScopeV1 = {
      principalId: reviewScope.principalId,
      sessionId: reviewScope.sessionId,
      activeProjectId: reviewScope.activeProjectId,
      accessRevision: reviewScope.accessRevision,
      policyContextRevision: reviewScope.policyContextRevision,
      sensitivityClearance: 'private',
      accessScope: reviewScope.accessScope,
    };
    const draftCoordinator = new FrontendKnowledgeDraftProductCoordinator(
      draftRepository,
      new PostgresFrontendCommandGateway(pool!),
      new PostgresFrontendKnowledgeDraftTargetResolver(pool!),
      createDraftCommitDependencies(reviewStore, canonical, bridge),
    );
    const draftId = accepted.draft!.draftId;
    let draft = await draftRepository.transaction((repositories) =>
      repositories.drafts.findById(projectId, draftId),
    );
    expect(draft).toBeDefined();
    await draftCoordinator.validateDraft(draftScope, {
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:draft-validate`,
      idempotencyKey: `${projectId}:draft-validate`,
      draftId,
      expectedDraftRevision: draft!.revision,
      expectedBaseRevision: draft!.base.canonicalVersion,
    });
    draft = await draftRepository.transaction((repositories) =>
      repositories.drafts.findById(projectId, draftId),
    );
    await draftCoordinator.generateImpactPreview(draftScope, {
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:draft-impact`,
      idempotencyKey: `${projectId}:draft-impact`,
      draftId,
      expectedDraftRevision: draft!.revision,
      expectedBaseRevision: draft!.base.canonicalVersion,
    });
    draft = await draftRepository.transaction((repositories) =>
      repositories.drafts.findById(projectId, draftId),
    );
    await draftCoordinator.submitDraftForReview(draftScope, {
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:draft-submit`,
      idempotencyKey: `${projectId}:draft-submit`,
      draftId,
      expectedDraftRevision: draft!.revision,
      expectedBaseRevision: draft!.base.canonicalVersion,
      validationArtifact: draft!.validation!,
      impactArtifact: draft!.impactPreview!,
    });

    const draftQueue = await reviewCoordinator.listReviewQueue(reviewScope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const draftItem = draftQueue.items.find(
      (item) => item.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    expect(draftItem).toBeDefined();
    const draftContext = await reviewCoordinator.getReviewContext(reviewScope, {
      schemaVersion: '1.0.0',
      reviewContextId: draftItem!.reviewContextId,
      contextRevision: draftItem!.contextRevision,
    });
    const draftApproval = await reviewCoordinator.recordReviewDecisions(reviewScope, {
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:draft-approve`,
      idempotencyKey: `${projectId}:draft-approve`,
      reviewContextId: draftItem!.reviewContextId,
      expectedContextRevision: draftItem!.contextRevision,
      expectedTargetRevision: '1',
      expectedTargetDigest: draftContext.context.targetDigest,
      itemDecisions: [
        {
          schemaVersion: '1.0.0',
          reviewItemId: 'item-1',
          intent: 'APPROVE',
          reason: 'The reviewed Draft is approved for Canonical.',
        },
      ],
    });
    const approval = draftApproval.approvals?.[0];
    expect(approval?.purpose).toBe('KNOWLEDGE_CANONICAL_CHANGE');
    const committed = await draftCoordinator.commitFrontendDraft(draftScope, {
      schemaVersion: '1.0.0',
      clientRequestId: `${projectId}:draft-commit`,
      idempotencyKey: `${projectId}:draft-commit`,
      draftId,
      approvalId: approval!.approvalId,
      expectedApprovalRevision: 1,
    });
    expect(committed.commitIds).toHaveLength(1);
    const canonicalAfter = await canonical.getSnapshot(projectId);
    expect(canonicalAfter.relations).toHaveLength(1);
    expect(canonicalAfter.relationPrecursorLinks).toHaveLength(1);

    const watermarkAfter = await sourceReader.readWatermark(projectId);
    const relation = canonicalAfter.relations![0]!;
    const refreshedProjection: CompiledTruthProjection = {
      ...projection,
      sourceSnapshotDigest: watermarkAfter.sourceSnapshotDigest,
      canonicalVersion: watermarkAfter.canonicalVersion,
      logicalDigest: digest('akp-8-projection-v2'),
      relationPrecursorLinks: canonicalAfter.relationPrecursorLinks,
      graph: {
        ...projection.graph,
        edges: [
          {
            id: relation.relationId,
            from: relation.fromEndpoint.resourceId,
            to: relation.toEndpoint.resourceId,
            fromRevision: relation.fromEndpoint.resourceRevision,
            toRevision: relation.toEndpoint.resourceRevision,
            relationType: relation.relationType,
            direction: relation.direction,
            source: 'CANONICAL_RELATION' as const,
          },
        ],
      },
    };
    await compiledTruth.synchronize(refreshedProjection);
    expect(
      (
        await semanticBuilder.build({
          projectId,
          targetProfileRevision: profile.profileRevision,
          generationId: `generation:${projectId}:v2`,
        })
      ).status,
    ).toBe('ACTIVATED');
    const committedPayload = await canonical.findOutbox(
      projectId,
      `outbox:${committed.commitIds[0]}`,
    );
    expect(committedPayload?.status).toBe('pending');
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          await trigger.coordinateCanonicalCommitted(
            eventFor(projectId, committedPayload!.payload, committedPayload!.outboxId),
          );
        },
      },
      projectId,
      1,
      committedPayload!.availableAt,
    );
    await runWorkerToCompletion();
    expect(
      (
        await findingRepository.findLifecycle({
          projectId,
          findingId: relationFinding!.findingId,
          findingRevision: relationFinding!.findingRevision,
        })
      )?.lifecycleState,
    ).toBe('RESOLVED');

    // M — the production typed-conflict path is deliberately exercised after
    // the accepted A/B/C journey.  The two approved relation groups are read
    // by the real Postgres conflict authority; no Finding or Canonical conflict
    // row is inserted by this fixture.
    let causalNow = '2026-09-01T05:00:00.000Z';
    const typedRelationCandidates: readonly RelationCandidate[] = [
      {
        candidateId: `akp-8-m-support:${projectId}`,
        candidateType: 'RELATION',
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceIds[0]],
        modelOutputs: [],
        fromCandidateId: 'entity-alpha',
        toCandidateId: 'entity-beta',
        relationType: 'supports',
        direction: 'DIRECTED',
      },
      {
        candidateId: `akp-8-m-contradicts:${projectId}`,
        candidateType: 'RELATION',
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceIds[1]],
        modelOutputs: [],
        fromCandidateId: 'entity-alpha',
        toCandidateId: 'entity-beta',
        relationType: 'contradicts',
        direction: 'DIRECTED',
      },
    ];
    const knowledgeModel = new PostgresKnowledgeModelRepository(pool!);
    for (const [index, candidate] of typedRelationCandidates.entries()) {
      await knowledgeModel.saveGroup({
        groupId: `akp-8-m-approved-relation-${index + 1}:${projectId}`,
        projectId,
        sourceVersionId,
        revisionNumber: 1,
        status: 'APPROVED',
        contentDigest: knowledgeCandidateDigest([candidate]),
        items: [candidate],
        decisions: [],
        accessScope: ['owner', 'review'],
        sensitivity: 'private',
        createdAt: causalNow,
        updatedAt: causalNow,
      });
    }
    const typedConflictRuleRepository = new PostgresTypedPropositionConflictRuleRepository(pool!);
    const typedConflictAssertionRepository =
      new PostgresTypedPropositionConflictAssertionRepository(pool!);
    await new TypedPropositionConflictRuleService(typedConflictRuleRepository).execute({
      projectId,
      actorId: principalId,
      payload: {
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: causalNow,
    });
    const typedConflictPort = createTypedPropositionConflictDiscoveryPort({
      ruleRepository: typedConflictRuleRepository,
      assertionRepository: typedConflictAssertionRepository,
      knowledgeModelRepository: knowledgeModel,
    });
    const causalProjection = async (
      logicalDigest: string,
      relationState: 'CURRENT' | 'CONFLICT' = 'CURRENT',
    ): Promise<CompiledTruthProjection> => {
      const snapshot = await canonical.getSnapshot(projectId);
      const existingIds = new Set(refreshedProjection.items.map((item) => item.id));
      const claimItems = snapshot.claims
        .filter((claim) => !existingIds.has(claim.claimId))
        .map((claim) => ({
          id: claim.claimId,
          type: 'CLAIM' as const,
          revisionNumber: claim.revisionNumber,
          sourceVersionId,
          label: claim.text,
          state: 'CURRENT' as const,
          source: 'CANONICAL_CLAIM' as const,
          evidenceIds: claim.evidenceIds,
          accessScope: ['owner', 'review'],
          sensitivity: 'private' as const,
        }));
      const relationItems = typedRelationCandidates.map((candidate) => ({
        id: candidate.candidateId,
        type: 'RELATION' as const,
        revisionNumber: candidate.revisionNumber,
        sourceVersionId: candidate.sourceVersionId,
        label: `${candidate.relationType}: ${candidate.fromCandidateId} → ${candidate.toCandidateId}`,
        state: candidate.relationType === 'supports' ? relationState : ('CURRENT' as const),
        source: 'APPROVED_KNOWLEDGE' as const,
        evidenceIds: candidate.evidenceIds,
        accessScope: ['owner', 'review'],
        sensitivity: 'private' as const,
      }));
      const items = [...refreshedProjection.items, ...claimItems, ...relationItems];
      const watermarkForProjection = await sourceReader.readWatermark(projectId);
      return {
        ...refreshedProjection,
        sourceSnapshotDigest: watermarkForProjection.sourceSnapshotDigest,
        canonicalVersion: watermarkForProjection.canonicalVersion,
        logicalDigest: digest(logicalDigest),
        items,
        graph: { ...refreshedProjection.graph, nodes: items },
        projectedAt: causalNow,
      };
    };
    const mFirstCommit = await commitCausalClaim(canonical, {
      projectId,
      sourceVersionId,
      evidenceId: evidenceIds[0],
      actorId: principalId,
      claimText: 'The typed proposition conflict acceptance baseline is governed.',
      committedAt: causalNow,
      identity: 'm-first',
    });
    const mFirstProjection = await causalProjection('akp-8-m-projection-v1');
    await compiledTruth.synchronize(mFirstProjection);
    expect(
      (
        await semanticBuilder.build({
          projectId,
          targetProfileRevision: profile.profileRevision,
          generationId: `generation:${projectId}:m-first`,
        })
      ).status,
    ).toBe('ACTIVATED');
    const causalTrigger = new DiscoveryTriggerCoordinator(
      canonicalSource,
      new PostgresDiscoveryProjectionReadinessAdapter(compiledTruth, semanticIndex),
      runtime,
      new StaticDiscoveryTriggerPolicy({
        ...createDefaultDiscoveryTriggerPolicyV1(),
        waitTimeoutMs: 60_000,
      }),
      { now: () => causalNow },
      {
        jobId: () => `job:${randomUUID()}`,
        currentAuthority: {
          resolve: (requestedProjectId: string) =>
            canonicalSource.resolveCurrentAuthority(requestedProjectId),
        },
      },
    );
    const causalExecution = createProductExecution({
      projectId,
      compiledTruth,
      findingRepository,
      runtime,
      evidenceRepository,
      semanticRetriever,
      reviewReader,
      competingResource: typedConflictPort,
    });
    const causalWorker = new PersistentDiscoveryWorker(runtime, causalExecution, {
      workerId: `akp-8-causal-worker:${projectId}`,
      leaseDurationMs: 30_000,
      clock: () => new Date(causalNow),
    });
    const runCausalWorkerToCompletion = async (): Promise<void> => {
      for (let run = 0; run < 30; run += 1) {
        const result = await causalWorker.runOnce();
        if (result === 'COMPLETED') return;
        if (result !== 'PARTIAL') {
          throw new Error(`Causal Discovery worker did not complete: ${result}`);
        }
      }
      throw new Error('Causal Discovery worker exceeded the bounded reconciliation drain.');
    };
    const mFirstOutbox = await canonical.findOutbox(projectId, mFirstCommit.outboxId);
    expect(mFirstOutbox?.status).toBe('pending');
    let mFirstJobId = '';
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          const coordinated = await causalTrigger.coordinateCanonicalCommitted(
            eventFor(projectId, mFirstOutbox!.payload, mFirstOutbox!.outboxId),
          );
          expect(coordinated.disposition).toBe('CREATED');
          mFirstJobId = coordinated.jobId;
        },
      },
      projectId,
      1,
      mFirstOutbox!.availableAt,
    );
    await runCausalWorkerToCompletion();
    const mFirstJob = await runtime.findJob({ projectId, jobId: mFirstJobId });
    expect(mFirstJob?.lifecycleState).toBe('SUCCEEDED');
    const mFirstConflict = (await findingRepository.listByProject(projectId)).find(
      (finding) =>
        finding.findingType === 'CONFLICT_HYPOTHESIS' &&
        finding.canonicalBase.canonicalVersion === mFirstCommit.afterVersion,
    );
    expect(mFirstConflict).toBeDefined();
    expect(mFirstConflict?.findingType).toBe('CONFLICT_HYPOTHESIS');
    expect(
      (await canonical.getSnapshot(projectId)).relations?.some(
        (relation) => relation.relationId === mFirstConflict!.findingId,
      ),
    ).toBe(false);

    const materializeCausalFinding = async (
      finding: NonNullable<typeof mFirstConflict>,
    ): Promise<void> => {
      const findingPublication = await runtime.findFindingReady({
        projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      });
      expect(findingPublication).toBeDefined();
      const causalReentry = new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findingRepository,
      });
      const causalResolver = new PostgresDiscoveryApprovedResourceRevisionResolver(pool!, {
        canonicalKnowledgeRepository: canonical,
        knowledgeModelRepository: knowledgeModel,
        compiledTruthRepository: compiledTruth,
      });
      const consumedCausal = await new DiscoveryReentryConsumer(
        causalReentry,
        causalResolver,
        () => new Date(causalNow),
      ).consume(findingPublication!);
      expect(['CREATED', 'IDEMPOTENT']).toContain(consumedCausal.status);
      const logicalIdentityKey =
        'logicalIdentityKey' in consumedCausal ? consumedCausal.logicalIdentityKey : undefined;
      if (!logicalIdentityKey) throw new Error('causal re-entry did not create an intake');
      const materializedCausal = await new DiscoveryReviewMaterializer(
        causalReentry,
        new PostgresDiscoveryReviewResourceRepository(pool!),
        undefined,
        {
          resolve: async ({ projectId: evidenceProjectId, evidenceIds: ids }) =>
            Promise.all(
              ids.map(async (evidenceId) => {
                const evidence = await evidenceRepository.findById(evidenceProjectId, evidenceId);
                if (!evidence) throw new Error('causal fixture evidence disappeared');
                return {
                  schemaVersion: '1.0.0' as const,
                  evidenceId,
                  sourceId: evidence.sourceId,
                  sourceVersionId: evidence.sourceVersionId,
                  evidenceSpanId: evidence.evidenceId,
                };
              }),
            ),
        },
      ).materialize({ logicalIdentityKey });
      expect(['CREATED', 'IDEMPOTENT']).toContain(materializedCausal.status);
    };
    await materializeCausalFinding(mFirstConflict!);
    const causalProductRead = new FrontendDiscoveryProductReadCoordinator(productSource, {
      feedbackRepository,
      rankingAuthority: (inputs) => inputs.map(({ candidate }) => ({ candidate, scoreMicros: 0 })),
      now: () => causalNow,
    });
    const firstConflictProduct = await causalProductRead.findAuthoritativeFinding({
      ...productScope,
      request: {
        schemaVersion: '1.0.0',
        findingId: mFirstConflict!.findingId,
        findingRevision: mFirstConflict!.findingRevision,
      },
    });
    expect(firstConflictProduct).toBeDefined();
    feedbackNow = causalNow;
    await feedbackCoordinator.submit({
      scope: feedbackScope,
      request: decodeDiscoveryFeedbackProductCommandRequestV1({
        schemaVersion: '1.0.0',
        clientRequestId: `${projectId}:m-suppress-first`,
        idempotencyKey: `${projectId}:m-suppress-first`,
        findingId: mFirstConflict!.findingId,
        findingRevision: mFirstConflict!.findingRevision,
        feedbackClass: 'UTILITY',
        feedbackKind: 'SUPPRESS_SIMILAR',
        scope: 'PROJECT',
      }),
      finding: firstConflictProduct!,
      gateway: feedbackGateway,
    });
    const firstConflictFeedback = await feedbackCoordinator.readState(
      feedbackScope,
      firstConflictProduct!,
    );
    expect(firstConflictFeedback.suppressionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suppressionKind: 'SUPPRESS_SIMILAR',
          matcherKind: 'SEMANTIC_FAMILY',
        }),
      ]),
    );

    causalNow = '2026-09-01T05:02:00.000Z';
    const mSecondCommit = await commitCausalClaim(canonical, {
      projectId,
      sourceVersionId,
      evidenceId: evidenceIds[1],
      actorId: principalId,
      claimText: 'The materially changed typed proposition conflict remains derived.',
      committedAt: causalNow,
      identity: 'm-second',
    });
    const mSecondProjection = await causalProjection('akp-8-m-projection-v2');
    await compiledTruth.synchronize(mSecondProjection);
    expect(
      (
        await semanticBuilder.build({
          projectId,
          targetProfileRevision: profile.profileRevision,
          generationId: `generation:${projectId}:m-second`,
        })
      ).status,
    ).toBe('ACTIVATED');
    const mSecondOutbox = await canonical.findOutbox(projectId, mSecondCommit.outboxId);
    expect(mSecondOutbox?.status).toBe('pending');
    let mSecondJobId = '';
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          const coordinated = await causalTrigger.coordinateCanonicalCommitted(
            eventFor(projectId, mSecondOutbox!.payload, mSecondOutbox!.outboxId),
          );
          expect(coordinated.disposition).toBe('CREATED');
          mSecondJobId = coordinated.jobId;
        },
      },
      projectId,
      1,
      mSecondOutbox!.availableAt,
    );
    await runCausalWorkerToCompletion();
    const mSecondJob = await runtime.findJob({ projectId, jobId: mSecondJobId });
    expect(mSecondJob?.lifecycleState).toBe('SUCCEEDED');
    const mSecondConflict = (await findingRepository.listByProject(projectId)).find(
      (finding) =>
        finding.findingType === 'CONFLICT_HYPOTHESIS' &&
        finding.canonicalBase.canonicalVersion === mSecondCommit.afterVersion,
    );
    expect(mSecondConflict).toBeDefined();
    expect(mSecondConflict!.findingId).not.toBe(mFirstConflict!.findingId);
    expect(discoverySemanticFamilyKeyV1(mSecondConflict!)).toBe(
      discoverySemanticFamilyKeyV1(mFirstConflict!),
    );
    await materializeCausalFinding(mSecondConflict!);
    const secondConflictProduct = await causalProductRead.findAuthoritativeFinding({
      ...productScope,
      request: {
        schemaVersion: '1.0.0',
        findingId: mSecondConflict!.findingId,
        findingRevision: mSecondConflict!.findingRevision,
      },
    });
    expect(secondConflictProduct).toBeDefined();
    const mVisibleFindings = await causalProductRead.listFindings({
      ...productScope,
      request: { schemaVersion: '1.0.0', limit: 100 },
    });
    const visibleSecondConflict = mVisibleFindings.findings.find(
      (finding) => finding.findingId === mSecondConflict!.findingId,
    );
    expect(visibleSecondConflict).toBeDefined();
    expect(visibleSecondConflict?.presentation?.reasonCodes).toContain(
      'MANDATORY_VISIBILITY_OVERRIDE',
    );
    const secondReviewSource = await reviewReader.findByFinding?.(
      projectId,
      mSecondConflict!.findingId,
      mSecondConflict!.findingRevision,
    );
    expect(secondReviewSource).toBeDefined();
    const mReviewQueue = await reviewCoordinator.listReviewQueue(reviewScope, {
      schemaVersion: '1.0.0',
      pageSize: 100,
    });
    expect(
      mReviewQueue.items.some(
        (item) =>
          item.targetKind === 'DISCOVERY_CANDIDATE' &&
          item.targetId === secondReviewSource!.candidateId,
      ),
    ).toBe(true);
    const causalActivity = new DiscoveryActivityAdapter(runtime, {
      listActivityFindings: async (activityInput) => {
        const activityFindings = await findingRepository.listByJobAndRun(activityInput);
        return Promise.all(
          activityFindings.map(async (finding) => ({
            projectId: finding.projectId,
            findingId: finding.findingId,
            findingRevision: finding.findingRevision,
            runId: finding.runId,
            findingType: finding.findingType,
            lifecycleState:
              (await findingRepository.findLifecycle(finding))?.lifecycleState ?? 'NEW',
            title: finding.findingType,
            reviewEligible: true,
            resourceHref: `/projects/${finding.projectId}/findings/${finding.findingId}`,
          })),
        );
      },
      hasReviewEligibleActivityFinding: (activityInput) =>
        findingRepository.hasReviewEligibleByJobAndRun(activityInput),
    });
    const activityScope = {
      principalId,
      activeProjectId: projectId,
      accessRevision: `${projectId}:access`,
      policyContextRevision: `${projectId}:policy`,
      sensitivityClearance: 'private',
      accessScope: ['owner', 'review'],
    };
    const mActivityQueue = await causalActivity.readQueue(activityScope, {
      domainKinds: ['DISCOVERY'],
      attention: 'NEEDS_ATTENTION',
      limit: 50,
    });
    expect(
      mActivityQueue.items.some(
        (item) => item.root.domainKind === 'DISCOVERY' && item.root.activityId === mSecondJobId,
      ),
    ).toBe(true);

    // P — the durable PostgreSQL projection wait/deadline/recovery/later-event
    // path uses the same production Coordinator, Runtime Repository, outbox,
    // worker and reconciliation authorities. The conflict Finding above is
    // intentionally the old derived Finding for the later reconciliation;
    // the refreshed compiled-truth projection records its changed relation
    // state through the normal projection repository.
    causalNow = '2026-09-01T06:00:00.000Z';
    const pTrigger = new DiscoveryTriggerCoordinator(
      canonicalSource,
      new PostgresDiscoveryProjectionReadinessAdapter(compiledTruth, semanticIndex),
      runtime,
      new StaticDiscoveryTriggerPolicy({
        ...createDefaultDiscoveryTriggerPolicyV1(),
        waitTimeoutMs: 60_000,
      }),
      { now: () => causalNow },
      {
        jobId: () => `job:${randomUUID()}`,
        currentAuthority: {
          resolve: (requestedProjectId: string) =>
            canonicalSource.resolveCurrentAuthority(requestedProjectId),
        },
      },
    );
    const pFirstCommit = await commitCausalClaim(canonical, {
      projectId,
      sourceVersionId,
      evidenceId: evidenceIds[0],
      actorId: principalId,
      claimText: 'The PostgreSQL projection wait path has a durable trigger.',
      committedAt: causalNow,
      identity: 'p-wait',
    });
    const pFirstOutbox = await canonical.findOutbox(projectId, pFirstCommit.outboxId);
    expect(pFirstOutbox?.status).toBe('pending');
    let pWaitingJobId = '';
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          const coordinated = await pTrigger.coordinateCanonicalCommitted(
            eventFor(projectId, pFirstOutbox!.payload, pFirstOutbox!.outboxId),
          );
          expect(coordinated.disposition).toBe('CREATED');
          expect(coordinated.lifecycleState).toBe('WAITING_FOR_PROJECTION');
          pWaitingJobId = coordinated.jobId;
        },
      },
      projectId,
      1,
      pFirstOutbox!.availableAt,
    );
    const pWaitingJob = await runtime.findJob({ projectId, jobId: pWaitingJobId });
    expect(pWaitingJob).toMatchObject({ lifecycleState: 'WAITING_FOR_PROJECTION' });
    expect(pWaitingJob?.projectionWait?.requiredDiscoveryBase).toBeDefined();
    const pInitialHistory = await pool!.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state
         FROM discovery.job_lifecycle_history
        WHERE project_id = $1 AND job_id = $2
        ORDER BY lifecycle_revision`,
      [projectId, pWaitingJobId],
    );
    expect(pInitialHistory.rows).toEqual([
      { from_state: null, to_state: 'WAITING_FOR_PROJECTION' },
    ]);
    causalNow = pWaitingJob!.projectionWait!.waitDeadlineAt;
    const pExpired = await pTrigger.reEvaluateCanonicalDiscoveryProjectionReadiness({
      projectId,
      jobId: pWaitingJobId,
    });
    expect(pExpired.disposition).toBe('FAILED_RETRYABLE');
    const pFailedJob = await runtime.findJob({ projectId, jobId: pWaitingJobId });
    expect(pFailedJob).toMatchObject({ lifecycleState: 'FAILED_RETRYABLE' });
    expect(pFailedJob?.projectionWait).toBeUndefined();
    const pDeadlineHistory = await pool!.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state
         FROM discovery.job_lifecycle_history
        WHERE project_id = $1 AND job_id = $2
        ORDER BY lifecycle_revision`,
      [projectId, pWaitingJobId],
    );
    expect(pDeadlineHistory.rows).toEqual([
      { from_state: null, to_state: 'WAITING_FOR_PROJECTION' },
      { from_state: 'WAITING_FOR_PROJECTION', to_state: 'FAILED_RETRYABLE' },
    ]);
    const pFailedRuntimeRows = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM discovery.runs
        WHERE project_id = $1 AND job_id = $2`,
      [projectId, pWaitingJobId],
    );
    expect(pFailedRuntimeRows.rows[0]?.count).toBe('0');

    const pRecoveryProjection = await causalProjection('akp-8-p-projection-recovery');
    await compiledTruth.synchronize(pRecoveryProjection);
    expect(
      (
        await semanticBuilder.build({
          projectId,
          targetProfileRevision: profile.profileRevision,
          generationId: `generation:${projectId}:p-recovery`,
        })
      ).status,
    ).toBe('ACTIVATED');
    const pReadiness = await new PostgresDiscoveryProjectionReadinessAdapter(
      compiledTruth,
      semanticIndex,
    ).read({
      projectId,
      requiredBase: pWaitingJob!.requiredDiscoveryBase!,
      projectionKinds: createDefaultDiscoveryTriggerPolicyV1().requiredProjectionKinds,
      observedAt: causalNow,
    });
    expect(pReadiness.status).toBe('READY');

    causalNow = '2026-09-01T06:02:00.000Z';
    const pLaterCommit = await commitCausalClaim(canonical, {
      projectId,
      sourceVersionId,
      evidenceId: evidenceIds[1],
      actorId: principalId,
      claimText: 'A later governed Canonical change reopens the causal trigger path.',
      committedAt: causalNow,
      identity: 'p-later',
    });
    const pLaterProjection = await causalProjection('akp-8-p-projection-later', 'CONFLICT');
    await compiledTruth.synchronize(pLaterProjection);
    expect(
      (
        await semanticBuilder.build({
          projectId,
          targetProfileRevision: profile.profileRevision,
          generationId: `generation:${projectId}:p-later`,
        })
      ).status,
    ).toBe('ACTIVATED');
    const pLaterOutbox = await canonical.findOutbox(projectId, pLaterCommit.outboxId);
    expect(pLaterOutbox?.status).toBe('pending');
    let pLaterJobId = '';
    await dispatchCanonicalOutbox(
      canonical,
      {
        publish: async () => {
          const coordinated = await pTrigger.coordinateCanonicalCommitted(
            eventFor(projectId, pLaterOutbox!.payload, pLaterOutbox!.outboxId),
          );
          expect(coordinated.disposition).toBe('CREATED');
          expect(coordinated.lifecycleState).toBe('QUEUED');
          pLaterJobId = coordinated.jobId;
        },
      },
      projectId,
      1,
      pLaterOutbox!.availableAt,
    );
    expect(pLaterCommit.commitId).not.toBe(pFirstCommit.commitId);
    expect(pLaterOutbox!.outboxId).not.toBe(pFirstOutbox!.outboxId);
    const pLaterJob = await runtime.findJob({ projectId, jobId: pLaterJobId });
    expect(pLaterJob).toMatchObject({ lifecycleState: 'QUEUED' });
    await runCausalWorkerToCompletion();
    const pCompletedJob = await runtime.findJob({ projectId, jobId: pLaterJobId });
    expect(pCompletedJob?.lifecycleState).toBe('SUCCEEDED');
    const reconciledMConflict = await findingRepository.findLifecycle({
      projectId,
      findingId: mSecondConflict!.findingId,
      findingRevision: mSecondConflict!.findingRevision,
    });
    expect(reconciledMConflict?.lifecycleState).toBe('STALE');
    const mConflictHistory = await pool!.query<{ from_state: string; to_state: string }>(
      `SELECT from_state, to_state
         FROM discovery.finding_lifecycle_history
        WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
        ORDER BY lifecycle_revision`,
      [projectId, mSecondConflict!.findingId, mSecondConflict!.findingRevision],
    );
    expect(mConflictHistory.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ to_state: 'STALE' })]),
    );
  });

  afterAll(async () => {
    if (pool) {
      await cleanupProject(pool, projectId);
      await pool.end();
    }
  });
});

const commitCausalClaim = async (
  repository: Pick<PostgresCanonicalKnowledgeRepository, 'getSnapshot' | 'commit'>,
  input: {
    readonly projectId: string;
    readonly sourceVersionId: string;
    readonly evidenceId: string;
    readonly actorId: string;
    readonly claimText: string;
    readonly committedAt: string;
    readonly identity: string;
  },
): Promise<CanonicalCommitResult> => {
  const before = await repository.getSnapshot(input.projectId);
  const commitId = `causal-commit:${input.identity}:${randomUUID()}`;
  const manifestId = `causal-manifest:${input.identity}:${randomUUID()}`;
  const changeSetId = `causal-changeset:${input.identity}:${randomUUID()}`;
  const candidateId = `causal-candidate:${input.identity}:${randomUUID()}`;
  const claimId = `causal-claim:${input.identity}:${randomUUID()}`;
  const evidenceIds = [input.evidenceId];
  const candidateDigest = claimCandidateDigest({
    candidateId,
    revisionNumber: 1,
    sourceVersionId: input.sourceVersionId,
    claimText: input.claimText,
    evidenceIds,
    status: 'READY',
  });
  const diffDigest = digest(`causal-diff:${input.identity}`);
  const contentDigest = changeSetContentDigest({
    operation: 'ADD_CLAIM',
    classification: 'NEW_CLAIM',
    candidateId,
    candidateRevisionNumber: 1,
    candidateDigest,
    sourceVersionId: input.sourceVersionId,
    evidenceIds,
    accessScope: ['owner', 'review'],
    sensitivity: 'private',
    expectedCanonicalVersion: before.version,
    snapshotDigest: before.digest,
    diffDigest,
  });
  const unsignedToken = {
    tokenId: `causal-token:${input.identity}:${randomUUID()}`,
    changeSetId,
    changeSetRevisionNumber: 1 as const,
    actorId: input.actorId,
    contentDigest,
    expectedCanonicalVersion: before.version,
    snapshotDigest: before.digest,
    issuedAt: input.committedAt,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const approvalToken = {
    ...unsignedToken,
    tokenDigest: approvalTokenDigest(unsignedToken),
  };
  const unsignedManifest: Omit<ApprovedChangeSetManifest, 'manifestDigest'> = {
    manifestId,
    changeSetId,
    changeSetRevisionNumber: 1,
    projectId: input.projectId,
    sourceVersionId: input.sourceVersionId,
    candidateId,
    candidateRevisionNumber: 1,
    claimText: input.claimText,
    operation: 'ADD_CLAIM',
    classification: 'NEW_CLAIM',
    candidateDigest,
    evidenceIds,
    accessScope: ['owner', 'review'],
    sensitivity: 'private',
    expectedCanonicalVersion: before.version,
    snapshotDigest: before.digest,
    diffDigest,
    contentDigest,
    approvalToken,
    reason: `Causal acceptance ${input.identity}.`,
    createdAt: input.committedAt,
  };
  const manifest: ApprovedChangeSetManifest = {
    ...unsignedManifest,
    manifestDigest: approvedChangeSetManifestDigest(unsignedManifest),
  };
  return repository.commit({
    commitId,
    revisionId: `causal-revision:${input.identity}:${randomUUID()}`,
    historyEventId: `causal-history:${input.identity}:${randomUUID()}`,
    outboxId: `causal-outbox:${input.identity}:${randomUUID()}`,
    claimId,
    manifest,
    actor: { type: 'user', id: input.actorId },
    committedAt: input.committedAt,
  });
};

const eventFor = (
  projectId: string,
  payload: CanonicalCommittedPayload,
  outboxId: string,
): DiscoveryCanonicalCommittedEventEnvelopeV1 => ({
  messageId: `akp-8-event:${outboxId}`,
  messageType: 'CanonicalCommitted',
  messageKind: 'event',
  schemaVersion: '1.0.0',
  producerModule: 'stage6.canonical-knowledge',
  producerVersion: '1.0.0',
  correlationId: `akp-8-correlation:${payload.commitId}`,
  projectId,
  actor: { type: 'user', id: payload.actorId },
  security: {
    accessScope: payload.accessScope,
    sensitivity: payload.sensitivity,
    dataClassification: 'canonical',
  },
  payload,
  createdAt: now,
  traceId: `akp-8-trace:${outboxId}`,
  idempotencyKey: `canonical-outbox:${outboxId}`,
});

const createProductExecution = (input: {
  readonly projectId: string;
  readonly compiledTruth: PostgresCompiledTruthRepository;
  readonly findingRepository: PostgresDiscoveryFindingRepository;
  readonly runtime: PostgresDiscoveryRuntimeRepository;
  readonly evidenceRepository: PostgresEvidenceRepository;
  readonly semanticRetriever: SemanticRetriever;
  readonly reviewReader: ReviewDiscoveryCandidateReader;
  readonly competingResource?: DiscoveryCompetingResourcePortV1;
}) =>
  createProductDiscoveryExecution({
    compiledTruthRepository: input.compiledTruth,
    findingRepository: input.findingRepository,
    runtimeRepository: input.runtime,
    resolveSecurity: async () => ({
      projectId: input.projectId,
      accessScope: ['owner', 'review'],
      sensitivity: 'private' as const,
    }),
    findAuthoritativeEquivalent: async () => false,
    findAcceptedReviewResource: async ({ projectId, candidate }) => {
      const source = await input.reviewReader.findByFinding?.(
        projectId,
        candidate.findingId,
        candidate.findingRevision,
      );
      if (!source || !('origin' in source) || source.origin !== 'DERIVED_DISCOVERY') {
        return undefined;
      }
      return {
        reviewResourceId: source.reviewResourceId,
        reviewResourceRevision: source.resourceRevision,
      };
    },
    evidenceRepository: input.evidenceRepository,
    semanticRetriever: input.semanticRetriever,
    ...(input.competingResource === undefined
      ? {}
      : { competingResource: input.competingResource }),
    temporalCompatibility: {
      read: async ({ context, resourceRefs }) => {
        const approvedEntities = resourceRefs.filter(
          (resource) =>
            resource.resourceKind === 'CANONICAL_ENTITY' && resource.resourceState === 'APPROVED',
        );
        const pairs = approvedEntities.flatMap((left, index) =>
          approvedEntities.slice(index + 1).map((right) => ({
            left,
            right,
            compatible: true,
            temporalEvidenceId: `akp-8-temporal-authority:${context.projectId}`,
          })),
        );
        return {
          sourceProjectionDigest: context.sourceProjectionDigest,
          canonicalBase: context.canonicalBase,
          discoveryBase: context.discoveryBase,
          semanticGenerationId: `generation:${context.projectId}:v1`,
          compatibilities: pairs,
          completeness: 'COMPLETE',
        } satisfies Awaited<ReturnType<NonNullable<DiscoveryTemporalCompatibilityPortV1['read']>>>;
      },
    } satisfies DiscoveryTemporalCompatibilityPortV1,
    createGenerationService: (budget) => createDiscoveryGenerationFactory(input.projectId)(budget),
    observeReconciliation: observeDiscoveryReconciliation,
  });

const createDraftCommitDependencies = (
  reviewStore: PostgresFrontendReviewRepository,
  canonical: PostgresCanonicalKnowledgeRepository,
  bridge: PostgresDiscoveryAuthoringBridge,
): FrontendKnowledgeDraftCommitDependenciesV1 => ({
  approvals: {
    findByIdWithRevision: async (approvalId) =>
      reviewStore.transaction((repositories) =>
        repositories.approvals.findByIdWithRevision(approvalId),
      ),
    findByIdWithRevisionInTransaction: async (transaction, approvalId) =>
      reviewStore.repositoriesOn(transaction).approvals.findByIdWithRevision(approvalId),
    consumeApproval: async (approvalId, commitId, consumedAt, consumedBy) =>
      reviewStore.transaction((repositories) =>
        repositories.approvals.consumeApproval(approvalId, commitId, consumedAt, consumedBy),
      ),
    consumeApprovalInTransaction: async (
      transaction,
      approvalId,
      commitId,
      consumedAt,
      consumedBy,
    ) =>
      reviewStore
        .repositoriesOn(transaction)
        .approvals.consumeApproval(approvalId, commitId, consumedAt, consumedBy),
  },
  canonical,
  discoveryRelationAuthority: bridge,
});
