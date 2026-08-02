import { describe, expect, it } from 'vitest';

import {
  PostgresKnowledgeWorkspaceProjection,
  type KnowledgeWorkspaceQueryExecutor,
} from '../../adapters/frontend-product-read-postgres/src/index.js';
import { knowledgePageId } from '../../modules/frontend-product-read/src/knowledge-contract.js';
import type { FrontendReadScope } from '../../modules/frontend-product-read/src/index.js';
import {
  FrontendContractError,
  sha256Text,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  type CompiledTruthProjectionStatus,
  type DerivedInferenceCandidate,
  type EvidenceSpan,
  type GetCompiledTruthReadSnapshotResult,
  type KnowledgeReviewGroup,
  type ProjectionReadiness,
  type SearchKnowledgeWorkspaceMatch,
  type SearchKnowledgeWorkspaceResult,
  type TransformationRevision,
} from '../../packages/contracts/src/index.js';
import { defineFrontendKnowledgeProjectionContract } from '../helpers/frontend-knowledge-projection-contract.js';

const projectId = 'frontend-product-read-persistent-contract';
const now = '2026-08-02T13:00:00.000Z';
const sourceVersionId = 'source-version-1';
const sourceId = 'resource-1';
const resourceRevision = '1';
const compiledRevision = sha256Text('persistent-contract-compiled-logical-digest');
const snapshotDigest = sha256Text('persistent-contract-snapshot');
const sourceSnapshotDigest = sha256Text('persistent-contract-source-snapshot');

const scope: FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
  readonly accessScope: readonly string[];
} = {
  principalId: 'persistent-contract-principal',
  sessionId: 'persistent-contract-session',
  activeProject: {
    id: projectId,
    label: 'Persistent Contract Project',
    isOwner: true,
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: projectId,
      label: 'Persistent Contract Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  accessRevision: 'persistent-contract-access-revision',
  policyContextRevision: 'persistent-contract-policy-revision',
  accessScope: ['owner'],
};

const evidence = (evidenceId: string, sourceResourceId: string): EvidenceSpan =>
  ({
    evidenceId,
    revisionId: resourceRevision,
    projectId,
    sourceId: sourceResourceId,
    sourceVersionId,
    pointer: '/blocks/0',
    nodeKind: 'paragraph',
    origin: 'source',
    position: { type: 'TextPositionSelector', start: 0, end: 7, unit: 'unicode-code-point' },
    quote: { type: 'TextQuoteSelector', exact: 'canonical' },
    exactHash: sha256Text('canonical'),
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: now,
  }) as EvidenceSpan;

const evidenceById: Readonly<Record<string, EvidenceSpan>> = {
  'evidence-1': evidence('evidence-1', sourceId),
  'evidence-2': evidence('evidence-2', 'resource-2'),
};

const canonical: CanonicalClaim = {
  claimId: 'canonical-claim-1',
  projectId,
  revisionNumber: 1,
  claimText: 'The canonical product claim.',
  sourceVersionId,
  evidenceIds: ['evidence-1'],
  createdFromManifestId: 'manifest-1',
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: now,
};

const snapshot: CanonicalSnapshot = {
  snapshotId: 'snapshot-1',
  projectId,
  version: 7,
  digest: snapshotDigest,
  claims: [
    {
      claimId: canonical.claimId,
      text: canonical.claimText,
      revisionNumber: 1,
      evidenceIds: canonical.evidenceIds,
    },
  ],
  createdAt: now,
};

const canonicalReadiness: ProjectionReadiness = {
  status: 'READY',
  projectedCanonicalVersion: 7,
  canonicalVersion: 7,
  lag: 0,
  canonicalSnapshotDigest: snapshotDigest,
  projectedSnapshotDigest: snapshotDigest,
  updatedAt: now,
};

const commit: CanonicalCommitResult = {
  commitId: 'commit-1',
  projectId,
  manifestId: 'manifest-1',
  manifestDigest: sha256Text('manifest-1'),
  changeSetId: 'changeset-1',
  operation: 'ADD_CLAIM',
  status: 'COMMITTED',
  beforeVersion: 6,
  afterVersion: 7,
  snapshotDigest,
  claimId: canonical.claimId,
  revisionId: 'canonical-revision-7',
  historyEventId: 'history-1',
  outboxId: 'outbox-1',
  committedAt: now,
};

const history: CanonicalHistoryEvent = {
  historyEventId: 'history-1',
  projectId,
  commitId: commit.commitId,
  manifestId: commit.manifestId,
  changeSetId: commit.changeSetId,
  eventType: 'CANONICAL_CLAIM_ADDED',
  beforeVersion: 6,
  afterVersion: 7,
  claimId: canonical.claimId,
  reason: 'Persistent Product contract fixture.',
  actor: { type: 'user', id: 'persistent-contract-owner' },
  createdAt: now,
};

const revision = {
  revisionId: resourceRevision,
  projectId,
  sourceId,
  sourceVersionId,
  sourceContentHash: sha256Text('persistent-contract-source'),
  transformer: { id: 'shotgun.plain-text', version: '1.0.0' },
  documentIR: { schemaVersion: '1.0.0', mediaType: 'text/plain', blocks: [] },
  sourceMap: { schemaVersion: '1.0.0', entries: [] },
  documentHash: sha256Text('persistent-contract-document'),
  sourceMapHash: sha256Text('persistent-contract-source-map'),
  accessScope: ['owner'],
  sensitivity: 'private' as const,
  createdAt: now,
} as unknown as TransformationRevision;

const approvedGroup: KnowledgeReviewGroup = {
  groupId: sourceId,
  projectId,
  sourceVersionId,
  revisionNumber: 1,
  status: 'APPROVED',
  contentDigest: sha256Text('persistent-contract-group'),
  items: [
    {
      candidateId: 'approved-candidate-1',
      candidateType: 'ENTITY',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: ['evidence-1'],
      modelOutputs: [
        {
          provider: 'fixture',
          model: 'persistent-contract-model',
          value: 'Approved canonical entity',
          evidenceIds: ['evidence-1'],
        },
      ],
      name: 'Approved canonical entity',
      entityKind: 'CONCEPT',
      aliases: [],
      resolution: { status: 'NEW' },
    },
  ],
  decisions: [],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: now,
  updatedAt: now,
};

const compiledStatus: CompiledTruthProjectionStatus = {
  status: 'DEGRADED',
  projectorVersion: '1.0.0',
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  sourceSnapshotDigest,
  logicalDigest: compiledRevision,
  lastBuildMode: 'FULL_REBUILD',
  lastError: 'Persistent Product contract degraded fixture.',
  updatedAt: now,
};

const compiledProjection: CompiledTruthProjection = {
  projectId,
  projectorVersion: '1.0.0',
  sourceSnapshotDigest,
  logicalDigest: compiledRevision,
  canonicalVersion: 7,
  items: [
    {
      id: 'resource-2',
      type: 'ENTITY',
      label: 'Compiled canonical entity',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: ['evidence-2'],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'resource-2',
        type: 'ENTITY',
        label: 'Compiled canonical entity',
        state: 'CURRENT',
        source: 'APPROVED_KNOWLEDGE',
        evidenceIds: ['evidence-2'],
        accessScope: ['owner'],
        sensitivity: 'private',
      },
    ],
    edges: [],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: now,
  buildMode: 'FULL_REBUILD',
};

const derived: DerivedInferenceCandidate = {
  candidateId: 'resource-2',
  fingerprint: sha256Text('persistent-contract-inference'),
  status: 'DERIVED_INFERENCE',
  candidateType: 'KNOWLEDGE_GAP',
  question: 'What canonical relationship is missing?',
  relatedNodeIds: ['resource-2'],
  evidenceIds: ['evidence-2'],
  sourceProjectionDigest: compiledRevision,
  reentryPhase: 'VALIDATION',
  createdAt: now,
};

const canonicalSearchStatus = {
  source: 'CANONICAL_SEARCH' as const,
  status: 'READY' as const,
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  canonicalSnapshotDigest: snapshotDigest,
  projectedSnapshotDigest: snapshotDigest,
  updatedAt: now,
};

const compiledSearchStatus = {
  source: 'COMPILED_TRUTH' as const,
  status: 'DEGRADED' as const,
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  sourceSnapshotDigest,
  projectionLogicalDigest: compiledRevision,
  reason: 'Persistent Product contract degraded fixture.',
  updatedAt: now,
};

const searchMatches: readonly SearchKnowledgeWorkspaceMatch[] = [
  {
    projectId,
    rank: 1,
    score: 0.99,
    matchType: 'FULL_TEXT',
    authority: 'CANONICAL',
    kind: 'CLAIM',
    temporalState: 'CURRENT',
    label: 'Canonical product claim',
    source: {
      authority: 'CANONICAL',
      projectId,
      resourceId: sourceId,
      resourceRevision,
      canonicalResourceId: canonical.claimId,
      canonicalRevisionId: commit.revisionId,
      sourceId,
      sourceVersionId,
      evidenceIds: ['evidence-1'],
      commitId: commit.commitId,
    },
    projectionStatus: canonicalSearchStatus,
  },
  {
    projectId,
    rank: 2,
    score: 0.9,
    matchType: 'TRIGRAM',
    authority: 'APPROVED_KNOWLEDGE',
    kind: 'ENTITY',
    temporalState: 'CURRENT',
    label: 'Approved canonical entity',
    source: {
      authority: 'APPROVED_KNOWLEDGE',
      projectId,
      resourceId: sourceId,
      resourceRevision,
      knowledgeGroupId: approvedGroup.groupId,
      candidateId: 'approved-candidate-1',
      sourceVersionId,
      evidenceIds: ['evidence-1'],
    },
  },
  {
    projectId,
    rank: 3,
    score: 0.8,
    matchType: 'FULL_TEXT',
    authority: 'COMPILED_TRUTH',
    kind: 'ENTITY',
    temporalState: 'CURRENT',
    label: 'Compiled canonical entity',
    source: {
      authority: 'COMPILED_TRUTH',
      projectId,
      resourceId: 'resource-2',
      resourceRevision: compiledRevision,
      projectionLogicalDigest: compiledRevision,
      compiledItemId: 'resource-2',
      canonicalVersion: 7,
      sourceSnapshotDigest,
      evidenceIds: ['evidence-2'],
    },
    projectionStatus: compiledSearchStatus,
  },
  {
    projectId,
    rank: 4,
    score: 0.7,
    matchType: 'SUBSTRING',
    authority: 'DERIVED_INFERENCE',
    kind: 'KNOWLEDGE_GAP',
    temporalState: 'FUTURE',
    label: 'What canonical relationship is missing?',
    source: {
      authority: 'DERIVED_INFERENCE',
      projectId,
      resourceId: derived.candidateId,
      resourceRevision: compiledRevision,
      inferenceId: derived.candidateId,
      sourceProjectionDigest: compiledRevision,
      evidenceIds: ['evidence-2'],
    },
  },
];

const searchResult = (
  matches: readonly SearchKnowledgeWorkspaceMatch[],
  nextCursor?: string,
): SearchKnowledgeWorkspaceResult => ({
  schemaVersion: '1.0.0',
  projectId,
  query: 'canonical',
  ranking: {
    owner: 'stage7.projection-search',
    version: '1.0.0',
    scoreNormalization: 'UNIT_INTERVAL_V1',
    tieBreak: 'SCORE_DESC_MATCH_TYPE_AUTHORITY_SOURCE_ID_ASC',
  },
  matches,
  ...(nextCursor === undefined ? {} : { nextCursor }),
  readiness: {
    canonicalSearch: canonicalSearchStatus,
    sourceProjections: [compiledSearchStatus],
    partial: true,
  },
  generatedAt: now,
});

const matchesForRequest = (
  payload: Record<string, unknown>,
): readonly SearchKnowledgeWorkspaceMatch[] => {
  const filters = (payload.filters ?? {}) as Record<string, unknown>;
  const authorities = filters.authorities as readonly string[] | undefined;
  const kinds = filters.kinds as readonly string[] | undefined;
  const temporalStates = filters.temporalStates as readonly string[] | undefined;
  const projectionStatuses = filters.projectionStatuses as readonly string[] | undefined;
  return searchMatches.filter((match) => {
    const projectionStatus = match.projectionStatus?.status;
    return (
      (payload.resourceId === undefined || match.source.resourceId === payload.resourceId) &&
      (authorities === undefined || authorities.includes(match.authority)) &&
      (kinds === undefined || kinds.includes(match.kind)) &&
      (temporalStates === undefined || temporalStates.includes(match.temporalState)) &&
      (projectionStatuses === undefined || projectionStatuses.includes(projectionStatus ?? 'READY'))
    );
  });
};

class PersistentKnowledgeQueryFixture implements KnowledgeWorkspaceQueryExecutor {
  readonly query = async <TResult>({
    envelope,
    context,
  }: Parameters<KnowledgeWorkspaceQueryExecutor['query']>[0]): Promise<TResult> => {
    if (context.projectId !== projectId) {
      throw new FrontendContractError('NOT_FOUND', 'Persistent fixture masks another Project.');
    }
    switch (envelope.messageType) {
      case 'GetCanonicalSnapshot':
        return snapshot as TResult;
      case 'ListCanonicalHistory':
        return { items: [history] } as TResult;
      case 'GetProjectionReadiness':
        return canonicalReadiness as TResult;
      case 'ListKnowledgeGroups':
        return { items: [approvedGroup] } as TResult;
      case 'GetCompiledTruthReadSnapshot':
        return {
          schemaVersion: '1.0.0',
          projectId,
          status: compiledStatus,
          projection: compiledProjection,
        } satisfies GetCompiledTruthReadSnapshotResult as TResult;
      case 'ListDerivedInferences':
        return { items: [derived] } as TResult;
      case 'GetCanonicalClaim':
        return canonical as TResult;
      case 'GetCanonicalCommit':
        return commit as TResult;
      case 'GetDocumentRevision':
        return revision as TResult;
      case 'GetEvidenceSpan': {
        const evidenceId = (envelope.payload as { readonly evidenceId: string }).evidenceId;
        const value = evidenceById[evidenceId];
        if (!value) throw new FrontendContractError('NOT_FOUND', 'Persistent evidence missing.');
        return value as TResult;
      }
      case 'SearchKnowledgeWorkspace': {
        const payload = envelope.payload as Record<string, unknown>;
        const filtered = matchesForRequest(payload);
        const offset = payload.cursor === 'persistent-search-cursor-2' ? 2 : 0;
        const pageSize = typeof payload.pageSize === 'number' ? payload.pageSize : filtered.length;
        const matches = filtered.slice(offset, offset + pageSize);
        return searchResult(
          matches,
          offset + pageSize < filtered.length ? 'persistent-search-cursor-2' : undefined,
        ) as TResult;
      }
      default:
        throw new Error(`Unexpected persistent Product query ${envelope.messageType}.`);
    }
  };
}

const executor = new PersistentKnowledgeQueryFixture();
const pageOneId = knowledgePageId({
  projectId,
  resourceId: sourceId,
  revision: resourceRevision,
});
const pageTwoId = knowledgePageId({
  projectId,
  resourceId: 'resource-2',
  revision: compiledRevision,
});

const createPort = () => new PostgresKnowledgeWorkspaceProjection(executor, () => now);
const requests = {
  workspace: { schemaVersion: '1.0.0' as const },
  pageList: { schemaVersion: '1.0.0' as const },
  search: { schemaVersion: '1.0.0' as const, query: 'canonical' },
  detail: {
    schemaVersion: '1.0.0' as const,
    resourceId: sourceId,
    requestedRevision: resourceRevision,
    focusId: '/blocks/0',
  },
  compare: {
    schemaVersion: '1.0.0' as const,
    pageIds: [pageOneId, pageTwoId] as const,
  },
};

describe('Persistent PostgreSQL Product Read fixture setup', () => {
  it('uses one retained Query-backed fixture state for every Product contract invocation', () => {
    expect(executor).toBeDefined();
    expect(createPort()).toBeInstanceOf(PostgresKnowledgeWorkspaceProjection);
  });
});

defineFrontendKnowledgeProjectionContract({
  name: 'Persistent PostgreSQL Query-backed',
  createPort,
  scope,
  requests,
  getExpected: async () => {
    const port = createPort();
    return {
      workspace: await port.getWorkspace({ ...scope, request: requests.workspace }),
      pageList: await port.listPages({ ...scope, request: requests.pageList }),
      search: await port.search({ ...scope, request: requests.search }),
      detail: await port.getDetail({ ...scope, request: requests.detail }),
      compare: await port.compare({ ...scope, request: requests.compare }),
    };
  },
  expectations: {
    pageCursor: null,
    searchCursor: null,
    authorities: ['CANONICAL', 'APPROVED_KNOWLEDGE', 'COMPILED_TRUTH', 'DERIVED_INFERENCE'],
    projectionStatuses: ['DEGRADED'],
    canonicalLineage: {
      canonicalResourceId: canonical.claimId,
      evidenceTarget: {
        resourceId: sourceId,
        resourceRevision,
        focusId: '/blocks/0',
        sourceId,
        sourceVersionId,
        evidenceId: 'evidence-1',
      },
    },
    compareRightProjectionKind: 'COMPILED_TRUTH',
  },
});
