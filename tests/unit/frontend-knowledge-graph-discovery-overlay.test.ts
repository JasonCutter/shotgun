import { describe, expect, it } from 'vitest';

import {
  createGraphDiscoveryOverlayPort,
  type GraphReadScopeV1,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import type {
  DiscoveryProductFindingDetailV1,
  GraphNodeV1,
  GraphSnapshotResultV1,
} from '../../packages/contracts/src/index.js';

const scope: GraphReadScopeV1 = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
};

const relationRef = (resourceId: string) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind: 'CANONICAL_ENTITY' as const,
  resourceId,
  projectId: 'project-1',
  resourceState: 'CURRENT' as const,
});

const baseNode = (resourceId: string): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId: `node-${resourceId}`,
  resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId },
  label: resourceId,
  nodeKind: 'ENTITY',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-1',
    policyContextRevision: 'policy-1',
    accessRevision: 'access-1',
  },
  accessMasking: 'VISIBLE',
  payload: {
    schemaVersion: '1.0.0',
    nodeKind: 'ENTITY',
    entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: resourceId },
  },
});

const baseSnapshot: GraphSnapshotResultV1 = {
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId: 'snapshot-1',
    projectId: 'project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'projection-1',
    generatedAt: '2026-08-31T00:00:00.000Z',
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: [baseNode('entity-a'), baseNode('entity-b')],
  edges: [],
  appliedLimits: {
    schemaVersion: '1.0.0',
    maxDepth: 3,
    maxNodes: 20,
    maxEdges: 20,
    traversalBudget: 1000,
    serverTimeoutBudgetMs: 5000,
    requestedMaxDepth: null,
    requestedMaxNodes: null,
    requestedMaxEdges: null,
    clamped: false,
  },
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
};

const detail = (lifecycleState: 'NEW' | 'DISMISSED' = 'NEW') =>
  ({
    schemaVersion: '1.0.0',
    findingId: 'finding-1',
    findingRevision: 4,
    projectId: 'project-1',
    findingType: 'RELATION_HYPOTHESIS',
    authority: 'DERIVED_INFERENCE',
    generationMethod: 'DETERMINISTIC',
    lifecycleState,
    title: 'Candidate relation',
    summary: 'A candidate relation between two current resources.',
    rationale: 'Bounded rationale',
    derivationSummary: 'Bounded derivation',
    safeSignals: {},
    governance: {
      schemaVersion: '1.0.0',
      reentryState: 'NOT_REQUESTED',
      validationState: 'VALIDATED',
      reviewReadiness: 'NOT_ELIGIBLE',
    },
    freshness: {
      schemaVersion: '1.0.0',
      state: 'UNKNOWN',
      canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 1, snapshotDigest: 'sha256:c' },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-1',
        projectionDigest: 'sha256:d',
      },
    },
    runId: 'run-1',
    capabilities: {
      schemaVersion: '1.0.0',
      canOpenReview: false,
      canInspectEvidence: true,
      canOpenGraph: true,
      canOpenActivity: false,
      canInvestigate: false,
    },
    createdAt: '2026-08-31T00:00:00.000Z',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'RELATION_HYPOTHESIS',
      sourceEndpoint: relationRef('entity-a'),
      targetEndpoint: relationRef('entity-b'),
      proposedRelationType: 'RELATED_TO',
      direction: 'DIRECTED',
    },
    lineage: {
      schemaVersion: '1.0.0',
      relatedResourceRefs: [relationRef('entity-a'), relationRef('entity-b')],
      evidence: [
        {
          schemaVersion: '1.0.0',
          evidenceId: 'evidence-1',
          evidenceRevisionId: 'evidence-revision-1',
          sourceId: 'source-1',
          sourceVersionId: 'source-version-1',
        },
      ],
      sourceProjectionDigest: 'sha256:d',
      canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 1, snapshotDigest: 'sha256:c' },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-1',
        projectionDigest: 'sha256:d',
      },
      provenance: { schemaVersion: '1.0.0', kind: 'DETERMINISTIC' },
    },
  }) as DiscoveryProductFindingDetailV1;

const request = {
  schemaVersion: '1.0.0' as const,
  baseSnapshotId: 'snapshot-1',
  projectionRevision: 'projection-1',
  overlayKind: 'DISCOVERY' as const,
  findingId: 'finding-1',
  findingRevision: 4,
};

describe('AKP-6 WP3 Discovery graph overlay binding', () => {
  it('maps a current authorized relation to a non-Canonical candidate edge', async () => {
    const port = createGraphDiscoveryOverlayPort({
      readFinding: async () => detail(),
    });
    const result = await port.discoveryOverlay(scope, request, baseSnapshot);

    expect(result.health).toBe('COMPLETE');
    expect(result.identity.sourceRef).toEqual({
      kind: 'DISCOVERY_FINDING',
      findingId: 'finding-1',
      findingRevision: 4,
    });
    expect(result.edges[0]).toMatchObject({
      edgeSemanticKind: 'DISCOVERY_CANDIDATE',
      authority: 'DISCOVERY_CANDIDATE',
      overlayMemberships: ['DISCOVERY'],
      from: { resourceKind: 'ENTITY', resourceId: 'entity-a' },
      to: { resourceKind: 'ENTITY', resourceId: 'entity-b' },
      evidence: {
        evidenceIds: ['evidence-1'],
        sourceIds: ['source-1'],
        sourceVersionIds: ['source-version-1'],
        evidenceSpanIds: [],
      },
    });
    expect(result.nodes).toEqual([]);
  });

  it('fails closed for terminal lifecycle or an unavailable current endpoint', async () => {
    const terminalPort = createGraphDiscoveryOverlayPort({
      readFinding: async () => detail('DISMISSED'),
    });
    const terminal = await terminalPort.discoveryOverlay(scope, request, baseSnapshot);
    expect(terminal.health).toBe('UNAVAILABLE');
    expect(terminal.nodes).toEqual([]);
    expect(terminal.edges).toEqual([]);

    const missingPort = createGraphDiscoveryOverlayPort({
      readFinding: async () => detail(),
    });
    const missing = await missingPort.discoveryOverlay(scope, request, {
      ...baseSnapshot,
      nodes: [baseNode('entity-a')],
    });
    expect(missing.health).toBe('UNAVAILABLE');
    expect(missing.identity.unavailableReason).toBe('DEEP_LINK_TARGET_UNAVAILABLE');
  });
});
