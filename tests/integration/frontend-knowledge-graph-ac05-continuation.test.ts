import { describe, expect, it } from 'vitest';

import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import {
  createGraphReadDomain,
  type GraphReadDomain,
  type GraphReadPort,
  type GraphReadScopeV1,
  type GraphImpactPort,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import { FrontendContractError, type GraphNodeV1 } from '../../packages/contracts/src/index.js';
import type {
  GraphEdgeV1,
  GraphEvidenceDetailResultV1,
  GraphFilterSetV1,
  GraphNeighborhoodResultV1,
  GraphOverlayResultV1,
  GraphPathDescriptionV1,
  GraphPathResultV1,
  GraphRecursiveImpactOverlayRequestV1,
  GraphRestoreResultV1,
  GraphSnapshotResultV1,
  GraphTraversalLimitsV1,
} from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'shotgun';
const ACCESS = `access:${PROJECT_ID}`;
const POLICY = `policy:${PROJECT_ID}`;
const PAGE_SIZE = 5;

const node = (index: number): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId: `node-${index}`,
  resourceRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'ENTITY',
    resourceId: `entity-${index}`,
  },
  label: `Entity ${index}`,
  nodeKind: 'ENTITY',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: {
    schemaVersion: '1.0.0',
    projectionRevision: 'proj-1',
    policyContextRevision: POLICY,
    accessRevision: ACCESS,
  },
  accessMasking: 'VISIBLE',
  payload: {
    schemaVersion: '1.0.0',
    nodeKind: 'ENTITY',
    entity: {
      schemaVersion: 'entity.v1',
      entityType: 'PERSON',
      displayName: `Entity ${index}`,
    },
  },
});

const scope = (): GraphReadScopeV1 => ({
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT_ID,
  accessRevision: ACCESS,
  policyContextRevision: POLICY,
  accessScope: [],
});

const limits = (maxNodes = PAGE_SIZE): GraphTraversalLimitsV1 => ({
  schemaVersion: '1.0.0',
  maxDepth: 3,
  maxNodes,
  maxEdges: 200,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
});

/**
 * Deterministic paginated fixture (AC-05). The snapshot establishes the
 * snapshot context and returns the first page; every PARTIAL neighborhood
 * advances an internal cursor so the union of all pages equals the full
 * fixture node set, with no duplicate IDs and no continuation on the last
 * page.
 */
class PaginatedFixtureReadPort implements GraphReadPort, GraphImpactPort {
  private readonly cursors = new Map<string, number>();
  private counter = 0;

  constructor(
    private readonly nodes: readonly GraphNodeV1[],
    private readonly edges: readonly GraphEdgeV1[] = [],
  ) {}

  private visible(nodes: readonly GraphNodeV1[]): GraphNodeV1[] {
    return nodes.filter((entry) => entry.accessMasking !== 'HIDDEN');
  }

  private page(
    list: readonly GraphNodeV1[],
    offset: number,
    maxNodes: number,
  ): { page: GraphNodeV1[]; hasMore: boolean } {
    const page = list.slice(offset, offset + maxNodes);
    return { page, hasMore: offset + maxNodes < list.length };
  }

  async snapshot(
    readScope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['snapshot']>[1],
  ): Promise<GraphSnapshotResultV1> {
    const snapshotId = `snapshot-${++this.counter}`;
    const nodes = this.visible(this.nodes);
    const effLimits = request.limits ?? limits();
    const { page, hasMore } = this.page(nodes, 0, effLimits.maxNodes);
    this.cursors.set(snapshotId, effLimits.maxNodes);
    return {
      schemaVersion: '1.0.0',
      identity: {
        schemaVersion: '1.0.0',
        snapshotId,
        projectId: readScope.activeProjectId,
        viewKind: request.viewKind,
        projectionRevision: 'proj-1',
        generatedAt: '2026-08-04T08:00:00.000Z',
      },
      health: 'COMPLETE',
      completeness: hasMore ? 'PARTIAL' : 'COMPLETE',
      nodes: page,
      edges: this.edges,
      appliedLimits: {
        ...effLimits,
        schemaVersion: '1.0.0',
        requestedMaxDepth: null,
        requestedMaxNodes: null,
        requestedMaxEdges: null,
        clamped: false,
      },
      overlays: [],
      capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
    };
  }

  async neighborhood(
    readScope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['neighborhood']>[1],
  ): Promise<GraphNeighborhoodResultV1> {
    const nodes = this.visible(this.nodes);
    const offset = this.cursors.get(request.snapshotId) ?? 0;
    const effectiveLimits = request.limits ?? limits();
    const maxNodes = effectiveLimits.maxNodes;
    const { page, hasMore } = this.page(nodes, offset, maxNodes);
    this.cursors.set(request.snapshotId, offset + maxNodes);
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      centerRef: request.centerRef,
      addedNodes: page,
      addedEdges: [],
      completeness: hasMore ? 'PARTIAL' : 'COMPLETE',
      appliedLimits: {
        ...effectiveLimits,
        schemaVersion: '1.0.0',
        requestedMaxDepth: null,
        requestedMaxNodes: null,
        requestedMaxEdges: null,
        clamped: false,
      },
    };
  }

  async path(): Promise<GraphPathResultV1> {
    throw new Error('not used');
  }
  async pathDescription(): Promise<GraphPathDescriptionV1> {
    throw new Error('not used');
  }
  async evidenceDetail(): Promise<GraphEvidenceDetailResultV1> {
    throw new Error('not used');
  }
  async refresh(): Promise<GraphSnapshotResultV1> {
    throw new Error('not used');
  }
  async restore(): Promise<GraphRestoreResultV1> {
    throw new Error('not used');
  }
  async recursiveImpact(
    _scope: GraphReadScopeV1,
    _request: GraphRecursiveImpactOverlayRequestV1,
    _baseSnapshotId: string,
  ): Promise<GraphOverlayResultV1> {
    throw new Error('not used');
  }
}

const buildDomain = (nodeCount: number, maxNodes = PAGE_SIZE): GraphReadDomain => {
  const fixture = new PaginatedFixtureReadPort(
    Array.from({ length: nodeCount }, (_, i) => node(i + 1)),
  );
  return createGraphReadDomain({
    readPort: fixture,
    impactPort: fixture,
    snapshotContextStore: createInMemorySnapshotContextStore(),
    healthStore: createInMemoryHealthStore(),
  });
};

describe('FE-P3-S3 AC-05 — positive PARTIAL continuation round-trip', () => {
  it('pages a 12-node fixture through PARTIAL + continuation to COMPLETE with no duplicates', async () => {
    const domain = buildDomain(12, 5);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: limits(5),
    });
    expect(snapshot.completeness).toBe('PARTIAL');
    expect(snapshot.nodes.length).toBe(5);

    const collected = [...snapshot.nodes.map((entry) => entry.nodeId)];
    let token = snapshot.continuation?.token;
    let neighborhoodCalls = 0;

    // 12 nodes / 5 per page = 3 pages: snapshot page + 2 neighborhood pages.
    while (token) {
      neighborhoodCalls += 1;
      const result = await domain.neighborhood(readScope, {
        schemaVersion: '1.0.0',
        snapshotId: snapshot.identity.snapshotId,
        projectionRevision: snapshot.identity.projectionRevision,
        centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
        continuationToken: token,
        limits: limits(5),
      });
      collected.push(...result.addedNodes.map((entry) => entry.nodeId));
      if (result.completeness === 'COMPLETE') {
        expect(result.continuation).toBeUndefined();
        token = undefined;
      } else {
        expect(result.completeness).toBe('PARTIAL');
        expect(result.continuation?.token).toBeTruthy();
        token = result.continuation?.token;
      }
    }

    expect(neighborhoodCalls).toBe(2);
    expect(new Set(collected).size).toBe(collected.length); // no duplicate IDs
    expect(collected.sort()).toEqual(Array.from({ length: 12 }, (_, i) => `node-${i + 1}`).sort());
  });

  it('rejects continuation token reuse with a different limits binding', async () => {
    const domain = buildDomain(12, 5);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: limits(5),
    });
    const token = snapshot.continuation?.token;
    expect(token).toBeTruthy();

    await expect(
      domain.neighborhood(readScope, {
        schemaVersion: '1.0.0',
        snapshotId: snapshot.identity.snapshotId,
        projectionRevision: snapshot.identity.projectionRevision,
        centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
        continuationToken: token,
        limits: limits(3),
      }),
    ).rejects.toThrow(/limits mismatch/);
  });

  it('rejects continuation token reuse with a different filters binding', async () => {
    const domain = buildDomain(12, 5);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: limits(5),
    });
    const token = snapshot.continuation?.token;
    expect(token).toBeTruthy();

    const filters: GraphFilterSetV1 = {
      schemaVersion: '1.0.0',
      authorityFilters: ['CANONICAL'],
    };
    await expect(
      domain.neighborhood(readScope, {
        schemaVersion: '1.0.0',
        snapshotId: snapshot.identity.snapshotId,
        projectionRevision: snapshot.identity.projectionRevision,
        centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
        continuationToken: token,
        filters,
        limits: limits(5),
      }),
    ).rejects.toThrow(FrontendContractError);
  });
});
