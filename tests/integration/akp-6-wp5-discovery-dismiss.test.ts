import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import {
  DiscoveryFindingLifecycleService,
  assertDiscoveryLifecycleTransitionV1,
  type DiscoveryFindingIdentityV1,
  type DiscoveryFindingLifecycleCurrentV1,
  type DiscoveryFindingLifecycleHistoryV1,
  type DiscoveryFindingLifecycleRepositoryPort,
  type DiscoveryLifecycleTransitionInputV1,
  type DiscoveryLifecycleTransitionResultV1,
} from '../../modules/discovery-finding-lifecycle/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  createEmptyDiscoveryProductReadSource,
  type DiscoveryProductReadSource,
} from '../../modules/frontend-discovery-product/src/index.js';

const identity: DiscoveryFindingIdentityV1 = {
  projectId: 'wp5-project',
  findingId: 'wp5-finding',
  findingRevision: 1,
};
const timestamp = '2026-08-31T00:00:00.000Z';

class MemoryLifecycleRepository implements DiscoveryFindingLifecycleRepositoryPort {
  state: DiscoveryFindingLifecycleCurrentV1;
  calls = 0;
  findCalls = 0;

  constructor(
    initialState: DiscoveryFindingLifecycleCurrentV1['lifecycleState'] = 'VALIDATING',
    private readonly replaceBeforeCompareAndSet = false,
  ) {
    this.state = {
      ...identity,
      lifecycleState: initialState,
      lifecycleRevision: 2,
      updatedAt: timestamp,
    };
  }

  async findLifecycle(request: DiscoveryFindingIdentityV1) {
    if (
      request.projectId !== identity.projectId ||
      request.findingId !== identity.findingId ||
      request.findingRevision !== identity.findingRevision
    ) {
      return undefined;
    }
    this.findCalls += 1;
    const current = this.state;
    if (this.replaceBeforeCompareAndSet && this.findCalls === 2) {
      this.state = {
        ...current,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: current.lifecycleRevision + 1,
      };
    }
    return current;
  }

  async listLifecycleHistory(): Promise<readonly DiscoveryFindingLifecycleHistoryV1[]> {
    return [];
  }

  async transitionLifecycle(
    input: DiscoveryLifecycleTransitionInputV1,
  ): Promise<DiscoveryLifecycleTransitionResultV1> {
    this.calls += 1;
    if (input.expectedLifecycleRevision !== this.state.lifecycleRevision) {
      return { status: 'CONFLICT', current: this.state };
    }
    assertDiscoveryLifecycleTransitionV1(
      this.state.lifecycleState,
      input.targetState,
      input.cause,
      input.reasonCode,
    );
    const lifecycle: DiscoveryFindingLifecycleCurrentV1 = {
      ...this.state,
      lifecycleState: input.targetState,
      lifecycleRevision: this.state.lifecycleRevision + 1,
      updatedAt: input.occurredAt,
    };
    const history: DiscoveryFindingLifecycleHistoryV1 = {
      ...identity,
      lifecycleRevision: lifecycle.lifecycleRevision,
      fromState: this.state.lifecycleState,
      toState: input.targetState,
      cause: input.cause,
      reasonCode: input.reasonCode,
      occurredAt: input.occurredAt,
    };
    this.state = lifecycle;
    return { status: 'APPLIED', lifecycle, history };
  }
}

const finding = (): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: identity.findingId,
    findingRevision: identity.findingRevision,
    projectId: identity.projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'VALIDATING',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'WP5',
      missingFact: 'dismissal contract',
      question: 'Is the contract governed?',
    },
    relatedResourceRefs: [],
    evidenceIds: [],
    sourceProjectionDigest: 'sha256:wp5-source',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 7,
      snapshotDigest: 'sha256:wp5-canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp5-7',
      projectionDigest: 'sha256:wp5-discovery',
    },
    runId: 'wp5-run',
    signalSummary: {},
    rationale: 'A bounded test finding.',
    derivationSummary: 'Created for the governed dismiss integration test.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp5-dismiss-fixture',
      ruleVersion: '1',
      inputDigest: 'sha256:wp5-input',
    },
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: 'sha256:wp5-finding',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: timestamp,
  });

type DismissFixtureOptions = {
  readonly lifecycleState?: DiscoveryFindingLifecycleCurrentV1['lifecycleState'];
  readonly owner?: boolean;
  readonly sourceFinding?: DiscoveryFindingEnvelopeV1;
  readonly replaceBeforeCompareAndSet?: boolean;
};

const applications: Awaited<ReturnType<typeof createApplication>>[] = [];

const createDismissFixture = async (options: DismissFixtureOptions = {}) => {
  const auth = new InMemoryAuthRepository();
  const projects = new InMemoryProjectAdministrationRepository(undefined, false);
  await auth.bootstrapOwner({
    accountId: 'wp5-owner',
    projectId: identity.projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await auth.findPrincipalByAccountId('wp5-owner');
  if (!principal) throw new Error('WP5 owner fixture was not created.');
  await projects.createProject({
    commandId: 'wp5-project-create',
    clientRequestId: 'wp5-project-create',
    idempotencyKey: 'wp5-project-create',
    projectId: identity.projectId,
    name: 'WP5 Project',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  projects.activateProjectForBootstrap(identity.projectId);
  const session = await auth.createSession(
    principal.principalId,
    identity.projectId,
    new Date(Date.now() + 60_000).toISOString(),
  );
  if (options.owner === false) {
    const findMembership = auth.findMembership.bind(auth);
    const listMemberships = auth.listMemberships.bind(auth);
    auth.findMembership = async (principalId, projectId) => {
      const membership = await findMembership(principalId, projectId);
      return membership ? { ...membership, isOwner: false } : undefined;
    };
    auth.listMemberships = async (principalId) =>
      (await listMemberships(principalId)).map((membership) => ({
        ...membership,
        isOwner: false,
      }));
  }
  const repository = new MemoryLifecycleRepository(
    options.lifecycleState,
    options.replaceBeforeCompareAndSet,
  );
  const source = {
    ...createEmptyDiscoveryProductReadSource(),
    findFinding: async () => options.sourceFinding ?? finding(),
    findLifecycle: async (request: DiscoveryFindingIdentityV1) => repository.findLifecycle(request),
  } satisfies DiscoveryProductReadSource;
  const gateway = new InMemoryFrontendCommandGateway();
  const application = await createApplication({
    authRepository: auth,
    projectAdminRepository: projects,
    frontendCommandGateway: gateway,
    frontendDiscoveryProductReadCoordinator: new FrontendDiscoveryProductReadCoordinator(source),
    frontendDiscoveryFindingLifecycleService: new DiscoveryFindingLifecycleService(repository),
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
    headers: { cookie, 'x-csrf-token': csrf },
    principalId: principal.principalId,
    repository,
  };
};

const dismissPayload = (suffix: string, revision = identity.findingRevision) => ({
  schemaVersion: '1.0.0',
  clientRequestId: `wp5-dismiss-client-${suffix}`,
  idempotencyKey: `wp5-dismiss-idempotency-${suffix}`,
  findingId: identity.findingId,
  findingRevision: revision,
});

const postDismiss = (
  fixture: Awaited<ReturnType<typeof createDismissFixture>>,
  payload: Record<string, unknown>,
) =>
  fixture.application.server.inject({
    method: 'POST',
    url: '/product-api/frontend/knowledge/discoveries/dismiss',
    headers: fixture.headers,
    payload,
  });
describe('AKP-6 WP5 governed Discovery dismiss', () => {
  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.server.close()));
  });

  it('uses the owner command ledger and lifecycle revision exactly once across replay', async () => {
    const fixture = await createDismissFixture();
    const payload = dismissPayload('replay');
    const first = await postDismiss(fixture, payload);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      result: {
        finding: { lifecycleState: 'DISMISSED', capabilities: { canDismiss: false } },
      },
    });
    expect(fixture.repository.state.lifecycleState).toBe('DISMISSED');
    expect(fixture.repository.calls).toBe(1);

    const replay = await postDismiss(fixture, payload);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({
      result: {
        finding: { lifecycleState: 'DISMISSED' },
      },
      outcome: { outcomeState: 'COMPLETED' },
    });
    expect(fixture.repository.calls).toBe(1);
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, payload.clientRequestId),
    ).resolves.toMatchObject({ outcomeState: 'COMPLETED' });
  });

  it('rejects a distinct duplicate after dismissal without a second transition', async () => {
    const fixture = await createDismissFixture();
    await expect((await postDismiss(fixture, dismissPayload('first'))).statusCode).toBe(200);

    const duplicate = dismissPayload('distinct');
    const response = await postDismiss(fixture, duplicate);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(fixture.repository.calls).toBe(1);
    expect(fixture.repository.state.lifecycleState).toBe('DISMISSED');
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, duplicate.clientRequestId),
    ).resolves.toMatchObject({ outcomeState: 'REJECTED', rejection: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects unsupported lifecycle states through the normal command path', async () => {
    const fixture = await createDismissFixture({ lifecycleState: 'NEW' });
    const payload = dismissPayload('unsupported');
    const response = await postDismiss(fixture, payload);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(fixture.repository.calls).toBe(0);
    expect(fixture.repository.state.lifecycleState).toBe('NEW');
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, payload.clientRequestId),
    ).resolves.toMatchObject({ outcomeState: 'REJECTED', rejection: { code: 'VALIDATION_ERROR' } });
  });

  it('does not accept a non-owner action or mutate its finding', async () => {
    const fixture = await createDismissFixture({ owner: false });
    const payload = dismissPayload('non-owner');
    const response = await postDismiss(fixture, payload);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(fixture.repository.calls).toBe(0);
    expect(fixture.repository.findCalls).toBe(0);
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, payload.clientRequestId),
    ).resolves.toBeNull();
  });

  it('does not disclose or mutate a finding returned from another project', async () => {
    const fixture = await createDismissFixture({
      sourceFinding: { ...finding(), projectId: 'wp5-other-project' },
    });
    const payload = dismissPayload('cross-project');
    const response = await postDismiss(fixture, payload);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain('wp5-other-project');
    expect(fixture.repository.calls).toBe(0);
    expect(fixture.repository.state.lifecycleState).toBe('VALIDATING');
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, payload.clientRequestId),
    ).resolves.toBeNull();
  });

  it('rejects malformed commands before acceptance and transition', async () => {
    const fixture = await createDismissFixture();
    const payload = {
      schemaVersion: '1.0.0',
      clientRequestId: 'wp5-dismiss-client-malformed',
      idempotencyKey: 'wp5-dismiss-idempotency-malformed',
      findingId: identity.findingId,
    };
    const response = await postDismiss(fixture, payload);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(fixture.repository.calls).toBe(0);
    expect(fixture.repository.findCalls).toBe(0);
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, payload.clientRequestId),
    ).resolves.toBeNull();
  });

  it('rejects a replacement race without applying the stale transition', async () => {
    const fixture = await createDismissFixture({ replaceBeforeCompareAndSet: true });
    const payload = dismissPayload('replacement-race');
    const response = await postDismiss(fixture, payload);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(fixture.repository.calls).toBe(1);
    expect(fixture.repository.state.lifecycleState).toBe('REVIEW_READY');
    expect(fixture.repository.state.lifecycleRevision).toBe(3);
    await expect(
      fixture.gateway.findByClientRequestId(fixture.principalId, payload.clientRequestId),
    ).resolves.toMatchObject({
      outcomeState: 'REJECTED',
      rejection: { code: 'REVISION_CONFLICT' },
    });
  });
});
