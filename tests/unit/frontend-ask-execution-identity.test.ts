import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-in-memory/src/index.js';
import {
  AskAnswerExecutionService,
  type AIExecutionPin,
  type AskAnswerProviderPort,
  type AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import { ShotgunError, type AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';

const scope: AskExecutionScope = {
  principalId: 'principal-a5',
  projectId: 'project-a5',
  accessRevision: 'access-a5-1',
  policyContextRevision: 'policy-a5-1',
  sensitivityClearance: 'private',
};

const snapshot = (): AskAnswerRunSnapshot => ({
  schemaVersion: '1.0.0',
  answerRunId: 'run-a5',
  conversationId: 'conversation-a5',
  branchId: 'branch-a5',
  turnId: 'turn-a5',
  projectId: scope.projectId,
  mode: 'SOURCE_EXPLORATION',
  state: 'QUEUED',
  question: 'What is pinned?',
  statements: [],
  sourceSelections: [
    { sourceId: 'source-a5', sourceVersionId: 'version-a5', evidenceIds: ['evidence-a5'] },
  ],
  capabilities: ['CANCEL'],
  answerRevision: 'answer-a5-1',
  conversationRevision: 'conversation-a5-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  stale: false,
});

const evidence = [
  {
    evidenceId: 'evidence-a5',
    sourceId: 'source-a5',
    sourceVersionId: 'version-a5',
    exactQuote: 'The pinned context is immutable.',
    sensitivity: 'private' as const,
  },
];

const pin = (overrides: Partial<AIExecutionPin> = {}): AIExecutionPin => ({
  answerRunId: 'run-a5',
  projectId: scope.projectId,
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  aiConfigurationRevision: 4,
  credentialId: 'credential-a5',
  credentialRevision: 2,
  initialProviderPolicyFingerprint: 'policy-initial',
  createdAt: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

const provider = (execute: AskAnswerProviderPort['execute']): AskAnswerProviderPort => ({
  identity: {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    adapterVersion: 'contract-test',
    dataPolicyVersion: 'provider-default-policy',
  },
  execute,
});

const resolver = (available: () => boolean = () => true) => ({
  resolveInitialAIExecutionIdentity: async () => pin(),
  revalidatePinnedCredential: async (input: { executionPin: AIExecutionPin }) => {
    expect(input.executionPin.credentialRevision).toBe(2);
    return available();
  },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('A5 AnswerRun execution identity', () => {
  it('pins once and preserves the exact identity through RETRY_SAME_CONTEXT', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), evidence);
    const requests: { pin?: AIExecutionPin; policy: string }[] = [];
    let calls = 0;
    const service = new AskAnswerExecutionService(
      repository,
      provider(async (request) => {
        requests.push({ pin: request.executionPin, policy: request.dataPolicyVersion });
        calls += 1;
        if (calls === 1) {
          throw new ShotgunError({
            code: 'RETRYABLE_DEPENDENCY',
            safeMessage: 'The first provider attempt is retryable.',
            module: 'a5-test',
            operation: 'provider',
          });
        }
        return {
          answer: 'Pinned answer',
          citations: [{ evidenceId: 'evidence-a5' }],
          provider: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        };
      }),
      { executionIdentityResolver: resolver() },
    );

    await service.execute(scope, 'run-a5');
    const firstPin = await repository.readExecutionPin(scope, 'run-a5');
    expect(firstPin).toEqual(pin());

    await service.retry(scope, 'run-a5', 'SAME_CONTEXT');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await repository.getRunContext(scope, 'run-a5'))?.snapshot.state).toBe('SUCCEEDED');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.pin).toEqual(pin());
    expect(requests[1]?.pin).toEqual(pin());
    expect(requests[1]?.policy).toBe('policy-initial');
    expect(await repository.readExecutionPin(scope, 'run-a5')).toEqual(firstPin);

    const attempt = await repository.readExactAttemptIdentity({
      scope,
      answerRunId: 'run-a5',
      attemptId: (await repository.getRunContext(scope, 'run-a5'))?.snapshot.attemptId ?? '',
    });
    expect(attempt?.kind).toBe('RETRY_SAME_CONTEXT');
    expect(attempt?.credentialRevision).toBe(2);
    expect(attempt?.resolvedContextDigest).toBeTruthy();
  });

  it('reevaluates only policy for RETRY_CURRENT_POLICY and keeps identity unchanged', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), evidence);
    let policyCalls = 0;
    let providerCalls = 0;
    const policy = {
      evaluateSelections: async () => ({
        schemaVersion: '1.0.0' as const,
        eligible: true,
        reason: 'ELIGIBLE' as const,
        requiredAction: 'NONE' as const,
        policyFingerprint: `policy-${++policyCalls}`,
        policyContextRevision: `policy-context-${policyCalls}`,
        provider: { displayName: 'DeepSeek', model: 'deepseek-v4-flash' },
        message: 'eligible',
      }),
      evaluateContext: async () => ({
        schemaVersion: '1.0.0' as const,
        eligible: true,
        reason: 'ELIGIBLE' as const,
        requiredAction: 'NONE' as const,
        policyFingerprint: `policy-${++policyCalls}`,
        policyContextRevision: `policy-context-${policyCalls}`,
        provider: { displayName: 'DeepSeek', model: 'deepseek-v4-flash' },
        message: 'eligible',
      }),
    };
    const service = new AskAnswerExecutionService(
      repository,
      provider(async (request) => {
        providerCalls += 1;
        if (providerCalls === 1) {
          throw new ShotgunError({
            code: 'RETRYABLE_DEPENDENCY',
            safeMessage: 'Retry the current policy.',
            module: 'a5-test',
            operation: 'provider',
          });
        }
        expect(request.executionPin).toEqual(pin());
        expect(request.dataPolicyVersion).toBe('policy-2');
        return {
          answer: 'Current policy answer',
          citations: [{ evidenceId: 'evidence-a5' }],
          provider: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        };
      }),
      { executionIdentityResolver: resolver(), providerPolicy: policy },
    );

    await service.execute(scope, 'run-a5');
    await service.retry(scope, 'run-a5', 'CURRENT_POLICY');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await repository.getRunContext(scope, 'run-a5'))?.snapshot.state).toBe('SUCCEEDED');
    expect(await repository.readExecutionPin(scope, 'run-a5')).toEqual(pin());
    expect(policyCalls).toBe(2);
  });

  it('fails closed for a revoked pinned credential without latest substitution', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), evidence);
    let providerCalls = 0;
    let credentialChecks = 0;
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => {
        providerCalls += 1;
        throw new ShotgunError({
          code: 'RETRYABLE_DEPENDENCY',
          safeMessage: 'The original attempt is retryable.',
          module: 'a5-test',
          operation: 'provider',
        });
      }),
      { executionIdentityResolver: resolver(() => credentialChecks++ === 0) },
    );

    await service.execute(scope, 'run-a5');
    await service.retry(scope, 'run-a5', 'SAME_CONTEXT');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = await repository.getRunContext(scope, 'run-a5');
    expect(result?.snapshot.state).toBe('FAILED');
    expect(result?.snapshot.failure?.code).toBe('AI_CAPABILITY_UNAVAILABLE');
    expect(providerCalls).toBe(1);
    expect(await repository.readExecutionPin(scope, 'run-a5')).toEqual(pin());
  });

  it('claims a queued durable pin through the real worker path without resolving current Settings again', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), evidence);
    const durablePin = pin();
    const currentSettingsPin = pin({
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      aiConfigurationRevision: 5,
      credentialId: 'credential-b',
      credentialRevision: 1,
    });
    await repository.createExecutionPinIfAbsent({
      scope,
      answerRunId: 'run-a5',
      executionPin: durablePin,
    });
    let initialResolverCalls = 0;
    const providerRequests: AIExecutionPin[] = [];
    const routerPins: AIExecutionPin[] = [];
    const routedProvider = provider(async (request) => {
      if (request.executionPin) providerRequests.push(request.executionPin);
      return {
        answer: 'Recovered durable identity answer',
        citations: [{ evidenceId: 'evidence-a5' }],
        provider: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      };
    });
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => {
        throw new Error('Durable pinned worker claim must use the provider router.');
      }),
      {
        executionIdentityResolver: {
          resolveInitialAIExecutionIdentity: async () => {
            initialResolverCalls += 1;
            return currentSettingsPin;
          },
          revalidatePinnedCredential: async () => true,
        },
        providerRouter: {
          resolve: async ({ executionPin }) => {
            routerPins.push(executionPin);
            return routedProvider;
          },
        },
      },
    );

    const stop = await service.startWorker(60_000);
    await stop();

    expect(initialResolverCalls).toBe(0);
    expect((await repository.getRunContext(scope, 'run-a5'))?.snapshot.state).toBe('SUCCEEDED');
    expect(routerPins).toEqual([durablePin]);
    expect(providerRequests).toEqual([durablePin]);
    expect(await repository.readExecutionPin(scope, 'run-a5')).toEqual(durablePin);
  });

  it('resolves current Settings exactly once for a queued run without a durable pin', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), evidence);
    let initialResolverCalls = 0;
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => ({
        answer: 'Initial identity answer',
        citations: [{ evidenceId: 'evidence-a5' }],
        provider: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      })),
      {
        executionIdentityResolver: {
          resolveInitialAIExecutionIdentity: async () => {
            initialResolverCalls += 1;
            return pin();
          },
          revalidatePinnedCredential: async () => true,
        },
      },
    );

    const stop = await service.startWorker(60_000);
    await stop();

    expect(initialResolverCalls).toBe(1);
    expect(await repository.readExecutionPin(scope, 'run-a5')).toEqual(pin());
  });

  it('preserves a durable pin and OUTCOME_UNKNOWN without automatic re-execution after an interrupted running attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), evidence);
    const durablePin = pin();
    const first = await repository.claimInitial(scope, 'run-a5', 'interrupted-worker', durablePin);
    expect(first?.attempt.executionPin).toEqual(durablePin);

    vi.advanceTimersByTime(30_001);
    expect(await repository.recoverInterrupted()).toBe(1);

    const recovered = await repository.getRunContext(scope, 'run-a5');
    expect(recovered?.snapshot).toMatchObject({
      state: 'OUTCOME_UNKNOWN',
      failure: { code: 'OUTCOME_UNKNOWN', outcomeUnknown: true },
    });
    expect(recovered?.executionPin).toEqual(durablePin);
    expect(await repository.readExecutionPin(scope, 'run-a5')).toEqual(durablePin);
    expect(await repository.claimQueuedForWorker('recovery-worker', 1)).toEqual([]);
  });

  it.each([
    ['another Project', pin({ projectId: 'project-other' })],
    ['another AnswerRun', pin({ answerRunId: 'run-other' })],
  ])(
    'fails closed for a durable pin bound to %s without resolving current Settings',
    async (_label, malformedPin) => {
      const repository = new InMemoryAskAnswerExecutionRepository();
      repository.register(snapshot(), evidence);
      const unsafeRepository = Object.create(repository) as InMemoryAskAnswerExecutionRepository;
      unsafeRepository.getRunContext = async (requestedScope, answerRunId) => {
        const context = await repository.getRunContext(requestedScope, answerRunId);
        return context ? { ...context, executionPin: malformedPin } : undefined;
      };
      let initialResolverCalls = 0;
      const service = new AskAnswerExecutionService(
        unsafeRepository,
        provider(async () => {
          throw new Error('Provider must not be invoked for malformed durable pin.');
        }),
        {
          executionIdentityResolver: {
            resolveInitialAIExecutionIdentity: async () => {
              initialResolverCalls += 1;
              return pin({
                providerId: 'openai',
                modelId: 'gpt-5.6-luna',
                credentialId: 'credential-b',
              });
            },
            revalidatePinnedCredential: async () => true,
          },
        },
      );

      await expect(service.execute(scope, 'run-a5')).rejects.toMatchObject({
        code: 'PROJECT_ACCESS_DENIED',
      });
      expect(initialResolverCalls).toBe(0);
    },
  );
});
