import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendReviewClient,
  frontendReviewRecordDecisionsDigest,
  type GlobalShellView,
  type ReviewAggregateStateV1,
  type ReviewDecisionIntentV1,
  type ReviewFailureReasonV1,
  type ReviewQueueItemV1,
  type ReviewTargetKindV1,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import {
  reviewContextQueryOptions,
  reviewItemDetailQueryOptions,
  reviewQueueQueryOptions,
  reviewScopeFromShellOrNull,
} from '../knowledge/review-queries.js';
import {
  REVIEW_ANNOUNCEMENTS,
  aggregateAnnouncement,
  createInitialReviewWorkspaceState,
  reduceReviewWorkspaceState,
} from '../knowledge/review-workspace-state.js';
import { reviewContextIdForResource } from '../knowledge/review-route-identity.js';

/**
 * FE-P4-S1 Review Center Workspace (`/review`, guarded).
 *
 * Bounded, accessible Review queue and Item-level decision workspace. The
 * Browser owns only selection, focus and unsent decision input (ADR-119).
 * The server derives aggregate state, dependency closure, capabilities,
 * Approval purpose and recovery. No Canonical commit, Directive apply or
 * External Action execution endpoint is reachable from this workspace.
 */

const TARGET_KIND_LABELS: Record<ReviewTargetKindV1, string> = {
  KNOWLEDGE_DRAFT_CHANGE_SET: '지식 초안 변경 집합',
  DISCOVERY_CANDIDATE: '발견 후보',
  USER_DIRECTIVE_PROPOSAL: '사용자 지시 제안',
};

const INTENT_LABELS: Record<ReviewDecisionIntentV1, string> = {
  APPROVE: '승인',
  REJECT: '거절',
  REQUEST_REVISION: '수정 요청',
  HOLD: '보류',
};

const INTENT_TERMINAL: Record<ReviewDecisionIntentV1, boolean> = {
  APPROVE: true,
  REJECT: true,
  REQUEST_REVISION: true,
  HOLD: false,
};

const freshRequestId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const aggregateCue = (state: ReviewAggregateStateV1): string => {
  switch (state) {
    case 'APPROVED_READY':
    case 'ACCEPTED_FOR_AUTHORING':
      return '완료';
    case 'REJECTED':
    case 'ACCESS_RESTRICTED':
    case 'UNAVAILABLE':
      return '차단';
    case 'STALE':
      return '변경됨';
    case 'ON_HOLD':
    case 'REVISION_REQUESTED':
      return '보류';
    case 'PARTIALLY_DECIDED':
      return '일부 결정됨';
    case 'PENDING':
      return '대기';
  }
  return '대기';
};

const statusLabel = (state: ReviewAggregateStateV1): string =>
  `${aggregateCue(state)} · ${aggregateAnnouncement(state)}`;

export const ReviewWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const reviewClient = useMemo(() => createFrontendReviewClient(), []);
  const [searchParameters] = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceReviewWorkspaceState,
    undefined,
    createInitialReviewWorkspaceState,
  );
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);
  const [filters, setFilters] = useState<{
    targetKind: ReviewTargetKindV1 | 'ALL';
    aggregateState: ReviewAggregateStateV1 | 'ALL';
  }>({ targetKind: 'ALL', aggregateState: 'ALL' });
  const [manualContext, setManualContext] = useState<Awaited<
    ReturnType<ReturnType<typeof createFrontendReviewClient>['getReviewContext']>
  > | null>(null);

  const scope = reviewScopeFromShellOrNull(shell);
  const explicitDeepLinkContext = searchParameters.get('context');
  const explicitDeepLinkRevision = searchParameters.get('revision');
  const deepLinkReviewResourceId = searchParameters.get('reviewResourceId')?.trim() || null;
  const deepLinkContext =
    explicitDeepLinkContext ??
    (deepLinkReviewResourceId
      ? reviewContextIdForResource('DISCOVERY_CANDIDATE', deepLinkReviewResourceId)
      : null);
  const parsedExplicitDeepLinkRevision = explicitDeepLinkRevision
    ? Number(explicitDeepLinkRevision)
    : undefined;
  const validExplicitDeepLinkRevision =
    parsedExplicitDeepLinkRevision !== undefined &&
    Number.isSafeInteger(parsedExplicitDeepLinkRevision) &&
    parsedExplicitDeepLinkRevision > 0
      ? parsedExplicitDeepLinkRevision
      : undefined;

  const queueRequest = useMemo(
    () => ({
      schemaVersion: '1.0.0' as const,
      pageSize: 50,
      ...(filters.targetKind === 'ALL' ? {} : { targetKinds: [filters.targetKind] }),
      ...(filters.aggregateState === 'ALL' ? {} : { aggregateStates: [filters.aggregateState] }),
    }),
    [filters.targetKind, filters.aggregateState],
  );

  const queue = useQuery(reviewQueueQueryOptions(reviewClient, scope, queueRequest));
  const queuedDeepLinkRevision =
    deepLinkReviewResourceId && deepLinkContext && queue.data
      ? queue.data.items.find((item) => item.reviewContextId === deepLinkContext)?.contextRevision
      : undefined;
  const deepLinkRevision =
    validExplicitDeepLinkRevision ??
    (deepLinkReviewResourceId ? queuedDeepLinkRevision : undefined);

  const announce = (message: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  };

  // Deep-link restore (AC-17): select the context carried in the URL.
  useEffect(() => {
    if (!deepLinkContext || !deepLinkRevision) return;
    if (state.selectedContextId === deepLinkContext && state.contextRevision === deepLinkRevision)
      return;
    dispatch({
      type: 'SELECT_CONTEXT',
      reviewContextId: deepLinkContext,
      contextRevision: deepLinkRevision,
    });
    dispatch({ type: 'RECOVERY_STARTED' });
  }, [deepLinkContext, deepLinkRevision, state.selectedContextId, state.contextRevision]);

  useEffect(() => {
    if (queue.isPending) {
      dispatch({ type: 'QUEUE_STARTED' });
      return;
    }
    if (queue.isError) {
      dispatch({
        type: 'FAILED',
        reason: 'NETWORK_FAILURE',
        message:
          queue.error instanceof Error ? queue.error.message : '검토 대기열을 불러오지 못했습니다.',
        retryable: true,
      });
      return;
    }
    if (queue.data) {
      dispatch({ type: 'QUEUE_RESOLVED' });
    }
  }, [queue.isPending, queue.isError, queue.data, queue.error]);

  const contextRequest = useMemo(
    () =>
      state.selectedContextId && state.contextRevision
        ? {
            schemaVersion: '1.0.0' as const,
            reviewContextId: state.selectedContextId,
            contextRevision: state.contextRevision,
          }
        : null,
    [state.selectedContextId, state.contextRevision],
  );

  const contextScope = contextRequest ? scope : null;
  const contextQuery = useQuery(
    reviewContextQueryOptions(
      reviewClient,
      contextScope,
      contextRequest ?? {
        schemaVersion: '1.0.0',
        reviewContextId: 'disabled',
        contextRevision: 1,
      },
    ),
  );
  const currentContext = manualContext ?? contextQuery.data;

  useEffect(() => {
    if (!contextRequest) return;
    if (contextQuery.isPending) {
      dispatch({ type: 'CONTEXT_STARTED' });
      return;
    }
    if (contextQuery.isError) {
      dispatch({
        type: 'FAILED',
        reason: 'NETWORK_FAILURE',
        message:
          contextQuery.error instanceof Error
            ? contextQuery.error.message
            : '검토 대상을 불러오지 못했습니다.',
        retryable: true,
      });
      return;
    }
    if (contextQuery.data) {
      dispatch({ type: 'CONTEXT_RESOLVED' });
      const item = contextQuery.data.context.items[0];
      if (item && state.selectedItemId === null) {
        dispatch({ type: 'SELECT_ITEM', reviewItemId: item.reviewItemId });
      }
    }
  }, [
    contextQuery.isPending,
    contextQuery.isError,
    contextQuery.data,
    contextQuery.error,
    contextRequest,
    state.selectedItemId,
  ]);

  const itemScope = contextRequest && state.selectedItemId ? scope : null;
  const selectedItemDetail = useQuery(
    reviewItemDetailQueryOptions(
      reviewClient,
      itemScope,
      contextRequest && state.selectedItemId
        ? {
            schemaVersion: '1.0.0',
            reviewContextId: contextRequest.reviewContextId,
            contextRevision: contextRequest.contextRevision,
            reviewItemId: state.selectedItemId,
            includeEvidence: true,
            includeImpact: true,
          }
        : {
            schemaVersion: '1.0.0',
            reviewContextId: 'disabled',
            contextRevision: 1,
            reviewItemId: 'disabled',
          },
    ),
  );

  const selectContext = useCallback(
    (item: ReviewQueueItemV1) => {
      dispatch({
        type: 'SELECT_CONTEXT',
        reviewContextId: item.reviewContextId,
        contextRevision: item.contextRevision,
      });
      announce(REVIEW_ANNOUNCEMENTS.CONTEXT_SELECTED(item.targetLabel));
    },
    [announce],
  );

  const handleDecisionFailure = useCallback(
    (
      error: unknown,
      request: {
        clientRequestId: string;
        idempotencyKey: string;
        reviewContextId: string;
        expectedContextRevision: number;
        expectedTargetRevision: string;
        expectedTargetDigest: string;
        itemDecisions: readonly {
          reviewItemId: string;
          intent: ReviewDecisionIntentV1;
          reason?: string;
        }[];
      },
      semanticDigest: string,
      intent: ReviewDecisionIntentV1,
    ) => {
      const failure = error as { code?: string; category?: string; retryability?: string };
      if (failure?.category === 'OUTCOME_UNKNOWN' || failure?.code === 'OUTCOME_INDETERMINATE') {
        dispatch({
          type: 'OUTCOME_UNKNOWN',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          semanticDigest,
        });
        announce(REVIEW_ANNOUNCEMENTS.OUTCOME_UNKNOWN);
        return;
      }
      const reason: ReviewFailureReasonV1 | 'NETWORK_FAILURE' =
        failure?.code && (failure.code as string).startsWith('REVIEW_')
          ? (failure.code as ReviewFailureReasonV1)
          : 'NETWORK_FAILURE';
      dispatch({
        type: 'FAILED',
        reason,
        message:
          error instanceof Error
            ? error.message
            : `결정을 기록하지 못했습니다: ${INTENT_LABELS[intent]}`,
        retryable: failure?.retryability === 'SAFE' || failure?.retryability === 'CONDITIONAL',
      });
      announce(REVIEW_ANNOUNCEMENTS.DECISION_REJECTED);
    },
    [announce],
  );

  const decide = useCallback(
    async (intent: ReviewDecisionIntentV1, reason: string, itemId: string) => {
      if (!currentContext || !contextRequest) return;
      const request = {
        schemaVersion: '1.0.0' as const,
        clientRequestId: freshRequestId('review-decide'),
        idempotencyKey: freshRequestId('idem'),
        reviewContextId: currentContext.context.reviewContextId,
        expectedContextRevision: currentContext.context.contextRevision,
        expectedTargetRevision: currentContext.context.targetRevision,
        expectedTargetDigest: currentContext.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0' as const,
            reviewItemId: itemId,
            intent,
            ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
          },
        ],
      };
      const semanticDigest = frontendReviewRecordDecisionsDigest(request);
      dispatch({ type: 'DECISION_STARTED' });
      try {
        const result = await reviewClient.recordReviewDecisions(request);
        dispatch({ type: 'DECISION_RESOLVED' });
        announce(
          `${REVIEW_ANNOUNCEMENTS.DECISION_RECORDED(intent)} ${
            result.acceptedForAuthoring
              ? REVIEW_ANNOUNCEMENTS.ACCEPTED_FOR_AUTHORING
              : result.approvals?.[0]
                ? REVIEW_ANNOUNCEMENTS.APPROVAL_ISSUED(result.approvals[0].purpose)
                : result.revisionRequestReturnTarget
                  ? REVIEW_ANNOUNCEMENTS.REVISION_RETURN_TARGET
                  : aggregateAnnouncement(result.aggregateState)
          }`,
        );
        setManualContext({
          schemaVersion: '1.0.0',
          context: {
            ...currentContext.context,
            items: currentContext.context.items.map((item) =>
              item.reviewItemId === itemId
                ? {
                    ...item,
                    decisionState:
                      intent === 'APPROVE'
                        ? 'APPROVED'
                        : intent === 'REJECT'
                          ? 'REJECTED'
                          : intent === 'REQUEST_REVISION'
                            ? 'REVISION_REQUESTED'
                            : 'ON_HOLD',
                  }
                : item,
            ),
            aggregateState: result.aggregateState,
          },
          decisions: [...currentContext.decisions, ...result.decisions],
          comments: currentContext.comments,
        });
        await reviewClient.getReviewContext(contextRequest);
      } catch (error) {
        handleDecisionFailure(error, request, semanticDigest, intent);
      }
    },
    [currentContext, contextRequest, reviewClient, handleDecisionFailure],
  );

  const recoverOutcomeUnknown = useCallback(async () => {
    const phase = state.phase;
    if (phase.kind !== 'OUTCOME_UNKNOWN') return;
    dispatch({ type: 'RECOVERY_STARTED' });
    try {
      const resolved = await reviewClient.resolveCommandOutcome({
        schemaVersion: '1.0.0',
        clientRequestId: phase.clientRequestId,
        idempotencyKey: phase.idempotencyKey,
        semanticDigest: phase.semanticDigest,
      });
      if (resolved.outcome === 'COMPLETED' && resolved.completed) {
        if (resolved.completed.commandType === 'frontend.review.record-decisions.v1') {
          const result = resolved.completed.result;
          announce(
            `${REVIEW_ANNOUNCEMENTS.RECOVERY} ${aggregateAnnouncement(result.aggregateState)}`,
          );
          if (currentContext) {
            setManualContext({
              schemaVersion: '1.0.0',
              context: {
                ...currentContext.context,
                items: currentContext.context.items.map((item) =>
                  item.decisionState === 'PENDING' &&
                  result.decisions.some((d) => d.reviewItemId === item.reviewItemId)
                    ? {
                        ...item,
                        decisionState:
                          result.decisions.find((d) => d.reviewItemId === item.reviewItemId)
                            ?.intent === 'APPROVE'
                            ? 'APPROVED'
                            : result.decisions.find((d) => d.reviewItemId === item.reviewItemId)
                                  ?.intent === 'REJECT'
                              ? 'REJECTED'
                              : result.decisions.find((d) => d.reviewItemId === item.reviewItemId)
                                    ?.intent === 'REQUEST_REVISION'
                                ? 'REVISION_REQUESTED'
                                : 'ON_HOLD',
                      }
                    : item,
                ),
                aggregateState: result.aggregateState,
              },
              decisions: [...currentContext.decisions, ...result.decisions],
              comments: currentContext.comments,
            });
          }
        }
        dispatch({ type: 'DECISION_RESOLVED' });
      } else {
        announce(REVIEW_ANNOUNCEMENTS.OUTCOME_UNKNOWN);
        dispatch({ type: 'RECOVERY_FINISHED' });
      }
    } catch {
      announce(REVIEW_ANNOUNCEMENTS.OUTCOME_UNKNOWN);
      dispatch({ type: 'RECOVERY_FINISHED' });
    }
  }, [state.phase, reviewClient, announce, currentContext]);

  if (!shell.activeProject) {
    return <EmptyState title="Review를 열려면 먼저 프로젝트를 만들어 주세요." />;
  }

  return (
    <section aria-label="Review Center">
      <h1 id="review-workspace-title" tabIndex={-1}>
        Review Center
      </h1>
      <p className="visually-hidden" role="status" aria-live="polite" ref={liveRegionRef} />

      {state.phase.kind === 'QUEUE_LOADING' || state.phase.kind === 'IDLE' ? (
        <LoadingState message="검토 대기열을 불러오는 중입니다." />
      ) : null}
      {state.phase.kind === 'FAILED' ? (
        <ErrorState
          error={new Error(state.phase.message)}
          onRetry={state.phase.retryable ? () => void queue.refetch() : undefined}
        />
      ) : null}

      <div className="review-layout">
        <aside className="review-queue" aria-label="검토 대기열">
          <h2>검토 대기열</h2>
          <div className="review-filters">
            <label>
              대상 유형
              <select
                value={filters.targetKind}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    targetKind: event.target.value as ReviewTargetKindV1 | 'ALL',
                  }))
                }
              >
                <option value="ALL">전체</option>
                {(Object.keys(TARGET_KIND_LABELS) as ReviewTargetKindV1[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {TARGET_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {queue.data?.items.length === 0 ? (
            <p role="status">검토 대기열이 비어 있습니다.</p>
          ) : (
            <ul>
              {queue.data?.items.map((item) => (
                <li key={item.reviewContextId}>
                  <button
                    type="button"
                    className={
                      state.selectedContextId === item.reviewContextId ? 'selected' : undefined
                    }
                    onClick={() => selectContext(item)}
                    aria-pressed={state.selectedContextId === item.reviewContextId}
                  >
                    <span className="review-target-label">{item.targetLabel}</span>
                    <span className="review-status" data-aggregate={item.aggregateState}>
                      {statusLabel(item.aggregateState)}
                    </span>
                    <span>항목 {item.itemCount}개</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {queue.data?.nextCursor ? (
            <p role="status">결과가 더 있습니다. 필터를 좁혀서 확인하세요.</p>
          ) : null}
        </aside>

        <main className="review-context" aria-label="검토 상세">
          {!currentContext ? (
            <p className="status-message" role="status">
              대기열에서 검토 대상을 선택하세요.
            </p>
          ) : (
            <ReviewContextDetail
              currentContext={currentContext}
              selectedItemId={state.selectedItemId}
              drafts={state.drafts}
              comment={state.comment}
              contextRequest={contextRequest!}
              scope={scope}
              reviewClient={reviewClient}
              onSelectItem={(reviewItemId) => {
                dispatch({ type: 'SELECT_ITEM', reviewItemId });
                const item = currentContext.context.items.find(
                  (candidate) => candidate.reviewItemId === reviewItemId,
                );
                if (item) announce(REVIEW_ANNOUNCEMENTS.ITEM_SELECTED(item.label));
              }}
              onSetDraft={(reviewItemId, intent, reason) =>
                dispatch({ type: 'SET_DRAFT', reviewItemId, intent, reason })
              }
              onSetComment={(comment) => dispatch({ type: 'SET_COMMENT', comment })}
              onDecide={decide}
              onRecover={recoverOutcomeUnknown}
              outcomePhase={state.phase}
              selectedItemDetail={selectedItemDetail}
            />
          )}
        </main>
      </div>
    </section>
  );
};

type ReviewContextDetailProps = {
  readonly currentContext: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createFrontendReviewClient>['getReviewContext']>>
  >;
  readonly selectedItemId: string | null;
  readonly drafts: Readonly<Record<string, { intent: ReviewDecisionIntentV1; reason: string }>>;
  readonly comment: string;
  readonly contextRequest: {
    reviewContextId: string;
    contextRevision: number;
  };
  readonly scope: ReturnType<typeof reviewScopeFromShellOrNull>;
  readonly reviewClient: ReturnType<typeof createFrontendReviewClient>;
  readonly onSelectItem: (reviewItemId: string) => void;
  readonly onSetDraft: (
    reviewItemId: string,
    intent: ReviewDecisionIntentV1,
    reason: string,
  ) => void;
  readonly onSetComment: (comment: string) => void;
  readonly onDecide: (
    intent: ReviewDecisionIntentV1,
    reason: string,
    itemId: string,
  ) => Promise<void>;
  readonly onRecover: () => Promise<void>;
  readonly outcomePhase: { kind: 'OUTCOME_UNKNOWN'; clientRequestId: string } | { kind: string };
  readonly selectedItemDetail: {
    data?: Awaited<
      ReturnType<ReturnType<typeof createFrontendReviewClient>['getReviewItemDetail']>
    >;
    isPending?: boolean;
    isError?: boolean;
  };
};

const ReviewContextDetail = ({
  currentContext,
  selectedItemId,
  drafts,
  comment,
  contextRequest,
  reviewClient,
  onSelectItem,
  onSetDraft,
  onSetComment,
  onDecide,
  onRecover,
  outcomePhase,
  selectedItemDetail,
}: ReviewContextDetailProps) => {
  const context = currentContext.context;
  const stale = context.aggregateState === 'STALE';
  const restricted = context.aggregateState === 'ACCESS_RESTRICTED';
  const unavailable = context.aggregateState === 'UNAVAILABLE';
  const selectedItem = context.items.find((item) => item.reviewItemId === selectedItemId);

  const revalidate = async () => {
    if (!contextRequest) return;
    try {
      const result = await reviewClient.revalidateReviewContext({
        schemaVersion: '1.0.0',
        clientRequestId: freshRequestId('review-revalidate'),
        idempotencyKey: freshRequestId('idem'),
        reviewContextId: contextRequest.reviewContextId,
        contextRevision: contextRequest.contextRevision,
        reason: 'Re-review after target change.',
      });
      // Revalidation returns a new revision; refresh the read path.
      await reviewClient.getReviewContext({
        schemaVersion: '1.0.0',
        reviewContextId: result.context.reviewContextId,
        contextRevision: result.context.contextRevision,
      });
    } catch (error) {
      // The context query will surface the typed failure.
      void error;
    }
  };

  const atomicGroups = useMemo(() => {
    const edges = context.dependencies.filter((dependency) => dependency.kind === 'ATOMIC_WITH');
    const groups: string[][] = [];
    const seen = new Set<string>();
    for (const edge of edges) {
      const key = [edge.fromReviewItemId, edge.toReviewItemId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push([edge.fromReviewItemId, edge.toReviewItemId]);
    }
    return groups;
  }, [context.dependencies]);

  return (
    <>
      <div className="review-context-summary" data-aggregate={context.aggregateState}>
        <h2>검토 대상</h2>
        <p>
          <strong>{TARGET_KIND_LABELS[context.targetKind]}</strong>
        </p>
        <p className="review-status" data-aggregate={context.aggregateState}>
          {statusLabel(context.aggregateState)}
        </p>
        {context.staleReason ? <p className="review-stale-reason">{context.staleReason}</p> : null}
        {stale ? (
          <button type="button" onClick={() => void revalidate()}>
            새 리비전으로 재검증
          </button>
        ) : null}
        {restricted || unavailable ? (
          <p className="status-message" role="status">
            {restricted ? '접근 제한으로 검토할 수 없습니다.' : '검토 정보를 사용할 수 없습니다.'}
          </p>
        ) : null}
        <TechnicalDetails
          items={[
            { label: 'Review context ID', value: context.reviewContextId },
            { label: 'Target ID', value: context.targetId },
            { label: 'Context revision', value: context.contextRevision },
          ]}
        />
      </div>

      <div className="review-items">
        <h2>항목 ({context.items.length}개)</h2>
        <ul>
          {context.items.map((item) => {
            const draft = drafts[item.reviewItemId];
            return (
              <li key={item.reviewItemId}>
                <button
                  type="button"
                  className={selectedItemId === item.reviewItemId ? 'selected' : undefined}
                  onClick={() => onSelectItem(item.reviewItemId)}
                  aria-pressed={selectedItemId === item.reviewItemId}
                >
                  <span className="review-item-label">{item.label}</span>
                  <span className="review-item-status" data-decision-state={item.decisionState}>
                    {item.decisionState === 'PENDING'
                      ? '결정 전'
                      : INTENT_LABELS[itemDecisionIntent(item.decisionState)]}
                    {draft ? ' · 입력 중' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {atomicGroups.length > 0 ? (
          <section aria-label="원자 그룹 설명">
            <h3>함께 승인해야 하는 항목</h3>
            <ul>
              {atomicGroups.map((group, index) => (
                <li key={index}>
                  {group
                    .map(
                      (id) => context.items.find((item) => item.reviewItemId === id)?.label ?? id,
                    )
                    .join(' + ')}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {context.dependencies.filter((dependency) => dependency.kind === 'REQUIRES').length > 0 ? (
          <section aria-label="의존성 설명">
            <h3>의존성</h3>
            <ul>
              {context.dependencies
                .filter((dependency) => dependency.kind === 'REQUIRES')
                .map((dependency) => (
                  <li key={dependency.dependencyId}>{dependency.description}</li>
                ))}
            </ul>
          </section>
        ) : null}
      </div>

      {selectedItem ? (
        <section className="review-item-detail" aria-label="항목 상세">
          <h2>{selectedItem.label}</h2>
          <p>{selectedItem.rationale}</p>
          {selectedItem.before || selectedItem.after ? (
            <div className="review-comparison">
              <div>
                <h3>변경 전</h3>
                <p>{selectedItem.before?.summary ?? '변경 전 없음'}</p>
              </div>
              <div>
                <h3>변경 후</h3>
                <p>{selectedItem.after?.summary ?? '변경 후 없음'}</p>
              </div>
            </div>
          ) : null}
          {selectedItemDetail?.isPending ? (
            <LoadingState message="항목 상세를 불러오는 중입니다." />
          ) : null}
          {selectedItemDetail?.data ? (
            <div className="review-detail-reads">
              {selectedItemDetail.data.evidence && selectedItemDetail.data.evidence.length > 0 ? (
                <section aria-label="근거">
                  <h3>근거</h3>
                  <ul>
                    {selectedItemDetail.data.evidence.map((entry) => (
                      <li key={`${entry.sourceId}:${entry.evidenceSpanId}`}>{entry.snippet}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {selectedItemDetail.data.impact && selectedItemDetail.data.impact.length > 0 ? (
                <section aria-label="영향">
                  <h3>영향</h3>
                  <ul>
                    {selectedItemDetail.data.impact.map((entry) => (
                      <li key={entry.impactId}>{entry.description}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {outcomePhase.kind === 'OUTCOME_UNKNOWN' ? (
        <section aria-label="결과 복구" className="review-recovery">
          <p role="status">{REVIEW_ANNOUNCEMENTS.OUTCOME_UNKNOWN}</p>
          <button type="button" onClick={() => void onRecover()}>
            원래 요청으로 결과 확인
          </button>
        </section>
      ) : null}

      <ReviewDecisionControls
        context={currentContext}
        selectedItemId={selectedItemId}
        drafts={drafts}
        comment={comment}
        onSetDraft={onSetDraft}
        onSetComment={onSetComment}
        onDecide={onDecide}
      />

      <ReviewHistory currentContext={currentContext} />
    </>
  );
};

const itemDecisionIntent = (decisionState: string): ReviewDecisionIntentV1 =>
  decisionState === 'APPROVED'
    ? 'APPROVE'
    : decisionState === 'REJECTED'
      ? 'REJECT'
      : decisionState === 'REVISION_REQUESTED'
        ? 'REQUEST_REVISION'
        : 'HOLD';

type ReviewDecisionControlsProps = {
  readonly context: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createFrontendReviewClient>['getReviewContext']>>
  >;
  readonly selectedItemId: string | null;
  readonly drafts: Readonly<Record<string, { intent: ReviewDecisionIntentV1; reason: string }>>;
  readonly comment: string;
  readonly onSetDraft: (
    reviewItemId: string,
    intent: ReviewDecisionIntentV1,
    reason: string,
  ) => void;
  readonly onSetComment: (comment: string) => void;
  readonly onDecide: (
    intent: ReviewDecisionIntentV1,
    reason: string,
    itemId: string,
  ) => Promise<void>;
};

const ReviewDecisionControls = ({
  context,
  selectedItemId,
  drafts,
  comment,
  onSetDraft,
  onSetComment,
  onDecide,
}: ReviewDecisionControlsProps) => {
  const items = context.context.items;
  const pendingDrafts = Object.entries(drafts);
  const submittingDisabled =
    selectedItemId === null ||
    items.every((item) => item.reviewItemId !== selectedItemId) ||
    context.context.aggregateState === 'STALE' ||
    context.context.aggregateState === 'ACCESS_RESTRICTED' ||
    context.context.aggregateState === 'UNAVAILABLE';

  return (
    <section className="review-decision-controls" aria-label="결정 입력">
      <h2>결정</h2>
      {pendingDrafts.length === 0 ? (
        <p className="status-message" role="status">
          항목을 선택하고 승인·거절·수정 요청·보류를 입력하세요.
        </p>
      ) : null}
      <ul>
        {pendingDrafts.map(([itemId, draft]) => {
          const item = items.find((candidate) => candidate.reviewItemId === itemId);
          if (!item) return null;
          const terminal = INTENT_TERMINAL[draft.intent];
          const canSubmit = !terminal || draft.reason.trim().length > 0;
          return (
            <li key={itemId} className={canSubmit ? undefined : 'review-invalid'}>
              <p>
                <strong>{item.label}</strong> · {INTENT_LABELS[draft.intent]}
              </p>
              <label>
                사유
                <input
                  type="text"
                  value={draft.reason}
                  onChange={(event) => onSetDraft(itemId, draft.intent, event.target.value)}
                  aria-label={`${item.label} 사유`}
                />
              </label>
              {terminal && draft.reason.trim().length === 0 ? (
                <p className="review-invalid-hint">종결 결정에는 사유가 필요합니다.</p>
              ) : null}
              <div className="review-decision-actions">
                <button
                  type="button"
                  disabled={submittingDisabled || !canSubmit}
                  onClick={() => void onDecide(draft.intent, draft.reason, itemId)}
                >
                  {INTENT_LABELS[draft.intent]} 기록
                </button>
                <button type="button" onClick={() => onSetDraft(itemId, draft.intent, '')}>
                  사유 지우기
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <label>
        항목 선택 및 결정 버튼
        <select
          value={selectedItemId ?? ''}
          onChange={(event) => {
            const itemId = event.target.value;
            const item = items.find((candidate) => candidate.reviewItemId === itemId);
            if (item) {
              const current = drafts[itemId];
              onSetDraft(itemId, current?.intent ?? 'HOLD', current?.reason ?? '');
            }
          }}
        >
          <option value="" disabled>
            항목 선택
          </option>
          {items.map((item) => (
            <option key={item.reviewItemId} value={item.reviewItemId}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="review-intent-buttons" role="group" aria-label="결정 종류">
        {(Object.keys(INTENT_LABELS) as ReviewDecisionIntentV1[]).map((intent) => (
          <button
            key={intent}
            type="button"
            data-intent={intent}
            disabled={selectedItemId === null}
            onClick={() => {
              if (!selectedItemId) return;
              const current = drafts[selectedItemId];
              onSetDraft(
                selectedItemId,
                current?.intent === intent ? 'HOLD' : intent,
                current?.reason ?? '',
              );
            }}
          >
            {INTENT_LABELS[intent]}
          </button>
        ))}
      </div>
      <label>
        댓글
        <textarea value={comment} onChange={(event) => onSetComment(event.target.value)} />
      </label>
    </section>
  );
};

const ReviewHistory = ({
  currentContext,
}: {
  readonly currentContext: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createFrontendReviewClient>['getReviewContext']>>
  >;
}) => (
  <section className="review-history" aria-label="결정 및 댓글 이력">
    <h2>이력</h2>
    {currentContext.decisions.length === 0 && currentContext.comments.length === 0 ? (
      <p className="status-message" role="status">
        아직 기록된 결정이나 댓글이 없습니다.
      </p>
    ) : null}
    {currentContext.decisions.length > 0 ? (
      <section aria-label="결정 이력">
        <h3>결정</h3>
        <ul>
          {currentContext.decisions.map((decision) => (
            <li key={decision.decisionId}>
              <span className="review-item-status" data-decision-state={decision.intent}>
                {INTENT_LABELS[decision.intent]}
              </span>{' '}
              ·{' '}
              {currentContext.context.items.find(
                (item) => item.reviewItemId === decision.reviewItemId,
              )?.label ?? 'Review item'}{' '}
              · {decision.reason ?? '사유 없음'}
            </li>
          ))}
        </ul>
      </section>
    ) : null}
    {currentContext.comments.length > 0 ? (
      <section aria-label="댓글 이력">
        <h3>댓글</h3>
        <ul>
          {currentContext.comments.map((record) => (
            <li key={record.commentId}>{record.text}</li>
          ))}
        </ul>
      </section>
    ) : null}
  </section>
);
