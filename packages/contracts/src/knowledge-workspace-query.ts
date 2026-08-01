import type {
  CompiledTruthEdge,
  CompiledTruthItem,
  CompiledTruthProjection,
  CompiledTruthProjectionStatus,
} from './compiled-truth.js';
import { FrontendContractError } from './frontend-foundation.js';

export const KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION = '1.0.0' as const;
export const SEARCH_KNOWLEDGE_WORKSPACE = 'SearchKnowledgeWorkspace' as const;
export const GET_COMPILED_TRUTH_READ_SNAPSHOT = 'GetCompiledTruthReadSnapshot' as const;
export const KNOWLEDGE_WORKSPACE_RANKING_VERSION = '1.0.0' as const;
export const KNOWLEDGE_WORKSPACE_SCORE_NORMALIZATION = 'UNIT_INTERVAL_V1' as const;
export const KNOWLEDGE_WORKSPACE_TIE_BREAK =
  'SCORE_DESC_MATCH_TYPE_AUTHORITY_SOURCE_ID_ASC' as const;

export type KnowledgeWorkspaceQueryAuthority =
  'CANONICAL' | 'APPROVED_KNOWLEDGE' | 'COMPILED_TRUTH' | 'DERIVED_INFERENCE';

export type KnowledgeWorkspaceQueryKind =
  | 'CLAIM'
  | 'FACT'
  | 'ENTITY'
  | 'RELATION'
  | 'EVENT'
  | 'DECISION'
  | 'ACTION'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP'
  | 'DERIVED_INFERENCE';

export type KnowledgeWorkspaceQueryTemporalState = 'CURRENT' | 'PAST' | 'FUTURE' | 'CONFLICT';
export type KnowledgeWorkspaceQueryStatus = 'READY' | 'STALE' | 'DEGRADED' | 'NOT_BUILT';
export type KnowledgeWorkspaceQuerySensitivity = 'public' | 'internal' | 'private' | 'restricted';
export type KnowledgeWorkspaceQueryMatchType = 'FULL_TEXT' | 'TRIGRAM' | 'SUBSTRING';
export type KnowledgeWorkspaceQuerySource =
  'CANONICAL_SEARCH' | 'KNOWLEDGE_MODEL' | 'COMPILED_TRUTH' | 'DERIVED_INFERENCE';

export type SearchKnowledgeWorkspaceFilter = {
  readonly authorities?: readonly KnowledgeWorkspaceQueryAuthority[];
  readonly kinds?: readonly KnowledgeWorkspaceQueryKind[];
  readonly temporalStates?: readonly KnowledgeWorkspaceQueryTemporalState[];
  readonly projectionStatuses?: readonly KnowledgeWorkspaceQueryStatus[];
  readonly sensitivities?: readonly KnowledgeWorkspaceQuerySensitivity[];
};

export type SearchKnowledgeWorkspaceRequest = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION;
  readonly query: string;
  readonly resourceId?: string;
  readonly filters?: SearchKnowledgeWorkspaceFilter;
  readonly cursor?: string;
  readonly pageSize?: number;
};

export type KnowledgeWorkspaceQueryProjectionStatus = {
  readonly source: KnowledgeWorkspaceQuerySource;
  readonly status: KnowledgeWorkspaceQueryStatus;
  readonly canonicalVersion: number;
  readonly projectedCanonicalVersion: number;
  readonly lag: number;
  readonly projectionId?: string;
  readonly canonicalSnapshotDigest?: string;
  readonly projectedSnapshotDigest?: string;
  readonly sourceSnapshotDigest?: string;
  readonly reason?: string;
  readonly updatedAt?: string;
};

export type KnowledgeWorkspaceSearchReadiness = {
  readonly canonicalSearch: KnowledgeWorkspaceQueryProjectionStatus & {
    readonly source: 'CANONICAL_SEARCH';
  };
  readonly sourceProjections: readonly KnowledgeWorkspaceQueryProjectionStatus[];
  readonly partial: boolean;
};

export type KnowledgeWorkspaceSearchRanking = {
  readonly owner: 'stage7.projection-search';
  readonly version: typeof KNOWLEDGE_WORKSPACE_RANKING_VERSION;
  readonly scoreNormalization: typeof KNOWLEDGE_WORKSPACE_SCORE_NORMALIZATION;
  readonly tieBreak: typeof KNOWLEDGE_WORKSPACE_TIE_BREAK;
};

export type KnowledgeWorkspaceCanonicalSource = {
  readonly authority: 'CANONICAL';
  readonly projectId: string;
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly canonicalResourceId: string;
  readonly canonicalRevisionId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly commitId: string;
  readonly manifestId?: string;
  readonly changeSetId?: string;
};

export type KnowledgeWorkspaceApprovedSource = {
  readonly authority: 'APPROVED_KNOWLEDGE';
  readonly projectId: string;
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly knowledgeGroupId: string;
  readonly candidateId: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
};

export type KnowledgeWorkspaceCompiledSource = {
  readonly authority: 'COMPILED_TRUTH';
  readonly projectId: string;
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly projectionId: string;
  readonly compiledItemId: string;
  readonly canonicalVersion: number;
  readonly sourceSnapshotDigest: string;
  readonly evidenceIds: readonly string[];
};

export type KnowledgeWorkspaceDerivedSource = {
  readonly authority: 'DERIVED_INFERENCE';
  readonly projectId: string;
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly projectionId: string;
  readonly inferenceId: string;
  readonly sourceProjectionDigest: string;
  readonly evidenceIds: readonly string[];
};

export type KnowledgeWorkspaceSearchSource =
  | KnowledgeWorkspaceCanonicalSource
  | KnowledgeWorkspaceApprovedSource
  | KnowledgeWorkspaceCompiledSource
  | KnowledgeWorkspaceDerivedSource;

export type SearchKnowledgeWorkspaceMatch = {
  readonly projectId: string;
  readonly rank: number;
  readonly score: number;
  readonly matchType: KnowledgeWorkspaceQueryMatchType;
  readonly authority: KnowledgeWorkspaceQueryAuthority;
  readonly kind: KnowledgeWorkspaceQueryKind;
  readonly temporalState: KnowledgeWorkspaceQueryTemporalState;
  readonly label: string;
  readonly source: KnowledgeWorkspaceSearchSource;
  readonly projectionStatus?: KnowledgeWorkspaceQueryProjectionStatus;
};

export type SearchKnowledgeWorkspaceResult = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION;
  readonly projectId: string;
  readonly query: string;
  readonly ranking: KnowledgeWorkspaceSearchRanking;
  readonly matches: readonly SearchKnowledgeWorkspaceMatch[];
  readonly nextCursor?: string;
  readonly readiness: KnowledgeWorkspaceSearchReadiness;
  readonly generatedAt: string;
};

export type GetCompiledTruthReadSnapshotRequest = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION;
};

export type GetCompiledTruthReadSnapshotResult = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION;
  readonly projectId: string;
  readonly status: CompiledTruthProjectionStatus;
  readonly projection?: CompiledTruthProjection;
};

const fail = (path: string, message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path} ${message}`);
};

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be an object.');
  }
  return value as Record<string, unknown>;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  const input = object(value, path);
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(input).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) return fail(path, `contains unknown field '${unknownKey}'.`);
  return input;
};

const text = (value: unknown, path: string, maxLength = 2048): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    return fail(path, `must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value;
};

const optionalText = (value: unknown, path: string, maxLength = 2048): string | undefined =>
  value === undefined ? undefined : text(value, path, maxLength);

const positiveInteger = (value: unknown, path: string, maximum: number): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    return fail(path, `must be a positive integer no greater than ${maximum}.`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'must be a non-negative integer.');
  }
  return value;
};

const score = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return fail(path, 'must be a finite number in the inclusive range [0, 1].');
  }
  return value;
};

const timestamp = (value: unknown, path: string): string => {
  const result = text(value, path, 100);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    Number.isNaN(Date.parse(result))
  ) {
    return fail(path, 'must be a valid ISO 8601 timestamp.');
  }
  return result;
};

const digest = (value: unknown, path: string): string => {
  const result = text(value, path, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) return fail(path, 'must be a SHA-256 digest.');
  return result;
};

const idList = (value: unknown, path: string, minimum = 0, maximum = 500): readonly string[] => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return fail(path, `must be an array with ${minimum} to ${maximum} items.`);
  }
  const result = value.map((item, index) => text(item, `${path}[${index}]`, 256));
  if (new Set(result).size !== result.length)
    return fail(path, 'must not contain duplicate values.');
  return result;
};

const enumValue = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
  label: string,
): T => {
  if (!values.includes(value as T)) return fail(path, `must be a supported ${label}.`);
  return value as T;
};

const enumList = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
  label: string,
): readonly T[] => {
  if (!Array.isArray(value) || value.length > values.length) {
    return fail(path, `must be an array with no more than ${values.length} items.`);
  }
  const result = value.map((item, index) => enumValue(item, `${path}[${index}]`, values, label));
  if (new Set(result).size !== result.length)
    return fail(path, 'must not contain duplicate values.');
  return result;
};

const schemaVersion = (value: unknown, path: string): void => {
  if (value !== KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION) {
    return fail(path, `must equal '${KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION}'.`);
  }
};

const authorityValues: readonly KnowledgeWorkspaceQueryAuthority[] = [
  'CANONICAL',
  'APPROVED_KNOWLEDGE',
  'COMPILED_TRUTH',
  'DERIVED_INFERENCE',
];
const kindValues: readonly KnowledgeWorkspaceQueryKind[] = [
  'CLAIM',
  'FACT',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
  'ACTION',
  'CONFLICT',
  'KNOWLEDGE_GAP',
  'DERIVED_INFERENCE',
];
const temporalValues: readonly KnowledgeWorkspaceQueryTemporalState[] = [
  'CURRENT',
  'PAST',
  'FUTURE',
  'CONFLICT',
];
const statusValues: readonly KnowledgeWorkspaceQueryStatus[] = [
  'READY',
  'STALE',
  'DEGRADED',
  'NOT_BUILT',
];
const sensitivityValues: readonly KnowledgeWorkspaceQuerySensitivity[] = [
  'public',
  'internal',
  'private',
  'restricted',
];
const matchTypeValues: readonly KnowledgeWorkspaceQueryMatchType[] = [
  'FULL_TEXT',
  'TRIGRAM',
  'SUBSTRING',
];
const sourceValues: readonly KnowledgeWorkspaceQuerySource[] = [
  'CANONICAL_SEARCH',
  'KNOWLEDGE_MODEL',
  'COMPILED_TRUTH',
  'DERIVED_INFERENCE',
];

export const decodeSearchKnowledgeWorkspaceFilter = (
  value: unknown,
  path = 'filters',
): SearchKnowledgeWorkspaceFilter => {
  const input = strictObject(
    value,
    ['authorities', 'kinds', 'temporalStates', 'projectionStatuses', 'sensitivities'],
    path,
  );
  const authorities =
    input.authorities === undefined
      ? undefined
      : enumList(input.authorities, `${path}.authorities`, authorityValues, 'authority');
  const kinds =
    input.kinds === undefined
      ? undefined
      : enumList(input.kinds, `${path}.kinds`, kindValues, 'kind');
  const temporalStates =
    input.temporalStates === undefined
      ? undefined
      : enumList(input.temporalStates, `${path}.temporalStates`, temporalValues, 'temporal state');
  const projectionStatuses =
    input.projectionStatuses === undefined
      ? undefined
      : enumList(input.projectionStatuses, `${path}.projectionStatuses`, statusValues, 'status');
  const sensitivities =
    input.sensitivities === undefined
      ? undefined
      : enumList(input.sensitivities, `${path}.sensitivities`, sensitivityValues, 'sensitivity');
  return {
    ...(authorities === undefined ? {} : { authorities }),
    ...(kinds === undefined ? {} : { kinds }),
    ...(temporalStates === undefined ? {} : { temporalStates }),
    ...(projectionStatuses === undefined ? {} : { projectionStatuses }),
    ...(sensitivities === undefined ? {} : { sensitivities }),
  };
};

export const decodeSearchKnowledgeWorkspaceRequest = (
  value: unknown,
): SearchKnowledgeWorkspaceRequest => {
  const input = strictObject(
    value,
    ['schemaVersion', 'query', 'resourceId', 'filters', 'cursor', 'pageSize'],
    'searchKnowledgeWorkspaceRequest',
  );
  schemaVersion(input.schemaVersion, 'searchKnowledgeWorkspaceRequest.schemaVersion');
  const resourceId = optionalText(
    input.resourceId,
    'searchKnowledgeWorkspaceRequest.resourceId',
    256,
  );
  const filters =
    input.filters === undefined
      ? undefined
      : decodeSearchKnowledgeWorkspaceFilter(
          input.filters,
          'searchKnowledgeWorkspaceRequest.filters',
        );
  const cursor = optionalText(input.cursor, 'searchKnowledgeWorkspaceRequest.cursor', 2048);
  const pageSize =
    input.pageSize === undefined
      ? undefined
      : positiveInteger(input.pageSize, 'searchKnowledgeWorkspaceRequest.pageSize', 100);
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION,
    query: text(input.query, 'searchKnowledgeWorkspaceRequest.query', 1000),
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(filters === undefined ? {} : { filters }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
};

export const decodeGetCompiledTruthReadSnapshotRequest = (
  value: unknown,
): GetCompiledTruthReadSnapshotRequest => {
  const input = strictObject(value, ['schemaVersion'], 'getCompiledTruthReadSnapshotRequest');
  schemaVersion(input.schemaVersion, 'getCompiledTruthReadSnapshotRequest.schemaVersion');
  return { schemaVersion: KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION };
};

const decodeProjectionStatus = (
  value: unknown,
  path: string,
): KnowledgeWorkspaceQueryProjectionStatus => {
  const input = strictObject(
    value,
    [
      'source',
      'status',
      'canonicalVersion',
      'projectedCanonicalVersion',
      'lag',
      'projectionId',
      'canonicalSnapshotDigest',
      'projectedSnapshotDigest',
      'sourceSnapshotDigest',
      'reason',
      'updatedAt',
    ],
    path,
  );
  const source = enumValue(input.source, `${path}.source`, sourceValues, 'source');
  const status = enumValue(input.status, `${path}.status`, statusValues, 'status');
  const canonicalVersion = nonNegativeInteger(input.canonicalVersion, `${path}.canonicalVersion`);
  const projectedCanonicalVersion = nonNegativeInteger(
    input.projectedCanonicalVersion,
    `${path}.projectedCanonicalVersion`,
  );
  const lag = nonNegativeInteger(input.lag, `${path}.lag`);
  if (projectedCanonicalVersion > canonicalVersion) {
    return fail(path, 'projectedCanonicalVersion cannot exceed canonicalVersion.');
  }
  if (lag !== canonicalVersion - projectedCanonicalVersion) {
    return fail(path, 'lag must equal canonicalVersion - projectedCanonicalVersion.');
  }
  if (status === 'READY' && lag !== 0) return fail(path, 'READY must have zero lag.');
  if (status === 'STALE' && lag === 0) return fail(path, 'STALE must have positive lag.');
  if (status !== 'READY' && input.reason === undefined) {
    return fail(path, `${status} requires a safe reason.`);
  }
  if (status === 'NOT_BUILT' && input.projectionId !== undefined) {
    return fail(path, 'NOT_BUILT must not expose a fabricated projectionId.');
  }
  const projectionId = optionalText(input.projectionId, `${path}.projectionId`, 256);
  const canonicalSnapshotDigest =
    input.canonicalSnapshotDigest === undefined
      ? undefined
      : digest(input.canonicalSnapshotDigest, `${path}.canonicalSnapshotDigest`);
  const projectedSnapshotDigest =
    input.projectedSnapshotDigest === undefined
      ? undefined
      : digest(input.projectedSnapshotDigest, `${path}.projectedSnapshotDigest`);
  const sourceSnapshotDigest =
    input.sourceSnapshotDigest === undefined
      ? undefined
      : digest(input.sourceSnapshotDigest, `${path}.sourceSnapshotDigest`);
  const reason = optionalText(input.reason, `${path}.reason`, 1000);
  const updatedAt =
    input.updatedAt === undefined ? undefined : timestamp(input.updatedAt, `${path}.updatedAt`);
  return {
    source,
    status,
    canonicalVersion,
    projectedCanonicalVersion,
    lag,
    ...(projectionId === undefined ? {} : { projectionId }),
    ...(canonicalSnapshotDigest === undefined ? {} : { canonicalSnapshotDigest }),
    ...(projectedSnapshotDigest === undefined ? {} : { projectedSnapshotDigest }),
    ...(sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest }),
    ...(reason === undefined ? {} : { reason }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
};

const decodeRanking = (value: unknown): KnowledgeWorkspaceSearchRanking => {
  const input = strictObject(
    value,
    ['owner', 'version', 'scoreNormalization', 'tieBreak'],
    'searchKnowledgeWorkspaceResult.ranking',
  );
  if (input.owner !== 'stage7.projection-search') {
    return fail('searchKnowledgeWorkspaceResult.ranking.owner', 'must name Stage 7 as owner.');
  }
  if (input.version !== KNOWLEDGE_WORKSPACE_RANKING_VERSION) {
    return fail('searchKnowledgeWorkspaceResult.ranking.version', 'is unsupported.');
  }
  if (input.scoreNormalization !== KNOWLEDGE_WORKSPACE_SCORE_NORMALIZATION) {
    return fail('searchKnowledgeWorkspaceResult.ranking.scoreNormalization', 'is unsupported.');
  }
  if (input.tieBreak !== KNOWLEDGE_WORKSPACE_TIE_BREAK) {
    return fail('searchKnowledgeWorkspaceResult.ranking.tieBreak', 'is unsupported.');
  }
  return {
    owner: 'stage7.projection-search',
    version: KNOWLEDGE_WORKSPACE_RANKING_VERSION,
    scoreNormalization: KNOWLEDGE_WORKSPACE_SCORE_NORMALIZATION,
    tieBreak: KNOWLEDGE_WORKSPACE_TIE_BREAK,
  };
};

const requiredSourceFields = (input: Record<string, unknown>, path: string) => ({
  projectId: text(input.projectId, `${path}.projectId`, 256),
  resourceId: text(input.resourceId, `${path}.resourceId`, 256),
  resourceRevision: text(input.resourceRevision, `${path}.resourceRevision`, 256),
  evidenceIds: idList(input.evidenceIds, `${path}.evidenceIds`, 1),
});

const decodeSearchSource = (value: unknown, path: string): KnowledgeWorkspaceSearchSource => {
  const input = object(value, path);
  const authority = enumValue(input.authority, `${path}.authority`, authorityValues, 'authority');
  if (authority === 'CANONICAL') {
    const base = requiredSourceFields(input, path);
    const allowed = strictObject(
      input,
      [
        'authority',
        'projectId',
        'resourceId',
        'resourceRevision',
        'canonicalResourceId',
        'canonicalRevisionId',
        'sourceId',
        'sourceVersionId',
        'evidenceIds',
        'commitId',
        'manifestId',
        'changeSetId',
      ],
      path,
    );
    return {
      authority,
      ...base,
      canonicalResourceId: text(allowed.canonicalResourceId, `${path}.canonicalResourceId`, 256),
      canonicalRevisionId: text(allowed.canonicalRevisionId, `${path}.canonicalRevisionId`, 256),
      sourceId: text(allowed.sourceId, `${path}.sourceId`, 256),
      sourceVersionId: text(allowed.sourceVersionId, `${path}.sourceVersionId`, 256),
      commitId: text(allowed.commitId, `${path}.commitId`, 256),
      ...(allowed.manifestId === undefined
        ? {}
        : { manifestId: text(allowed.manifestId, `${path}.manifestId`, 256) }),
      ...(allowed.changeSetId === undefined
        ? {}
        : { changeSetId: text(allowed.changeSetId, `${path}.changeSetId`, 256) }),
    };
  }
  if (authority === 'APPROVED_KNOWLEDGE') {
    const base = requiredSourceFields(input, path);
    const allowed = strictObject(
      input,
      [
        'authority',
        'projectId',
        'resourceId',
        'resourceRevision',
        'knowledgeGroupId',
        'candidateId',
        'sourceVersionId',
        'evidenceIds',
      ],
      path,
    );
    return {
      authority,
      ...base,
      knowledgeGroupId: text(allowed.knowledgeGroupId, `${path}.knowledgeGroupId`, 256),
      candidateId: text(allowed.candidateId, `${path}.candidateId`, 256),
      sourceVersionId: text(allowed.sourceVersionId, `${path}.sourceVersionId`, 256),
    };
  }
  if (authority === 'COMPILED_TRUTH') {
    const base = requiredSourceFields(input, path);
    const allowed = strictObject(
      input,
      [
        'authority',
        'projectId',
        'resourceId',
        'resourceRevision',
        'projectionId',
        'compiledItemId',
        'canonicalVersion',
        'sourceSnapshotDigest',
        'evidenceIds',
      ],
      path,
    );
    return {
      authority,
      ...base,
      projectionId: text(allowed.projectionId, `${path}.projectionId`, 256),
      compiledItemId: text(allowed.compiledItemId, `${path}.compiledItemId`, 256),
      canonicalVersion: nonNegativeInteger(allowed.canonicalVersion, `${path}.canonicalVersion`),
      sourceSnapshotDigest: digest(allowed.sourceSnapshotDigest, `${path}.sourceSnapshotDigest`),
    };
  }
  const base = requiredSourceFields(input, path);
  const allowed = strictObject(
    input,
    [
      'authority',
      'projectId',
      'resourceId',
      'resourceRevision',
      'projectionId',
      'inferenceId',
      'sourceProjectionDigest',
      'evidenceIds',
    ],
    path,
  );
  return {
    authority,
    ...base,
    projectionId: text(allowed.projectionId, `${path}.projectionId`, 256),
    inferenceId: text(allowed.inferenceId, `${path}.inferenceId`, 256),
    sourceProjectionDigest: digest(
      allowed.sourceProjectionDigest,
      `${path}.sourceProjectionDigest`,
    ),
  };
};

const decodeSearchReadiness = (value: unknown): KnowledgeWorkspaceSearchReadiness => {
  const input = strictObject(
    value,
    ['canonicalSearch', 'sourceProjections', 'partial'],
    'searchKnowledgeWorkspaceResult.readiness',
  );
  const canonicalSearch = decodeProjectionStatus(
    input.canonicalSearch,
    'searchKnowledgeWorkspaceResult.readiness.canonicalSearch',
  );
  if (canonicalSearch.source !== 'CANONICAL_SEARCH') {
    return fail(
      'searchKnowledgeWorkspaceResult.readiness.canonicalSearch.source',
      "must be 'CANONICAL_SEARCH'.",
    );
  }
  if (!Array.isArray(input.sourceProjections) || input.sourceProjections.length > 4) {
    return fail(
      'searchKnowledgeWorkspaceResult.readiness.sourceProjections',
      'must contain no more than four sources.',
    );
  }
  const sourceProjections = input.sourceProjections.map((item, index) =>
    decodeProjectionStatus(
      item,
      `searchKnowledgeWorkspaceResult.readiness.sourceProjections[${index}]`,
    ),
  );
  if (sourceProjections.some((status) => status.source === 'CANONICAL_SEARCH')) {
    return fail(
      'searchKnowledgeWorkspaceResult.readiness.sourceProjections',
      'must not duplicate canonicalSearch.',
    );
  }
  if (new Set(sourceProjections.map((status) => status.source)).size !== sourceProjections.length) {
    return fail(
      'searchKnowledgeWorkspaceResult.readiness.sourceProjections',
      'must not contain duplicate sources.',
    );
  }
  if (typeof input.partial !== 'boolean') {
    return fail('searchKnowledgeWorkspaceResult.readiness.partial', 'must be a boolean.');
  }
  const partial =
    canonicalSearch.status !== 'READY' ||
    sourceProjections.some((status) => status.status !== 'READY');
  if (input.partial !== partial) {
    return fail(
      'searchKnowledgeWorkspaceResult.readiness.partial',
      'does not match source status.',
    );
  }
  return {
    canonicalSearch: canonicalSearch as KnowledgeWorkspaceSearchReadiness['canonicalSearch'],
    sourceProjections,
    partial,
  };
};

const decodeSearchMatch = (
  value: unknown,
  path: string,
  projectId: string,
): SearchKnowledgeWorkspaceMatch => {
  const input = strictObject(
    value,
    [
      'projectId',
      'rank',
      'score',
      'matchType',
      'authority',
      'kind',
      'temporalState',
      'label',
      'source',
      'projectionStatus',
    ],
    path,
  );
  const matchProjectId = text(input.projectId, `${path}.projectId`, 256);
  if (matchProjectId !== projectId) return fail(path, 'must remain in the requested Project.');
  const authority = enumValue(input.authority, `${path}.authority`, authorityValues, 'authority');
  const source = decodeSearchSource(input.source, `${path}.source`);
  if (source.authority !== authority) return fail(path, 'authority must match source.authority.');
  const projectionStatus =
    input.projectionStatus === undefined
      ? undefined
      : decodeProjectionStatus(input.projectionStatus, `${path}.projectionStatus`);
  return {
    projectId,
    rank: positiveInteger(input.rank, `${path}.rank`, Number.MAX_SAFE_INTEGER),
    score: score(input.score, `${path}.score`),
    matchType: enumValue(input.matchType, `${path}.matchType`, matchTypeValues, 'match type'),
    authority,
    kind: enumValue(input.kind, `${path}.kind`, kindValues, 'kind'),
    temporalState: enumValue(
      input.temporalState,
      `${path}.temporalState`,
      temporalValues,
      'temporal state',
    ),
    label: text(input.label, `${path}.label`, 10000),
    source,
    ...(projectionStatus === undefined ? {} : { projectionStatus }),
  };
};

export const decodeSearchKnowledgeWorkspaceResult = (
  value: unknown,
): SearchKnowledgeWorkspaceResult => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'query',
      'ranking',
      'matches',
      'nextCursor',
      'readiness',
      'generatedAt',
    ],
    'searchKnowledgeWorkspaceResult',
  );
  schemaVersion(input.schemaVersion, 'searchKnowledgeWorkspaceResult.schemaVersion');
  const projectId = text(input.projectId, 'searchKnowledgeWorkspaceResult.projectId', 256);
  const matches = Array.isArray(input.matches)
    ? input.matches.map((item, index) =>
        decodeSearchMatch(item, `searchKnowledgeWorkspaceResult.matches[${index}]`, projectId),
      )
    : fail('searchKnowledgeWorkspaceResult.matches', 'must be an array.');
  for (let index = 1; index < matches.length; index += 1) {
    const previous = matches[index - 1]!;
    const current = matches[index]!;
    if (current.rank <= previous.rank) {
      return fail('searchKnowledgeWorkspaceResult.matches', 'rank must be strictly increasing.');
    }
    if (current.score > previous.score) {
      return fail(
        'searchKnowledgeWorkspaceResult.matches',
        'score must be non-increasing by rank.',
      );
    }
  }
  const nextCursor = optionalText(
    input.nextCursor,
    'searchKnowledgeWorkspaceResult.nextCursor',
    2048,
  );
  const readiness = decodeSearchReadiness(input.readiness);
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION,
    projectId,
    query: text(input.query, 'searchKnowledgeWorkspaceResult.query', 1000),
    ranking: decodeRanking(input.ranking),
    matches,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    readiness,
    generatedAt: timestamp(input.generatedAt, 'searchKnowledgeWorkspaceResult.generatedAt'),
  };
};

const compiledKindValues: readonly CompiledTruthItem['type'][] = [
  'CLAIM',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
  'ACTION',
  'CONFLICT',
  'KNOWLEDGE_GAP',
];
const compiledStateValues: readonly CompiledTruthItem['state'][] = [
  'CURRENT',
  'PAST',
  'FUTURE',
  'CONFLICT',
];
const compiledSourceValues: readonly CompiledTruthItem['source'][] = [
  'CANONICAL_CLAIM',
  'APPROVED_KNOWLEDGE',
];

const decodeCompiledItem = (value: unknown, path: string): CompiledTruthItem => {
  const input = strictObject(
    value,
    ['id', 'type', 'label', 'state', 'source', 'evidenceIds', 'accessScope', 'sensitivity'],
    path,
  );
  return {
    id: text(input.id, `${path}.id`, 256),
    type: enumValue(input.type, `${path}.type`, compiledKindValues, 'Compiled Truth item type'),
    label: text(input.label, `${path}.label`, 10000),
    state: enumValue(input.state, `${path}.state`, compiledStateValues, 'temporal state'),
    source: enumValue(input.source, `${path}.source`, compiledSourceValues, 'item source'),
    evidenceIds: idList(input.evidenceIds, `${path}.evidenceIds`, 1),
    accessScope: idList(input.accessScope, `${path}.accessScope`, 1),
    sensitivity: enumValue(
      input.sensitivity,
      `${path}.sensitivity`,
      sensitivityValues,
      'sensitivity',
    ),
  };
};

const decodeCompiledEdge = (value: unknown, path: string): CompiledTruthEdge => {
  const input = strictObject(
    value,
    ['id', 'from', 'to', 'relationType', 'direction', 'source'],
    path,
  );
  return {
    id: text(input.id, `${path}.id`, 256),
    from: text(input.from, `${path}.from`, 256),
    to: text(input.to, `${path}.to`, 256),
    relationType: text(input.relationType, `${path}.relationType`, 256),
    direction: enumValue(
      input.direction,
      `${path}.direction`,
      ['DIRECTED', 'UNDIRECTED'],
      'direction',
    ),
    source: enumValue(input.source, `${path}.source`, ['APPROVED_TYPED_EDGE'], 'edge source'),
  };
};

const decodeCompiledProjection = (value: unknown, path: string): CompiledTruthProjection => {
  const input = strictObject(
    value,
    [
      'projectId',
      'projectorVersion',
      'sourceSnapshotDigest',
      'logicalDigest',
      'canonicalVersion',
      'items',
      'graph',
      'projectedAt',
      'buildMode',
    ],
    path,
  );
  const items = Array.isArray(input.items)
    ? input.items.map((item, index) => decodeCompiledItem(item, `${path}.items[${index}]`))
    : fail(`${path}.items`, 'must be an array.');
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    return fail(`${path}.items`, 'must not contain duplicate item IDs.');
  }
  const graph = strictObject(input.graph, ['nodes', 'edges', 'fallback'], `${path}.graph`);
  const nodes = Array.isArray(graph.nodes)
    ? graph.nodes.map((item, index) => decodeCompiledItem(item, `${path}.graph.nodes[${index}]`))
    : fail(`${path}.graph.nodes`, 'must be an array.');
  if (nodes.some((item) => item.type === 'RELATION')) {
    return fail(`${path}.graph.nodes`, 'must not contain RELATION items.');
  }
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = Array.isArray(graph.edges)
    ? graph.edges.map((edge, index) => decodeCompiledEdge(edge, `${path}.graph.edges[${index}]`))
    : fail(`${path}.graph.edges`, 'must be an array.');
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    return fail(`${path}.graph.edges`, 'must not contain duplicate edge IDs.');
  }
  if (edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
    return fail(`${path}.graph.edges`, 'must reference visible graph nodes only.');
  }
  const fallback = strictObject(graph.fallback, ['available', 'modes'], `${path}.graph.fallback`);
  if (
    fallback.available !== true ||
    JSON.stringify(fallback.modes) !== JSON.stringify(['LIST', 'TABLE'])
  ) {
    return fail(`${path}.graph.fallback`, 'must expose the LIST/TABLE accessible fallback.');
  }
  return {
    projectId: text(input.projectId, `${path}.projectId`, 256),
    projectorVersion: text(input.projectorVersion, `${path}.projectorVersion`, 100),
    sourceSnapshotDigest: digest(input.sourceSnapshotDigest, `${path}.sourceSnapshotDigest`),
    logicalDigest: digest(input.logicalDigest, `${path}.logicalDigest`),
    canonicalVersion: nonNegativeInteger(input.canonicalVersion, `${path}.canonicalVersion`),
    items,
    graph: { nodes, edges, fallback: { available: true, modes: ['LIST', 'TABLE'] } },
    projectedAt: timestamp(input.projectedAt, `${path}.projectedAt`),
    buildMode: enumValue(
      input.buildMode,
      `${path}.buildMode`,
      ['FULL_REBUILD', 'INCREMENTAL'],
      'build mode',
    ),
  };
};

const decodeCompiledProjectionStatus = (
  value: unknown,
  path: string,
): CompiledTruthProjectionStatus => {
  const input = strictObject(
    value,
    [
      'status',
      'projectorVersion',
      'canonicalVersion',
      'projectedCanonicalVersion',
      'lag',
      'sourceSnapshotDigest',
      'logicalDigest',
      'lastBuildMode',
      'updatedAt',
      'lastError',
    ],
    path,
  );
  const status = enumValue(
    input.status,
    `${path}.status`,
    ['NOT_BUILT', 'READY', 'STALE', 'DEGRADED'],
    'status',
  );
  const canonicalVersion = nonNegativeInteger(input.canonicalVersion, `${path}.canonicalVersion`);
  const projectedCanonicalVersion = nonNegativeInteger(
    input.projectedCanonicalVersion,
    `${path}.projectedCanonicalVersion`,
  );
  const lag = nonNegativeInteger(input.lag, `${path}.lag`);
  if (projectedCanonicalVersion > canonicalVersion) {
    return fail(path, 'projectedCanonicalVersion cannot exceed canonicalVersion.');
  }
  if (lag !== canonicalVersion - projectedCanonicalVersion) {
    return fail(path, 'lag must equal canonicalVersion - projectedCanonicalVersion.');
  }
  if (status === 'READY' && lag !== 0) return fail(path, 'READY must have zero lag.');
  if (status === 'NOT_BUILT' && projectedCanonicalVersion !== 0) {
    return fail(path, 'NOT_BUILT must have projectedCanonicalVersion 0.');
  }
  const sourceSnapshotDigest =
    input.sourceSnapshotDigest === undefined
      ? undefined
      : digest(input.sourceSnapshotDigest, `${path}.sourceSnapshotDigest`);
  const logicalDigest =
    input.logicalDigest === undefined
      ? undefined
      : digest(input.logicalDigest, `${path}.logicalDigest`);
  const lastBuildMode =
    input.lastBuildMode === undefined
      ? undefined
      : enumValue(
          input.lastBuildMode,
          `${path}.lastBuildMode`,
          ['FULL_REBUILD', 'INCREMENTAL'],
          'build mode',
        );
  if (
    status === 'READY' &&
    (sourceSnapshotDigest === undefined ||
      logicalDigest === undefined ||
      lastBuildMode === undefined)
  ) {
    return fail(path, 'READY requires sourceSnapshotDigest, logicalDigest and lastBuildMode.');
  }
  if (
    status === 'NOT_BUILT' &&
    (sourceSnapshotDigest !== undefined ||
      logicalDigest !== undefined ||
      lastBuildMode !== undefined)
  ) {
    return fail(path, 'NOT_BUILT must not expose projection identity.');
  }
  const updatedAt =
    input.updatedAt === undefined ? undefined : timestamp(input.updatedAt, `${path}.updatedAt`);
  const lastError = optionalText(input.lastError, `${path}.lastError`, 1000);
  if (status === 'DEGRADED' && lastError === undefined)
    return fail(path, 'DEGRADED requires lastError.');
  return {
    status,
    projectorVersion: text(input.projectorVersion, `${path}.projectorVersion`, 100),
    canonicalVersion,
    projectedCanonicalVersion,
    lag,
    ...(sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest }),
    ...(logicalDigest === undefined ? {} : { logicalDigest }),
    ...(lastBuildMode === undefined ? {} : { lastBuildMode }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(lastError === undefined ? {} : { lastError }),
  };
};

export const decodeGetCompiledTruthReadSnapshotResult = (
  value: unknown,
): GetCompiledTruthReadSnapshotResult => {
  const input = strictObject(
    value,
    ['schemaVersion', 'projectId', 'status', 'projection'],
    'getCompiledTruthReadSnapshotResult',
  );
  schemaVersion(input.schemaVersion, 'getCompiledTruthReadSnapshotResult.schemaVersion');
  const projectId = text(input.projectId, 'getCompiledTruthReadSnapshotResult.projectId', 256);
  const status = decodeCompiledProjectionStatus(
    input.status,
    'getCompiledTruthReadSnapshotResult.status',
  );
  const projection =
    input.projection === undefined
      ? undefined
      : decodeCompiledProjection(input.projection, 'getCompiledTruthReadSnapshotResult.projection');
  if (status.status === 'NOT_BUILT' && projection !== undefined) {
    return fail('getCompiledTruthReadSnapshotResult', 'NOT_BUILT cannot carry a projection.');
  }
  if (status.status === 'READY' && projection === undefined) {
    return fail('getCompiledTruthReadSnapshotResult', 'READY requires a projection.');
  }
  if (projection !== undefined) {
    if (projection.projectId !== projectId)
      return fail(
        'getCompiledTruthReadSnapshotResult',
        'projection Project differs from status Project.',
      );
    if (status.projectedCanonicalVersion !== projection.canonicalVersion) {
      return fail(
        'getCompiledTruthReadSnapshotResult',
        'status/projection canonical version differs.',
      );
    }
    if (status.projectorVersion !== projection.projectorVersion) {
      return fail(
        'getCompiledTruthReadSnapshotResult',
        'status/projection projector version differs.',
      );
    }
    if (
      status.sourceSnapshotDigest !== projection.sourceSnapshotDigest ||
      status.logicalDigest !== projection.logicalDigest ||
      status.lastBuildMode !== projection.buildMode
    ) {
      return fail(
        'getCompiledTruthReadSnapshotResult',
        'status/projection digest or build identity differs.',
      );
    }
    if (status.updatedAt !== projection.projectedAt) {
      return fail('getCompiledTruthReadSnapshotResult', 'status/projection timestamp differs.');
    }
  }
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_QUERY_SCHEMA_VERSION,
    projectId,
    status,
    ...(projection === undefined ? {} : { projection }),
  };
};
