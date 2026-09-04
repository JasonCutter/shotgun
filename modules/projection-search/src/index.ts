import canonicalClaimSchema from '../../../packages/contracts/schemas/canonical-claim.v1.schema.json';
import canonicalCommitResultSchema from '../../../packages/contracts/schemas/canonical-commit-result.v1.schema.json';
import canonicalCommittedSchema from '../../../packages/contracts/schemas/canonical-committed.v1.schema.json';
import canonicalSearchResponseSchema from '../../../packages/contracts/schemas/canonical-search-response.v1.schema.json';
import canonicalSnapshotSchema from '../../../packages/contracts/schemas/canonical-snapshot.v1.schema.json';
import getCanonicalClaimSchema from '../../../packages/contracts/schemas/get-canonical-claim.v1.schema.json';
import getCanonicalCommitSchema from '../../../packages/contracts/schemas/get-canonical-commit.v1.schema.json';
import getCanonicalSnapshotSchema from '../../../packages/contracts/schemas/get-canonical-snapshot.v1.schema.json';
import getProjectionReadinessSchema from '../../../packages/contracts/schemas/get-projection-readiness.v1.schema.json';
import listCanonicalHistoryOutputSchema from '../../../packages/contracts/schemas/list-canonical-history-output.v1.schema.json';
import listCanonicalHistorySchema from '../../../packages/contracts/schemas/list-canonical-history.v1.schema.json';
import projectionReadinessSchema from '../../../packages/contracts/schemas/projection-readiness.v1.schema.json';
import projectionReadySchema from '../../../packages/contracts/schemas/projection-ready.v1.schema.json';
import rebuildSearchProjectionSchema from '../../../packages/contracts/schemas/rebuild-search-projection.v1.schema.json';
import searchCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import searchKnowledgeWorkspaceSchema from '../../../packages/contracts/schemas/search-knowledge-workspace.v1.schema.json';
import searchKnowledgeWorkspaceOutputSchema from '../../../packages/contracts/schemas/search-knowledge-workspace-output.v1.schema.json';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import {
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalCommittedPayload,
  type CanonicalHistoryEvent,
  type CanonicalSearchResponse,
  type CanonicalSearchResult,
  type CanonicalSnapshot,
  decodeSearchKnowledgeWorkspaceRequest,
  decodeSearchKnowledgeWorkspaceResult,
  type CompiledTruthItem,
  type CompiledTruthProjectionStatus,
  type CommandEnvelope,
  type DerivedInferenceCandidate,
  type EventEnvelope,
  type GetCompiledTruthReadSnapshotResult,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
  type KnowledgeWorkspaceQueryAuthority,
  type KnowledgeWorkspaceQueryMatchType,
  type KnowledgeWorkspaceQueryProjectionStatus,
  type KnowledgeWorkspaceQuerySensitivity,
  type KnowledgeWorkspaceQueryStatus,
  type KnowledgeWorkspaceSearchSource,
  type ProjectionReadiness,
  type ProjectionWatermark,
  type QueryEnvelope,
  type SearchProjectionDocument,
  type SearchKnowledgeWorkspaceMatch,
  type SearchKnowledgeWorkspaceRequest,
  type SearchKnowledgeWorkspaceResult,
  sha256Text,
  ShotgunError,
  stableJson,
  type TransformationRevision,
} from '../../../packages/contracts/src/index.js';
import type { HandlerContext, ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type ProjectionCommitWrite = {
  readonly document?: SearchProjectionDocument;
  readonly commitId: string;
  readonly operation: CanonicalCommittedPayload['operation'];
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
  readonly projectedAt: string;
};

export type ProjectionRebuildWrite = {
  readonly documents: readonly SearchProjectionDocument[];
  readonly watermark: ProjectionWatermark;
};

export type SearchProjectionRepositoryPort = {
  applyCommit(projectId: string, write: ProjectionCommitWrite): Promise<void>;
  rebuild(projectId: string, write: ProjectionRebuildWrite): Promise<void>;
  markDegraded(projectId: string, error: string, updatedAt: string): Promise<void>;
  findWatermark(projectId: string): Promise<ProjectionWatermark | undefined>;
  search(
    projectId: string,
    query: string,
    limit: number,
    accessScopes: readonly string[],
  ): Promise<readonly CanonicalSearchResult[]>;
};

export type ProjectionClockPort = { now(): string };

const systemClock: ProjectionClockPort = { now: () => new Date().toISOString() };
const SEARCH_PROJECTION_UPDATE_FAILED = 'SEARCH_PROJECTION_UPDATE_FAILED';
const SEARCH_WORKSPACE_DEFAULT_PAGE_SIZE = 20;
const SEARCH_WORKSPACE_CANONICAL_RETRIEVAL_LIMIT = 100;
const SEARCH_WORKSPACE_RANKING_VERSION = '1.0.0' as const;
const SEARCH_WORKSPACE_CURSOR_VERSION = 1 as const;
const workspaceMatchTypeOrder: readonly KnowledgeWorkspaceQueryMatchType[] = [
  'FULL_TEXT',
  'TRIGRAM',
  'SUBSTRING',
];
const workspaceAuthorityOrder: readonly KnowledgeWorkspaceQueryAuthority[] = [
  'CANONICAL',
  'APPROVED_KNOWLEDGE',
  'COMPILED_TRUTH',
  'DERIVED_INFERENCE',
];

type KnowledgeGroupListResult = { readonly items: readonly KnowledgeReviewGroup[] };
type DerivedInferenceListResult = { readonly items: readonly DerivedInferenceCandidate[] };
type WorkspaceCandidate = Omit<SearchKnowledgeWorkspaceMatch, 'rank'>;
type WorkspaceCursorPayload = {
  readonly version: typeof SEARCH_WORKSPACE_CURSOR_VERSION;
  readonly nextOffset: number;
  readonly rankingVersion: typeof SEARCH_WORKSPACE_RANKING_VERSION;
  readonly requestDigest: string;
};

export const normalizeSearchText = (value: string): string =>
  value.normalize('NFKC').toLowerCase().trim();

const compareWorkspaceStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const trigrams = (value: string): Set<string> => {
  const padded = `  ${normalizeSearchText(value)} `;
  return new Set(
    Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) =>
      padded.slice(index, index + 3),
    ),
  );
};

const trigramSimilarity = (left: string, right: string): number => {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return (2 * intersection) / (a.size + b.size);
};

const scoreWorkspaceText = (
  label: string,
  normalizedQuery: string,
): { readonly score: number; readonly matchType: KnowledgeWorkspaceQueryMatchType } | undefined => {
  const normalizedLabel = normalizeSearchText(label);
  const queryTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  if (!normalizedQuery) return undefined;
  if (normalizedLabel.includes(normalizedQuery)) {
    return { score: 1, matchType: 'SUBSTRING' };
  }
  if (queryTokens.every((token) => normalizedLabel.includes(token))) {
    return { score: 0.8, matchType: 'FULL_TEXT' };
  }
  const similarity = trigramSimilarity(normalizedLabel, normalizedQuery);
  return similarity >= 0.3 ? { score: similarity, matchType: 'TRIGRAM' } : undefined;
};

const candidateLabel = (candidate: KnowledgeCandidate): string => {
  switch (candidate.candidateType) {
    case 'ENTITY':
      return candidate.name;
    case 'RELATION':
      return `${candidate.fromCandidateId} ${candidate.relationType} ${candidate.toCandidateId}`;
    case 'EVENT':
      return candidate.title;
    case 'DECISION':
      return candidate.decisionText;
    case 'ACTION':
      return candidate.actionText;
    case 'CONFLICT':
      return candidate.summary;
    case 'KNOWLEDGE_GAP':
      return candidate.question;
  }
};

const candidateTemporalState = (
  candidate: KnowledgeCandidate,
  asOf: string,
): CompiledTruthItem['state'] => {
  if (candidate.candidateType === 'CONFLICT') return 'CONFLICT';
  if (candidate.candidateType === 'EVENT' && candidate.occurredAt) {
    return candidate.occurredAt > asOf ? 'FUTURE' : 'PAST';
  }
  if (candidate.candidateType === 'ACTION' && candidate.dueAt) {
    return candidate.dueAt > asOf ? 'FUTURE' : 'CURRENT';
  }
  if (candidate.candidateType === 'RELATION') {
    if (candidate.validFrom && candidate.validFrom > asOf) return 'FUTURE';
    if (candidate.validTo && candidate.validTo < asOf) return 'PAST';
  }
  return 'CURRENT';
};

const accessAllowed = (required: readonly string[], actual: readonly string[]): boolean => {
  const granted = new Set(actual);
  return required.every((scope) => granted.has(scope));
};

const canonicalWorkspaceStatus = (
  readiness: ProjectionReadiness,
): KnowledgeWorkspaceQueryProjectionStatus => ({
  source: 'CANONICAL_SEARCH',
  status: readiness.status,
  canonicalVersion: readiness.canonicalVersion,
  projectedCanonicalVersion: readiness.projectedCanonicalVersion,
  lag: readiness.lag,
  canonicalSnapshotDigest: readiness.canonicalSnapshotDigest,
  ...(readiness.projectedSnapshotDigest
    ? { projectedSnapshotDigest: readiness.projectedSnapshotDigest }
    : {}),
  ...(readiness.reason ? { reason: readiness.reason } : {}),
  ...(readiness.updatedAt ? { updatedAt: readiness.updatedAt } : {}),
});

const compiledWorkspaceStatus = (
  status: CompiledTruthProjectionStatus,
): KnowledgeWorkspaceQueryProjectionStatus => {
  const reason =
    status.lastError ??
    (status.status === 'STALE'
      ? 'Compiled Truth projection is behind its source.'
      : status.status === 'DEGRADED'
        ? 'Compiled Truth projection is degraded.'
        : status.status === 'NOT_BUILT'
          ? 'Compiled Truth has not been built.'
          : undefined);
  return {
    source: 'COMPILED_TRUTH',
    status: status.status,
    canonicalVersion: status.canonicalVersion,
    projectedCanonicalVersion: status.projectedCanonicalVersion,
    lag: status.lag,
    ...(status.sourceSnapshotDigest ? { sourceSnapshotDigest: status.sourceSnapshotDigest } : {}),
    ...(status.logicalDigest ? { projectionLogicalDigest: status.logicalDigest } : {}),
    ...(reason ? { reason } : {}),
    ...(status.updatedAt ? { updatedAt: status.updatedAt } : {}),
  };
};

const workspaceSourceIdentity = (source: KnowledgeWorkspaceSearchSource): string => {
  switch (source.authority) {
    case 'CANONICAL':
      return source.canonicalResourceId;
    case 'APPROVED_KNOWLEDGE':
      return source.candidateId;
    case 'COMPILED_TRUTH':
      return source.compiledItemId;
    case 'DERIVED_INFERENCE':
      return source.inferenceId;
  }
};

const workspaceRequestDigest = (request: SearchKnowledgeWorkspaceRequest): string => {
  const sorted = (values: readonly string[] | undefined): readonly string[] =>
    values === undefined ? [] : [...values].sort(compareWorkspaceStrings);
  return sha256Text(
    stableJson({
      normalizedQuery: normalizeSearchText(request.query),
      resourceId: request.resourceId ?? null,
      authorities: sorted(request.filters?.authorities),
      kinds: sorted(request.filters?.kinds),
      temporalStates: sorted(request.filters?.temporalStates),
      projectionStatuses: sorted(request.filters?.projectionStatuses),
      sensitivities: sorted(request.filters?.sensitivities),
    }),
  );
};

const cursorValidationError = (correlationId: string, message: string): never => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: message,
    module: 'stage7.projection-search',
    operation: 'SearchKnowledgeWorkspace',
    correlationId,
  });
};

const encodeWorkspaceCursor = (
  nextOffset: number,
  request: SearchKnowledgeWorkspaceRequest,
): string => {
  const payload: WorkspaceCursorPayload = {
    version: SEARCH_WORKSPACE_CURSOR_VERSION,
    nextOffset,
    rankingVersion: SEARCH_WORKSPACE_RANKING_VERSION,
    requestDigest: workspaceRequestDigest(request),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

const decodeWorkspaceCursor = (
  cursor: string | undefined,
  request: SearchKnowledgeWorkspaceRequest,
  correlationId: string,
): number => {
  if (cursor === undefined) return 0;
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      return cursorValidationError(correlationId, 'Knowledge Workspace search cursor is invalid.');
    }
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return cursorValidationError(correlationId, 'Knowledge Workspace search cursor is invalid.');
    }
    const payload = parsed as Record<string, unknown>;
    if (
      payload.version !== SEARCH_WORKSPACE_CURSOR_VERSION ||
      payload.rankingVersion !== SEARCH_WORKSPACE_RANKING_VERSION ||
      payload.requestDigest !== workspaceRequestDigest(request) ||
      typeof payload.nextOffset !== 'number' ||
      !Number.isSafeInteger(payload.nextOffset) ||
      payload.nextOffset < 0
    ) {
      return cursorValidationError(
        correlationId,
        'Knowledge Workspace search cursor does not match this request.',
      );
    }
    return payload.nextOffset;
  } catch (error) {
    if (error instanceof ShotgunError) throw error;
    return cursorValidationError(correlationId, 'Knowledge Workspace search cursor is invalid.');
  }
};

const scoreWorkspaceCandidates = (
  candidates: readonly WorkspaceCandidate[],
  normalizedQuery: string,
): readonly WorkspaceCandidate[] =>
  candidates.flatMap((candidate) => {
    const match = scoreWorkspaceText(candidate.label, normalizedQuery);
    return match ? [{ ...candidate, ...match }] : [];
  });

const invalidWorkspaceLineage = (correlationId: string): never => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: 'Knowledge Workspace search source lineage is incomplete.',
    module: 'stage7.projection-search',
    operation: 'SearchKnowledgeWorkspace',
    correlationId,
  });
};

const matchesWorkspaceFilters = (
  candidate: WorkspaceCandidate,
  request: SearchKnowledgeWorkspaceRequest,
  sensitivity: KnowledgeWorkspaceQuerySensitivity | undefined,
  sensitivityFilterMatches = true,
  inheritedProjectionStatus: KnowledgeWorkspaceQueryStatus | undefined = undefined,
): boolean => {
  const filters = request.filters;
  if (request.resourceId !== undefined && candidate.source.resourceId !== request.resourceId) {
    return false;
  }
  if (filters?.authorities !== undefined && !filters.authorities.includes(candidate.authority)) {
    return false;
  }
  if (filters?.kinds !== undefined && !filters.kinds.includes(candidate.kind)) return false;
  if (
    filters?.temporalStates !== undefined &&
    !filters.temporalStates.includes(candidate.temporalState)
  ) {
    return false;
  }
  const projectionStatus = candidate.projectionStatus?.status ?? inheritedProjectionStatus;
  if (
    filters?.projectionStatuses !== undefined &&
    (projectionStatus === undefined || !filters.projectionStatuses.includes(projectionStatus))
  ) {
    return false;
  }
  if (filters?.sensitivities !== undefined) {
    if (!sensitivityFilterMatches) return false;
    return sensitivity === undefined || filters.sensitivities.includes(sensitivity);
  }
  return true;
};

const assertContext = (envelope: CommandEnvelope | EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Search requires complete security context.',
      module: 'stage7.projection-search',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return { projectId: envelope.projectId, security: envelope.security };
};

const canonicalSnapshot = async (context: HandlerContext): Promise<CanonicalSnapshot> =>
  (
    await context.query<Record<string, never>, CanonicalSnapshot>({
      messageType: 'GetCanonicalSnapshot',
      schemaVersion: '1.0.0',
      payload: {},
    })
  ).payload;

const readinessFor = (
  snapshot: CanonicalSnapshot,
  watermark: ProjectionWatermark | undefined,
): ProjectionReadiness => {
  if (!watermark) {
    const ready = snapshot.version === 0;
    return {
      status: ready ? 'READY' : 'STALE',
      projectedCanonicalVersion: 0,
      canonicalVersion: snapshot.version,
      lag: snapshot.version,
      ...(ready ? { projectedSnapshotDigest: snapshot.digest } : {}),
      canonicalSnapshotDigest: snapshot.digest,
      ...(!ready ? { reason: 'Search Projection has not processed the Canonical Commit.' } : {}),
    };
  }
  const matches =
    watermark.canonicalVersion === snapshot.version && watermark.snapshotDigest === snapshot.digest;
  const status = watermark.status === 'DEGRADED' ? 'DEGRADED' : matches ? 'READY' : 'STALE';
  return {
    status,
    projectedCanonicalVersion: watermark.canonicalVersion,
    canonicalVersion: snapshot.version,
    lag: Math.max(0, snapshot.version - watermark.canonicalVersion),
    projectedSnapshotDigest: watermark.snapshotDigest,
    canonicalSnapshotDigest: snapshot.digest,
    ...(watermark.lastCommitId ? { lastCommitId: watermark.lastCommitId } : {}),
    updatedAt: watermark.updatedAt,
    ...(status !== 'READY'
      ? { reason: watermark.lastError ?? 'Search Projection is behind Canonical Knowledge.' }
      : {}),
  };
};

const documentFor = (
  claim: CanonicalClaim,
  commit: CanonicalCommitResult,
  canonicalVersion: number,
  projectedAt: string,
): SearchProjectionDocument => ({
  projectId: claim.projectId,
  claimId: claim.claimId,
  commitId: commit.commitId,
  revisionId: commit.revisionId,
  canonicalVersion,
  claimText: claim.claimText,
  sourceVersionId: claim.sourceVersionId,
  evidenceIds: claim.evidenceIds,
  accessScope: claim.accessScope,
  sensitivity: claim.sensitivity,
  projectedAt,
});

const loadDocument = async (
  context: HandlerContext,
  claimId: string,
  commitId: string | null,
  canonicalVersion: number,
  projectedAt: string,
): Promise<SearchProjectionDocument> => {
  const claim = (
    await context.query<{ claimId: string }, CanonicalClaim>({
      messageType: 'GetCanonicalClaim',
      schemaVersion: '1.0.0',
      payload: { claimId },
    })
  ).payload;
  // FE-P5-XP Correction B: legacy claims carry a manifest identity that doubles
  // as commit id; frontend claims do not (createdFromManifestId is null), so the
  // commit is resolved through Canonical history by claimId.
  let commit: CanonicalCommitResult;
  if (commitId !== null) {
    commit = (
      await context.query<{ commitId: string }, CanonicalCommitResult>({
        messageType: 'GetCanonicalCommit',
        schemaVersion: '1.0.0',
        payload: { commitId },
      })
    ).payload;
  } else {
    const history = (
      await context.query<Record<string, never>, { items: readonly CanonicalHistoryEvent[] }>({
        messageType: 'ListCanonicalHistory',
        schemaVersion: '1.0.0',
        payload: {},
      })
    ).payload.items;
    const event = history.find((entry) => entry.claimId === claimId);
    if (!event) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Canonical claim has no commit lineage.',
        module: 'projection-search',
        operation: 'rebuild-search-projection',
      });
    }
    commit = (
      await context.query<{ commitId: string }, CanonicalCommitResult>({
        messageType: 'GetCanonicalCommit',
        schemaVersion: '1.0.0',
        payload: { commitId: event.commitId },
      })
    ).payload;
  }
  return documentFor(claim, commit, canonicalVersion, projectedAt);
};

const canonicalSearchFor = async (
  context: HandlerContext,
  repository: SearchProjectionRepositoryPort,
  projectId: string,
  query: string,
  limit: number,
  accessScopes: readonly string[],
): Promise<CanonicalSearchResponse> => {
  const readiness = readinessFor(
    await canonicalSnapshot(context),
    await repository.findWatermark(projectId),
  );
  return {
    query,
    items:
      readiness.status === 'READY'
        ? await repository.search(projectId, query, limit, accessScopes)
        : [],
    readiness,
  };
};

const canonicalWorkspaceCandidate = async (
  context: HandlerContext,
  item: CanonicalSearchResult,
  projectionStatus: KnowledgeWorkspaceQueryProjectionStatus,
  correlationId: string,
): Promise<{
  readonly candidate: WorkspaceCandidate;
  readonly sensitivity: KnowledgeWorkspaceQuerySensitivity;
}> => {
  if (item.evidenceIds.length === 0) invalidWorkspaceLineage(correlationId);
  const [commit, revision] = await Promise.all([
    context.query<{ commitId: string }, CanonicalCommitResult>({
      messageType: 'GetCanonicalCommit',
      schemaVersion: '1.0.0',
      payload: { commitId: item.commitId },
    }),
    context.query<{ sourceVersionId: string }, TransformationRevision>({
      messageType: 'GetDocumentRevision',
      schemaVersion: '1.0.0',
      payload: { sourceVersionId: item.sourceVersionId },
    }),
  ]).then(
    ([commitResult, revisionResult]) => [commitResult.payload, revisionResult.payload] as const,
  );
  if (
    commit.projectId !== item.projectId ||
    commit.claimId !== item.claimId ||
    commit.revisionId !== item.revisionId ||
    commit.afterVersion !== item.canonicalVersion ||
    revision.projectId !== item.projectId ||
    revision.sourceVersionId !== item.sourceVersionId ||
    revision.sensitivity !== item.sensitivity ||
    !accessAllowed(revision.accessScope, item.accessScope) ||
    !accessAllowed(item.accessScope, revision.accessScope)
  ) {
    invalidWorkspaceLineage(correlationId);
  }
  const source = {
    authority: 'CANONICAL' as const,
    projectId: item.projectId,
    resourceId: revision.sourceId,
    resourceRevision: revision.revisionId,
    canonicalResourceId: item.claimId,
    canonicalRevisionId: item.revisionId,
    sourceId: revision.sourceId,
    sourceVersionId: item.sourceVersionId,
    evidenceIds: item.evidenceIds,
    commitId: item.commitId,
    manifestId: commit.manifestId ?? undefined,
    changeSetId: commit.changeSetId ?? undefined,
  };
  return {
    candidate: {
      projectId: item.projectId,
      score: 0,
      matchType: 'TRIGRAM',
      authority: 'CANONICAL',
      kind: 'CLAIM',
      temporalState: 'CURRENT',
      label: item.claimText,
      source,
      projectionStatus,
    },
    sensitivity: item.sensitivity,
  };
};

const buildCanonicalWorkspaceCandidates = async (
  context: HandlerContext,
  response: CanonicalSearchResponse,
  request: SearchKnowledgeWorkspaceRequest,
  sensitivity: KnowledgeWorkspaceQuerySensitivity,
  correlationId: string,
): Promise<readonly WorkspaceCandidate[]> => {
  const projectionStatus = canonicalWorkspaceStatus(response.readiness);
  const resolved = await Promise.all(
    response.items.map((item) =>
      canonicalWorkspaceCandidate(context, item, projectionStatus, correlationId),
    ),
  );
  return resolved
    .filter(
      ({ candidate, sensitivity: candidateSensitivity }) =>
        hasSensitivityClearance(sensitivity, candidateSensitivity) &&
        matchesWorkspaceFilters(candidate, request, candidateSensitivity),
    )
    .map(({ candidate }) => candidate);
};

const buildApprovedWorkspaceCandidates = async (
  context: HandlerContext,
  projectId: string,
  security: {
    readonly accessScope: readonly string[];
    readonly sensitivity: KnowledgeWorkspaceQuerySensitivity;
  },
  request: SearchKnowledgeWorkspaceRequest,
  generatedAt: string,
  correlationId: string,
): Promise<readonly WorkspaceCandidate[]> => {
  const groups = (
    await context.query<Record<string, never>, KnowledgeGroupListResult>({
      messageType: 'ListKnowledgeGroups',
      schemaVersion: '1.0.0',
      payload: {},
    })
  ).payload.items;
  const candidates: WorkspaceCandidate[] = [];
  for (const group of groups) {
    if (
      group.projectId !== projectId ||
      group.status !== 'APPROVED' ||
      !accessAllowed(group.accessScope, security.accessScope) ||
      !hasSensitivityClearance(security.sensitivity, group.sensitivity)
    ) {
      continue;
    }
    for (const item of group.items) {
      if (item.sourceVersionId !== group.sourceVersionId || item.evidenceIds.length === 0) {
        invalidWorkspaceLineage(correlationId);
      }
      const source = {
        authority: 'APPROVED_KNOWLEDGE' as const,
        projectId,
        resourceId: group.groupId,
        resourceRevision: String(group.revisionNumber),
        knowledgeGroupId: group.groupId,
        candidateId: item.candidateId,
        sourceVersionId: item.sourceVersionId,
        evidenceIds: item.evidenceIds,
      };
      const candidate: WorkspaceCandidate = {
        projectId,
        score: 0,
        matchType: 'TRIGRAM',
        authority: 'APPROVED_KNOWLEDGE',
        kind: item.candidateType,
        temporalState: candidateTemporalState(item, generatedAt),
        label: candidateLabel(item),
        source,
      };
      if (!matchesWorkspaceFilters(candidate, request, group.sensitivity)) continue;
      candidates.push(candidate);
    }
  }
  return candidates;
};

const buildCompiledWorkspaceCandidates = (
  response: GetCompiledTruthReadSnapshotResult,
  projectId: string,
  request: SearchKnowledgeWorkspaceRequest,
  security: {
    readonly accessScope: readonly string[];
    readonly sensitivity: KnowledgeWorkspaceQuerySensitivity;
  },
  correlationId: string,
): readonly WorkspaceCandidate[] => {
  if (response.projectId !== projectId) invalidWorkspaceLineage(correlationId);
  if (!response.projection) return [];
  const projectionStatus = compiledWorkspaceStatus(response.status);
  const candidates: WorkspaceCandidate[] = [];
  for (const item of response.projection.items) {
    if (
      item.evidenceIds.length === 0 ||
      !accessAllowed(item.accessScope, security.accessScope) ||
      !hasSensitivityClearance(security.sensitivity, item.sensitivity)
    ) {
      continue;
    }
    const source = {
      authority: 'COMPILED_TRUTH' as const,
      projectId: response.projectId,
      resourceId: item.id,
      resourceRevision: response.projection.logicalDigest,
      projectionLogicalDigest: response.projection.logicalDigest,
      compiledItemId: item.id,
      canonicalVersion: response.projection.canonicalVersion,
      sourceSnapshotDigest: response.projection.sourceSnapshotDigest,
      evidenceIds: item.evidenceIds,
    };
    const candidate: WorkspaceCandidate = {
      projectId: response.projectId,
      score: 0,
      matchType: 'TRIGRAM',
      authority: 'COMPILED_TRUTH',
      kind: item.type,
      temporalState: item.state,
      label: item.label,
      source,
      projectionStatus,
    };
    if (!matchesWorkspaceFilters(candidate, request, item.sensitivity)) continue;
    candidates.push(candidate);
  }
  return candidates;
};

const buildDerivedWorkspaceCandidates = async (
  context: HandlerContext,
  projectId: string,
  security: {
    readonly accessScope: readonly string[];
    readonly sensitivity: KnowledgeWorkspaceQuerySensitivity;
  },
  compiled: GetCompiledTruthReadSnapshotResult,
  request: SearchKnowledgeWorkspaceRequest,
  correlationId: string,
): Promise<readonly WorkspaceCandidate[]> => {
  if (compiled.projectId !== projectId) invalidWorkspaceLineage(correlationId);
  if (!compiled.projection) return [];
  const inferences = (
    await context.query<Record<string, never>, DerivedInferenceListResult>({
      messageType: 'ListDerivedInferences',
      schemaVersion: '1.0.0',
      payload: {},
    })
  ).payload.items;
  const nodes = new Map(compiled.projection.graph.nodes.map((node) => [node.id, node]));
  const inheritedStatus = compiled.status.status;
  const candidates: WorkspaceCandidate[] = [];
  for (const inference of inferences) {
    if (inference.sourceProjectionDigest !== compiled.projection.logicalDigest) continue;
    const related = inference.relatedNodeIds.map((nodeId) => nodes.get(nodeId));
    if (related.some((item) => item === undefined)) continue;
    const visibleRelated = related as CompiledTruthItem[];
    if (
      visibleRelated.some(
        (item) =>
          !accessAllowed(item.accessScope, security.accessScope) ||
          !hasSensitivityClearance(security.sensitivity, item.sensitivity),
      )
    ) {
      continue;
    }
    const evidenceIds = new Set(visibleRelated.flatMap((item) => item.evidenceIds));
    if (inference.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))) continue;
    const sensitivityFilterMatches =
      request.filters?.sensitivities === undefined ||
      visibleRelated.every((item) => request.filters!.sensitivities!.includes(item.sensitivity));
    const source = {
      authority: 'DERIVED_INFERENCE' as const,
      projectId,
      resourceId: inference.candidateId,
      resourceRevision: inference.sourceProjectionDigest,
      inferenceId: inference.candidateId,
      sourceProjectionDigest: inference.sourceProjectionDigest,
      evidenceIds: inference.evidenceIds,
    };
    const candidate: WorkspaceCandidate = {
      projectId,
      score: 0,
      matchType: 'TRIGRAM',
      authority: 'DERIVED_INFERENCE',
      kind: 'KNOWLEDGE_GAP',
      temporalState: 'CURRENT',
      label: inference.question,
      source,
    };
    if (
      !matchesWorkspaceFilters(
        candidate,
        request,
        undefined,
        sensitivityFilterMatches,
        inheritedStatus,
      )
    ) {
      continue;
    }
    candidates.push(candidate);
  }
  return candidates;
};

const rankWorkspaceCandidates = (
  candidates: readonly WorkspaceCandidate[],
): readonly SearchKnowledgeWorkspaceMatch[] =>
  [...candidates]
    .sort(
      (left, right) =>
        right.score - left.score ||
        workspaceMatchTypeOrder.indexOf(left.matchType) -
          workspaceMatchTypeOrder.indexOf(right.matchType) ||
        workspaceAuthorityOrder.indexOf(left.authority) -
          workspaceAuthorityOrder.indexOf(right.authority) ||
        compareWorkspaceStrings(
          workspaceSourceIdentity(left.source),
          workspaceSourceIdentity(right.source),
        ),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

export const createProjectionSearchModule = (
  repository: SearchProjectionRepositoryPort,
  clock: ProjectionClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage7.projection-search',
    version: '1.0.0',
    owner: 'Shotgun Cited Search',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' },
        { name: 'SearchCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'SearchKnowledgeWorkspace', range: '>=1.0.0 <2.0.0' },
        { name: 'GetProjectionReadiness', range: '>=1.0.0 <2.0.0' },
        { name: 'RebuildSearchProjection', range: '>=1.0.0 <2.0.0' },
        { name: 'ProjectionReady', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['projection.search_documents', 'projection.watermarks'],
      readsViaPorts: [
        'GetCanonicalSnapshot query',
        'GetCanonicalClaim query',
        'GetCanonicalCommit query',
        'ListCanonicalHistory query',
        'GetDocumentRevision query',
        'ListKnowledgeGroups query',
        'GetCompiledTruthReadSnapshot query',
        'ListDerivedInferences query',
      ],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [{ name: 'RebuildSearchProjection', range: '>=1.0.0 <2.0.0' }],
      events: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [{ name: 'ProjectionReady', range: '>=1.0.0 <2.0.0' }],
      handoffs: [
        {
          event: { name: 'ProjectionReady', range: '>=1.0.0 <2.0.0' },
          target: {
            kind: 'intentional',
            disposition: 'INTENTIONAL_TERMINAL',
            owner: 'stage7.projection-search',
            retention: 'projection.watermarks retention policy',
            observability: 'projection readiness audit and metrics',
          },
          tags: ['INTENTIONAL_TERMINAL'],
        },
      ],
    },
    provides: {
      queries: [
        { name: 'SearchCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'SearchKnowledgeWorkspace', range: '>=1.0.0 <2.0.0' },
        { name: 'GetProjectionReadiness', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'canonical-search-provider', priority: 100 }],
    },
    requires: {
      capabilities: [
        'canonical-knowledge-provider',
        'document-revision-provider',
        'rich-knowledge-review-provider',
        'compiled-truth-projector',
      ],
    },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'CanonicalCommitted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: canonicalCommittedSchema,
    },
    {
      name: 'GetCanonicalSnapshot',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalSnapshotSchema,
      outputSchema: canonicalSnapshotSchema,
    },
    {
      name: 'GetCanonicalClaim',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalClaimSchema,
      outputSchema: canonicalClaimSchema,
    },
    {
      name: 'GetCanonicalCommit',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalCommitSchema,
      outputSchema: canonicalCommitResultSchema,
    },
    {
      name: 'ListCanonicalHistory',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listCanonicalHistorySchema,
      outputSchema: listCanonicalHistoryOutputSchema,
    },
    {
      name: 'SearchCanonicalKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchCanonicalKnowledgeSchema,
      outputSchema: canonicalSearchResponseSchema,
    },
    {
      name: 'SearchKnowledgeWorkspace',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchKnowledgeWorkspaceSchema,
      outputSchema: searchKnowledgeWorkspaceOutputSchema,
    },
    {
      name: 'GetProjectionReadiness',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getProjectionReadinessSchema,
      outputSchema: projectionReadinessSchema,
    },
    {
      name: 'RebuildSearchProjection',
      version: '1.0.0',
      kind: 'command',
      inputSchema: rebuildSearchProjectionSchema,
    },
    {
      name: 'ProjectionReady',
      version: '1.0.0',
      kind: 'event',
      inputSchema: projectionReadySchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'RebuildSearchProjection',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const snapshot = await canonicalSnapshot(context);
          const projectedAt = clock.now();
          const documents = await Promise.all(
            snapshot.claims.map(async (item) => {
              const claim = (
                await context.query<{ claimId: string }, CanonicalClaim>({
                  messageType: 'GetCanonicalClaim',
                  schemaVersion: '1.0.0',
                  payload: { claimId: item.claimId },
                })
              ).payload;
              return loadDocument(
                context,
                claim.claimId,
                claim.createdFromManifestId,
                snapshot.version,
                projectedAt,
              );
            }),
          );
          const history = (
            await context.query<Record<string, never>, { items: readonly CanonicalHistoryEvent[] }>(
              {
                messageType: 'ListCanonicalHistory',
                schemaVersion: '1.0.0',
                payload: {},
              },
            )
          ).payload.items;
          const lastCommitId = history.at(-1)?.commitId;
          try {
            await repository.rebuild(projectId, {
              documents,
              watermark: {
                projectId,
                ...(lastCommitId ? { lastCommitId } : {}),
                canonicalVersion: snapshot.version,
                snapshotDigest: snapshot.digest,
                status: 'READY',
                updatedAt: projectedAt,
              },
            });
            await context.publish({
              messageType: 'ProjectionReady',
              schemaVersion: '1.0.0',
              idempotencyKey: `projection-rebuild:${projectId}:${snapshot.digest}`,
              payload: {
                ...(lastCommitId ? { commitId: lastCommitId } : {}),
                canonicalVersion: snapshot.version,
                snapshotDigest: snapshot.digest,
                status: 'READY',
              },
            });
            return { rebuilt: documents.length, canonicalVersion: snapshot.version };
          } catch (error) {
            await repository.markDegraded(projectId, SEARCH_PROJECTION_UPDATE_FAILED, projectedAt);
            throw error;
          }
        },
      },
    ],
    events: [
      {
        messageType: 'CanonicalCommitted',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as CanonicalCommittedPayload;
          const projectedAt = clock.now();
          try {
            const document = payload.claimId
              ? await loadDocument(
                  context,
                  payload.claimId,
                  payload.commitId,
                  payload.canonicalVersion,
                  projectedAt,
                )
              : undefined;
            await repository.applyCommit(projectId, {
              ...(document ? { document } : {}),
              commitId: payload.commitId,
              operation: payload.operation,
              canonicalVersion: payload.canonicalVersion,
              snapshotDigest: payload.snapshotDigest,
              projectedAt,
            });
          } catch (error) {
            await repository.markDegraded(projectId, SEARCH_PROJECTION_UPDATE_FAILED, projectedAt);
            throw error;
          }
          await context.publish({
            messageType: 'ProjectionReady',
            schemaVersion: '1.0.0',
            idempotencyKey: `projection-ready:${payload.commitId}`,
            payload: {
              commitId: payload.commitId,
              canonicalVersion: payload.canonicalVersion,
              snapshotDigest: payload.snapshotDigest,
              status: 'READY',
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'GetProjectionReadiness',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          return readinessFor(
            await canonicalSnapshot(context),
            await repository.findWatermark(projectId),
          );
        },
      },
      {
        messageType: 'SearchCanonicalKnowledge',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context): Promise<CanonicalSearchResponse> {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { query: string; limit?: number };
          const query = payload.query.trim();
          return canonicalSearchFor(
            context,
            repository,
            projectId,
            query,
            payload.limit ?? 10,
            security.accessScope,
          );
        },
      },
      {
        messageType: 'SearchKnowledgeWorkspace',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context): Promise<SearchKnowledgeWorkspaceResult> {
          const { projectId, security } = assertContext(envelope);
          const request = decodeSearchKnowledgeWorkspaceRequest(envelope.payload);
          const offset = decodeWorkspaceCursor(request.cursor, request, envelope.correlationId);
          const generatedAt = clock.now();
          const canonical = await canonicalSearchFor(
            context,
            repository,
            projectId,
            request.query,
            SEARCH_WORKSPACE_CANONICAL_RETRIEVAL_LIMIT,
            security.accessScope,
          );
          const [approved, compiled] = await Promise.all([
            buildApprovedWorkspaceCandidates(
              context,
              projectId,
              security,
              request,
              generatedAt,
              envelope.correlationId,
            ),
            context.query<{ readonly schemaVersion: '1.0.0' }, GetCompiledTruthReadSnapshotResult>({
              messageType: 'GetCompiledTruthReadSnapshot',
              schemaVersion: '1.0.0',
              payload: { schemaVersion: '1.0.0' },
            }),
          ]);
          const compiledCandidates = buildCompiledWorkspaceCandidates(
            compiled.payload,
            projectId,
            request,
            security,
            envelope.correlationId,
          );
          const derived = await buildDerivedWorkspaceCandidates(
            context,
            projectId,
            security,
            compiled.payload,
            request,
            envelope.correlationId,
          );
          const candidates = [
            ...(await buildCanonicalWorkspaceCandidates(
              context,
              canonical,
              request,
              security.sensitivity,
              envelope.correlationId,
            )),
            ...approved,
            ...compiledCandidates,
            ...derived,
          ];
          const ranked = rankWorkspaceCandidates(
            scoreWorkspaceCandidates(candidates, normalizeSearchText(request.query)),
          );
          const pageSize = request.pageSize ?? SEARCH_WORKSPACE_DEFAULT_PAGE_SIZE;
          const matches = ranked.slice(offset, offset + pageSize);
          const canonicalStatus = canonicalWorkspaceStatus(canonical.readiness);
          const compiledStatus = compiledWorkspaceStatus(compiled.payload.status);
          const result: SearchKnowledgeWorkspaceResult = {
            schemaVersion: '1.0.0',
            projectId,
            query: request.query,
            ranking: {
              owner: 'stage7.projection-search',
              version: SEARCH_WORKSPACE_RANKING_VERSION,
              scoreNormalization: 'UNIT_INTERVAL_V1',
              tieBreak: 'SCORE_DESC_MATCH_TYPE_AUTHORITY_SOURCE_ID_ASC',
            },
            matches,
            ...(offset + pageSize < ranked.length
              ? { nextCursor: encodeWorkspaceCursor(offset + pageSize, request) }
              : {}),
            readiness: {
              canonicalSearch:
                canonicalStatus as SearchKnowledgeWorkspaceResult['readiness']['canonicalSearch'],
              sourceProjections: [compiledStatus],
              partial: canonicalStatus.status !== 'READY' || compiledStatus.status !== 'READY',
            },
            generatedAt,
          };
          return decodeSearchKnowledgeWorkspaceResult(result);
        },
      },
    ],
  },
});
