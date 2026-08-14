import type { QueryClient } from '@tanstack/react-query';
import type {
  GlobalShellView,
  GraphSnapshotRequestV1,
  KnowledgeCompareRequest,
  KnowledgeDetailRequest,
  KnowledgePageListRequest,
  KnowledgeSearchRequest,
  KnowledgeWorkspaceRequest,
} from '@shotgun/api-client';

export const productSessionQueryKey = ['product', 'session'] as const;
export const sessionBoundaryQueryKey = ['session', 'boundary'] as const;
export const protectedQueryKey = ['protected'] as const;
export const globalQueryKey = ['global'] as const;
export const unprotectedQueryKey = ['unprotected'] as const;

export const projectQueryKey = (
  principalId: string,
  projectId: string,
  resource: string,
  ...parts: readonly unknown[]
) => ['project', principalId, projectId, resource, ...parts] as const;

export const settings5DQueryKey = (
  principalId: string,
  targetProjectId: string,
  resourceProjectId: string,
  category: string,
  revisionOrResourceId?: string | number,
) =>
  [
    'settings',
    principalId,
    targetProjectId,
    resourceProjectId,
    category,
    revisionOrResourceId ?? 'latest',
  ] as const;

export const projectAdminQueryKey = (principalId: string) =>
  ['project-admin', principalId] as const;

export const principalPreferencesQueryKey = (principalId: string) =>
  ['settings', 'preferences', principalId] as const;

export const globalShellQueryKey = (
  principalId: string,
  activeProjectId: string | null,
  accessRevision: string,
) => ['protected', 'global-shell', principalId, activeProjectId, accessRevision] as const;

export const homeActionCenterQueryKey = (input: {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly projectionRevision: string;
}) =>
  [
    'project',
    input.principalId,
    input.activeProjectId,
    'home-action-center',
    input.sessionId,
    input.accessRevision,
    input.policyContextRevision,
    input.projectionRevision,
  ] as const;

export type SourcesQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly projectionRevision: string;
  readonly sensitivity: string;
  readonly policyContextRevision: string;
};

const sourcesScopeKey = (scope: SourcesQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.projectionRevision,
    scope.sensitivity,
    scope.policyContextRevision,
  ] as const;

export const sourcesLibraryQueryKey = (scope: SourcesQueryScope, clientQueryDigest: string) =>
  [...sourcesScopeKey(scope), 'sources-library', clientQueryDigest] as const;

export const askConversationSourceContextQueryKey = (
  scope: SourcesQueryScope,
  conversationId: string,
  accessRevision: string,
  policyContextRevision: string,
  clientQueryDigest: string,
) =>
  [
    ...sourcesScopeKey(scope),
    'ask-conversation-source-context',
    conversationId,
    accessRevision,
    policyContextRevision,
    clientQueryDigest,
  ] as const;

export const sourceDetailQueryKey = (scope: SourcesQueryScope, sourceId: string) =>
  [...sourcesScopeKey(scope), 'source', sourceId] as const;

export const sourceVersionHistoryQueryKey = (
  scope: SourcesQueryScope,
  sourceId: string,
  sourceVersionId: string,
) => [...sourcesScopeKey(scope), 'source', sourceId, 'versions', sourceVersionId] as const;

export const sourcePreviewQueryKey = (
  scope: SourcesQueryScope,
  sourceId: string,
  sourceVersionId: string,
  mode: 'ORIGINAL' | 'TRANSFORMED',
) =>
  [
    ...sourcesScopeKey(scope),
    'source',
    sourceId,
    'version',
    sourceVersionId,
    'preview',
    mode,
  ] as const;

export const sourceEvidenceQueryKey = (
  scope: SourcesQueryScope,
  sourceId: string,
  sourceVersionId: string,
) =>
  [...sourcesScopeKey(scope), 'source', sourceId, 'version', sourceVersionId, 'evidence'] as const;

export type KnowledgeQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivity: string;
};

export const knowledgeScopeFromShell = (
  shell: GlobalShellView | null,
): KnowledgeQueryScope | null =>
  shell?.activeProject
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        resourceProjectId: shell.activeProject.id,
        accessRevision: shell.accessRevision,
        policyContextRevision: shell.policyContextRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
      }
    : null;

const knowledgeScopeKey = (scope: KnowledgeQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.accessRevision,
    scope.policyContextRevision,
    scope.sensitivity,
    'knowledge',
  ] as const;

export const knowledgeWorkspaceQueryKey = (
  scope: KnowledgeQueryScope,
  request: KnowledgeWorkspaceRequest,
) => [...knowledgeScopeKey(scope), 'workspace', request] as const;

export const knowledgePageListQueryKey = (
  scope: KnowledgeQueryScope,
  request: KnowledgePageListRequest,
) => [...knowledgeScopeKey(scope), 'pages', request] as const;

export const knowledgeSearchQueryKey = (
  scope: KnowledgeQueryScope,
  request: KnowledgeSearchRequest,
) => [...knowledgeScopeKey(scope), 'search', request] as const;

export const knowledgeDetailQueryKey = (
  scope: KnowledgeQueryScope,
  request: KnowledgeDetailRequest,
) => [...knowledgeScopeKey(scope), 'detail', request] as const;

export const knowledgeCompareQueryKey = (
  scope: KnowledgeQueryScope,
  request: KnowledgeCompareRequest,
) => [...knowledgeScopeKey(scope), 'compare', request] as const;

export const knowledgeDisabledQueryKey = (operation: string) =>
  ['knowledge', 'disabled', operation] as const;

export type GraphQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivity: string;
  readonly projectionRevision: string;
};

const graphScopeKey = (scope: GraphQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.accessRevision,
    scope.policyContextRevision,
    scope.sensitivity,
    scope.projectionRevision,
    'graph',
  ] as const;

/**
 * Scope-phase key: an initial snapshot request bound to the server scope.
 * The full request (base view, overlay kinds, filters) is part of the key so
 * two requests never reuse each other's cached result (AC-16).
 */
export const graphScopeQueryKey = (scope: GraphQueryScope, request: GraphSnapshotRequestV1) =>
  [...graphScopeKey(scope), 'scope', request] as const;

/**
 * Snapshot-phase key: any operation bound to a server-issued snapshot
 * identity (snapshotId + projectionRevision). Distinct from the scope-phase
 * key, so cache isolation holds across projects, policy/access revisions and
 * snapshot/overlay revisions.
 */
export const graphSnapshotPhaseQueryKey = (
  scope: GraphQueryScope,
  snapshotId: string,
  projectionRevision: string,
  operation: readonly unknown[],
) => [...graphScopeKey(scope), 'snapshot', snapshotId, projectionRevision, ...operation] as const;

export const graphDisabledQueryKey = (operation: string) =>
  ['graph', 'disabled', operation] as const;

export type ReviewQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivity: string;
  readonly queueSnapshotRevision: string;
};

export const reviewScopeFromShell = (shell: GlobalShellView | null): ReviewQueryScope | null =>
  shell?.activeProject
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        resourceProjectId: shell.activeProject.id,
        accessRevision: shell.accessRevision,
        policyContextRevision: shell.policyContextRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
        queueSnapshotRevision: 'latest',
      }
    : null;

const reviewScopeKey = (scope: ReviewQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.accessRevision,
    scope.policyContextRevision,
    scope.sensitivity,
    'review',
  ] as const;

/**
 * Queue-phase key: a bounded queue read bound to the server scope. The full
 * request (filters, page size, cursor) is part of the key so two requests
 * never reuse each other's cached result.
 */
export const reviewQueueQueryKey = (
  scope: ReviewQueryScope,
  request: {
    readonly targetKinds?: readonly string[];
    readonly aggregateStates?: readonly string[];
    readonly attentionReasons?: readonly string[];
    readonly query?: string;
    readonly pageSize: number;
    readonly cursor?: string;
  },
) => [...reviewScopeKey(scope), 'queue', request] as const;

/**
 * Context-phase key: a Review Context read bound to the immutable context
 * revision identity (reviewContextId + contextRevision).
 */
export const reviewContextPhaseQueryKey = (
  scope: ReviewQueryScope,
  reviewContextId: string,
  contextRevision: number,
  operation: readonly unknown[],
) => [...reviewScopeKey(scope), 'context', reviewContextId, contextRevision, ...operation] as const;

export const reviewDisabledQueryKey = (operation: string) =>
  ['review', 'disabled', operation] as const;

/**
 * FE-P5-S1 WP4 Activity Workspace query scope. Derived from the shell like the
 * Review/External Action scopes; the server derives Principal, Project, access,
 * policy, capability and sensitivity authority — the browser only names the
 * resource and its filters (ADR-130).
 */
export type ActivityQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivity: string;
};

export const activityScopeFromShell = (shell: GlobalShellView | null): ActivityQueryScope | null =>
  shell?.activeProject
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        resourceProjectId: shell.activeProject.id,
        accessRevision: shell.accessRevision,
        policyContextRevision: shell.policyContextRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
      }
    : null;

const activityScopeKey = (scope: ActivityQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.accessRevision,
    scope.policyContextRevision,
    scope.sensitivity,
    'activity',
  ] as const;

/**
 * Activity scope prefix used for invalidation after an explicit refresh — it
 * matches the REAL queue/resource/refresh keys of the scope (no ad hoc arrays).
 */
export const activityScopePrefix = (scope: ActivityQueryScope) =>
  [...activityScopeKey(scope)] as const;

/**
 * Queue-phase key: a bounded queue read bound to the server scope AND the full
 * request (filters, limit, cursor) so two requests never reuse each other's
 * cached result and polling does not overwrite a filtered page.
 */
export const activityQueueQueryKey = (
  scope: ActivityQueryScope,
  request: {
    readonly domainKinds?: readonly string[];
    readonly states?: readonly string[];
    readonly attention?: 'NEEDS_ATTENTION' | 'RESOLVED' | 'NONE';
    readonly cursor?: string;
    readonly limit?: number;
  },
) => [...activityScopeKey(scope), 'queue', request] as const;

/**
 * Resource-phase key: any Detail/Stage/Event read is bound to the server scope
 * AND the concrete Activity identity (projection + Domain reference), so cache
 * isolation holds across Project, access, policy and Activity identity.
 */
export const activityResourceQueryKey = (
  scope: ActivityQueryScope,
  identity: {
    readonly domainKind: string;
    readonly activityId: string;
    readonly domainResourceKind: string;
    readonly domainResourceId: string;
  },
  operation: readonly unknown[],
) => [...activityScopeKey(scope), 'resource', identity, ...operation] as const;

export const activityDisabledQueryKey = (operation: string) =>
  ['activity', 'disabled', operation] as const;

/** Refresh-phase key used to invalidate after an explicit refresh. */
export const activityRefreshQueryKey = (scope: ActivityQueryScope) =>
  [...activityScopeKey(scope), 'refresh'] as const;

/**
 * FE-P5-S2 WP5 History Workspace query scope. Derived from the shell like the
 * Activity scope; the server derives Principal, Project, access, policy,
 * capability and sensitivity authority — the browser only names the resource
 * and its filters (ADR-131 §2 / IR r1 §5 WP4).
 */
export type HistoryQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivity: string;
};

export const historyScopeFromShell = (
  shell: GlobalShellView | null,
  resourceProjectIdOverride?: string,
): HistoryQueryScope | null =>
  shell?.activeProject
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        // Round 2 C: an explicit deleted-project audit target overrides the
        // resource project while the ACTIVE project stays the live control
        // project. The server revalidates tombstone + audit scope + current
        // capability for any non-active resourceProjectId.
        resourceProjectId: resourceProjectIdOverride ?? shell.activeProject.id,
        accessRevision: shell.accessRevision,
        policyContextRevision: shell.policyContextRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
      }
    : null;

const historyScopeKey = (scope: HistoryQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.accessRevision,
    scope.policyContextRevision,
    scope.sensitivity,
    'history',
  ] as const;

/** History scope prefix used for cache invalidation. */
export const historyScopePrefix = (scope: HistoryQueryScope) =>
  [...historyScopeKey(scope)] as const;

/**
 * History list key: bound to the server scope AND the full request (domain
 * filter, cursor, limit) so two requests never reuse each other's cached page.
 */
export const historyListQueryKey = (
  scope: HistoryQueryScope,
  request: {
    readonly domainKinds?: readonly string[];
    readonly cursor?: unknown;
    readonly limit?: number;
  },
) => [...historyScopeKey(scope), 'list', request] as const;

/** History entry detail key: bound to the scope AND the projection identity. */
export const historyEntryQueryKey = (scope: HistoryQueryScope, historyEntryId: string) =>
  [...historyScopeKey(scope), 'entry', historyEntryId] as const;

export const historyDisabledQueryKey = (operation: string) =>
  ['history', 'disabled', operation] as const;

/**
 * FE-P4-S2 WP5 External Action workspace query scope. Derived from the shell
 * exactly like the Review scope; the server derives capability/credential/
 * budget authority (ADR-129), the browser only names the resource.
 */
export type ExternalActionQueryScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivity: string;
};

export const externalActionScopeFromShell = (
  shell: GlobalShellView | null,
): ExternalActionQueryScope | null =>
  shell?.activeProject
    ? {
        principalId: shell.principalId,
        sessionId: shell.sessionId,
        activeProjectId: shell.activeProject.id,
        resourceProjectId: shell.activeProject.id,
        accessRevision: shell.accessRevision,
        policyContextRevision: shell.policyContextRevision,
        sensitivity: shell.activeProject.sensitivityClearance,
      }
    : null;

const externalActionScopeKey = (scope: ExternalActionQueryScope) =>
  [
    'project',
    scope.principalId,
    scope.sessionId,
    scope.activeProjectId,
    scope.resourceProjectId,
    scope.accessRevision,
    scope.policyContextRevision,
    scope.sensitivity,
    'external-action',
  ] as const;

/**
 * Bounded queue-phase key: the queue read is bound to the server scope and the
 * full request (page size, cursor) so two requests never reuse each other's
 * cached result.
 */
export const externalActionQueueQueryKey = (
  scope: ExternalActionQueryScope,
  request: { readonly pageSize: number; readonly cursor?: string },
) => [...externalActionScopeKey(scope), 'queue', request] as const;

/**
 * Resource-phase key: any aggregate/manifest/risk/preflight/execution/attempt/
 * verification/result/audit/approval read is bound to the server scope AND the
 * immutable action identity (actionId + actionRevision + externalRevision) so
 * cache isolation holds across Project, access, policy, action revision and
 * external revision (WP5 scope item 3).
 */
export const externalActionResourceQueryKey = (
  scope: ExternalActionQueryScope,
  actionId: string,
  actionRevision: number,
  externalRevision: string,
  operation: readonly unknown[],
) =>
  [
    ...externalActionScopeKey(scope),
    'action',
    actionId,
    actionRevision,
    externalRevision,
    ...operation,
  ] as const;

export const externalActionDisabledQueryKey = (operation: string) =>
  ['external-action', 'disabled', operation] as const;

/**
 * Action-prefix key used for invalidation after a governed command resolves or
 * an `OUTCOME_UNKNOWN` completes. It matches the REAL resource keys (scope +
 * 'action' + actionId) so a single invalidate refreshes the detail and every
 * child read of that action without ad hoc key arrays (Review 4865620679 item
 * 5 — the previous `['project', principalId, 'external-action', ...]` prefix
 * did not match the actual keys).
 */
export const externalActionActionQueryKey = (scope: ExternalActionQueryScope, actionId: string) =>
  [...externalActionScopeKey(scope), 'action', actionId] as const;

/**
 * Dedicated BOOTSTRAP key for the aggregate snapshot read (Review 4866122577
 * item 3). The snapshot binds ONLY the server scope + actionId and is NEVER a
 * revision-bound resource key (it does not know the action/external revision
 * yet) — so no `externalActionResourceQueryKey` entry ever carries the
 * placeholder `actionRevision: -1` / `externalRevision: ''` used to bootstrap
 * the detail identity.
 */
export const externalActionSnapshotQueryKey = (scope: ExternalActionQueryScope, actionId: string) =>
  [...externalActionScopeKey(scope), 'snapshot', actionId] as const;

export const clearProjectQueries = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
};

export const purgeProjectScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await clearProjectQueries(queryClient);
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.removeQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['protected', 'global-shell'] });
  queryClient.removeQueries({ queryKey: ['protected', 'global-shell'] });
};

export const purgeProtectedSessionCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['protected'] });
  queryClient.removeQueries({ queryKey: ['protected'] });
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.removeQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['project-admin'] });
  queryClient.removeQueries({ queryKey: ['project-admin'] });
  await queryClient.cancelQueries({ queryKey: productSessionQueryKey });
  queryClient.removeQueries({ queryKey: productSessionQueryKey });
};

export const purgeSettingsScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.invalidateQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['project-admin'] });
  queryClient.invalidateQueries({ queryKey: ['project-admin'] });
};
