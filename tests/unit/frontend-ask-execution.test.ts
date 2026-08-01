import { describe, expect, it } from 'vitest';

import { InMemoryAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-in-memory/src/index.js';
import {
  AskAnswerExecutionService,
  type AskAnswerProviderPort,
  type AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';
import type { AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';

const scope: AskExecutionScope = {
  principalId: 'principal-1',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'internal',
};

const snapshot = (): AskAnswerRunSnapshot => ({
  schemaVersion: '1.0.0',
  answerRunId: 'run-1',
  conversationId: 'conversation-1',
  branchId: 'branch-1',
  turnId: 'turn-1',
  projectId: 'project-1',
  mode: 'SOURCE_EXPLORATION',
  state: 'QUEUED',
  question: 'What does the source say?',
  statements: [],
  sourceSelections: [
    { sourceId: 'source-1', sourceVersionId: 'version-1', evidenceIds: ['evidence-1'] },
  ],
  capabilities: ['CANCEL'],
  answerRevision: 'answer-1',
  conversationRevision: 'conversation-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  stale: false,
});

const provider = (execute: AskAnswerProviderPort['execute']): AskAnswerProviderPort => ({
  identity: {
    provider: 'test-provider',
    model: 'test-model',
    adapterVersion: '1.0.0',
    dataPolicyVersion: 'test-policy-v1',
  },
  execute,
});

describe('AskAnswerExecutionService', () => {
  it('persists partial events and validates citations before success', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), [
      {
        evidenceId: 'evidence-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        exactQuote: 'The source quote.',
        sensitivity: 'internal',
      },
    ]);
    const service = new AskAnswerExecutionService(
      repository,
      provider(async (request) => {
        await request.onPartial('The source');
        return {
          answer: 'The source quote.',
          citations: [{ evidenceId: 'evidence-1', exactQuote: 'The source quote.' }],
          provider: {
            provider: 'test-provider',
            model: 'test-model',
            adapterVersion: '1.0.0',
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      }),
    );

    const result = await service.execute(scope, 'run-1');
    const events = await service.events(scope, 'run-1');

    expect(result.state).toBe('SUCCEEDED');
    expect(result.statements[0]?.citations[0]?.evidenceId).toBe('evidence-1');
    expect(result.provider?.model).toBe('test-model');
    expect(result.usage?.totalTokens).toBe(15);
    expect(events.map((event) => event.kind)).toEqual([
      'STATE',
      'STATE',
      'STATE',
      'PARTIAL',
      'COMPLETED',
    ]);
  });

  it('fails closed for a citation outside the selected Evidence', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), [
      {
        evidenceId: 'evidence-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        exactQuote: 'The source quote.',
        sensitivity: 'internal',
      },
    ]);
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => ({
        answer: 'Unsupported answer',
        citations: [{ evidenceId: 'not-selected' }],
        provider: { provider: 'test-provider', model: 'test-model' },
      })),
    );

    const result = await service.execute(scope, 'run-1');

    expect(result.state).toBe('FAILED');
    expect(result.failure?.code).toBe('VALIDATION_ERROR');
    expect(result.capabilities).toContain('RETRY_SAME_CONTEXT');
  });

  it('does not invoke the provider when authoritative context has no supported answer', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot());
    let calls = 0;
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => {
        calls += 1;
        return {
          answer: 'This provider call must not happen.',
          citations: [],
          provider: { provider: 'test-provider', model: 'test-model' },
        };
      }),
    );

    const result = await service.execute(scope, 'run-1');

    expect(result.state).toBe('SUCCEEDED');
    expect(result.statements[0]?.text).toContain('No supported answer');
    expect(result.provider?.provider).toBe('shotgun-context-resolver');
    expect(calls).toBe(0);
  });

  it('keeps outcome unknown explicit and requires a user retry', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot(), [
      {
        evidenceId: 'evidence-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        exactQuote: 'The source quote.',
        sensitivity: 'internal',
      },
    ]);
    let calls = 0;
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => {
        calls += 1;
        if (calls === 1) {
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'Provider outcome is unknown.',
            module: 'test',
            operation: 'execute',
          });
        }
        return {
          answer: 'Recovered answer',
          citations: [],
          provider: { provider: 'test-provider', model: 'test-model' },
        };
      }),
    );

    const unknown = await service.execute(scope, 'run-1');
    expect(unknown.state).toBe('OUTCOME_UNKNOWN');
    expect(calls).toBe(1);

    const retried = await service.retry(scope, 'run-1', 'SAME_CONTEXT');
    expect(retried.state).toBe('RUNNING');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completed = await repository.getRunContext(scope, 'run-1');
    expect(completed?.snapshot.state).toBe('SUCCEEDED');
    expect(calls).toBe(2);
  });

  it('creates export, feedback, and proposed transition seeds without Canonical writes', async () => {
    const repository = new InMemoryAskAnswerExecutionRepository();
    repository.register(snapshot());
    const service = new AskAnswerExecutionService(
      repository,
      provider(async () => ({
        answer: 'An answer',
        citations: [],
        provider: { provider: 'test-provider', model: 'test-model' },
      })),
    );
    await service.execute(scope, 'run-1');

    const exported = await service.export(scope, 'run-1', 'JSON', 'export-request-1');
    const feedback = await service.feedback(
      scope,
      'run-1',
      'HELPFUL',
      undefined,
      'feedback-request-1',
    );
    const seed = await service.transitionSeed(scope, 'run-1', 'DRAFT_CHANGE_SET', 'seed-request-1');

    expect(exported.answerRunId).toBe('run-1');
    expect(feedback.kind).toBe('HELPFUL');
    expect(seed.state).toBe('PROPOSED');
    expect(seed.kind).toBe('DRAFT_CHANGE_SET');
  });
});
