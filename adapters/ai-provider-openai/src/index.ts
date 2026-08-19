import type { AIProviderConnectivityAdapter } from '../../../modules/ai-settings-backend/src/index.js';
import type { StructuredGenerationResponse } from '../../../modules/ai-provider/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type OpenAIResponse = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly output?: unknown;
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
};

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const errorFor = (
  code:
    | 'AUTHENTICATION_FAILED'
    | 'RATE_LIMITED'
    | 'RETRYABLE_DEPENDENCY'
    | 'TERMINAL_FAILURE'
    | 'VALIDATION_ERROR',
  message: string,
  cause?: unknown,
): ShotgunError =>
  new ShotgunError({
    code,
    safeMessage: message,
    module: 'openai-ai-provider',
    operation: 'connectivity',
    retryable: code === 'RATE_LIMITED' || code === 'RETRYABLE_DEPENDENCY',
    cause,
  });

const mapStatus = (status: number): ShotgunError => {
  if (status === 401 || status === 403) {
    return errorFor('AUTHENTICATION_FAILED', 'OpenAI credentials or model access was rejected.');
  }
  if (status === 429) return errorFor('RATE_LIMITED', 'OpenAI rate limit was reached.');
  if (status >= 500) {
    return errorFor('RETRYABLE_DEPENDENCY', 'OpenAI is temporarily unavailable.');
  }
  return errorFor('TERMINAL_FAILURE', 'OpenAI rejected the request.');
};

const objectFromJson = (rawText: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Structured output is not an object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw errorFor('VALIDATION_ERROR', 'OpenAI returned invalid structured output.', error);
  }
};

export type OpenAIConnectivityAdapterOptions = {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: FetchLike;
};

export class OpenAIConnectivityAdapter implements AIProviderConnectivityAdapter {
  readonly providerId = 'openai';
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetch: FetchLike;

  constructor(options: OpenAIConnectivityAdapterOptions = {}) {
    const baseUrl = new URL(options.baseUrl?.trim() || 'https://api.openai.com/v1');
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
      throw new Error('OpenAI base URL must be an HTTPS URL without embedded credentials.');
    }
    this.endpoint = `${baseUrl.toString().replace(/\/$/, '')}/responses`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('OpenAI timeout must be a positive number of milliseconds.');
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async testConnection(input: Parameters<AIProviderConnectivityAdapter['testConnection']>[0]) {
    const schema = {
      type: 'object',
      properties: { ready: { type: 'boolean' } },
      required: ['ready'],
      additionalProperties: false,
    };
    const response = await this.request(
      input.apiKey,
      {
        model: input.modelId,
        input: 'Shotgun connectivity probe. Return a JSON object with ready=true.',
        store: false,
        max_output_tokens: 32,
        text: {
          format: { type: 'json_schema', name: 'shotgun_connectivity_probe', strict: true, schema },
        },
      },
      input.signal,
    );
    const rawText = this.outputText(response);
    const parsed = objectFromJson(rawText);
    if (parsed.ready !== true) {
      throw errorFor('VALIDATION_ERROR', 'OpenAI returned an invalid connectivity result.');
    }
    return { ...(typeof response.id === 'string' ? { providerRequestId: response.id } : {}) };
  }

  async generateStructured(
    input: Parameters<AIProviderConnectivityAdapter['generateStructured']>[0],
  ): Promise<StructuredGenerationResponse> {
    const response = await this.request(
      input.apiKey,
      {
        model: input.modelId,
        input: [
          { role: 'system', content: input.request.systemInstruction },
          { role: 'user', content: input.request.prompt },
        ],
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'shotgun_structured_output',
            strict: true,
            schema: input.request.responseSchema,
          },
        },
      },
      input.signal,
    );
    const rawText = this.outputText(response);
    objectFromJson(rawText);
    return {
      rawText,
      ...(typeof response.id === 'string' ? { providerResponseId: response.id } : {}),
      modelVersion: typeof response.model === 'string' ? response.model : input.modelId,
      ...(numberOrUndefined(response.usage?.input_tokens) === undefined
        ? {}
        : { inputTokens: numberOrUndefined(response.usage?.input_tokens) }),
      ...(numberOrUndefined(response.usage?.output_tokens) === undefined
        ? {}
        : { outputTokens: numberOrUndefined(response.usage?.output_tokens) }),
      ...(numberOrUndefined(response.usage?.total_tokens) === undefined
        ? {}
        : { totalTokens: numberOrUndefined(response.usage?.total_tokens) }),
    };
  }

  private outputText(response: OpenAIResponse): string {
    if (!Array.isArray(response.output)) {
      throw errorFor('VALIDATION_ERROR', 'OpenAI returned no structured text.');
    }

    const parts: string[] = [];
    for (const item of response.output) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const content = (item as { readonly content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
        const typedPart = part as { readonly type?: unknown; readonly text?: unknown };
        if (typedPart.type === 'output_text' && typeof typedPart.text === 'string') {
          parts.push(typedPart.text);
        }
      }
    }

    const text = parts.join('');
    if (!text.trim()) {
      throw errorFor('VALIDATION_ERROR', 'OpenAI returned no structured text.');
    }
    return text;
  }

  private async request(
    apiKeyBytes: Uint8Array,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OpenAIResponse> {
    const apiKey = new TextDecoder().decode(apiKeyBytes);
    if (!apiKey.trim()) throw errorFor('AUTHENTICATION_FAILED', 'OpenAI credential is empty.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw mapStatus(response.status);
      try {
        return (await response.json()) as OpenAIResponse;
      } catch (error) {
        throw errorFor('VALIDATION_ERROR', 'OpenAI returned an invalid response.', error);
      }
    } catch (error) {
      if (error instanceof ShotgunError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The OpenAI request timed out.',
          module: 'openai-ai-provider',
          operation: 'connectivity',
          retryable: true,
          cause: error,
        });
      }
      throw errorFor('RETRYABLE_DEPENDENCY', 'OpenAI could not be reached.', error);
    } finally {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
    }
  }
}

export * from './embedding.js';
