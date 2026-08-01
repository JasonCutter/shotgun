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

const answerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations'],
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 20000 },
    citations: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['evidenceId'],
        properties: {
          evidenceId: { type: 'string', minLength: 1, maxLength: 256 },
          exactQuote: { type: 'string', minLength: 1, maxLength: 20000 },
        },
      },
    },
  },
} as const;

type AnswerPayload = {
  readonly answer: string;
  readonly citations: readonly { readonly evidenceId: string; readonly exactQuote?: string }[];
};

const promptFor = (request: AskAnswerProviderRequest): string =>
  stableJson({
    task: 'shotgun-ask-answer-v1',
    question: request.question,
    evidence: request.evidence.map((evidence) => ({
      evidenceId: evidence.evidenceId,
      sourceId: evidence.sourceId,
      sourceVersionId: evidence.sourceVersionId,
      exactQuote: evidence.exactQuote,
    })),
  });

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
      if (typeof item.evidenceId !== 'string' || item.evidenceId.trim().length === 0) {
        throw new Error('citation evidenceId is invalid');
      }
      if (
        item.exactQuote !== undefined &&
        (typeof item.exactQuote !== 'string' || item.exactQuote.length === 0)
      ) {
        throw new Error('citation exactQuote is invalid');
      }
      return {
        evidenceId: item.evidenceId,
        ...(item.exactQuote === undefined ? {} : { exactQuote: item.exactQuote }),
      };
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

export class StructuredAskAnswerProviderAdapter implements AskAnswerProviderPort {
  readonly identity;

  constructor(private readonly adapter: AIProviderAdapterPort) {
    this.identity = {
      provider: adapter.identity.provider,
      model: adapter.identity.model,
      adapterVersion: adapter.identity.adapterVersion,
      dataPolicyVersion: adapter.identity.dataPolicyVersion,
    };
  }

  async execute(request: AskAnswerProviderRequest): Promise<AskAnswerProviderResult> {
    if (request.evidence.some((evidence) => evidence.sensitivity === 'restricted')) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Restricted Evidence cannot be sent to the configured Ask provider.',
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
    const generation: StructuredGenerationRequest = {
      systemInstruction: [
        'Answer only from the supplied Evidence quotes.',
        'Do not invent facts or citations.',
        'Return JSON with answer and citations.',
        'Each citation evidenceId must be copied from the supplied Evidence.',
      ].join(' '),
      prompt: promptFor(request),
      responseSchema: answerSchema,
    };
    const response = await this.adapter.generateStructured(generation);
    const parsed = parseAnswer(response.rawText);
    const chunkSize = Math.max(1, Math.ceil(parsed.answer.length / 4));
    for (let offset = chunkSize; offset <= parsed.answer.length; offset += chunkSize) {
      if (request.signal.aborted) {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The Ask provider request was cancelled.',
          module: 'ai-provider-ask',
          operation: 'stream-answer',
          retryable: true,
        });
      }
      await request.onPartial(parsed.answer.slice(0, offset));
    }
    return {
      answer: parsed.answer,
      citations: parsed.citations,
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
