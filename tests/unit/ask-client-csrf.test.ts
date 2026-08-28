import { describe, expect, it, vi } from 'vitest';

import { createAskWorkspaceClient } from '../../packages/shotgun-api-client/src/index.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const eligibility = {
  schemaVersion: '1.0.0',
  eligible: true,
  reason: 'ELIGIBLE',
  requiredAction: 'NONE',
  policyFingerprint: 'policy:test',
  policyContextRevision: '1',
  provider: { displayName: 'Test Provider', model: 'test-model' },
  message: 'Eligible.',
};

const request = {
  schemaVersion: '1.0.0' as const,
  mode: 'CANONICAL_ONLY' as const,
  sourceSelections: [],
};

describe('Ask client typed CSRF recovery', () => {
  it('recovers once from REQUEST_ORIGIN_DENIED', async () => {
    let csrfIssued = 0;
    let posted = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: `csrf-${++csrfIssued}` });
      }
      posted += 1;
      return posted === 1
        ? json({ code: 'REQUEST_ORIGIN_DENIED', message: 'The Product request was denied.' }, 403)
        : json({ providerEligibility: eligibility });
    });

    await expect(
      createAskWorkspaceClient({ fetch }).getProviderEligibility(request),
    ).resolves.toEqual(eligibility);
    expect(csrfIssued).toBe(2);
    expect(posted).toBe(2);
  });

  it('does not retry PROJECT_ACCESS_DENIED', async () => {
    let csrfIssued = 0;
    let posted = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: `csrf-${++csrfIssued}` });
      }
      posted += 1;
      return json({ code: 'PROJECT_ACCESS_DENIED', message: 'The Project is inaccessible.' }, 403);
    });

    await expect(
      createAskWorkspaceClient({ fetch }).getProviderEligibility(request),
    ).rejects.toMatchObject({ code: 'PROJECT_ACCESS_DENIED', status: 403 });
    expect(csrfIssued).toBe(1);
    expect(posted).toBe(1);
  });

  it('surfaces a repeated REQUEST_ORIGIN_DENIED after one retry', async () => {
    let csrfIssued = 0;
    let posted = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: `csrf-${++csrfIssued}` });
      }
      posted += 1;
      return json(
        { code: 'REQUEST_ORIGIN_DENIED', message: 'The Product request was denied.' },
        403,
      );
    });

    await expect(
      createAskWorkspaceClient({ fetch }).getProviderEligibility(request),
    ).rejects.toMatchObject({ code: 'REQUEST_ORIGIN_DENIED', status: 403 });
    expect(csrfIssued).toBe(2);
    expect(posted).toBe(2);
  });
});
