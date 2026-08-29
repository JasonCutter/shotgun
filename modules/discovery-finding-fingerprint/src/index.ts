import {
  normalizeDiscoveryFingerprintInputV1,
  semanticStableJson,
  sha256Text,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryFingerprintLogicalInputV1,
  DiscoveryNormalizedFingerprintInputV1,
} from '../../../packages/contracts/src/index.js';

export const DISCOVERY_FINGERPRINT_VERSION_V1 = 'discovery-fingerprint:v1' as const;

export type DiscoveryFingerprintResultV1 = {
  readonly fingerprintVersion: string;
  readonly fingerprint: string;
  readonly normalizedInput: DiscoveryNormalizedFingerprintInputV1;
};

/**
 * Computes the versioned exact identity for the caller-supplied logical
 * proposal. WP1 remains authoritative for validation and normalization;
 * semanticStableJson supplies the repository's locale-independent ordering.
 */
export const computeDiscoveryFingerprint = (
  input: DiscoveryFingerprintLogicalInputV1,
): DiscoveryFingerprintResultV1 => {
  const normalizedInput = normalizeDiscoveryFingerprintInputV1(input);
  return {
    fingerprintVersion: normalizedInput.fingerprintVersion,
    fingerprint: sha256Text(semanticStableJson(normalizedInput)),
    normalizedInput,
  };
};

export type DiscoveryFingerprintLogicalInputWithoutVersionV1 = Omit<
  DiscoveryFingerprintLogicalInputV1,
  'fingerprintVersion'
>;

export const computeDiscoveryFingerprintV1 = (
  input: DiscoveryFingerprintLogicalInputWithoutVersionV1,
): DiscoveryFingerprintResultV1 =>
  computeDiscoveryFingerprint({
    ...input,
    fingerprintVersion: DISCOVERY_FINGERPRINT_VERSION_V1,
  });

export * from './active-discovery.js';
export * from './hypothesis-neighborhood.js';
