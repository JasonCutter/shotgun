import type {
  DiscoveryFingerprintLogicalInputV1,
  DiscoveryFingerprintResultV1 as ContractDiscoveryFingerprintResultV1,
} from '../../../packages/contracts/src/index.js';
import {
  computeDiscoveryFingerprint as computeContractDiscoveryFingerprint,
  computeDiscoveryFingerprintV1 as computeContractDiscoveryFingerprintV1,
} from '../../../packages/contracts/src/index.js';

export const DISCOVERY_FINGERPRINT_VERSION_V1 = 'discovery-fingerprint:v1' as const;

export type DiscoveryFingerprintResultV1 = ContractDiscoveryFingerprintResultV1;

/**
 * Computes the versioned exact identity for the caller-supplied logical
 * proposal. WP1 remains authoritative for validation and normalization;
 * semanticStableJson supplies the repository's locale-independent ordering.
 */
export const computeDiscoveryFingerprint = (
  input: DiscoveryFingerprintLogicalInputV1,
): DiscoveryFingerprintResultV1 => {
  return computeContractDiscoveryFingerprint(input);
};

export type DiscoveryFingerprintLogicalInputWithoutVersionV1 = Omit<
  DiscoveryFingerprintLogicalInputV1,
  'fingerprintVersion'
>;

export const computeDiscoveryFingerprintV1 = (
  input: DiscoveryFingerprintLogicalInputWithoutVersionV1,
): DiscoveryFingerprintResultV1 => computeContractDiscoveryFingerprintV1(input);

export * from './active-discovery.js';
export * from './hypothesis-neighborhood.js';
