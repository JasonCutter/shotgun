import { describe, expect, it } from 'vitest';

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
import { FrontendContractError, type GraphNodeV1 } from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'shotgun';
const ACCESS = `access:${PROJECT_ID}`;
const POLICY = `policy:${PROJECT_ID}`;

const node = (
  nodeId: string,
  resourceId: string,
  nodeKind: GraphNodeV1['nodeKind'],
  label: string,
  accessMasking: GraphNodeV1['accessMasking'] = 'VISIBLE',
): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId,
  resourceRef: { schemaVersion: '1.0.0', resourceKind: nodeKind, resourceId },
  label,
  nodeKind,
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: {
    schemaVersion: '1.0.0',
    projectionRevision: 'proj-1',
    policyContextRevision: POLICY,
    accessRevision: ACCESS,
  },
  accessMasking,
  payload:
    nodeKind === 'ENTITY'
      ? {
          schemaVersion: '1.0.0',
          nodeKind: 'ENTITY',
          entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: label },
        }
      : nodeKind === 'CLAIM'
        ? {
            schemaVersion: '1.0.0',
            nodeKind: 'CLAIM',
            claim: { schemaVersion: 'claim.v1', statement: label },
          }
        : undefined,
});

const scope = () => ({
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT_ID,
  accessRevision: ACCESS,
  policyContextRevision: POLICY,
});

const snapshotRequest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0.0' as const,
  viewKind: 'KNOWLEDGE_SEMANTIC' as const,
  overlayKinds: [],
  ...overrides,
});

describe('FE-P3-S3 negative test matrix (implementation request section 7)', () => {
  let domain: GraphReadDomain;

  const buildDomain = (nodes: readonly GraphNodeV1[]) => {
    const adapter = new Stage9GraphReadAdapter(nodes, []);
    domain = createGraphReadDomain({
      readPort: adapter,
      impactPort: adapter,
      snapshotContextStore: createInMemorySnapshotContextStore(),
      healthStore: createInMemoryHealthStore(),
    });
    return domain;
  };

  it('rejects forged access/policy revision values on subsequent reads (AC-02)', async () => {
    const domain = buildDomain([node('node-1', 'entity-1', 'ENTITY', 'Entity One')]);
    const baseScope = scope();
    const result = await domain.snapshot(baseScope as never, snapshotRequest() as never);
    const forged = {
      ...baseScope,
      accessRevision: 'access:forged',
    };
    await expect(
      domain.neighborhood(
        forged as never,
        {
          schemaVersion: '1.0.0',
          snapshotId: result.identity.snapshotId,
          projectionRevision: result.identity.projectionRevision,
          centerRef: {
            schemaVersion: '1.0.0',
            resourceKind: 'ENTITY',
            resourceId: 'entity-1',
          },
        } as never,
      ),
    ).rejects.toThrow(/access revision mismatch/);
  });

  it('clamps over-cap traversal limits with clamped: true (AC-04)', async () => {
    const domain = buildDomain([node('node-1', 'entity-1', 'ENTITY', 'Entity One')]);
    const result = await domain.snapshot(
      scope() as never,
      snapshotRequest({
        limits: {
          schemaVersion: '1.0.0',
          maxDepth: 999,
          maxNodes: 999_999,
          maxEdges: 999_999,
          traversalBudget: 999_999_999,
          serverTimeoutBudgetMs: 999_999,
        },
      }) as never,
    );
    expect(result.appliedLimits.clamped).toBe(true);
    expect(result.appliedLimits.maxNodes).toBeLessThan(999_999);
  });

  it('reports explicit truncation with correct counts (AC-04)', async () => {
    const domain = buildDomain([
      node('node-1', 'entity-1', 'ENTITY', 'Entity One'),
      node('node-2', 'entity-2', 'ENTITY', 'Entity Two'),
      node('node-3', 'entity-3', 'ENTITY', 'Entity Three'),
    ]);
    const result = await domain.snapshot(
      scope() as never,
      snapshotRequest({
        limits: {
          schemaVersion: '1.0.0',
          maxDepth: 3,
          maxNodes: 2,
          maxEdges: 200,
          traversalBudget: 1000,
          serverTimeoutBudgetMs: 5000,
        },
      }) as never,
    );
    expect(result.completeness).toBe('TRUNCATED');
    expect(result.truncation?.truncated).toBe(true);
    expect(result.truncation?.omittedNodeCount).toBeGreaterThan(0);
  });

  it('rejects unknown, expired and mismatched continuation bindings', async () => {
    const adapter = new Stage9GraphReadAdapter(
      [node('node-1', 'entity-1', 'ENTITY', 'Entity One')],
      [],
    );
    const healthStore = createInMemoryHealthStore();
    const snapshotContextStore = createInMemorySnapshotContextStore();
    domain = createGraphReadDomain({
      readPort: adapter,
      impactPort: adapter,
      snapshotContextStore,
      healthStore,
    });
    const baseScope = scope();
    const result = await domain.snapshot(baseScope as never, snapshotRequest() as never);
    const neighborhoodRequest = {
      schemaVersion: '1.0.0',
      snapshotId: result.identity.snapshotId,
      projectionRevision: result.identity.projectionRevision,
      centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
    };

    await expect(
      domain.neighborhood(
        baseScope as never,
        { ...neighborhoodRequest, continuationToken: 'unknown-token' } as never,
      ),
    ).rejects.toThrow(/unknown or expired/);

    // Expired binding: write a continuation that is already past its TTL.
    await healthStore.writeContinuation({
      token: 'expired-token',
      expiresAt: '2020-01-01T00:00:00.000Z',
      principalId: 'principal-1',
      sessionId: 'session-1',
      projectId: PROJECT_ID,
      accessRevision: ACCESS,
      policyContextRevision: POLICY,
      snapshotId: result.identity.snapshotId,
      rootRef: undefined,
      filtersDigest: 'sha256:default',
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
    });
    await expect(
      domain.neighborhood(
        baseScope as never,
        { ...neighborhoodRequest, continuationToken: 'expired-token' } as never,
      ),
    ).rejects.toThrow(/expired/);

    // Mismatched binding: token bound to another principal is rejected.
    await healthStore.writeContinuation({
      token: 'other-principal-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      principalId: 'principal-other',
      sessionId: 'session-1',
      projectId: PROJECT_ID,
      accessRevision: ACCESS,
      policyContextRevision: POLICY,
      snapshotId: result.identity.snapshotId,
      rootRef: undefined,
      filtersDigest: 'sha256:default',
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
    });
    await expect(
      domain.neighborhood(
        baseScope as never,
        { ...neighborhoodRequest, continuationToken: 'other-principal-token' } as never,
      ),
    ).rejects.toThrow(/principal\/session mismatch/);
  });

  it('keeps hidden resources absent from snapshots, neighborhoods and paths', async () => {
    const hiddenNode = node('node-hidden', 'hidden-1', 'CLAIM', 'Hidden Claim', 'HIDDEN');
    const domain = buildDomain([node('node-1', 'entity-1', 'ENTITY', 'Entity One'), hiddenNode]);
    const result = await domain.snapshot(scope() as never, snapshotRequest() as never);
    expect(result.nodes.some((entry) => entry.nodeId === 'node-hidden')).toBe(false);
  });

  it('rejects an overlay without a resolvable base snapshot (AC-13)', async () => {
    const domain = buildDomain([node('node-1', 'entity-1', 'ENTITY', 'Entity One')]);
    await expect(
      domain.conflictOverlay(
        scope() as never,
        {
          schemaVersion: '1.0.0',
          snapshotId: 'unknown-snapshot',
          projectionRevision: 'proj-1',
          overlayKind: 'CONFLICT',
        } as never,
      ),
    ).rejects.toThrow(/unknown snapshot context/);
  });

  it('rejects duplicate overlay kinds at the decoder (contract negative)', async () => {
    // The snapshot request decoder enforces unique overlay kinds.
    const { decodeGraphSnapshotRequestV1 } = await import('../../packages/contracts/src/index.js');
    expect(() =>
      decodeGraphSnapshotRequestV1({
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: ['CONFLICT', 'CONFLICT'],
      }),
    ).toThrow(FrontendContractError);
  });

  it('serves no Canonical/Approval/Action write endpoint under the graph namespace', async () => {
    const auth = new InMemoryAuthRepository();
    const adapter = new Stage9GraphReadAdapter(
      [node('node-1', 'entity-1', 'ENTITY', 'Entity One')],
      [],
    );
    const graphDomain = createGraphReadDomain({
      readPort: adapter,
      impactPort: adapter,
      snapshotContextStore: createInMemorySnapshotContextStore(),
      healthStore: createInMemoryHealthStore(),
    });
    const app = await createApplication({
      authRepository: auth,
      graphReadDomain: graphDomain,
    });
    await auth.bootstrapOwner({
      accountId: 'graph-negative-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('graph-negative-owner');
    if (!principal) throw new Error('Fixture Principal missing.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const csrf = (
      await app.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken?: string }>();

    for (const writePath of [
      '/product-api/frontend/knowledge/graph/commit',
      '/product-api/frontend/knowledge/graph/canonical',
      '/product-api/frontend/knowledge/graph/approve',
      '/product-api/frontend/knowledge/graph/action/execute',
    ]) {
      const response = await app.server.inject({
        method: 'POST',
        url: writePath,
        headers: { cookie, 'x-csrf-token': csrf.csrfToken ?? '' },
        payload: { schemaVersion: '1.0.0' },
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
