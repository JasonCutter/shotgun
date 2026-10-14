import { FrontendContractError } from './frontend-foundation.js';
import { sha256Text, stableJson, unicodeLength } from './document-evidence.js';
import { parseVPImageObservationV1, type VPImageObservationV1 } from './vp-image-observation.js';

/** A reference to a generated VP observation; never a literal Evidence quote. */
export type AskGeneratedImageObservationReference = {
  readonly kind: 'GENERATED_IMAGE_OBSERVATION';
  readonly referenceId: string;
  readonly observationId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly originalAssetId: string;
  readonly sourceContentHash: string;
  readonly derivationId: string;
  readonly derivationDigest: string;
  readonly providerExecutionId: string;
  readonly imageMediaType: 'image/png' | 'image/jpeg';
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly region: VPImageObservationV1['image']['region'];
  readonly semanticStatus: 'UNVERIFIED';
  readonly observationText: string;
};

const invalid: (path: string) => never = (path) => {
  throw new FrontendContractError(
    'UNSUPPORTED_SCHEMA',
    `${path} is not a generated image reference.`,
  );
};
const keys = [
  'kind',
  'referenceId',
  'observationId',
  'projectId',
  'sourceId',
  'sourceVersionId',
  'originalAssetId',
  'sourceContentHash',
  'derivationId',
  'derivationDigest',
  'providerExecutionId',
  'imageMediaType',
  'imageWidth',
  'imageHeight',
  'region',
  'semanticStatus',
  'observationText',
] as const;
const object = (value: unknown, fields: readonly string[], path: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  const result = value as Record<string, unknown>;
  if (
    !fields.every((field) => Object.hasOwn(result, field)) ||
    Object.keys(result).some((field) => !fields.includes(field))
  )
    invalid(path);
  return result;
};
const identity = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) invalid(path);
  return value;
};
const hash = (value: unknown, path: string): string => {
  const result = identity(value, path);
  if (!/^sha256:[a-f0-9]{64}$/u.test(result)) invalid(path);
  return result;
};
const integer = (value: unknown, min: number, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > 30_000) invalid(path);
  return value as number;
};

export function decodeAskGeneratedImageObservationReference(
  value: unknown,
  path = 'generatedObservationReference',
): AskGeneratedImageObservationReference {
  const row = object(value, keys, path);
  if (
    row['kind'] !== 'GENERATED_IMAGE_OBSERVATION' ||
    row['semanticStatus'] !== 'UNVERIFIED' ||
    !['image/png', 'image/jpeg'].includes(row['imageMediaType'] as string)
  )
    invalid(path);
  const width = integer(row['imageWidth'], 1, path),
    height = integer(row['imageHeight'], 1, path);
  if (width * height > 100_000_000) invalid(path);
  const region = object(row['region'], ['x', 'y', 'width', 'height', 'unit'], path);
  const x = integer(region['x'], 0, path),
    y = integer(region['y'], 0, path);
  const regionWidth = integer(region['width'], 1, path),
    regionHeight = integer(region['height'], 1, path);
  if (region['unit'] !== 'px' || x + regionWidth > width || y + regionHeight > height)
    invalid(path);
  if (
    typeof row['observationText'] !== 'string' ||
    !row['observationText'].trim() ||
    unicodeLength(row['observationText']) > 128_000
  )
    invalid(path);
  return Object.freeze({
    kind: 'GENERATED_IMAGE_OBSERVATION',
    referenceId: identity(row['referenceId'], path),
    observationId: identity(row['observationId'], path),
    projectId: identity(row['projectId'], path),
    sourceId: identity(row['sourceId'], path),
    sourceVersionId: identity(row['sourceVersionId'], path),
    originalAssetId: identity(row['originalAssetId'], path),
    sourceContentHash: hash(row['sourceContentHash'], path),
    derivationId: identity(row['derivationId'], path),
    derivationDigest: hash(row['derivationDigest'], path),
    providerExecutionId: identity(row['providerExecutionId'], path),
    imageMediaType: row['imageMediaType'] as 'image/png' | 'image/jpeg',
    imageWidth: width,
    imageHeight: height,
    region: Object.freeze({ x, y, width: regionWidth, height: regionHeight, unit: 'px' }),
    semanticStatus: 'UNVERIFIED',
    observationText: row['observationText'],
  });
}

/** Caller must separately verify current access and the VP execution proof. */
export function askGeneratedImageObservationReferenceFor(
  value: VPImageObservationV1,
  referenceId: string,
): AskGeneratedImageObservationReference {
  const observation = parseVPImageObservationV1(value);
  return decodeAskGeneratedImageObservationReference({
    kind: 'GENERATED_IMAGE_OBSERVATION',
    referenceId,
    observationId: observation.observationId,
    projectId: observation.projectId,
    sourceId: observation.sourceId,
    sourceVersionId: observation.sourceVersionId,
    originalAssetId: observation.originalAssetId,
    sourceContentHash: observation.sourceContentHash,
    derivationId: observation.derivation.transformationRevisionId,
    derivationDigest: sha256Text(stableJson(observation.derivation)),
    providerExecutionId: observation.derivation.callId,
    imageMediaType: observation.image.mediaType,
    imageWidth: observation.image.width,
    imageHeight: observation.image.height,
    region: observation.image.region,
    semanticStatus: 'UNVERIFIED',
    observationText: observation.text,
  });
}
