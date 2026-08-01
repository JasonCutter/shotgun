import searchKnowledgeWorkspaceSchema from '../../packages/contracts/schemas/search-knowledge-workspace.v1.schema.json';
import searchKnowledgeWorkspaceOutputSchema from '../../packages/contracts/schemas/search-knowledge-workspace-output.v1.schema.json';
import compiledTruthReadSnapshotSchema from '../../packages/contracts/schemas/get-compiled-truth-read-snapshot.v1.schema.json';
import compiledTruthReadSnapshotOutputSchema from '../../packages/contracts/schemas/get-compiled-truth-read-snapshot-output.v1.schema.json';
import { describe, expect, it } from 'vitest';
import { InMemoryCompiledTruthRepository } from '../../adapters/stage10-in-memory/src/index.js';
import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { createCompiledTruthModule } from '../../modules/compiled-truth/src/index.js';
import { createProjectionSearchModule } from '../../modules/projection-search/src/index.js';
import {
  assertJsonSchema,
  decodeGetCompiledTruthReadSnapshotRequest,
  decodeGetCompiledTruthReadSnapshotResult,
  decodeSearchKnowledgeWorkspaceRequest,
  decodeSearchKnowledgeWorkspaceResult,
  type GetCompiledTruthReadSnapshotResult,
  type KnowledgeWorkspaceQueryProjectionStatus,
  type KnowledgeWorkspaceQueryProjectionSource,
  type SearchKnowledgeWorkspaceRequest,
  type SearchKnowledgeWorkspaceResult,
} from '../../packages/contracts/src/index.js';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const now = '2026-08-02T12:00:00.000Z';

const readyStatus = <T extends KnowledgeWorkspaceQueryProjectionSource>(source: T) =>
  ({
    source,
    status: 'READY' as const,
    canonicalVersion: 7,
    projectedCanonicalVersion: 7,
    lag: 0,
    canonicalSnapshotDigest: digestA,
    projectedSnapshotDigest: digestA,
    ...(source === 'COMPILED_TRUTH'
      ? { sourceSnapshotDigest: digestA, projectionLogicalDigest: digestB }
      : {}),
    updatedAt: now,
  }) as KnowledgeWorkspaceQueryProjectionStatus & { readonly source: T };

const searchRequest: SearchKnowledgeWorkspaceRequest = {
  schemaVersion: '1.0.0',
  query: 'Milo',
  resourceId: 'resource-1',
  filters: {
    authorities: ['CANONICAL', 'COMPILED_TRUTH'],
    kinds: ['CLAIM', 'ENTITY'],
    temporalStates: ['CURRENT'],
    projectionStatuses: ['READY', 'STALE'],
    sensitivities: ['private'],
  },
  cursor: 'cursor-1',
  pageSize: 20,
};

const canonicalSource = {
  authority: 'CANONICAL' as const,
  projectId: 'project-1',
  resourceId: 'resource-1',
  resourceRevision: 'revision-1',
  canonicalResourceId: 'claim-1',
  canonicalRevisionId: 'canonical-revision-7',
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  evidenceIds: ['evidence-1'],
  commitId: 'commit-1',
  manifestId: 'manifest-1',
  changeSetId: 'change-set-1',
};

const approvedSource = {
  authority: 'APPROVED_KNOWLEDGE' as const,
  projectId: 'project-1',
  resourceId: 'resource-1',
  resourceRevision: 'revision-1',
  knowledgeGroupId: 'group-1',
  candidateId: 'candidate-1',
  sourceVersionId: 'source-version-1',
  evidenceIds: ['evidence-1'],
};

const compiledSource = {
  authority: 'COMPILED_TRUTH' as const,
  projectId: 'project-1',
  resourceId: 'resource-2',
  resourceRevision: 'revision-2',
  projectionLogicalDigest: digestB,
  compiledItemId: 'compiled-item-1',
  canonicalVersion: 7,
  sourceSnapshotDigest: digestA,
  evidenceIds: ['evidence-2'],
};

const derivedSource = {
  authority: 'DERIVED_INFERENCE' as const,
  projectId: 'project-1',
  resourceId: 'resource-2',
  resourceRevision: 'revision-2',
  inferenceId: 'inference-1',
  sourceProjectionDigest: digestB,
  evidenceIds: ['evidence-2'],
};

const searchResult: SearchKnowledgeWorkspaceResult = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  query: 'Milo',
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
      matchType: 'SUBSTRING',
      authority: 'CANONICAL',
      kind: 'CLAIM',
      temporalState: 'CURRENT',
      label: 'Milo weighs 5 kg.',
      source: canonicalSource,
    },
    {
      projectId: 'project-1',
      rank: 2,
      score: 0.8,
      matchType: 'FULL_TEXT',
      authority: 'APPROVED_KNOWLEDGE',
      kind: 'ENTITY',
      temporalState: 'CURRENT',
      label: 'Milo',
      source: approvedSource,
    },
    {
      projectId: 'project-1',
      rank: 3,
      score: 0.6,
      matchType: 'TRIGRAM',
      authority: 'COMPILED_TRUTH',
      kind: 'CLAIM',
      temporalState: 'CURRENT',
      label: 'Compiled Milo claim',
      source: compiledSource,
      projectionStatus: readyStatus('COMPILED_TRUTH'),
    },
    {
      projectId: 'project-1',
      rank: 4,
      score: 0.4,
      matchType: 'TRIGRAM',
      authority: 'DERIVED_INFERENCE',
      kind: 'KNOWLEDGE_GAP',
      temporalState: 'FUTURE',
      label: 'Milo requires another evidence check',
      source: derivedSource,
    },
  ],
  readiness: {
    canonicalSearch: readyStatus(
      'CANONICAL_SEARCH',
    ) as SearchKnowledgeWorkspaceResult['readiness']['canonicalSearch'],
    sourceProjections: [readyStatus('COMPILED_TRUTH')],
    partial: false,
  },
  generatedAt: now,
};

const withSameScore = (
  matches: readonly SearchKnowledgeWorkspaceResult['matches'][number][],
): SearchKnowledgeWorkspaceResult => ({
  ...searchResult,
  matches: matches.map((match, index) => ({ ...match, rank: index + 1, score: 0.5 })),
});

const compiledProjection = {
  projectId: 'project-1',
  projectorVersion: '1.0.0',
  sourceSnapshotDigest: digestA,
  logicalDigest: digestB,
  canonicalVersion: 7,
  items: [
    {
      id: 'compiled-item-1',
      type: 'CLAIM' as const,
      label: 'Milo weighs 5 kg.',
      state: 'CURRENT' as const,
      source: 'CANONICAL_CLAIM' as const,
      evidenceIds: ['evidence-1'],
      accessScope: ['owner'],
      sensitivity: 'private' as const,
    },
  ],
  graph: {
    nodes: [
      {
        id: 'compiled-item-1',
        type: 'CLAIM' as const,
        label: 'Milo weighs 5 kg.',
        state: 'CURRENT' as const,
        source: 'CANONICAL_CLAIM' as const,
        evidenceIds: ['evidence-1'],
        accessScope: ['owner'],
        sensitivity: 'private' as const,
      },
    ],
    edges: [],
    fallback: { available: true as const, modes: ['LIST', 'TABLE'] as const },
  },
  projectedAt: now,
  buildMode: 'FULL_REBUILD' as const,
};

const compiledStatus = {
  status: 'READY' as const,
  projectorVersion: '1.0.0',
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  sourceSnapshotDigest: digestA,
  logicalDigest: digestB,
  lastBuildMode: 'FULL_REBUILD' as const,
  updatedAt: now,
};

const compiledResult: GetCompiledTruthReadSnapshotResult = {
  schemaVersion: '1.0.0',
  projectId: 'project-1',
  status: compiledStatus,
  projection: compiledProjection,
};

describe('QX-P0 Knowledge Workspace domain Query contracts', () => {
  it('decodes strict server-context-free requests and rejects browser authority fields', () => {
    expect(decodeSearchKnowledgeWorkspaceRequest(searchRequest)).toEqual(searchRequest);
    expect(decodeGetCompiledTruthReadSnapshotRequest({ schemaVersion: '1.0.0' })).toEqual({
      schemaVersion: '1.0.0',
    });

    expect(() =>
      decodeSearchKnowledgeWorkspaceRequest({
        ...searchRequest,
        projectId: 'browser-selected-project',
      }),
    ).toThrow(/unknown field 'projectId'/);
    expect(() =>
      decodeSearchKnowledgeWorkspaceRequest({
        schemaVersion: '1.0.0',
        query: 'Milo',
        'X-Project-Id': 'browser-selected-project',
      }),
    ).toThrow(/unknown field 'X-Project-Id'/);
    expect(() =>
      decodeGetCompiledTruthReadSnapshotRequest({
        schemaVersion: '1.0.0',
        accessScope: ['owner'],
      }),
    ).toThrow(/unknown field 'accessScope'/);
  });

  it('validates four authority discriminants, server ranking, score domain and source lineage', () => {
    expect(decodeSearchKnowledgeWorkspaceResult(searchResult)).toEqual(searchResult);
    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 1 ? { ...match, authority: 'CANONICAL' } : match,
        ),
      }),
    ).toThrow(/authority must match source.authority/);
    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 2 ? { ...match, score: 1.1 } : match,
        ),
      }),
    ).toThrow(/inclusive range \[0, 1\]/);
    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 3 ? { ...match, rank: 2 } : match,
        ),
      }),
    ).toThrow(/rank must be strictly increasing/);
    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 1
            ? {
                ...match,
                source: { ...approvedSource, canonicalResourceId: 'fabricated-canonical-id' },
              }
            : match,
        ),
      }),
    ).toThrow(/unknown field 'canonicalResourceId'/);
  });

  it('keeps partial readiness explicit and never normalizes a non-ready source to READY', () => {
    const staleStatus = {
      ...readyStatus('COMPILED_TRUTH'),
      status: 'STALE' as const,
      projectedCanonicalVersion: 6,
      lag: 1,
      reason: 'Compiled Truth is one revision behind.',
    };
    const partial = {
      ...searchResult,
      readiness: {
        ...searchResult.readiness,
        sourceProjections: [staleStatus],
        partial: true,
      },
    };
    expect(decodeSearchKnowledgeWorkspaceResult(partial).readiness.partial).toBe(true);
    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...partial,
        readiness: { ...partial.readiness, partial: false },
      }),
    ).toThrow(/does not match source status/);
    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...partial,
        readiness: {
          ...partial.readiness,
          sourceProjections: [{ ...staleStatus, reason: undefined }],
        },
      }),
    ).toThrow(/STALE requires a safe reason/);
  });

  it('enforces nested Project lineage, declared tie-break order and status correlations', () => {
    const sameScoreMatches = withSameScore([
      { ...searchResult.matches[0]!, matchType: 'FULL_TEXT' },
      { ...searchResult.matches[1]!, matchType: 'FULL_TEXT' },
      { ...searchResult.matches[2]!, matchType: 'FULL_TEXT' },
      { ...searchResult.matches[3]!, matchType: 'FULL_TEXT' },
    ]);
    expect(decodeSearchKnowledgeWorkspaceResult(sameScoreMatches)).toEqual(sameScoreMatches);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 0
            ? { ...match, source: { ...canonicalSource, projectId: 'project-2' } }
            : match,
        ),
      }),
    ).toThrow(/source\.projectId must remain in the requested Project/);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...sameScoreMatches,
        matches: sameScoreMatches.matches.map((match, index) =>
          index === 1 ? { ...match, matchType: 'SUBSTRING' as const } : match,
        ),
      }),
    ).toThrow(/ordered by matchType/);

    const authorityOrderViolation = withSameScore([
      { ...searchResult.matches[1]!, matchType: 'FULL_TEXT' },
      { ...searchResult.matches[0]!, matchType: 'FULL_TEXT' },
      { ...searchResult.matches[2]!, matchType: 'FULL_TEXT' },
      { ...searchResult.matches[3]!, matchType: 'FULL_TEXT' },
    ]);
    expect(() => decodeSearchKnowledgeWorkspaceResult(authorityOrderViolation)).toThrow(
      /ordered by authority/,
    );

    const sourceIdentityOrderViolation = withSameScore([
      {
        ...searchResult.matches[0]!,
        matchType: 'FULL_TEXT',
        source: { ...canonicalSource, canonicalResourceId: 'canonical-z' },
      },
      {
        ...searchResult.matches[0]!,
        matchType: 'FULL_TEXT',
        source: { ...canonicalSource, canonicalResourceId: 'canonical-a' },
      },
    ]);
    expect(() => decodeSearchKnowledgeWorkspaceResult(sourceIdentityOrderViolation)).toThrow(
      /ordered by source identity/,
    );

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        readiness: {
          ...searchResult.readiness,
          sourceProjections: [{ ...readyStatus('COMPILED_TRUTH'), source: 'KNOWLEDGE_MODEL' }],
        },
      } as unknown),
    ).toThrow(/supported projection source/);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 2
            ? {
                ...match,
                projectionStatus: {
                  ...match.projectionStatus!,
                  sourceSnapshotDigest: digestB,
                },
              }
            : match,
        ),
      }),
    ).toThrow(/Compiled Truth source and projection status identity differs/);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 2
            ? {
                ...match,
                projectionStatus: {
                  ...match.projectionStatus!,
                  status: 'STALE' as const,
                  projectedCanonicalVersion: 6,
                  lag: 1,
                  reason: 'Compiled Truth is one revision behind.',
                },
              }
            : match,
        ),
      }),
    ).toThrow(/Compiled Truth source and projection status identity differs/);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 3
            ? {
                ...match,
                source: { ...derivedSource, projectionId: 'synthetic-projection' },
              }
            : match,
        ),
      } as unknown),
    ).toThrow(/unknown field 'projectionId'/);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 0 ? { ...match, projectionStatus: readyStatus('COMPILED_TRUTH') } : match,
        ),
      }),
    ).toThrow(/CANONICAL matches may only use CANONICAL_SEARCH status/);

    expect(() =>
      decodeSearchKnowledgeWorkspaceResult({
        ...searchResult,
        matches: searchResult.matches.map((match, index) =>
          index === 1 ? { ...match, projectionStatus: readyStatus('CANONICAL_SEARCH') } : match,
        ),
      }),
    ).toThrow(/APPROVED_KNOWLEDGE matches must not expose projection status/);
  });

  it('supports READY, STALE, DEGRADED and NOT_BUILT Compiled Truth read meanings', () => {
    expect(decodeGetCompiledTruthReadSnapshotResult(compiledResult)).toEqual(compiledResult);

    const staleProjection = { ...compiledProjection, canonicalVersion: 6 };
    const staleResult = {
      ...compiledResult,
      status: {
        ...compiledStatus,
        status: 'STALE' as const,
        canonicalVersion: 7,
        projectedCanonicalVersion: 6,
        lag: 1,
      },
      projection: staleProjection,
    };
    expect(decodeGetCompiledTruthReadSnapshotResult(staleResult).status.status).toBe('STALE');

    const degradedResult = {
      ...staleResult,
      status: { ...staleResult.status, status: 'DEGRADED' as const, lastError: 'repair-needed' },
    };
    expect(decodeGetCompiledTruthReadSnapshotResult(degradedResult).status.status).toBe('DEGRADED');

    const notBuilt = {
      schemaVersion: '1.0.0' as const,
      projectId: 'project-1',
      status: {
        status: 'NOT_BUILT' as const,
        projectorVersion: '1.0.0',
        canonicalVersion: 7,
        projectedCanonicalVersion: 0,
        lag: 7,
      },
    };
    expect(decodeGetCompiledTruthReadSnapshotResult(notBuilt).projection).toBeUndefined();
    expect(() =>
      decodeGetCompiledTruthReadSnapshotResult({ ...notBuilt, projection: compiledProjection }),
    ).toThrow(/NOT_BUILT cannot carry a projection/);
    expect(() =>
      decodeGetCompiledTruthReadSnapshotResult({
        ...compiledResult,
        status: { ...compiledStatus, logicalDigest: digestA },
      }),
    ).toThrow(/digest or build identity differs/);
    expect(() =>
      decodeGetCompiledTruthReadSnapshotResult({
        ...compiledResult,
        projection: { ...compiledProjection, projectId: 'other-project' },
      }),
    ).toThrow(/projection Project differs/);
  });

  it('rejects write capabilities and preserves the existing Stage 7/10 Query declarations', () => {
    expect(() =>
      decodeSearchKnowledgeWorkspaceRequest({
        ...searchRequest,
        capabilities: ['WRITE', 'APPROVE', 'COMMIT'],
      }),
    ).toThrow(/unknown field 'capabilities'/);

    const searchContracts = createProjectionSearchModule(
      new InMemorySearchProjectionRepository(),
    ).contracts.filter((contract) => contract.name === 'SearchCanonicalKnowledge');
    expect(searchContracts).toHaveLength(1);
    expect(searchContracts[0]).toMatchObject({
      name: 'SearchCanonicalKnowledge',
      version: '1.0.0',
      kind: 'query',
    });

    const compiledContracts = createCompiledTruthModule(
      new InMemoryCompiledTruthRepository(),
    ).contracts.filter((contract) => contract.name === 'GetCompiledTruth');
    expect(compiledContracts).toHaveLength(1);
    expect(compiledContracts[0]).toMatchObject({
      name: 'GetCompiledTruth',
      version: '1.0.0',
      kind: 'query',
    });
  });

  it('validates the repository JSON Schemas for both additive Query contracts', () => {
    expect(() =>
      assertJsonSchema(
        searchKnowledgeWorkspaceSchema,
        searchRequest,
        'SearchKnowledgeWorkspace request',
      ),
    ).not.toThrow();
    expect(() =>
      assertJsonSchema(
        searchKnowledgeWorkspaceOutputSchema,
        searchResult,
        'SearchKnowledgeWorkspace output',
      ),
    ).not.toThrow();
    expect(() =>
      assertJsonSchema(
        compiledTruthReadSnapshotSchema,
        { schemaVersion: '1.0.0' },
        'GetCompiledTruthReadSnapshot request',
      ),
    ).not.toThrow();
    expect(() =>
      assertJsonSchema(
        compiledTruthReadSnapshotOutputSchema,
        compiledResult,
        'GetCompiledTruthReadSnapshot output',
      ),
    ).not.toThrow();
    expect(() =>
      assertJsonSchema(
        searchKnowledgeWorkspaceSchema,
        { ...searchRequest, projectId: 'forbidden' },
        'invalid request',
      ),
    ).toThrow();
  });
});
