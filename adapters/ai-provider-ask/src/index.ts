import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
} from '../../../modules/ai-provider/src/index.js';
import { ShotgunError, stableJson } from '../../../packages/contracts/src/index.js';
import type {
  AskAnswerProviderPort,
  AskAnswerProviderRequest,
  AskAnswerProviderResult,
} from '../../../modules/frontend-ask-execution/src/index.js';

export type AskAnswerProviderPolicy = {
  readonly allowPrivate: boolean;
  readonly allowRestricted: false;
  readonly dataPolicyVersion: string;
};

type ProviderCitationBinding = {
  readonly citationRef: string;
  readonly evidenceId: string;
};

const citationBindingsFor = (
  request: AskAnswerProviderRequest,
): readonly ProviderCitationBinding[] =>
  request.context
    .filter(
      (item): item is Extract<(typeof request.context)[number], { readonly kind: 'EVIDENCE' }> =>
        item.kind === 'EVIDENCE',
    )
    .map((item, index) => ({ citationRef: `E${index + 1}`, evidenceId: item.evidenceId }));

const answerSchemaFor = (citationBindings: readonly ProviderCitationBinding[]) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'citations'],
    properties: {
      answer: { type: 'string', minLength: 1, maxLength: 20000 },
      citations: {
        type: 'array',
        maxItems: citationBindings.length === 0 ? 0 : 500,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['citationRef'],
          properties: {
            citationRef:
              citationBindings.length === 0
                ? { type: 'string', minLength: 1, maxLength: 256 }
                : {
                    type: 'string',
                    enum: citationBindings.map((binding) => binding.citationRef),
                  },
          },
        },
      },
    },
  }) as const;

type AnswerPayload = {
  readonly answer: string;
  readonly citations: readonly { readonly citationRef: string }[];
};

const promptFor = (
  request: AskAnswerProviderRequest,
  citationBindings: readonly ProviderCitationBinding[],
): string => {
  let evidenceIndex = 0;
  return stableJson({
    task: 'shotgun-ask-answer-v1',
    question: request.question,
    context: request.context.map((item) =>
      item.kind === 'EVIDENCE'
        ? {
            kind: item.kind,
            citationRef: citationBindings[evidenceIndex++]!.citationRef,
            sourceId: item.sourceId,
            sourceVersionId: item.sourceVersionId,
            exactQuote: item.exactQuote,
          }
        : {
            kind: item.kind,
            sourceId: item.sourceId,
            sourceVersionId: item.sourceVersionId,
            contentHash: item.contentHash,
            mediaType: item.mediaType,
            text: item.text,
          },
    ),
  });
};

const parseAnswer = (rawText: string): AnswerPayload => {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('object required');
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.answer !== 'string' ||
      value.answer.trim().length === 0 ||
      value.answer.length > 20000
    ) {
      throw new Error('answer is invalid');
    }
    if (!Array.isArray(value.citations) || value.citations.length > 500) {
      throw new Error('citations are invalid');
    }
    const citations = value.citations.map((citation) => {
      if (!citation || typeof citation !== 'object' || Array.isArray(citation)) {
        throw new Error('citation is invalid');
      }
      const item = citation as Record<string, unknown>;
      if (typeof item.citationRef !== 'string' || item.citationRef.trim().length === 0) {
        throw new Error('citation reference is invalid');
      }
      return { citationRef: item.citationRef };
    });
    return { answer: value.answer, citations };
  } catch (error) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'The Ask provider returned an invalid structured answer.',
      module: 'ai-provider-ask',
      operation: 'parse-answer',
      retryable: false,
      cause: error,
    });
  }
};

const canonicalCitationsFor = (
  citations: AnswerPayload['citations'],
  citationBindings: readonly ProviderCitationBinding[],
): AskAnswerProviderResult['citations'] => {
  const evidenceIdByCitationRef = new Map(
    citationBindings.map((binding) => [binding.citationRef, binding.evidenceId]),
  );
  return citations.map((citation) => {
    const evidenceId = evidenceIdByCitationRef.get(citation.citationRef);
    if (!evidenceId) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage:
          'The Ask provider returned a citation reference that is not valid for the authorized Evidence context.',
        module: 'ai-provider-ask',
        operation: 'bind-citation-reference',
        retryable: false,
      });
    }
    return { evidenceId };
  });
};

export class StructuredAskAnswerProviderAdapter implements AskAnswerProviderPort {
  readonly identity;

  constructor(
    private readonly adapter: AIProviderAdapterPort,
    private readonly policy: AskAnswerProviderPolicy = {
      allowPrivate: false,
      allowRestricted: false,
      dataPolicyVersion: 'ask-provider-policy-v1',
    },
  ) {
    this.identity = {
      provider: adapter.identity.provider,
      model: adapter.identity.model,
      adapterVersion: adapter.identity.adapterVersion,
      dataPolicyVersion: policy.dataPolicyVersion,
    };
  }

  async execute(request: AskAnswerProviderRequest): Promise<AskAnswerProviderResult> {
    if (
      request.context.some(
        (item) =>
          item.sensitivity === 'restricted' ||
          (item.sensitivity === 'private' &&
            (!this.policy.allowPrivate || !request.effectiveProviderPolicy.eligible)),
      )
    ) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage:
          'The configured Ask provider is not permitted to receive the selected authoritative context under the current privacy policy.',
        module: 'ai-provider-ask',
        operation: 'enforce-data-policy',
      });
    }
    if (request.signal.aborted) {
      throw new ShotgunError({
        code: 'TIMEOUT',
        safeMessage: 'The Ask provider request was cancelled.',
        module: 'ai-provider-ask',
        operation: 'execute',
        retryable: true,
      });
    }
    const citationBindings = citationBindingsFor(request);
    const generation: StructuredGenerationRequest = {
      systemInstruction: [
        'Answer only from the supplied authoritative context items.',
        'Evidence items may be cited only with their supplied citationRef.',
        'SourceVersion items have no Evidence identity and must never produce a citation.',
        'Do not invent facts, Evidence, citation references, or citations.',
        'Return JSON with answer and citations.',
        'Each citation citationRef must be copied exactly from a supplied Evidence item.',
      ].join(' '),
      prompt: promptFor(request, citationBindings),
      responseSchema: answerSchemaFor(citationBindings),
    };
    let response;
    if (this.adapter.generateStructuredStream) {
      let streamedText = '';
      response = await this.adapter.generateStructuredStream(
        generation,
        async (text) => {
          streamedText += text;
          const partial = partialAnswerFromJson(streamedText);
          if (partial) await request.onPartial(partial);
        },
        request.signal,
      );
    } else if (this.adapter.generateStructuredWithSignal) {
      response = await this.adapter.generateStructuredWithSignal(generation, request.signal);
    } else {
      response = await this.adapter.generateStructured(generation);
    }
    const parsed = parseAnswer(response.rawText);
    return {
      answer: parsed.answer,
      citations: canonicalCitationsFor(parsed.citations, citationBindings),
      providerResponseId: response.providerResponseId,
      provider: {
        provider: this.identity.provider,
        model: this.identity.model,
        adapterVersion: this.identity.adapterVersion,
      },
      usage: {
        ...(response.inputTokens === undefined ? {} : { inputTokens: response.inputTokens }),
        ...(response.outputTokens === undefined ? {} : { outputTokens: response.outputTokens }),
        ...(response.totalTokens === undefined ? {} : { totalTokens: response.totalTokens }),
      },
    };
  }
}

const partialAnswerFromJson = (rawText: string): string | undefined => {
  const match = rawText.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)/s);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return undefined;
  }
};
