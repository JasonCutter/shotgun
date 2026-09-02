import { describe, expect, it } from 'vitest';

import { StructuredAskAnswerProviderAdapter } from '../../adapters/ai-provider-ask/src/index.js';
import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
import type { AskAnswerProviderRequest } from '../../modules/frontend-ask-execution/src/index.js';

const request = (context: AskAnswerProviderRequest['context']): AskAnswerProviderRequest => ({
  answerRunId: 'run-citation-binding',
  question: 'What does the selected material say?',
  mode: 'SOURCE_EXPLORATION',
  context,
  resolvedContextDigest: 'sha256:context',
  queryPlanRevision: 'ask-query-plan-v3',
  dataPolicyVersion: 'ask-policy-v1',
  effectiveProviderPolicy: {
    eligible: true,
    policyFingerprint: 'ask-provider-effective-policy-v2:test',
  },
  signal: new AbortController().signal,
  onPartial: async () => {},
});

const evidence = (evidenceId: string, exactQuote: string) => ({
  kind: 'EVIDENCE' as const,
  evidenceId,
  sourceId: 'source-1',
  sourceVersionId: 'version-1',
  exactQuote,
  sensitivity: 'public' as const,
});

const sourceVersion = () => ({
  kind: 'SOURCE_VERSION' as const,
  sourceId: 'source-1',
  sourceVersionId: 'version-1',
  contentHash: `sha256:${'1'.repeat(64)}`,
  mediaType: 'text/plain' as const,
  text: 'The source-only context says the answer is 42.',
  sensitivity: 'public' as const,
});

const provider = (
  generateStructured: AIProviderAdapterPort['generateStructured'],
): AIProviderAdapterPort => ({
  identity: {
    provider: 'test-provider',
    model: 'test-model',
    adapterVersion: '1.0.0',
    dataPolicyVersion: 'test-policy-v1',
  },
  generateStructured,
});

describe('StructuredAskAnswerProviderAdapter citation reference binding', () => {
  it('maps the single issued E1 reference back to the canonical Evidence ID', async () => {
    let generation: StructuredGenerationRequest | undefined;
    const adapter = new StructuredAskAnswerProviderAdapter(
      provider(async (value) => {
        generation = value;
        return {
          rawText: JSON.stringify({
            answer: 'The selected evidence says 42.',
            citations: [{ citationRef: 'E1' }],
          }),
        };
      }),
    );

    const result = await adapter.execute(
      request([evidence('550e8400-e29b-41d4-a716-446655440000', 'Verification number A is 17.')]),
    );

    expect(result.citations).toEqual([
      {
        evidenceId: '550e8400-e29b-41d4-a716-446655440000',
      },
    ]);
    expect(JSON.parse(generation!.prompt).context).toEqual([
      expect.objectContaining({ kind: 'EVIDENCE', citationRef: 'E1' }),
    ]);
    expect(JSON.parse(generation!.prompt).context[0]).not.toHaveProperty('evidenceId');
    expect(generation!.responseSchema).toMatchObject({
      properties: {
        citations: {
          items: { properties: { citationRef: { enum: ['E1'] } } },
        },
      },
    });
    expect(generation!.responseSchema).not.toMatchObject({
      properties: {
        citations: { items: { properties: { exactQuote: expect.anything() } } },
      },
    });
  });

  it('maps E2 to the second canonical Evidence ID in resolved context order', async () => {
    const adapter = new StructuredAskAnswerProviderAdapter(
      provider(async () => ({
        rawText: JSON.stringify({
          answer: 'The second evidence is controlling.',
          citations: [{ citationRef: 'E2' }],
        }),
      })),
    );

    const result = await adapter.execute(
      request([
        evidence('550e8400-e29b-41d4-a716-446655440000', 'First quote.'),
        evidence('660e8400-e29b-41d4-a716-446655440000', 'Second quote.'),
      ]),
    );

    expect(result.citations).toEqual([{ evidenceId: '660e8400-e29b-41d4-a716-446655440000' }]);
  });

  it('fails closed when the provider returns an unissued citation reference', async () => {
    const adapter = new StructuredAskAnswerProviderAdapter(
      provider(async () => ({
        rawText: JSON.stringify({
          answer: 'Unsupported citation.',
          citations: [{ citationRef: 'E3' }],
        }),
      })),
    );

    await expect(
      adapter.execute(request([evidence('evidence-a', 'Quote A.')])),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('accepts an empty citation list for SourceVersion-only context', async () => {
    let generation: StructuredGenerationRequest | undefined;
    const adapter = new StructuredAskAnswerProviderAdapter(
      provider(async (value) => {
        generation = value;
        return {
          rawText: JSON.stringify({
            answer: 'The source-only context says the answer is 42.',
            citations: [],
          }),
        };
      }),
    );

    const result = await adapter.execute(request([sourceVersion()]));

    expect(result.citations).toEqual([]);
    expect(generation!.responseSchema).toMatchObject({
      properties: { citations: { maxItems: 0 } },
    });
  });

  it('fails closed when SourceVersion-only context attempts any citation reference', async () => {
    let generation: StructuredGenerationRequest | undefined;
    const adapter = new StructuredAskAnswerProviderAdapter(
      provider(async (value) => {
        generation = value;
        return {
          rawText: JSON.stringify({
            answer: 'Unsupported source-only citation.',
            citations: [{ citationRef: 'E1' }],
          }),
        };
      }),
    );

    await expect(adapter.execute(request([sourceVersion()]))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(generation!.responseSchema).toMatchObject({
      properties: { citations: { maxItems: 0 } },
    });
  });
});
