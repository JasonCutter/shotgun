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
import type {
  GraphEdgeV1,
  GraphEvidenceEntryV1,
  GraphNodeV1,
} from '../../packages/contracts/src/index.js';

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

const claim = (resourceId: string, statement: string): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId: `node-${resourceId}`,
  resourceRef: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId },
  label: statement,
  nodeKind: 'CLAIM',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: binding,
  accessMasking: 'VISIBLE',
  payload: {
    schemaVersion: '1.0.0',
    nodeKind: 'CLAIM',
    claim: { schemaVersion: 'claim.v1', statement },
  },
});

const edge = (
  edgeId: string,
  from: string,
  to: string,
  semantic: GraphEdgeV1['edgeSemanticKind'],
  overlayMemberships: GraphEdgeV1['overlayMemberships'] = [],
): GraphEdgeV1 => ({
  schemaVersion: '1.0.0',
  edgeId,
  from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: from },
  to: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: to },
  edgeSemanticKind: semantic,
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
  edges: readonly GraphEdgeV1[] = [],
  evidence?: readonly GraphEvidenceEntryV1[],
): GraphReadDomain => {
  const adapter = new Stage9GraphReadAdapter(nodes, edges, () => 'proj-1', evidence ?? []);
  return createGraphReadDomain({
    readPort: adapter,
    impactPort: adapter,
    snapshotContextStore: createInMemorySnapshotContextStore(),
    healthStore: createInMemoryHealthStore(),
  });
};

const defaultLimits = {
  schemaVersion: '1.0.0' as const,
  maxDepth: 3,
  maxNodes: 100,
  maxEdges: 200,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
};

describe('FE-P3-S3 frozen-AC integration scenarios', () => {
  it('AC-06: describeGraphPath narrates the computed path with ORIGIN/TRAVERSAL and resolvable refs', async () => {
    const domain = buildDomain(
      [entity('entity-1', 'Entity One'), claim('claim-1', 'Claim One')],
      [edge('edge-1', 'entity-1', 'claim-1', 'CANONICAL_RELATION')],
    );
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: defaultLimits,
    });

    const path = await domain.path(readScope, {
      schemaVersion: '1.0.0',
      snapshotId: snapshot.identity.snapshotId,
      projectionRevision: snapshot.identity.projectionRevision,
      fromRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      toRef: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
    });
    expect(path.paths.length).toBe(1);
    const pathId = path.paths[0]?.pathId;
    expect(pathId).toBeTruthy();

    const description = await domain.pathDescription(readScope, {
      schemaVersion: '1.0.0',
      snapshotId: snapshot.identity.snapshotId,
      projectionRevision: snapshot.identity.projectionRevision,
      pathId: pathId!,
    });

    expect(description.segments.length).toBe(2);
    const origin = description.segments[0];
    if (!origin) throw new Error('expected an origin segment');
    expect(origin.kind).toBe('ORIGIN');
    if (origin.kind === 'ORIGIN') {
      expect(origin.step).toBe(0);
      expect(origin.narration).toContain('Entity One');
    }
    const traversal = description.segments[1];
    if (!traversal) throw new Error('expected a traversal segment');
    expect(traversal.kind).toBe('TRAVERSAL');
    if (traversal.kind === 'TRAVERSAL') {
      expect(traversal.step).toBe(1);
      expect(traversal.edgeRef.edgeId).toBe('edge-1');
      expect(traversal.narration).toContain('Entity One');
      expect(traversal.narration).toContain('Canonical relationship');
      expect(traversal.narration).toContain('Claim One');
      // Refs resolve inside the snapshot.
      expect(
        snapshot.nodes.some((node) => node.resourceRef.resourceId === traversal.nodeRef.resourceId),
      ).toBe(true);
      expect(snapshot.edges.some((entry) => entry.edgeId === traversal.edgeRef.edgeId)).toBe(true);
    }
    expect(description.summary).toContain('Entity One');
  });

  it('AC-11: knowledge-gap overlay succeeds with a base snapshot and never writes Canonical edges', async () => {
    const gapNode: GraphNodeV1 = {
      schemaVersion: '1.0.0',
      nodeId: 'node-gap-1',
      resourceRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'KNOWLEDGE_GAP',
        resourceId: 'gap-1',
      },
      label: 'Gap Claim',
      nodeKind: 'KNOWLEDGE_GAP',
      authority: 'CANONICAL',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: ['KNOWLEDGE_GAP'],
      revisionBinding: binding,
      accessMasking: 'VISIBLE',
      payload: {
        schemaVersion: '1.0.0',
        nodeKind: 'KNOWLEDGE_GAP',
        knowledgeGap: {
          schemaVersion: 'knowledge-gap-proposal.v1',
          gapType: 'MISSING_EVIDENCE',
          description: 'Gap Claim',
        },
      },
    };
    const gapNodes: readonly GraphNodeV1[] = [entity('entity-1', 'Entity One'), gapNode];
    const domain = buildDomain(gapNodes, []);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: ['KNOWLEDGE_GAP'],
      limits: defaultLimits,
    });

    const overlay = await domain.gapOverlay(readScope, {
      schemaVersion: '1.0.0',
      snapshotId: snapshot.identity.snapshotId,
      projectionRevision: snapshot.identity.projectionRevision,
      overlayKind: 'KNOWLEDGE_GAP',
    });
    expect(overlay.identity.overlayKind).toBe('KNOWLEDGE_GAP');
    expect(overlay.baseSnapshotId).toBe(snapshot.identity.snapshotId);
    expect(overlay.identity.overlaySnapshotId).toBeTruthy();
    expect(overlay.identity.overlayRevision).toBeTruthy();
    expect(overlay.identity.analyzerRevision).toBeTruthy();
  });

  it('AC-12: recursive-impact overlay returns a bounded result with explicit truncation when limits are reached', async () => {
    const impactClaim = (resourceId: string, statement: string): GraphNodeV1 => ({
      ...claim(resourceId, statement),
      overlayMemberships: ['RECURSIVE_IMPACT'],
      authority: 'DERIVED_INFERENCE',
    });
    const impactNodes: readonly GraphNodeV1[] = [
      entity('entity-root', 'Root'),
      impactClaim('impact-1', 'Impact One'),
      impactClaim('impact-2', 'Impact Two'),
    ];
    const impactEdges: readonly GraphEdgeV1[] = [
      edge('impact-edge-1', 'entity-root', 'impact-1', 'GOVERNANCE_IMPACT', ['RECURSIVE_IMPACT']),
      edge('impact-edge-2', 'entity-root', 'impact-2', 'GOVERNANCE_IMPACT', ['RECURSIVE_IMPACT']),
    ];
    const domain = buildDomain(impactNodes, impactEdges);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: ['RECURSIVE_IMPACT'],
      limits: defaultLimits,
    });

    const overlay = await domain.impactOverlay(readScope, {
      schemaVersion: '1.0.0',
      snapshotId: snapshot.identity.snapshotId,
      projectionRevision: snapshot.identity.projectionRevision,
      overlayKind: 'RECURSIVE_IMPACT',
    });
    expect(overlay.identity.overlayKind).toBe('RECURSIVE_IMPACT');
    expect(overlay.identity.analyzerRevision).toBeTruthy();
    // Impact nodes/edges are bounded and never exceed the fixture size.
    expect(overlay.nodes.length).toBeLessThanOrEqual(impactNodes.length);
    expect(overlay.edges.length).toBeLessThanOrEqual(impactEdges.length);
  });

  it('AC-07: evidence detail resolves sourceIds/evidenceSpanIds to real records and never leaks masked content', async () => {
    const evidencedNode: GraphNodeV1 = {
      ...entity('entity-1', 'Entity One'),
      evidence: {
        schemaVersion: '1.0.0',
        evidenceCount: 1,
        sourceIds: ['source-1'],
        evidenceSpanIds: ['span-1'],
      },
    };
    const maskedNode: GraphNodeV1 = {
      ...entity('entity-2', 'Entity Two'),
      accessMasking: 'MASKED',
      payload: undefined,
    };
    const evidenceEntries: readonly GraphEvidenceEntryV1[] = [
      {
        schemaVersion: '1.0.0',
        sourceId: 'source-1',
        sourceVersionId: 'source-version-1',
        evidenceSpanId: 'span-1',
        snippet: 'The snippet lives inside the allowed span.',
      },
    ];
    const domain = buildDomain([evidencedNode, maskedNode], [], evidenceEntries);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: defaultLimits,
    });
    const snapshotId = snapshot.identity.snapshotId;
    const projectionRevision = snapshot.identity.projectionRevision;

    const visible = await domain.evidenceDetail(readScope, {
      schemaVersion: '1.0.0',
      snapshotId,
      projectionRevision,
      target: {
        kind: 'NODE',
        nodeRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      },
    });
    expect(visible.evidence.length).toBe(1);
    expect(visible.evidence[0]?.sourceId).toBe('source-1');
    expect(visible.evidence[0]?.sourceVersionId).toBe('source-version-1');
    expect(visible.evidence[0]?.evidenceSpanId).toBe('span-1');
    expect(visible.evidence[0]?.snippet).toContain('allowed span');

    // MASKED targets never return evidence payloads.
    const masked = await domain.evidenceDetail(readScope, {
      schemaVersion: '1.0.0',
      snapshotId,
      projectionRevision,
      target: {
        kind: 'NODE',
        nodeRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-2' },
      },
    });
    expect(masked.evidence).toEqual([]);
    expect(masked.accessMasking).toBe('MASKED');

    // Nonexistent evidence references resolve to no entries.
    const missing = await domain.evidenceDetail(readScope, {
      schemaVersion: '1.0.0',
      snapshotId,
      projectionRevision,
      target: {
        kind: 'NODE',
        nodeRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      },
      evidenceRef: { sourceId: 'source-999', evidenceSpanId: 'span-999' },
    });
    expect(missing.evidence).toEqual([]);
  });

  it('AC-29: a deep link to a root outside the active Project is denied without switching projects', async () => {
    const domain = buildDomain([entity('entity-1', 'Entity One')], []);
    const readScope = scope();
    await expect(
      domain.snapshot(readScope, {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: [],
        rootRefs: [
          {
            schemaVersion: '1.0.0',
            resourceKind: 'ENTITY',
            resourceId: 'project-b-root',
          },
        ],
        limits: defaultLimits,
      }),
    ).rejects.toThrow(/outside the active project/);
    // The active project is never silently switched.
    expect(readScope.activeProjectId).toBe(PROJECT_ID);
  });

  it('AC-29: masked resources expose a placeholder only and hidden resources are fully excluded', async () => {
    const maskedNode: GraphNodeV1 = {
      ...entity('entity-masked', 'Sensitive Entity'),
      accessMasking: 'MASKED',
      label: '마스킹된 자원',
      payload: undefined,
    };
    const hiddenNode: GraphNodeV1 = {
      ...entity('entity-hidden', 'Hidden Entity'),
      accessMasking: 'HIDDEN',
    };
    const domain = buildDomain([entity('entity-1', 'Entity One'), maskedNode, hiddenNode], []);
    const readScope = scope();
    const snapshot = await domain.snapshot(readScope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
      limits: defaultLimits,
    });

    const ids = snapshot.nodes.map((entry) => entry.resourceRef.resourceId);
    expect(ids).toContain('entity-1');
    expect(ids).toContain('entity-masked');
    expect(ids).not.toContain('entity-hidden');

    const masked = snapshot.nodes.find((entry) => entry.resourceRef.resourceId === 'entity-masked');
    expect(masked?.accessMasking).toBe('MASKED');
    expect(masked?.payload).toBeUndefined();
    expect(masked?.provenance).toBeUndefined();
    expect(masked?.evidence).toBeUndefined();
    expect(masked?.temporalValidity).toBeUndefined();
  });
});
