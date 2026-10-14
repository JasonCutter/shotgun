import { createHash, randomUUID } from 'node:crypto';
import {
  DeepSeekConnectivityAdapter,
  type DeepSeekImageGenerationResponse,
} from '../../adapters/ai-provider-deepseek/src/index.js';
import { sha256Text } from '../../packages/contracts/src/index.js';
import type {
  CapturedImageExecutor,
  ImageObservationExecutionInput,
} from '../../modules/image-observation-execution/src/index.js';

export const imageExecutionFixtureInput = (): ImageObservationExecutionInput => {
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cL1sAAAAASUVORK5CYII=',
    'base64',
  );
  return {
    projectId: 'isolated-image-project',
    requestId: randomUUID(),
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    originalAssetId: randomUUID(),
    sourceContentHash: `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`,
    transformerId: 'python-document-format',
    transformerVersion: '1.15.0',
    image: {
      mediaType: 'image/png',
      width: 1,
      height: 1,
      region: { x: 0, y: 0, width: 1, height: 1, unit: 'px' },
    },
    accessScope: ['project:isolated-image-project'],
    sensitivity: 'internal',
    imageBytes,
  };
};

export function fakeNativeImageExecutor(
  onEgress: (init: RequestInit) => Promise<void> = async () => {},
  rawText = '{"observationText":"Authored Fake pixel observation; meaning unverified."}',
): CapturedImageExecutor {
  const adapter = new DeepSeekConnectivityAdapter({
    fetch: async (_url, init) => {
      await onEgress(init!);
      return new Response(
        JSON.stringify({
          id: 'isolated-fake-image-response',
          model: 'deepseek-flash',
          choices: [
            {
              message: {
                content: rawText,
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  return {
    transportKind: 'ISOLATED_FAKE',
    liveCapable: false,
    identity: {
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
      aiConfigurationRevision: 1,
      credentialId: 'synthetic-image-only',
      credentialRevision: 1,
      policyContextRevision: 'synthetic-fake-only',
      providerPolicyFingerprint: sha256Text('synthetic-image-policy'),
    },
    credentialFingerprint: sha256Text('SYNTHETIC-IMAGE-KEY-NOT-LIVE'),
    adapterVersion: adapter.adapterVersion,
    generateImage: async (
      input,
    ): Promise<DeepSeekImageGenerationResponse & { modelVersion: string }> => {
      const result = await adapter.generateImageStructured({
        apiKey: new TextEncoder().encode('SYNTHETIC-IMAGE-KEY-NOT-LIVE'),
        modelId: 'deepseek-flash',
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
      });
      if (!result.modelVersion)
        throw Error('Fake native image response must retain model identity');
      return { ...result, modelVersion: result.modelVersion };
    },
  };
}
