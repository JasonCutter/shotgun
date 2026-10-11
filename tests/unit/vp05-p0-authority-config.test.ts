import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  globalRelationBudgetFromEnvironment,
  relationCredentialFingerprint,
} from '../../adapters/vp-global-provider-budget-postgres/src/config.js';

describe('P0 authority configuration, without connecting or provisioning', () => {
  const workload = 'postgres://fake:fake@localhost:5433/workload';
  const configured = {
    VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: 'postgres://fake:fake@localhost:5433/authority',
    VP_GLOBAL_RELATION_BUDGET_STORE_ID: randomUUID(),
    VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID: randomUUID(),
  };
  it('computes the fingerprint from exact credential bytes', () => {
    const secret = Buffer.from('synthetic-key');
    expect(relationCredentialFingerprint(secret)).toBe(
      createHash('sha256').update(secret).digest('hex'),
    );
    expect(relationCredentialFingerprint(secret)).not.toBe(
      relationCredentialFingerprint('different-key'),
    );
  });
  it.each([
    {},
    { ...configured, VP_GLOBAL_RELATION_BUDGET_STORE_ID: '' },
    { ...configured, VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID: 'invalid' },
    {
      ...configured,
      VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: 'postgres://fake:fake@127.0.0.1:5433/workload',
    },
    { ...configured, VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: 'https://authority/' },
    {
      ...configured,
      VP_GLOBAL_RELATION_BUDGET_DATABASE_URL:
        'postgres://fake:fake@example.test:5433/workload?host=localhost',
    },
    {
      ...configured,
      VP_GLOBAL_RELATION_BUDGET_DATABASE_URL:
        'postgres://fake:fake@localhost:5555/workload?port=5433',
    },
    {
      ...configured,
      VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: 'postgres://fake:fake@localhost:5433/%77orkload',
    },
  ])('rejects missing, malformed, or workload-local authority configuration', (env) => {
    expect(() => globalRelationBudgetFromEnvironment(workload, 'a'.repeat(64), env)).toThrow(
      'IDENTITY_UNVERIFIED',
    );
  });
  it('rejects an unverified fingerprint before opening a pool', () => {
    expect(() => globalRelationBudgetFromEnvironment(workload, '', configured)).toThrow(
      'IDENTITY_UNVERIFIED',
    );
  });
});
