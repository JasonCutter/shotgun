import type { AIProviderConnectivityAdapter } from '../../../modules/ai-settings-backend/src/index.js';
import type { StructuredGenerationResponse } from '../../../modules/ai-provider/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type DeepSeekResponse = {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
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
    module: 'deepseek-ai-provider',
    operation: 'connectivity',
    retryable: code === 'RATE_LIMITED' || code === 'RETRYABLE_DEPENDENCY',
    cause,
  });

const mapStatus = (status: number): ShotgunError => {
  if (status === 401 || status === 403) {
    return errorFor('AUTHENTICATION_FAILED', 'DeepSeek credentials or model access was rejected.');
  }
  if (status === 429) return errorFor('RATE_LIMITED', 'DeepSeek rate limit was reached.');
  if (status >= 500) {
    return errorFor('RETRYABLE_DEPENDENCY', 'DeepSeek is temporarily unavailable.');
  }
  return errorFor('TERMINAL_FAILURE', 'DeepSeek rejected the request.');
};

const parseObject = (rawText: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Structured output is not an object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw errorFor('VALIDATION_ERROR', 'DeepSeek returned invalid structured output.', error);
  }
};

export type DeepSeekConnectivityAdapterOptions = {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: FetchLike;
};

export class DeepSeekConnectivityAdapter implements AIProviderConnectivityAdapter {
  readonly providerId = 'deepseek';
  readonly supportsOutputTokenLimit = true;
  readonly supportsCancellation = true;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetch: FetchLike;

  constructor(options: DeepSeekConnectivityAdapterOptions = {}) {
    const baseUrl = new URL(options.baseUrl?.trim() || 'https://api.deepseek.com');
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
      throw new Error('DeepSeek base URL must be an HTTPS URL without embedded credentials.');
    }
    this.endpoint = `${baseUrl.toString().replace(/\/$/, '')}/chat/completions`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('DeepSeek timeout must be a positive number of milliseconds.');
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async testConnection(input: Parameters<AIProviderConnectivityAdapter['testConnection']>[0]) {
    const response = await this.request(
      input.apiKey,
      {
        model: input.modelId,
        messages: [
          { role: 'system', content: 'Return only JSON with the boolean field ready=true.' },
          { role: 'user', content: 'Shotgun connectivity probe.' },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        stream: false,
      },
      input.signal,
    );
    const rawText = this.outputText(response);
    if (parseObject(rawText).ready !== true) {
      throw errorFor('VALIDATION_ERROR', 'DeepSeek returned an invalid connectivity result.');
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
        messages: [
          {
            role: 'system',
            content: `${input.request.systemInstruction}\nReturn only a JSON object matching this JSON Schema: ${JSON.stringify(input.request.responseSchema)}`,
          },
          { role: 'user', content: input.request.prompt },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        stream: false,
        ...(input.request.maxOutputTokens === undefined
          ? {}
          : { max_tokens: input.request.maxOutputTokens }),
      },
      input.signal,
    );
    const rawText = this.outputText(response);
    parseObject(rawText);
    return {
      rawText,
      ...(typeof response.id === 'string' ? { providerResponseId: response.id } : {}),
      modelVersion: typeof response.model === 'string' ? response.model : input.modelId,
      ...(numberOrUndefined(response.usage?.prompt_tokens) === undefined
        ? {}
        : { inputTokens: numberOrUndefined(response.usage?.prompt_tokens) }),
      ...(numberOrUndefined(response.usage?.completion_tokens) === undefined
        ? {}
        : { outputTokens: numberOrUndefined(response.usage?.completion_tokens) }),
      ...(numberOrUndefined(response.usage?.total_tokens) === undefined
        ? {}
        : { totalTokens: numberOrUndefined(response.usage?.total_tokens) }),
    };
  }

  private outputText(response: DeepSeekResponse): string {
    const rawText = response.choices?.[0]?.message?.content;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw errorFor('VALIDATION_ERROR', 'DeepSeek returned no structured text.');
    }
    return rawText;
  }

  private async request(
    apiKeyBytes: Uint8Array,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<DeepSeekResponse> {
    const apiKey = new TextDecoder().decode(apiKeyBytes);
    if (!apiKey.trim()) throw errorFor('AUTHENTICATION_FAILED', 'DeepSeek credential is empty.');
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
        return (await response.json()) as DeepSeekResponse;
      } catch (error) {
        throw errorFor('VALIDATION_ERROR', 'DeepSeek returned an invalid response.', error);
      }
    } catch (error) {
      if (error instanceof ShotgunError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The DeepSeek request timed out.',
          module: 'deepseek-ai-provider',
          operation: 'connectivity',
          retryable: true,
          cause: error,
        });
      }
      throw errorFor('RETRYABLE_DEPENDENCY', 'DeepSeek could not be reached.', error);
    } finally {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
    }
  }
}
