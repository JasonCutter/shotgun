import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { AIProviderRouter } from '../../adapters/ai-provider-router/src/index.js';
import { StructuredAskAnswerProviderAdapter } from '../../adapters/ai-provider-ask/src/index.js';
import {
  EffectiveAIConfigurationResolver,
  type LegacyGeminiRuntimeAuthority,
} from '../../adapters/ai-runtime-resolution/src/index.js';
import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresAskProviderPolicyAuthorityReader } from '../../adapters/frontend-ask-provider-policy-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import {
  AISettingsBackendService,
  StaticAIProviderConnectivityRegistry,
  type AIProviderConnectivityAdapter,
} from '../../modules/ai-settings-backend/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
} from '../../modules/ai-configuration/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  AskAnswerExecutionService,
  type AskExecutionIdentityResolverPort,
  type AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import { AskProviderPolicyResolver } from '../../modules/frontend-ask-provider-policy/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import {
  parseProviderDeploymentCeiling,
  ProviderExternalTransferApprovalService,
} from '../../modules/provider-privacy-policy/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  type AskAnswerRunSnapshot,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);
const now = () => new Date().toISOString();

type ProviderId = 'deepseek' | 'openai' | 'google-gemini';

type Fixture = {
  readonly suffix: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly scope: {
    readonly principalId: string;
    readonly sessionId: string;
    readonly activeProject: {
      readonly id: string;
      readonly label: string;
      readonly isOwner: true;
      readonly sensitivityClearance: 'private';
    };
    readonly accessibleProjects: readonly {
      readonly id: string;
      readonly label: string;
      readonly isOwner: true;
      readonly sensitivityClearance: 'private';
    }[];
    readonly accessRevision: string;
    readonly policyContextRevision: string;
    readonly executionAuthorities: Record<
      string,
      {
        readonly projectId: string;
        readonly accessRevision: string;
        readonly policyContextRevision: string;
        readonly accessScope: readonly ['owner'];
        readonly sensitivityClearance: 'private';
      }
    >;
  };
  readonly executionScope: AskExecutionScope;
  readonly backend: AISettingsBackendService;
  readonly configuration: ProjectAIConfigurationService;
  readonly approval: ProviderExternalTransferApprovalService;
  readonly executionRepository: PostgresAskAnswerExecutionRepository;
  readonly executionIdentityResolver: AskExecutionIdentityResolverPort;
  readonly initialIdentityResolutionRunIds: string[];
  readonly execution: AskAnswerExecutionService;
  readonly coordinator: AskCommandCoordinator;
  readonly projection: PostgresAskWorkspaceProjection;
  readonly providerCalls: {
    readonly providerId: ProviderId;
    readonly modelId: string;
  }[];
  readonly failNext: (providerId: ProviderId) => void;
  readonly legacy: { enabled: boolean };
};

const contentHash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const waitForTerminal = async (
  fixture: Fixture,
  answerRunId: string,
  expected: readonly AskAnswerRunSnapshot['state'][] = ['SUCCEEDED'],
): Promise<AskAnswerRunSnapshot> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const run = await fixture.projection.getAnswerRun({
      ...fixture.scope,
      answerRunId,
    });
    if (expected.includes(run.state)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`AnswerRun ${answerRunId} did not reach ${expected.join(', ')}`);
};

const enqueue = async (fixture: Fixture, question: string): Promise<AskAnswerRunSnapshot> => {
  const result = await fixture.coordinator.submitQuestion({
    ...fixture.scope,
    request: {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: `a9-submit-${fixture.suffix}-${randomUUID()}`,
      idempotencyKey: `a9-idempotency-${fixture.suffix}-${randomUUID()}`,
      question,
      mode: 'SOURCE_EXPLORATION',
      sourceSelections: [
        {
          sourceId: fixture.sourceId,
          sourceVersionId: fixture.sourceVersionId,
          evidenceIds: [],
        },
      ],
    },
  });
  return result.answerRun;
};

const submit = async (fixture: Fixture, question: string): Promise<AskAnswerRunSnapshot> => {
  const queued = await enqueue(fixture, question);
  await fixture.execution.execute(fixture.executionScope, queued.answerRunId);
  return waitForTerminal(fixture, queued.answerRunId, ['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN']);
};

const configure = async (fixture: Fixture, providerId: ProviderId, expectedRevision: number) => {
  const descriptor = initialProviderRegistry().getProvider(providerId)!;
  const credential = await fixture.backend.createCredential({
    projectId: fixture.projectId,
    providerId,
    secret: `a9-synthetic-secret-${fixture.suffix}-${providerId}-${randomUUID()}`,
    clientRequestId: `a9-create-${fixture.suffix}-${providerId}-${randomUUID()}`,
  });
  const configuration = await fixture.backend.saveConfiguration({
    projectId: fixture.projectId,
    expectedRevision,
    activeProviderId: providerId,
    activeModelId: descriptor.models[0]!.modelId,
    credentialId: credential.credentialId,
    credentialRevision: credential.credentialRevision,
    updatedBy: fixture.principalId,
  });
  return { credential, configuration };
};

const approve = async (
  fixture: Fixture,
  providerId: ProviderId,
  approved: boolean,
  expectedApprovalRevision: number,
): Promise<void> => {
  const proposal = await fixture.approval.propose({
    projectId: fixture.projectId,
    providerId,
    approved,
    expectedApprovalRevision,
    proposedBy: fixture.principalId,
  });
  await fixture.approval.approve({
    proposalId: proposal.proposalId,
    projectId: fixture.projectId,
    providerId,
    expectedApprovalRevision,
    reviewedBy: fixture.principalId,
  });
};

const createFixture = async (
  input: {
    readonly sensitivity?: 'public' | 'private';
    readonly legacyGemini?: boolean;
  } = {},
): Promise<Fixture> => {
  const suffix = randomUUID();
  const projectId = `a9-evidence-project-${suffix}`;
  const auth = new PostgresAuthRepository(pool);
  const principal = await auth.bootstrapLocalOwnerPrincipal({
    accountId: `a9-evidence-owner-${suffix}`,
  });
  const project = new PostgresProjectAdministrationRepository(pool);
  await project.createProject({
    commandId: `a9-project-command-${suffix}`,
    clientRequestId: `a9-project-request-${suffix}`,
    idempotencyKey: `a9-project-idempotency-${suffix}`,
    projectId,
    name: 'A9 Evidence Fixture',
    description: 'Deterministic A9 cross-boundary verification fixture',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  await auth.createProjectOwnerMembership({
    principalId: principal.principalId,
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });

  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const assetId = randomUUID();
  const sourceHash = contentHash(`a9-source-${suffix}`);
  await pool.query(
    `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, 64, $3, now())`,
    [assetId, sourceHash, `a9-evidence-${suffix}`],
  );
  await pool.query(
    `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [sourceId, projectId, principal.principalId],
  );
  await pool.query(
    `INSERT INTO asset.source_versions (
       source_version_id, source_id, version_number, original_asset_id,
       media_type, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', $4, now())`,
    [sourceVersionId, sourceId, assetId, input.sensitivity ?? 'public'],
  );

  const registry = initialProviderRegistry();
  const vault = new CredentialVaultService(
    new PostgresCredentialVaultRepository(pool),
    new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 7), keyVersion: 'a9-test' }),
  );
  const configuration = new ProjectAIConfigurationService(
    registry,
    new PostgresProjectAIConfigurationRepository(pool),
    vault,
  );
  const approval = new ProviderExternalTransferApprovalService(
    new PostgresProviderExternalTransferApprovalRepository(pool),
    registry,
  );
  const providerCalls: { providerId: ProviderId; modelId: string }[] = [];
  const failures = new Set<ProviderId>();
  const adapters: AIProviderConnectivityAdapter[] = (
    ['deepseek', 'openai', 'google-gemini'] as const
  ).map((providerId) => ({
    providerId,
    testConnection: async () => ({ providerRequestId: `deterministic-${providerId}` }),
    generateStructured: async ({ modelId }) => {
      providerCalls.push({ providerId, modelId });
      if (failures.delete(providerId)) {
        throw Object.assign(new Error('Synthetic retryable provider failure.'), {
          code: 'RETRYABLE_DEPENDENCY',
        });
      }
      return {
        rawText: JSON.stringify({ answer: `Deterministic ${providerId} answer.`, citations: [] }),
        providerResponseId: `deterministic-${providerId}-${providerCalls.length}`,
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      };
    },
  }));
  const connectivity = new StaticAIProviderConnectivityRegistry(adapters);
  const deployment = parseProviderDeploymentCeiling({
    providerAllowlist: 'deepseek,openai,google-gemini',
  });
  const legacy = { enabled: input.legacyGemini ?? false };
  const backend = new AISettingsBackendService(
    registry,
    configuration,
    vault,
    connectivity,
    deployment,
    {
      getLegacyExternalTransferAllowed: async () => legacy.enabled,
    },
    approval,
    now,
    { isGeminiCredentialConfigured: () => legacy.enabled },
  );
  const providerPolicy = new AskProviderPolicyResolver(
    new PostgresAskProviderPolicyAuthorityReader(pool),
    {
      providerId: 'google-gemini',
      deploymentPrivateTransferAllowed: deployment.allows('google-gemini'),
      deploymentPrivateTransferAllowedForProvider: (providerId) => deployment.allows(providerId),
      providerIdResolver: async (id) => (await configuration.getCurrent(id))?.activeProviderId,
      providerModelResolver: async (id, providerId) => {
        const current = await configuration.getCurrent(id);
        return current?.activeProviderId === providerId ? current.activeModelId : undefined;
      },
      providerDescriptor: (providerId, modelId) => {
        const provider = registry.getProvider(providerId);
        const model = registry.getModel(providerId, modelId ?? provider?.models[0]?.modelId ?? '');
        return provider && model
          ? {
              policyIdentity: `${provider.providerPolicyId}:${provider.providerPolicyRevision}`,
              displayName: provider.displayName,
              model: model.modelId,
            }
          : undefined;
      },
      providerPolicyIdentity: 'a9-deterministic-policy-v1',
      providerDisplayName: 'Deterministic provider',
      providerModel: 'deterministic-model',
    },
  );
  const legacyAuthority: LegacyGeminiRuntimeAuthority = {
    readLegacyExternalTransferAllowed: async () => legacy.enabled,
    readGeminiApproval: async (id) => approval.getCurrent(id, 'google-gemini'),
  };
  const runtimeIdentityResolver = new EffectiveAIConfigurationResolver(
    registry,
    configuration,
    vault,
    {
      policy: providerPolicy,
      legacyAuthority,
      legacyCredential: () => (legacy.enabled ? 'legacy-gemini-test-secret' : undefined),
      legacyModelId: registry.getProvider('google-gemini')!.models[0]!.modelId,
    },
  );
  const initialIdentityResolutionRunIds: string[] = [];
  const identityResolver: AskExecutionIdentityResolverPort = {
    resolveInitialAIExecutionIdentity: async (input) => {
      initialIdentityResolutionRunIds.push(input.answerRunId);
      return runtimeIdentityResolver.resolveInitialAIExecutionIdentity(input);
    },
    revalidatePinnedCredential: (input) =>
      runtimeIdentityResolver.revalidatePinnedCredential(input),
  };
  const projection = new PostgresAskWorkspaceProjection(pool);
  const sourceText = 'A9 deterministic public source content.';
  const executionRepository = new PostgresAskAnswerExecutionRepository(pool, projection, {
    resolve: async ({ sourceId: requestedSourceId, sourceVersionId: requestedVersionId }) =>
      requestedSourceId === sourceId && requestedVersionId === sourceVersionId
        ? {
            kind: 'SOURCE_VERSION',
            sourceId,
            sourceVersionId,
            contentHash: sourceHash,
            mediaType: 'text/plain',
            text: sourceText,
            sensitivity: input.sensitivity ?? 'public',
          }
        : undefined,
  });
  const execution = new AskAnswerExecutionService(
    executionRepository,
    new StructuredAskAnswerProviderAdapter(new FakeAIProviderAdapter()),
    {
      executionIdentityResolver: identityResolver,
      providerRouter: new AIProviderRouter(registry, connectivity, vault, {
        legacyCredential: () => (legacy.enabled ? 'legacy-gemini-test-secret' : undefined),
      }),
      providerPolicy,
    },
  );
  const gateway = new PostgresFrontendCommandGateway(pool);
  const coordinator = new AskCommandCoordinator(
    gateway,
    new PostgresAskConversationRepository(pool),
    projection,
    new PostgresAskSourceSelectionValidator(pool),
    execution,
    providerPolicy,
  );
  const scope = {
    principalId: principal.principalId,
    sessionId: `a9-session-${suffix}`,
    activeProject: {
      id: projectId,
      label: 'A9 Evidence Fixture',
      isOwner: true as const,
      sensitivityClearance: 'private' as const,
    },
    accessibleProjects: [
      {
        id: projectId,
        label: 'A9 Evidence Fixture',
        isOwner: true as const,
        sensitivityClearance: 'private' as const,
      },
    ],
    accessRevision: `a9-access-${suffix}`,
    policyContextRevision: `a9-policy-${suffix}`,
    executionAuthorities: {
      [projectId]: {
        projectId,
        accessRevision: `a9-access-${suffix}`,
        policyContextRevision: `a9-policy-${suffix}`,
        accessScope: ['owner'] as const,
        sensitivityClearance: 'private' as const,
      },
    },
  };
  return {
    suffix,
    projectId,
    principalId: principal.principalId,
    sourceId,
    sourceVersionId,
    scope,
    executionScope: {
      principalId: principal.principalId,
      projectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      sensitivityClearance: 'private',
      accessScope: ['owner'],
    },
    backend,
    configuration,
    approval,
    executionRepository,
    executionIdentityResolver: identityResolver,
    initialIdentityResolutionRunIds,
    execution,
    coordinator,
    projection,
    providerCalls,
    failNext: (providerId) => failures.add(providerId),
    legacy,
  };
};

describe('A9 final closure deterministic cross-boundary evidence', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('E2E-A: persists a fresh DeepSeek Product configuration and routes a new durable Ask through its exact pin', async () => {
    const fixture = await createFixture();
    const fresh = await fixture.backend.getSettings(fixture.projectId);
    expect(fresh.defaultProviderId).toBe('deepseek');
    expect(fresh.currentConfiguration).toBeUndefined();
    expect(fresh.credentialStatuses).toEqual([]);

    const { credential, configuration } = await configure(fixture, 'deepseek', 0);
    const run = await submit(fixture, 'Route a fresh DeepSeek configuration.');
    const pin = await fixture.executionRepository.readExecutionPin(
      fixture.executionScope,
      run.answerRunId,
    );

    expect(run.state).toBe('SUCCEEDED');
    expect(configuration.aiConfigurationRevision).toBe(1);
    expect(pin).toMatchObject({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      aiConfigurationRevision: 1,
      credentialId: credential.credentialId,
      credentialRevision: 1,
    });
    expect(fixture.providerCalls.at(-1)).toMatchObject({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('E2E-B: changes DeepSeek to OpenAI for a new Run without changing Run A durable identity', async () => {
    const fixture = await createFixture();
    await configure(fixture, 'deepseek', 0);
    const runA = await submit(fixture, 'Run A through DeepSeek.');
    const pinA = await fixture.executionRepository.readExecutionPin(
      fixture.executionScope,
      runA.answerRunId,
    );

    await configure(fixture, 'openai', 1);
    const runB = await submit(fixture, 'Run B through OpenAI without restart.');
    const pinB = await fixture.executionRepository.readExecutionPin(
      fixture.executionScope,
      runB.answerRunId,
    );

    expect(runA.state).toBe('SUCCEEDED');
    expect(runB.state).toBe('SUCCEEDED');
    expect(pinA?.providerId).toBe('deepseek');
    expect(pinB?.providerId).toBe('openai');
    expect(fixture.providerCalls.map((call) => call.providerId)).toEqual(['deepseek', 'openai']);
  });

  it('E2E-C: preserves OpenAI and Gemini pins while sequential managed saves route the next Ask to Gemini then DeepSeek', async () => {
    const fixture = await createFixture();
    await configure(fixture, 'openai', 0);
    const runA = await submit(fixture, 'Run A OpenAI.');
    await configure(fixture, 'google-gemini', 1);
    const runB = await submit(fixture, 'Run B Gemini.');
    await configure(fixture, 'deepseek', 2);
    const runC = await submit(fixture, 'Run C DeepSeek.');

    await expect(
      fixture.executionRepository.readExecutionPin(fixture.executionScope, runA.answerRunId),
    ).resolves.toMatchObject({ providerId: 'openai' });
    await expect(
      fixture.executionRepository.readExecutionPin(fixture.executionScope, runB.answerRunId),
    ).resolves.toMatchObject({ providerId: 'google-gemini' });
    await expect(
      fixture.executionRepository.readExecutionPin(fixture.executionScope, runC.answerRunId),
    ).resolves.toMatchObject({ providerId: 'deepseek' });
    expect(fixture.providerCalls.map((call) => call.providerId)).toEqual([
      'openai',
      'google-gemini',
      'deepseek',
    ]);
  });

  it('E2E-D: routes a new credential revision while an older failed Run retries with its original revision', async () => {
    const fixture = await createFixture();
    const first = await configure(fixture, 'deepseek', 0);
    fixture.failNext('deepseek');
    const runA = await submit(fixture, 'Run A pins credential revision one.');
    expect(runA.state).toBe('FAILED');

    const rotated = await fixture.backend.replaceCredential({
      projectId: fixture.projectId,
      providerId: 'deepseek',
      credentialId: first.credential.credentialId,
      expectedRevision: 1,
      secret: `a9-rotated-${fixture.suffix}`,
      clientRequestId: `a9-rotate-${fixture.suffix}`,
    });
    await fixture.backend.saveConfiguration({
      projectId: fixture.projectId,
      expectedRevision: 1,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-v4-flash',
      credentialId: rotated.credentialId,
      credentialRevision: rotated.credentialRevision,
      updatedBy: fixture.principalId,
    });
    const runB = await submit(fixture, 'Run B pins credential revision two.');
    const retry = await fixture.execution.retry(
      fixture.executionScope,
      runA.answerRunId,
      'SAME_CONTEXT',
    );
    await waitForTerminal(fixture, runA.answerRunId, ['SUCCEEDED', 'FAILED']);

    const retryAttempt = await fixture.executionRepository.readExactAttemptIdentity({
      scope: fixture.executionScope,
      answerRunId: runA.answerRunId,
      attemptId: retry.attemptId ?? '',
    });
    const retriedPin = await fixture.executionRepository.readExecutionPin(
      fixture.executionScope,
      runA.answerRunId,
    );
    expect(retriedPin).toMatchObject({
      credentialId: first.credential.credentialId,
      credentialRevision: 1,
      aiConfigurationRevision: 1,
    });
    expect(retriedPin).not.toMatchObject({ credentialRevision: 2, aiConfigurationRevision: 2 });
    expect(retryAttempt).toMatchObject({
      kind: 'RETRY_SAME_CONTEXT',
      credentialId: first.credential.credentialId,
      credentialRevision: 1,
      aiConfigurationRevision: 1,
    });
    await expect(
      fixture.executionRepository.readExecutionPin(fixture.executionScope, runB.answerRunId),
    ).resolves.toMatchObject({ credentialRevision: 2, aiConfigurationRevision: 2 });
  });

  it('E2E-E: revokes the exact pinned credential and fails RETRY_SAME_CONTEXT without substituting current configuration', async () => {
    const fixture = await createFixture();
    const first = await configure(fixture, 'deepseek', 0);
    fixture.failNext('deepseek');
    const runA = await submit(fixture, 'Run A must fail before exact revocation.');
    expect(runA.state).toBe('FAILED');

    await fixture.backend.revokeCredential({
      projectId: fixture.projectId,
      providerId: 'deepseek',
      credentialId: first.credential.credentialId,
      credentialRevision: 1,
    });
    const replacement = await fixture.backend.createCredential({
      projectId: fixture.projectId,
      providerId: 'deepseek',
      secret: `a9-current-${fixture.suffix}`,
      clientRequestId: `a9-current-create-${fixture.suffix}`,
    });
    await fixture.backend.saveConfiguration({
      projectId: fixture.projectId,
      expectedRevision: 1,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-v4-flash',
      credentialId: replacement.credentialId,
      credentialRevision: replacement.credentialRevision,
      updatedBy: fixture.principalId,
    });

    const callsBeforeRetry = fixture.providerCalls.length;
    await fixture.execution.retry(fixture.executionScope, runA.answerRunId, 'SAME_CONTEXT');
    const afterRetry = await waitForTerminal(fixture, runA.answerRunId, ['FAILED']);
    expect(afterRetry.failure?.code).toBe('AI_CAPABILITY_UNAVAILABLE');
    expect(fixture.providerCalls).toHaveLength(callsBeforeRetry);
    await expect(
      fixture.executionRepository.readExecutionPin(fixture.executionScope, runA.answerRunId),
    ).resolves.toMatchObject({
      credentialId: first.credential.credentialId,
      credentialRevision: 1,
    });
  });

  it('E2E-F: reevaluates persisted provider approval for RETRY_CURRENT_POLICY while retaining the original pin', async () => {
    const fixture = await createFixture({ sensitivity: 'private' });
    await configure(fixture, 'deepseek', 0);
    await approve(fixture, 'deepseek', true, 0);
    fixture.failNext('deepseek');
    const run = await submit(fixture, 'Private fixture run for current-policy retry.');
    expect(run.state).toBe('FAILED');
    const originalPin = await fixture.executionRepository.readExecutionPin(
      fixture.executionScope,
      run.answerRunId,
    );

    await approve(fixture, 'deepseek', false, 1);
    await fixture.execution.retry(fixture.executionScope, run.answerRunId, 'CURRENT_POLICY');
    const afterRetry = await waitForTerminal(fixture, run.answerRunId, ['FAILED']);
    expect(afterRetry.failure?.code).toBe('POLICY_DENIED');
    expect(
      await fixture.executionRepository.readExecutionPin(fixture.executionScope, run.answerRunId),
    ).toEqual(originalPin);
  });

  it('E2E-J: keeps a successful credential write durable when a second logical client saves stale configuration', async () => {
    const fixture = await createFixture();
    const clientA = await configure(fixture, 'deepseek', 0);
    const clientBCredential = await fixture.backend.createCredential({
      projectId: fixture.projectId,
      providerId: 'openai',
      secret: `a9-client-b-${fixture.suffix}`,
      clientRequestId: `a9-client-b-write-${fixture.suffix}`,
    });
    await expect(
      fixture.backend.saveConfiguration({
        projectId: fixture.projectId,
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: clientBCredential.credentialId,
        credentialRevision: 1,
        updatedBy: fixture.principalId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      fixture.backend.getCredentialWriteOutcome({
        projectId: fixture.projectId,
        clientRequestId: `a9-client-b-write-${fixture.suffix}`,
        binding: { operation: 'CREATE', providerId: 'openai' },
      }),
    ).resolves.toMatchObject({
      credentialId: clientBCredential.credentialId,
      credentialRevision: 1,
    });
    expect(await fixture.configuration.getCurrent(fixture.projectId)).toEqual(
      clientA.configuration,
    );

    await fixture.backend.saveConfiguration({
      projectId: fixture.projectId,
      expectedRevision: 1,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: clientBCredential.credentialId,
      credentialRevision: 1,
      updatedBy: fixture.principalId,
    });
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ai.provider_credentials
       WHERE credential_id = $1`,
      [clientBCredential.credentialId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('E2E-K: transitions persisted legacy Gemini compatibility to managed configuration and never resurrects legacy authority', async () => {
    const fixture = await createFixture({ legacyGemini: true });
    await approve(fixture, 'google-gemini', true, 0);
    const legacyContext = await fixture.executionRepository.getRunContext(
      fixture.executionScope,
      (
        await fixture.coordinator.submitQuestion({
          ...fixture.scope,
          request: {
            schemaVersion: ASK_SCHEMA_VERSION,
            clientRequestId: `a9-legacy-${fixture.suffix}`,
            idempotencyKey: `a9-legacy-idempotency-${fixture.suffix}`,
            question: 'Prepare a legacy Gemini execution.',
            mode: 'SOURCE_EXPLORATION',
            sourceSelections: [
              {
                sourceId: fixture.sourceId,
                sourceVersionId: fixture.sourceVersionId,
                evidenceIds: [],
              },
            ],
          },
        })
      ).answerRun.answerRunId,
    );
    const legacyPin = await new EffectiveAIConfigurationResolver(
      initialProviderRegistry(),
      fixture.configuration,
      new CredentialVaultService(
        new PostgresCredentialVaultRepository(pool),
        new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 7), keyVersion: 'a9-test' }),
      ),
      {
        legacyAuthority: {
          readLegacyExternalTransferAllowed: async () => true,
          readGeminiApproval: (projectId) =>
            fixture.approval.getCurrent(projectId, 'google-gemini'),
        },
        legacyCredential: () => 'legacy-gemini-test-secret',
        legacyModelId: 'gemini-3.6-flash',
      },
    ).resolveInitialAIExecutionIdentity({
      principalId: fixture.principalId,
      projectId: fixture.projectId,
      answerRunId: legacyContext!.snapshot.answerRunId,
      authorizedContext: legacyContext!,
    });
    expect(legacyPin.providerId).toBe('google-gemini');

    const managed = await configure(fixture, 'deepseek', 0);
    await fixture.backend.removeCredential({
      projectId: fixture.projectId,
      providerId: 'deepseek',
      credentialId: managed.credential.credentialId,
      credentialRevision: 1,
    });
    const current = await fixture.configuration.getCurrent(fixture.projectId);
    expect(current?.activeProviderId).toBe('deepseek');
    await expect(
      fixture.execution.execute(fixture.executionScope, legacyContext!.snapshot.answerRunId),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });

    // The failed pre-claim has intentionally not started a provider call. Mark the
    // test-owned queued run terminal so a later global worker scan cannot claim it.
    const cleanupClaim = await fixture.executionRepository.claimInitial(
      fixture.executionScope,
      legacyContext!.snapshot.answerRunId,
      'a9-legacy-cleanup-worker',
      legacyPin,
    );
    await fixture.executionRepository.fail({
      scope: fixture.executionScope,
      answerRunId: legacyContext!.snapshot.answerRunId,
      attemptNumber: cleanupClaim!.attempt.attemptNumber,
      state: 'FAILED',
      failure: {
        code: 'AI_CAPABILITY_UNAVAILABLE',
        message: 'Legacy compatibility fixture credential is unavailable.',
        retryable: false,
        outcomeUnknown: false,
      },
      workerId: 'a9-legacy-cleanup-worker',
    });
  });

  it('E2E-N: preserves durable A for queued worker reclaim and OUTCOME_UNKNOWN for interrupted running A after Settings B', async () => {
    const fixture = await createFixture();
    const first = await configure(fixture, 'deepseek', 0);

    // N1: a queued run already has durable A before current Project Settings change to B.
    const queued = await enqueue(fixture, 'Claim queued durable A through the Product worker.');
    const queuedContext = await fixture.executionRepository.getRunContext(
      fixture.executionScope,
      queued.answerRunId,
    );
    const queuedPinA = await fixture.executionIdentityResolver.resolveInitialAIExecutionIdentity({
      principalId: fixture.principalId,
      projectId: fixture.projectId,
      answerRunId: queued.answerRunId,
      authorizedContext: queuedContext!,
    });
    await fixture.executionRepository.createExecutionPinIfAbsent({
      scope: fixture.executionScope,
      answerRunId: queued.answerRunId,
      executionPin: queuedPinA,
    });

    // N2 is already RUNNING with durable A before Settings change to B.
    const interrupted = await enqueue(
      fixture,
      'Recover interrupted durable A without re-execution.',
    );
    const interruptedContext = await fixture.executionRepository.getRunContext(
      fixture.executionScope,
      interrupted.answerRunId,
    );
    const interruptedPinA =
      await fixture.executionIdentityResolver.resolveInitialAIExecutionIdentity({
        principalId: fixture.principalId,
        projectId: fixture.projectId,
        answerRunId: interrupted.answerRunId,
        authorizedContext: interruptedContext!,
      });
    const initial = await fixture.executionRepository.claimInitial(
      fixture.executionScope,
      interrupted.answerRunId,
      'a9-interrupted-worker',
      interruptedPinA,
    );
    expect(initial?.attempt.executionPin).toEqual(interruptedPinA);
    await pool.query(
      `UPDATE frontend_ask.answer_run_attempts
       SET lease_expires_at = now() - interval '1 second'
       WHERE answer_run_id = $1`,
      [interrupted.answerRunId],
    );

    fixture.initialIdentityResolutionRunIds.length = 0;
    const providerCallsBeforeWorker = fixture.providerCalls.length;
    const second = await configure(fixture, 'openai', 1);

    const stopWorker = await fixture.execution.startWorker(60_000);
    await stopWorker();
    const queuedResult = await waitForTerminal(fixture, queued.answerRunId, ['SUCCEEDED']);
    expect(queuedResult.state).toBe('SUCCEEDED');
    expect(fixture.initialIdentityResolutionRunIds).not.toContain(queued.answerRunId);
    expect(
      await fixture.executionRepository.readExecutionPin(
        fixture.executionScope,
        queued.answerRunId,
      ),
    ).toEqual(queuedPinA);
    expect(fixture.providerCalls.slice(providerCallsBeforeWorker)).toEqual([
      {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      },
    ]);
    expect(queuedPinA).toMatchObject({
      credentialId: first.credential.credentialId,
      credentialRevision: 1,
      aiConfigurationRevision: 1,
    });
    expect(queuedPinA).not.toMatchObject({
      credentialId: second.credential.credentialId,
      credentialRevision: second.credential.credentialRevision,
    });

    // N2: the worker recovery tick keeps the uncertain A attempt terminal and does not re-execute it.
    const recovered = await waitForTerminal(fixture, interrupted.answerRunId, ['OUTCOME_UNKNOWN']);
    expect(recovered).toMatchObject({
      state: 'OUTCOME_UNKNOWN',
      failure: { code: 'OUTCOME_UNKNOWN', outcomeUnknown: true },
    });
    expect(
      await fixture.executionRepository.readExecutionPin(
        fixture.executionScope,
        interrupted.answerRunId,
      ),
    ).toEqual(interruptedPinA);
    expect(fixture.initialIdentityResolutionRunIds).not.toContain(interrupted.answerRunId);
    expect(fixture.providerCalls).toHaveLength(providerCallsBeforeWorker + 1);
  });
});
