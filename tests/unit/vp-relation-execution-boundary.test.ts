import { describe, expect, it, vi } from 'vitest';

import type {
  AIProviderExecutionResolverPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
import type { CredentialVaultPort } from '../../modules/credential-vault/src/index.js';
import { CredentialBackedAIProviderAdapter } from '../../adapters/ai-provider-router/src/index.js';
import type {
  VPDecisionExecutionClaim,
  VPDecisionExecutionRepositoryPort,
} from '../../modules/vp-decision/src/index.js';
import {
  GlobalRelationBudgetPausedError,
  type GlobalRelationBudgetPort,
} from '../../adapters/vp-global-provider-budget-postgres/src/index.js';
import {
  ExecutionBoundVPRelationDispatcher,
  executionBoundRelationLedger,
  executionBoundRelationResolver,
  type ExecutionBoundRelationLedger,
} from '../../adapters/vp-global-provider-budget-postgres/src/execution-boundary.js';

const claim = {
  claimId: '00000000-0000-4000-8000-000000000003',
  authorityId: '00000000-0000-4000-8000-000000000004',
  budgetDay: '2026-10-06',
  claimedCount: 1,
};
const input = {
  projectId: 'project',
  jobId: '00000000-0000-4000-8000-000000000001',
  leaseToken: '00000000-0000-4000-8000-000000000002',
  executionKey: `sha256:${'a'.repeat(64)}`,
  requestDigest: `sha256:${'b'.repeat(64)}`,
  providerIdentity: 'deepseek/flash',
};
const request = { systemInstruction: 'v6', prompt: '{}', responseSchema: {} };
const resolution = {
  projectId: 'project',
  requestId: 'relation-v6',
  sourceVersionId: 'source',
  dataClassification: 'source-content',
  accessScope: ['owner'],
  sensitivity: 'public' as const,
};

function setup(
  options: {
    credentialFailure?: boolean;
    authorityFailure?: GlobalRelationBudgetPausedError;
    activationFailure?: boolean;
    existing?: VPDecisionExecutionClaim;
  } = {},
) {
  const provider = vi.fn(async (_request: StructuredGenerationRequest) => ({
    rawText: '{}',
    providerResponseId: 'provider-call-1',
  }));
  const resolve = vi.fn(async () => ({
    adapter: {
      identity: {
        provider: 'deepseek',
        model: 'flash',
        adapterVersion: 'test',
        dataPolicyVersion: 'test',
      },
      generateStructured: provider,
    },
    executionIdentity: {
      providerId: 'deepseek',
      modelId: 'flash',
      aiConfigurationRevision: 1,
      credentialId: 'fake-credential',
      credentialRevision: 1,
      policyContextRevision: 'fake-policy',
      providerPolicyFingerprint: 'fake-policy-fingerprint',
    },
  }));
  const base: AIProviderExecutionResolverPort = { resolve };
  const reserveAttempt = vi.fn(async () => {
    if (options.authorityFailure) throw options.authorityFailure;
    return claim;
  });
  const authority: GlobalRelationBudgetPort = {
    claim: vi.fn(async () => claim),
    reserveAttempt,
    authorizeExecution: vi.fn(async () => {}),
    reservedForJob: vi.fn(async () => undefined),
    bindAttempt: vi.fn(async () => {}),
    releaseUnused: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
    status: vi.fn(async () => ({
      storeId: 'store',
      authorityId: claim.authorityId,
      budgetDay: claim.budgetDay,
      claimedCount: 0,
      dailyLimit: 100,
    })),
  };
  const activate = vi.fn(async (): Promise<VPDecisionExecutionClaim> => {
    if (options.activationFailure) throw new Error('local bind failure');
    return { status: 'STARTED', callId: '00000000-0000-4000-8000-000000000005' };
  });
  const ledger: ExecutionBoundRelationLedger = {
    claim: activate,
    readExecution: vi.fn(async () => options.existing),
    hasActivatedAttempt: vi.fn(async () => false),
    storeOutput: vi.fn(async () => ({}) as never),
    markOutcomeUnknown: vi.fn(async () => {}),
  };
  const verifyCredential = vi.fn(async () => {
    if (options.credentialFailure) throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
  });
  const wrapped = executionBoundRelationResolver(base, ledger, authority, {
    requiredProvider: 'deepseek',
    verifyCredential,
  });
  const executions: VPDecisionExecutionRepositoryPort = executionBoundRelationLedger(ledger);
  const worker = {
    dispatchOnce: async () => {
      try {
        const resolved = await wrapped.resolve(resolution);
        const prepared = await executions.claim(input);
        if (prepared.status !== 'STARTED') return 'OUTCOME_UNKNOWN' as const;
        await resolved.adapter.generateStructured(request);
        return 'DECIDED' as const;
      } catch {
        return 'RETRYING' as const;
      }
    },
  };
  return {
    dispatcher: new ExecutionBoundVPRelationDispatcher(worker, authority, 'shotgun-app'),
    provider,
    resolve,
    verifyCredential,
    authority,
    reserveAttempt,
    activate,
    ledger,
  };
}

describe('execution-bound relation provider budget', () => {
  it('uses captured credential bytes once without a second vault read', async () => {
    let vaultReads = 0;
    let egressKey: Uint8Array | undefined;
    const sourceSecret = Buffer.from('captured-key');
    const vault = {
      withCredential: async (
        _scope: unknown,
        callback: (secret: Uint8Array, metadata: unknown) => Promise<unknown>,
      ) => {
        vaultReads += 1;
        const result = await callback(sourceSecret, {
          projectId: 'project',
          providerId: 'deepseek',
          credentialId: 'credential',
          credentialRevision: 1,
          lifecycleState: 'active',
        });
        sourceSecret.fill(0);
        return result;
      },
    } as unknown as CredentialVaultPort;
    const adapter = new CredentialBackedAIProviderAdapter(
      {
        providerId: 'deepseek',
        testConnection: async () => ({}),
        generateStructured: async ({ apiKey, modelId }) => {
          egressKey = apiKey;
          expect(modelId).toBe('deepseek-flash');
          expect(Buffer.from(apiKey).toString('utf8')).toBe('captured-key');
          return { rawText: '{}' };
        },
      },
      vault,
      {
        projectId: 'project',
        providerId: 'deepseek',
        credentialId: 'credential',
        credentialRevision: 1,
      },
      'deepseek-flash',
      undefined,
    );
    const captured = await adapter.captureSingleUse(() => {});
    Reflect.set(adapter.identity, 'model', 'changed-after-capture');
    expect(vaultReads).toBe(1);
    await captured.generateStructured(request);
    expect(vaultReads).toBe(1);
    expect([...egressKey!]).toEqual(Array.from({ length: 'captured-key'.length }, () => 0));
    await expect(captured.generateStructured(request)).rejects.toThrow();
  });
  it('does not consume a local attempt or global claim on credential mismatch', async () => {
    const s = setup({ credentialFailure: true });
    expect(await s.dispatcher.dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
    expect(s.resolve).toHaveBeenCalledOnce();
    expect(s.reserveAttempt).not.toHaveBeenCalled();
    expect(s.activate).not.toHaveBeenCalled();
    expect(s.provider).not.toHaveBeenCalled();
  });

  it.each(['EXHAUSTED', 'AUTHORITY_UNAVAILABLE', 'IDENTITY_UNVERIFIED'] as const)(
    'preserves the local attempt and provider call when global authorization is %s',
    async (reason) => {
      const s = setup({ authorityFailure: new GlobalRelationBudgetPausedError(reason) });
      expect(await s.dispatcher.dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
      expect(s.activate).not.toHaveBeenCalled();
      expect(s.provider).not.toHaveBeenCalled();
    },
  );

  it('releases a bound reservation when local activation fails before egress', async () => {
    const s = setup({ activationFailure: true });
    expect(await s.dispatcher.dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
    expect(s.authority.releaseUnused).toHaveBeenCalledWith(claim);
    expect(s.provider).not.toHaveBeenCalled();
  });

  it('uses one captured execution context, claim, local activation, and provider call', async () => {
    const s = setup();
    expect(await s.dispatcher.dispatchOnce()).toBe('DECIDED');
    expect(s.resolve).toHaveBeenCalledOnce();
    expect(s.verifyCredential).toHaveBeenCalledOnce();
    expect(s.reserveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        relationJobId: input.jobId,
        semanticAttemptId: input.leaseToken,
        executionKey: input.executionKey,
        providerIdentity: input.providerIdentity,
      }),
    );
    expect(s.activate).toHaveBeenCalledWith({
      ...input,
      globalClaimId: claim.claimId,
      semanticAttemptId: input.leaseToken,
    });
    expect(s.provider).toHaveBeenCalledOnce();
    expect(s.authority.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        claim,
        state: 'PROVIDER_SUCCEEDED',
        providerRequestId: 'provider-call-1',
      }),
    );
  });

  it('finalizes stored output without another claim or provider call', async () => {
    const s = setup({ existing: { status: 'OUTPUT_STORED', decision: {} as never } });
    expect(await s.dispatcher.dispatchOnce()).toBe('OUTCOME_UNKNOWN');
    expect(s.reserveAttempt).not.toHaveBeenCalled();
    expect(s.activate).not.toHaveBeenCalled();
    expect(s.provider).not.toHaveBeenCalled();
  });

  it('pins the request bytes while global authorization is pending', async () => {
    const s = setup();
    const original = request.prompt;
    const reserve = s.reserveAttempt.getMockImplementation()!;
    s.reserveAttempt.mockImplementation(async () => {
      request.prompt = 'changed after authorization began';
      return reserve();
    });
    try {
      expect(await s.dispatcher.dispatchOnce()).toBe('DECIDED');
      expect(s.provider.mock.calls[0]?.[0].prompt).toBe(original);
      expect(Object.isFrozen(s.provider.mock.calls[0]?.[0])).toBe(true);
    } finally {
      request.prompt = original;
    }
  });

  it('refuses an inconsistent captured provider/model identity before reservation', async () => {
    const s = setup();
    const resolve = s.resolve.getMockImplementation()!;
    s.resolve.mockImplementation(async () => {
      const result = await resolve();
      return {
        ...result,
        executionIdentity: { ...result.executionIdentity, modelId: 'different-model' },
      };
    });
    expect(await s.dispatcher.dispatchOnce()).toBe('RELATION_BUDGET_PAUSED');
    expect(s.verifyCredential).not.toHaveBeenCalled();
    expect(s.reserveAttempt).not.toHaveBeenCalled();
    expect(s.provider).not.toHaveBeenCalled();
  });
});
