import { createHash } from 'node:crypto';
import type { AIProviderConnectivityAdapter } from '../../../modules/ai-settings-backend/src/index.js';
import {
  DEFAULT_CANDIDATE_EXTRACTION_TIMEOUT_MS,
  type StructuredGenerationResponse,
} from '../../../modules/ai-provider/src/index.js';
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
  readonly generationTimeoutMs?: number;
  readonly temperature?: number;
  readonly fetch?: FetchLike;
};

/** Prepared transport only. Pins must come from an authorized immutable asset
 * read; these declarations do not authenticate a user or activate image intake.
 * Existing Python image preflight remains responsible for complete decoding. */
export type DeepSeekInlineImage = {
  readonly mediaType: 'image/png' | 'image/jpeg';
  readonly contentBase64: string;
  readonly expectedContentHash: string;
};
export const DEEPSEEK_IMAGE_TRANSPORT_REVISION = 'deepseek-inline-vision-v1' as const;
export type DeepSeekImageGenerationResponse = StructuredGenerationResponse & {
  readonly imageTransportRevision: typeof DEEPSEEK_IMAGE_TRANSPORT_REVISION;
  readonly imageRequestDigest: string;
  readonly imageContentHashes: readonly string[];
};

const base64EnvelopeIsValid = (value: string): boolean => {
  if (!value.length || value.length % 4 !== 0) return false;
  const paddingStart = value.indexOf('=');
  const alphabet = paddingStart === -1 ? value : value.slice(0, paddingStart);
  if (/[^A-Za-z0-9+/]/u.test(alphabet)) return false;
  if (paddingStart === -1) return true;
  const paddingLength = value.length - paddingStart;
  return paddingLength <= 2 && value.slice(paddingStart) === '='.repeat(paddingLength);
};

const inlineImages = (images: readonly DeepSeekInlineImage[]) => {
  if (!Array.isArray(images) || images.length < 1 || images.length > 4)
    throw errorFor('VALIDATION_ERROR', 'A bounded nonempty image batch is required.');
  let totalBytes = 0;
  return images.map((image) => {
    if (
      !image ||
      !['image/png', 'image/jpeg'].includes(image.mediaType) ||
      typeof image.contentBase64 !== 'string' ||
      image.contentBase64.length > 14_000_000 ||
      !base64EnvelopeIsValid(image.contentBase64) ||
      !/^sha256:[a-f0-9]{64}$/u.test(image.expectedContentHash)
    )
      throw errorFor('VALIDATION_ERROR', 'The pinned inline image is invalid.');
    const bytes = Buffer.from(image.contentBase64, 'base64');
    totalBytes += bytes.length;
    const signatureMatches =
      image.mediaType === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024 ||
      totalBytes > 20 * 1024 * 1024 ||
      bytes.toString('base64') !== image.contentBase64 ||
      !signatureMatches ||
      `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== image.expectedContentHash
    )
      throw errorFor('VALIDATION_ERROR', 'The image bytes do not match their immutable pin.');
    return {
      type: 'image_url',
      image_url: {
        url: `data:${image.mediaType};base64,${bytes.toString('base64')}`,
        detail: 'original',
      },
    };
  });
};

export class DeepSeekConnectivityAdapter implements AIProviderConnectivityAdapter {
  readonly providerId = 'deepseek';
  readonly adapterVersion: string;
  readonly supportsOutputTokenLimit = true;
  readonly supportsCancellation = true;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly generationTimeoutMs: number;
  private readonly temperature: number;
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
    this.generationTimeoutMs =
      options.generationTimeoutMs ?? DEFAULT_CANDIDATE_EXTRACTION_TIMEOUT_MS;
    if (!Number.isFinite(this.generationTimeoutMs) || this.generationTimeoutMs <= 0) {
      throw new Error('DeepSeek generation timeout must be a positive number of milliseconds.');
    }
    const temperature = options.temperature ?? 0.2;
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error('DeepSeek generation temperature must be between 0 and 2.');
    }
    this.temperature = temperature;
    this.adapterVersion = `deepseek-chat-completions-v2-temperature-${temperature}`;
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
        temperature: this.temperature,
        ...(input.request.maxOutputTokens === undefined
          ? {}
          : { max_tokens: input.request.maxOutputTokens }),
      },
      input.signal,
      this.generationTimeoutMs,
    );
    return this.structuredResult(response, input.modelId);
  }

  /** Existing deepseek-flash native transport. No external URL/Files API,
   * alternate model fallback, retry loop or implicit credential resolution. */
  async generateImageStructured(
    input: Parameters<AIProviderConnectivityAdapter['generateStructured']>[0] & {
      readonly images: readonly DeepSeekInlineImage[];
    },
  ): Promise<DeepSeekImageGenerationResponse> {
    const modelId = input.modelId;
    const signal = input.signal;
    if (signal?.aborted)
      throw errorFor('TERMINAL_FAILURE', 'The image request was cancelled before execution.');
    if (modelId !== 'deepseek-flash')
      throw errorFor(
        'VALIDATION_ERROR',
        'The pinned model has no configured native image transport.',
      );
    const images = inlineImages(input.images);
    const body = {
      model: modelId,
      messages: [
        {
          role: 'system',
          content: `${input.request.systemInstruction}\nReturn only a JSON object matching this JSON Schema: ${JSON.stringify(input.request.responseSchema)}`,
        },
        { role: 'user', content: [{ type: 'text', text: input.request.prompt }, ...images] },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false,
      temperature: this.temperature,
      ...(input.request.maxOutputTokens === undefined
        ? {}
        : { max_tokens: input.request.maxOutputTokens }),
    };
    const serializedBody = JSON.stringify(body);
    if (Buffer.byteLength(serializedBody, 'utf8') > 32 * 1024 * 1024)
      throw errorFor(
        'VALIDATION_ERROR',
        'The image request exceeds its configured envelope limit.',
      );
    const response = await this.request(input.apiKey, body, signal, this.generationTimeoutMs);
    if (!response || typeof response !== 'object' || response.model !== modelId)
      throw errorFor(
        'VALIDATION_ERROR',
        'The image response did not confirm the pinned model identity.',
      );
    return Object.freeze({
      ...this.structuredResult(response, modelId),
      imageTransportRevision: DEEPSEEK_IMAGE_TRANSPORT_REVISION,
      imageRequestDigest: `sha256:${createHash('sha256').update(serializedBody).digest('hex')}`,
      imageContentHashes: Object.freeze(
        images.map((imagePart) => {
          const data = imagePart.image_url.url.split(',')[1]!;
          return `sha256:${createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex')}`;
        }),
      ),
    });
  }

  private structuredResult(
    response: DeepSeekResponse,
    modelId: string,
  ): StructuredGenerationResponse {
    const rawText = this.outputText(response);
    parseObject(rawText);
    return {
      rawText,
      ...(typeof response.id === 'string' ? { providerResponseId: response.id } : {}),
      modelVersion: typeof response.model === 'string' ? response.model : modelId,
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
    timeoutMs = this.timeoutMs,
  ): Promise<DeepSeekResponse> {
    const apiKey = new TextDecoder().decode(apiKeyBytes);
    if (!apiKey.trim()) throw errorFor('AUTHENTICATION_FAILED', 'DeepSeek credential is empty.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
