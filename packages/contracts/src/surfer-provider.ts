import type { AIExecutionIdentity } from './ai-candidate-validation.js';
import type { SurferUsage } from './surfer-execution.js';
import { decodeSurferUsage } from './surfer-execution.js';
import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';

export type SurferProviderProfile = {
  schemaVersion: '1.0.0';
  revision: string;
  mode: 'LIVE' | 'ISOLATED_CONTRACT';
  identity: AIExecutionIdentity;
  accountFingerprint: string;
  authorityRef: string;
  egressPolicyRevision: string;
  pricingRevision: string;
  currency: string;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  inputBoundRevision: string;
  promptRevision: string;
  allowedResponseModels: string[];
  maxInputBytes: number;
  maximum: SurferUsage;
};
export type SurferGenerationRequest = {
  systemInstruction: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
};
export type SurferProviderBinding = {
  workloadClass: 'SURFER_COGNITION';
  mode: SurferProviderProfile['mode'];
  operationId: string;
  reservationId: string;
  projectId: string;
  sourceVersionId: string;
  sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  accessScope: string[];
  identityDigest: string;
  profileDigest: string;
  inputDigest: string;
  maximum: SurferUsage;
};
export type SurferAccountReceipt = {
  workloadClass: 'SURFER_COGNITION';
  mode: SurferProviderProfile['mode'];
  receiptId: string;
  authorityRef: string;
  bindingDigest: string;
};
/** Trusted account-wide allowance/egress owner. authorize atomically grants exactly one send.
 * It must not send HTTP; a failed/unknown grant must never be silently reissued. */
export interface SurferAccountExecutionAuthorityPort {
  authorize(binding: SurferProviderBinding): Promise<SurferAccountReceipt>;
  settle(
    binding: SurferProviderBinding,
    receipt: SurferAccountReceipt,
    usage: SurferUsage,
  ): Promise<void>;
}
export type SurferObservedProviderResponse = {
  rawText: string;
  providerResponseId: string | null;
  modelVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};
export interface SurferPreparedProvider {
  inputTokensUpperBound: number;
  inputBoundRevision: string;
  generate(signal: AbortSignal): Promise<{
    response: SurferObservedProviderResponse;
    receipt: SurferAccountReceipt;
  }>;
  discard(): void;
}
export interface SurferProviderGatewayPort {
  prepare(
    binding: SurferProviderBinding,
    request: SurferGenerationRequest,
  ): Promise<SurferPreparedProvider>;
  reconcile(
    binding: SurferProviderBinding,
    receipt: SurferAccountReceipt,
    usage: SurferUsage,
  ): Promise<void>;
}
/** Authenticated failure before HTTP invocation. Never wrap arbitrary provider errors in this class. */
export class SurferProviderNotSentError extends Error {
  constructor() {
    super('Surfer provider was not sent.');
  }
}

const text = { type: 'string', minLength: 1, maxLength: 256 };
const int = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.provider-profile',
  version: '1.0.0',
  kind: 'command',
  inputSchema: object({
    schemaVersion: { const: '1.0.0' },
    revision: text,
    mode: { enum: ['LIVE', 'ISOLATED_CONTRACT'] },
    identity: object({
      providerId: text,
      modelId: text,
      aiConfigurationRevision: { ...int, minimum: 1 },
      credentialId: text,
      credentialRevision: { ...int, minimum: 1 },
      policyContextRevision: text,
      providerPolicyFingerprint: text,
    }),
    accountFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    authorityRef: text,
    egressPolicyRevision: text,
    pricingRevision: text,
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    inputMicrosPerMillion: int,
    outputMicrosPerMillion: int,
    inputBoundRevision: text,
    promptRevision: text,
    allowedResponseModels: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: text,
    },
    maxInputBytes: { type: 'integer', minimum: 1, maximum: 131072 },
    maximum: { type: 'object' },
  }),
});
registry.register({
  name: 'surfer.account-receipt',
  version: '1.0.0',
  kind: 'command',
  inputSchema: object({
    workloadClass: { const: 'SURFER_COGNITION' },
    mode: { enum: ['LIVE', 'ISOLATED_CONTRACT'] },
    receiptId: text,
    authorityRef: text,
    bindingDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  }),
});
export function decodeSurferProviderProfile(input: unknown): SurferProviderProfile {
  assertSurferJson(input);
  registry.validateInput('surfer.provider-profile', '1.0.0', input);
  const p = structuredClone(input) as SurferProviderProfile;
  decodeSurferUsage(p.maximum);
  if (
    p.maximum.calls !== 1 ||
    p.maximum.outputTokens < 1 ||
    p.maximum.inputTokens < 1 ||
    p.maximum.elapsedMs < 1 ||
    p.maximum.elapsedMs > 60000 ||
    (p.mode === 'LIVE' && (!p.inputMicrosPerMillion || !p.outputMicrosPerMillion))
  )
    throw surferFailure('Invalid bounded provider profile.');
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(p);
  return p;
}
export function assertSurferAccountReceipt(
  input: unknown,
  binding: SurferProviderBinding,
  profile: SurferProviderProfile,
): SurferAccountReceipt {
  assertSurferJson(input);
  registry.validateInput('surfer.account-receipt', '1.0.0', input);
  const r = structuredClone(input) as SurferAccountReceipt;
  if (
    r.bindingDigest !== surferDigest(binding) ||
    r.mode !== profile.mode ||
    r.authorityRef !== profile.authorityRef
  )
    throw surferFailure('Account receipt does not bind this Surfer execution.');
  return r;
}
export function priceSurferProviderUsage(
  inputTokens: number,
  outputTokens: number,
  elapsedMs: number,
  profile: SurferProviderProfile,
): SurferUsage {
  const money =
    (BigInt(inputTokens) * BigInt(profile.inputMicrosPerMillion) +
      BigInt(outputTokens) * BigInt(profile.outputMicrosPerMillion) +
      999999n) /
    1000000n;
  return decodeSurferUsage({
    calls: 1,
    inputTokens,
    outputTokens,
    moneyMicros: Number(money),
    elapsedMs,
  });
}
