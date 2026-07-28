import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  FAILURE_DESCRIPTORS,
  createProductFailureEnvelope,
  decodeProductFailureEnvelope,
  deriveFrontendFailure,
  getFailureDescriptor,
  type ErrorCode,
} from '../../packages/contracts/src/index.js';
import { toProductApiCommandError } from '../../assemblies/shotgun-app/src/product-api/frontend-command-route.js';

describe('ADR-118 typed failure contract', () => {
  it('keeps every registered descriptor structurally complete', () => {
    for (const [code, descriptor] of Object.entries(FAILURE_DESCRIPTORS)) {
      expect(code.length).toBeGreaterThan(0);
      expect(descriptor.httpStatus).toBeGreaterThanOrEqual(400);
      expect(descriptor.httpStatus).toBeLessThan(600);
      expect(descriptor.category.length).toBeGreaterThan(0);
      expect(descriptor.retryability.length).toBeGreaterThan(0);
      expect(descriptor.recovery.length).toBeGreaterThan(0);
    }
  });

  it('does not derive control flow from message wording', () => {
    const first = createProductFailureEnvelope({
      code: 'REVISION_CONFLICT',
      message: 'Revision conflict.',
    });
    const second = createProductFailureEnvelope({
      code: 'REVISION_CONFLICT',
      message: 'The wording changed completely.',
    });

    expect(deriveFrontendFailure(first.code)).toEqual(deriveFrontendFailure(second.code));
    expect(deriveFrontendFailure(first.code)).toMatchObject({
      code: 'REVISION_CONFLICT',
      state: 'STALE',
      recovery: 'REFRESH_AND_REAPPLY',
    });
  });

  it('keeps authorization failures non-retryable and outside HTTP 500', () => {
    const authorizationCodes = Object.entries(FAILURE_DESCRIPTORS)
      .filter(([, descriptor]) => descriptor.category === 'AUTHORIZATION')
      .map(([code]) => code as ErrorCode);

    expect(authorizationCodes.length).toBeGreaterThan(0);
    for (const code of authorizationCodes) {
      const descriptor = getFailureDescriptor(code);
      expect(descriptor.retryability).toBe('NEVER');
      expect(descriptor.httpStatus).toBe(403);
    }
  });

  it('fails closed for an unknown remote code', () => {
    expect(
      decodeProductFailureEnvelope({
        schemaVersion: '1.0.0',
        code: 'FUTURE_UNKNOWN_FAILURE',
        category: 'CONFLICT',
        retryability: 'SAFE',
        recovery: 'RETRY',
        message: 'Do not guess this code.',
      }),
    ).toBeUndefined();
  });

  it('removes details that are not explicitly allowed for the code', () => {
    const envelope = createProductFailureEnvelope({
      code: 'REVISION_CONFLICT',
      message: 'Revision conflict.',
      details: {
        expectedRevision: '7',
        actualRevision: '8',
        password: 'secret',
        sql: 'select * from credentials',
        internalPath: '/srv/private/config',
      },
    });

    expect(envelope.details).toEqual({
      code: 'REVISION_CONFLICT',
      expectedRevision: '7',
      actualRevision: '8',
    });
    expect(JSON.stringify(envelope)).not.toContain('secret');
    expect(JSON.stringify(envelope)).not.toContain('credentials');
    expect(JSON.stringify(envelope)).not.toContain('/srv/private');
  });

  it('normalizes unknown command execution failures to INTERNAL_UNCLASSIFIED', () => {
    const error = toProductApiCommandError(
      new Error('postgres://admin:password@private-host/database'),
      'test-command',
    );
    expect(error.code).toBe('INTERNAL_UNCLASSIFIED');
    expect(error.safeMessage).toBe('Command execution failed.');
  });

  it('rejects an unregistered Ledger rejection code at runtime', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    await expect(
      gateway.reject({
        commandId: 'command-does-not-matter',
        code: 'ARBITRARY_STRING_CODE' as ErrorCode,
        message: 'Unsafe arbitrary code.',
        completedAt: '2026-07-29T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('enforces removal of the known string-based control-flow regressions', async () => {
    const sources = await Promise.all([
      readFile('assemblies/shotgun-app/src/server.ts', 'utf8'),
      readFile('assemblies/shotgun-app/src/product-api/frontend-command-route.ts', 'utf8'),
      readFile('apps/shotgun-web/src/session/settings-draft-controller.ts', 'utf8'),
      readFile('packages/shotgun-api-client/src/errors.ts', 'utf8'),
    ]);
    const combined = sources.join('\n');

    expect(combined).not.toContain('String(error.code)');
    expect(combined).not.toContain("'code' in err");
    expect(combined).not.toContain("'NETWORK_ERROR'");
    expect(combined).not.toContain("'FETCH_FAILED'");
    expect(combined).not.toContain('readonly code: string');
  });
});
