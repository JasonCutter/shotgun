import { describe, expect, it } from 'vitest';

import {
  computeDiscoveryFingerprint,
  computeDiscoveryFingerprintV1,
  DISCOVERY_FINGERPRINT_VERSION_V1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import type { DiscoveryFingerprintLogicalInputV1 } from '../../packages/contracts/src/index.js';

const ref = (
  resourceId: string,
  resourceKind: 'CANONICAL_CLAIM' | 'CANONICAL_ENTITY' = 'CANONICAL_CLAIM',
) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind,
  resourceId,
  projectId: 'project-fingerprint',
  resourceState: 'CURRENT' as const,
  resourceRevision: '4',
});

const input = (
  overrides: Partial<DiscoveryFingerprintLogicalInputV1> = {},
): DiscoveryFingerprintLogicalInputV1 => ({
  findingType: 'RELATION_HYPOTHESIS',
  relatedResourceRefs: [ref('zeta'), ref('alpha', 'CANONICAL_ENTITY')],
  semanticEssence: 'alpha depends on zeta',
  fingerprintVersion: DISCOVERY_FINGERPRINT_VERSION_V1,
  ...overrides,
});

describe('AKP-2 WP3 Discovery fingerprint V1', () => {
  it('uses the explicit version and repository SHA-256 representation', () => {
    const result = computeDiscoveryFingerprintV1({
      findingType: input().findingType,
      relatedResourceRefs: input().relatedResourceRefs,
      semanticEssence: input().semanticEssence,
    });
    expect(result.fingerprintVersion).toBe(DISCOVERY_FINGERPRINT_VERSION_V1);
    expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('returns the same fingerprint for repeated same-input calls', () => {
    expect(computeDiscoveryFingerprint(input()).fingerprint).toBe(
      computeDiscoveryFingerprint(input()).fingerprint,
    );
  });

  it('changes identity for finding type, semantic essence, and algorithm version changes', () => {
    const baseline = computeDiscoveryFingerprint(input()).fingerprint;
    expect(
      computeDiscoveryFingerprint(input({ findingType: 'KNOWLEDGE_GAP' })).fingerprint,
    ).not.toBe(baseline);
    expect(
      computeDiscoveryFingerprint(input({ semanticEssence: 'alpha is unrelated to zeta' }))
        .fingerprint,
    ).not.toBe(baseline);
    expect(
      computeDiscoveryFingerprint(input({ fingerprintVersion: 'discovery-fingerprint:v2' }))
        .fingerprint,
    ).not.toBe(baseline);
  });

  it('uses WP1 normalized resource ordering and remains locale-independent for Unicode', () => {
    const resources = [ref('가'), ref('😀'), ref('Å'), ref('Z')];
    const first = computeDiscoveryFingerprintV1({
      findingType: 'KNOWLEDGE_GAP',
      relatedResourceRefs: resources,
      semanticEssence: 'Unicode identity',
    });
    const second = computeDiscoveryFingerprintV1({
      findingType: 'KNOWLEDGE_GAP',
      relatedResourceRefs: [...resources].reverse(),
      semanticEssence: 'Unicode identity',
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.normalizedInput.relatedResourceRefs.map((entry) => entry.resourceId)).toEqual([
      'Z',
      'Å',
      '가',
      '😀',
    ]);
  });

  it('does not accept execution-only metadata as logical identity', () => {
    const logical = input();
    const variants = [
      { runId: 'run-a', createdAt: '2026-01-01T00:00:00.000Z' },
      { runId: 'run-b', createdAt: '2027-01-01T00:00:00.000Z' },
    ];
    expect(variants.map(() => computeDiscoveryFingerprint(logical).fingerprint)).toEqual([
      computeDiscoveryFingerprint(logical).fingerprint,
      computeDiscoveryFingerprint(logical).fingerprint,
    ]);
    expect(
      'rationale, derivation summary, provider/model, and provenance are not part of logical input',
    ).toBeTruthy();
  });
});
