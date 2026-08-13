import { describe, expect, it } from 'vitest';

import {
  assertSourcesResourceSecurityContinuation,
  resolveSourcesResourceSecurity,
} from '../../modules/frontend-sources-write/src/index.js';

const authority = {
  principalId: 'principal-1',
  sensitivityClearance: 'private' as const,
  policy: {
    allowedClassifications: ['public', 'internal', 'private'] as const,
    resourceAccessScope: ['owner'] as const,
  },
};

describe('Sources resource security authority', () => {
  it('resolves an explicit public Source classification below private clearance without copying clearance', () => {
    expect(resolveSourcesResourceSecurity(authority, 'public')).toEqual({
      sensitivity: 'public',
      accessScope: ['owner'],
    });
    expect(authority.sensitivityClearance).toBe('private');
  });

  it('uses a fail-closed private default when the Browser omits a classification request', () => {
    expect(resolveSourcesResourceSecurity(authority)).toEqual({
      sensitivity: 'private',
      accessScope: ['owner'],
    });
  });

  it('rejects restricted and above-clearance classifications with POLICY_DENIED', () => {
    expect(() => resolveSourcesResourceSecurity(authority, 'restricted')).toThrow(/not permitted/);
    expect(() =>
      resolveSourcesResourceSecurity(
        {
          ...authority,
          sensitivityClearance: 'internal',
        },
        'private',
      ),
    ).toThrow(/exceeds/);
  });

  it('revalidates pinned metadata without changing it for RETRY_CURRENT_POLICY', () => {
    const pinned = resolveSourcesResourceSecurity(authority, 'public');
    expect(() => assertSourcesResourceSecurityContinuation(authority, pinned)).not.toThrow();
    expect(() =>
      assertSourcesResourceSecurityContinuation(
        {
          ...authority,
          policy: {
            allowedClassifications: ['private'] as const,
            resourceAccessScope: ['owner'] as const,
          },
        },
        pinned,
      ),
    ).toThrow(/not permitted/);
  });
});
