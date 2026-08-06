import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendActivityClient,
  type ActivityDetailV1,
  type ActivityProjectionMetadataV1,
  type ActivityQueueItemV1,
  type ActivityRootReferenceV1,
  type GlobalShellView,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
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

const identityFromRoot = (root: ActivityRootReferenceV1): ActivityIdentity => ({
  domainKind: root.domainKind,
  activityId: root.activityId,
  domainResourceKind: root.domainResourceKind,
  domainResourceId: root.domainResourceId,
});

/** Exact Domain Resource deep link to the owning-Domain workspace route. */
const domainWorkspaceHref = (identity: ActivityIdentity): string => {
  if (identity.domainKind === 'EXTERNAL_ACTION') {
    return `/external-action?action=${encodeURIComponent(identity.activityId)}`;
  }
  if (identity.domainKind === 'SOURCES') return '/sources';
  if (identity.domainKind === 'ASK') return '/ask';
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

const adapterStatusLabel: Record<string, string> = {
  AVAILABLE: '사용 가능',
  DEGRADED: '저하됨',
  UNAVAILABLE: '사용 불가',
};

const freshnessLabel: Record<string, string> = {
  CURRENT: '최신',
  LAGGING: '지연 중',
  STALE: '오래됨',
  UNKNOWN: '알 수 없음',
};

const ProjectionMetadata = ({ metadata }: { readonly metadata: ActivityProjectionMetadataV1 }) => (
  <section className="activity-metadata" aria-label="프로젝션 상태">
    <dl className="summary-grid">
      <div>
        <dt>Freshness</dt>
        <dd>{freshnessLabel[metadata.freshness] ?? metadata.freshness}</dd>
      </div>
      <div>
        <dt>Adapter</dt>
        <dd>{adapterStatusLabel[metadata.adapterStatus] ?? metadata.adapterStatus}</dd>
      </div>
      <div>
        <dt>Partial</dt>
        <dd>{metadata.partial ? '부분 결과' : '전체 결과'}</dd>
      </div>
      <div>
        <dt>Snapshot</dt>
        <dd>rev {metadata.snapshotRevision}</dd>
      </div>
      {metadata.lagMilliseconds === undefined ? null : (
        <div>
          <dt>Lag</dt>
          <dd>{metadata.lagMilliseconds} ms</dd>
        </div>
      )}
      <div>
        <dt>Source updated</dt>
        <dd>{new Date(metadata.sourceUpdatedAt).toLocaleTimeString()}</dd>
      </div>
    </dl>
    {metadata.partial ? (
      <p className="activity-partial-note" role="status">
        일부 adapter 결과만 반영된 부분 프로젝션입니다.
      </p>
    ) : null}
  </section>
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
            <span className="activity-item-summary">{item.summary}</span>
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

const DetailSection = ({ detail }: { readonly detail: ActivityDetailV1 }) => {
  const identity = identityFromRoot(detail.root);
  const resourceHref = detail.root.resourceHref;
  return (
    <section className="activity-detail" aria-label={`활동 세부 정보 ${detail.root.activityId}`}>
      <header className="activity-detail-header">
        <h2>{detail.root.activityId}</h2>
        <p className="activity-detail-domain">
          {activityDomainKindLabel[identity.domainKind]} ·{' '}
          {detail.root.rootKind === 'RUN' ? 'Run root' : 'Job root'}
        </p>
        <p>
          <Link to={domainWorkspaceHref(identity)} className="activity-domain-link">
            도메인 워크스페이스에서 열기
          </Link>
        </p>
        <p className="activity-resource-href">정확한 도메인 리소스: {resourceHref}</p>
      </header>

      <dl className="summary-grid">
        <div>
          <dt>State</dt>
          <dd>{activityLifecycleStateLabel[detail.run.state]}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>{detail.run.runId}</dd>
        </div>
        <div>
          <dt>Sequence</dt>
          <dd>{detail.run.sequence}</dd>
        </div>
        {detail.run.jobId === undefined ? null : (
          <div>
            <dt>Job</dt>
            <dd>{detail.run.jobId}</dd>
          </div>
        )}
      </dl>

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
  const detail = useQuery(activityDetailQueryOptions(activityClient, scope, selected));

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

  const selectedKey = selected ? `${selected.domainKind}:${selected.activityId}` : null;

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
            description="큐에서 활동을 선택하면 Job/Run, Attempt, Stage, Event 계보를 표시합니다."
          />
        ) : detail.isPending ? (
          <LoadingState message="활동 세부 정보를 불러오는 중…" />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : detail.data ? (
          <>
            <DetailSection detail={detail.data} />
            <section className="activity-continuations" aria-label="추가 Stage와 Event">
              <h3>추가 Stages</h3>
              {stages.data && stages.data.stages.length > 0 ? (
                <ol className="activity-events" aria-label="추가 Stages">
                  {stages.data.stages.map((stage) => (
                    <li key={stage.stageId}>
                      <span>{stage.stageKey}</span> — <span>{stage.label}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="추가 Stage 없음" />
              )}
              <h3>추가 Events</h3>
              {events.data && events.data.events.length > 0 ? (
                <ol className="activity-events" aria-label="추가 Events">
                  {events.data.events.map((event) => (
                    <li key={event.eventId}>
                      <span className="activity-event-category" data-category={event.category}>
                        {event.category}
                      </span>{' '}
                      <span>{event.summary}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="추가 Event 없음" />
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
};
