import type {
  GraphEdgeV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphSnapshotResultV1,
} from '@shotgun/api-client';

/**
 * AC-25: graph correction action → Knowledge Editor.
 *
 * A correction action on a graph node or edge builds a typed
 * `GraphCorrectionSeedV1` that carries the same stable resource refs as the
 * snapshot item, then navigates to the Knowledge Editor with the seed. The
 * seed is a frontend-local typed proposal: it never writes Canonical data,
 * never registers an Approval or Action, and is not a server authority. A
 * masked node yields a minimal seed (stable ref only, `masked: true`); a
 * hidden node yields no seed and no action.
 */

export type GraphCorrectionTargetKind = 'NODE' | 'EDGE';

export type GraphCorrectionSeedV1 = {
  schemaVersion: '1.0.0';
  sourceWorkspace: 'KNOWLEDGE_GRAPH';
  targetKind: GraphCorrectionTargetKind;
  stableResourceRef: GraphNodeReferenceV1;
  relatedResourceRefs: readonly GraphNodeReferenceV1[];
  snapshotId: string;
  projectionRevision: string;
  suggestedChangeIntent: 'CORRECT_KNOWLEDGE';
  masked: boolean;
};

export const GRAPH_CORRECTION_QUERY_KEY = 'correction';

/**
 * Builds a typed correction seed for a graph node. Returns `null` for a
 * HIDDEN node (no correction surface exists; the node is filtered from every
 * accessible view). A MASKED node yields the stable ref only with
 * `masked: true` — no label or payload ever leaves the graph boundary.
 */
export const buildGraphNodeCorrectionSeed = (
  snapshot: GraphSnapshotResultV1,
  node: GraphNodeV1,
): GraphCorrectionSeedV1 | null => {
  if (node.accessMasking === 'HIDDEN') return null;
  return {
    schemaVersion: '1.0.0',
    sourceWorkspace: 'KNOWLEDGE_GRAPH',
    targetKind: 'NODE',
    stableResourceRef: node.resourceRef,
    relatedResourceRefs: [],
    snapshotId: snapshot.identity.snapshotId,
    projectionRevision: snapshot.identity.projectionRevision,
    suggestedChangeIntent: 'CORRECT_KNOWLEDGE',
    masked: node.accessMasking === 'MASKED',
  };
};

/**
 * Builds a typed correction seed for a graph edge. The edge's stable refs
 * are its `from` and `to` node refs; the primary ref is `from`. A HIDDEN
 * edge yields `null`; a MASKED edge yields the refs only with `masked: true`.
 */
export const buildGraphEdgeCorrectionSeed = (
  snapshot: GraphSnapshotResultV1,
  edge: GraphEdgeV1,
): GraphCorrectionSeedV1 | null => {
  if (edge.accessMasking === 'HIDDEN') return null;
  return {
    schemaVersion: '1.0.0',
    sourceWorkspace: 'KNOWLEDGE_GRAPH',
    targetKind: 'EDGE',
    stableResourceRef: edge.from,
    relatedResourceRefs: [edge.to],
    snapshotId: snapshot.identity.snapshotId,
    projectionRevision: snapshot.identity.projectionRevision,
    suggestedChangeIntent: 'CORRECT_KNOWLEDGE',
    masked: edge.accessMasking === 'MASKED',
  };
};

export const encodeGraphCorrectionSeed = (seed: GraphCorrectionSeedV1): string =>
  JSON.stringify(seed);

const isNodeReference = (value: unknown): value is GraphNodeReferenceV1 => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['schemaVersion'] === '1.0.0' &&
    (record['resourceKind'] === 'ENTITY' || record['resourceKind'] === 'CLAIM') &&
    typeof record['resourceId'] === 'string' &&
    record['resourceId'].length > 0
  );
};

/**
 * Strictly decodes a correction seed from the URL query. Returns `null` for
 * any malformed payload — a malformed seed never reaches the editor and never
 * triggers a write.
 */
export const decodeGraphCorrectionSeed = (raw: string | null): GraphCorrectionSeedV1 | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (
    value['schemaVersion'] !== '1.0.0' ||
    value['sourceWorkspace'] !== 'KNOWLEDGE_GRAPH' ||
    (value['targetKind'] !== 'NODE' && value['targetKind'] !== 'EDGE') ||
    value['suggestedChangeIntent'] !== 'CORRECT_KNOWLEDGE' ||
    typeof value['snapshotId'] !== 'string' ||
    typeof value['projectionRevision'] !== 'string' ||
    typeof value['masked'] !== 'boolean' ||
    !isNodeReference(value['stableResourceRef'])
  ) {
    return null;
  }
  const related = value['relatedResourceRefs'];
  if (!Array.isArray(related) || !related.every(isNodeReference)) return null;
  return {
    schemaVersion: '1.0.0',
    sourceWorkspace: 'KNOWLEDGE_GRAPH',
    targetKind: value['targetKind'] as GraphCorrectionTargetKind,
    stableResourceRef: value['stableResourceRef'],
    relatedResourceRefs: related,
    snapshotId: value['snapshotId'],
    projectionRevision: value['projectionRevision'],
    suggestedChangeIntent: 'CORRECT_KNOWLEDGE',
    masked: value['masked'],
  };
};

export const correctionSeedQuery = (seed: GraphCorrectionSeedV1): string =>
  `${GRAPH_CORRECTION_QUERY_KEY}=${encodeURIComponent(encodeGraphCorrectionSeed(seed))}`;

// Referenced by the workspace for navigating to the Knowledge Editor.
export const graphCorrectionEditorHref = (seed: GraphCorrectionSeedV1): string =>
  `/knowledge?${correctionSeedQuery(seed)}`;
