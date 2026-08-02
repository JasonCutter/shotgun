import { describe, expect, it, vi } from 'vitest';

import {
  PostgresKnowledgeWorkspaceProjection,
  type KnowledgeWorkspaceQueryContext,
  type KnowledgeWorkspaceQueryExecutor,
} from '../../adapters/frontend-product-read-postgres/src/index.js';
import type { FrontendReadScope } from '../../modules/frontend-product-read/src/index.js';
import {
  sha256Text,
  type CanonicalSnapshot,
  type EvidenceSpan,
  type GetCompiledTruthReadSnapshotResult,
  type ProjectionReadiness,
  type SearchKnowledgeWorkspaceResult,
} from '../../packages/contracts/src/index.js';

const scope: FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
  readonly accessScope: readonly string[];
} = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    isOwner: true,
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  accessRevision: 'access-revision-1',
  policyContextRevision: 'policy-revision-1',
  accessScope: ['owner'],
};

const canonicalStatus = {
  source: 'CANONICAL_SEARCH' as const,
  status: 'READY' as const,
  canonicalVersion: 3,
  projectedCanonicalVersion: 3,
  lag: 0,
  canonicalSnapshotDigest: sha256Text('canonical'),
  projectedSnapshotDigest: sha256Text('canonical'),
  updatedAt: '2026-08-02T12:00:00.000Z',
};

const searchResult: SearchKnowledgeWorkspaceResult = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  query: '  CANONICAL  ',
  ranking: {
    owner: 'stage7.projection-search',
    version: '1.0.0',
    scoreNormalization: 'UNIT_INTERVAL_V1',
    tieBreak: 'SCORE_DESC_MATCH_TYPE_AUTHORITY_SOURCE_ID_ASC',
  },
  matches: [
    {
      projectId: 'project-1',
      rank: 1,
      score: 1,
      matchType: 'FULL_TEXT',
      authority: 'CANONICAL',
      kind: 'CLAIM',
      temporalState: 'CURRENT',
      label: 'Canonical result',
      source: {
        authority: 'CANONICAL',
        projectId: 'project-1',
        resourceId: 'source-1',
        resourceRevision: 'revision-1',
        canonicalResourceId: 'claim-1',
        canonicalRevisionId: 'canonical-revision-3',
        sourceId: 'source-1',
        sourceVersionId: 'source-version-1',
        evidenceIds: ['evidence-1'],
        commitId: 'commit-1',
      },
      projectionStatus: canonicalStatus,
    },
  ],
  readiness: {
    canonicalSearch: canonicalStatus,
    sourceProjections: [],
    partial: false,
  },
  generatedAt: '2026-08-02T12:00:00.000Z',
};

const evidence = {
  evidenceId: 'evidence-1',
  revisionId: 'revision-1',
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  pointer: '/paragraph/0',
  nodeKind: 'paragraph',
  origin: 'source',
  position: { start: 0, end: 10 },
  quote: { exact: 'Canonical result' },
  exactHash: sha256Text('Canonical result'),
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: '2026-08-02T12:00:00.000Z',
} as unknown as EvidenceSpan;

const makeExecutor = () => {
  const contexts: KnowledgeWorkspaceQueryContext[] = [];
  const messages: string[] = [];
  const query = vi.fn<KnowledgeWorkspaceQueryExecutor['query']>(
    async <TResult>({
      envelope,
      context,
    }: Parameters<KnowledgeWorkspaceQueryExecutor['query']>[0]): Promise<TResult> => {
      messages.push(envelope.messageType);
      contexts.push(context);
      if (envelope.messageType === 'SearchKnowledgeWorkspace') return searchResult as TResult;
      if (envelope.messageType === 'GetEvidenceSpan') return evidence as TResult;
      throw new Error(`Unexpected query ${envelope.messageType}`);
    },
  );
  const executor: KnowledgeWorkspaceQueryExecutor = {
    query: query as KnowledgeWorkspaceQueryExecutor['query'],
  };
  return { executor, contexts, messages };
};

const makeEmptyDomainExecutor = () => {
  const contexts: KnowledgeWorkspaceQueryContext[] = [];
  const messages: string[] = [];
  const snapshot: CanonicalSnapshot = {
    snapshotId: 'snapshot-empty',
    projectId: 'project-1',
    version: 0,
    digest: sha256Text('empty-canonical-snapshot'),
    claims: [],
    createdAt: '2026-08-02T12:00:00.000Z',
  };
  const readiness: ProjectionReadiness = {
    status: 'READY',
    projectedCanonicalVersion: 0,
    canonicalVersion: 0,
    lag: 0,
    canonicalSnapshotDigest: snapshot.digest,
    projectedSnapshotDigest: snapshot.digest,
    updatedAt: '2026-08-02T12:00:00.000Z',
  };
  const compiled: GetCompiledTruthReadSnapshotResult = {
    schemaVersion: '1.0.0',
    projectId: 'project-1',
    status: {
      status: 'NOT_BUILT',
      projectorVersion: '1.0.0',
      canonicalVersion: 0,
      projectedCanonicalVersion: 0,
      lag: 0,
      updatedAt: '2026-08-02T12:00:00.000Z',
    },
  };
  const query = vi.fn<KnowledgeWorkspaceQueryExecutor['query']>(
    async <TResult>({
      envelope,
      context,
    }: Parameters<KnowledgeWorkspaceQueryExecutor['query']>[0]): Promise<TResult> => {
      messages.push(envelope.messageType);
      contexts.push(context);
      switch (envelope.messageType) {
        case 'GetCanonicalSnapshot':
          return snapshot as TResult;
        case 'ListCanonicalHistory':
        case 'ListKnowledgeGroups':
        case 'ListDerivedInferences':
          return { items: [] } as TResult;
        case 'GetProjectionReadiness':
          return readiness as TResult;
        case 'GetCompiledTruthReadSnapshot':
          return compiled as TResult;
        default:
          throw new Error(`Unexpected query ${envelope.messageType}`);
      }
    },
  );
  const executor: KnowledgeWorkspaceQueryExecutor = {
    query: query as KnowledgeWorkspaceQueryExecutor['query'],
  };
  return { executor, contexts, messages };
};

describe('PostgresKnowledgeWorkspaceProjection', () => {
  it('uses the existing Query boundary and preserves QX rank/readiness and server scope', async () => {
    const { executor, contexts, messages } = makeExecutor();
    const adapter = new PostgresKnowledgeWorkspaceProjection(
      executor,
      () => '2026-08-02T12:00:00.000Z',
    );
    const result = await adapter.search({
      ...scope,
      request: { schemaVersion: '1.0.0', query: '  CANONICAL  ' },
    });
    expect(result.schemaVersion).toBe('1.1.0');
    expect(result.readiness.partial).toBe(false);
    expect(result.projection).toEqual(result.readiness.canonicalSearch);
    expect(result.matches[0]?.item.lineage.projection?.projectionKind).toBe('CANONICAL_SEARCH');
    expect(result.matches[0]?.item.evidenceTargets?.[0]).toMatchObject({
      resourceId: 'source-1',
      resourceRevision: 'revision-1',
      focusId: '/paragraph/0',
    });
    expect(messages).toEqual(['SearchKnowledgeWorkspace', 'GetEvidenceSpan']);
    expect(contexts).toHaveLength(2);
    for (const context of contexts) {
      expect(context).toMatchObject({
        principalId: 'principal-1',
        sessionId: 'session-1',
        projectId: 'project-1',
        accessRevision: 'access-revision-1',
        policyContextRevision: 'policy-revision-1',
        accessScope: ['owner'],
        sensitivity: 'private',
      });
    }
  });

  it('fails closed before dispatch when server-resolved access scope is absent', async () => {
    const { executor } = makeExecutor();
    const adapter = new PostgresKnowledgeWorkspaceProjection(executor);
    await expect(
      adapter.search({
        ...scope,
        accessScope: undefined,
        request: { schemaVersion: '1.0.0', query: 'canonical' },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('keeps an empty domain empty and does not synthesize a compiled fallback', async () => {
    const { executor, contexts, messages } = makeEmptyDomainExecutor();
    const adapter = new PostgresKnowledgeWorkspaceProjection(
      executor,
      () => '2026-08-02T12:00:00.000Z',
    );

    const workspace = await adapter.getWorkspace({
      ...scope,
      request: { schemaVersion: '1.0.0' },
    });
    const list = await adapter.listPages({
      ...scope,
      request: { schemaVersion: '1.0.0', pageSize: 10 },
    });

    expect(workspace.pages).toEqual([]);
    expect(list.pages).toEqual([]);
    expect(workspace.projection.status).toBe('READY');
    expect(list.projection.status).toBe('READY');
    await expect(
      adapter.getDetail({
        ...scope,
        request: { schemaVersion: '1.0.0', resourceId: 'missing-resource' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      adapter.compare({
        ...scope,
        request: { schemaVersion: '1.0.0', pageIds: ['missing-left', 'missing-right'] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(messages).toHaveLength(24);
    expect(messages.filter((message) => message === 'GetCompiledTruthReadSnapshot')).toHaveLength(
      4,
    );
    for (const context of contexts) {
      expect(context).toMatchObject({
        projectId: 'project-1',
        accessRevision: 'access-revision-1',
        policyContextRevision: 'policy-revision-1',
        accessScope: ['owner'],
      });
    }
  });
});
