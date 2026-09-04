import { beforeEach, describe, expect, it } from 'vitest';

import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import { Stage9GraphReadAdapter } from '../../adapters/stage9-graph-read/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  createGraphReadDomain,
  type GraphReadDomain,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { GraphEdgeV1, GraphNodeV1 } from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'shotgun';

const revisionBinding = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'proj-1',
  policyContextRevision: `policy:${PROJECT_ID}`,
  accessRevision: `access:${PROJECT_ID}`,
};

const node = (
  nodeId: string,
  resourceKind: GraphNodeV1['nodeKind'],
  resourceId: string,
  label: string,
  overlayMemberships: GraphNodeV1['overlayMemberships'] = [],
): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId,
  resourceRef: { schemaVersion: '1.0.0', resourceKind, resourceId },
  label,
  nodeKind: resourceKind,
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships,
  revisionBinding,
  accessMasking: 'VISIBLE',
  payload:
    resourceKind === 'ENTITY'
      ? {
          schemaVersion: '1.0.0',
          nodeKind: 'ENTITY',
          entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: label },
        }
      : resourceKind === 'CLAIM'
        ? {
            schemaVersion: '1.0.0',
            nodeKind: 'CLAIM',
            claim: { schemaVersion: 'claim.v1', statement: label },
          }
        : undefined,
});

const edge = (
  edgeId: string,
  from: string,
  to: string,
  edgeSemanticKind: GraphEdgeV1['edgeSemanticKind'],
  overlayMemberships: GraphEdgeV1['overlayMemberships'] = [],
): GraphEdgeV1 => ({
  schemaVersion: '1.0.0',
  edgeId,
  from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: from },
  to: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: to },
  edgeSemanticKind,
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships,
  revisionBinding,
  accessMasking: 'VISIBLE',
});

const fixtureNodes = [
  node('node-1', 'ENTITY', 'entity-1', 'Entity One'),
  node('node-2', 'CLAIM', 'claim-1', 'Claim One'),
];
const fixtureEdges = [edge('edge-1', 'entity-1', 'claim-1', 'CANONICAL_RELATION')];

describe('FE-P3-S3 Knowledge Graph Product API', () => {
  let auth: InMemoryAuthRepository;
  let domain: GraphReadDomain;

  beforeEach(() => {
    auth = new InMemoryAuthRepository();
    const adapter = new Stage9GraphReadAdapter(fixtureNodes, fixtureEdges);
    domain = createGraphReadDomain({
      readPort: adapter,
      impactPort: adapter,
      snapshotContextStore: createInMemorySnapshotContextStore(),
      healthStore: createInMemoryHealthStore(),
    });
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'graph-api-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('graph-api-owner');
    if (!principal) throw new Error('Graph API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    return `shotgun_session=${session.sessionToken}`;
  };

  const buildApplication = async () =>
    createApplication({ authRepository: auth, graphReadDomain: domain });

  const csrf = async (application: Awaited<ReturnType<typeof createApplication>>, cookie: string) =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken?: string }>();

  it('serves an initial semantic snapshot through the protected graph route', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const response = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot',
      headers: { cookie, 'x-csrf-token': token.csrfToken ?? '' },
      payload: {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: [],
        limits: {
          schemaVersion: '1.0.0',
          maxDepth: 3,
          maxNodes: 100,
          maxEdges: 200,
          traversalBudget: 1000,
          serverTimeoutBudgetMs: 5000,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      identity?: { snapshotId?: string };
      nodes?: unknown[];
      health?: string;
    }>();
    expect(body.identity?.snapshotId).toBeTruthy();
    expect(body.nodes?.length).toBe(2);
    expect(body.health).toBe('COMPLETE');
  });

  it('maps malformed snapshot input to INVALID_REQUEST instead of INTERNAL_UNCLASSIFIED', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const response = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot',
      headers: { cookie, 'x-csrf-token': token.csrfToken ?? '' },
      payload: { schemaVersion: '1.0.0' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code?: string }>()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('maps invalid discovery snapshot parameters to INVALID_REQUEST instead of INTERNAL_UNCLASSIFIED', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const response = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot/discovery/finding-1/0',
      headers: { cookie, 'x-csrf-token': token.csrfToken ?? '' },
      payload: {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code?: string }>()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('expands a neighborhood and explores a path under the snapshot context', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const snapshot = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot',
      headers: { cookie, 'x-csrf-token': token.csrfToken ?? '' },
      payload: { schemaVersion: '1.0.0', viewKind: 'KNOWLEDGE_SEMANTIC', overlayKinds: [] },
    });
    const snapshotBody = snapshot.json<{
      identity: { snapshotId: string; projectionRevision: string };
    }>();
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };

    const neighborhood = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/neighborhood',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        snapshotId: snapshotBody.identity.snapshotId,
        projectionRevision: snapshotBody.identity.projectionRevision,
        centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      },
    });
    expect(neighborhood.statusCode).toBe(200);
    const neighborhoodBody = neighborhood.json<{ addedNodes?: unknown[] }>();
    expect(neighborhoodBody.addedNodes?.length).toBe(1);

    const path = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/path',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        snapshotId: snapshotBody.identity.snapshotId,
        projectionRevision: snapshotBody.identity.projectionRevision,
        fromRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
        toRef: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      },
    });
    expect(path.statusCode).toBe(200);
    const pathBody = path.json<{ paths?: unknown[] }>();
    expect(pathBody.paths?.length).toBeGreaterThan(0);
  });

  it('refreshes a snapshot descriptor-based and issues a new snapshot identity', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };
    const snapshot = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot',
      headers,
      payload: { schemaVersion: '1.0.0', viewKind: 'KNOWLEDGE_SEMANTIC', overlayKinds: [] },
    });
    const first = snapshot.json<{
      identity: { snapshotId: string; projectionRevision: string };
    }>();
    const refresh = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot/refresh',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        snapshotId: first.identity.snapshotId,
        projectionRevision: first.identity.projectionRevision,
        expectedSnapshotRevision: first.identity.projectionRevision,
      },
    });
    expect(refresh.statusCode).toBe(200);
    const second = refresh.json<{ identity: { snapshotId: string; projectionRevision: string } }>();
    expect(second.identity.snapshotId).not.toBe(first.identity.snapshotId);
  });

  it('serves a conflict overlay bound to the base snapshot with no Canonical edge writes', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };
    const snapshot = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: ['CONFLICT'],
      },
    });
    const body = snapshot.json<{ identity: { snapshotId: string; projectionRevision: string } }>();
    const overlay = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/overlay/conflict',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        snapshotId: body.identity.snapshotId,
        projectionRevision: body.identity.projectionRevision,
        overlayKind: 'CONFLICT',
      },
    });
    expect(overlay.statusCode).toBe(200);
    const overlayBody = overlay.json<{
      identity: { overlayKind: string };
      baseSnapshotId: string;
    }>();
    expect(overlayBody.identity.overlayKind).toBe('CONFLICT');
    expect(overlayBody.baseSnapshotId).toBe(body.identity.snapshotId);
  });

  it('serves a typed unavailable Discovery overlay without changing the healthy base Graph', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };
    const snapshot = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: [],
      },
    });
    const body = snapshot.json<{
      identity: { snapshotId: string; projectionRevision: string };
      health: string;
    }>();
    const overlay = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/overlay/discovery',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        baseSnapshotId: body.identity.snapshotId,
        projectionRevision: body.identity.projectionRevision,
        overlayKind: 'DISCOVERY',
        findingId: 'finding-1',
        findingRevision: 4,
      },
    });
    expect(overlay.statusCode).toBe(200);
    expect(overlay.json()).toMatchObject({
      baseSnapshotId: body.identity.snapshotId,
      projectionRevision: body.identity.projectionRevision,
      health: 'UNAVAILABLE',
      nodes: [],
      edges: [],
      identity: {
        overlayKind: 'DISCOVERY',
      },
    });
    expect(body.health).toBe('COMPLETE');
  });
});
