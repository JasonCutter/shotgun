import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import {
  DiscoveryAIExecutionResolver,
  EffectiveAIConfigurationResolver,
} from '../../adapters/ai-runtime-resolution/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryModelProfileRepository } from '../../adapters/discovery-model-profile-postgres/src/index.js';
import {
  PostgresDiscoveryApprovedResourceRevisionResolver,
  PostgresDiscoveryReentryRepository,
} from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { PostgresAskProviderPolicyAuthorityReader } from '../../adapters/frontend-ask-provider-policy-postgres/src/index.js';
import {
  PostgresDiscoveryReviewResourceRepository,
  createPostgresReviewDiscoveryCandidateReader,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  DISCOVERY_AI_PROMPT_VERSION_V1,
  DiscoveryAIGenerationService,
  DiscoveryModelProfileService,
} from '../../modules/discovery-ai-generation/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReviewMaterializer,
} from '../../modules/discovery-reentry/src/index.js';
import { AskProviderPolicyResolver } from '../../modules/frontend-ask-provider-policy/src/index.js';
import {
  ProjectAIConfigurationService,
  initialProviderRegistry,
} from '../../modules/ai-configuration/src/index.js';
import { ProviderExternalTransferApprovalService } from '../../modules/provider-privacy-policy/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryLogicalJobIdentityV1,
  sha256Text,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryQualifiedAIGenerationContextV1,
  type DiscoveryResourceRefV1,
  type DiscoveryRuntimeBudgetBindingV1,
  type DiscoveryStructuredGenerationRequestV1,
  type DiscoveryStructuredProviderPort,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const now = '2026-09-02T05:00:00.000Z';
const digest = (value: string): `sha256:${string}` => sha256Text(value) as `sha256:${string}`;

const budget: DiscoveryRuntimeBudgetBindingV1 = {
  schemaVersion: '1.0.0',
  budgetVersion: 'discovery-work-budget:v1',
  budgetId: 'akp-8-wp3-correction-budget',
  budgetRevision: '1',
  maxResources: 10,
  maxSemanticNeighbors: 10,
  maxCandidatePairs: 5,
  maxCandidateGroups: 5,
  maxFindings: 5,
  maxProviderCalls: 1,
  maxInputTokens: 200,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 100,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const actionContext = (
  projectId: string,
  claimId: string,
): DiscoveryQualifiedAIGenerationContextV1 => {
  const resource: DiscoveryResourceRefV1 = {
    schemaVersion: '1.0.0',
    resourceKind: 'CANONICAL_CLAIM',
    resourceId: claimId,
    projectId,
    resourceState: 'CURRENT',
  };
  return {
    projectId,
    accessScope: ['owner'],
    sensitivity: 'private',
    sourceProjectionDigest: digest(`${projectId}:source`),
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: digest(`${projectId}:canonical`),
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: `${projectId}:projection`,
      projectionDigest: digest(`${projectId}:source`),
    },
    originatingFindingType: 'KNOWLEDGE_GAP',
    originIdentity: {
      schemaVersion: '1.0.0',
      originFindingType: 'KNOWLEDGE_GAP',
      fingerprintVersion: 'discovery-fingerprint:v1',
      fingerprint: digest(`${projectId}:origin`),
    },
    boundedRationale: 'The owner must review one bounded action candidate.',
    items: [
      { resourceRef: resource, deterministicRepresentation: 'A bounded claim.', evidenceIds: [] },
    ],
  };
};

const cleanupProject = async (projectId: string): Promise<void> => {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    for (const [table, column] of [
      ['discovery.reentry_review_resources', 'project_id'],
      ['discovery.reentry_review_roots', 'project_id'],
      ['discovery.reentry_consumption', 'project_id'],
      ['discovery.reentry_candidates', 'project_id'],
      ['discovery.reentry_manifests', 'project_id'],
      ['discovery.finding_ready', 'project_id'],
      ['discovery.finding_lifecycle_history', 'project_id'],
      ['discovery.finding_lifecycle_current', 'project_id'],
      ['discovery.findings', 'project_id'],
      ['discovery.attempt_lifecycle_history', 'project_id'],
      ['discovery.attempts', 'project_id'],
      ['discovery.run_lifecycle_history', 'project_id'],
      ['discovery.runs', 'project_id'],
      ['discovery.job_lifecycle_history', 'project_id'],
      ['discovery.jobs', 'project_id'],
      ['discovery.model_profiles', 'project_id'],
      ['settings.provider_external_transfer_approval_revisions', 'project_id'],
      ['settings.provider_external_transfer_approvals', 'project_id'],
      ['ai.project_ai_configuration_revisions', 'project_id'],
      ['ai.project_ai_configurations', 'project_id'],
      ['ai.provider_credentials', 'project_id'],
      ['auth.project_memberships', 'project_id'],
      ['project_admin.projects', 'id'],
    ] as const) {
      await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [projectId]);
    }
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

const insertCanonicalAuthority = async (projectId: string, claimId: string): Promise<void> => {
  const commitId = randomUUID();
  const manifestId = randomUUID();
  const sourceVersionId = randomUUID();
  const canonicalDigest = digest(`${projectId}:canonical`);
  await pool!.query(
    `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
     VALUES ($1, 1, $2, $3)`,
    [projectId, canonicalDigest, now],
  );
  await pool!.query(
    `INSERT INTO canonical.commits
       (commit_id, project_id, manifest_id, manifest_digest, change_set_id, result_json, committed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      commitId,
      projectId,
      manifestId,
      digest(`${projectId}:manifest`),
      randomUUID(),
      JSON.stringify({ afterVersion: 1, snapshotDigest: canonicalDigest }),
      now,
    ],
  );
  await pool!.query(
    `INSERT INTO canonical.claims
       (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [claimId, projectId, sourceVersionId, manifestId, JSON.stringify({ claimId }), now],
  );
  await pool!.query(
    `INSERT INTO canonical.revisions
       (revision_id, project_id, commit_id, revision_json, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      `${projectId}:claim-revision`,
      projectId,
      commitId,
      JSON.stringify({ claimId, afterVersion: 1, revisionId: `${projectId}:claim-revision` }),
      now,
    ],
  );
};

const jobFor = (projectId: string, runId: string, profileId: string) => {
  const trigger = {
    schemaVersion: '1.0.0' as const,
    triggerId: `${projectId}:trigger`,
    triggerClass: 'MANUAL' as const,
    triggerIdentity: {
      kind: 'MANUAL' as const,
      commandId: `${projectId}:command`,
      requestId: `${projectId}:request`,
    },
    actor: { actorId: `${projectId}:actor`, principalId: `${projectId}:principal` },
    projectId,
    requestedScanMode: 'INCREMENTAL' as const,
    effectiveScanMode: 'INCREMENTAL' as const,
    canonicalBase: {
      schemaVersion: '1.0.0' as const,
      canonicalVersion: 1,
      snapshotDigest: digest(`${projectId}:canonical`),
    },
    requiredDiscoveryBase: {
      schemaVersion: '1.0.0' as const,
      projectionRevision: `${projectId}:projection`,
      projectionDigest: digest(`${projectId}:source`),
    },
    policyRevision: `${projectId}:policy`,
    strategyRevision: `${projectId}:strategy`,
    profileBinding: { profileId, profileRevision: 1 },
    createdAt: now,
    observedAt: now,
  };
  return {
    schemaVersion: '1.0.0' as const,
    jobId: `${projectId}:job`,
    logicalIdentity: createDiscoveryLogicalJobIdentityV1(trigger),
    projectId,
    trigger,
    requestedScanMode: 'INCREMENTAL' as const,
    effectiveScanMode: 'INCREMENTAL' as const,
    canonicalBase: trigger.canonicalBase,
    requiredDiscoveryBase: trigger.requiredDiscoveryBase,
    policyRevision: trigger.policyRevision,
    strategyRevision: trigger.strategyRevision,
    profileBinding: trigger.profileBinding,
    budget,
    lifecycleState: 'QUEUED' as const,
    lifecycleRevision: 1,
    createdAt: now,
    updatedAt: now,
  };
};

const actionFindingFromProposal = (
  proposal: Awaited<ReturnType<DiscoveryAIGenerationService['generateAction']>>,
  projectId: string,
): DiscoveryFindingEnvelopeV1 => {
  if (proposal.provenance.kind !== 'AI_ASSISTED') {
    throw new Error('The correction fixture must persist an AI-assisted Action proposal.');
  }
  if (proposal.payload.payloadType !== 'ACTION_SUGGESTION') {
    throw new Error('The correction fixture must persist an Action payload.');
  }
  return createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: `${projectId}:action`,
    findingRevision: 1,
    projectId,
    findingType: 'ACTION_SUGGESTION',
    generationMethod: proposal.generationMethod,
    lifecycleState: 'NEW',
    payload: proposal.payload,
    relatedResourceRefs: proposal.relatedResourceRefs,
    evidenceIds: proposal.evidenceIds,
    sourceProjectionDigest: proposal.sourceProjectionDigest,
    canonicalBase: proposal.canonicalBase,
    discoveryBase: proposal.discoveryBase,
    runId: proposal.runId,
    signalSummary: proposal.signalSummary,
    rationale: proposal.rationale,
    derivationSummary: proposal.derivationSummary,
    provenance: proposal.provenance,
    accessScope: proposal.security.accessScope,
    sensitivity: proposal.security.sensitivity,
    fingerprint: digest(`${projectId}:finding`),
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });
};

const createProvider = (calls: {
  request?: DiscoveryStructuredGenerationRequestV1;
  count: number;
}): DiscoveryStructuredProviderPort => ({
  identity: {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    adapterVersion: 'akp-8-wp3-correction-double:v1',
    dataPolicyVersion: 'akp-8-wp3-data-policy:v1',
  },
  generateStructured: async (request) => {
    calls.count += 1;
    calls.request = request;
    return {
      rawText: JSON.stringify({
        suggestedAction: 'Ask an owner to review the candidate.',
        rationale: 'The result is non-executable until governed approval.',
        riskContext: 'No external side effect is authorized.',
      }),
      providerResponseId: 'akp-8-wp3-correction-response',
      modelVersion: 'akp-8-wp3-correction-model:v1',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
    };
  },
});

const createPolicyFixture = async (input: { approve: boolean }) => {
  const projectId = `akp-8-wp3-correction-${randomUUID()}`;
  const principalId = randomUUID();
  const claimId = `${projectId}:claim`;
  await pool!.query(
    `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $2, 'ACTIVE', true, $3, $3, 1)`,
    [projectId, 'AKP-8 WP3 correction acceptance', now],
  );
  await pool!.query(
    `INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at)
     VALUES ($1, 'user', 'active', $2, $3)`,
    [principalId, `${projectId}:account`, now],
  );
  await pool!.query(
    `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
     VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
    [principalId, projectId],
  );
  await insertCanonicalAuthority(projectId, claimId);

  const registry = initialProviderRegistry();
  const vault = new CredentialVaultService(
    new PostgresCredentialVaultRepository(pool!),
    new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 7), keyVersion: 'akp8-corr' }),
  );
  const credential = await vault.create({
    projectId,
    providerId: 'openai',
    secret: `${projectId}:secret-value`,
    clientRequestId: `${projectId}:credential`,
    now,
  });
  const configuration = new ProjectAIConfigurationService(
    registry,
    new PostgresProjectAIConfigurationRepository(pool!),
    vault,
  );
  const modelId = 'gpt-5.6-luna';
  await configuration.save({
    projectId,
    expectedRevision: 0,
    activeProviderId: 'openai',
    activeModelId: modelId,
    credentialId: credential.credentialId,
    credentialRevision: credential.credentialRevision,
    updatedBy: principalId,
    now,
  });
  const approval = new ProviderExternalTransferApprovalService(
    new PostgresProviderExternalTransferApprovalRepository(pool!),
    registry,
  );
  if (input.approve) {
    const proposal = await approval.propose({
      projectId,
      providerId: 'openai',
      approved: true,
      expectedApprovalRevision: 0,
      proposedBy: principalId,
    });
    await approval.approve({
      proposalId: proposal.proposalId,
      projectId,
      providerId: 'openai',
      expectedApprovalRevision: 0,
      reviewedBy: principalId,
    });
  }
  const policy = new AskProviderPolicyResolver(
    new PostgresAskProviderPolicyAuthorityReader(pool!),
    {
      providerId: 'google-gemini',
      deploymentPrivateTransferAllowed: true,
      deploymentPrivateTransferAllowedForProvider: () => true,
      providerIdResolver: async (id) => (await configuration.getCurrent(id))?.activeProviderId,
      providerModelResolver: async (id, providerId) => {
        const current = await configuration.getCurrent(id);
        return current?.activeProviderId === providerId ? current.activeModelId : undefined;
      },
      providerDescriptor: (providerId, selectedModelId) => {
        const provider = registry.getProvider(providerId);
        const model = registry.getModel(providerId, selectedModelId ?? '');
        return provider && model
          ? {
              policyIdentity: `${provider.providerPolicyId}:${provider.providerPolicyRevision}`,
              displayName: provider.displayName,
              model: model.modelId,
            }
          : undefined;
      },
      providerPolicyIdentity: 'akp-8-wp3-ask-policy:v1',
      providerDisplayName: 'OpenAI',
      providerModel: modelId,
    },
  );
  const authority = new EffectiveAIConfigurationResolver(registry, configuration, vault, {
    policy,
  });
  const profileService = new DiscoveryModelProfileService(
    registry,
    configuration,
    vault,
    new PostgresDiscoveryModelProfileRepository(pool!),
  );
  const profile = await profileService.createProfile({
    projectId,
    expectedRevision: 0,
    aiConfigurationRevision: 1,
    providerId: 'openai',
    modelId,
    promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
    outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
    createdBy: principalId,
    now,
  });
  await profileService.activateProfile({
    projectId,
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    now,
  });
  const calls = {
    count: 0,
    request: undefined as DiscoveryStructuredGenerationRequestV1 | undefined,
  };
  const provider = createProvider(calls);
  const resolver = new DiscoveryAIExecutionResolver(authority);
  const service = new DiscoveryAIGenerationService(
    profileService,
    resolver,
    { resolve: async () => provider },
    {
      executeProviderCall: async ({ provider: selected, request }) => ({
        status: 'SUCCEEDED' as const,
        response: await selected.generateStructured(request),
        completion: 'COMPLETE' as const,
        truncation: { truncated: false as const },
        tokenEstimatorRevision: 'akp-8-wp3-token-estimator:v1',
        costEstimatorRevision: 'akp-8-wp3-cost-estimator:v1',
      }),
    },
  );
  return { projectId, principalId, claimId, credential, profile, service, calls, authority };
};

describe('AKP-8 WP3 final correction: durable Action and production policy authority', () => {
  if (!pool) {
    it.skip('TEST_DATABASE_URL is unavailable; correction proof is deferred to automatic CI.', () => {});
    return;
  }

  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('persists the actual ACTION_SUGGESTION generation through FindingReady, re-entry and Review', async () => {
    const fixture = await createPolicyFixture({ approve: true });
    try {
      const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
      const job = jobFor(fixture.projectId, `${fixture.projectId}:run`, fixture.profile.profileId);
      expect(await runtime.saveJob(job)).toBe('CREATED');
      const claim = await runtime.claimNext({
        projectId: fixture.projectId,
        workerId: `${fixture.projectId}:worker`,
        now,
        leaseDurationMs: 30_000,
      });
      expect(claim).toBeDefined();
      const context = actionContext(fixture.projectId, fixture.claimId);
      const proposal = await fixture.service.generateAction({
        projectId: fixture.projectId,
        runId: claim!.runId,
        context,
      });
      expect(proposal.findingType).toBe('ACTION_SUGGESTION');
      expect(proposal.payload).toMatchObject({
        payloadType: 'ACTION_SUGGESTION',
        executionStatus: 'CANDIDATE_ONLY',
      });
      const finding = actionFindingFromProposal(proposal, fixture.projectId);
      const findings = new PostgresDiscoveryFindingRepository(pool!);
      expect(await findings.saveFenced(finding, { ...claim!, now })).toBe('CREATED');
      const publication = {
        schemaVersion: '1.0.0' as const,
        publicationId: `${fixture.projectId}:finding-ready`,
        projectId: fixture.projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        fingerprint: finding.fingerprint,
        fingerprintVersion: finding.fingerprintVersion,
        jobId: claim!.jobId,
        runId: claim!.runId,
        attemptId: claim!.attemptId,
        canonicalBase: finding.canonicalBase,
        requiredDiscoveryBase: finding.discoveryBase,
        occurredAt: now,
      };
      expect(await runtime.publishFindingReady({ ...claim!, publication })).toBe('CREATED');
      const ready = await runtime.findFindingReady(finding);
      expect(ready).toMatchObject({ findingId: finding.findingId, runId: claim!.runId });

      const reentry = new PostgresDiscoveryReentryRepository(pool!, {
        lifecycleRepository: findings,
      });
      const consumed = await new DiscoveryReentryConsumer(
        reentry,
        new PostgresDiscoveryApprovedResourceRevisionResolver(pool!),
        () => new Date(now),
      ).consume(ready!);
      expect(consumed.status).toBe('CREATED');
      if (consumed.status !== 'CREATED') return;
      const materialized = await new DiscoveryReviewMaterializer(
        reentry,
        new PostgresDiscoveryReviewResourceRepository(pool!),
      ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey });
      expect(materialized.status).toBe('CREATED');
      const review = await createPostgresReviewDiscoveryCandidateReader(pool!).findByFinding!(
        fixture.projectId,
        finding.findingId,
        finding.findingRevision,
      );
      expect(review).toMatchObject({
        origin: 'DERIVED_DISCOVERY',
        content: { normalizedMaterial: { materializationTarget: 'ACTION_CANDIDATE' } },
      });

      const actionAuthorityRows = await pool!.query<{
        readonly candidates: number;
        readonly executions: number;
        readonly preview_snapshots: number;
        readonly approval_records: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM action.candidates WHERE project_id = $1) AS candidates,
           (SELECT COUNT(*)::int FROM action.executions WHERE project_id = $1) AS executions,
           (SELECT COUNT(*)::int FROM action.preview_snapshots WHERE project_id = $1) AS preview_snapshots,
           (SELECT COUNT(*)::int FROM action.approval_records
              WHERE action_id IN (
                SELECT action_id FROM action.executions WHERE project_id = $1
              )) AS approval_records`,
        [fixture.projectId],
      );
      expect(actionAuthorityRows.rows[0]).toEqual({
        candidates: 0,
        executions: 0,
        preview_snapshots: 0,
        approval_records: 0,
      });
      // No trusted Stage 11 Candidate exists, so the existing Action
      // authority cannot create a Preview/Approval or reach its connector.
      const externalExecuteCalls = 0;
      expect(externalExecuteCalls).toBe(0);
      expect(fixture.calls.count).toBe(1);
      expect(fixture.calls.request?.prompt).not.toContain(fixture.credential.credentialId);
    } finally {
      await cleanupProject(fixture.projectId);
    }
  }, 30_000);

  it('uses the production Ask policy authority and fails closed before provider routing when denied', async () => {
    const denied = await createPolicyFixture({ approve: false });
    try {
      await expect(
        denied.service.generateAction({
          projectId: denied.projectId,
          runId: `${denied.projectId}:run`,
          context: actionContext(denied.projectId, denied.claimId),
        }),
      ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      expect(denied.calls.count).toBe(0);

      const allowed = await createPolicyFixture({ approve: true });
      try {
        const context = actionContext(allowed.projectId, allowed.claimId);
        const proposal = await allowed.service.generateAction({
          projectId: allowed.projectId,
          runId: `${allowed.projectId}:run`,
          context,
        });
        expect(allowed.calls.count).toBe(1);
        expect(allowed.calls.request?.prompt).not.toContain(allowed.credential.credentialId);
        expect(allowed.calls.request?.prompt).not.toContain(`${allowed.projectId}:secret-value`);
        expect(proposal.provenance).toMatchObject({
          kind: 'AI_ASSISTED',
          providerId: 'openai',
          modelId: 'gpt-5.6-luna',
          credentialId: allowed.credential.credentialId,
          credentialRevision: String(allowed.credential.credentialRevision),
          promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
          outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
        });
        expect(proposal.payload).toMatchObject({ executionStatus: 'CANDIDATE_ONLY' });
      } finally {
        await cleanupProject(allowed.projectId);
      }
    } finally {
      await cleanupProject(denied.projectId);
    }
  }, 30_000);
});
