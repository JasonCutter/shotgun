import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Ref } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';

import {
  createAskWorkspaceClient,
  createFrontendActivityClient,
  createFrontendExternalActionClient,
  createSourcesWriteClient,
  type ActivityAvailableActionV1,
  type ActivityDetailV1,
  type ActivityProjectionMetadataV1,
  type ActivityQueueItemV1,
  type ActivityRootReferenceV1,
  type GlobalShellView,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { activityScopeFromShell, activityScopePrefix } from '../app/query-keys.js';
import {
  activityDetailQueryOptions,
  activityEventsQueryOptions,
  activityQueueQueryOptions,
  activityStagesQueryOptions,
  type ActivityIdentity,
} from '../activity/activity-queries.js';
import { parseActivityDeepLink } from '../activity/activity-route-contract.js';
import {
  ACTIVITY_ANNOUNCEMENTS,
  ACTIVITY_ATTENTION_FILTER_OPTIONS,
  ACTIVITY_DOMAIN_KIND_OPTIONS,
  ACTIVITY_LIFECYCLE_STATE_OPTIONS,
  activityAttentionLabel,
  activityDomainKindLabel,
  activityLifecycleStateLabel,
  createInitialActivityWorkspaceState,
  reduceActivityWorkspaceState,
  type ActivityAttentionFilter,
} from '../activity/activity-workspace-state.js';

/**
 * FE-P5-S1 WP4 — Activity Workspace (`/activity`, guarded).
 *
 * Project-scoped operational workspace for current/recent Sources, Ask and
 * External Action work (Contract Snapshot §2). Queue with server-derived
 * filters + Attention + adapter health/projection metadata, Detail with
 * Job-or-Run root, Runs, Domain Attempts, Stages and bounded Events, exact
 * Domain Resource deep links (AC-04/AC-12), polling-based authoritative
 * refresh (Polling = BASELINE), and keyboard/accessibility representations
 * (AC-15). Retry/Cancel are NOT Activity commands (WP5 keeps them on the
 * owning-Domain routes); the browser owns only selection, filters and the
 * polling preference.
 */

const POLL_DISABLED_REASON =
  '활동 큐 자동 새로고침이 꺼져 있습니다. 새로고침 버튼으로 수동 갱신할 수 있습니다.';

/** Fresh command identity for an owning-Domain delegated command (WP5). */
const freshCommandId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const identityFromRoot = (root: ActivityRootReferenceV1): ActivityIdentity => ({
  domainKind: root.domainKind,
  activityId: root.activityId,
  domainResourceKind: root.domainResourceKind,
  domainResourceId: root.domainResourceId,
});

/**
 * Exact Domain Resource deep link to the owning-Domain workspace route.
 *
 * Every link is built from the server-verified concrete identity
 * (`domainResourceKind` + `domainResourceId`), never from the projection
 * identity `activityId` (AC-04 identity separation). The owning-Domain route
 * revalidates access on arrival (AC-12); a denied resource resolves to the
 * same non-disclosing NOT_FOUND as the Activity read.
 */
const domainWorkspaceHref = (identity: ActivityIdentity): string => {
  const resourceId = encodeURIComponent(identity.domainResourceId);
  if (identity.domainKind === 'SOURCES') return `/sources/${resourceId}`;
  if (identity.domainKind === 'ASK') return `/ask/conversations/${resourceId}`;
  if (identity.domainKind === 'EXTERNAL_ACTION') {
    return `/external-action?action=${resourceId}`;
  }
  return '/activity';
};

const queueItemDeepLinkParams = (item: ActivityQueueItemV1): URLSearchParams => {
  const params = new URLSearchParams();
  params.set('domain', item.root.domainKind);
  params.set('activity', item.root.activityId);
  params.set('resource', item.root.domainResourceKind);
  params.set('resourceId', item.root.domainResourceId);
  return params;
};

// ---------------------------------------------------------------------------
// Projection metadata (AC-09: Watermark, Lag, Stale, Adapter Unavailable)
// ---------------------------------------------------------------------------

const activitySummaryLabel = (item: ActivityQueueItemV1): string => {
  if (item.root.domainKind === 'SOURCES') return 'Source processing';
  if (item.root.domainKind === 'ASK') return 'Answering a question';
  return 'External action';
};

const technicalJson = (value: unknown): string => JSON.stringify(value) ?? 'null';

const ProjectionMetadata = ({ metadata }: { readonly metadata: ActivityProjectionMetadataV1 }) => (
  <>
    <TechnicalDetails
      summary="Activity data details"
      inspectionItems={[
        { label: 'Projection freshness', value: metadata.freshness },
        { label: 'Projection adapter', value: metadata.adapterStatus },
        { label: 'Projection partial', value: metadata.partial },
        { label: 'Snapshot revision', value: metadata.snapshotRevision },
        ...(metadata.lagMilliseconds === undefined
          ? []
          : [{ label: 'Projection lag (ms)', value: metadata.lagMilliseconds }]),
        { label: 'Projection source updated', value: metadata.sourceUpdatedAt },
      ]}
    />
    {metadata.partial || metadata.adapterStatus !== 'AVAILABLE' ? (
      <p className="activity-partial-note" role="status">
        Some activity information is temporarily unavailable. Refresh before making a decision.
      </p>
    ) : null}
  </>
);

// ---------------------------------------------------------------------------
// Queue filters (server-derived; browser only names the filter values)
// ---------------------------------------------------------------------------

const QueueFilters = ({
  domainKinds,
  states,
  attention,
  onToggleDomainKind,
  onToggleState,
  onSetAttention,
}: {
  readonly domainKinds: readonly ActivityRootReferenceV1['domainKind'][];
  readonly states: readonly ActivityDetailV1['run']['state'][];
  readonly attention: ActivityAttentionFilter;
  readonly onToggleDomainKind: (kind: ActivityRootReferenceV1['domainKind']) => void;
  readonly onToggleState: (state: ActivityDetailV1['run']['state']) => void;
  readonly onSetAttention: (attention: ActivityAttentionFilter) => void;
}) => (
  <div className="activity-filters" aria-label="활동 필터">
    <fieldset>
      <legend>도메인</legend>
      <div className="activity-filter-row">
        {ACTIVITY_DOMAIN_KIND_OPTIONS.map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={domainKinds.includes(kind)}
              onChange={() => onToggleDomainKind(kind)}
            />
            {activityDomainKindLabel[kind]}
          </label>
        ))}
      </div>
    </fieldset>
    <fieldset>
      <legend>상태</legend>
      <div className="activity-filter-row">
        {ACTIVITY_LIFECYCLE_STATE_OPTIONS.map((state) => (
          <label key={state}>
            <input
              type="checkbox"
              checked={states.includes(state)}
              onChange={() => onToggleState(state)}
            />
            {activityLifecycleStateLabel[state]}
          </label>
        ))}
      </div>
    </fieldset>
    <fieldset>
      <legend>Attention</legend>
      <label>
        <select
          aria-label="Attention 필터"
          value={attention}
          onChange={(event) => onSetAttention(event.target.value as ActivityAttentionFilter)}
        >
          {ACTIVITY_ATTENTION_FILTER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'ANY' ? '모두' : activityAttentionLabel[option]}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  </div>
);

// ---------------------------------------------------------------------------
// Queue list (keyboard-navigable, list representation — AC-15)
// ---------------------------------------------------------------------------

const QueueList = ({
  items,
  selectedKey,
  onSelect,
}: {
  readonly items: readonly ActivityQueueItemV1[];
  readonly selectedKey: string | null;
  readonly onSelect: (item: ActivityQueueItemV1) => void;
}) => (
  <ul className="activity-queue-list" aria-label="활동 큐">
    {items.map((item) => {
      const key = `${item.root.domainKind}:${item.root.activityId}`;
      return (
        <li key={key}>
          <button
            type="button"
            className="activity-queue-item"
            aria-current={selectedKey === key ? 'true' : undefined}
            aria-pressed={selectedKey === key}
            onClick={() => onSelect(item)}
          >
            <span className="activity-item-summary">{activitySummaryLabel(item)}</span>
            <span className="activity-item-meta">
              <span className="activity-item-domain">
                {activityDomainKindLabel[item.root.domainKind]}
              </span>
              <span className="activity-item-state" data-state={item.state}>
                {activityLifecycleStateLabel[item.state]}
              </span>
              <span className="activity-item-attention" data-attention={item.dimensions.attention}>
                {activityAttentionLabel[item.dimensions.attention]}
              </span>
              <span className="activity-item-time">
                {new Date(item.updatedAt).toLocaleTimeString()}
              </span>
            </span>
          </button>
        </li>
      );
    })}
  </ul>
);

// ---------------------------------------------------------------------------
// Detail (Job-or-Run root, Run, Attempts, Stages, bounded Events — AC-03/AC-05)
// ---------------------------------------------------------------------------

/** Stable key for one available-action descriptor (kind + mode/context). */
const actionKey = (action: ActivityAvailableActionV1): string => {
  if (action.kind === 'RETRY') {
    return action.retryMode !== undefined
      ? `RETRY:${action.retryMode}`
      : `RETRY:${action.executionId ?? ''}:${action.sourceAttemptId ?? ''}`;
  }
  return 'CANCEL';
};

const retryModeLabel: Record<'SAME_CONTEXT' | 'CURRENT_POLICY', string> = {
  SAME_CONTEXT: '재시도 (같은 컨텍스트)',
  CURRENT_POLICY: '재시도 (현재 정책)',
};

const DetailSection = ({
  detail,
  additionalStages,
  additionalEvents,
  headingRef,
  onAction,
  actionPending,
  actionError,
}: {
  readonly detail: ActivityDetailV1;
  readonly additionalStages: ActivityDetailV1['stages'];
  readonly additionalEvents: ActivityDetailV1['events'];
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly onAction: (action: ActivityAvailableActionV1) => void;
  readonly actionPending: string | null;
  readonly actionError: string | null;
}) => {
  const identity = identityFromRoot(detail.root);
  const resourceHref = detail.root.resourceHref;
  const actions = detail.availableActions;
  const inspectionStages = [...detail.stages, ...additionalStages];
  const inspectionEvents = [...detail.events, ...additionalEvents];
  return (
    <section className="activity-detail" aria-label="Activity details">
      <header className="activity-detail-header">
        <h2 ref={headingRef} tabIndex={-1}>
          {activityDomainKindLabel[identity.domainKind]} activity
        </h2>
        <p className="activity-detail-domain">{activityLifecycleStateLabel[detail.run.state]}</p>
        <p>
          <Link to={domainWorkspaceHref(identity)} className="activity-domain-link">
            도메인 워크스페이스에서 열기
          </Link>
        </p>
        <p className="activity-resource-href">
          <a href={resourceHref} className="activity-domain-link">
            Open related resource
          </a>
        </p>
      </header>

      {actions.length === 0 ? null : (
        <div className="activity-actions" aria-label="활동 명령">
          {actions.map((action) => {
            const key = actionKey(action);
            const pending = actionPending === key;
            if (action.kind === 'CANCEL') {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onAction(action)}
                  disabled={actionPending !== null}
                >
                  {pending ? '취소 중…' : '취소'}
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => onAction(action)}
                disabled={actionPending !== null}
              >
                {pending
                  ? '재시도 중…'
                  : action.retryMode !== undefined
                    ? retryModeLabel[action.retryMode]
                    : '재시도'}
              </button>
            );
          })}
          {actionError === null ? null : (
            <p className="activity-action-error" role="alert">
              {actionError}
            </p>
          )}
        </div>
      )}

      <dl className="summary-grid">
        <div>
          <dt>State</dt>
          <dd>{activityLifecycleStateLabel[detail.run.state]}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{new Date(detail.run.startedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>
            {detail.run.completedAt
              ? new Date(detail.run.completedAt).toLocaleString()
              : 'In progress'}
          </dd>
        </div>
        <div>
          <dt>Attention</dt>
          <dd>{activityAttentionLabel[detail.dimensions.attention]}</dd>
        </div>
      </dl>

      <TechnicalDetails
        items={[
          { label: 'Activity ID', value: detail.root.activityId },
          { label: 'Run ID', value: detail.run.runId },
          ...(detail.run.jobId === undefined ? [] : [{ label: 'Job ID', value: detail.run.jobId }]),
          { label: 'Run sequence', value: detail.run.sequence },
          { label: 'Resource path', value: resourceHref },
        ]}
        inspectionItems={[
          { label: 'Domain kind', value: detail.root.domainKind },
          { label: 'Resource kind', value: detail.root.domainResourceKind },
          { label: 'Resource ID', value: detail.root.domainResourceId },
          { label: 'Run state', value: detail.run.state },
          {
            label: 'Run topology',
            value: technicalJson({
              domainAttemptRefs: detail.run.domainAttemptRefs,
              correlationRefs: detail.run.correlationRefs,
              causationRefs: detail.run.causationRefs,
            }),
          },
          {
            label: 'Domain Attempts',
            value: technicalJson(
              detail.attempts.map((attempt) => ({
                attemptId: attempt.attemptId,
                runId: attempt.runId,
                attemptNumber: attempt.attemptNumber,
                attemptKind: attempt.attemptKind,
                state: attempt.state,
                retryability: attempt.retryability,
                stageRefs: attempt.stageRefs,
              })),
            ),
          },
          {
            label: 'Transport Attempts',
            value: technicalJson(
              detail.transportAttempts.map((attempt) => ({
                transportAttemptId: attempt.transportAttemptId,
                transportKind: attempt.transportKind,
                commandOrMessageRef: attempt.commandOrMessageRef,
                deliverySequence: attempt.deliverySequence,
                deliveryResult: attempt.deliveryResult,
                deliveredAt: attempt.deliveredAt,
                failure: attempt.failure,
              })),
            ),
          },
          {
            label: 'Stages',
            value: technicalJson(
              inspectionStages.map((stage) => ({
                stageId: stage.stageId,
                stageKey: stage.stageKey,
                label: stage.label,
                sequence: stage.sequence,
                state: stage.state,
              })),
            ),
          },
          {
            label: 'Events',
            value: technicalJson(
              inspectionEvents.map((event) => ({
                eventId: event.eventId,
                relatedRef: event.relatedRef,
                category: event.category,
                sequence: event.sequence,
                occurredAt: event.occurredAt,
                summary: event.summary,
                domainResourceRef: event.domainResourceRef,
              })),
            ),
          },
        ]}
      >
        <h3>Domain Attempts</h3>
        {detail.attempts.length === 0 ? (
          <EmptyState title="Attempt 없음" description="등록된 Domain Attempt가 없습니다." />
        ) : (
          <table className="activity-table" aria-label="Domain Attempts">
            <thead>
              <tr>
                <th scope="col">Attempt</th>
                <th scope="col">Kind</th>
                <th scope="col">State</th>
                <th scope="col">Retryable</th>
              </tr>
            </thead>
            <tbody>
              {detail.attempts.map((attempt) => (
                <tr key={attempt.attemptId}>
                  <th scope="row">{attempt.attemptId}</th>
                  <td>{attempt.attemptKind}</td>
                  <td>{activityLifecycleStateLabel[attempt.state]}</td>
                  <td>{attempt.retryability === 'RETRYABLE' ? '예' : '아니오'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Transport Attempts</h3>
        {detail.transportAttempts.length === 0 ? (
          <EmptyState
            title="Transport Attempt 없음"
            description="등록된 Transport Attempt가 없습니다."
          />
        ) : (
          <table className="activity-table" aria-label="Transport Attempts">
            <thead>
              <tr>
                <th scope="col">Transport Attempt</th>
                <th scope="col">Kind</th>
                <th scope="col">Delivery</th>
                <th scope="col">Result</th>
                <th scope="col">Delivered</th>
                <th scope="col">Safe Failure</th>
              </tr>
            </thead>
            <tbody>
              {detail.transportAttempts.map((attempt) => (
                <tr key={attempt.transportAttemptId}>
                  <th scope="row">{attempt.transportAttemptId}</th>
                  <td>{attempt.transportKind}</td>
                  <td>{attempt.deliverySequence}</td>
                  <td>{attempt.deliveryResult}</td>
                  <td>
                    <time dateTime={attempt.deliveredAt}>
                      {new Date(attempt.deliveredAt).toLocaleTimeString()}
                    </time>
                  </td>
                  <td>{attempt.failure ? attempt.failure.message : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Stages</h3>
        {detail.stages.length === 0 ? (
          <EmptyState title="Stage 없음" description="등록된 Stage가 없습니다." />
        ) : (
          <table className="activity-table" aria-label="Stages">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Label</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {detail.stages.map((stage) => (
                <tr key={stage.stageId}>
                  <th scope="row">{stage.stageKey}</th>
                  <td>{stage.label}</td>
                  <td>{stage.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Events (bounded operational evidence)</h3>
        {detail.events.length === 0 ? (
          <EmptyState title="Event 없음" description="등록된 Event가 없습니다." />
        ) : (
          <ol className="activity-events" aria-label="Events">
            {detail.events.map((event) => (
              <li key={event.eventId}>
                <span className="activity-event-category" data-category={event.category}>
                  {event.category}
                </span>{' '}
                <span>{event.summary}</span>{' '}
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleTimeString()}
                </time>
              </li>
            ))}
          </ol>
        )}
      </TechnicalDetails>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const ActivityWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const activityClient = useMemo(() => createFrontendActivityClient(), []);
  const queryClient = useQueryClient();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceActivityWorkspaceState,
    undefined,
    createInitialActivityWorkspaceState,
  );
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusedSelectionKey = useRef<string | null>(null);

  const scope = activityScopeFromShell(shell);
  const deepLink = useMemo(() => parseActivityDeepLink(searchParameters), [searchParameters]);

  const announce = useCallback((message: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  }, []);

  // Queue request derived from the workspace filters (server-derived values).
  const queueRequest = useMemo(
    () => ({
      ...(state.domainKinds.length > 0 ? { domainKinds: state.domainKinds } : {}),
      ...(state.states.length > 0 ? { states: state.states } : {}),
      ...(state.attention === 'ANY' ? {} : { attention: state.attention }),
      limit: 50,
    }),
    [state.domainKinds, state.states, state.attention],
  );

  const queue = useQuery(
    activityQueueQueryOptions(activityClient, scope, queueRequest, {
      pollingEnabled: state.pollingEnabled,
    }),
  );

  // Selected identity: restored from the deep link (AC-12 revalidated server-side).
  const selected = state.selected;
  const detail = useQuery(
    activityDetailQueryOptions(activityClient, scope, selected, {
      pollingEnabled: state.pollingEnabled,
    }),
  );

  // Bounded continuation reads for the selected Activity.
  const stages = useQuery(activityStagesQueryOptions(activityClient, scope, selected));
  const events = useQuery(activityEventsQueryOptions(activityClient, scope, selected));

  // Deep-link restore: the URL is the single source of truth for selection.
  useEffect(() => {
    if (!deepLink.domainKind || !deepLink.activityId) {
      dispatch({ type: 'CLEAR_SELECTION' });
      return;
    }
    if (!deepLink.resourceKind || !deepLink.resourceId) return;
    dispatch({
      type: 'SELECT_ACTIVITY',
      identity: {
        domainKind: deepLink.domainKind,
        activityId: deepLink.activityId,
        domainResourceKind: deepLink.resourceKind,
        domainResourceId: deepLink.resourceId,
      },
    });
  }, [deepLink]);

  const selectItem = useCallback(
    (item: ActivityQueueItemV1) => {
      setSearchParameters(queueItemDeepLinkParams(item));
      dispatch({ type: 'SELECT_ACTIVITY', identity: identityFromRoot(item.root) });
      announce(ACTIVITY_ANNOUNCEMENTS.SELECTED);
    },
    [announce, setSearchParameters],
  );

  const refresh = useMutation({
    mutationFn: () => activityClient.refreshActivityProjection({ schemaVersion: '1.0.0' }),
    onSuccess: () => {
      if (scope) queryClient.invalidateQueries({ queryKey: activityScopePrefix(scope) });
      announce(ACTIVITY_ANNOUNCEMENTS.REFRESHED);
    },
  });

  // -------------------------------------------------------------------------
  // WP5 — Existing Domain action delegation (AC-13)
  //
  // Retry/Cancel are shown ONLY from the server-derived `availableActions`;
  // Activity owns no generic command endpoint. Every action descriptor is
  // executed through the existing owning-Domain command client with the exact
  // server-derived semantics/context (retry mode for Sources/Ask; action
  // revision and execution/source-attempt/causation for External Action). The
  // owning-Domain command revalidates state and authority at execution time and
  // preserves Domain Retry causation.
  // -------------------------------------------------------------------------
  const sourcesWriteClient = useMemo(() => createSourcesWriteClient(), []);
  const askClient = useMemo(() => createAskWorkspaceClient(), []);
  const externalActionClient = useMemo(() => createFrontendExternalActionClient(), []);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshAfterDomainCommand = useCallback(() => {
    if (scope) queryClient.invalidateQueries({ queryKey: activityScopePrefix(scope) });
    void detail.refetch();
  }, [queryClient, scope, detail]);

  const runDomainAction = useCallback(
    async (action: ActivityAvailableActionV1) => {
      if (!selected || !scope) return;
      setPendingAction(actionKey(action));
      setActionError(null);
      const resourceId = selected.domainResourceId;
      const commandId = freshCommandId;
      try {
        if (selected.domainKind === 'SOURCES') {
          if (action.kind === 'CANCEL') {
            await sourcesWriteClient.cancel({
              activeProjectId: scope.activeProjectId,
              targetProjectId: scope.activeProjectId,
              clientRequestId: commandId('activity-sources-cancel-request'),
              idempotencyKey: commandId('activity-sources-cancel-idempotency'),
              submissionId: resourceId,
            });
          } else {
            if (action.retryMode === undefined) {
              throw new Error('Sources Retry mode is missing from the server-derived action.');
            }
            const failedItemIds = (detail.data?.stages ?? [])
              .filter((stage) => stage.state === 'FAILED')
              .map((stage) => stage.stageId);
            await sourcesWriteClient.retry({
              activeProjectId: scope.activeProjectId,
              targetProjectId: scope.activeProjectId,
              clientRequestId: commandId('activity-sources-retry-request'),
              idempotencyKey: commandId('activity-sources-retry-idempotency'),
              submissionId: resourceId,
              itemIds: failedItemIds,
              mode: action.retryMode,
            });
          }
        } else if (selected.domainKind === 'ASK') {
          if (action.kind === 'CANCEL') {
            if (!askClient.cancelAnswerRun) throw new Error('Ask Cancel is unavailable.');
            await askClient.cancelAnswerRun(resourceId, {
              schemaVersion: '1.0.0',
              clientRequestId: commandId('activity-ask-cancel-request'),
              idempotencyKey: commandId('activity-ask-cancel-idempotency'),
            });
          } else {
            if (!askClient.retryAnswerRun || action.retryMode === undefined) {
              throw new Error('Ask Retry mode is missing from the server-derived action.');
            }
            await askClient.retryAnswerRun(resourceId, {
              schemaVersion: '1.0.0',
              clientRequestId: commandId('activity-ask-retry-request'),
              idempotencyKey: commandId('activity-ask-retry-idempotency'),
              mode: action.retryMode,
            });
          }
        } else if (selected.domainKind === 'EXTERNAL_ACTION') {
          if (action.kind === 'CANCEL') {
            if (action.actionRevision === undefined) {
              throw new Error('External Action Cancel revision is missing.');
            }
            await externalActionClient.cancelExternalAction({
              schemaVersion: '1.0.0',
              clientRequestId: commandId('activity-ea-cancel-request'),
              idempotencyKey: commandId('activity-ea-cancel-idempotency'),
              actionId: resourceId,
              expectedActionRevision: action.actionRevision,
              reason: 'Cancelled from the Activity Workspace.',
            });
          } else {
            if (
              action.executionId === undefined ||
              action.sourceAttemptId === undefined ||
              action.causationId === undefined
            ) {
              throw new Error('External Action Retry context is missing.');
            }
            await externalActionClient.retryExecutionAttempt({
              schemaVersion: '1.0.0',
              clientRequestId: commandId('activity-ea-retry-request'),
              idempotencyKey: commandId('activity-ea-retry-idempotency'),
              actionId: resourceId,
              executionId: action.executionId,
              sourceAttemptId: action.sourceAttemptId,
              causationId: action.causationId,
              reason: 'Retried from the Activity Workspace.',
            });
          }
        }
        refreshAfterDomainCommand();
        announce(
          action.kind === 'CANCEL'
            ? ACTIVITY_ANNOUNCEMENTS.CANCELLED
            : ACTIVITY_ANNOUNCEMENTS.RETRY_SENT,
        );
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'The owning-Domain command failed.',
        );
      } finally {
        setPendingAction(null);
      }
    },
    [
      selected,
      scope,
      detail.data,
      sourcesWriteClient,
      askClient,
      externalActionClient,
      refreshAfterDomainCommand,
      announce,
    ],
  );

  const selectedKey = selected ? `${selected.domainKind}:${selected.activityId}` : null;

  // Deterministic focus (AC-15): after a queue selection or a valid deep-link
  // restore, move focus to the Detail heading once the Detail has loaded. The
  // heading is programmatically focusable (`tabIndex={-1}`) and focus moves
  // exactly once per selection.
  useEffect(() => {
    if (detail.data && selectedKey && focusedSelectionKey.current !== selectedKey) {
      focusedSelectionKey.current = selectedKey;
      detailHeadingRef.current?.focus();
    }
  }, [detail.data, selectedKey]);

  return (
    <div className="workspace-layout activity-layout">
      <p className="visually-hidden" role="status" aria-live="polite" ref={liveRegionRef} />
      <aside className="activity-queue" aria-label="활동 큐">
        <header className="activity-queue-header">
          <h1>Activity</h1>
          <div className="activity-queue-actions">
            <label className="activity-polling-toggle">
              <input
                type="checkbox"
                checked={state.pollingEnabled}
                onChange={(event) =>
                  dispatch({ type: 'SET_POLLING', enabled: event.target.checked })
                }
              />
              자동 새로고침
            </label>
            <button
              type="button"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || scope === null}
            >
              {refresh.isPending ? '새로고침 중…' : '새로고침'}
            </button>
          </div>
          {!state.pollingEnabled ? (
            <p className="activity-polling-note">{POLL_DISABLED_REASON}</p>
          ) : null}
        </header>

        <QueueFilters
          domainKinds={state.domainKinds}
          states={state.states}
          attention={state.attention}
          onToggleDomainKind={(domainKind) => {
            dispatch({ type: 'TOGGLE_DOMAIN_KIND', domainKind });
            announce(ACTIVITY_ANNOUNCEMENTS.FILTER_CHANGED);
          }}
          onToggleState={(activityState) => {
            dispatch({ type: 'TOGGLE_STATE', state: activityState });
            announce(ACTIVITY_ANNOUNCEMENTS.FILTER_CHANGED);
          }}
          onSetAttention={(attention) => {
            dispatch({ type: 'SET_ATTENTION', attention });
            announce(ACTIVITY_ANNOUNCEMENTS.FILTER_CHANGED);
          }}
        />

        {queue.data ? <ProjectionMetadata metadata={queue.data.metadata} /> : null}

        {queue.isPending ? (
          <LoadingState message="활동 큐를 불러오는 중…" />
        ) : queue.isError ? (
          <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
        ) : queue.data && queue.data.items.length === 0 ? (
          <EmptyState title="활동 없음" description="표시할 활동이 없습니다." />
        ) : queue.data ? (
          <QueueList items={queue.data.items} selectedKey={selectedKey} onSelect={selectItem} />
        ) : null}
      </aside>

      <main className="activity-detail" aria-label="활동 상세">
        {selected === null ? (
          <EmptyState
            title="활동을 선택하세요"
            description="Select work to see its status and available actions."
          />
        ) : detail.isPending ? (
          <LoadingState message="활동 세부 정보를 불러오는 중…" />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : detail.data ? (
          <DetailSection
            detail={detail.data}
            additionalStages={stages.data?.stages ?? []}
            additionalEvents={events.data?.events ?? []}
            headingRef={detailHeadingRef}
            onAction={(action) => void runDomainAction(action)}
            actionPending={pendingAction}
            actionError={actionError}
          />
        ) : null}
      </main>
    </div>
  );
};
