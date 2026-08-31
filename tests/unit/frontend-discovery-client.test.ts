import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  createProductFailureEnvelope,
} from '../../packages/contracts/src/index.js';
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

  const detail = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1.0.0',
    findingId: 'finding-1',
    findingRevision: 1,
    projectId: 'project-1',
    findingType: 'KNOWLEDGE_GAP',
    authority: 'DERIVED_INFERENCE',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    title: 'A finding',
    summary: 'A summary',
    rationale: 'A rationale',
    derivationSummary: 'A derivation',
    safeSignals: {},
    governance: {
      schemaVersion: '1.0.0',
      reentryState: 'NOT_REQUESTED',
      validationState: 'NOT_STARTED',
      reviewReadiness: 'NOT_ELIGIBLE',
    },
    freshness: {
      schemaVersion: '1.0.0',
      state: 'UNKNOWN',
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 1,
        snapshotDigest: 'sha256:canonical',
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-1',
        projectionDigest: 'sha256:discovery',
      },
    },
    runId: 'run-1',
    capabilities: {
      schemaVersion: '1.0.0',
      canOpenReview: false,
      canInspectEvidence: false,
      canOpenGraph: false,
      canOpenActivity: false,
      canInvestigate: false,
    },
    createdAt: '2026-08-31T00:00:00.000Z',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'Milo',
      missingFact: 'weight',
      question: 'What is the weight?',
    },
    lineage: {
      schemaVersion: '1.0.0',
      relatedResourceRefs: [],
      evidence: [],
      sourceProjectionDigest: 'sha256:projection',
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 1,
        snapshotDigest: 'sha256:canonical',
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-1',
        projectionDigest: 'sha256:discovery',
      },
      provenance: { schemaVersion: '1.0.0', kind: 'DETERMINISTIC' },
    },
    ...overrides,
  });

  it('rejects exact finding identity and project mismatches from the server', async () => {
    const mismatchedIdentityFetch = async (input: string | URL | Request): Promise<Response> =>
      String(input) === '/api/v1/security/csrf'
        ? Response.json({ csrfToken: 'csrf-identity' })
        : Response.json({
            result: {
              schemaVersion: '1.0.0',
              projectId: 'project-1',
              accessRevision: 'access-1',
              policyContextRevision: 'policy-1',
              finding: detail({ findingId: 'other-finding' }),
            },
          });
    await expect(
      createFrontendDiscoveryClient({ fetch: mismatchedIdentityFetch }).readDiscoveryFinding({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        findingRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    const mismatchedProjectFetch = async (input: string | URL | Request): Promise<Response> =>
      String(input) === '/api/v1/security/csrf'
        ? Response.json({ csrfToken: 'csrf-project' })
        : Response.json({
            result: {
              schemaVersion: '1.0.0',
              projectId: 'project-2',
              accessRevision: 'access-1',
              policyContextRevision: 'policy-1',
              finding: detail(),
            },
          });
    await expect(
      createFrontendDiscoveryClient({ fetch: mismatchedProjectFetch }).readDiscoveryFinding({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        findingRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('translates a strict Product failure envelope', async () => {
    const fetch = async (input: string | URL | Request): Promise<Response> =>
      String(input) === '/api/v1/security/csrf'
        ? Response.json({ csrfToken: 'csrf-failure' })
        : Response.json(
            createProductFailureEnvelope({
              code: 'NOT_FOUND',
              message: 'The requested Discovery finding was not found.',
            }),
            { status: 404 },
          );
    await expect(
      createFrontendDiscoveryClient({ fetch }).readDiscoveryFinding({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        findingRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
