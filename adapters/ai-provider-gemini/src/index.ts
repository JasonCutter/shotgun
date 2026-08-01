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

  async generateStructuredStream(
    request: StructuredGenerationRequest,
    onText: (text: string) => Promise<void>,
    signal: AbortSignal,
  ): Promise<StructuredGenerationResponse> {
    try {
      const stream = await this.client.interactions.create(
        {
          model: this.identity.model,
          input: request.prompt,
          stream: true,
          store: false,
          system_instruction: request.systemInstruction,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: request.responseSchema,
          },
        },
        { signal },
      );
      let rawText = '';
      let providerResponseId: string | undefined;
      let completed = false;
      let usage:
        | {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly totalTokens?: number;
          }
        | undefined;
      for await (const event of stream) {
        const value = event as unknown as Record<string, unknown>;
        const interaction = value.interaction as Record<string, unknown> | undefined;
        if (interaction && typeof interaction.id === 'string') providerResponseId = interaction.id;
        if (value.event_type === 'interaction.completed') {
          completed = true;
          const completedStatus =
            typeof interaction?.status === 'string'
              ? interaction.status
              : typeof value.status === 'string'
                ? value.status
                : undefined;
          if (
            completedStatus === 'failed' ||
            completedStatus === 'cancelled' ||
            completedStatus === 'incomplete'
          ) {
            throw new ShotgunError({
              code: signal.aborted ? 'TIMEOUT' : 'OUTCOME_UNKNOWN',
              safeMessage: signal.aborted
                ? 'Gemini streaming request was cancelled.'
                : 'Gemini interaction completed without a successful result.',
              module: 'gemini-ai-provider',
              operation: 'stream-structured',
              retryable: signal.aborted,
            });
          }
          const completedUsage = (interaction?.usage ?? value.usage) as
            Record<string, unknown> | undefined;
          if (completedUsage) {
            usage = {
              inputTokens:
                typeof completedUsage.input_tokens === 'number'
                  ? completedUsage.input_tokens
                  : undefined,
              outputTokens:
                typeof completedUsage.output_tokens === 'number'
                  ? completedUsage.output_tokens
                  : undefined,
              totalTokens:
                typeof completedUsage.total_tokens === 'number'
                  ? completedUsage.total_tokens
                  : undefined,
            };
          }
        }
        if (value.event_type === 'interaction.status_update') {
          const status = value.status;
          if (status === 'failed' || status === 'cancelled' || status === 'incomplete') {
            throw new ShotgunError({
              code: signal.aborted ? 'TIMEOUT' : 'OUTCOME_UNKNOWN',
              safeMessage: signal.aborted
                ? 'Gemini streaming request was cancelled.'
                : 'Gemini streaming request ended before a final response was received.',
              module: 'gemini-ai-provider',
              operation: 'stream-structured',
              retryable: signal.aborted,
            });
          }
        }
        if (value.event_type === 'step.delta') {
          const delta = value.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text' && typeof delta.text === 'string') {
            rawText += delta.text;
            await onText(delta.text);
          }
          const metadata = value.metadata as Record<string, unknown> | undefined;
          const totalUsage = metadata?.total_usage as Record<string, unknown> | undefined;
          if (totalUsage) {
            usage = {
              inputTokens:
                typeof totalUsage.input_tokens === 'number' ? totalUsage.input_tokens : undefined,
              outputTokens:
                typeof totalUsage.output_tokens === 'number' ? totalUsage.output_tokens : undefined,
              totalTokens:
                typeof totalUsage.total_tokens === 'number' ? totalUsage.total_tokens : undefined,
            };
          }
        }
        if (value.event_type === 'step.stop') {
          const eventUsage = value.usage as Record<string, unknown> | undefined;
          if (eventUsage) {
            usage = {
              inputTokens:
                typeof eventUsage.input_tokens === 'number' ? eventUsage.input_tokens : undefined,
              outputTokens:
                typeof eventUsage.output_tokens === 'number' ? eventUsage.output_tokens : undefined,
              totalTokens:
                typeof eventUsage.total_tokens === 'number' ? eventUsage.total_tokens : undefined,
            };
          }
        }
      }
      if (!completed) {
        throw new ShotgunError({
          code: signal.aborted ? 'TIMEOUT' : 'OUTCOME_UNKNOWN',
          safeMessage: signal.aborted
            ? 'Gemini streaming request was cancelled.'
            : 'Gemini stream ended before interaction.completed was received.',
          module: 'gemini-ai-provider',
          operation: 'stream-structured-completion',
          retryable: signal.aborted,
        });
      }
      if (!rawText.trim()) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Gemini returned no streamed structured text.',
          module: 'gemini-ai-provider',
          operation: 'read-streamed-structured-output',
          retryable: true,
        });
      }
      return {
        rawText,
        ...(providerResponseId ? { providerResponseId } : {}),
        modelVersion: this.identity.model,
        ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(usage?.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
      };
    } catch (error) {
      if (error instanceof ShotgunError) throw error;
      if (signal.aborted) {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'Gemini streaming request was cancelled.',
          module: 'gemini-ai-provider',
          operation: 'stream-structured',
          retryable: true,
          cause: error,
        });
      }
      throw new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'Gemini streaming request ended with an unknown provider outcome.',
        module: 'gemini-ai-provider',
        operation: 'stream-structured',
        cause: error,
      });
    }
  }
}
