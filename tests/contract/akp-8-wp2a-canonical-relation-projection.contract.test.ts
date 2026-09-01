import { describe, expect, it } from 'vitest';

import { InMemoryCompiledTruthRepository } from '../../adapters/stage10-in-memory/src/index.js';
import { PostgresCompiledTruthGraphReadAdapter } from '../../adapters/frontend-knowledge-graph-postgres/compiled-truth-graph-read.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import type {
  CanonicalSnapshot,
  FrontendCanonicalCommitWrite,
  CompiledTruthProjection,
  KnowledgeReviewGroup,
  QueryResultEnvelope,
} from '../../packages/contracts/src/index.js';
import {
  canonicalRelationLogicalIdentityV1,
  canonicalSnapshotDigest,
} from '../../packages/contracts/src/index.js';
import { createCommand } from '../../packages/kernel/src/index.js';
import type { DispatchQueryInput, HandlerContext } from '../../packages/module-sdk/src/index.js';
import type { GraphReadScopeV1 } from '../../modules/frontend-knowledge-graph/src/index.js';

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const projectId = 'akp-8-wp2a-projection-project';

const entity = (candidateId: string, name: string) => ({
  candidateId,
  candidateType: 'ENTITY' as const,
  revisionNumber: 1,
  sourceVersionId: 'source-v1',
  evidenceIds: [`evidence:${candidateId}`],
  modelOutputs: [
    {
      provider: 'fixture',
      model: 'fixture-v1',
      value: name,
      evidenceIds: [`evidence:${candidateId}`],
    },
  ],
  name,
  entityKind: 'CONCEPT' as const,
  aliases: [],
  resolution: { status: 'NEW' as const },
});

const group: KnowledgeReviewGroup = {
  groupId: 'knowledge-group-v1',
  projectId,
  sourceVersionId: 'source-v1',
  revisionNumber: 1,
  status: 'APPROVED',
  contentDigest: digest('a'),
  items: [
    entity('entity:a', 'Entity A'),
    entity('entity:b', 'Entity B'),
    {
      candidateId: 'relation:precursor',
      candidateType: 'RELATION',
      revisionNumber: 1,
      sourceVersionId: 'source-v1',
      evidenceIds: ['evidence:relation'],
      modelOutputs: [
        {
          provider: 'fixture',
          model: 'fixture-v1',
          value: 'Entity A RELATED_TO Entity B',
          evidenceIds: ['evidence:relation'],
        },
      ],
      fromCandidateId: 'entity:a',
      toCandidateId: 'entity:b',
      relationType: 'RELATED_TO',
      direction: 'DIRECTED',
      validFrom: '2026-01-01T00:00:00.000Z',
    },
  ],
  decisions: [],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:01:00.000Z',
};

const canonical: CanonicalSnapshot = {
  snapshotId: 'canonical-snapshot-v2',
  projectId,
  version: 2,
  digest: digest('b'),
  claims: [],
  relations: [
    {
      relationId: 'relation:canonical:commit-1',
      logicalIdentityKey: 'canonical-relation:v1:entity-a-related-to-entity-b',
      revisionNumber: 1,
      relationType: 'RELATED_TO',
      fromEndpoint: {
        authority: 'APPROVED_KNOWLEDGE',
        resourceType: 'ENTITY',
        resourceId: 'entity:a',
        resourceRevision: 1,
      },
      toEndpoint: {
        authority: 'APPROVED_KNOWLEDGE',
        resourceType: 'ENTITY',
        resourceId: 'entity:b',
        resourceRevision: 1,
      },
      direction: 'DIRECTED',
      validFrom: '2026-01-01T00:00:00.000Z',
      evidenceIds: ['evidence:relation'],
    },
  ],
  relationPrecursorLinks: [
    {
      projectId,
      reviewResourceId: 'review-resource:relation',
      reviewResourceRevision: 1,
      relationId: 'relation:canonical:commit-1',
      relationRevision: 1,
      linkedAt: '2026-09-01T00:02:30.000Z',
    },
  ],
  createdAt: '2026-09-01T00:02:00.000Z',
};

const context: HandlerContext = {
  moduleId: 'stage10.compiled-truth',
  attemptNumber: 1,
  publish: async () => undefined,
  query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
    const payload =
      input.messageType === 'GetCanonicalSnapshot'
        ? canonical
        : input.messageType === 'ListKnowledgeGroups'
          ? { items: [group] }
          : undefined;
    if (payload === undefined) throw new Error(`Unexpected query ${input.messageType}`);
    return { payload } as QueryResultEnvelope<TResult>;
  },
};

const build = async (
  repository: InMemoryCompiledTruthRepository,
  mode: 'FULL_REBUILD' | 'INCREMENTAL',
  buildContext: HandlerContext = context,
) => {
  const module = createCompiledTruthModule(repository);
  const handler = module.handlers.commands.find(
    (candidate) => candidate.messageType === 'BuildCompiledTruth',
  );
  if (!handler) throw new Error('Compiled Truth build handler is missing.');
  return (await handler.handle(
    createCommand({
      messageType: 'BuildCompiledTruth',
      schemaVersion: '1.0.0',
      producerModule: 'akp-8-wp2a-contract-test',
      producerVersion: '1.0.0',
      idempotencyKey: `compiled-truth:${mode}`,
      projectId,
      actor: { type: 'user', id: 'owner' },
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'personal',
      },
      payload: { mode },
    }),
    buildContext,
  )) as CompiledTruthProjection;
};

describe('AKP-8 WP2A Canonical Relation projection contract', () => {
  it('projects one Canonical edge, suppresses the approved precursor, and is replay/rebuild stable', async () => {
    const repository = new InMemoryCompiledTruthRepository();
    const full = await build(repository, 'FULL_REBUILD');
    const fullEdges = full.graph.edges;

    expect(fullEdges).toEqual([
      {
        id: 'relation:canonical:commit-1',
        from: 'entity:a',
        to: 'entity:b',
        fromRevision: 1,
        toRevision: 1,
        relationType: 'RELATED_TO',
        direction: 'DIRECTED',
        validFrom: '2026-01-01T00:00:00.000Z',
        source: 'CANONICAL_RELATION',
      },
    ]);
    expect(fullEdges).toHaveLength(1);
    expect(fullEdges[0]?.source).toBe('CANONICAL_RELATION');
    expect(full.relationPrecursorLinks).toEqual(canonical.relationPrecursorLinks);

    const graphRead = new PostgresCompiledTruthGraphReadAdapter(repository, {
      readWatermark: async () => ({
        projectId,
        canonicalVersion: full.canonicalVersion,
        canonicalSnapshotDigest: canonical.digest,
        approvedKnowledgeDigest: digest('c'),
        sourceSnapshotDigest: full.sourceSnapshotDigest,
      }),
    });
    const graph = await graphRead.snapshot(
      {
        principalId: 'principal-1',
        sessionId: 'session-1',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        discoveryContext: {
          activeProject: {
            id: projectId,
            label: 'Projection Project',
            isOwner: true,
            sensitivityClearance: 'private',
          },
          accessibleProjects: [],
        },
      } satisfies GraphReadScopeV1,
      {
        schemaVersion: '1.0.0',
        viewKind: 'KNOWLEDGE_SEMANTIC',
        overlayKinds: [],
      },
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph).not.toHaveProperty('relationPrecursorLinks');
    expect(graph.edges[0]).toMatchObject({
      authority: 'CANONICAL',
      provenance: { generatedBy: 'CANONICAL' },
      from: { resourceKind: 'ENTITY', resourceId: 'entity:a' },
      to: { resourceKind: 'ENTITY', resourceId: 'entity:b' },
    });

    const replay = await build(repository, 'FULL_REBUILD');
    expect((await repository.findProjection(projectId))?.graph.edges).toHaveLength(1);
    expect(replay.logicalDigest).toBe(full.logicalDigest);

    const incremental = await build(repository, 'INCREMENTAL');
    expect(incremental.graph.edges).toEqual(full.graph.edges);
    expect(incremental.logicalDigest).toBe(full.logicalDigest);
  });

  it('does not suppress an approved typed edge when the Canonical relation has no precursor link', async () => {
    const repository = new InMemoryCompiledTruthRepository();
    const unlinkedContext: HandlerContext = {
      ...context,
      query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
        const payload =
          input.messageType === 'GetCanonicalSnapshot'
            ? { ...canonical, relationPrecursorLinks: undefined }
            : input.messageType === 'ListKnowledgeGroups'
              ? { items: [group] }
              : undefined;
        if (payload === undefined) throw new Error(`Unexpected query ${input.messageType}`);
        return { payload } as QueryResultEnvelope<TResult>;
      },
    };

    const projection = await build(repository, 'FULL_REBUILD', unlinkedContext);

    expect(projection.graph.edges).toHaveLength(2);
    expect(projection.graph.edges.map((edge) => edge.source).sort()).toEqual([
      'APPROVED_TYPED_EDGE',
      'CANONICAL_RELATION',
    ]);
  });

  it('does not suppress an approved typed edge when the linked Canonical relation has a temporal mismatch', async () => {
    const repository = new InMemoryCompiledTruthRepository();
    const temporalMismatchContext: HandlerContext = {
      ...context,
      query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
        const temporalMismatchCanonical = {
          ...canonical,
          relations: canonical.relations?.map((relation) => ({
            ...relation,
            validFrom: '2026-02-01T00:00:00.000Z',
          })),
        };
        const payload =
          input.messageType === 'GetCanonicalSnapshot'
            ? temporalMismatchCanonical
            : input.messageType === 'ListKnowledgeGroups'
              ? { items: [group] }
              : undefined;
        if (payload === undefined) throw new Error(`Unexpected query ${input.messageType}`);
        return { payload } as QueryResultEnvelope<TResult>;
      },
    };

    const projection = await build(repository, 'FULL_REBUILD', temporalMismatchContext);

    expect(projection.graph.edges).toHaveLength(2);
    expect(projection.graph.edges.map((edge) => edge.source).sort()).toEqual([
      'APPROVED_TYPED_EDGE',
      'CANONICAL_RELATION',
    ]);
  });

  it('fails closed when a Canonical Relation endpoint is not the exact approved Entity revision', async () => {
    const repository = new InMemoryCompiledTruthRepository();
    const invalidContext: HandlerContext = {
      ...context,
      query: async <TPayload, TResult>(input: DispatchQueryInput<TPayload>) => {
        const invalidCanonical = {
          ...canonical,
          relations: canonical.relations?.map((relation) => ({
            ...relation,
            toEndpoint: { ...relation.toEndpoint, resourceRevision: 2 },
          })),
        };
        const payload =
          input.messageType === 'GetCanonicalSnapshot'
            ? invalidCanonical
            : input.messageType === 'ListKnowledgeGroups'
              ? { items: [group] }
              : undefined;
        if (payload === undefined) throw new Error(`Unexpected query ${input.messageType}`);
        return { payload } as QueryResultEnvelope<TResult>;
      },
    };
    const module = createCompiledTruthModule(repository);
    const handler = module.handlers.commands.find(
      (candidate) => candidate.messageType === 'BuildCompiledTruth',
    );
    if (!handler) throw new Error('Compiled Truth build handler is missing.');
    await expect(
      handler.handle(
        createCommand({
          messageType: 'BuildCompiledTruth',
          schemaVersion: '1.0.0',
          producerModule: 'akp-8-wp2a-contract-test',
          producerVersion: '1.0.0',
          idempotencyKey: 'compiled-truth:invalid-endpoint',
          projectId,
          actor: { type: 'user', id: 'owner' },
          security: {
            accessScope: ['owner'],
            sensitivity: 'private',
            dataClassification: 'personal',
          },
          payload: { mode: 'FULL_REBUILD' },
        }),
        invalidContext,
      ),
    ).rejects.toThrow('exact approved Knowledge Entity revision');
  });

  it('keeps the in-memory replacement adapter relation-aware and replay-safe', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    const write: FrontendCanonicalCommitWrite = {
      commitId: 'commit:relation:replacement',
      revisionId: 'revision:relation:replacement',
      historyEventId: 'history:relation:replacement',
      outboxId: 'outbox:relation:replacement',
      projectId,
      operation: 'ADD_RELATION',
      relationId: 'relation:replacement',
      logicalIdentityKey: canonicalRelationLogicalIdentityV1({
        projectId,
        relationType: 'RELATED_TO',
        fromEndpoint: { projectId, ...canonical.relations![0]!.fromEndpoint },
        toEndpoint: { projectId, ...canonical.relations![0]!.toEndpoint },
        direction: 'DIRECTED',
        validFrom: canonical.relations![0]!.validFrom,
      }),
      relationType: 'RELATED_TO',
      fromEndpoint: { projectId, ...canonical.relations![0]!.fromEndpoint },
      toEndpoint: { projectId, ...canonical.relations![0]!.toEndpoint },
      direction: 'DIRECTED',
      validFrom: canonical.relations![0]!.validFrom,
      evidenceIds: ['evidence:relation'],
      accessScope: ['owner'],
      sensitivity: 'private',
      discoveryProvenanceRef: 'review-resource:relation',
      discoveryProvenanceRevision: 1,
      expectedCanonicalVersion: 0,
      snapshotDigest: canonicalSnapshotDigest(projectId, 0, []),
      authority: {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: 'approval:relation:replacement',
        approvalBindingDigest: digest('d'),
        reviewContextId: 'review-context:replacement',
        contextRevision: 1,
        draftId: 'draft:relation:replacement',
        draftRevision: 1,
        draftContentDigest: digest('e'),
        approvedItemIds: ['relation:replacement'],
      },
      reason: 'Contract replacement test',
      actor: { type: 'user', id: 'owner' },
      committedAt: '2026-09-01T00:03:00.000Z',
    };
    const committed = await repository.commitFrontendDraft(write);
    expect(committed).toMatchObject({
      operation: 'ADD_RELATION',
      status: 'COMMITTED',
      relationId: 'relation:replacement',
      afterVersion: 1,
    });
    expect((await repository.getSnapshot(projectId)).relations).toHaveLength(1);
    await expect(
      repository.findRelationPrecursorLink(projectId, 'review-resource:relation', 1),
    ).resolves.toMatchObject({
      relationId: 'relation:replacement',
      relationRevision: 1,
    });
    expect(await repository.commitFrontendDraft(write)).toEqual(committed);
    await expect(
      repository.commitFrontendDraft({
        ...write,
        commitId: 'commit:relation:replacement-duplicate',
        revisionId: 'revision:relation:replacement-duplicate',
        historyEventId: 'history:relation:replacement-duplicate',
        outboxId: 'outbox:relation:replacement-duplicate',
      }),
    ).rejects.toThrow('approval already exists');
  });
});
