import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInteraction } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    readonly interactions = { create: createInteraction };
  },
}));

import { GeminiAIProviderAdapter } from '../../adapters/ai-provider-gemini/src/index.js';

const request = {
  systemInstruction: 'Return JSON.',
  prompt: 'Answer the question.',
  responseSchema: { type: 'object' },
};

const streamFrom = async function* (events: readonly unknown[]) {
  yield* events;
};

describe('GeminiAIProviderAdapter streaming completion contract', () => {
  beforeEach(() => {
    createInteraction.mockReset();
  });

  it('requires interaction.completed before returning streamed structured output', async () => {
    createInteraction.mockResolvedValue(
      streamFrom([
        { event_type: 'step.delta', delta: { type: 'text', text: '{"answer":"ok"}' } },
        {
          event_type: 'interaction.completed',
          interaction: {
            id: 'interaction-1',
            status: 'completed',
            usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
          },
        },
      ]),
    );
    const adapter = new GeminiAIProviderAdapter({ apiKey: 'test-key' });
    const partials: string[] = [];

    const result = await adapter.generateStructuredStream(
      request,
      async (text) => {
        partials.push(text);
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      rawText: '{"answer":"ok"}',
      providerResponseId: 'interaction-1',
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });
    expect(partials).toEqual(['{"answer":"ok"}']);
  });

  it('returns OUTCOME_UNKNOWN when the stream ends without interaction.completed', async () => {
    createInteraction.mockResolvedValue(
      streamFrom([{ event_type: 'step.delta', delta: { type: 'text', text: '{"answer":"ok"}' } }]),
    );
    const adapter = new GeminiAIProviderAdapter({ apiKey: 'test-key' });

    await expect(
      adapter.generateStructuredStream(request, async () => {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });
});
