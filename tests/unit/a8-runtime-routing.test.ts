import { describe, expect, it } from 'vitest';

import { AIProviderRouter } from '../../adapters/ai-provider-router/src/index.js';
import type { AIProviderConnectivityAdapter } from '../../modules/ai-settings-backend/src/index.js';
import {
  EffectiveAIConfigurationResolver,
  type LegacyGeminiRuntimeAuthority,
} from '../../adapters/ai-runtime-resolution/src/index.js';
import {
  StaticProviderRegistry,
  type ProjectAIConfiguration,
} from '../../modules/ai-configuration/src/index.js';
import type {
  CredentialMetadata,
  CredentialVaultPort,
} from '../../modules/credential-vault/src/index.js';
import {
  AskAnswerExecutionService,
  type AskAnswerProviderRequest,
  type AskExecutionRunContext,
  type AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import type { AskProviderPolicyResolverPort } from '../../packages/contracts/src/index.js';
import { ShotgunError, type AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';
import { InMemoryAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-in-memory/src/index.js';

const scope: AskExecutionScope = {
  principalId: 'principal-a8',
  projectId: 'project-a8',
  accessRevision: 'access-a8-1',
  policyContextRevision: 'policy-a8-1',
  sensitivityClearance: 'private',
};

const snapshot = (answerRunId: string): AskAnswerRunSnapshot => ({
  schemaVersion: '1.0.0',
  answerRunId,
  conversationId: `conversation-${answerRunId}`,
  branchId: `branch-${answerRunId}`,
  turnId: `turn-${answerRunId}`,
  projectId: scope.projectId,
  mode: 'SOURCE_EXPLORATION',
  state: 'QUEUED',
  question: 'Which provider is authoritative?',
  statements: [],
  sourceSelections: [
    { sourceId: 'source-a8', sourceVersionId: 'version-a8', evidenceIds: ['evidence-a8'] },
  ],
  capabilities: ['CANCEL'],
  answerRevision: 'answer-a8-1',
  conversationRevision: 'conversation-a8-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  stale: false,
});

const evidence = [
  {
    evidenceId: 'evidence-a8',
    sourceId: 'source-a8',
    sourceVersionId: 'version-a8',
    exactQuote: 'The configured provider is authoritative.',
    sensitivity: 'public' as const,
  },
];
const evidenceItem = evidence[0]!;

const policy = (calls: { readonly providerIds: string[] }): AskProviderPolicyResolverPort => ({
  evaluateSelections: async () => ({
    schemaVersion: '1.0.0',
    eligible: true,
    reason: 'ELIGIBLE',
    requiredAction: 'NONE',
    policyFingerprint: 'policy-selections',
    policyContextRevision: 'policy-context',
    provider: { displayName: 'Test provider', model: 'test-model' },
    message: 'eligible',
  }),
  evaluateContext: async (input) => {
    calls.providerIds.push(input.providerId ?? 'missing');
    return {
      schemaVersion: '1.0.0',
      eligible: true,
      reason: 'ELIGIBLE',
      requiredAction: 'NONE',
      policyFingerprint: `policy-${input.providerId ?? 'missing'}`,
      policyContextRevision: 'policy-context',
      provider: { displayName: 'Test provider', model: input.modelId ?? 'test-model' },
      message: 'eligible',
    };
  },
});

const configurations = (
  values: ProjectAIConfiguration[],
): {
  readonly getCurrent: (projectId: string) => Promise<ProjectAIConfiguration | undefined>;
} => ({
  getCurrent: async (projectId) => values.find((value) => value.projectId === projectId),
});

const metadata = (input: {
  readonly providerId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly lifecycleState?: CredentialMetadata['lifecycleState'];
}): CredentialMetadata => ({
  credentialId: input.credentialId,
  projectId: scope.projectId,
  providerId: input.providerId,
  encryptionVersion: 'aes-256-gcm:v1',
  keyVersion: 'test',
  credentialRevision: input.credentialRevision,
  lifecycleState: input.lifecycleState ?? 'active',
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
});

const vaultFor = (
  records: CredentialMetadata[],
  calls: { readonly providers: string[]; readonly scopes: string[] },
): CredentialVaultPort =>
  ({
    getMetadata: async (input) =>
      records.find(
        (record) =>
          record.projectId === input.projectId &&
          record.providerId === input.providerId &&
          record.credentialId === input.credentialId &&
          record.credentialRevision === input.credentialRevision,
      ),
    withCredential: async (input, callback) => {
      calls.scopes.push(
        `${input.projectId}:${input.providerId}:${input.credentialId}:${input.credentialRevision}`,
      );
      const record = records.find(
        (candidate) =>
          candidate.projectId === input.projectId &&
          candidate.providerId === input.providerId &&
          candidate.credentialId === input.credentialId &&
          candidate.credentialRevision === input.credentialRevision,
      );
      if (!record || record.lifecycleState !== 'active') {
        throw new ShotgunError({
          code: 'AI_CAPABILITY_UNAVAILABLE',
          safeMessage: 'Credential is unavailable.',
          module: 'a8-test-vault',
          operation: 'with-credential',
        });
      }
      calls.providers.push(input.providerId);
      return callback(Buffer.from(`${input.providerId}-secret`), record);
    },
    getAvailability: () => ({ state: 'AVAILABLE', keyVersion: 'test' }),
  }) as CredentialVaultPort;

const connectivity = (
  calls: { readonly providers: string[]; readonly secrets: string[] },
  failDeepSeekOnce = false,
): AIProviderConnectivityAdapter[] => {
  const adapters: AIProviderConnectivityAdapter[] = [];
  for (const providerId of ['deepseek', 'openai', 'google-gemini']) {
    let failed = false;
    adapters.push({
      providerId,
      testConnection: async () => ({}),
      generateStructured: async ({ apiKey, modelId }) => {
        calls.providers.push(`${providerId}:${modelId}`);
        calls.secrets.push(new TextDecoder().decode(apiKey));
        if (providerId === 'deepseek' && failDeepSeekOnce && !failed) {
          failed = true;
          throw new ShotgunError({
            code: 'RETRYABLE_DEPENDENCY',
            safeMessage: 'retryable provider failure',
            module: 'a8-test-provider',
            operation: 'generate',
          });
        }
        return { rawText: '{"answer":"routed","citations":[]}' };
      },
    });
  }
  return adapters;
};

const requestFor = (context: AskAnswerProviderRequest['context']): AskAnswerProviderRequest => ({
  answerRunId: 'run-a8-route',
  question: 'test',
  mode: 'SOURCE_EXPLORATION',
  context,
  resolvedContextDigest: 'digest',
  queryPlanRevision: 'query-plan',
  dataPolicyVersion: 'policy',
  effectiveProviderPolicy: { eligible: true, policyFingerprint: 'policy' },
  signal: new AbortController().signal,
  onPartial: async () => {},
});

describe('A8 effective runtime resolution and provider routing', () => {
  it('resolves the current managed configuration and preserves exact credential identity', async () => {
    const policyCalls = { providerIds: [] as string[] };
    const configuration = configurations([
      {
        projectId: scope.projectId,
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: 'credential-deepseek',
        credentialRevision: 2,
        aiConfigurationRevision: 4,
        updatedBy: 'owner',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ]);
    const vault = vaultFor(
      [
        metadata({
          providerId: 'deepseek',
          credentialId: 'credential-deepseek',
          credentialRevision: 2,
        }),
      ],
      { providers: [], scopes: [] },
    );
    const resolver = new EffectiveAIConfigurationResolver(
      new StaticProviderRegistry(),
      configuration as never,
      vault,
      { policy: policy(policyCalls), clock: () => '2026-08-12T00:00:00.000Z' },
    );
    const context = {
      snapshot: snapshot('run-a8-route'),
      evidence,
      context: [{ kind: 'EVIDENCE' as const, ...evidenceItem }],
      contextStatus: 'SUPPORTED' as const,
      resolvedContextDigest: 'digest',
      queryPlanRevision: 'query-plan',
    } satisfies AskExecutionRunContext;

    const pin = await resolver.resolveInitialAIExecutionIdentity({
      principalId: scope.principalId,
      projectId: scope.projectId,
      answerRunId: 'run-a8-route',
      authorizedContext: context,
    });

    expect(pin).toMatchObject({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      aiConfigurationRevision: 4,
      credentialId: 'credential-deepseek',
      credentialRevision: 2,
      initialProviderPolicyFingerprint: 'policy-deepseek',
    });
    expect(policyCalls.providerIds).toEqual(['deepseek']);
    expect(JSON.stringify(pin)).not.toContain('secret');
  });

  it('routes DeepSeek, OpenAI, and Gemini through the registry using bounded credential access', async () => {
    const routeCalls = { providers: [] as string[], secrets: [] as string[] };
    const vaultCalls = { providers: [] as string[], scopes: [] as string[] };
    const records = [
      metadata({
        providerId: 'deepseek',
        credentialId: 'credential-deepseek',
        credentialRevision: 2,
      }),
      metadata({ providerId: 'openai', credentialId: 'credential-openai', credentialRevision: 1 }),
      metadata({
        providerId: 'google-gemini',
        credentialId: 'credential-gemini',
        credentialRevision: 1,
      }),
    ];
    const adapters = connectivity(routeCalls);
    const router = new AIProviderRouter(
      new StaticProviderRegistry(),
      { get: (providerId: string) => adapters.find((item) => item.providerId === providerId) },
      vaultFor(records, vaultCalls),
    );
    const context = [
      {
        kind: 'EVIDENCE' as const,
        evidenceId: 'evidence-a8',
        sourceId: 'source-a8',
        sourceVersionId: 'version-a8',
        exactQuote: 'public',
        sensitivity: 'public' as const,
      },
    ];

    for (const [providerId, modelId, credentialId, revision] of [
      ['deepseek', 'deepseek-v4-flash', 'credential-deepseek', 2],
      ['openai', 'gpt-5.6-luna', 'credential-openai', 1],
      ['google-gemini', 'gemini-3.6-flash', 'credential-gemini', 1],
    ] as const) {
      const provider = await router.resolve({
        scope,
        executionPin: {
          answerRunId: 'run-a8-route',
          projectId: scope.projectId,
          providerId,
          modelId,
          aiConfigurationRevision: 1,
          credentialId,
          credentialRevision: revision,
          initialProviderPolicyFingerprint: 'policy',
          createdAt: '2026-08-12T00:00:00.000Z',
        },
      });
      const result = await provider.execute(requestFor(context));
      expect(result.provider).toMatchObject({ provider: providerId, model: modelId });
    }

    expect(vaultCalls.providers).toEqual(['deepseek', 'openai', 'google-gemini']);
    expect(vaultCalls.scopes).toHaveLength(3);
    expect(routeCalls.secrets).toEqual([
      'deepseek-secret',
      'openai-secret',
      'google-gemini-secret',
    ]);
  });

  it('changes the next new Ask route without changing an in-flight retry pin', async () => {
    const current: { value: ProjectAIConfiguration } = {
      value: {
        projectId: scope.projectId,
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: 'credential-deepseek',
        credentialRevision: 2,
        aiConfigurationRevision: 4,
        updatedBy: 'owner',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    };
    const routeCalls = { providers: [] as string[], secrets: [] as string[] };
    const records = [
      metadata({
        providerId: 'deepseek',
        credentialId: 'credential-deepseek',
        credentialRevision: 2,
      }),
      metadata({ providerId: 'openai', credentialId: 'credential-openai', credentialRevision: 1 }),
    ];
    const vault = vaultFor(records, { providers: [], scopes: [] });
    const policyCalls = { providerIds: [] as string[] };
    const resolver = new EffectiveAIConfigurationResolver(
      new StaticProviderRegistry(),
      { getCurrent: async () => current.value } as never,
      vault,
      { policy: policy(policyCalls), clock: () => '2026-08-12T00:00:00.000Z' },
    );
    const adapters = connectivity(routeCalls, true);
    const router = new AIProviderRouter(
      new StaticProviderRegistry(),
      { get: (providerId: string) => adapters.find((item) => item.providerId === providerId) },
      vault,
    );
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot('run-a8-route'), evidence);
    repository.register(snapshot('run-a8-next'), evidence);
    const service = new AskAnswerExecutionService(
      repository,
      {
        identity: {
          provider: 'fallback',
          model: 'fallback',
          adapterVersion: 'test',
          dataPolicyVersion: 'fallback',
        },
        execute: async () => {
          throw new Error('the A8 router must be used');
        },
      },
      {
        executionIdentityResolver: resolver,
        providerRouter: router,
        providerPolicy: policy(policyCalls),
      },
    );

    await service.execute(scope, 'run-a8-route');
    current.value = {
      ...current.value,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: 'credential-openai',
      credentialRevision: 1,
      aiConfigurationRevision: 5,
    };
    await service.retry(scope, 'run-a8-route', 'SAME_CONTEXT');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pin = await repository.readExecutionPin(scope, 'run-a8-route');
    expect(pin?.providerId).toBe('deepseek');
    expect(routeCalls.providers).toEqual([
      'deepseek:deepseek-v4-flash',
      'deepseek:deepseek-v4-flash',
    ]);

    const next = await service.execute(scope, 'run-a8-next');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(next.projectId).toBe(scope.projectId);
    expect(routeCalls.providers.at(-1)).toBe('openai:gpt-5.6-luna');
  });

  it('fails closed for an unconfigured Project and for an unavailable exact credential', async () => {
    const authority: LegacyGeminiRuntimeAuthority = {
      readLegacyExternalTransferAllowed: async () => false,
      readGeminiApproval: async () => undefined,
    };
    const unconfigured = new EffectiveAIConfigurationResolver(
      new StaticProviderRegistry(),
      { getCurrent: async () => undefined } as never,
      vaultFor([], { providers: [], scopes: [] }),
      { legacyAuthority: authority, legacyCredential: () => undefined },
    );
    const context = {
      snapshot: snapshot('run-a8-route'),
      evidence,
      context: [{ kind: 'EVIDENCE' as const, ...evidenceItem }],
      contextStatus: 'SUPPORTED' as const,
      resolvedContextDigest: 'digest',
      queryPlanRevision: 'query-plan',
    } satisfies AskExecutionRunContext;
    await expect(
      unconfigured.resolveInitialAIExecutionIdentity({
        principalId: scope.principalId,
        projectId: scope.projectId,
        answerRunId: 'run-a8-route',
        authorizedContext: context,
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });

    const revoked = new EffectiveAIConfigurationResolver(
      new StaticProviderRegistry(),
      configurations([
        {
          projectId: scope.projectId,
          activeProviderId: 'deepseek',
          activeModelId: 'deepseek-v4-flash',
          credentialId: 'credential-deepseek',
          credentialRevision: 2,
          aiConfigurationRevision: 4,
          updatedBy: 'owner',
          updatedAt: '2026-08-12T00:00:00.000Z',
        },
      ]) as never,
      vaultFor(
        [
          metadata({
            providerId: 'deepseek',
            credentialId: 'credential-deepseek',
            credentialRevision: 2,
            lifecycleState: 'revoked',
          }),
        ],
        { providers: [], scopes: [] },
      ),
    );
    await expect(
      revoked.revalidatePinnedCredential({
        principalId: scope.principalId,
        projectId: scope.projectId,
        answerRunId: 'run-a8-route',
        executionPin: {
          answerRunId: 'run-a8-route',
          projectId: scope.projectId,
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          aiConfigurationRevision: 4,
          credentialId: 'credential-deepseek',
          credentialRevision: 2,
          initialProviderPolicyFingerprint: 'policy',
          createdAt: '2026-08-12T00:00:00.000Z',
        },
      }),
    ).resolves.toBe(false);
  });

  it('denies restricted context before the routed provider callback', async () => {
    const calls = { providers: [] as string[], secrets: [] as string[] };
    const vaultCalls = { providers: [] as string[], scopes: [] as string[] };
    const adapters = connectivity(calls);
    const router = new AIProviderRouter(
      new StaticProviderRegistry(),
      { get: (providerId: string) => adapters.find((item) => item.providerId === providerId) },
      vaultFor(
        [
          metadata({
            providerId: 'deepseek',
            credentialId: 'credential-deepseek',
            credentialRevision: 2,
          }),
        ],
        vaultCalls,
      ),
    );
    const provider = await router.resolve({
      scope,
      executionPin: {
        answerRunId: 'run-a8-route',
        projectId: scope.projectId,
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        aiConfigurationRevision: 4,
        credentialId: 'credential-deepseek',
        credentialRevision: 2,
        initialProviderPolicyFingerprint: 'policy',
        createdAt: '2026-08-12T00:00:00.000Z',
      },
    });
    await expect(
      provider.execute(
        requestFor([
          {
            kind: 'EVIDENCE',
            evidenceId: 'restricted-evidence',
            sourceId: 'source-a8',
            sourceVersionId: 'version-a8',
            exactQuote: 'restricted',
            sensitivity: 'restricted',
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(vaultCalls.providers).toEqual([]);
    expect(calls.providers).toEqual([]);
  });
});
