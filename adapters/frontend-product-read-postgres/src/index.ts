import { normalizeSearchText } from '../../../modules/projection-search/src/index.js';
import {
  compareKnowledgePages,
  knowledgeMatchId,
  knowledgePageId,
  knowledgeProductId,
} from '../../../modules/frontend-product-read/src/knowledge-contract.js';
import type {
  AuthorizedProjectSummary,
  FrontendReadScope,
  GlobalSearchPort,
  KnowledgeWorkspaceProjectionPort,
} from '../../../modules/frontend-product-read/src/index.js';
import type { FrontendSourcesReadCoordinator } from '../../../modules/frontend-sources-product/src/index.js';
import {
  createQuery,
  FrontendContractError,
  decodeGetCompiledTruthReadSnapshotResult,
  decodeGlobalSearchResultView,
  decodeKnowledgeCompareView,
  decodeKnowledgeDetailView,
  decodeKnowledgePageListView,
  decodeKnowledgeSearchResultViewVNext,
  decodeKnowledgeWorkspaceView,
  decodeSearchKnowledgeWorkspaceResult,
  stableJson,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalSnapshot,
  type CompiledTruthProjectionStatus,
  type DerivedInferenceCandidate,
  type EvidenceSpan,
  type GetCompiledTruthReadSnapshotResult,
  type GlobalSearchResultView,
  type KnowledgeCandidate,
  type KnowledgeCompareRequest,
  type KnowledgeCompareView,
  type KnowledgeDetailRequest,
  type KnowledgeDetailView,
  type KnowledgeItemView,
  type KnowledgeKind,
  type KnowledgePageListRequest,
  type KnowledgePageListView,
  type KnowledgePageSummaryView,
  type KnowledgePageView,
  type KnowledgeProjectionStatusView,
  type KnowledgeReadCapability,
  type KnowledgeSearchMatchView,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResultViewVNext,
  type KnowledgeWorkspaceQueryProjectionStatus,
  type KnowledgeWorkspaceRequest,
  type KnowledgeWorkspaceView,
  type KnowledgeReviewGroup,
  type ProjectionReadiness,
  type QueryEnvelope,
  type SearchKnowledgeWorkspaceMatch,
  type TransformationRevision,
} from '../../../packages/kernel/src/index.js';

export class PostgresSourceLibraryGlobalSearch implements GlobalSearchPort {
  constructor(private readonly sources: Pick<FrontendSourcesReadCoordinator, 'list'>) {}

  async search(input: Parameters<GlobalSearchPort['search']>[0]): Promise<GlobalSearchResultView> {
    const requestedProjectIds =
      input.request.scope.kind === 'ACTIVE_PROJECT'
        ? [input.activeProject.id]
        : input.request.scope.projectIds;
    const authorizedProjects = requestedProjectIds.flatMap((projectId) => {
      const project = input.accessibleProjects.find((candidate) => candidate.id === projectId);
      return project ? [project] : [];
    });
    const normalizedQuery = normalizeSearchText(input.request.query);
    const pages = await Promise.all(
      authorizedProjects.map(async (project) => {
        const authority = input.executionAuthorities?.[project.id];
        const page = await this.sources.list(
          {
            principalId: input.principalId,
            sessionId: input.sessionId,
            authorizedProjectId: project.id,
            accessScopes:
              authority?.accessScope ??
              (project.id === input.activeProject.id ? (input.accessScope ?? []) : []),
            sensitivityClearance: authority?.sensitivityClearance ?? project.sensitivityClearance,
            accessRevision: authority?.accessRevision ?? input.accessRevision,
            policyContextRevision: authority?.policyContextRevision ?? input.policyContextRevision,
          },
          {
            schemaVersion: '1.0.0',
            query: normalizedQuery,
            filters: {},
            sort: 'LABEL_ASC',
            limit: input.request.limit,
          },
        );
        return { page, project };
      }),
    );
    const results = pages
      .flatMap(({ page, project }) =>
        page.items.map((source) => ({
          stableId: `source:${source.sourceId}`,
          kind: 'SOURCE',
          label: source.label,
          projectId: project.id,
          projectLabel: project.label,
          targetRoute: { routeId: 'sources' as const, href: '/sources' as const },
        })),
      )
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          left.projectLabel.localeCompare(right.projectLabel) ||
          left.stableId.localeCompare(right.stableId),
      )
      .slice(0, input.request.limit);

    return decodeGlobalSearchResultView({
      schemaVersion: '1.0.0',
      scope: input.request.scope.kind,
      results,
      projectionRevision: `search-${pages.map(({ page }) => page.projectionRevision).join(':') || input.accessRevision}`,
      fetchedAt: new Date().toISOString(),
    });
  }
}

type ActiveKnowledgeScope = FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
  readonly accessScope: readonly string[];
};

export type KnowledgeWorkspaceQueryContext = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: ActiveKnowledgeScope['activeProject']['sensitivityClearance'];
};

export type KnowledgeWorkspaceQueryExecutor = {
  query<TResult>(input: {
    readonly envelope: QueryEnvelope;
    readonly context: KnowledgeWorkspaceQueryContext;
  }): Promise<TResult>;
};

export type KnowledgeWorkspaceQueryExecutorFactory = (query: QueryEnvelope) => Promise<unknown>;

type KnowledgePortInput<Request> = (FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
}) & { readonly request: Request };

type KnowledgeGroupListResult = { readonly items: readonly KnowledgeReviewGroup[] };
type DerivedInferenceListResult = { readonly items: readonly DerivedInferenceCandidate[] };
type CanonicalHistoryListResult = { readonly items: readonly CanonicalHistoryEvent[] };

type PageCursorPayload = {
  readonly version: 1;
  readonly projectId: string;
  readonly resourceId?: string;
  readonly requestedRevision?: string;
  readonly focusId?: string;
  readonly offset: number;
};

type DomainState = {
  readonly canonicalProjection: KnowledgeProjectionStatusView;
  readonly compiledProjection: KnowledgeProjectionStatusView;
  readonly pages: readonly KnowledgePageView[];
};

const PRODUCT_CAPABILITIES: readonly KnowledgeReadCapability[] = [
  'READ',
  'SEARCH',
  'FILTER',
  'COMPARE',
  'EVIDENCE_NAVIGATION',
];

const fail = (
  code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'POLICY_DENIED' | 'UNSUPPORTED_SCHEMA',
  message: string,
): never => {
  throw new FrontendContractError(code, message);
};

const id = (value: string, field: string): string => {
  if (value.trim().length === 0) return fail('UNSUPPORTED_SCHEMA', `${field} must not be empty.`);
  return value;
};

const shortLabel = (value: string): string =>
  value.length <= 256 ? value : `${value.slice(0, 253)}...`;

const productFocusId = (pointer: string): string => (pointer.length === 0 ? '/' : pointer);

const objectKey = (projectId: string, resourceId: string, revision: string): string =>
  stableJson({ projectId, resourceId, revision });

const mapProjectionStatus = (
  projectionKind: KnowledgeProjectionStatusView['projectionKind'],
  input:
    ProjectionReadiness | KnowledgeWorkspaceQueryProjectionStatus | CompiledTruthProjectionStatus,
): KnowledgeProjectionStatusView => {
  const status = input.status;
  const canonicalVersion = input.canonicalVersion;
  const projectedCanonicalVersion = input.projectedCanonicalVersion;
  const lag = input.lag;
  const reason =
    'reason' in input ? input.reason : 'lastError' in input ? input.lastError : undefined;
  const safeReason =
    reason ??
    (status === 'NOT_BUILT'
      ? `${projectionKind} is not built.`
      : status === 'STALE'
        ? `${projectionKind} is behind Canonical Knowledge.`
        : undefined);
  const canonicalSnapshotDigest =
    'canonicalSnapshotDigest' in input ? input.canonicalSnapshotDigest : undefined;
  const projectedSnapshotDigest =
    'projectedSnapshotDigest' in input ? input.projectedSnapshotDigest : undefined;
  const sourceSnapshotDigest =
    'sourceSnapshotDigest' in input ? input.sourceSnapshotDigest : undefined;
  const projectionLogicalDigest =
    'projectionLogicalDigest' in input
      ? input.projectionLogicalDigest
      : 'logicalDigest' in input
        ? input.logicalDigest
        : undefined;
  const updatedAt = input.updatedAt;
  if (status === 'READY' && safeReason !== undefined) {
    return fail('UNSUPPORTED_SCHEMA', `${projectionKind} READY status carries a reason.`);
  }
  if (status !== 'READY' && safeReason === undefined) {
    return fail('UNSUPPORTED_SCHEMA', `${projectionKind} non-ready status lacks a reason.`);
  }
  return {
    projectionKind,
    status,
    canonicalVersion,
    projectedCanonicalVersion,
    lag,
    ...(canonicalSnapshotDigest === undefined ? {} : { canonicalSnapshotDigest }),
    ...(projectedSnapshotDigest === undefined ? {} : { projectedSnapshotDigest }),
    ...(sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest }),
    ...(projectionLogicalDigest === undefined ? {} : { projectionLogicalDigest }),
    ...(safeReason === undefined ? {} : { reason: safeReason }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
};

const mapSearchProjectionStatus = (
  status: KnowledgeWorkspaceQueryProjectionStatus,
): KnowledgeProjectionStatusView =>
  mapProjectionStatus(
    status.source === 'CANONICAL_SEARCH' ? 'CANONICAL_SEARCH' : 'COMPILED_TRUTH',
    status,
  );

const mapCompiledStatus = (status: CompiledTruthProjectionStatus): KnowledgeProjectionStatusView =>
  mapProjectionStatus('COMPILED_TRUTH', status);

const candidateKind = (candidate: KnowledgeCandidate): KnowledgeKind => candidate.candidateType;

const candidateLabel = (candidate: KnowledgeCandidate): string => {
  switch (candidate.candidateType) {
    case 'ENTITY':
      return candidate.name;
    case 'RELATION':
      return candidate.relationType;
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

const candidateContent = (candidate: KnowledgeCandidate): string | undefined => {
  switch (candidate.candidateType) {
    case 'DECISION':
      return candidate.decisionText;
    case 'ACTION':
      return candidate.actionText;
    case 'CONFLICT':
      return candidate.summary;
    case 'KNOWLEDGE_GAP':
      return candidate.question;
    default:
      return undefined;
  }
};

const focusMatches = (page: KnowledgePageView, focusId: string): boolean =>
  page.items.some((item) => item.evidenceTargets?.some((target) => target.focusId === focusId));

export class PostgresKnowledgeWorkspaceProjection implements KnowledgeWorkspaceProjectionPort {
  constructor(
    private readonly executor: KnowledgeWorkspaceQueryExecutor,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async getWorkspace(
    input: KnowledgePortInput<KnowledgeWorkspaceRequest>,
  ): Promise<KnowledgeWorkspaceView> {
    const scope = this.assertScope(input, 'get-knowledge-workspace');
    const request = this.decodeWorkspaceRequest(input.request);
    const state = await this.loadDomainState(scope);
    const pages = this.selectPages(state.pages, request, 'get-knowledge-workspace');
    return decodeKnowledgeWorkspaceView({
      schemaVersion: '1.0.0',
      principalId: scope.principalId,
      sessionId: scope.sessionId,
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      pages: pages.map(this.pageSummary),
      projection: state.canonicalProjection,
      capabilities: PRODUCT_CAPABILITIES,
      fetchedAt: this.clock(),
    });
  }

  async listPages(
    input: KnowledgePortInput<KnowledgePageListRequest>,
  ): Promise<KnowledgePageListView> {
    const scope = this.assertScope(input, 'list-knowledge-pages');
    const request = this.decodeWorkspaceRequest(input.request);
    const state = await this.loadDomainState(scope);
    const selected = this.selectPages(state.pages, request, 'list-knowledge-pages');
    const start = this.decodePageCursor(request.cursor, scope, request);
    const pageSize = request.pageSize ?? selected.length;
    const items = selected.slice(start, start + pageSize);
    const nextOffset = start + items.length;
    const nextCursor =
      nextOffset < selected.length ? this.encodePageCursor(scope, request, nextOffset) : undefined;
    return decodeKnowledgePageListView({
      schemaVersion: '1.0.0',
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      pages: items.map(this.pageSummary),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      projection: state.canonicalProjection,
      fetchedAt: this.clock(),
    });
  }

  async search(
    input: KnowledgePortInput<KnowledgeSearchRequest>,
  ): Promise<KnowledgeSearchResultViewVNext> {
    const scope = this.assertScope(input, 'search-knowledge');
    const request = this.decodeSearchRequest(input.request);
    const queryResult = decodeSearchKnowledgeWorkspaceResult(
      await this.query<SearchKnowledgeWorkspaceResultPayload>(scope, 'SearchKnowledgeWorkspace', {
        schemaVersion: '1.0.0',
        query: request.query,
        ...(request.resourceId === undefined ? {} : { resourceId: request.resourceId }),
        ...(request.filters === undefined ? {} : { filters: request.filters }),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.pageSize === undefined ? {} : { pageSize: request.pageSize }),
      }),
    );
    if (queryResult.projectId !== scope.activeProject.id || queryResult.query !== request.query) {
      return fail(
        'UNSUPPORTED_SCHEMA',
        'Search Query result does not preserve Product scope/query.',
      );
    }
    const canonicalSearch = mapSearchProjectionStatus(queryResult.readiness.canonicalSearch);
    const sourceProjections =
      queryResult.readiness.sourceProjections.map(mapSearchProjectionStatus);
    const compiledSearch = sourceProjections.find(
      (status) => status.projectionKind === 'COMPILED_TRUTH',
    );
    const normalizedQuery = normalizeSearchText(queryResult.query);
    const mappedMatches = await Promise.all(
      queryResult.matches
        .filter((match) =>
          request.requestedRevision === undefined
            ? true
            : match.source.resourceRevision === request.requestedRevision,
        )
        .map((match) =>
          this.mapSearchMatch(match, scope, normalizedQuery, canonicalSearch, compiledSearch),
        ),
    );
    const matches = mappedMatches.filter(
      (match) =>
        request.focusId === undefined ||
        match.item.evidenceTargets?.some((target) => target.focusId === request.focusId),
    );
    return decodeKnowledgeSearchResultViewVNext({
      schemaVersion: '1.1.0',
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      query: request.query,
      matches,
      ...(queryResult.nextCursor === undefined ? {} : { nextCursor: queryResult.nextCursor }),
      projection: canonicalSearch,
      readiness: {
        canonicalSearch,
        sourceProjections,
        partial: queryResult.readiness.partial,
      },
      fetchedAt: this.clock(),
    });
  }

  async getDetail(input: KnowledgePortInput<KnowledgeDetailRequest>): Promise<KnowledgeDetailView> {
    const scope = this.assertScope(input, 'get-knowledge-detail');
    const request = this.decodeDetailRequest(input.request);
    const state = await this.loadDomainState(scope);
    const page = state.pages.find(
      (candidate) =>
        candidate.resourceId === request.resourceId &&
        (request.requestedRevision === undefined ||
          candidate.revision === request.requestedRevision) &&
        (request.focusId === undefined || focusMatches(candidate, request.focusId)),
    );
    if (!page) return fail('NOT_FOUND', 'The requested Knowledge resource was not found.');
    const focusedPage =
      request.focusId === undefined ? page : { ...page, focusId: request.focusId };
    return decodeKnowledgeDetailView({
      schemaVersion: '1.0.0',
      resourceId: request.resourceId,
      revision: focusedPage.revision,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      ...(request.focusId === undefined ? {} : { focusId: request.focusId }),
      page: focusedPage,
      fetchedAt: this.clock(),
    });
  }

  async compare(input: KnowledgePortInput<KnowledgeCompareRequest>): Promise<KnowledgeCompareView> {
    const scope = this.assertScope(input, 'compare-knowledge-pages');
    const request = this.decodeCompareRequest(input.request);
    const state = await this.loadDomainState(scope);
    const pages = new Map(state.pages.map((page) => [page.pageId, page]));
    const left = pages.get(request.pageIds[0]);
    const right = pages.get(request.pageIds[1]);
    if (
      !left ||
      !right ||
      (request.requestedRevision !== undefined &&
        (left.revision !== request.requestedRevision ||
          right.revision !== request.requestedRevision)) ||
      (request.focusId !== undefined &&
        (!focusMatches(left, request.focusId) || !focusMatches(right, request.focusId)))
    ) {
      return fail('NOT_FOUND', 'The requested Knowledge pages were not found.');
    }
    const differences = compareKnowledgePages(left, right);
    return decodeKnowledgeCompareView({
      schemaVersion: '1.0.0',
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      left,
      right,
      differences,
      projection: left.projection,
      capabilities: [...new Set(['READ', 'COMPARE'] as const)],
      fetchedAt: this.clock(),
    });
  }

  private assertScope(
    input: FrontendReadScope & { readonly activeProject: AuthorizedProjectSummary },
    operation: string,
  ): ActiveKnowledgeScope {
    if (!input.accessScope || input.accessScope.length === 0) {
      return fail('POLICY_DENIED', `${operation} requires server-resolved access scope.`);
    }
    if (
      !input.accessibleProjects.some((project) => project.id === input.activeProject.id) ||
      !input.accessScope.includes('owner')
    ) {
      return fail('NOT_FOUND', 'The requested Knowledge workspace was not found.');
    }
    return input as ActiveKnowledgeScope;
  }

  private async query<TResult>(
    scope: ActiveKnowledgeScope,
    messageType: string,
    payload: unknown,
  ): Promise<TResult> {
    const context: KnowledgeWorkspaceQueryContext = {
      principalId: scope.principalId,
      sessionId: scope.sessionId,
      projectId: scope.activeProject.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      accessScope: [...scope.accessScope],
      sensitivity: scope.activeProject.sensitivityClearance,
    };
    const envelope = createQuery({
      messageType,
      schemaVersion: '1.0.0',
      producerModule: 'frontend-product-read-postgres',
      producerVersion: '1.0.0',
      projectId: context.projectId,
      actor: { type: 'user', id: context.principalId },
      security: {
        accessScope: context.accessScope,
        sensitivity: context.sensitivity,
        dataClassification: 'knowledge-workspace-product-read',
      },
      payload,
    });
    return this.executor.query<TResult>({ envelope, context });
  }

  private decodeWorkspaceRequest(input: KnowledgeWorkspaceRequest): KnowledgeWorkspaceRequest {
    if (input.schemaVersion !== '1.0.0')
      return fail('UNSUPPORTED_SCHEMA', 'Unsupported Knowledge workspace request.');
    if (
      input.pageSize !== undefined &&
      (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100)
    ) {
      return fail('INVALID_REQUEST', 'Knowledge pageSize is out of bounds.');
    }
    return input;
  }

  private decodeSearchRequest(input: KnowledgeSearchRequest): KnowledgeSearchRequest {
    if (input.schemaVersion !== '1.0.0' || input.query.trim().length === 0) {
      return fail('INVALID_REQUEST', 'Knowledge search request is invalid.');
    }
    this.decodeWorkspaceRequest(input);
    return input;
  }

  private decodeDetailRequest(input: KnowledgeDetailRequest): KnowledgeDetailRequest {
    if (input.schemaVersion !== '1.0.0' || input.resourceId.trim().length === 0) {
      return fail('INVALID_REQUEST', 'Knowledge detail request is invalid.');
    }
    return input;
  }

  private decodeCompareRequest(input: KnowledgeCompareRequest): KnowledgeCompareRequest {
    if (
      input.schemaVersion !== '1.0.0' ||
      input.pageIds.length !== 2 ||
      input.pageIds[0] === input.pageIds[1]
    ) {
      return fail('INVALID_REQUEST', 'Knowledge compare request is invalid.');
    }
    return input;
  }

  private selectPages(
    pages: readonly KnowledgePageView[],
    request: KnowledgeWorkspaceRequest,
    operation: string,
  ): readonly KnowledgePageView[] {
    const selected = pages.filter(
      (page) =>
        (request.resourceId === undefined || page.resourceId === request.resourceId) &&
        (request.requestedRevision === undefined || page.revision === request.requestedRevision) &&
        (request.focusId === undefined || focusMatches(page, request.focusId)),
    );
    if (
      selected.length === 0 &&
      (request.resourceId !== undefined ||
        request.requestedRevision !== undefined ||
        request.focusId !== undefined)
    ) {
      return fail('NOT_FOUND', `${operation} did not find an authorized Knowledge page.`);
    }
    return selected;
  }

  private encodePageCursor(
    scope: ActiveKnowledgeScope,
    request: KnowledgeWorkspaceRequest,
    offset: number,
  ): string {
    const payload: PageCursorPayload = {
      version: 1,
      projectId: scope.activeProject.id,
      ...(request.resourceId === undefined ? {} : { resourceId: request.resourceId }),
      ...(request.requestedRevision === undefined
        ? {}
        : { requestedRevision: request.requestedRevision }),
      ...(request.focusId === undefined ? {} : { focusId: request.focusId }),
      offset,
    };
    return `knowledge-page-cursor:v1:${Buffer.from(stableJson(payload)).toString('base64url')}`;
  }

  private decodePageCursor(
    cursor: string | undefined,
    scope: ActiveKnowledgeScope,
    request: KnowledgeWorkspaceRequest,
  ): number {
    if (cursor === undefined) return 0;
    const prefix = 'knowledge-page-cursor:v1:';
    if (!cursor.startsWith(prefix))
      return fail('INVALID_REQUEST', 'Knowledge page cursor is invalid.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(cursor.slice(prefix.length), 'base64url').toString('utf8'));
    } catch {
      return fail('INVALID_REQUEST', 'Knowledge page cursor is invalid.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('INVALID_REQUEST', 'Knowledge page cursor is invalid.');
    }
    const value = parsed as Record<string, unknown>;
    const expected = stableJson({
      version: 1,
      projectId: scope.activeProject.id,
      ...(request.resourceId === undefined ? {} : { resourceId: request.resourceId }),
      ...(request.requestedRevision === undefined
        ? {}
        : { requestedRevision: request.requestedRevision }),
      ...(request.focusId === undefined ? {} : { focusId: request.focusId }),
    });
    const actual = stableJson({
      version: value.version,
      projectId: value.projectId,
      ...(value.resourceId === undefined ? {} : { resourceId: value.resourceId }),
      ...(value.requestedRevision === undefined
        ? {}
        : { requestedRevision: value.requestedRevision }),
      ...(value.focusId === undefined ? {} : { focusId: value.focusId }),
    });
    if (
      actual !== expected ||
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) < 0
    ) {
      return fail('INVALID_REQUEST', 'Knowledge page cursor is not bound to this request.');
    }
    return value.offset as number;
  }

  private pageSummary(page: KnowledgePageView): KnowledgePageSummaryView {
    return {
      pageId: page.pageId,
      projectId: page.projectId,
      resourceId: page.resourceId,
      revision: page.revision,
      title: page.title,
      primaryAuthority: page.items[0]?.authority ?? 'CANONICAL',
      primaryKind: page.items[0]?.kind ?? 'CLAIM',
      projection: page.projection,
    };
  }

  private async mapSearchMatch(
    match: SearchKnowledgeWorkspaceMatch,
    scope: ActiveKnowledgeScope,
    normalizedQuery: string,
    canonicalStatus: KnowledgeProjectionStatusView,
    compiledStatus: KnowledgeProjectionStatusView | undefined,
  ): Promise<KnowledgeSearchMatchView> {
    const source = match.source;
    if (source.projectId !== scope.activeProject.id || match.projectId !== scope.activeProject.id) {
      return fail('UNSUPPORTED_SCHEMA', 'Search Query result crossed the active Project boundary.');
    }
    const evidenceTargets = await this.searchEvidenceTargets(scope, source.evidenceIds, source);
    const sourceVersionId = evidenceTargets[0]?.sourceVersionId;
    const projection =
      match.authority === 'CANONICAL'
        ? canonicalStatus
        : match.authority === 'COMPILED_TRUTH'
          ? match.projectionStatus === undefined
            ? fail('UNSUPPORTED_SCHEMA', 'Compiled Truth search match lacks projection status.')
            : mapSearchProjectionStatus(match.projectionStatus)
          : match.authority === 'DERIVED_INFERENCE'
            ? compiledStatus
            : undefined;
    const lineageBase = {
      projectId: scope.activeProject.id,
      resourceRevision: id(source.resourceRevision, 'resourceRevision'),
    };
    let productInput: Parameters<typeof knowledgeProductId>[0];
    let lineage: KnowledgeItemView['lineage'];
    switch (source.authority) {
      case 'CANONICAL':
        productInput = {
          authority: source.authority,
          projectId: source.projectId,
          resourceId: source.resourceId,
          resourceRevision: source.resourceRevision,
          canonicalResourceId: source.canonicalResourceId,
          canonicalRevisionId: source.canonicalRevisionId,
          sourceId: source.sourceId,
          sourceVersionId: source.sourceVersionId,
        };
        lineage = {
          ...lineageBase,
          productId: '',
          canonicalResourceId: source.canonicalResourceId,
          canonicalRevisionId: source.canonicalRevisionId,
          canonicalVersion: canonicalStatus.canonicalVersion,
          sourceId: source.sourceId,
          sourceVersionId: source.sourceVersionId,
          evidenceIds: source.evidenceIds,
          commitId: source.commitId,
          ...(source.manifestId === undefined ? {} : { manifestId: source.manifestId }),
          ...(source.changeSetId === undefined ? {} : { changeSetId: source.changeSetId }),
          ...(projection === undefined ? {} : { projection }),
        };
        break;
      case 'APPROVED_KNOWLEDGE':
        productInput = {
          authority: source.authority,
          projectId: source.projectId,
          resourceId: source.resourceId,
          resourceRevision: source.resourceRevision,
          knowledgeGroupId: source.knowledgeGroupId,
          candidateId: source.candidateId,
          sourceVersionId: source.sourceVersionId,
        };
        lineage = {
          ...lineageBase,
          productId: '',

          sourceVersionId: source.sourceVersionId,
          evidenceIds: source.evidenceIds,
          knowledgeGroupId: source.knowledgeGroupId,
          candidateId: source.candidateId,
        };
        break;
      case 'COMPILED_TRUTH':
        productInput = {
          authority: source.authority,
          projectId: source.projectId,
          resourceId: source.resourceId,
          resourceRevision: source.resourceRevision,
          projectionLogicalDigest: source.projectionLogicalDigest,
          compiledItemId: source.compiledItemId,
          canonicalVersion: source.canonicalVersion,
          sourceSnapshotDigest: source.sourceSnapshotDigest,
        };
        lineage = {
          ...lineageBase,
          productId: '',
          projectionId: source.projectionLogicalDigest,
          projectionLogicalDigest: source.projectionLogicalDigest,
          compiledItemId: source.compiledItemId,
          canonicalVersion: source.canonicalVersion,
          sourceSnapshotDigest: source.sourceSnapshotDigest,
          ...(sourceVersionId === undefined ? {} : { sourceVersionId }),
          ...(source.evidenceIds.length === 0 ? {} : { evidenceIds: source.evidenceIds }),
          ...(projection === undefined ? {} : { projection }),
        };
        break;
      case 'DERIVED_INFERENCE':
        productInput = {
          authority: source.authority,
          projectId: source.projectId,
          resourceId: source.resourceId,
          resourceRevision: source.resourceRevision,
          inferenceId: source.inferenceId,
          sourceProjectionDigest: source.sourceProjectionDigest,
        };
        lineage = {
          ...lineageBase,
          productId: '',
          projectionId: source.sourceProjectionDigest,
          inferenceId: source.inferenceId,
          sourceProjectionDigest: source.sourceProjectionDigest,
          ...(sourceVersionId === undefined ? {} : { sourceVersionId }),
          ...(source.evidenceIds.length === 0 ? {} : { evidenceIds: source.evidenceIds }),
          ...(projection === undefined ? {} : { projection }),
        };
        break;
    }
    const productId = knowledgeProductId(productInput);
    const item: KnowledgeItemView = {
      productId,
      projectId: scope.activeProject.id,
      resourceId: source.resourceId,
      revision: source.resourceRevision,
      authority: match.authority,
      kind: match.kind,
      temporalState: match.temporalState,
      label: shortLabel(match.label),
      lineage: { ...lineage, productId },
      ...(evidenceTargets.length === 0 ? {} : { evidenceTargets }),
    };
    return {
      matchId: knowledgeMatchId({
        projectId: scope.activeProject.id,
        resourceId: source.resourceId,
        revision: source.resourceRevision,
        normalizedQuery,
        productId,
        authority: match.authority,
        matchType: match.matchType,
      }),
      projectId: scope.activeProject.id,
      resourceId: source.resourceId,
      item,
      score: match.score,
      matchAuthority:
        match.authority === 'CANONICAL' || match.authority === 'APPROVED_KNOWLEDGE'
          ? 'CANONICAL'
          : 'PROJECTION',
      matchType: match.matchType,
    };
  }

  private async searchEvidenceTargets(
    scope: ActiveKnowledgeScope,
    evidenceIds: readonly string[],
    source: SearchKnowledgeWorkspaceMatch['source'],
  ): Promise<readonly NonNullable<KnowledgeItemView['evidenceTargets']>[number][]> {
    if (evidenceIds.length === 0) return [];
    const evidence = await Promise.all(
      evidenceIds.map((evidenceId) =>
        this.query<EvidenceSpan>(scope, 'GetEvidenceSpan', { evidenceId }),
      ),
    );
    for (const item of evidence) {
      if (item.projectId !== scope.activeProject.id) {
        return fail(
          'UNSUPPORTED_SCHEMA',
          'Search Evidence Query crossed the active Project boundary.',
        );
      }
      if (source.authority === 'CANONICAL') {
        if (item.sourceId !== source.sourceId || item.sourceVersionId !== source.sourceVersionId) {
          return fail(
            'UNSUPPORTED_SCHEMA',
            'Canonical search Evidence identity does not match QX-01.',
          );
        }
      }
      if (
        source.authority === 'APPROVED_KNOWLEDGE' &&
        item.sourceVersionId !== source.sourceVersionId
      ) {
        return fail(
          'UNSUPPORTED_SCHEMA',
          'Approved Knowledge search Evidence identity does not match QX-01.',
        );
      }
    }
    return evidence.map((item) => ({
      resourceId: source.resourceId,
      resourceRevision: source.resourceRevision,
      focusId: productFocusId(item.pointer),
      sourceId: item.sourceId,
      sourceVersionId: item.sourceVersionId,
      evidenceId: item.evidenceId,
    }));
  }

  private async loadDomainState(scope: ActiveKnowledgeScope): Promise<DomainState> {
    const [snapshot, history, canonicalReadiness, groups, compiledPayload, derived] =
      await Promise.all([
        this.query<CanonicalSnapshot>(scope, 'GetCanonicalSnapshot', {}),
        this.query<CanonicalHistoryListResult>(scope, 'ListCanonicalHistory', {}),
        this.query<ProjectionReadiness>(scope, 'GetProjectionReadiness', {}),
        this.query<KnowledgeGroupListResult>(scope, 'ListKnowledgeGroups', {}),
        this.query<GetCompiledTruthReadSnapshotResult>(scope, 'GetCompiledTruthReadSnapshot', {
          schemaVersion: '1.0.0',
        }),
        this.query<DerivedInferenceListResult>(scope, 'ListDerivedInferences', {}),
      ]);
    const compiled = decodeGetCompiledTruthReadSnapshotResult(compiledPayload);
    if (
      snapshot.projectId !== scope.activeProject.id ||
      compiled.projectId !== scope.activeProject.id ||
      groups.items.some((group) => group.projectId !== scope.activeProject.id)
    ) {
      return fail(
        'UNSUPPORTED_SCHEMA',
        'Knowledge Query results crossed the active Project boundary.',
      );
    }
    const canonicalProjection = mapProjectionStatus('CANONICAL_SEARCH', canonicalReadiness);
    const compiledProjection = mapCompiledStatus(compiled.status);
    const evidenceCache = new Map<string, EvidenceSpan>();
    const revisionCache = new Map<string, TransformationRevision>();
    const commitCache = new Map<string, CanonicalCommitResult>();
    const queryEvidence = async (evidenceId: string): Promise<EvidenceSpan> => {
      const cached = evidenceCache.get(evidenceId);
      if (cached) return cached;
      const evidence = await this.query<EvidenceSpan>(scope, 'GetEvidenceSpan', { evidenceId });
      if (evidence.projectId !== scope.activeProject.id) {
        return fail('UNSUPPORTED_SCHEMA', 'Evidence Query crossed the active Project boundary.');
      }
      evidenceCache.set(evidenceId, evidence);
      return evidence;
    };
    const queryRevision = async (sourceVersionId: string): Promise<TransformationRevision> => {
      const cached = revisionCache.get(sourceVersionId);
      if (cached) return cached;
      const revision = await this.query<TransformationRevision>(scope, 'GetDocumentRevision', {
        sourceVersionId,
      });
      if (
        revision.projectId !== scope.activeProject.id ||
        revision.sourceVersionId !== sourceVersionId
      ) {
        return fail(
          'UNSUPPORTED_SCHEMA',
          'Transformation Query returned mismatched source identity.',
        );
      }
      revisionCache.set(sourceVersionId, revision);
      return revision;
    };
    const queryCommit = async (commitId: string): Promise<CanonicalCommitResult> => {
      const cached = commitCache.get(commitId);
      if (cached) return cached;
      const commit = await this.query<CanonicalCommitResult>(scope, 'GetCanonicalCommit', {
        commitId,
      });
      if (commit.projectId !== scope.activeProject.id || commit.commitId !== commitId) {
        return fail('UNSUPPORTED_SCHEMA', 'Canonical Commit Query returned mismatched identity.');
      }
      commitCache.set(commitId, commit);
      return commit;
    };
    const targets = async (
      evidenceIds: readonly string[],
      resourceId: string,
      resourceRevision: string,
    ): Promise<readonly NonNullable<KnowledgeItemView['evidenceTargets']>[number][]> => {
      const resolved = await Promise.all(evidenceIds.map(queryEvidence));
      return resolved.map((evidence) => ({
        resourceId,
        resourceRevision,
        focusId: productFocusId(evidence.pointer),
        sourceId: evidence.sourceId,
        sourceVersionId: evidence.sourceVersionId,
        evidenceId: evidence.evidenceId,
      }));
    };
    const items: KnowledgeItemView[] = [];
    const byProductId = new Map<string, KnowledgeItemView>();
    const addItem = (item: KnowledgeItemView): void => {
      const prior = byProductId.get(item.productId);
      if (prior && stableJson(prior) !== stableJson(item)) {
        fail('UNSUPPORTED_SCHEMA', `Knowledge Product identity collision for '${item.productId}'.`);
      }
      if (!prior) {
        byProductId.set(item.productId, item);
        items.push(item);
      }
    };
    const historyItems = history.items;
    for (const claimSummary of snapshot.claims) {
      const claim = await this.query<CanonicalClaim>(scope, 'GetCanonicalClaim', {
        claimId: claimSummary.claimId,
      });
      if (claim.projectId !== scope.activeProject.id) {
        return fail(
          'UNSUPPORTED_SCHEMA',
          'Canonical Claim Query crossed the active Project boundary.',
        );
      }
      const event = historyItems.find(
        (candidate) =>
          candidate.claimId === claim.claimId && candidate.eventType === 'CANONICAL_CLAIM_ADDED',
      );
      if (!event)
        return fail('UNSUPPORTED_SCHEMA', `Canonical history lacks claim '${claim.claimId}'.`);
      const commit = await queryCommit(event.commitId);
      const revision = await queryRevision(claim.sourceVersionId);
      const evidenceTargets = await targets(
        claim.evidenceIds,
        revision.sourceId,
        revision.revisionId,
      );
      const productId = knowledgeProductId({
        authority: 'CANONICAL',
        projectId: claim.projectId,
        resourceId: revision.sourceId,
        resourceRevision: revision.revisionId,
        canonicalResourceId: claim.claimId,
        canonicalRevisionId: commit.revisionId,
        sourceId: revision.sourceId,
        sourceVersionId: claim.sourceVersionId,
      });
      addItem({
        productId,
        projectId: claim.projectId,
        resourceId: revision.sourceId,
        revision: revision.revisionId,
        authority: 'CANONICAL',
        kind: 'CLAIM',
        temporalState: 'CURRENT',
        label: shortLabel(claim.claimText),
        content: claim.claimText,
        lineage: {
          projectId: claim.projectId,
          productId,
          resourceRevision: revision.revisionId,
          canonicalResourceId: claim.claimId,
          canonicalRevisionId: commit.revisionId,
          canonicalVersion: commit.afterVersion,
          sourceId: revision.sourceId,
          sourceVersionId: claim.sourceVersionId,
          evidenceIds: claim.evidenceIds,
          commitId: commit.commitId,
          manifestId: commit.manifestId ?? undefined,
          changeSetId: commit.changeSetId ?? undefined,
        },
        ...(evidenceTargets.length === 0 ? {} : { evidenceTargets }),
      });
    }
    for (const group of groups.items.filter((candidate) => candidate.status === 'APPROVED')) {
      const revision = await queryRevision(group.sourceVersionId);
      const evidenceByCandidate = new Map<
        string,
        readonly NonNullable<KnowledgeItemView['evidenceTargets']>[number][]
      >();
      for (const candidate of group.items) {
        const evidenceTargets = await targets(
          candidate.evidenceIds,
          group.groupId,
          String(group.revisionNumber),
        );
        evidenceByCandidate.set(candidate.candidateId, evidenceTargets);
        const productId = knowledgeProductId({
          authority: 'APPROVED_KNOWLEDGE',
          projectId: group.projectId,
          resourceId: group.groupId,
          resourceRevision: String(group.revisionNumber),
          knowledgeGroupId: group.groupId,
          candidateId: candidate.candidateId,
          sourceVersionId: group.sourceVersionId,
        });
        addItem({
          productId,
          projectId: group.projectId,
          resourceId: group.groupId,
          revision: String(group.revisionNumber),
          authority: 'APPROVED_KNOWLEDGE',
          kind: candidateKind(candidate),
          temporalState: 'CURRENT',
          label: shortLabel(candidateLabel(candidate)),
          ...(candidateContent(candidate) === undefined
            ? {}
            : { content: candidateContent(candidate) }),
          lineage: {
            projectId: group.projectId,
            productId,
            resourceRevision: String(group.revisionNumber),
            sourceId: revision.sourceId,
            sourceVersionId: group.sourceVersionId,
            evidenceIds: candidate.evidenceIds,
            knowledgeGroupId: group.groupId,
            candidateId: candidate.candidateId,
          },
          ...(evidenceByCandidate.get(candidate.candidateId)?.length
            ? { evidenceTargets: evidenceByCandidate.get(candidate.candidateId) }
            : {}),
        });
      }
    }
    const projection = compiled.projection;
    if (projection) {
      if (projection.projectId !== scope.activeProject.id) {
        return fail(
          'UNSUPPORTED_SCHEMA',
          'Compiled Truth Projection crossed the active Project boundary.',
        );
      }
      if (!projection.logicalDigest || !projection.sourceSnapshotDigest) {
        return fail('UNSUPPORTED_SCHEMA', 'Compiled Truth item lacks projection identity.');
      }
      for (const compiledItem of projection.items) {
        if (compiledItem.evidenceIds.length === 0) {
          return fail(
            'UNSUPPORTED_SCHEMA',
            `Compiled Truth item '${compiledItem.id}' lacks Evidence identity.`,
          );
        }
        const evidence = await queryEvidence(compiledItem.evidenceIds[0]!);
        const evidenceTargets = await targets(
          compiledItem.evidenceIds,
          compiledItem.id,
          projection.logicalDigest,
        );
        const productId = knowledgeProductId({
          authority: 'COMPILED_TRUTH',
          projectId: projection.projectId,
          resourceId: compiledItem.id,
          resourceRevision: projection.logicalDigest,
          projectionLogicalDigest: projection.logicalDigest,
          compiledItemId: compiledItem.id,
          canonicalVersion: projection.canonicalVersion,
          sourceSnapshotDigest: projection.sourceSnapshotDigest,
        });
        addItem({
          productId,
          projectId: projection.projectId,
          resourceId: compiledItem.id,
          revision: projection.logicalDigest,
          authority: 'COMPILED_TRUTH',
          kind: compiledItem.type,
          temporalState: compiledItem.state,
          label: shortLabel(compiledItem.label),
          lineage: {
            projectId: projection.projectId,
            productId,
            resourceRevision: projection.logicalDigest,
            projectionId: projection.logicalDigest,
            canonicalVersion: projection.canonicalVersion,
            sourceVersionId: evidence.sourceVersionId,
            evidenceIds: compiledItem.evidenceIds,
            projectionLogicalDigest: projection.logicalDigest,
            compiledItemId: compiledItem.id,
            sourceSnapshotDigest: projection.sourceSnapshotDigest,
            projection: compiledProjection,
          },
          ...(evidenceTargets.length === 0 ? {} : { evidenceTargets }),
        });
      }
    }
    for (const inference of derived.items) {
      if (inference.evidenceIds.length === 0) {
        return fail(
          'UNSUPPORTED_SCHEMA',
          `Derived inference '${inference.candidateId}' lacks Evidence identity.`,
        );
      }
      const evidence = await queryEvidence(inference.evidenceIds[0]!);
      const evidenceTargets = await targets(
        inference.evidenceIds,
        inference.candidateId,
        inference.sourceProjectionDigest,
      );
      const productId = knowledgeProductId({
        authority: 'DERIVED_INFERENCE',
        projectId: scope.activeProject.id,
        resourceId: inference.candidateId,
        resourceRevision: inference.sourceProjectionDigest,
        inferenceId: inference.candidateId,
        sourceProjectionDigest: inference.sourceProjectionDigest,
      });
      addItem({
        productId,
        projectId: scope.activeProject.id,
        resourceId: inference.candidateId,
        revision: inference.sourceProjectionDigest,
        authority: 'DERIVED_INFERENCE',
        kind: 'KNOWLEDGE_GAP',
        temporalState: 'FUTURE',
        label: shortLabel(inference.question),
        content: inference.question,
        lineage: {
          projectId: scope.activeProject.id,
          productId,
          resourceRevision: inference.sourceProjectionDigest,
          projectionId: inference.sourceProjectionDigest,
          sourceVersionId: evidence.sourceVersionId,
          evidenceIds: inference.evidenceIds,
          inferenceId: inference.candidateId,
          sourceProjectionDigest: inference.sourceProjectionDigest,
          projection: compiledProjection,
        },
        ...(evidenceTargets.length === 0 ? {} : { evidenceTargets }),
      });
    }
    const pageMap = new Map<string, KnowledgeItemView[]>();
    for (const item of items) {
      const key = objectKey(item.projectId, item.resourceId, item.revision);
      const group = pageMap.get(key) ?? [];
      group.push(item);
      pageMap.set(key, group);
    }
    const pages = [...pageMap.values()]
      .map((pageItems) => this.buildPage(pageItems, canonicalProjection, compiledProjection))
      .sort((left, right) =>
        stableJson({ resourceId: left.resourceId, revision: left.revision }).localeCompare(
          stableJson({ resourceId: right.resourceId, revision: right.revision }),
        ),
      );
    return { canonicalProjection, compiledProjection, pages };
  }

  private buildPage(
    items: readonly KnowledgeItemView[],
    canonicalProjection: KnowledgeProjectionStatusView,
    compiledProjection: KnowledgeProjectionStatusView,
  ): KnowledgePageView {
    const first = items[0];
    if (!first) return fail('UNSUPPORTED_SCHEMA', 'Knowledge page cannot be empty.');
    const projection = items.some((item) => item.authority === 'CANONICAL')
      ? canonicalProjection
      : compiledProjection;
    const pageId = knowledgePageId({
      projectId: first.projectId,
      resourceId: first.resourceId,
      revision: first.revision,
    });
    return {
      schemaVersion: '1.0.0',
      pageId,
      projectId: first.projectId,
      resourceId: first.resourceId,
      revision: first.revision,
      title: shortLabel(first.resourceId),
      items,
      lineage: { ...first.lineage, productId: pageId },
      projection,
      capabilities: PRODUCT_CAPABILITIES,
      fetchedAt: this.clock(),
    };
  }
}

type SearchKnowledgeWorkspaceResultPayload = Awaited<
  ReturnType<typeof decodeSearchKnowledgeWorkspaceResult>
>;
