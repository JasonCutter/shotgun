import { describe, expect, it } from 'vitest';

import { FrontendContractError } from '../../packages/contracts/src/index.js';
import { createFrontendDiscoveryClient } from '../../packages/shotgun-api-client/src/index.js';

describe('AKP-6 WP1 typed Discovery client', () => {
  it('uses same-origin credentials, CSRF, and forwards AbortSignal', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ input: String(input), init });
      if (String(input) === '/api/v1/security/csrf') {
        return Response.json({ csrfToken: 'csrf-1' });
      }
      return Response.json({
        result: {
          schemaVersion: '1.0.0',
          projectId: 'project-1',
          accessRevision: 'project-1:owner',
          policyContextRevision: '7',
          findings: [],
        },
      });
    };
    const controller = new AbortController();
    const result = await createFrontendDiscoveryClient({ fetch }).listDiscoveryFindings(
      { schemaVersion: '1.0.0', limit: 10 },
      { signal: controller.signal },
    );
    expect(result.findings).toEqual([]);
    expect(calls[1]?.init?.credentials).toBe('same-origin');
    expect(calls[1]?.init?.signal).toBe(controller.signal);
    expect((calls[1]?.init?.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
  });

  it('strictly rejects malformed Product responses', async () => {
    const fetch = async (input: string | URL | Request): Promise<Response> =>
      String(input) === '/api/v1/security/csrf'
        ? Response.json({ csrfToken: 'csrf-2' })
        : Response.json({
            result: { schemaVersion: '1.0.0', projectId: 'project-1', findings: [] },
          });
    await expect(
      createFrontendDiscoveryClient({ fetch }).listDiscoveryFindings({ schemaVersion: '1.0.0' }),
    ).rejects.toBeInstanceOf(FrontendContractError);
  });
});
