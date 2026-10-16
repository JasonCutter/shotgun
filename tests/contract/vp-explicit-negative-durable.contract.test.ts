import { describe, expect, it, vi } from 'vitest';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import type {
  VPDecisionExecutionRepositoryPort,
  VPRelationDecisionRequest,
} from '../../modules/vp-decision/src/index.js';
import {
  EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  type DurableExplicitNegativeOutput,
} from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import { DurableIsolatedExplicitNegativeRouter } from '../../adapters/vp-decision-general-ai/src/explicit-negative-durable-isolated.js';
import { PostgresIsolatedExplicitNegativeJobs } from '../../adapters/vp-knowledge-postgres/src/explicit-negative-isolated.js';
import type { Pool } from 'pg';

const input = (): VPRelationDecisionRequest => ({
  projectId: 'synthetic',
  policyRevision: EXPLICIT_NEGATIVE_ISOLATED_REVISION,
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
  execution: { jobId: 'job', leaseToken: 'lease' },
});
function fixture() {
  const generateStructured = vi.fn(async () => {
    throw new Error('not called');
  });
  const resolve = vi.fn(async () => ({
    adapter: {
      identity: {
        provider: 'deepseek',
        model: 'fake',
        adapterVersion: '1',
        dataPolicyVersion: 'test',
      },
      generateStructured,
    },
    executionIdentity: {
      providerId: 'deepseek',
      modelId: 'fake',
      aiConfigurationRevision: 1,
      credentialId: 'synthetic',
      credentialRevision: 1,
      policyContextRevision: 'synthetic',
      providerPolicyFingerprint: 'synthetic',
    },
  }));
  const executions: VPDecisionExecutionRepositoryPort<DurableExplicitNegativeOutput> = {
    readStoredByJob: vi.fn(async () => undefined),
    claim: vi.fn(async () => ({ status: 'STARTED' as const })),
    storeOutput: vi.fn(async (x) => x.decision),
    markOutcomeUnknown: vi.fn(async () => {}),
  };
  const resolver: AIProviderExecutionResolverPort = { resolve };
  return {
    router: new DurableIsolatedExplicitNegativeRouter(resolver, executions),
    executions,
    resolve,
    generateStructured,
  };
}
describe('durable isolated opt-in contract', () => {
  it.each(['OLD_REVISION', 'NO_EXECUTION', 'EGRESS_DENIED', 'SCOPE_DENIED', 'RESTRICTED'] as const)(
    'rejects %s before resolution or activation',
    async (reason) => {
      const f = fixture();
      const request = input();
      const changed =
        reason === 'OLD_REVISION'
          ? { ...request, policyRevision: 'vp-deepseek-relation-v6-evidence-context' }
          : reason === 'NO_EXECUTION'
            ? { ...request, execution: undefined }
            : reason === 'EGRESS_DENIED'
              ? { ...request, externalEgressAllowed: false }
              : reason === 'SCOPE_DENIED'
                ? { ...request, right: { ...request.right, accessScope: ['another-project'] } }
                : { ...request, right: { ...request.right, sensitivity: 'restricted' as const } };
      await expect(f.router.resolve(changed)).rejects.toThrow();
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.executions.claim).not.toHaveBeenCalled();
      expect(f.generateStructured).not.toHaveBeenCalled();
    },
  );
  it('rejects a live provider identity before any claim or call', async () => {
    const f = fixture();
    await expect(f.router.resolve(input())).rejects.toThrow('isolated Fake');
    expect(f.executions.claim).not.toHaveBeenCalled();
    expect(f.generateStructured).not.toHaveBeenCalled();
  });
  it.each(['shotgun', 'shotgun_test', 'shotgun_production'])(
    'refuses non-isolated database %s without querying it',
    (database) => {
      const query = vi.fn();
      const pool = { options: { database }, query } as unknown as Pool;
      expect(
        () =>
          new PostgresIsolatedExplicitNegativeJobs(pool, 'ISOLATED_FAKE', () => true, 'synthetic'),
      ).toThrow('isolated child');
      expect(query).not.toHaveBeenCalled();
    },
  );
});
