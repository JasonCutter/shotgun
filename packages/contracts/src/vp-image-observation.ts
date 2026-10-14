import type { AIExecutionIdentity } from './ai-candidate-validation.js';
import { ShotgunError } from './errors.js';

export const VP_IMAGE_OBSERVATION_SCHEMA_V1 = 'vp-image-observation/1.0.0' as const;
export type VPImageObservationV1 = {
  readonly schemaVersion: typeof VP_IMAGE_OBSERVATION_SCHEMA_V1;
  readonly observationId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly originalAssetId: string;
  readonly sourceContentHash: string;
  readonly image: {
    readonly mediaType: 'image/png' | 'image/jpeg';
    readonly width: number;
    readonly height: number;
    readonly region: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly unit: 'px';
    };
  };
  readonly text: string;
  readonly epistemicStatus: 'GENERATED_UNVERIFIED';
  readonly derivation: {
    readonly transformationRevisionId: string;
    readonly transformerId: string;
    readonly transformerVersion: string;
    readonly callId: string;
    readonly attemptId: string;
    readonly requestDigest: string;
    readonly inputSnapshotDigest: string;
    readonly responseDigest: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly adapterVersion: string;
    readonly credentialFingerprint: string;
    readonly executionIdentity: AIExecutionIdentity;
    readonly providerResponseId?: string;
    readonly transportRequestDigest?: string;
  };
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly createdAt: string;
};

/** Only an authenticated durable execution reader may attest this binding.
 * Parsing checks structure, not provider honesty or semantic correctness. */
export type VPImageObservationDerivationProofV1 = Omit<
  VPImageObservationV1,
  'schemaVersion' | 'observationId' | 'epistemicStatus' | 'createdAt'
>;

const fail = (reason: string): never => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: `Image observation invalid: ${reason}`,
    module: 'contracts',
    operation: 'parse-vp-image-observation-v1',
    retryable: false,
  });
};
const object = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object required');
  const result = value as Record<string, unknown>;
  if (
    !required.every((key) => Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail('missing or unknown fields');
  return result;
};
const label = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    fail('bounded identity required');
  return value as string;
};
const uuid = (value: unknown): string => {
  const parsed = label(value);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(parsed))
    fail('UUID required');
  return parsed;
};
const digest = (value: unknown): string => {
  const parsed = label(value);
  if (!/^sha256:[a-f0-9]{64}$/u.test(parsed)) fail('SHA-256 required');
  return parsed;
};
const integer = (value: unknown, minimum: number, maximum = 30_000): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
    fail('integer outside bounds');
  return value as number;
};

export function parseVPImageObservationV1(value: unknown): VPImageObservationV1 {
  const row = object(value, [
    'schemaVersion',
    'observationId',
    'projectId',
    'sourceId',
    'sourceVersionId',
    'originalAssetId',
    'sourceContentHash',
    'image',
    'text',
    'epistemicStatus',
    'derivation',
    'accessScope',
    'sensitivity',
    'createdAt',
  ]);
  if (
    row['schemaVersion'] !== VP_IMAGE_OBSERVATION_SCHEMA_V1 ||
    row['epistemicStatus'] !== 'GENERATED_UNVERIFIED'
  )
    fail('unverified observation contract required');
  const image = object(row['image'], ['mediaType', 'width', 'height', 'region']);
  if (!['image/png', 'image/jpeg'].includes(image['mediaType'] as string))
    fail('PNG or JPEG required');
  const width = integer(image['width'], 1),
    height = integer(image['height'], 1);
  if (width * height > 100_000_000) fail('pixel limit exceeded');
  const region = object(image['region'], ['x', 'y', 'width', 'height', 'unit']);
  const x = integer(region['x'], 0),
    y = integer(region['y'], 0),
    regionWidth = integer(region['width'], 1),
    regionHeight = integer(region['height'], 1);
  if (region['unit'] !== 'px' || x + regionWidth > width || y + regionHeight > height)
    fail('region outside original image');
  if (typeof row['text'] !== 'string' || !row['text'].trim() || [...row['text']].length > 128_000)
    fail('bounded generated text required');
  const derivation = object(
    row['derivation'],
    [
      'transformationRevisionId',
      'transformerId',
      'transformerVersion',
      'callId',
      'attemptId',
      'requestDigest',
      'inputSnapshotDigest',
      'responseDigest',
      'providerId',
      'modelId',
      'adapterVersion',
      'credentialFingerprint',
      'executionIdentity',
    ],
    ['providerResponseId', 'transportRequestDigest'],
  );
  const execution = object(derivation['executionIdentity'], [
    'providerId',
    'modelId',
    'aiConfigurationRevision',
    'credentialId',
    'credentialRevision',
    'policyContextRevision',
    'providerPolicyFingerprint',
  ]);
  const providerId = label(derivation['providerId']),
    modelId = label(derivation['modelId']);
  if (execution['providerId'] !== providerId || execution['modelId'] !== modelId)
    fail('execution provider/model mismatch');
  if (
    !Array.isArray(row['accessScope']) ||
    row['accessScope'].length < 1 ||
    row['accessScope'].length > 64
  )
    fail('access scope required');
  const accessScope = (row['accessScope'] as readonly unknown[]).map(label);
  if (new Set(accessScope).size !== accessScope.length) fail('duplicate access scope');
  if (!['public', 'internal', 'private', 'restricted'].includes(row['sensitivity'] as string))
    fail('sensitivity required');
  const createdAt = label(row['createdAt']);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  )
    fail('timestamp required');
  return Object.freeze({
    schemaVersion: VP_IMAGE_OBSERVATION_SCHEMA_V1,
    observationId: uuid(row['observationId']),
    projectId: label(row['projectId']),
    sourceId: uuid(row['sourceId']),
    sourceVersionId: uuid(row['sourceVersionId']),
    originalAssetId: uuid(row['originalAssetId']),
    sourceContentHash: digest(row['sourceContentHash']),
    image: Object.freeze({
      mediaType: image['mediaType'] as VPImageObservationV1['image']['mediaType'],
      width,
      height,
      region: Object.freeze({
        x,
        y,
        width: regionWidth,
        height: regionHeight,
        unit: 'px' as const,
      }),
    }),
    text: row['text'] as string,
    epistemicStatus: 'GENERATED_UNVERIFIED',
    derivation: Object.freeze({
      transformationRevisionId: uuid(derivation['transformationRevisionId']),
      transformerId: label(derivation['transformerId']),
      transformerVersion: label(derivation['transformerVersion']),
      callId: uuid(derivation['callId']),
      attemptId: uuid(derivation['attemptId']),
      requestDigest: digest(derivation['requestDigest']),
      inputSnapshotDigest: digest(derivation['inputSnapshotDigest']),
      responseDigest: digest(derivation['responseDigest']),
      providerId,
      modelId,
      adapterVersion: label(derivation['adapterVersion']),
      credentialFingerprint: digest(derivation['credentialFingerprint']),
      executionIdentity: Object.freeze({
        providerId,
        modelId,
        aiConfigurationRevision: integer(
          execution['aiConfigurationRevision'],
          1,
          Number.MAX_SAFE_INTEGER,
        ),
        credentialId: label(execution['credentialId']),
        credentialRevision: integer(execution['credentialRevision'], 1, Number.MAX_SAFE_INTEGER),
        policyContextRevision: label(execution['policyContextRevision']),
        providerPolicyFingerprint: label(execution['providerPolicyFingerprint']),
      }),
      ...(derivation['providerResponseId'] === undefined
        ? {}
        : { providerResponseId: label(derivation['providerResponseId']) }),
      ...(derivation['transportRequestDigest'] === undefined
        ? {}
        : { transportRequestDigest: digest(derivation['transportRequestDigest']) }),
    }),
    accessScope: Object.freeze(accessScope),
    sensitivity: row['sensitivity'] as VPImageObservationV1['sensitivity'],
    createdAt,
  });
}

export function imageObservationDerivationProof(
  observation: VPImageObservationV1,
): VPImageObservationDerivationProofV1 {
  const { schemaVersion, observationId, epistemicStatus, createdAt, ...proof } =
    parseVPImageObservationV1(observation);
  void schemaVersion;
  void observationId;
  void epistemicStatus;
  void createdAt;
  return Object.freeze(proof);
}
