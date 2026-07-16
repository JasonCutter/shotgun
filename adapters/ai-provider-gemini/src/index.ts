import { GoogleGenAI } from '@google/genai';

import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from '../../../modules/ai-provider/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

type GeminiErrorShape = {
  readonly status?: number;
  readonly code?: number | string;
  readonly message?: string;
};

const mappedError = (error: unknown): ShotgunError => {
  const shape = error as GeminiErrorShape;
  const status = shape.status ?? (typeof shape.code === 'number' ? shape.code : undefined);
  const common = {
    module: 'gemini-ai-provider',
    operation: 'generate-structured',
    cause: error,
  } as const;
  if (status === 429) {
    return new ShotgunError({
      ...common,
      code: 'RATE_LIMITED',
      safeMessage: 'Gemini rate limit was reached.',
      retryable: true,
    });
  }
  if (status && status >= 500) {
    return new ShotgunError({
      ...common,
      code: 'RETRYABLE_DEPENDENCY',
      safeMessage: 'Gemini is temporarily unavailable.',
      retryable: true,
    });
  }
  if (status === 401 || status === 403) {
    return new ShotgunError({
      ...common,
      code: 'POLICY_DENIED',
      safeMessage: 'Gemini credentials or project policy rejected the request.',
    });
  }
  return new ShotgunError({
    ...common,
    code: 'TERMINAL_FAILURE',
    safeMessage: 'Gemini request failed.',
  });
};

export type GeminiAIProviderOptions = {
  readonly apiKey: string;
  readonly model?: string;
};

export class GeminiAIProviderAdapter implements AIProviderAdapterPort {
  readonly identity;
  private readonly client: GoogleGenAI;

  constructor(options: GeminiAIProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('Gemini API key is required.');
    }
    this.identity = {
      provider: 'google-gemini',
      adapterVersion: '1.0.0',
      model: options.model ?? 'gemini-3.5-flash',
      dataPolicyVersion: 'gemini-stateless-no-sharing-v1' as const,
    };
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generateStructured(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResponse> {
    try {
      const response = await this.client.interactions.create({
        model: this.identity.model,
        input: request.prompt,
        stream: false,
        store: false,
        system_instruction: request.systemInstruction,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: request.responseSchema,
        },
      });
      if (!response.output_text) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Gemini returned no structured text.',
          module: 'gemini-ai-provider',
          operation: 'read-structured-output',
          retryable: true,
        });
      }
      return {
        rawText: response.output_text,
        providerResponseId: response.id,
        modelVersion: this.identity.model,
        inputTokens: response.usage?.total_input_tokens,
        outputTokens: response.usage?.total_output_tokens,
        totalTokens: response.usage?.total_tokens,
      };
    } catch (error) {
      if (error instanceof ShotgunError) {
        throw error;
      }
      throw mappedError(error);
    }
  }
}
