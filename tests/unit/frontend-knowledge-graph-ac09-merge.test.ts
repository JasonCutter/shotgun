import { describe, expect, it } from 'vitest';

import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import { Stage9GraphReadAdapter } from '../../adapters/stage9-graph-read/src/index.js';
import {
  createGraphReadDomain,
  type GraphReadDomain,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import {
  createFrontendKnowledgeGraphClient,
  type FrontendKnowledgeGraphClient,
} from '../../packages/shotgun-api-client/src/index.js';
import type { GraphEdgeV1, GraphNodeV1 } from '../../packages/contracts/src/index.js';
import {
  createInitialGraphWorkspaceState,
  reduceGraphWorkspaceState,
  type GraphWorkspaceAction,
} from '../../apps/shotgun-web/src/knowledge/graph-workspace-state.js';

/**
 * AC-09: `POSSIBLY_SAME` remains a typed edge; no code path merges nodes. A
 * merge-like operation must be attempted and asserted to mutate nothing.
 * The graph domain, the API client and the browser state machine expose no
 * merge surface, and a snapshot containing `POSSIBLY_SAME` edges preserves
 * every distinct node.
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

const possiblySameEdge = (edgeId: string, from: string, to: string): GraphEdgeV1 => ({
  schemaVersion: '1.0.0',
  edgeId,
  from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: from },
  to: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: to },
  edgeSemanticKind: 'POSSIBLY_SAME',
  authority: 'DERIVED_INFERENCE',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: binding,
  accessMasking: 'VISIBLE',
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

const scope = () => ({
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: PROJECT_ID,
  accessRevision: ACCESS,
  policyContextRevision: POLICY,
  accessScope: [],
});

const defaultLimits = {
  schemaVersion: '1.0.0' as const,
  maxDepth: 3,
  maxNodes: 100,
  maxEdges: 200,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
};

describe('AC-09: POSSIBLY_SAME is a typed edge and no code path merges nodes', () => {
  it('keeps every distinct node and the typed POSSIBLY_SAME edge in a snapshot (no merge)', async () => {
    // Two entities that look identical plus a claim, joined by POSSIBLY_SAME
    // edges — exactly the situation a node-merge would collapse.
    const domain = buildDomain(
      [
        entity('entity-1', 'Entity One'),
        entity('entity-2', 'Entity One'),
        entity('entity-3', 'Entity Three'),
      ],
      [
        possiblySameEdge('edge-1', 'entity-1', 'entity-2'),
        possiblySameEdge('edge-2', 'entity-2', 'entity-3'),
      ],
    );
    const snapshot = await domain.snapshot(scope(), {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: defaultLimits,
    });

    // No merge occurred: all three nodes survive with distinct ids and refs.
    expect(snapshot.nodes.length).toBe(3);
    expect(new Set(snapshot.nodes.map((item) => item.nodeId)).size).toBe(3);
    expect(new Set(snapshot.nodes.map((item) => item.resourceRef.resourceId)).size).toBe(3);
    // POSSIBLY_SAME remains a typed edge in the snapshot.
    const sameEdges = snapshot.edges.filter((edge) => edge.edgeSemanticKind === 'POSSIBLY_SAME');
    expect(sameEdges.length).toBe(2);
    expect(sameEdges[0]?.edgeSemanticKind).toBe('POSSIBLY_SAME');
  });

  it('exposes no merge operation on the read domain surface', () => {
    const domain = buildDomain([entity('entity-1', 'Entity One')], []);
    const surface = domain as unknown as Record<string, unknown>;
    const mergeLike = Object.keys(surface).filter((key) => /merge/i.test(key));
    expect(mergeLike).toEqual([]);
  });

  it('exposes no merge method on the API client', () => {
    const client = createFrontendKnowledgeGraphClient() as unknown as FrontendKnowledgeGraphClient &
      Record<string, unknown>;
    const mergeLike = Object.keys(client).filter((key) => /merge/i.test(key));
    expect(mergeLike).toEqual([]);
    expect((client as Record<string, unknown>).mergeGraphNodes).toBeUndefined();
  });

  it('has no merge action in the browser state machine', () => {
    const initial = createInitialGraphWorkspaceState();
    // A merge-like action must be unrepresentable: the reducer never matches
    // one, so dispatching an unknown action leaves state unchanged.
    const unknown = { type: 'MERGE_NODES' } as unknown as GraphWorkspaceAction;
    const after = reduceGraphWorkspaceState(initial, unknown);
    expect(after).toBe(initial);
  });
});
