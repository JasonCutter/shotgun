import { FrontendContractError } from './frontend-foundation.js';

export const KNOWLEDGE_WORKSPACE_SCHEMA_VERSION = '1.0.0' as const;

export type KnowledgeAuthority =
  'CANONICAL' | 'APPROVED_KNOWLEDGE' | 'COMPILED_TRUTH' | 'DERIVED_INFERENCE';

export type KnowledgeKind =
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

export type KnowledgeTemporalState = 'CURRENT' | 'PAST' | 'FUTURE' | 'CONFLICT';
export type KnowledgeProjectionStatus = 'READY' | 'STALE' | 'DEGRADED' | 'NOT_BUILT';
export type KnowledgeProjectionKind = 'CANONICAL_SEARCH' | 'COMPILED_TRUTH';
export type KnowledgeSearchMatchAuthority = 'CANONICAL' | 'PROJECTION';
export type KnowledgeSearchMatchType = 'FULL_TEXT' | 'TRIGRAM' | 'SUBSTRING';
export type KnowledgeDifferenceKind = 'ADDED' | 'REMOVED' | 'CHANGED';

export type KnowledgeReadCapability =
  'READ' | 'SEARCH' | 'FILTER' | 'COMPARE' | 'EVIDENCE_NAVIGATION';

export type KnowledgeFilter = {
  readonly authorities?: readonly KnowledgeAuthority[];
  readonly kinds?: readonly KnowledgeKind[];
  readonly temporalStates?: readonly KnowledgeTemporalState[];
  readonly projectionStatuses?: readonly KnowledgeProjectionStatus[];
};

export type KnowledgeWorkspaceRequest = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly resourceId?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
  readonly requestedRevision?: string;
  readonly focusId?: string;
};

export type KnowledgePageListRequest = KnowledgeWorkspaceRequest;

export type KnowledgeSearchRequest = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly query: string;
  readonly resourceId?: string;
  readonly filters?: KnowledgeFilter;
  readonly cursor?: string;
  readonly pageSize?: number;
  readonly requestedRevision?: string;
  readonly focusId?: string;
};

export type KnowledgeDetailRequest = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly resourceId: string;
  readonly requestedRevision?: string;
  readonly focusId?: string;
};

export type KnowledgeCompareRequest = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly pageIds: readonly [string, string];
  readonly requestedRevision?: string;
  readonly focusId?: string;
};

export type KnowledgeProjectionStatusView = {
  readonly projectionKind: KnowledgeProjectionKind;
  readonly status: KnowledgeProjectionStatus;
  readonly canonicalVersion: number;
  readonly projectedCanonicalVersion: number;
  readonly lag: number;
  readonly projectionRevision?: string;
  readonly reason?: string;
  readonly updatedAt?: string;
};

export type KnowledgeLineageView = {
  readonly projectId: string;
  readonly productId: string;
  readonly resourceRevision: string;
  readonly projectionId?: string;
  readonly canonicalResourceId?: string;
  readonly canonicalRevisionId?: string;
  readonly canonicalVersion?: number;
  readonly sourceId?: string;
  readonly sourceVersionId?: string;
  readonly evidenceIds?: readonly string[];
  readonly commitId?: string;
  readonly manifestId?: string;
  readonly changeSetId?: string;
  readonly projection?: KnowledgeProjectionStatusView;
};

export type KnowledgeEvidenceReturnTarget = {
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly focusId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
};

export type KnowledgeItemView = {
  readonly productId: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly revision: string;
  readonly authority: KnowledgeAuthority;
  readonly kind: KnowledgeKind;
  readonly temporalState: KnowledgeTemporalState;
  readonly label: string;
  readonly summary?: string;
  readonly content?: string;
  readonly lineage: KnowledgeLineageView;
  readonly evidenceTargets?: readonly KnowledgeEvidenceReturnTarget[];
};

export type KnowledgePageSummaryView = {
  readonly pageId: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly revision: string;
  readonly title: string;
  readonly primaryAuthority: KnowledgeAuthority;
  readonly primaryKind: KnowledgeKind;
  readonly projection: KnowledgeProjectionStatusView;
};

export type KnowledgePageView = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly pageId: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly revision: string;
  readonly focusId?: string;
  readonly title: string;
  readonly items: readonly KnowledgeItemView[];
  readonly lineage: KnowledgeLineageView;
  readonly projection: KnowledgeProjectionStatusView;
  readonly capabilities: readonly KnowledgeReadCapability[];
  readonly fetchedAt: string;
};

export type KnowledgeWorkspaceView = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly pages: readonly KnowledgePageSummaryView[];
  readonly projection: KnowledgeProjectionStatusView;
  readonly capabilities: readonly KnowledgeReadCapability[];
  readonly fetchedAt: string;
};

export type KnowledgePageListView = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly pages: readonly KnowledgePageSummaryView[];
  readonly nextCursor?: string;
  readonly projection: KnowledgeProjectionStatusView;
  readonly fetchedAt: string;
};

export type KnowledgeSearchMatchView = {
  readonly matchId: string;
  readonly projectId: string;
  readonly resourceId: string;
  readonly item: KnowledgeItemView;
  readonly score: number;
  readonly matchAuthority: KnowledgeSearchMatchAuthority;
  readonly matchType: KnowledgeSearchMatchType;
  readonly snippet?: string;
};

export type KnowledgeSearchResultView = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly query: string;
  readonly matches: readonly KnowledgeSearchMatchView[];
  readonly nextCursor?: string;
  readonly projection: KnowledgeProjectionStatusView;
  readonly fetchedAt: string;
};

export type KnowledgeDetailView = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly resourceId: string;
  readonly revision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly focusId?: string;
  readonly page: KnowledgePageView;
  readonly fetchedAt: string;
};

export type KnowledgeCompareDifferenceView = {
  readonly differenceId: string;
  readonly path: string;
  readonly kind: KnowledgeDifferenceKind;
  readonly leftValue?: string;
  readonly rightValue?: string;
};

export type KnowledgeCompareView = {
  readonly schemaVersion: typeof KNOWLEDGE_WORKSPACE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly left: KnowledgePageView;
  readonly right: KnowledgePageView;
  readonly differences: readonly KnowledgeCompareDifferenceView[];
  readonly projection: KnowledgeProjectionStatusView;
  readonly capabilities: readonly KnowledgeReadCapability[];
  readonly fetchedAt: string;
};

const fail = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  const obj = object(value, path);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(`${path} contains unknown field '${key}'.`);
    }
  }
  return obj;
};

const text = (value: unknown, path: string, minLen = 1, maxLen = 10000): string => {
  if (typeof value !== 'string') fail(`${path} must be a string.`);
  const val = value as string;
  const trimmed = val.trim();
  if (trimmed.length < minLen || val.length > maxLen) {
    fail(`${path} length out of bounds [${minLen}, ${maxLen}].`);
  }
  return val;
};

const idString = (value: unknown, path: string): string => text(value, path, 1, 256);
const optionalId = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : idString(value, path);
const optionalText = (
  value: unknown,
  path: string,
  minLen = 0,
  maxLen = 10000,
): string | undefined => (value === undefined ? undefined : text(value, path, minLen, maxLen));

const timestamp = (value: unknown, path: string): string => {
  const val = text(value, path, 1, 100);
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (!iso8601Regex.test(val) || Number.isNaN(Date.parse(val))) {
    fail(`${path} is not a valid ISO 8601 timestamp.`);
  }
  return val;
};

const nonNegativeInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(`${path} must be a non-negative integer.`);
  }
  return value as number;
};

const boundedPositiveInteger = (value: unknown, path: string, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    fail(`${path} must be a positive integer no greater than ${max}.`);
  }
  return value as number;
};

const finiteScore = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${path} must be a finite score in the range [0, 1].`);
  }
  return value as number;
};

const enumValue = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
  label: string,
): T => {
  if (!values.includes(value as T)) {
    fail(`${path} is unsupported ${label}.`);
  }
  return value as T;
};

const array = <T>(
  value: unknown,
  path: string,
  decoder: (item: unknown, index: number) => T,
  maxLen = 500,
): readonly T[] => {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  const arr = value as readonly unknown[];
  if (arr.length > maxLen) fail(`${path} array size exceeds limit of ${maxLen}.`);
  return arr.map((item, index) => decoder(item, index));
};

const idArray = (value: unknown, path: string, maxLen = 500): readonly string[] =>
  array(value, path, (item, index) => idString(item, `${path}[${index}]`), maxLen);

const enumArray = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
  label: string,
  maxLen = 32,
): readonly T[] => {
  const decoded = array(
    value,
    path,
    (item, index) => enumValue(item, `${path}[${index}]`, values, label),
    maxLen,
  );
  if (new Set(decoded).size !== decoded.length) {
    fail(`${path} must not contain duplicate values.`);
  }
  return decoded;
};

const optionalIdArray = (
  value: unknown,
  path: string,
  maxLen = 500,
): readonly string[] | undefined =>
  value === undefined ? undefined : idArray(value, path, maxLen);

const schema = (input: Record<string, unknown>, path: string): void => {
  if (input.schemaVersion !== KNOWLEDGE_WORKSPACE_SCHEMA_VERSION) {
    fail(`${path}.schemaVersion is unsupported.`);
  }
};

const optionalRequestFields = (
  input: Record<string, unknown>,
  path: string,
): Pick<
  KnowledgeWorkspaceRequest,
  'resourceId' | 'cursor' | 'pageSize' | 'requestedRevision' | 'focusId'
> => {
  const resourceId = optionalId(input.resourceId, `${path}.resourceId`);
  const cursor = optionalText(input.cursor, `${path}.cursor`, 1, 2048);
  const pageSize =
    input.pageSize === undefined
      ? undefined
      : boundedPositiveInteger(input.pageSize, `${path}.pageSize`, 100);
  const requestedRevision = optionalId(input.requestedRevision, `${path}.requestedRevision`);
  const focusId = optionalId(input.focusId, `${path}.focusId`);
  return {
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(requestedRevision === undefined ? {} : { requestedRevision }),
    ...(focusId === undefined ? {} : { focusId }),
  };
};

const decodeRequest = (
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> => {
  const input = strictObject(value, allowedKeys, path);
  schema(input, path);
  return input;
};

const knowledgeAuthorityValues: readonly KnowledgeAuthority[] = [
  'CANONICAL',
  'APPROVED_KNOWLEDGE',
  'COMPILED_TRUTH',
  'DERIVED_INFERENCE',
];
const knowledgeKindValues: readonly KnowledgeKind[] = [
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
const temporalStateValues: readonly KnowledgeTemporalState[] = [
  'CURRENT',
  'PAST',
  'FUTURE',
  'CONFLICT',
];
const projectionStatusValues: readonly KnowledgeProjectionStatus[] = [
  'READY',
  'STALE',
  'DEGRADED',
  'NOT_BUILT',
];
const projectionKindValues: readonly KnowledgeProjectionKind[] = [
  'CANONICAL_SEARCH',
  'COMPILED_TRUTH',
];
const capabilityValues: readonly KnowledgeReadCapability[] = [
  'READ',
  'SEARCH',
  'FILTER',
  'COMPARE',
  'EVIDENCE_NAVIGATION',
];

const decodeOptionalRequest = (
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): KnowledgeWorkspaceRequest => {
  const input = decodeRequest(value, path, allowedKeys);
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    ...optionalRequestFields(input, path),
  };
};

export const decodeKnowledgeWorkspaceRequest = (value: unknown): KnowledgeWorkspaceRequest =>
  decodeOptionalRequest(value, 'knowledgeWorkspaceRequest', [
    'schemaVersion',
    'resourceId',
    'cursor',
    'pageSize',
    'requestedRevision',
    'focusId',
  ]);

export const decodeKnowledgePageListRequest = (value: unknown): KnowledgePageListRequest =>
  decodeOptionalRequest(value, 'knowledgePageListRequest', [
    'schemaVersion',
    'resourceId',
    'cursor',
    'pageSize',
    'requestedRevision',
    'focusId',
  ]);

export const decodeKnowledgeSearchFilter = (value: unknown, path = 'filters'): KnowledgeFilter => {
  const input = strictObject(
    value,
    ['authorities', 'kinds', 'temporalStates', 'projectionStatuses'],
    path,
  );
  const authorities =
    input.authorities === undefined
      ? undefined
      : enumArray(
          input.authorities,
          `${path}.authorities`,
          knowledgeAuthorityValues,
          'KnowledgeAuthority',
        );
  const kinds =
    input.kinds === undefined
      ? undefined
      : enumArray(input.kinds, `${path}.kinds`, knowledgeKindValues, 'KnowledgeKind');
  const temporalStates =
    input.temporalStates === undefined
      ? undefined
      : enumArray(
          input.temporalStates,
          `${path}.temporalStates`,
          temporalStateValues,
          'KnowledgeTemporalState',
        );
  const projectionStatuses =
    input.projectionStatuses === undefined
      ? undefined
      : enumArray(
          input.projectionStatuses,
          `${path}.projectionStatuses`,
          projectionStatusValues,
          'KnowledgeProjectionStatus',
        );
  return {
    ...(authorities === undefined ? {} : { authorities }),
    ...(kinds === undefined ? {} : { kinds }),
    ...(temporalStates === undefined ? {} : { temporalStates }),
    ...(projectionStatuses === undefined ? {} : { projectionStatuses }),
  };
};

export const decodeKnowledgeSearchRequest = (value: unknown): KnowledgeSearchRequest => {
  const input = decodeRequest(value, 'knowledgeSearchRequest', [
    'schemaVersion',
    'query',
    'resourceId',
    'filters',
    'cursor',
    'pageSize',
    'requestedRevision',
    'focusId',
  ]);
  const query = text(input.query, 'knowledgeSearchRequest.query', 1, 1000);
  const filters =
    input.filters === undefined
      ? undefined
      : decodeKnowledgeSearchFilter(input.filters, 'knowledgeSearchRequest.filters');
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    query,
    ...optionalRequestFields(input, 'knowledgeSearchRequest'),
    ...(filters === undefined ? {} : { filters }),
  };
};

export const decodeKnowledgeDetailRequest = (value: unknown): KnowledgeDetailRequest => {
  const input = decodeRequest(value, 'knowledgeDetailRequest', [
    'schemaVersion',
    'resourceId',
    'requestedRevision',
    'focusId',
  ]);
  const resourceId = idString(input.resourceId, 'knowledgeDetailRequest.resourceId');
  const requestedRevision = optionalId(
    input.requestedRevision,
    'knowledgeDetailRequest.requestedRevision',
  );
  const focusId = optionalId(input.focusId, 'knowledgeDetailRequest.focusId');
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    resourceId,
    ...(requestedRevision === undefined ? {} : { requestedRevision }),
    ...(focusId === undefined ? {} : { focusId }),
  };
};

export const decodeKnowledgeCompareRequest = (value: unknown): KnowledgeCompareRequest => {
  const input = decodeRequest(value, 'knowledgeCompareRequest', [
    'schemaVersion',
    'pageIds',
    'requestedRevision',
    'focusId',
  ]);
  const pageIds = idArray(input.pageIds, 'knowledgeCompareRequest.pageIds', 2);
  if (pageIds.length !== 2) {
    fail('knowledgeCompareRequest.pageIds must contain exactly two pages.');
  }
  const leftPageId = pageIds[0]!;
  const rightPageId = pageIds[1]!;
  if (leftPageId === rightPageId) {
    fail('knowledgeCompareRequest.pageIds must contain two distinct pages.');
  }
  const requestedRevision = optionalId(
    input.requestedRevision,
    'knowledgeCompareRequest.requestedRevision',
  );
  const focusId = optionalId(input.focusId, 'knowledgeCompareRequest.focusId');
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    pageIds: [leftPageId, rightPageId],
    ...(requestedRevision === undefined ? {} : { requestedRevision }),
    ...(focusId === undefined ? {} : { focusId }),
  };
};

export const decodeKnowledgeProjectionStatusView = (
  value: unknown,
  path = 'projection',
): KnowledgeProjectionStatusView => {
  const input = strictObject(
    value,
    [
      'projectionKind',
      'status',
      'canonicalVersion',
      'projectedCanonicalVersion',
      'lag',
      'projectionRevision',
      'reason',
      'updatedAt',
    ],
    path,
  );
  const projectionKind = enumValue(
    input.projectionKind,
    `${path}.projectionKind`,
    projectionKindValues,
    'KnowledgeProjectionKind',
  );
  const status = enumValue(
    input.status,
    `${path}.status`,
    projectionStatusValues,
    'KnowledgeProjectionStatus',
  );
  const canonicalVersion = nonNegativeInteger(input.canonicalVersion, `${path}.canonicalVersion`);
  const projectedCanonicalVersion = nonNegativeInteger(
    input.projectedCanonicalVersion,
    `${path}.projectedCanonicalVersion`,
  );
  const lag = nonNegativeInteger(input.lag, `${path}.lag`);
  if (projectedCanonicalVersion > canonicalVersion) {
    fail(`${path}.projectedCanonicalVersion cannot exceed canonicalVersion.`);
  }
  if (lag !== canonicalVersion - projectedCanonicalVersion) {
    fail(`${path}.lag must equal canonicalVersion - projectedCanonicalVersion.`);
  }
  if (status === 'READY' && (lag !== 0 || projectedCanonicalVersion !== canonicalVersion)) {
    fail(`${path}.READY must have zero lag and equal canonical/projected versions.`);
  }
  if (status === 'STALE' && lag === 0 && projectedCanonicalVersion === canonicalVersion) {
    fail(`${path}.STALE cannot describe a zero-lag projection.`);
  }
  const projectionRevision = optionalId(input.projectionRevision, `${path}.projectionRevision`);
  const reason = optionalText(input.reason, `${path}.reason`, 1, 1000);
  if (status === 'READY' && reason !== undefined) {
    fail(`${path}.READY must not carry a degradation or staleness reason.`);
  }
  if (status !== 'READY' && reason === undefined) {
    fail(`${path}.${status} requires a safe reason.`);
  }
  if (status === 'NOT_BUILT' && projectionRevision !== undefined) {
    fail(`${path}.NOT_BUILT must not carry a fabricated projectionRevision.`);
  }
  const updatedAt =
    input.updatedAt === undefined ? undefined : timestamp(input.updatedAt, `${path}.updatedAt`);
  return {
    projectionKind,
    status,
    canonicalVersion,
    projectedCanonicalVersion,
    lag,
    ...(projectionRevision === undefined ? {} : { projectionRevision }),
    ...(reason === undefined ? {} : { reason }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
};

export const decodeKnowledgeLineageView = (
  value: unknown,
  path = 'lineage',
): KnowledgeLineageView => {
  const input = strictObject(
    value,
    [
      'projectId',
      'productId',
      'resourceRevision',
      'projectionId',
      'canonicalResourceId',
      'canonicalRevisionId',
      'canonicalVersion',
      'sourceId',
      'sourceVersionId',
      'evidenceIds',
      'commitId',
      'manifestId',
      'changeSetId',
      'projection',
    ],
    path,
  );
  const projectId = idString(input.projectId, `${path}.projectId`);
  const productId = idString(input.productId, `${path}.productId`);
  const resourceRevision = idString(input.resourceRevision, `${path}.resourceRevision`);
  const projectionId = optionalId(input.projectionId, `${path}.projectionId`);
  const canonicalResourceId = optionalId(input.canonicalResourceId, `${path}.canonicalResourceId`);
  const canonicalRevisionId = optionalId(input.canonicalRevisionId, `${path}.canonicalRevisionId`);
  const canonicalVersion =
    input.canonicalVersion === undefined
      ? undefined
      : nonNegativeInteger(input.canonicalVersion, `${path}.canonicalVersion`);
  const sourceId = optionalId(input.sourceId, `${path}.sourceId`);
  const sourceVersionId = optionalId(input.sourceVersionId, `${path}.sourceVersionId`);
  const evidenceIds = optionalIdArray(input.evidenceIds, `${path}.evidenceIds`);
  if (evidenceIds !== undefined && sourceVersionId === undefined) {
    fail(`${path}.evidenceIds requires a pinned sourceVersionId.`);
  }
  const commitId = optionalId(input.commitId, `${path}.commitId`);
  const manifestId = optionalId(input.manifestId, `${path}.manifestId`);
  const changeSetId = optionalId(input.changeSetId, `${path}.changeSetId`);
  const projection =
    input.projection === undefined
      ? undefined
      : decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`);
  return {
    projectId,
    productId,
    resourceRevision,
    ...(projectionId === undefined ? {} : { projectionId }),
    ...(canonicalResourceId === undefined ? {} : { canonicalResourceId }),
    ...(canonicalRevisionId === undefined ? {} : { canonicalRevisionId }),
    ...(canonicalVersion === undefined ? {} : { canonicalVersion }),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(sourceVersionId === undefined ? {} : { sourceVersionId }),
    ...(evidenceIds === undefined ? {} : { evidenceIds }),
    ...(commitId === undefined ? {} : { commitId }),
    ...(manifestId === undefined ? {} : { manifestId }),
    ...(changeSetId === undefined ? {} : { changeSetId }),
    ...(projection === undefined ? {} : { projection }),
  };
};

export const decodeKnowledgeEvidenceReturnTarget = (
  value: unknown,
  path = 'evidenceTarget',
): KnowledgeEvidenceReturnTarget => {
  const input = strictObject(
    value,
    ['resourceId', 'resourceRevision', 'focusId', 'sourceVersionId', 'evidenceId', 'sourceId'],
    path,
  );
  const sourceId = idString(input.sourceId, `${path}.sourceId`);
  return {
    resourceId: idString(input.resourceId, `${path}.resourceId`),
    resourceRevision: idString(input.resourceRevision, `${path}.resourceRevision`),
    focusId: idString(input.focusId, `${path}.focusId`),
    sourceVersionId: idString(input.sourceVersionId, `${path}.sourceVersionId`),
    evidenceId: idString(input.evidenceId, `${path}.evidenceId`),
    sourceId,
  };
};

const decodeCapabilities = (value: unknown, path: string): readonly KnowledgeReadCapability[] =>
  enumArray(value, path, capabilityValues, 'KnowledgeReadCapability', capabilityValues.length);

export const decodeKnowledgeItemView = (value: unknown, path = 'item'): KnowledgeItemView => {
  const input = strictObject(
    value,
    [
      'productId',
      'projectId',
      'resourceId',
      'revision',
      'authority',
      'kind',
      'temporalState',
      'label',
      'summary',
      'content',
      'lineage',
      'evidenceTargets',
    ],
    path,
  );
  const productId = idString(input.productId, `${path}.productId`);
  const projectId = idString(input.projectId, `${path}.projectId`);
  const resourceId = idString(input.resourceId, `${path}.resourceId`);
  const revision = idString(input.revision, `${path}.revision`);
  const authority = enumValue(
    input.authority,
    `${path}.authority`,
    knowledgeAuthorityValues,
    'KnowledgeAuthority',
  );
  const kind = enumValue(input.kind, `${path}.kind`, knowledgeKindValues, 'KnowledgeKind');
  const temporalState = enumValue(
    input.temporalState,
    `${path}.temporalState`,
    temporalStateValues,
    'KnowledgeTemporalState',
  );
  const label = text(input.label, `${path}.label`, 1, 256);
  const summary = optionalText(input.summary, `${path}.summary`, 0, 4000);
  const content = optionalText(input.content, `${path}.content`, 0, 20000);
  const lineage = decodeKnowledgeLineageView(input.lineage, `${path}.lineage`);
  if (lineage.productId !== productId) fail(`${path}.lineage.productId must match productId.`);
  if (lineage.projectId !== projectId) fail(`${path}.lineage.projectId must match projectId.`);
  if (lineage.resourceRevision !== revision)
    fail(`${path}.lineage.resourceRevision must match revision.`);
  if (authority === 'CANONICAL') {
    if (lineage.canonicalResourceId === undefined) {
      fail(`${path}.CANONICAL item requires canonicalResourceId lineage.`);
    }
  }
  if (
    (authority === 'CANONICAL' || authority === 'APPROVED_KNOWLEDGE') &&
    lineage.projection !== undefined
  ) {
    fail(`${path}.${authority} item must not carry projection lineage.`);
  }
  if (authority === 'COMPILED_TRUTH') {
    if (lineage.projectionId === undefined) {
      fail(`${path}.COMPILED_TRUTH item requires stable projectionId and readiness lineage.`);
    }
    const compiledProjection =
      lineage.projection ??
      fail(`${path}.COMPILED_TRUTH item requires stable projectionId and readiness lineage.`);
    if (compiledProjection.projectionKind !== 'COMPILED_TRUTH') {
      fail(`${path}.COMPILED_TRUTH item requires COMPILED_TRUTH projection kind.`);
    }
  }
  if (authority === 'DERIVED_INFERENCE' && lineage.projectionId === undefined) {
    fail(`${path}.DERIVED_INFERENCE item requires a source projection identifier.`);
  }
  if (authority === 'DERIVED_INFERENCE' && !['KNOWLEDGE_GAP', 'DERIVED_INFERENCE'].includes(kind)) {
    fail(`${path}.DERIVED_INFERENCE item must use a derived knowledge kind.`);
  }
  if (kind === 'DERIVED_INFERENCE' && authority !== 'DERIVED_INFERENCE') {
    fail(`${path}.DERIVED_INFERENCE kind must use DERIVED_INFERENCE authority.`);
  }
  const evidenceTargets =
    input.evidenceTargets === undefined
      ? undefined
      : array(input.evidenceTargets, `${path}.evidenceTargets`, (target, index) =>
          decodeKnowledgeEvidenceReturnTarget(target, `${path}.evidenceTargets[${index}]`),
        );
  if (evidenceTargets !== undefined) {
    for (let index = 0; index < evidenceTargets.length; index++) {
      const target = evidenceTargets[index];
      if (!target) continue;
      if (target.resourceId !== resourceId || target.resourceRevision !== revision) {
        fail(`${path}.evidenceTargets[${index}] must match the item resource and revision.`);
      }
    }
  }
  return {
    productId,
    projectId,
    resourceId,
    revision,
    authority,
    kind,
    temporalState,
    label,
    ...(summary === undefined ? {} : { summary }),
    ...(content === undefined ? {} : { content }),
    lineage,
    ...(evidenceTargets === undefined ? {} : { evidenceTargets }),
  };
};

export const decodeKnowledgePageSummaryView = (
  value: unknown,
  path = 'pageSummary',
): KnowledgePageSummaryView => {
  const input = strictObject(
    value,
    [
      'pageId',
      'projectId',
      'resourceId',
      'revision',
      'title',
      'primaryAuthority',
      'primaryKind',
      'projection',
    ],
    path,
  );
  return {
    pageId: idString(input.pageId, `${path}.pageId`),
    projectId: idString(input.projectId, `${path}.projectId`),
    resourceId: idString(input.resourceId, `${path}.resourceId`),
    revision: idString(input.revision, `${path}.revision`),
    title: text(input.title, `${path}.title`, 1, 256),
    primaryAuthority: enumValue(
      input.primaryAuthority,
      `${path}.primaryAuthority`,
      knowledgeAuthorityValues,
      'KnowledgeAuthority',
    ),
    primaryKind: enumValue(
      input.primaryKind,
      `${path}.primaryKind`,
      knowledgeKindValues,
      'KnowledgeKind',
    ),
    projection: decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`),
  };
};

export const decodeKnowledgePageView = (value: unknown, path = 'page'): KnowledgePageView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'pageId',
      'projectId',
      'resourceId',
      'revision',
      'focusId',
      'title',
      'items',
      'lineage',
      'projection',
      'capabilities',
      'fetchedAt',
    ],
    path,
  );
  schema(input, path);
  const pageId = idString(input.pageId, `${path}.pageId`);
  const projectId = idString(input.projectId, `${path}.projectId`);
  const resourceId = idString(input.resourceId, `${path}.resourceId`);
  const revision = idString(input.revision, `${path}.revision`);
  const focusId = optionalId(input.focusId, `${path}.focusId`);
  const lineage = decodeKnowledgeLineageView(input.lineage, `${path}.lineage`);
  if (lineage.productId !== pageId) fail(`${path}.lineage.productId must match pageId.`);
  if (lineage.projectId !== projectId) fail(`${path}.lineage.projectId must match projectId.`);
  if (lineage.resourceRevision !== revision)
    fail(`${path}.lineage.resourceRevision must match revision.`);
  const items = array(input.items, `${path}.items`, (item, index) => {
    const decoded = decodeKnowledgeItemView(item, `${path}.items[${index}]`);
    if (
      decoded.projectId !== projectId ||
      decoded.resourceId !== resourceId ||
      decoded.revision !== revision
    ) {
      fail(`${path}.items[${index}] must match the page project, resource, and revision.`);
    }
    return decoded;
  });
  const projection = decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`);
  const capabilities = decodeCapabilities(input.capabilities, `${path}.capabilities`);
  const fetchedAt = timestamp(input.fetchedAt, `${path}.fetchedAt`);
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    pageId,
    projectId,
    resourceId,
    revision,
    ...(focusId === undefined ? {} : { focusId }),
    title: text(input.title, `${path}.title`, 1, 256),
    items,
    lineage,
    projection,
    capabilities,
    fetchedAt,
  };
};

export const decodeKnowledgeWorkspaceView = (
  value: unknown,
  path = 'workspace',
): KnowledgeWorkspaceView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'principalId',
      'sessionId',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'pages',
      'projection',
      'capabilities',
      'fetchedAt',
    ],
    path,
  );
  schema(input, path);
  const projectId = idString(input.projectId, `${path}.projectId`);
  const accessRevision = idString(input.accessRevision, `${path}.accessRevision`);
  const policyContextRevision = idString(
    input.policyContextRevision,
    `${path}.policyContextRevision`,
  );
  const pages = array(input.pages, `${path}.pages`, (page, index) => {
    const decoded = decodeKnowledgePageSummaryView(page, `${path}.pages[${index}]`);
    if (decoded.projectId !== projectId) {
      fail(`${path}.pages[${index}].projectId must match workspace.projectId.`);
    }
    return decoded;
  });
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    principalId: idString(input.principalId, `${path}.principalId`),
    sessionId: idString(input.sessionId, `${path}.sessionId`),
    projectId,
    accessRevision,
    policyContextRevision,
    pages,
    projection: decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`),
    capabilities: decodeCapabilities(input.capabilities, `${path}.capabilities`),
    fetchedAt: timestamp(input.fetchedAt, `${path}.fetchedAt`),
  };
};

export const decodeKnowledgePageListView = (
  value: unknown,
  path = 'pageList',
): KnowledgePageListView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'pages',
      'nextCursor',
      'projection',
      'fetchedAt',
    ],
    path,
  );
  schema(input, path);
  const projectId = idString(input.projectId, `${path}.projectId`);
  const accessRevision = idString(input.accessRevision, `${path}.accessRevision`);
  const policyContextRevision = idString(
    input.policyContextRevision,
    `${path}.policyContextRevision`,
  );
  const pages = array(input.pages, `${path}.pages`, (page, index) => {
    const decoded = decodeKnowledgePageSummaryView(page, `${path}.pages[${index}]`);
    if (decoded.projectId !== projectId) {
      fail(`${path}.pages[${index}].projectId must match pageList.projectId.`);
    }
    return decoded;
  });
  const nextCursor = optionalText(input.nextCursor, `${path}.nextCursor`, 1, 2048);
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    projectId,
    accessRevision,
    policyContextRevision,
    pages,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    projection: decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`),
    fetchedAt: timestamp(input.fetchedAt, `${path}.fetchedAt`),
  };
};

export const decodeKnowledgeSearchMatchView = (
  value: unknown,
  path = 'match',
): KnowledgeSearchMatchView => {
  const input = strictObject(
    value,
    [
      'matchId',
      'projectId',
      'resourceId',
      'item',
      'score',
      'matchAuthority',
      'matchType',
      'snippet',
    ],
    path,
  );
  const projectId = idString(input.projectId, `${path}.projectId`);
  const resourceId = idString(input.resourceId, `${path}.resourceId`);
  const item = decodeKnowledgeItemView(input.item, `${path}.item`);
  if (item.projectId !== projectId || item.resourceId !== resourceId) {
    fail(`${path}.item must match the search match project and resource.`);
  }
  const matchAuthority = enumValue(
    input.matchAuthority,
    `${path}.matchAuthority`,
    ['CANONICAL', 'PROJECTION'],
    'KnowledgeSearchMatchAuthority',
  );
  if (
    (matchAuthority === 'CANONICAL' &&
      !['CANONICAL', 'APPROVED_KNOWLEDGE'].includes(item.authority)) ||
    (matchAuthority === 'PROJECTION' &&
      !['COMPILED_TRUTH', 'DERIVED_INFERENCE'].includes(item.authority))
  ) {
    fail(`${path}.matchAuthority must agree with item.authority.`);
  }
  const snippet = optionalText(input.snippet, `${path}.snippet`, 0, 4000);
  return {
    matchId: idString(input.matchId, `${path}.matchId`),
    projectId,
    resourceId,
    item,
    score: finiteScore(input.score, `${path}.score`),
    matchAuthority,
    matchType: enumValue(
      input.matchType,
      `${path}.matchType`,
      ['FULL_TEXT', 'TRIGRAM', 'SUBSTRING'],
      'KnowledgeSearchMatchType',
    ),
    ...(snippet === undefined ? {} : { snippet }),
  };
};

export const decodeKnowledgeSearchResultView = (
  value: unknown,
  path = 'searchResult',
): KnowledgeSearchResultView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'query',
      'matches',
      'nextCursor',
      'projection',
      'fetchedAt',
    ],
    path,
  );
  schema(input, path);
  const projectId = idString(input.projectId, `${path}.projectId`);
  const accessRevision = idString(input.accessRevision, `${path}.accessRevision`);
  const policyContextRevision = idString(
    input.policyContextRevision,
    `${path}.policyContextRevision`,
  );
  const matches = array(input.matches, `${path}.matches`, (match, index) => {
    const decoded = decodeKnowledgeSearchMatchView(match, `${path}.matches[${index}]`);
    if (decoded.projectId !== projectId) {
      fail(`${path}.matches[${index}].projectId must match searchResult.projectId.`);
    }
    return decoded;
  });
  const nextCursor = optionalText(input.nextCursor, `${path}.nextCursor`, 1, 2048);
  const projection = decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`);
  if (projection.projectionKind !== 'CANONICAL_SEARCH') {
    fail(`${path}.projection must describe CANONICAL_SEARCH readiness.`);
  }
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    projectId,
    accessRevision,
    policyContextRevision,
    query: text(input.query, `${path}.query`, 1, 1000),
    matches,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    projection,
    fetchedAt: timestamp(input.fetchedAt, `${path}.fetchedAt`),
  };
};

export const decodeKnowledgeDetailView = (value: unknown, path = 'detail'): KnowledgeDetailView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'resourceId',
      'revision',
      'accessRevision',
      'policyContextRevision',
      'focusId',
      'page',
      'fetchedAt',
    ],
    path,
  );
  schema(input, path);
  const resourceId = idString(input.resourceId, `${path}.resourceId`);
  const revision = idString(input.revision, `${path}.revision`);
  const accessRevision = idString(input.accessRevision, `${path}.accessRevision`);
  const policyContextRevision = idString(
    input.policyContextRevision,
    `${path}.policyContextRevision`,
  );
  const focusId = optionalId(input.focusId, `${path}.focusId`);
  const page = decodeKnowledgePageView(input.page, `${path}.page`);
  if (page.resourceId !== resourceId || page.revision !== revision) {
    fail(`${path}.page must match detail resourceId and revision.`);
  }
  if (focusId !== undefined && page.focusId !== focusId) {
    fail(`${path}.page.focusId must match detail.focusId.`);
  }
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    resourceId,
    revision,
    accessRevision,
    policyContextRevision,
    ...(focusId === undefined ? {} : { focusId }),
    page,
    fetchedAt: timestamp(input.fetchedAt, `${path}.fetchedAt`),
  };
};

export const decodeKnowledgeCompareDifferenceView = (
  value: unknown,
  path = 'difference',
): KnowledgeCompareDifferenceView => {
  const input = strictObject(
    value,
    ['differenceId', 'path', 'kind', 'leftValue', 'rightValue'],
    path,
  );
  const kind = enumValue(
    input.kind,
    `${path}.kind`,
    ['ADDED', 'REMOVED', 'CHANGED'],
    'KnowledgeDifferenceKind',
  );
  const leftValue = optionalText(input.leftValue, `${path}.leftValue`, 0, 20000);
  const rightValue = optionalText(input.rightValue, `${path}.rightValue`, 0, 20000);
  if (kind === 'ADDED' && (leftValue !== undefined || rightValue === undefined)) {
    fail(`${path}.ADDED must contain only a rightValue.`);
  }
  if (kind === 'REMOVED' && (leftValue === undefined || rightValue !== undefined)) {
    fail(`${path}.REMOVED must contain only a leftValue.`);
  }
  if (kind === 'CHANGED' && (leftValue === undefined || rightValue === undefined)) {
    fail(`${path}.CHANGED must contain both values.`);
  }
  if (kind === 'CHANGED' && leftValue === rightValue) {
    fail(`${path}.CHANGED values must differ.`);
  }
  return {
    differenceId: idString(input.differenceId, `${path}.differenceId`),
    path: text(input.path, `${path}.path`, 1, 1024),
    kind,
    ...(leftValue === undefined ? {} : { leftValue }),
    ...(rightValue === undefined ? {} : { rightValue }),
  };
};

export const decodeKnowledgeCompareView = (
  value: unknown,
  path = 'compare',
): KnowledgeCompareView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'left',
      'right',
      'differences',
      'projection',
      'capabilities',
      'fetchedAt',
    ],
    path,
  );
  schema(input, path);
  const projectId = idString(input.projectId, `${path}.projectId`);
  const accessRevision = idString(input.accessRevision, `${path}.accessRevision`);
  const policyContextRevision = idString(
    input.policyContextRevision,
    `${path}.policyContextRevision`,
  );
  const left = decodeKnowledgePageView(input.left, `${path}.left`);
  const right = decodeKnowledgePageView(input.right, `${path}.right`);
  if (left.projectId !== projectId || right.projectId !== projectId) {
    fail(`${path}.left and ${path}.right must match compare.projectId.`);
  }
  if (left.pageId === right.pageId) {
    fail(`${path}.left and ${path}.right must be distinct pages.`);
  }
  return {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    projectId,
    accessRevision,
    policyContextRevision,
    left,
    right,
    differences: array(input.differences, `${path}.differences`, (difference, index) =>
      decodeKnowledgeCompareDifferenceView(difference, `${path}.differences[${index}]`),
    ),
    projection: decodeKnowledgeProjectionStatusView(input.projection, `${path}.projection`),
    capabilities: decodeCapabilities(input.capabilities, `${path}.capabilities`),
    fetchedAt: timestamp(input.fetchedAt, `${path}.fetchedAt`),
  };
};
