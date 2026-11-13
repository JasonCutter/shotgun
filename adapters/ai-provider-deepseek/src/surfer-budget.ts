import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferGenerationRequest } from '../../../packages/contracts/src/surfer-provider.js';

export const SURFER_DEEPSEEK_BASELINE_POLICY = Object.freeze({
  revision: 'surfer-deepseek-baseline-2026-10-27-v1',
  provider: 'deepseek',
  modelId: 'deepseek-flash',
  declaredRelease: 'DeepSeek-V4.1-Flash-1017',
  contextCeiling: 1048576,
  maxOutputTokens: 4096,
  inputMicrosPerMillion: 300000,
  outputMicrosPerMillion: 1200000,
  currency: 'USD',
  maxModelCalls: 24,
  maxMetadataReads: 1,
  maxRepairs: 0,
  maxConcurrent: 1,
  maximumMoneyMicros: 7667712,
  metadataEndpoint: 'https://api.deepseek.com/models',
  generationEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
  metadataUrl: 'https://api-docs.deepseek.com/api/list-models/',
  priceMeaning: 'PEAK_CACHE_MISS_CONSERVATIVE_RESERVATION_NOT_INVOICE',
});
export type SurferDeepSeekMetadata = {
  schemaVersion: '1.0.0';
  modelId: 'deepseek-flash';
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  observedAtMs: number;
  responseDigest: string;
  receiptDigest: string;
};
/** Trusted caller must supply the body of its approved GET /models, never model-generated JSON.
 * Validates the documented ceiling; does not issue credentials, egress or an immutable weights pin. */
export function readSurferDeepSeekMetadata(
  body: unknown,
  observedAtMs: number,
): SurferDeepSeekMetadata {
  assertSurferJson(body);
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 1)
    throw surferFailure('Invalid metadata observation time.');
  const response = body as { object?: unknown; data?: unknown[] };
  if (response.object !== 'list' || !Array.isArray(response.data) || response.data.length > 64)
    throw surferFailure('Invalid model metadata response.');
  const models = response.data.filter(
    (x) => x && typeof x === 'object' && (x as { id?: unknown }).id === 'deepseek-flash',
  );
  if (models.length !== 1)
    throw surferFailure('Canonical DeepSeek model metadata missing/ambiguous.');
  const m = models[0] as {
    name?: unknown;
    context_window?: unknown;
    max_output_tokens?: unknown;
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  if (
    typeof m.name !== 'string' ||
    !/^DeepSeek[- ]V4[.]1[- ]Flash(?:[- ]1017)?$/i.test(m.name) ||
    !Number.isSafeInteger(m.context_window) ||
    Number(m.context_window) !== SURFER_DEEPSEEK_BASELINE_POLICY.contextCeiling ||
    !Number.isSafeInteger(m.max_output_tokens) ||
    Number(m.max_output_tokens) < 4096 ||
    !Array.isArray(m.input_modalities) ||
    !m.input_modalities.includes('text') ||
    !Array.isArray(m.output_modalities) ||
    !m.output_modalities.includes('text')
  )
    throw surferFailure('Model context/output/modality disagrees with reviewed baseline.');
  const value = {
    schemaVersion: '1.0.0' as const,
    modelId: 'deepseek-flash' as const,
    displayName: m.name,
    contextWindow: Number(m.context_window),
    maxOutputTokens: Number(m.max_output_tokens),
    observedAtMs,
    responseDigest: surferDigest(body),
  };
  return { ...value, receiptDigest: surferDigest(value) };
}
/** Uses the entire provider-declared context capacity, including output, as a conservative input
 * reservation. This is intentionally not a tokenizer estimate or a character/token ratio. */
export class SurferDeepSeekContextBound {
  readonly revision: string;
  private readonly metadata: SurferDeepSeekMetadata;
  constructor(
    input: SurferDeepSeekMetadata,
    private readonly clock = Date.now,
    private readonly outputCap: 4096 | 8192 = 4096,
  ) {
    assertSurferJson(input);
    const { receiptDigest, ...value } = input;
    if (
      surferDigest(value) !== receiptDigest ||
      input.modelId !== 'deepseek-flash' ||
      input.contextWindow !== SURFER_DEEPSEEK_BASELINE_POLICY.contextCeiling ||
      !Number.isSafeInteger(input.observedAtMs) ||
      input.observedAtMs < 1 ||
      ![4096, 8192].includes(outputCap) ||
      input.maxOutputTokens < outputCap
    )
      throw surferFailure('Unbound/unsupported provider metadata.');
    this.metadata = structuredClone(input);
    this.revision =
      (outputCap === 4096
        ? 'surfer.deepseek.context-ceiling.v1:'
        : 'surfer.deepseek.context-ceiling.v2-8192:') + receiptDigest;
  }
  upperBound(request: SurferGenerationRequest): number {
    assertSurferJson(request);
    const now = this.clock(),
      m = this.metadata;
    if (
      !Number.isSafeInteger(now) ||
      now < m.observedAtMs ||
      now - m.observedAtMs > 60 * 60000 ||
      Buffer.byteLength(JSON.stringify(request)) > 131072 ||
      request.maxOutputTokens !== this.outputCap
    )
      throw surferFailure('Model metadata expired or request exceeds reviewed profile.');
    return m.contextWindow;
  }
}
