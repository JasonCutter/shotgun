import type {
  GraphAuthorityClassificationV1,
  GraphBaseViewKindV1,
  GraphEdgeV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphOverlayKindV1,
} from '@shotgun/api-client';

/**
 * Information equivalence (AC-19): the canvas, list, table and path views
 * expose the identical set of accessible `(nodeId, edgeId, label, authority,
 * baseViewMembership, overlayMemberships)` tuples from the same snapshot
 * response. This module is the single source of truth for that tuple set so
 * the four views cannot drift.
 */

export type GraphAccessibleTuple =
  | {
      readonly kind: 'node';
      readonly nodeId: string;
      readonly label: string;
      readonly authority: GraphAuthorityClassificationV1;
      readonly baseViewMembership: GraphBaseViewKindV1;
      readonly overlayMemberships: readonly GraphOverlayKindV1[];
    }
  | {
      readonly kind: 'edge';
      readonly edgeId: string;
      readonly label: string;
      readonly authority: GraphAuthorityClassificationV1;
      readonly baseViewMembership: GraphBaseViewKindV1;
      readonly overlayMemberships: readonly GraphOverlayKindV1[];
    };

export const graphNodeTuples = (nodes: readonly GraphNodeV1[]): readonly GraphAccessibleTuple[] =>
  nodes
    .filter((node) => node.accessMasking !== 'HIDDEN')
    .map((node) => ({
      kind: 'node' as const,
      nodeId: node.nodeId,
      label: node.label,
      authority: node.authority,
      baseViewMembership: node.baseViewMembership,
      overlayMemberships: node.overlayMemberships,
    }));

export const graphEdgeTuples = (edges: readonly GraphEdgeV1[]): readonly GraphAccessibleTuple[] =>
  edges
    .filter((edge) => edge.accessMasking !== 'HIDDEN')
    .map((edge) => ({
      kind: 'edge' as const,
      edgeId: edge.edgeId,
      label: edge.payload?.relationType ?? edge.edgeSemanticKind,
      authority: edge.authority,
      baseViewMembership: edge.baseViewMembership,
      overlayMemberships: edge.overlayMemberships,
    }));

export const graphAccessibleTuples = (
  nodes: readonly GraphNodeV1[],
  edges: readonly GraphEdgeV1[],
): readonly GraphAccessibleTuple[] => [...graphNodeTuples(nodes), ...graphEdgeTuples(edges)];

/**
 * Canonical serialization used to compare the four views' accessible sets in
 * E2E tests and by the browser harness.
 */
export const graphTupleKey = (tuple: GraphAccessibleTuple): string =>
  tuple.kind === 'node'
    ? `node|${tuple.nodeId}|${tuple.label}|${tuple.authority}|${tuple.baseViewMembership}|${tuple.overlayMemberships.join(',')}`
    : `edge|${tuple.edgeId}|${tuple.label}|${tuple.authority}|${tuple.baseViewMembership}|${tuple.overlayMemberships.join(',')}`;

/**
 * Selection support maps a tuple's `nodeId` back to the server-issued
 * `GraphNodeReferenceV1` (resourceKind + resourceId) without adding fields to
 * the accessible tuple itself.
 */
export const graphNodeRefById = (
  nodes: readonly GraphNodeV1[],
): ReadonlyMap<string, GraphNodeReferenceV1> =>
  new Map(
    nodes
      .filter((node) => node.accessMasking !== 'HIDDEN')
      .map((node) => [node.nodeId, node.resourceRef]),
  );

export const graphSelectedNodeId = (
  nodes: readonly GraphNodeV1[],
  selectedRef: GraphNodeReferenceV1 | null,
): string | null => {
  if (!selectedRef) return null;
  const match = nodes.find((node) => node.resourceRef.resourceId === selectedRef.resourceId);
  return match?.nodeId ?? null;
};
