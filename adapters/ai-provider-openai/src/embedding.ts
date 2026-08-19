import {
  type ProviderEmbeddingConnectivityPort,
  type ProviderEmbeddingRequest,
  type ProviderEmbeddingResponse,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type OpenAIEmbeddingDataItem = {
  readonly object?: unknown;
  readonly index?: unknown;
  readonly embedding?: unknown;
};

type OpenAIEmbeddingResponse = {
  readonly object?: unknown;
  readonly data?: unknown;
  readonly model?: unknown;
  readonly usage?: {
    readonly prompt_tokens?: unknown;
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
    module: 'openai-embedding-connectivity',
    operation: 'connectivity',
    retryable: code === 'RATE_LIMITED' || code === 'RETRYABLE_DEPENDENCY',
    cause,
  });

const mapStatus = (status: number): ShotgunError => {
  if (status === 401 || status === 403) {
    return errorFor('AUTHENTICATION_FAILED', 'OpenAI credentials or model access was rejected.');
  }
  if (status === 429) {
    return errorFor('RATE_LIMITED', 'OpenAI rate limit was reached.');
  }
  if (status >= 500) {
    return errorFor('RETRYABLE_DEPENDENCY', 'OpenAI is temporarily unavailable.');
  }
  return errorFor('TERMINAL_FAILURE', 'OpenAI rejected the embedding request.');
};

export type OpenAIEmbeddingConnectivityOptions = {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: FetchLike;
};

export class OpenAIEmbeddingConnectivityAdapter implements ProviderEmbeddingConnectivityPort {
  readonly providerId = 'openai';
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetch: FetchLike;

  constructor(options: OpenAIEmbeddingConnectivityOptions = {}) {
    const baseUrl = new URL(options.baseUrl?.trim() || 'https://api.openai.com/v1');
    if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
      throw new Error('OpenAI base URL must be an HTTPS URL without embedded credentials.');
    }
    this.endpoint = `${baseUrl.toString().replace(/\/$/, '')}/embeddings`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('OpenAI timeout must be a positive number of milliseconds.');
    }
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async embed(request: ProviderEmbeddingRequest): Promise<ProviderEmbeddingResponse> {
    const apiKey = request.apiKey?.trim();
    if (!apiKey) {
      throw errorFor('AUTHENTICATION_FAILED', 'OpenAI API key is missing or empty.');
    }

    const model = request.modelId?.trim();
    if (!model) {
      throw errorFor('VALIDATION_ERROR', 'OpenAI model ID is required.');
    }

    const input = request.input;
    const isArray = Array.isArray(input);
    if (isArray && input.length === 0) {
      throw errorFor('VALIDATION_ERROR', 'OpenAI input array cannot be empty.');
    }
    if (!isArray && typeof input !== 'string') {
      throw errorFor('VALIDATION_ERROR', 'OpenAI input must be a string or array of strings.');
    }

    const body: Record<string, unknown> = {
      model,
      input,
    };
    if (request.dimension !== undefined) {
      if (!Number.isSafeInteger(request.dimension) || request.dimension <= 0) {
        throw errorFor('VALIDATION_ERROR', 'Requested dimension must be a positive integer.');
      }
      body.dimensions = request.dimension;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
    timeout.unref();
    const abort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw mapStatus(response.status);
      }

      let parsed: OpenAIEmbeddingResponse;
      try {
        parsed = (await response.json()) as OpenAIEmbeddingResponse;
      } catch (error) {
        throw errorFor('VALIDATION_ERROR', 'OpenAI returned invalid JSON.', error);
      }

      if (!parsed || typeof parsed !== 'object') {
        throw errorFor('VALIDATION_ERROR', 'OpenAI response is not an object.');
      }

      if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
        throw errorFor('VALIDATION_ERROR', 'OpenAI response data array is empty or missing.');
      }

      const expectedCount = isArray ? input.length : 1;
      if (parsed.data.length !== expectedCount) {
        throw errorFor(
          'VALIDATION_ERROR',
          `OpenAI returned ${parsed.data.length} embeddings, expected ${expectedCount}.`,
        );
      }

      // Sort items by index ascending
      const rawItems = [...(parsed.data as readonly OpenAIEmbeddingDataItem[])].sort((a, b) => {
        const idxA = typeof a.index === 'number' ? a.index : 0;
        const idxB = typeof b.index === 'number' ? b.index : 0;
        return idxA - idxB;
      });

      const items = rawItems.map((item, idx) => {
        if (!item || typeof item !== 'object' || !Array.isArray(item.embedding)) {
          throw errorFor(
            'VALIDATION_ERROR',
            `OpenAI returned invalid embedding vector at index ${idx}.`,
          );
        }
        const vector = item.embedding as number[];
        if (vector.length === 0) {
          throw errorFor('VALIDATION_ERROR', `OpenAI returned empty vector at index ${idx}.`);
        }
        for (let j = 0; j < vector.length; j++) {
          if (typeof vector[j] !== 'number' || !Number.isFinite(vector[j])) {
            throw errorFor(
              'VALIDATION_ERROR',
              `OpenAI returned non-finite number in vector at index ${idx}.`,
            );
          }
        }
        return {
          vector,
          dimension: vector.length,
        };
      });

      return {
        providerId: 'openai',
        modelId: typeof parsed.model === 'string' ? parsed.model : model,
        items,
        ...(numberOrUndefined(parsed.usage?.total_tokens) !== undefined
          ? { totalTokens: numberOrUndefined(parsed.usage?.total_tokens) }
          : {}),
      };
    } catch (error) {
      if (error instanceof ShotgunError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The OpenAI embedding request timed out.',
          module: 'openai-embedding-connectivity',
          operation: 'connectivity',
          retryable: true,
          cause: error,
        });
      }
      throw errorFor('RETRYABLE_DEPENDENCY', 'OpenAI could not be reached.', error);
    } finally {
      request.signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
    }
  }
}
