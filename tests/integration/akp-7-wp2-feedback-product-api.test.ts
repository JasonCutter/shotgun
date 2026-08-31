import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  createEmptyDiscoveryProductReadSource,
} from '../../modules/frontend-discovery-product/src/index.js';

const projectId = 'akp-7-wp2-project';
const findingId = 'akp-7-wp2-finding';
const fingerprint = `sha256:${'a'.repeat(64)}`;

const finding = (
  overrides: Partial<DiscoveryFindingEnvelopeV1> = {},
): DiscoveryFindingEnvelopeV1 => {
  const baseFinding = createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 2,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'AKP-7',
      missingFact: 'feedback API',
      question: 'Is feedback non-Canonical?',
    },
    relatedResourceRefs: [],
    evidenceIds: [],
    sourceProjectionDigest: 'sha256:source',
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
    runId: 'run-1',
    signalSummary: {},
    rationale: 'A test finding.',
    derivationSummary: 'A bounded Product API fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'akp-7-wp2-fixture',
      ruleVersion: '1',
      inputDigest: 'sha256:input',
    },
    accessScope: ['owner'],
    sensitivity: 'public',
    fingerprint,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-31T00:00:00.000Z',
  });
  return { ...baseFinding, ...overrides } as DiscoveryFindingEnvelopeV1;
};

const applications: Awaited<ReturnType<typeof createApplication>>[] = [];

const createFixture = async (sourceFinding = finding()) => {
  const auth = new InMemoryAuthRepository();
  const projects = new InMemoryProjectAdministrationRepository(undefined, false);
  await auth.bootstrapOwner({
    accountId: 'akp-7-wp2-owner',
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await auth.findPrincipalByAccountId('akp-7-wp2-owner');
  if (!principal) throw new Error('WP2 fixture principal was not created.');
  await projects.createProject({
    commandId: 'akp-7-wp2-project-create',
    clientRequestId: 'akp-7-wp2-project-create',
    idempotencyKey: 'akp-7-wp2-project-create',
    projectId,
    name: 'AKP-7 WP2 Project',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  projects.activateProjectForBootstrap(projectId);
  const session = await auth.createSession(
    principal.principalId,
    projectId,
    new Date(Date.now() + 60_000).toISOString(),
  );
  const lifecycle = {
    projectId,
    findingId,
    findingRevision: 2,
    lifecycleState: 'NEW' as const,
    lifecycleRevision: 1,
    updatedAt: '2026-08-31T00:00:00.000Z',
  };
  const source = {
    ...createEmptyDiscoveryProductReadSource(),
    findFinding: async () => sourceFinding,
    findLifecycle: async () => lifecycle,
  };
  const repository = new InMemoryDiscoveryFeedbackRepository();
  const gateway = new InMemoryFrontendCommandGateway();
  const application = await createApplication({
    authRepository: auth,
    projectAdminRepository: projects,
    frontendCommandGateway: gateway,
    discoveryFeedbackRepository: repository,
    frontendDiscoveryProductReadCoordinator: new FrontendDiscoveryProductReadCoordinator(source),
  });
  applications.push(application);
  const cookie = `shotgun_session=${session.sessionToken}`;
  const csrf = (
    await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    })
  ).json<{ csrfToken: string }>().csrfToken;
  return {
    application,
    gateway,
    repository,
    principalId: principal.principalId,
    headers: { cookie, 'x-csrf-token': csrf },
  };
};

const post = (
  fixture: Awaited<ReturnType<typeof createFixture>>,
  payload: Record<string, unknown>,
) =>
  fixture.application.server.inject({
    method: 'POST',
    url: '/product-api/frontend/knowledge/discoveries/feedback',
    headers: fixture.headers,
    payload,
  });

const state = (fixture: Awaited<ReturnType<typeof createFixture>>) =>
  fixture.application.server.inject({
    method: 'POST',
    url: '/product-api/frontend/knowledge/discoveries/feedback/state',
    headers: fixture.headers,
    payload: { schemaVersion: '1.0.0', findingId, findingRevision: 2 },
  });

const payload = (kind: string, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0.0',
  clientRequestId: `wp2-client-${kind}`,
  idempotencyKey: `wp2-key-${kind}`,
  findingId,
  findingRevision: 2,
  feedbackClass: 'UTILITY',
  feedbackKind: kind,
  ...overrides,
});

describe('AKP-7 WP2 Discovery feedback Product API', () => {
  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('derives Finding authority and completes USEFUL with one feedback and no suppression', async () => {
    const fixture = await createFixture();
    const response = await post(fixture, payload('USEFUL', { reason: 'Useful context.' }));
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      result: {
        projectId,
        findingId,
        findingRevision: 2,
        feedbackHistory: [{ feedbackKind: 'USEFUL', projectId, principalId: fixture.principalId }],
        suppressionHistory: [],
      },
      outcome: { commandType: 'frontend.discovery.feedback.v1', outcomeState: 'COMPLETED' },
    });
  });

  it('creates server-fingerprinted exact suppression and replays without duplicates', async () => {
    const fixture = await createFixture();
    const command = payload('SUPPRESS_EXACT', { scope: 'PROJECT' });
    const first = await post(fixture, command);
    expect(first.statusCode, first.body).toBe(200);
    const replay = await post(fixture, command);
    expect(replay.statusCode, replay.body).toBe(200);
    const current = (await state(fixture)).json();
    expect(current.result.feedbackHistory).toHaveLength(1);
    expect(current.result.suppressionHistory).toHaveLength(1);
    expect(current.result.suppressionHistory[0]).toMatchObject({
      suppressionKind: 'SUPPRESS_EXACT',
      matcherKind: 'EXACT_FINGERPRINT',
      fingerprint,
      fingerprintVersion: 'discovery-fingerprint:v1',
      matcherVersion: 'discovery-fingerprint:v1',
    });
    expect(JSON.stringify(first.json())).not.toContain('browser-project');
  });

  it('rejects malformed authority injection before command acceptance', async () => {
    const fixture = await createFixture();
    const response = await post(
      fixture,
      payload('USEFUL', {
        projectId: 'browser-project',
        principalId: 'browser-principal',
        fingerprint,
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(
      await fixture.gateway.findByClientRequestId(fixture.principalId, 'wp2-client-USEFUL'),
    ).toBeNull();
    expect(
      await fixture.repository.listFeedbackForFinding({ projectId, findingId, findingRevision: 2 }),
    ).toEqual([]);
  });

  it('rejects an oversized reason before Command Gateway acceptance', async () => {
    const fixture = await createFixture();
    const response = await post(fixture, payload('USEFUL', { reason: 'r'.repeat(501) }));
    expect(response.statusCode).toBe(400);
    expect(
      await fixture.gateway.findByClientRequestId(fixture.principalId, 'wp2-client-USEFUL'),
    ).toBeNull();
    expect(
      await fixture.repository.listFeedbackForFinding({ projectId, findingId, findingRevision: 2 }),
    ).toEqual([]);
    expect(
      await fixture.repository.listSuppressionHistoryForFinding({
        projectId,
        findingId,
        findingRevision: 2,
        principalId: fixture.principalId,
      }),
    ).toEqual([]);
  });

  it('preserves non-disclosure for a cross-project Finding response', async () => {
    const fixture = await createFixture(finding({ projectId: 'other-project' }));
    const response = await post(fixture, payload('USEFUL'));
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('other-project');
    expect(
      await fixture.gateway.findByClientRequestId(fixture.principalId, 'wp2-client-USEFUL'),
    ).toBeNull();
  });

  it('reads only the exact server-authorized Finding state after reload', async () => {
    const fixture = await createFixture();
    await post(fixture, payload('SNOOZE', { snoozeUntil: '2999-01-01T00:00:00.000Z' }));
    const response = await state(fixture);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      result: {
        projectId,
        findingId,
        findingRevision: 2,
        feedbackHistory: [{ feedbackKind: 'SNOOZE' }],
        suppressionHistory: [{ suppressionKind: 'SNOOZE', matcherKind: 'NONE' }],
      },
    });
  });
});
