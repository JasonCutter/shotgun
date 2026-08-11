import { describe, expect, it, vi } from 'vitest';

import {
  StructuredAskAnswerProviderAdapter,
  type AskAnswerProviderPolicy,
} from '../../adapters/ai-provider-ask/src/index.js';
import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';
import type { AskAnswerProviderRequest } from '../../modules/frontend-ask-execution/src/index.js';

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
});
