import { createHash } from 'node:crypto';
import type { AIProviderExecutionResolverPort } from '../../../modules/ai-provider/src/index.js';
import { CredentialBackedAIProviderAdapter } from '../../ai-provider-router/src/index.js';
import {
  assertSurferAccountReceipt,
  decodeSurferProviderProfile,
  SurferProviderNotSentError,
  type SurferProviderProfile,
  type SurferProviderGatewayPort,
  type SurferProviderBinding,
  type SurferGenerationRequest,
  type SurferPreparedProvider,
  type SurferAccountExecutionAuthorityPort,
} from '../../../packages/contracts/src/surfer-provider.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';

/** Existing Shotgun resolver/vault/transport, plus a separate Surfer account authority.
 * No default authority, environment key lookup, live registration or VP_RELATION impersonation. */
export class ShotgunSurferProviderGateway implements SurferProviderGatewayPort {
  readonly profile: SurferProviderProfile;
  constructor(
    private readonly resolver: AIProviderExecutionResolverPort,
    profile: unknown,
    private readonly authority: SurferAccountExecutionAuthorityPort,
    private readonly inputBound: {
      revision: string;
      upperBound(request: SurferGenerationRequest): number;
    },
  ) {
    this.profile = decodeSurferProviderProfile(profile);
    if (
      this.profile.identity.providerId !== 'deepseek' ||
      inputBound.revision !== this.profile.inputBoundRevision
    )
      throw surferFailure('Provider/input-bound profile is not the established pinned path.');
  }
  async prepare(
    bindingInput: SurferProviderBinding,
    requestInput: SurferGenerationRequest,
  ): Promise<SurferPreparedProvider> {
    assertSurferJson(bindingInput);
    assertSurferJson(requestInput);
    const binding = structuredClone(bindingInput),
      request = structuredClone(requestInput),
      p = this.profile;
    if (
      binding.workloadClass !== 'SURFER_COGNITION' ||
      binding.mode !== p.mode ||
      binding.profileDigest !== surferDigest(p) ||
      binding.identityDigest !== surferDigest(p.identity) ||
      binding.inputDigest !== surferDigest(request) ||
      surferDigest(binding.maximum) !== surferDigest(p.maximum) ||
      request.maxOutputTokens !== p.maximum.outputTokens ||
      Buffer.byteLength(JSON.stringify(request)) > p.maxInputBytes ||
      binding.sensitivity === 'restricted'
    )
      throw surferFailure('Provider binding does not match frozen input/profile.');
    const upper = this.inputBound.upperBound(structuredClone(request));
    if (!Number.isSafeInteger(upper) || upper < 1 || upper > p.maximum.inputTokens)
      throw surferFailure('Provider input bound unavailable or exceeded.');
    const resolved = await this.resolver.resolve({
      projectId: binding.projectId,
      requestId: binding.operationId,
      sourceVersionId: binding.sourceVersionId,
      dataClassification: binding.sensitivity,
      accessScope: binding.accessScope,
      sensitivity: binding.sensitivity,
      existingIdentity: structuredClone(p.identity),
    });
    if (
      surferDigest(resolved.executionIdentity) !== binding.identityDigest ||
      !(resolved.adapter instanceof CredentialBackedAIProviderAdapter) ||
      resolved.adapter.identity.provider !== p.identity.providerId ||
      resolved.adapter.identity.model !== p.identity.modelId ||
      !resolved.adapter.identity.supportsOutputTokenLimit ||
      !resolved.adapter.identity.supportsCancellation
    )
      throw surferFailure('Exact resolver identity/capabilities unavailable.');
    const adapter = await resolved.adapter.captureSingleUse((secret, metadata) => {
      if (
        metadata.projectId !== binding.projectId ||
        metadata.providerId !== p.identity.providerId ||
        metadata.credentialId !== p.identity.credentialId ||
        metadata.credentialRevision !== p.identity.credentialRevision ||
        createHash('sha256').update(secret).digest('hex') !== p.accountFingerprint
      )
        throw surferFailure('Pinned credential account unavailable.');
    });
    let used = false;
    return {
      inputTokensUpperBound: upper,
      inputBoundRevision: this.inputBound.revision,
      discard: () => {
        used = true;
        adapter.discardCapturedCredential();
      },
      generate: async (signal) => {
        if (used || signal.aborted) {
          used = true;
          adapter.discardCapturedCredential();
          throw new SurferProviderNotSentError();
        }
        used = true;
        try {
          // A failed authorization may have committed. Keep it unknown; never auto-retry/refund.
          const receipt = assertSurferAccountReceipt(
            await this.authority.authorize(structuredClone(binding)),
            binding,
            p,
          );
          if (signal.aborted) throw new Error('Surfer authorization consumed before cancellation.');
          const result = await adapter.generateStructuredWithSignal!(
            structuredClone(request),
            signal,
          );
          if (typeof result.rawText !== 'string' || Buffer.byteLength(result.rawText) > 32768)
            throw new Error('Provider response exceeded the durable bound.');
          const token = (v: unknown) =>
            typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
          return {
            receipt,
            response: {
              rawText: result.rawText,
              providerResponseId:
                typeof result.providerResponseId === 'string' ? result.providerResponseId : null,
              modelVersion: typeof result.modelVersion === 'string' ? result.modelVersion : null,
              inputTokens: token(result.inputTokens),
              outputTokens: token(result.outputTokens),
            },
          };
        } finally {
          adapter.discardCapturedCredential();
        }
      },
    };
  }
  async reconcile(
    binding: SurferProviderBinding,
    receipt: Parameters<SurferProviderGatewayPort['reconcile']>[1],
    usage: Parameters<SurferProviderGatewayPort['reconcile']>[2],
  ): Promise<void> {
    if (
      binding.profileDigest !== surferDigest(this.profile) ||
      binding.identityDigest !== surferDigest(this.profile.identity) ||
      surferDigest(binding.maximum) !== surferDigest(this.profile.maximum)
    )
      throw surferFailure('Reconciliation profile changed.');
    assertSurferAccountReceipt(receipt, binding, this.profile);
    await this.authority.settle(
      structuredClone(binding),
      structuredClone(receipt),
      structuredClone(usage),
    );
  }
}
