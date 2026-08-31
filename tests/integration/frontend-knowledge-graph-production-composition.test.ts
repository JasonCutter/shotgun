import { describe, expect, it } from 'vitest';

import { PostgresCompiledTruthGraphReadAdapter } from '../../adapters/frontend-knowledge-graph-postgres/compiled-truth-graph-read.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import {
  createInMemoryHealthStore,
  createInMemorySnapshotContextStore,
} from '../../adapters/frontend-knowledge-graph-in-memory/src/index.js';
import {
  createGraphDiscoveryOverlayPort,
  createGraphReadDomain,
  type GraphReadScopeV1,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type {
  CompiledTruthProjection,
  DiscoveryProductFindingDetailV1,
} from '../../packages/contracts/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../modules/compiled-truth/src/index.js';

const scope: GraphReadScopeV1 = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
  discoveryContext: {
    activeProject: {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private',
    },
    accessibleProjects: [],
  },
};

const projection = (nodeCount = 2): CompiledTruthProjection => {
  const items = Array.from({ length: nodeCount }, (_, index) => ({
    id: `entity-${index + 1}`,
    type: 'ENTITY' as const,
    label: `Entity ${index + 1}`,
    state: 'CURRENT' as const,
    source: 'APPROVED_KNOWLEDGE' as const,
    evidenceIds: ['evidence-1'],
    accessScope: ['owner'],
    sensitivity: 'private' as const,
  }));
  return {
    projectId: 'project-1',
    projectorVersion: '1.0.0',
    sourceSnapshotDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    logicalDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    canonicalVersion: 1,
    items,
    graph: {
      nodes: items,
      edges: [
        {
          id: 'relation-1',
          from: 'entity-1',
          to: 'entity-2',
          relationType: 'RELATED_TO',
          direction: 'DIRECTED',
          source: 'APPROVED_TYPED_EDGE',
        },
      ],
      fallback: { available: true, modes: ['LIST', 'TABLE'] },
    },
    projectedAt: '2026-08-31T00:00:00.000Z',
    buildMode: 'FULL_REBUILD',
  };
};

const finding = (sourceProjectId = 'project-1'): DiscoveryProductFindingDetailV1 => {
  const resource = (resourceId: string) => ({
    schemaVersion: '1.0.0' as const,
    resourceKind: 'CANONICAL_ENTITY' as const,
    resourceId,
    projectId: sourceProjectId,
    resourceState: 'CURRENT' as const,
  });
  return {
    schemaVersion: '1.0.0',
    findingId: 'finding-1',
    findingRevision: 4,
    projectId: 'project-1',
    findingType: 'RELATION_HYPOTHESIS',
    authority: 'DERIVED_INFERENCE',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'REVIEW_READY',
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
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 1,
        snapshotDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'compiled-truth:1.0.0:1',
        projectionDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
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
      sourceEndpoint: resource('entity-1'),
      targetEndpoint: resource('entity-2'),
      proposedRelationType: 'RELATED_TO',
      direction: 'DIRECTED',
    },
    lineage: {
      schemaVersion: '1.0.0',
      relatedResourceRefs: [resource('entity-1'), resource('entity-2')],
      evidence: [
        {
          schemaVersion: '1.0.0',
          evidenceId: 'evidence-1',
          evidenceRevisionId: 'evidence-revision-1',
          sourceId: 'source-1',
          sourceVersionId: 'source-version-1',
        },
      ],
      sourceProjectionDigest:
        'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 1,
        snapshotDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'compiled-truth:1.0.0:1',
        projectionDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
      provenance: { schemaVersion: '1.0.0', kind: 'DETERMINISTIC' },
    },
  };
};

const build = (
  currentProjection = projection(),
  currentFinding = finding(),
  canonicalVersion = 1,
) => {
  const repository = {
    findProjection: async () => currentProjection,
    degradedState: async () => undefined,
  } as unknown as CompiledTruthRepositoryPort;
  const canonical = {
    getSnapshot: async () => ({ version: canonicalVersion }),
  } as never;
  const readPort = new PostgresCompiledTruthGraphReadAdapter(repository, canonical);
  const overlayPort = createGraphDiscoveryOverlayPort({
    readFinding: async () => currentFinding,
  });
  const domain = createGraphReadDomain({
    readPort,
    impactPort: readPort,
    snapshotContextStore: createInMemorySnapshotContextStore(),
    healthStore: createInMemoryHealthStore(),
    discoveryOverlayPort: overlayPort,
  });
  return { domain, readPort };
};

describe('AKP-6 WP3 production Graph composition', () => {
  it('materializes authorized Finding roots from persisted Compiled Truth and binds the exact overlay', async () => {
    const { domain } = build();
    const base = await domain.discoverySnapshot(
      scope,
      { schemaVersion: '1.0.0', viewKind: 'KNOWLEDGE_SEMANTIC', overlayKinds: [] },
      'finding-1',
      4,
    );
    expect(base.health).toBe('COMPLETE');
    expect(base.nodes.map((node) => node.resourceRef.resourceId)).toEqual(['entity-1', 'entity-2']);
    expect(base.edges).toHaveLength(1);

    const overlay = await domain.discoveryOverlay(scope, {
      schemaVersion: '1.0.0',
      baseSnapshotId: base.identity.snapshotId,
      projectionRevision: base.identity.projectionRevision,
      overlayKind: 'DISCOVERY',
      findingId: 'finding-1',
      findingRevision: 4,
    });
    expect(overlay.health).toBe('COMPLETE');
    expect(overlay.identity.sourceRef).toEqual({
      kind: 'DISCOVERY_FINDING',
      findingId: 'finding-1',
      findingRevision: 4,
    });
    expect(overlay.edges[0]).toMatchObject({
      edgeSemanticKind: 'DISCOVERY_CANDIDATE',
      from: { resourceId: 'entity-1' },
      to: { resourceId: 'entity-2' },
    });
  });

  it('exercises the protected production Graph route with server-derived Finding roots', async () => {
    const { domain } = build();
    const auth = new InMemoryAuthRepository();
    const projects = new InMemoryProjectAdministrationRepository(undefined, false);
    await auth.bootstrapOwner({
      accountId: 'graph-production-owner',
      projectId: 'project-1',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('graph-production-owner');
    if (!principal) throw new Error('Production Graph fixture Principal was not created.');
    await projects.createProject({
      commandId: 'graph-production-project-create',
      clientRequestId: 'graph-production-project-create',
      idempotencyKey: 'graph-production-project-create',
      projectId: 'project-1',
      name: 'Project One',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    projects.activateProjectForBootstrap('project-1');
    const session = await auth.createSession(
      principal.principalId,
      'project-1',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const app = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
      graphReadDomain: domain,
    });
    const cookie = `shotgun_session=${session.sessionToken}`;
    const csrfResponse = await app.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    });
    const csrf = csrfResponse.json<{ csrfToken?: string }>();
    const response = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/graph/snapshot/discovery/finding-1/4',
      headers: { cookie, 'x-csrf-token': csrf.csrfToken ?? '' },
      payload: {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: [],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ health?: string; nodes?: unknown[] }>().health).toBe('COMPLETE');
    expect(response.json<{ nodes?: unknown[] }>().nodes).toHaveLength(2);
  });

  it('roots a target beyond the normal snapshot limit without exposing unrelated resources', async () => {
    const { domain } = build(projection(600));
    const base = await domain.discoverySnapshot(
      scope,
      { schemaVersion: '1.0.0', viewKind: 'KNOWLEDGE_SEMANTIC', overlayKinds: [] },
      'finding-1',
      4,
    );
    expect(base.nodes).toHaveLength(2);
    expect(
      base.nodes.every((node) => ['entity-1', 'entity-2'].includes(node.resourceRef.resourceId)),
    ).toBe(true);
  });

  it('reports stale Compiled Truth as unusable and fails Discovery overlay closed', async () => {
    const { domain, readPort } = build(projection(), finding(), 2);
    expect(await readPort.canReadGraph('project-1')).toBe(false);
    const base = await domain.snapshot(scope, {
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
    });
    expect(base.health).toBe('STALE');
    const overlay = await domain.discoveryOverlay(scope, {
      schemaVersion: '1.0.0',
      baseSnapshotId: base.identity.snapshotId,
      projectionRevision: base.identity.projectionRevision,
      overlayKind: 'DISCOVERY',
      findingId: 'finding-1',
      findingRevision: 4,
    });
    expect(overlay.health).toBe('UNAVAILABLE');
  });

  it('rejects a Finding whose endpoint belongs to another project before graph materialization', async () => {
    const { domain } = build(projection(), finding('project-foreign'));
    await expect(
      domain.discoverySnapshot(
        scope,
        { schemaVersion: '1.0.0', viewKind: 'KNOWLEDGE_SEMANTIC', overlayKinds: [] },
        'finding-1',
        4,
      ),
    ).rejects.toThrow(/authorized graph roots/);
  });
});
