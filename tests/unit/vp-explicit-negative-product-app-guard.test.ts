import { describe, expect, it } from 'vitest';

import {
  startShotgunApplication,
  type StartShotgunApplicationOptions,
} from '../../assemblies/shotgun-app/src/application.js';
import { IsolatedFakeExplicitNegativeProvider } from '../../assemblies/shotgun-app/src/isolated-negative-fake-provider.js';

const fakeProvider = new IsolatedFakeExplicitNegativeProvider('isolated-fake-app-guard');
const profile = (): NonNullable<StartShotgunApplicationOptions['isolatedRelationPolicy']> => ({
  mode: 'ISOLATED_FAKE',
  revision: 'vp-relation-v6-explicit-negative-product-fake-v1:r1',
  expectedPreviousRevision: null,
  projectId: 'shotgun',
  fakeProvider,
  accountFingerprint: fakeProvider.accountFingerprint,
  executionIdentity: {
    providerId: fakeProvider.identity.provider,
    modelId: fakeProvider.identity.model,
    aiConfigurationRevision: 1,
    credentialId: fakeProvider.accountId,
    credentialRevision: 1,
    policyContextRevision: 'isolated-fake-product-v1',
    providerPolicyFingerprint: `sha256:${fakeProvider.accountFingerprint}`,
  },
});
const options = (): StartShotgunApplicationOptions => ({
  environmentProfile: 'runtime-test',
  databaseUrl: 'postgres://localhost/shotgun_test_iso_product_fake',
  stagingSecret: 'synthetic-staging-secret-for-test-only',
  environment: {
    VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: 'postgres://localhost/shotgun_test_iso_authority',
    SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID: 'synthetic-owner',
  },
  isolatedRelationPolicy: profile(),
});

describe('product explicit-negative application preflight', () => {
  it.each([
    ['live profile', { environmentProfile: 'runtime-production' }],
    ['ordinary database', { databaseUrl: 'postgres://localhost/shotgun' }],
    [
      'same authority database',
      {
        environment: {
          VP_GLOBAL_RELATION_BUDGET_DATABASE_URL:
            'postgres://localhost/shotgun_test_iso_product_fake',
        },
      },
    ],
    ['missing mode', { isolatedRelationPolicy: { ...profile(), mode: undefined } }],
    [
      'wrong provider identity',
      {
        isolatedRelationPolicy: {
          ...profile(),
          executionIdentity: { ...profile().executionIdentity, providerId: 'deepseek' },
        },
      },
    ],
    [
      'credential mismatch',
      {
        isolatedRelationPolicy: {
          ...profile(),
          executionIdentity: { ...profile().executionIdentity, credentialId: 'other' },
        },
      },
    ],
  ] as const)('rejects %s before opening a database', async (_name, change) => {
    await expect(
      startShotgunApplication({ ...options(), ...change } as StartShotgunApplicationOptions),
    ).rejects.toThrow('Product explicit-negative requires isolated runtime-test Fake identity');
  });
});
