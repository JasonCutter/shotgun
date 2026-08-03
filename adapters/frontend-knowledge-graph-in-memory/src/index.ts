import {
  FrontendContractError,
  type GraphNodeReferenceV1,
} from '../../../packages/contracts/src/index.js';
import type {
  GraphSnapshotContextDescriptorV1,
  SnapshotContextStorePort,
} from '../../../modules/frontend-knowledge-graph/src/index.js';
import type {
  GraphContinuationRecordV1,
  GraphOverlayHealthRecordV1,
  GraphProjectionHealthRecordV1,
  HealthStorePort,
} from '../../../modules/frontend-knowledge-graph/src/index.js';

/**
 * In-memory FE-P3-S3 stores (ADR-127 parity boundary). Ephemeral computation is
 * shared code; only these four stores are adapter-specific.
 */

export const createInMemorySnapshotContextStore = (): SnapshotContextStorePort => {
  const contexts = new Map<string, GraphSnapshotContextDescriptorV1>();
  return {
    async write(context) {
      if (contexts.has(context.snapshotId)) {
        throw new FrontendContractError('CONFLICT', `snapshot context ${context.snapshotId} already exists`);
      }
      contexts.set(context.snapshotId, context);
    },
    async resolve(projectId, snapshotId) {
      const context = contexts.get(snapshotId);
      if (!context || context.projectId !== projectId) return undefined;
      return context;
    },
    async pruneExpired(nowIso) {
      const now = Date.parse(nowIso);
      for (const [snapshotId, context] of contexts) {
        if (Date.parse(context.expiresAt) <= now) contexts.delete(snapshotId);
      }
    },
  };
};

export const createInMemoryHealthStore = (): HealthStorePort => {
  const projectionHealth = new Map<string, GraphProjectionHealthRecordV1>();
  const overlayHealth = new Map<string, GraphOverlayHealthRecordV1>();
  const continuations = new Map<string, GraphContinuationRecordV1>();

  return {
    async upsertProjectionHealth(record) {
      projectionHealth.set(`${record.projectId}:${record.viewKind}`, record);
    },
    async getProjectionHealth(projectId, viewKind) {
      return projectionHealth.get(`${projectId}:${viewKind}`);
    },
    async upsertOverlayHealth(record) {
      overlayHealth.set(`${record.projectId}:${record.baseSnapshotId}:${record.overlayKind}`, record);
    },
    async getOverlayHealth(projectId, baseSnapshotId, overlayKind) {
      return overlayHealth.get(`${projectId}:${baseSnapshotId}:${overlayKind}`);
    },
    async writeContinuation(record) {
      continuations.set(record.token, record);
    },
    async findContinuation(token) {
      return continuations.get(token);
    },
    async deleteContinuation(token) {
      continuations.delete(token);
    },
    async pruneExpired(nowIso) {
      const now = Date.parse(nowIso);
      for (const [token, record] of continuations) {
        if (Date.parse(record.expiresAt) <= now) continuations.delete(token);
      }
    },
  };
};

/**
 * Reference fixture GraphReadPort used by the in-memory parity and integration
 * tests. In production the Stage 9 / Canonical / Compiled Truth adapter
 * (adapters/stage9-graph-read) fills this port.
 */
export type FixtureGraphNode = {
  readonly nodeId: string;
  readonly resourceKind: GraphNodeReferenceV1['resourceKind'];
  readonly resourceId: string;
  readonly label: string;
  readonly authority: 'CANONICAL' | 'DERIVED_INFERENCE' | 'DISCOVERY_CANDIDATE';
  readonly overlayMemberships: readonly ('CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT')[];
};

export type FixtureGraphEdge = {
  readonly edgeId: string;
  readonly fromResourceId: string;
  readonly toResourceId: string;
  readonly edgeSemanticKind:
    | 'CANONICAL_RELATION'
    | 'EVIDENCE_LINKAGE'
    | 'POSSIBLY_SAME'
    | 'CONFLICT'
    | 'KNOWLEDGE_GAP'
    | 'GOVERNANCE_IMPACT'
    | 'OPERATIONAL_DEPENDENCY'
    | 'TEMPORAL_RELATIONSHIP';
  readonly authority: 'CANONICAL' | 'DERIVED_INFERENCE' | 'DISCOVERY_CANDIDATE';
  readonly overlayMemberships: readonly ('CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT')[];
};

export const createFixtureGraphReadPort = (
  nodes: readonly FixtureGraphNode[],
  edges: readonly FixtureGraphEdge[],
): {
  snapshot: () => {
    nodes: import('../../../packages/contracts/src/index.js').GraphNodeV1[];
    edges: import('../../../packages/contracts/src/index.js').GraphEdgeV1[];
  };
} => {
  const revisionBinding = {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'proj-fixture',
    policyContextRevision: 'policy-1',
    accessRevision: 'access-1',
  };
  const graphNodes = nodes.map((node) => ({
    schemaVersion: '1.0.0' as const,
    nodeId: node.nodeId,
    resourceRef: {
      schemaVersion: '1.0.0' as const,
      resourceKind: node.resourceKind,
      resourceId: node.resourceId,
    },
    label: node.label,
    nodeKind: node.resourceKind,
    authority: node.authority,
    baseViewMembership: 'KNOWLEDGE_SEMANTIC' as const,
    overlayMemberships: node.overlayMemberships,
    revisionBinding,
    accessMasking: 'VISIBLE' as const,
  }));
  const byId = new Map(graphNodes.map((node) => [node.resourceRef.resourceId, node]));
  const graphEdges = edges
    .filter((edge) => byId.has(edge.fromResourceId) && byId.has(edge.toResourceId))
    .map((edge) => ({
      schemaVersion: '1.0.0' as const,
      edgeId: edge.edgeId,
      from: byId.get(edge.fromResourceId)!.resourceRef,
      to: byId.get(edge.toResourceId)!.resourceRef,
      edgeSemanticKind: edge.edgeSemanticKind,
      authority: edge.authority,
      baseViewMembership: 'KNOWLEDGE_SEMANTIC' as const,
      overlayMemberships: edge.overlayMemberships,
      revisionBinding,
      accessMasking: 'VISIBLE' as const,
    }));
  return {
    snapshot: () => ({ nodes: graphNodes, edges: graphEdges }),
  };
};
