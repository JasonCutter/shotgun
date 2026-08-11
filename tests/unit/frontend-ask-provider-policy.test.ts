import { describe, expect, it, vi } from 'vitest';

import {
  StructuredAskAnswerProviderAdapter,
  type AskAnswerProviderPolicy,
} from '../../adapters/ai-provider-ask/src/index.js';
import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';
import { decodeAskProviderEligibilityRequest } from '../../packages/contracts/src/index.js';
import {
  providerPolicyRetryCapabilities,
  type AskAnswerProviderRequest,
} from '../../modules/frontend-ask-execution/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryAskConversationRepository } from '../../adapters/frontend-ask-write-in-memory/src/index.js';
import { InMemoryAskWorkspaceProjection } from '../../adapters/frontend-product-read-in-memory/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import {
  AskProviderPolicyResolver,
  type AskProviderPolicyAuthorityReaderPort,
} from '../../modules/frontend-ask-provider-policy/src/index.js';

const request = (sensitivity: 'public' | 'private' | 'restricted'): AskAnswerProviderRequest => ({
  answerRunId: 'run-policy-1',
  question: 'What does the source say?',
  mode: 'SOURCE_EXPLORATION',
  context: [
    {
      kind: 'EVIDENCE',
      evidenceId: 'evidence-1',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      exactQuote: 'The source quote.',
      sensitivity,
    },
  ],
  resolvedContextDigest: 'sha256:context',
  queryPlanRevision: 'ask-query-plan-v2',
  dataPolicyVersion: 'ask-policy-v1',
  effectiveProviderPolicy: {
    eligible: true,
    policyFingerprint: 'ask-provider-effective-policy-v2:test',
  },
  signal: new AbortController().signal,
  onPartial: async () => {},
});

const adapterWith = (overrides: Partial<AIProviderAdapterPort> = {}): AIProviderAdapterPort => ({
  identity: {
    provider: 'test-provider',
    model: 'test-model',
    adapterVersion: '1.0.0',
    dataPolicyVersion: 'fake-local-v1',
  },
  generateStructured: vi.fn(async () => ({
    rawText: '{"answer":"Answer","citations":[]}',
  })),
  ...overrides,
});

describe('Ask provider policy and stream boundary', () => {
  it('rejects browser-crafted provider eligibility authority fields', () => {
    expect(() =>
      decodeAskProviderEligibilityRequest({
        schemaVersion: '1.0.0',
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [],
        eligible: true,
        policyFingerprint: 'browser-crafted',
        sensitivity: 'public',
      }),
    ).toThrow();
  });

  const resolver = (
    deploymentPrivateTransferAllowed: boolean,
    projectExternalTransferAllowed: boolean,
    sensitivity: 'public' | 'private' | 'restricted',
  ) => {
    const reader: AskProviderPolicyAuthorityReaderPort = {
      readProjectPrivacyPolicy: async () => ({
        externalTransferAllowed: projectExternalTransferAllowed,
        settingsRevision: projectExternalTransferAllowed ? 3 : 2,
        policyContextRevision: projectExternalTransferAllowed ? 7 : 6,
      }),
      readSelectedSensitivities: async () => [sensitivity],
    };
    return new AskProviderPolicyResolver(reader, {
      deploymentPrivateTransferAllowed,
      providerPolicyIdentity: 'gemini-ask-policy-v2',
      providerDisplayName: 'Gemini',
      providerModel: 'test-model',
    });
  };

  it.each([
    [false, false, 'DEPLOYMENT_POLICY_BLOCKED'],
    [false, true, 'DEPLOYMENT_POLICY_BLOCKED'],
    [true, false, 'PROJECT_APPROVAL_REQUIRED'],
    [true, true, 'ELIGIBLE'],
  ] as const)(
    'combines deployment=%s and project approval=%s for private context',
    async (deploymentAllowed, projectAllowed, expectedReason) => {
      const eligibility = await resolver(
        deploymentAllowed,
        projectAllowed,
        'private',
      ).evaluateSelections({
        projectId: 'project-1',
        sourceSelections: [{ sourceId: 'source-1', sourceVersionId: 'version-1', evidenceIds: [] }],
      });
      expect(eligibility.reason).toBe(expectedReason);
      expect(eligibility.eligible).toBe(expectedReason === 'ELIGIBLE');
      expect(eligibility.policyFingerprint).toMatch(/^ask-provider-effective-policy-v2:/);
    },
  );

  it.each([false, true])(
    'hard-denies restricted context when deployment private ceiling=%s',
    async (deploymentAllowed) => {
      const eligibility = await resolver(deploymentAllowed, true, 'restricted').evaluateContext({
        projectId: 'project-1',
        sensitivities: ['restricted'],
      });
      expect(eligibility).toMatchObject({
        eligible: false,
        reason: 'RESTRICTED_CONTEXT_BLOCKED',
      });
    },
  );

  it('binds the fingerprint to deployment ceiling, Project approval revision, and provider policy', async () => {
    const denied = await resolver(false, false, 'private').evaluateContext({
      projectId: 'project-1',
      sensitivities: ['private'],
    });
    const deploymentOpened = await resolver(true, false, 'private').evaluateContext({
      projectId: 'project-1',
      sensitivities: ['private'],
    });
    const approved = await resolver(true, true, 'private').evaluateContext({
      projectId: 'project-1',
      sensitivities: ['private'],
    });
    expect(
      new Set([
        denied.policyFingerprint,
        deploymentOpened.policyFingerprint,
        approved.policyFingerprint,
      ]).size,
    ).toBe(3);
  });

  it('blocks private and restricted Evidence before any provider call', async () => {
    const generateStructured = vi.fn();
    const generateStructuredStream = vi.fn();
    const adapter = new StructuredAskAnswerProviderAdapter(
      adapterWith({ generateStructured, generateStructuredStream }),
      {
        allowPrivate: false,
        allowRestricted: false,
        dataPolicyVersion: 'ask-policy-v1',
      } satisfies AskAnswerProviderPolicy,
    );

    await expect(adapter.execute(request('private'))).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(adapter.execute(request('restricted'))).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(
      adapter.execute({
        ...request('public'),
        context: [
          {
            kind: 'SOURCE_VERSION',
            sourceId: 'source-1',
            sourceVersionId: 'version-1',
            contentHash: `sha256:${'1'.repeat(64)}`,
            mediaType: 'text/plain',
            text: 'Private SourceVersion content.',
            sensitivity: 'private',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(generateStructured).not.toHaveBeenCalled();
    expect(generateStructuredStream).not.toHaveBeenCalled();
  });

  it('uses the live stream and forwards AbortSignal while retaining structured output', async () => {
    const partials: string[] = [];
    let observedSignal: AbortSignal | undefined;
    const adapter = new StructuredAskAnswerProviderAdapter(
      adapterWith({
        generateStructuredStream: vi.fn(async (_request, onText, signal) => {
          observedSignal = signal;
          await onText('{"answer":"Stream');
          await onText('ed answer","citations":[]}');
          return {
            rawText: '{"answer":"Streamed answer","citations":[]}',
            providerResponseId: 'provider-response-1',
            inputTokens: 3,
            outputTokens: 4,
            totalTokens: 7,
          };
        }),
      }),
    );

    const result = await adapter.execute({
      ...request('public'),
      onPartial: async (partial) => {
        partials.push(partial);
      },
    });

    expect(result.answer).toBe('Streamed answer');
    expect(result.providerResponseId).toBe('provider-response-1');
    expect(result.usage?.totalTokens).toBe(7);
    expect(partials).toEqual(['Stream', 'Streamed answer']);
    expect(observedSignal).toBeDefined();
  });

  it('retains the final provider guard when Project policy is not eligible', async () => {
    const generateStructured = vi.fn();
    const adapter = new StructuredAskAnswerProviderAdapter(adapterWith({ generateStructured }), {
      allowPrivate: true,
      allowRestricted: false,
      dataPolicyVersion: 'ask-policy-v2',
    });
    await expect(
      adapter.execute({
        ...request('private'),
        effectiveProviderPolicy: {
          eligible: false,
          policyFingerprint: 'ask-provider-effective-policy-v2:denied',
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('allows an approved SourceVersion-only context without inventing Evidence citations', async () => {
    const generateStructured = vi.fn(async () => ({
      rawText: '{"answer":"SourceVersion answer","citations":[]}',
    }));
    const adapter = new StructuredAskAnswerProviderAdapter(adapterWith({ generateStructured }), {
      allowPrivate: true,
      allowRestricted: false,
      dataPolicyVersion: 'ask-policy-v2',
    });
    const result = await adapter.execute({
      ...request('public'),
      context: [
        {
          kind: 'SOURCE_VERSION',
          sourceId: 'source-1',
          sourceVersionId: 'version-1',
          contentHash: `sha256:${'1'.repeat(64)}`,
          mediaType: 'text/plain',
          text: 'Approved private SourceVersion content.',
          sensitivity: 'private',
        },
      ],
      effectiveProviderPolicy: {
        eligible: true,
        policyFingerprint: 'ask-provider-effective-policy-v2:approved',
      },
    });
    expect(result).toMatchObject({ answer: 'SourceVersion answer', citations: [] });
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it('revalidates current provider policy at the command boundary after a successful preflight', async () => {
    let eligible = true;
    const policy = {
      evaluateSelections: vi.fn(async () => ({
        schemaVersion: '1.0.0' as const,
        eligible,
        reason: eligible ? ('ELIGIBLE' as const) : ('PROJECT_APPROVAL_REQUIRED' as const),
        requiredAction: eligible ? ('NONE' as const) : ('REVIEW_PROJECT_PRIVACY_SETTINGS' as const),
        policyFingerprint: eligible ? 'policy:approved' : 'policy:revoked',
        policyContextRevision: eligible ? '7' : '8',
        provider: { displayName: 'Gemini', model: 'test-model' },
        message: eligible ? 'Eligible.' : 'Project approval is required.',
      })),
      evaluateContext: vi.fn(),
    };
    const gateway = new InMemoryFrontendCommandGateway();
    const repository = new InMemoryAskConversationRepository();
    const projection = new InMemoryAskWorkspaceProjection();
    const coordinator = new AskCommandCoordinator(
      gateway,
      repository,
      projection,
      { validate: async () => {} },
      undefined,
      policy,
    );
    const scope = {
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: {
        id: 'project-1',
        label: 'Project One',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
      accessibleProjects: [
        {
          id: 'project-1',
          label: 'Project One',
          isOwner: true,
          sensitivityClearance: 'private' as const,
        },
      ],
      accessRevision: 'access-1',
      policyContextRevision: '7',
      executionAuthorities: {
        'project-1': {
          projectId: 'project-1',
          accessRevision: 'access-1',
          policyContextRevision: '7',
          accessScope: ['owner'],
          sensitivityClearance: 'private' as const,
        },
      },
    };
    await expect(
      coordinator.getProviderEligibility({
        ...scope,
        request: { schemaVersion: '1.0.0', mode: 'CANONICAL_ONLY', sourceSelections: [] },
      }),
    ).resolves.toMatchObject({ eligible: true, policyFingerprint: 'policy:approved' });

    eligible = false;
    await expect(
      coordinator.submitQuestion({
        ...scope,
        request: {
          schemaVersion: '1.0.0',
          clientRequestId: 'request-policy-stale',
          idempotencyKey: 'idem-policy-stale',
          question: 'Can stale preflight bypass current policy?',
          mode: 'CANONICAL_ONLY',
          sourceSelections: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(policy.evaluateSelections).toHaveBeenCalledTimes(2);
  });

  it('exposes only a meaningful current-policy retry after eligibility changes', () => {
    const denied = {
      failure: {
        code: 'POLICY_DENIED',
        message: 'Denied.',
        retryable: false,
        outcomeUnknown: false,
      },
      capabilities: ['RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY'],
    } as unknown as Parameters<typeof providerPolicyRetryCapabilities>[0];
    expect(providerPolicyRetryCapabilities(denied, false)).toEqual([]);
    expect(providerPolicyRetryCapabilities(denied, true)).toEqual(['RETRY_CURRENT_POLICY']);
  });
});
