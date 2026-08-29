import { GoogleGenAI } from '@google/genai';

import type { AIProviderConnectivityAdapter } from '../../../modules/ai-settings-backend/src/index.js';
import type { StructuredGenerationResponse } from '../../../modules/ai-provider/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

type GeminiErrorShape = { readonly status?: number; readonly code?: number | string };
type GeminiUsage = {
  readonly total_input_tokens?: unknown;
  readonly total_output_tokens?: unknown;
  readonly total_tokens?: unknown;
};
type GeminiResponse = {
  readonly id?: unknown;
  readonly output_text?: unknown;
  readonly usage?: GeminiUsage;
};

const mappedError = (error: unknown): ShotgunError => {
  const shape = error as GeminiErrorShape;
  const status = shape.status ?? (typeof shape.code === 'number' ? shape.code : undefined);
  if (status === 401 || status === 403) {
    return new ShotgunError({
      code: 'AUTHENTICATION_FAILED',
      safeMessage: 'Gemini credentials or model access was rejected.',
      module: 'gemini-ai-provider',
      operation: 'connectivity',
      cause: error,
    });
  }
  if (status === 429) {
    return new ShotgunError({
      code: 'RATE_LIMITED',
      safeMessage: 'Gemini rate limit was reached.',
      module: 'gemini-ai-provider',
      operation: 'connectivity',
      retryable: true,
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return new ShotgunError({
      code: 'RETRYABLE_DEPENDENCY',
      safeMessage: 'Gemini is temporarily unavailable.',
      module: 'gemini-ai-provider',
      operation: 'connectivity',
      retryable: true,
      cause: error,
    });
  }
  return new ShotgunError({
    code: 'TERMINAL_FAILURE',
    safeMessage: 'Gemini rejected the request.',
    module: 'gemini-ai-provider',
    operation: 'connectivity',
    cause: error,
  });
};

const parseObject = (rawText: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Structured output is not an object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Gemini returned invalid structured output.',
      module: 'gemini-ai-provider',
      operation: 'read-structured-output',
      retryable: true,
      cause: error,
    });
  }
};

export class GeminiConnectivityAdapter implements AIProviderConnectivityAdapter {
  readonly providerId = 'google-gemini';
  readonly supportsOutputTokenLimit = true;
  readonly supportsCancellation = true;

  constructor(
    private readonly clientFactory: (apiKey: string) => Pick<GoogleGenAI, 'interactions'> = (
      apiKey,
    ) => new GoogleGenAI({ apiKey }),
  ) {}

  async testConnection(input: Parameters<AIProviderConnectivityAdapter['testConnection']>[0]) {
    const response = await this.create(
      input.apiKey,
      {
        model: input.modelId,
        input: 'Shotgun connectivity probe. Return a JSON object with ready=true.',
        stream: false,
        store: false,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: { ready: { type: 'boolean' } },
            required: ['ready'],
            additionalProperties: false,
          },
        },
      },
      input.signal,
    );
    const rawText = this.outputText(response);
    if (parseObject(rawText).ready !== true) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Gemini returned an invalid connectivity result.',
        module: 'gemini-ai-provider',
        operation: 'test-connection',
        retryable: true,
      });
    }
    return { ...(typeof response.id === 'string' ? { providerRequestId: response.id } : {}) };
  }

  async generateStructured(
    input: Parameters<AIProviderConnectivityAdapter['generateStructured']>[0],
  ): Promise<StructuredGenerationResponse> {
    const response = await this.create(
      input.apiKey,
      {
        model: input.modelId,
        input: input.request.prompt,
        stream: false,
        store: false,
        system_instruction: input.request.systemInstruction,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: input.request.responseSchema,
        },
        ...(input.request.maxOutputTokens === undefined
          ? {}
          : { generation_config: { max_output_tokens: input.request.maxOutputTokens } }),
      },
      input.signal,
    );
    const rawText = this.outputText(response);
    parseObject(rawText);
    const usage = response.usage;
    const count = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    return {
      rawText,
      ...(typeof response.id === 'string' ? { providerResponseId: response.id } : {}),
      modelVersion: input.modelId,
      ...(count(usage?.total_input_tokens) === undefined
        ? {}
        : { inputTokens: count(usage?.total_input_tokens) }),
      ...(count(usage?.total_output_tokens) === undefined
        ? {}
        : { outputTokens: count(usage?.total_output_tokens) }),
      ...(count(usage?.total_tokens) === undefined
        ? {}
        : { totalTokens: count(usage?.total_tokens) }),
    };
  }

  private async create(
    apiKeyBytes: Uint8Array,
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GeminiResponse> {
    const apiKey = new TextDecoder().decode(apiKeyBytes);
    if (!apiKey.trim()) {
      throw new ShotgunError({
        code: 'AUTHENTICATION_FAILED',
        safeMessage: 'Gemini credential is empty.',
        module: 'gemini-ai-provider',
        operation: 'connectivity',
      });
    }
    try {
      const client = this.clientFactory(apiKey);
      type CreateRequest = Parameters<typeof client.interactions.create>[0];
      const result = signal
        ? await client.interactions.create(request as unknown as CreateRequest, { signal })
        : await client.interactions.create(request as unknown as CreateRequest);
      return result as unknown as GeminiResponse;
    } catch (error) {
      if (error instanceof ShotgunError) throw error;
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The Gemini request timed out.',
          module: 'gemini-ai-provider',
          operation: 'connectivity',
          retryable: true,
          cause: error,
        });
      }
      throw mappedError(error);
    }
  }

  private outputText(response: GeminiResponse): string {
    if (typeof response.output_text !== 'string' || !response.output_text.trim()) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Gemini returned no structured text.',
        module: 'gemini-ai-provider',
        operation: 'read-structured-output',
        retryable: true,
      });
    }
    return response.output_text;
  }
}
