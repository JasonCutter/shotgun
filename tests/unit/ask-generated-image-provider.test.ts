import { describe, expect, it, vi } from 'vitest';
import { StructuredAskAnswerProviderAdapter } from '../../adapters/ai-provider-ask/src/index.js';
import { askGeneratedImageObservationReferenceFor } from '../../packages/contracts/src/index.js';
import type { AskAnswerProviderRequest } from '../../modules/frontend-ask-execution/src/index.js';
import type { StructuredGenerationRequest } from '../../modules/ai-provider/src/index.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

const observation = { ...imageObservationFixture(), sensitivity: 'public' as const };
const context = [
  {
    ...askGeneratedImageObservationReferenceFor(observation, 'O-context'),
    sensitivity: 'public' as const,
  },
];
const request = (): AskAnswerProviderRequest => ({
  answerRunId: 'image-answer-run',
  question: 'Describe this image',
  mode: 'AUTO_PROJECT_KNOWLEDGE',
  context,
  resolvedContextDigest: 'sha256:context',
  queryPlanRevision: 'ask-query-plan-vp-image1',
  dataPolicyVersion: 'test-only',
  effectiveProviderPolicy: { eligible: true, policyFingerprint: 'fake-only' },
  signal: new AbortController().signal,
  onPartial: async () => {},
});
const execute = (payload: unknown) => {
  const generate = vi.fn(async (_request: StructuredGenerationRequest) => ({
    rawText: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }));
  const provider = new StructuredAskAnswerProviderAdapter({
    identity: {
      provider: 'fake',
      model: 'fake',
      adapterVersion: 'fake',
      dataPolicyVersion: 'test-only',
    },
    generateStructured: generate,
  });
  return { generate, result: provider.execute(request()) };
};
describe('Ask generated image reference boundary', () => {
  it('separates generated observation references from original Evidence and hides credential identity', async () => {
    const { result, generate } = execute({
      answer: 'Unverified interpretation: a blue region.',
      citations: [],
      generatedObservationReferences: [{ observationRef: 'O1' }],
      answerDisposition: 'SUPPORTED',
    });
    expect(await result).toMatchObject({
      citations: [],
      answerSupportStatus: 'SUPPORTED',
      generatedObservationReferences: [{ observationId: observation.observationId }],
    });
    const generation = generate.mock.calls[0]![0] as unknown as {
      prompt: string;
      systemInstruction: string;
      responseSchema: unknown;
    };
    const prompt = JSON.parse(generation.prompt);
    expect(prompt.context[0]).toMatchObject({
      kind: 'GENERATED_IMAGE_OBSERVATION',
      semanticStatus: 'UNVERIFIED',
      observationRef: 'O1',
    });
    expect(prompt.context[0]).not.toHaveProperty('exactQuote');
    expect(generation.prompt).not.toContain(observation.derivation.executionIdentity.credentialId);
    expect(generation.systemInstruction).toContain('untrusted data');
  });
  it('records abstention separately even when image context exists', async () => {
    const { result } = execute({
      answer: 'The available interpretation cannot answer.',
      citations: [],
      generatedObservationReferences: [],
      answerDisposition: 'ABSTAINED',
    });
    expect(await result).toMatchObject({
      answerSupportStatus: 'NO_SUPPORTED_ANSWER',
      generatedObservationReferences: [],
    });
  });
  it.each([
    {
      answer: 'Unsupported',
      citations: [],
      generatedObservationReferences: [],
      answerDisposition: 'SUPPORTED',
    },
    {
      answer: 'False abstention',
      citations: [],
      generatedObservationReferences: [{ observationRef: 'O1' }],
      answerDisposition: 'ABSTAINED',
    },
    {
      answer: 'Invented observation',
      citations: [],
      generatedObservationReferences: [{ observationRef: 'O2' }],
      answerDisposition: 'SUPPORTED',
    },
    {
      answer: 'Fabricated Evidence',
      citations: [{ citationRef: 'O1' }],
      generatedObservationReferences: [],
      answerDisposition: 'SUPPORTED',
    },
    '{broken',
  ])('rejects invalid output without an automatic second provider call', async (payload) => {
    const { result, generate } = execute(payload);
    await expect(result).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
