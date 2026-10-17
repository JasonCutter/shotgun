import { describe, expect, it, vi } from 'vitest';

import { IsolatedFakeExplicitNegativeProvider } from '../../assemblies/shotgun-app/src/isolated-negative-fake-provider.js';
import { IsolatedExplicitNegativeAdapter } from '../../adapters/vp-decision-general-ai/src/explicit-negative-isolated.js';
import {
  validDurableExplicitNegativeOutput,
  validProductExplicitNegativeOutput,
  DurableIsolatedExplicitNegativeRouter,
} from '../../adapters/vp-decision-general-ai/src/explicit-negative-durable-isolated.js';
import {
  EXPLICIT_NEGATIVE_CHOICES,
  EXPLICIT_NEGATIVE_PRODUCT_FAKE_CONTRACT,
  isProductExplicitNegativeRevision,
  type DurableExplicitNegativeOutput,
} from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import type { VPRelationDecisionRequest } from '../../modules/vp-decision/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';

const revision = 'vp-relation-v6-explicit-negative-product-fake-v1:r1';
const input = (): VPRelationDecisionRequest => ({
  projectId: 'synthetic-project',
  policyRevision: revision,
  left: {
    assertionId: 'a',
    sourceVersionId: 'av',
    evidenceId: 'ae',
    text: 'Synthetic printer.',
    accessScope: ['owner'],
    sensitivity: 'public',
  },
  right: {
    assertionId: 'b',
    sourceVersionId: 'bv',
    evidenceId: 'be',
    text: 'Synthetic lake.',
    accessScope: ['owner'],
    sensitivity: 'public',
  },
  allowedAccessScope: ['owner'],
  authorizedSensitivities: ['public'],
  externalEgressAllowed: true,
});
const declaration = () => ({
  choice: 'NO_RELATION',
  direction: 'NONE',
  confidence: 0.6,
  probabilities: Object.fromEntries(
    EXPLICIT_NEGATIVE_CHOICES.map((choice) => [choice, choice === 'NO_RELATION' ? 1 : 0]),
  ),
});

describe('scoped product Fake explicit-negative output', () => {
  it('accepts only fresh, closed product revisions', () => {
    for (const valid of [revision, 'vp-relation-v6-explicit-negative-product-fake-v1:r999999999'])
      expect(isProductExplicitNegativeRevision(valid)).toBe(true);
    for (const invalid of [
      'vp-relation-v6-explicit-negative-isolated-v1',
      'vp-relation-v6-explicit-negative-product-fake-v1:r0',
      'vp-relation-v6-explicit-negative-product-fake-v1:r01',
      'vp-relation-v6-explicit-negative-product-fake-v1:r1000000000',
      'vp-relation-v6-explicit-negative-product-fake-v1:r1-extra',
    ])
      expect(isProductExplicitNegativeRevision(invalid)).toBe(false);
  });

  it('keeps old output codec exact and binds product input, record, and contract', async () => {
    const provider = new IsolatedFakeExplicitNegativeProvider('isolated-fake-test-account');
    provider.enqueue({ rawText: JSON.stringify(declaration()), inputTokens: 12, outputTokens: 10 });
    const record = await new IsolatedExplicitNegativeAdapter(provider, {
      mode: 'PRODUCT_FAKE',
      revision,
    }).compareIsolated(input(), 'ISOLATED_FAKE');
    const output: DurableExplicitNegativeOutput = {
      contract: EXPLICIT_NEGATIVE_PRODUCT_FAKE_CONTRACT,
      input: input(),
      record,
    };
    expect(record.disposition.status).toBe('NO_RELATION');
    expect(validProductExplicitNegativeOutput(output, revision)).toBe(true);
    expect(validDurableExplicitNegativeOutput(output)).toBe(false);
    expect(
      validProductExplicitNegativeOutput(
        { ...output, contract: 'vp-explicit-negative-durable-fake-v1' },
        revision,
      ),
    ).toBe(false);
    expect(
      validProductExplicitNegativeOutput(
        { ...output, input: { ...input(), policyRevision: revision.replace('r1', 'r2') } },
        revision,
      ),
    ).toBe(false);
    expect(
      validProductExplicitNegativeOutput(
        { ...output, record: { ...record, requestDigest: 'sha256:deadbeef' } },
        revision,
      ),
    ).toBe(false);
    expect(provider.calls()).toBe(1);
  });

  it('rejects missing opt-in and a live identity before claim or provider call', async () => {
    const provider = new IsolatedFakeExplicitNegativeProvider('isolated-fake-test-account');
    provider.enqueue({ rawText: JSON.stringify(declaration()), inputTokens: 12, outputTokens: 10 });
    await expect(
      new IsolatedExplicitNegativeAdapter(provider).compareIsolated(input(), 'ISOLATED_FAKE'),
    ).rejects.toThrow('revision mismatch');
    const claim = vi.fn(async () => ({ status: 'STARTED' as const }));
    const resolve = vi.fn(async () => ({
      adapter: {
        identity: { ...provider.identity, provider: 'deepseek' },
        generateStructured: (request: Parameters<typeof provider.generateStructured>[0]) =>
          provider.generateStructured(request),
      },
      executionIdentity: {
        providerId: 'deepseek',
        modelId: provider.identity.model,
        aiConfigurationRevision: 1,
        credentialId: 'synthetic',
        credentialRevision: 1,
        policyContextRevision: 'synthetic',
        providerPolicyFingerprint: 'synthetic',
      },
    }));
    const router = new DurableIsolatedExplicitNegativeRouter(
      { resolve } as AIProviderExecutionResolverPort,
      {
        readStoredByJob: async () => undefined,
        claim,
        storeOutput: async ({ decision }) => decision,
        markOutcomeUnknown: async () => {},
      },
      { mode: 'PRODUCT_FAKE', revision },
    );
    await expect(
      router.resolve({ ...input(), execution: { jobId: 'j', leaseToken: 'l' } }),
    ).rejects.toThrow('isolated Fake');
    expect(claim).not.toHaveBeenCalled();
    expect(provider.calls()).toBe(0);
    expect(
      () =>
        new DurableIsolatedExplicitNegativeRouter(
          { resolve },
          {
            claim,
            storeOutput: async ({ decision }) => decision,
            markOutcomeUnknown: async () => {},
          },
          { mode: 'PRODUCT_FAKE', revision: 'invalid' },
        ),
    ).toThrow('Invalid explicit-negative product Fake profile');
  });
});
