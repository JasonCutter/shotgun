import { describe, expect, it } from 'vitest';

import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import { Stage9GraphReadAdapter } from '../../adapters/stage9-graph-read/src/index.js';
import {
  createGraphReadDomain,
  type GraphReadDomain,
  type GraphReadScopeV1,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import type { GraphEdgeV1, GraphNodeV1 } from '../../packages/contracts/src/index.js';

/**
 * AC-23 incremental expansion bound: the server returns at most 200 added
 * nodes per neighborhood page. This is enforced server-side (the graph read
 * adapter clamps `addedNodes` to the applied `maxNodes` limit), so it is
 * verified at the integration boundary rather than in the browser, which has
 * no expansion UI.
 */
const PROJECT_ID = 'shotgun';
const ACCESS = `access:${PROJECT_ID}`;
const POLICY = `policy:${PROJECT_ID}`;

const binding = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'proj-1',
  policyContextRevision: POLICY,
  accessRevision: ACCESS,
};

const entity = (resourceId: string, label: string): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId: `node-${resourceId}`,
  resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId },
  label,
  nodeKind: 'ENTITY',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: binding,
  accessMasking: 'VISIBLE',
  payload: {
    schemaVersion: '1.0.0',
    nodeKind: 'ENTITY',
    entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: label },
  },
});

const edgeToNeighbor = (
  edgeId: string,
  from: string,
  to: string,
  overlayMemberships: GraphEdgeV1['overlayMemberships'] = [],
): GraphEdgeV1 => ({
  schemaVersion: '1.0.0',
  edgeId,
  from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: from },
  to: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: to },
  edgeSemanticKind: 'CANONICAL_RELATION',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships,
  revisionBinding: binding,
  accessMasking: 'VISIBLE',
});

const scope = (): GraphReadScopeV1 => ({
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT_ID,
  accessRevision: ACCESS,
  policyContextRevision: POLICY,
  accessScope: [],
});

const buildDomain = (
  nodes: readonly GraphNodeV1[],
  edges: readonly GraphEdgeV1[],
): GraphReadDomain => {
  const adapter = new Stage9GraphReadAdapter(nodes, edges, () => 'proj-1');
  return createGraphReadDomain({
    readPort: adapter,
    impactPort: adapter,
    snapshotContextStore: createInMemorySnapshotContextStore(),
    healthStore: createInMemoryHealthStore(),
  });
};

describe('FE-P3-S3 AC-23 incremental expansion bound', () => {
  it('clamps a 250-neighbor expansion to at most 200 added nodes and 200 added edges', async () => {
    // 1 center + 250 neighbors = 251 nodes, 250 edges.
    const center = entity('entity-center', 'Center');
    const neighbors = Array.from({ length: 250 }, (_, index) =>
      entity(`entity-n-${index}`, `Neighbor ${index}`),
    );
    const edges = Array.from({ length: 250 }, (_, index) =>
      edgeToNeighbor(`edge-${index}`, 'entity-center', `entity-n-${index}`),
    );

    const domain = buildDomain([center, ...neighbors], edges);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: { ...defaultLimits, maxNodes: 200 },
    });

    const result = await domain.neighborhood(readScope, {
      schemaVersion: '1.0.0',
      snapshotId: snapshot.identity.snapshotId,
      projectionRevision: snapshot.identity.projectionRevision,
      centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-center' },
      limits: { ...defaultLimits, maxNodes: 200 },
    });

    expect(result.addedNodes.length).toBeLessThanOrEqual(200);
    expect(result.addedEdges.length).toBeLessThanOrEqual(200);
    expect(result.addedNodes.length).toBe(200);
    expect(result.addedEdges.length).toBe(200);
    expect(result.completeness).toBe('COMPLETE');
    // The applied limits reflect the requested 200-node bound.
    expect(result.appliedLimits.maxNodes).toBe(200);
  });

  it('defaults to the 100-node bound when the client sends no limits', async () => {
    const center = entity('entity-center', 'Center');
    const neighbors = Array.from({ length: 150 }, (_, index) =>
      entity(`entity-n-${index}`, `Neighbor ${index}`),
    );
    const edges = Array.from({ length: 150 }, (_, index) =>
      edgeToNeighbor(`edge-${index}`, 'entity-center', `entity-n-${index}`),
    );

    const domain = buildDomain([center, ...neighbors], edges);
    const readScope = scope();
    // A snapshot created with the default 100-node bound seeds the snapshot
    // context limits, so a client that sends no limits inherits 100.
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: defaultLimits,
    });

    const result = await domain.neighborhood(readScope, {
      schemaVersion: '1.0.0',
      snapshotId: snapshot.identity.snapshotId,
      projectionRevision: snapshot.identity.projectionRevision,
      centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-center' },
    });

    expect(result.addedNodes.length).toBeLessThanOrEqual(200);
    expect(result.addedNodes.length).toBe(100);
    expect(result.appliedLimits.maxNodes).toBe(100);
  });
});

const defaultLimits = {
  schemaVersion: '1.0.0' as const,
  maxDepth: 3,
  maxNodes: 100,
  maxEdges: 200,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
};
