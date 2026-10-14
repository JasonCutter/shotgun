import { relationCredentialFingerprint } from '../../../adapters/vp-global-provider-budget-postgres/src/config.js';
import {
  DeepSeekConnectivityAdapter,
  type DeepSeekConnectivityAdapterOptions,
  type DeepSeekObservedImageResponse,
} from '../../../adapters/ai-provider-deepseek/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../../modules/ai-provider/src/index.js';
import type { CredentialVaultPort } from '../../../modules/credential-vault/src/index.js';
import {
  ImageObservationOutputRejectedError,
  type CapturedImageExecutor,
  type ImageObservationExecutionResolverPort,
} from '../../../modules/image-observation-execution/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

/** Test assembly injection only: credentials still resolve through existing
 * project configuration/Vault/standing authority; HTTP always uses the supplied Fake. */
export function createIsolatedFakeImageExecutionResolver(options: {
  readonly runtimeProfile: string;
  readonly executionResolver: AIProviderExecutionResolverPort;
  readonly vault: CredentialVaultPort;
  readonly fakeHttp: NonNullable<DeepSeekConnectivityAdapterOptions['fetch']>;
  readonly baseUrl?: string;
}): ImageObservationExecutionResolverPort {
  if (options.runtimeProfile !== 'runtime-test' || typeof options.fakeHttp !== 'function')
    throw new Error('ISOLATED_FAKE_IMAGE_AUTHORITY_REQUIRED');
  const baseResolver = options.executionResolver;
  const resolve = baseResolver.resolve;
  const vault = options.vault;
  const native = new DeepSeekConnectivityAdapter({
    baseUrl: options.baseUrl,
    fetch: options.fakeHttp,
  });
  return {
    async resolve(snapshot) {
      const resolved = await resolve.call(baseResolver, {
        projectId: snapshot.projectId,
        requestId: snapshot.requestId,
        sourceVersionId: snapshot.sourceVersionId,
        accessScope: snapshot.accessScope,
        sensitivity: snapshot.sensitivity,
        dataClassification: `project-${snapshot.sensitivity}`,
      });
      const identity = Object.freeze({ ...resolved.executionIdentity });
      if (identity.providerId !== 'deepseek' || identity.modelId !== 'deepseek-flash')
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: 'Image execution identity is unavailable.',
          module: 'image-fake-execution-resolver',
          operation: 'capture',
          retryable: false,
        });
      let captured: Uint8Array | undefined;
      await vault.withCredential(
        {
          projectId: snapshot.projectId,
          providerId: identity.providerId,
          credentialId: identity.credentialId,
          credentialRevision: identity.credentialRevision,
        },
        async (bytes, metadata) => {
          if (
            metadata.projectId !== snapshot.projectId ||
            metadata.providerId !== identity.providerId ||
            metadata.credentialId !== identity.credentialId ||
            metadata.credentialRevision !== identity.credentialRevision ||
            metadata.lifecycleState !== 'active'
          )
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'Pinned image credential is unavailable.',
              module: 'image-fake-execution-resolver',
              operation: 'capture',
              retryable: false,
            });
          captured = Uint8Array.from(bytes);
          return { status: 'SUCCEEDED' };
        },
      );
      if (!captured) throw new Error('IMAGE_FAKE_CREDENTIAL_CAPTURE_FAILED');
      const credentialFingerprint = `sha256:${relationCredentialFingerprint(captured)}`;
      let used = false;
      return Object.freeze({
        transportKind: 'ISOLATED_FAKE' as const,
        liveCapable: false as const,
        identity,
        credentialFingerprint,
        adapterVersion: native.adapterVersion,
        discardCapturedCredential() {
          captured?.fill(0);
          captured = undefined;
        },
        async generateImage(input: Parameters<CapturedImageExecutor['generateImage']>[0]) {
          if (used || !captured) throw new Error('IMAGE_EXECUTOR_ALREADY_CONSUMED');
          used = true;
          const secret = captured;
          captured = undefined;
          let observed: DeepSeekObservedImageResponse | undefined;
          try {
            const response = await native.generateImageStructured({
              apiKey: secret,
              modelId: identity.modelId,
              request: {
                systemInstruction: input.systemInstruction,
                prompt: input.prompt,
                responseSchema: input.responseSchema,
                maxOutputTokens: input.maxOutputTokens,
              },
              images: [
                {
                  mediaType: input.mediaType,
                  contentBase64: Buffer.from(input.imageBytes).toString('base64'),
                  expectedContentHash: input.expectedContentHash,
                },
              ],
              onObservedResponse: (receipt) => {
                observed = receipt;
              },
            });
            if (response.modelVersion !== identity.modelId)
              throw new ImageObservationOutputRejectedError(observed ?? response);
            return { ...response, modelVersion: response.modelVersion };
          } catch (error) {
            if (observed) throw new ImageObservationOutputRejectedError(observed);
            throw error;
          } finally {
            secret.fill(0);
          }
        },
      });
    },
  };
}
