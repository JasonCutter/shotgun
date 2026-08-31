import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  FRONTEND_DISCOVERY_COMMAND_TYPES,
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
      canDismiss: false,
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

  it('posts a governed dismiss command and resolves its command outcome by client request', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const clientRequestId = 'dismiss-client-1';
    const idempotencyKey = 'dismiss-idempotency-1';
    const outcome = {
      commandId: 'command-1',
      commandRevision: '2',
      clientRequestId,
      idempotencyKey,
      commandType: FRONTEND_DISCOVERY_COMMAND_TYPES.dismiss,
      commandSchemaVersion: '1.0.0',
      commandSemanticDigest: 'digest-1',
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      acceptedPrincipalContext: {
        principalId: 'principal-1',
        actor: { type: 'user', id: 'principal-1' },
      },
      acceptedProjectContext: { targetProjectId: 'project-1' },
      acceptedPolicyContext: {
        policyContextId: 'project-policy-context/project-1',
        policyContextRevision: 'policy-1',
        acceptedAt: '2026-08-31T00:00:00.000Z',
      },
      correlationId: 'correlation-1',
      traceId: 'trace-1',
      producedResources: [
        { resourceKind: 'DISCOVERY_FINDING', resourceId: 'finding-1', resourceRevision: '1' },
      ],
      receivedAt: '2026-08-31T00:00:00.000Z',
      acceptedAt: '2026-08-31T00:00:00.000Z',
      completedAt: '2026-08-31T00:00:01.000Z',
      lastUpdatedAt: '2026-08-31T00:00:01.000Z',
    };
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ input: String(input), init });
      if (String(input) === '/api/v1/security/csrf') {
        return Response.json({ csrfToken: 'csrf-dismiss' });
      }
      if (String(input).endsWith('/discoveries/dismiss')) {
        return Response.json({
          result: {
            schemaVersion: '1.0.0',
            projectId: 'project-1',
            accessRevision: 'access-1',
            policyContextRevision: 'policy-1',
            finding: detail({
              lifecycleState: 'DISMISSED',
              capabilities: {
                schemaVersion: '1.0.0',
                canOpenReview: false,
                canInspectEvidence: false,
                canOpenGraph: false,
                canOpenActivity: false,
                canInvestigate: false,
                canDismiss: false,
              },
            }),
          },
        });
      }
      if (String(input).startsWith('/api/v1/frontend-commands/by-client-request/')) {
        return Response.json({ outcome });
      }
      throw new Error(`Unexpected fetch path: ${String(input)}`);
    };
    const client = createFrontendDiscoveryClient({ fetch });
    const dismissed = await client.dismissDiscoveryFinding({
      schemaVersion: '1.0.0',
      clientRequestId,
      idempotencyKey,
      findingId: 'finding-1',
      findingRevision: 1,
    });
    expect(dismissed.finding.lifecycleState).toBe('DISMISSED');
    const resolved = await client.resolveDiscoveryDismissCommand(clientRequestId);
    expect(resolved).toMatchObject({
      clientRequestId,
      commandType: FRONTEND_DISCOVERY_COMMAND_TYPES.dismiss,
      outcomeState: 'COMPLETED',
    });
    expect(calls[1]?.input).toBe('/product-api/frontend/knowledge/discoveries/dismiss');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      schemaVersion: '1.0.0',
      clientRequestId,
      idempotencyKey,
      findingId: 'finding-1',
      findingRevision: 1,
    });
    expect(calls[2]?.input).toBe(`/api/v1/frontend-commands/by-client-request/${clientRequestId}`);
  });

  it('posts only feedback intent and decodes the principal-scoped Product state', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const clientRequestId = 'feedback-client-1';
    const idempotencyKey = 'feedback-key-1';
    const outcome = {
      commandId: 'feedback-command-1',
      commandRevision: '2',
      clientRequestId,
      idempotencyKey,
      commandType: FRONTEND_DISCOVERY_COMMAND_TYPES.feedback,
      commandSchemaVersion: '1.0.0',
      commandSemanticDigest: 'digest-feedback-1',
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      acceptedPrincipalContext: {
        principalId: 'principal-1',
        actor: { type: 'user', id: 'principal-1' },
      },
      acceptedProjectContext: { targetProjectId: 'project-1' },
      acceptedPolicyContext: {
        policyContextId: 'project-policy-context/project-1',
        policyContextRevision: '7',
        acceptedAt: '2026-08-31T00:00:00.000Z',
      },
      correlationId: 'correlation-feedback-1',
      traceId: 'trace-feedback-1',
      producedResources: [
        { resourceKind: 'DISCOVERY_FEEDBACK_EVENT', resourceId: 'feedback:feedback-command-1' },
      ],
      receivedAt: '2026-08-31T00:00:00.000Z',
      acceptedAt: '2026-08-31T00:00:00.000Z',
      completedAt: '2026-08-31T00:00:01.000Z',
      lastUpdatedAt: '2026-08-31T00:00:01.000Z',
    };
    const event = {
      schemaVersion: '1.0.0',
      feedbackId: 'feedback:feedback-command-1',
      projectId: 'project-1',
      findingId: 'finding-1',
      findingRevision: 1,
      actor: { type: 'user', id: 'principal-1' },
      principalId: 'principal-1',
      feedbackClass: 'UTILITY',
      feedbackKind: 'USEFUL',
      scope: 'FINDING',
      createdAt: '2026-08-31T00:00:00.000Z',
    };
    const state = {
      schemaVersion: '1.0.0',
      projectId: 'project-1',
      findingId: 'finding-1',
      findingRevision: 1,
      feedbackHistory: [event],
      suppressionHistory: [],
    };
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ input: String(input), init });
      if (String(input) === '/api/v1/security/csrf') {
        return Response.json({ csrfToken: 'csrf-feedback' });
      }
      if (String(input).endsWith('/discoveries/feedback')) {
        return Response.json({ result: state, outcome });
      }
      if (String(input).startsWith('/api/v1/frontend-commands/by-client-request/')) {
        return Response.json({ outcome });
      }
      throw new Error(`Unexpected fetch path: ${String(input)}`);
    };
    const client = createFrontendDiscoveryClient({ fetch });
    const submitted = await client.submitDiscoveryFeedback({
      schemaVersion: '1.0.0',
      clientRequestId,
      idempotencyKey,
      findingId: 'finding-1',
      findingRevision: 1,
      feedbackClass: 'UTILITY',
      feedbackKind: 'USEFUL',
    });
    expect(submitted).toMatchObject({ state: { feedbackHistory: [{ feedbackKind: 'USEFUL' }] } });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      schemaVersion: '1.0.0',
      clientRequestId,
      idempotencyKey,
      findingId: 'finding-1',
      findingRevision: 1,
      feedbackClass: 'UTILITY',
      feedbackKind: 'USEFUL',
    });
    const resolved = await client.resolveDiscoveryFeedbackCommand(clientRequestId);
    expect(resolved.commandType).toBe(FRONTEND_DISCOVERY_COMMAND_TYPES.feedback);
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

    const mismatchedDismissFetch = async (input: string | URL | Request): Promise<Response> =>
      String(input) === '/api/v1/security/csrf'
        ? Response.json({ csrfToken: 'csrf-dismiss-identity' })
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
      createFrontendDiscoveryClient({ fetch: mismatchedDismissFetch }).dismissDiscoveryFinding({
        schemaVersion: '1.0.0',
        clientRequestId: 'dismiss-identity',
        idempotencyKey: 'dismiss-identity-key',
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
