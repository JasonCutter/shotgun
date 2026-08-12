import { describe, expect, it } from 'vitest';

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
});
