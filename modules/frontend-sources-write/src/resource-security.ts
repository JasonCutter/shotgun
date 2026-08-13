import { ShotgunError, type SourcesSensitivity } from '../../../packages/contracts/src/index.js';

export type SourcesResourceSecurityMetadata = {
  readonly accessScope: readonly string[];
  readonly sensitivity: SourcesSensitivity;
};

export type SourcesResourceSecurityPolicy = {
  readonly allowedClassifications: readonly SourcesSensitivity[];
  readonly resourceAccessScope: readonly string[];
};

export type SourcesResourceSecurityAuthority = {
  readonly principalId: string;
  readonly sensitivityClearance: SourcesSensitivity;
  readonly policy: SourcesResourceSecurityPolicy;
};

const sensitivityRank: Readonly<Record<SourcesSensitivity, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const policyDenied = (message: string): never => {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: message,
    module: 'frontend-sources-write',
    operation: 'resolve-resource-security',
  });
};

const normalizedScope = (scope: readonly string[]): readonly string[] =>
  [...new Set(scope)].sort((left, right) => left.localeCompare(right));

const assertAllowed = (
  authority: SourcesResourceSecurityAuthority,
  sensitivity: SourcesSensitivity,
): void => {
  if (!authority.policy.allowedClassifications.includes(sensitivity)) {
    policyDenied(
      'The requested Source classification is not permitted by the current Project policy.',
    );
  }
  if (sensitivityRank[sensitivity] > sensitivityRank[authority.sensitivityClearance]) {
    policyDenied(
      'The requested Source classification exceeds the current Principal sensitivity clearance.',
    );
  }
};

/**
 * Resolves a Browser classification request into immutable resource metadata.
 * The omitted-request default is deliberately private for backward-compatible,
 * fail-closed intake behavior; it is never copied from Principal clearance.
 */
export const resolveSourcesResourceSecurity = (
  authority: SourcesResourceSecurityAuthority,
  requestedClassification?: SourcesSensitivity,
): SourcesResourceSecurityMetadata => {
  const sensitivity = requestedClassification ?? 'private';
  assertAllowed(authority, sensitivity);
  const accessScope = normalizedScope(authority.policy.resourceAccessScope);
  if (accessScope.length === 0) {
    policyDenied('The current Project policy does not define a Source resource access scope.');
  }
  return { sensitivity, accessScope };
};

/**
 * Retry-current-policy revalidates that a previously pinned security identity
 * is still admissible, without recalculating or changing that identity.
 */
export const assertSourcesResourceSecurityContinuation = (
  authority: SourcesResourceSecurityAuthority,
  pinned: SourcesResourceSecurityMetadata,
): void => {
  assertAllowed(authority, pinned.sensitivity);
  const current = normalizedScope(authority.policy.resourceAccessScope);
  const original = normalizedScope(pinned.accessScope);
  if (
    current.length !== original.length ||
    current.some((value, index) => value !== original[index])
  ) {
    policyDenied(
      'The current Project policy no longer permits the pinned Source resource access scope.',
    );
  }
};

export const sourceSecurityMetadataEqual = (
  left: SourcesResourceSecurityMetadata,
  right: SourcesResourceSecurityMetadata,
): boolean => {
  if (left.sensitivity !== right.sensitivity) return false;
  const leftScope = normalizedScope(left.accessScope);
  const rightScope = normalizedScope(right.accessScope);
  return (
    leftScope.length === rightScope.length &&
    leftScope.every((value, index) => value === rightScope[index])
  );
};
