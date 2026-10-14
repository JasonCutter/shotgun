import { randomUUID } from 'node:crypto';
import { sha256Text } from '../../packages/contracts/src/index.js';
import {
  VP_IMAGE_OBSERVATION_SCHEMA_V1,
  type VPImageObservationV1,
} from '../../packages/contracts/src/vp-image-observation.js';

export function imageObservationFixture(): VPImageObservationV1 {
  return {
    schemaVersion: VP_IMAGE_OBSERVATION_SCHEMA_V1,
    observationId: randomUUID(),
    projectId: `image-${randomUUID()}`,
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    originalAssetId: randomUUID(),
    sourceContentHash: sha256Text('synthetic immutable PNG bytes'),
    image: {
      mediaType: 'image/png',
      width: 320,
      height: 180,
      region: { x: 0, y: 0, width: 320, height: 180, unit: 'px' },
    },
    text: 'A model describes a blue region. 😀',
    epistemicStatus: 'GENERATED_UNVERIFIED',
    derivation: {
      transformationRevisionId: randomUUID(),
      transformerId: 'shotgun.document-formats',
      transformerVersion: '1.15.0',
      callId: randomUUID(),
      attemptId: randomUUID(),
      requestDigest: sha256Text('request'),
      inputSnapshotDigest: sha256Text('snapshot'),
      responseDigest: sha256Text('response'),
      transportRequestDigest: sha256Text('transport'),
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
      adapterVersion: 'isolated-fake-native-v1',
      credentialFingerprint: sha256Text('fake-credential'),
      executionIdentity: {
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
        aiConfigurationRevision: 1,
        credentialId: randomUUID(),
        credentialRevision: 1,
        policyContextRevision: 'isolated-fake-standing-v1',
        providerPolicyFingerprint: sha256Text('fake-policy'),
      },
      providerResponseId: 'fake-provider-response',
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: '2026-10-13T00:00:00.000Z',
  };
}
