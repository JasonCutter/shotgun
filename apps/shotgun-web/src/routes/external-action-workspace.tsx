import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendExternalActionClient,
  frontendExternalActionCompensationDigest,
  frontendExternalActionRollbackDigest,
  type ExternalActionFailureReasonV1,
  type GlobalShellView,
} from '@shotgun/api-client';

import { EmptyState } from '../components/empty-state.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { externalActionScopeFromShell } from '../app/query-keys.js';
import {
  externalActionApprovalQueryOptions,
  externalActionAttemptsQueryOptions,
  externalActionAuditQueryOptions,
  externalActionDetailQueryOptions,
  externalActionExecutionQueryOptions,
  externalActionManifestQueryOptions,
  externalActionPreflightQueryOptions,
  externalActionQueueQueryOptions,
  externalActionResultQueryOptions,
  externalActionRiskDecisionQueryOptions,
  externalActionSnapshotQueryOptions,
  externalActionVerificationQueryOptions,
} from '../external-action/external-action-queries.js';
import {
  EXTERNAL_ACTION_ANNOUNCEMENTS,
  createInitialExternalActionWorkspaceState,
  externalActionAggregateCue,
  externalActionCommandSurfaces,
  reduceExternalActionWorkspaceState,
  type ExternalActionCommandKind,
} from '../external-action/external-action-workspace-state.js';
import {
  externalActionDeepLinkHref,
  parseExternalActionDeepLink,
} from '../external-action/external-action-route-contract.js';

/**
 * FE-P4-S2 WP5 External Action Governance Workspace (`/external-action`,
 * guarded).
 *
 * Reachable from Home/Command Palette navigation only — high-risk External
 * Actions are NEVER executed from Home (AC-18). The workspace provides bounded
 * queue, aggregate detail (with safe masking and access-loss restricted shell),
 * risk/manifest/preflight/execution-attempt/verification/result/audit/approval
 * reads, Cancel (abort only), separate Rollback and governed Compensating
 * Action surfaces (explicitly non-automatic), and `OUTCOME_UNKNOWN` recovery by
 * the ORIGINAL command identity (never a re-execute button). Browser owns only
 * selection, focus and unsent command input (ADR-119).
 */

const freshRequestId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const failureReasonLabel = (reason: ExternalActionFailureReasonV1): string => {
  switch (reason) {
    case 'EXTERNAL_ACTION_STALE':
    case 'ACTION_MANIFEST_CHANGED':
    case 'EXTERNAL_TARGET_CHANGED':
      return EXTERNAL_ACTION_ANNOUNCEMENTS.STALE;
    case 'ACTION_APPROVAL_EXPIRED':
    case 'ACTION_APPROVAL_INVALID':
      return '승인이 만료되었거나 유효하지 않습니다. 재승인이 필요합니다.';
    case 'ACTION_PREFLIGHT_FAILED':
      return '사전 점검이 실패했습니다.';
    case 'ACTION_VERIFICATION_MISMATCH':
      return '외부 상태가 기대한 상태와 일치하지 않습니다.';
    default:
      return '외부 액션 명령이 거부되었습니다.';
  }
};

export const ExternalActionWorkspace = () => {
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const externalActionClient = useMemo(() => createFrontendExternalActionClient(), []);
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [state, dispatch] = useReducer(
    reduceExternalActionWorkspaceState,
    undefined,
    createInitialExternalActionWorkspaceState,
  );
  const liveRegionRef = useRef<HTMLParagraphElement | null>(null);
  const lastCommandRef = useRef<{
    clientRequestId: string;
    idempotencyKey: string;
    semanticDigest: string;
  } | null>(null);

  const scope = externalActionScopeFromShell(shell);
  const deepLink = useMemo(() => parseExternalActionDeepLink(searchParameters), [searchParameters]);

  const announce = useCallback((message: string) => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  }, []);

  const queueRequest = useMemo(() => ({ schemaVersion: '1.0.0' as const, pageSize: 50 }), []);
  const queue = useQuery(
    externalActionQueueQueryOptions(externalActionClient, scope, queueRequest),
  );

  // ------------------------------------------------------------------
  // Deep-link restore (contract §10.5): restore selection + preserve focus.
  // ------------------------------------------------------------------
  const deepLinkActionId = deepLink.actionId;
  const snapshot = useQuery(
    externalActionSnapshotQueryOptions(externalActionClient, scope, deepLinkActionId),
  );

  useEffect(() => {
    if (!deepLinkActionId) return;
    if (!snapshot.data) return;
    const action = snapshot.data.action;
    if (action.actionId !== deepLinkActionId) return;
    if (
      state.selectedActionId === action.actionId &&
      state.actionRevision === action.actionRevision
    ) {
      return;
    }
    dispatch({
      type: 'SELECT_ACTION',
      actionId: action.actionId,
      actionRevision: action.actionRevision,
      externalRevision: '',
    });
    dispatch({ type: 'RECOVERY_STARTED' });
    if (deepLink.executionId)
      dispatch({ type: 'SELECT_EXECUTION', executionId: deepLink.executionId });
    if (deepLink.attemptId) dispatch({ type: 'SELECT_ATTEMPT', attemptId: deepLink.attemptId });
    if (deepLink.verificationId) {
      dispatch({ type: 'SELECT_VERIFICATION', verificationId: deepLink.verificationId });
    }
    if (deepLink.focus) {
      dispatch({ type: 'FOCUS', target: deepLink.focus });
    }
  }, [
    deepLinkActionId,
    snapshot.data,
    state.selectedActionId,
    state.actionRevision,
    deepLink.executionId,
    deepLink.attemptId,
    deepLink.verificationId,
    deepLink.focus,
  ]);

  // Queue phase wiring.
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
          queue.error instanceof Error
            ? queue.error.message
            : '외부 액션 대기열을 불러오지 못했습니다.',
        retryable: true,
      });
      return;
    }
    if (queue.data) {
      dispatch({ type: 'QUEUE_RESOLVED' });
      announce(EXTERNAL_ACTION_ANNOUNCEMENTS.QUEUE_READY(queue.data.items.length));
    }
  }, [queue.isPending, queue.isError, queue.data, queue.error, announce]);

  // Detail identity from the selected queue item or deep-link snapshot. The
  // actionRevision binds the detail read; the external revision is learned from
  // the detail payload (manifest) and then binds every child read so cache
  // isolation holds across action revision AND external revision (WP5).
  // Memoized so the phase effects never observe a fresh object identity (which
  // would re-dispatch and loop).
  const identity = useMemo(
    () =>
      state.selectedActionId && state.actionRevision !== null
        ? {
            actionId: state.selectedActionId,
            actionRevision: state.actionRevision,
            externalRevision: '',
          }
        : null,
    [state.selectedActionId, state.actionRevision],
  );

  const detail = useQuery(externalActionDetailQueryOptions(externalActionClient, scope, identity));
  const knownExternalRevision =
    detail.data?.manifest?.externalRevision ?? state.externalRevision ?? '';
  const childIdentity = useMemo(
    () =>
      state.selectedActionId && state.actionRevision !== null
        ? {
            actionId: state.selectedActionId,
            actionRevision: state.actionRevision,
            externalRevision: knownExternalRevision,
          }
        : null,
    [state.selectedActionId, state.actionRevision, knownExternalRevision],
  );

  const manifest = useQuery(
    externalActionManifestQueryOptions(externalActionClient, scope, childIdentity),
  );
  const riskDecision = useQuery(
    externalActionRiskDecisionQueryOptions(externalActionClient, scope, childIdentity),
  );
  const preflight = useQuery(
    externalActionPreflightQueryOptions(externalActionClient, scope, childIdentity),
  );
  const execution = useQuery(
    externalActionExecutionQueryOptions(externalActionClient, scope, childIdentity),
  );
  const attempts = useQuery(
    externalActionAttemptsQueryOptions(externalActionClient, scope, childIdentity),
  );
  const verification = useQuery(
    externalActionVerificationQueryOptions(externalActionClient, scope, childIdentity),
  );
  const result = useQuery(
    externalActionResultQueryOptions(externalActionClient, scope, childIdentity),
  );
  const audit = useQuery(
    externalActionAuditQueryOptions(externalActionClient, scope, childIdentity),
  );
  const approval = useQuery(
    externalActionApprovalQueryOptions(externalActionClient, scope, childIdentity),
  );

  useEffect(() => {
    if (!identity) return;
    if (detail.isPending) {
      dispatch({ type: 'DETAIL_STARTED' });
      return;
    }
    if (detail.isError) {
      dispatch({
        type: 'FAILED',
        reason: 'NETWORK_FAILURE',
        message:
          detail.error instanceof Error
            ? detail.error.message
            : '외부 액션 상세를 불러오지 못했습니다.',
        retryable: true,
      });
      return;
    }
    if (detail.data) {
      dispatch({ type: 'DETAIL_RESOLVED' });
      announce(EXTERNAL_ACTION_ANNOUNCEMENTS.DETAIL_READY);
      if (detail.data.action.aggregateState === 'ACCESS_RESTRICTED') {
        announce(EXTERNAL_ACTION_ANNOUNCEMENTS.ACCESS_RESTRICTED);
      }
    }
  }, [identity, detail.isPending, detail.isError, detail.data, detail.error, announce]);

  const selectAction = useCallback(
    (actionId: string, actionRevision: number) => {
      dispatch({ type: 'SELECT_ACTION', actionId, actionRevision, externalRevision: '' });
      setSearchParameters(externalActionDeepLinkHref({ actionId }));
      announce(EXTERNAL_ACTION_ANNOUNCEMENTS.ACTION_SELECTED(actionId));
    },
    [setSearchParameters, announce],
  );

  const surfaces = detail.data
    ? externalActionCommandSurfaces(detail.data.action.status)
    : {
        canCancel: false,
        canRollback: false,
        canPrepareCompensation: false,
        canExecute: false,
        canVerify: false,
        canRetry: false,
      };

  const submitCommand = useCallback(
    async (command: ExternalActionCommandKind) => {
      if (!identity || !detail.data) return;
      const action = detail.data.action;
      const clientRequestId = freshRequestId('external-action');
      const idempotencyKey = freshRequestId('external-action-idem');
      const reason =
        state.draft?.command === command ? state.draft.reason : 'Governed workspace request.';
      try {
        if (command === 'CANCEL') {
          const request = {
            schemaVersion: '1.0.0' as const,
            clientRequestId,
            idempotencyKey,
            actionId: action.actionId,
            expectedActionRevision: action.actionRevision,
            reason,
          };
          const resolved = await externalActionClient.cancelExternalAction(request);
          lastCommandRef.current = { clientRequestId, idempotencyKey, semanticDigest: '' };
          dispatch({ type: 'COMMAND_STARTED' });
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.CANCEL_REQUESTED);
          if (resolved.status === 'CANCELLED') {
            // Abort only — no external reversal is implied (contract §9).
          }
        } else if (command === 'ROLLBACK') {
          const executionId =
            state.selectedExecutionId ?? action.latestExecutionRef?.resourceId ?? '';
          const request = {
            schemaVersion: '1.0.0' as const,
            clientRequestId,
            idempotencyKey,
            actionId: action.actionId,
            executionId,
            reason,
          };
          const digest = frontendExternalActionRollbackDigest(request);
          lastCommandRef.current = { clientRequestId, idempotencyKey, semanticDigest: digest };
          dispatch({ type: 'COMMAND_STARTED' });
          await externalActionClient.rollbackExternalAction(request);
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.ROLLBACK_REQUESTED);
        } else if (command === 'PREPARE_COMPENSATION') {
          const executionId =
            state.selectedExecutionId ?? action.latestExecutionRef?.resourceId ?? '';
          const request = {
            schemaVersion: '1.0.0' as const,
            clientRequestId,
            idempotencyKey,
            sourceActionId: action.actionId,
            sourceExecutionId: executionId,
            reason,
          };
          const digest = frontendExternalActionCompensationDigest(request);
          lastCommandRef.current = { clientRequestId, idempotencyKey, semanticDigest: digest };
          dispatch({ type: 'COMMAND_STARTED' });
          await externalActionClient.prepareCompensatingAction(request);
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.COMPENSATION_REQUESTED);
        }
      } catch (error) {
        const failure = error as {
          code?: string;
          category?: string;
          message?: string;
        };
        if (
          failure?.category === 'OUTCOME_UNKNOWN' ||
          failure?.code === 'ACTION_OUTCOME_UNKNOWN' ||
          failure?.code === 'OUTCOME_INDETERMINATE'
        ) {
          const last = lastCommandRef.current;
          if (last) {
            dispatch({
              type: 'OUTCOME_UNKNOWN',
              clientRequestId: last.clientRequestId,
              idempotencyKey: last.idempotencyKey,
              semanticDigest: last.semanticDigest,
            });
            announce(EXTERNAL_ACTION_ANNOUNCEMENTS.OUTCOME_UNKNOWN);
            return;
          }
        }
        dispatch({
          type: 'FAILED',
          reason: 'NETWORK_FAILURE',
          message: failure?.message ?? EXTERNAL_ACTION_ANNOUNCEMENTS.COMMAND_REJECTED,
          retryable: false,
        });
        announce(EXTERNAL_ACTION_ANNOUNCEMENTS.COMMAND_REJECTED);
      }
    },
    [identity, detail.data, state.draft, state.selectedExecutionId, externalActionClient, announce],
  );

  const resolveOutcome = useCallback(async () => {
    const phase = state.phase;
    if (phase.kind !== 'OUTCOME_UNKNOWN') return;
    dispatch({ type: 'RECOVERY_STARTED' });
    announce(EXTERNAL_ACTION_ANNOUNCEMENTS.RECOVERY);
    try {
      await externalActionClient.resolveExternalActionOutcome({
        schemaVersion: '1.0.0',
        clientRequestId: phase.clientRequestId,
        idempotencyKey: phase.idempotencyKey,
        semanticDigest: phase.semanticDigest,
      });
      dispatch({ type: 'RECOVERY_FINISHED' });
      dispatch({ type: 'DETAIL_RESOLVED' });
      announce(EXTERNAL_ACTION_ANNOUNCEMENTS.DETAIL_READY);
    } catch (error) {
      dispatch({
        type: 'FAILED',
        reason: 'NETWORK_FAILURE',
        message: error instanceof Error ? error.message : '복구하지 못했습니다.',
        retryable: true,
      });
    }
  }, [state.phase, externalActionClient, announce]);

  // Focus preservation (contract §10.5): after deep-link restore / refresh /
  // cancel / verify, focus the named target once.
  useEffect(() => {
    if (!state.focusTarget) return;
    const target = document.getElementById(state.focusTarget);
    if (target && 'focus' in target) {
      (target as HTMLElement).focus();
      dispatch({ type: 'CLEAR_FOCUS' });
    }
  }, [state.focusTarget, detail.data]);

  if (!scope) {
    return (
      <section className="route-page">
        <p className="eyebrow">External Actions</p>
        <h1 tabIndex={-1}>External Action Governance</h1>
        <p>Project authority is required.</p>
      </section>
    );
  }

  return (
    <section className="route-page external-action-workspace">
      <p className="eyebrow">Governance</p>
      <h1 tabIndex={-1}>External Actions</h1>
      <p aria-live="polite" className="visually-hidden" ref={liveRegionRef} />

      {queue.isPending ? <LoadingState message="외부 액션 대기열 로드 중…" /> : null}
      {queue.isError ? (
        <ErrorState
          error={queue.error}
          onRetry={() => {
            void queue.refetch();
          }}
        />
      ) : null}
      {queue.data ? (
        queue.data.items.length === 0 ? (
          <EmptyState
            title="No external actions"
            description="The server reported no external actions."
          />
        ) : (
          <section aria-labelledby="external-action-queue-heading" className="action-card">
            <h2 id="external-action-queue-heading">Queue</h2>
            <ul className="external-action-queue">
              {queue.data.items.map((item) => (
                <li key={item.actionId}>
                  <button
                    type="button"
                    onClick={() => selectAction(item.actionId, item.actionRevision)}
                    aria-current={state.selectedActionId === item.actionId ? 'true' : undefined}
                  >
                    <span className="action-cue">{externalActionAggregateCue(item.status)}</span>
                    <span className="action-id">{item.actionId}</span>
                    <span className="action-status" aria-label={`상태: ${item.status}`}>
                      {item.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      ) : null}

      {identity && detail.isPending ? <LoadingState message="외부 액션 상세 로드 중…" /> : null}
      {identity && detail.isError ? (
        <ErrorState
          error={detail.error}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      ) : null}

      {detail.data ? (
        <>
          <section aria-labelledby="external-action-detail-heading" className="action-card">
            <h2 id="external-action-detail-heading">{detail.data.action.actionId}</h2>
            <dl className="summary-grid">
              <div>
                <dt>상태</dt>
                <dd>
                  <span className="action-cue">
                    {externalActionAggregateCue(detail.data.action.status)}
                  </span>
                  <span aria-label={`상태: ${detail.data.action.status}`}>
                    {detail.data.action.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt>리비전</dt>
                <dd>rev {detail.data.action.actionRevision}</dd>
              </div>
              <div>
                <dt>외부 리비전</dt>
                <dd>{detail.data.manifest?.externalRevision ?? '—'}</dd>
              </div>
            </dl>

            {detail.data.action.aggregateState === 'ACCESS_RESTRICTED' ? (
              <p className="restricted-shell" role="status">
                {EXTERNAL_ACTION_ANNOUNCEMENTS.ACCESS_RESTRICTED}
              </p>
            ) : null}

            {state.phase.kind === 'OUTCOME_UNKNOWN' ? (
              <section aria-labelledby="outcome-recovery-heading" className="recovery-card">
                <h3 id="outcome-recovery-heading">결과 확인</h3>
                <p>
                  외부 액션의 최종 결과를 확인할 수 없습니다. 원래 요청으로만 복구하며 다시 실행하지
                  않습니다.
                </p>
                <button
                  type="button"
                  onClick={() => void resolveOutcome()}
                  disabled={state.recovery.kind !== 'NONE'}
                >
                  원래 요청으로 복구
                </button>
              </section>
            ) : null}

            {state.phase.kind === 'FAILED' ? (
              <p className="stale-state" role="status">
                {failureReasonLabel(
                  state.phase.reason === 'NETWORK_FAILURE'
                    ? 'EXTERNAL_ACTION_NOT_FOUND'
                    : state.phase.reason,
                )}
                <span>{state.phase.message}</span>
              </p>
            ) : null}

            {detail.data.action.aggregateState !== 'ACCESS_RESTRICTED' ? (
              <>
                {riskDecision.data ? (
                  <section aria-labelledby="risk-heading" className="action-card">
                    <h3 id="risk-heading">위험 결정</h3>
                    <p>
                      위험 수준 <strong>{riskDecision.data.riskDecision.riskLevel}</strong> ·{' '}
                      {riskDecision.data.riskDecision.requiresUserApproval
                        ? '사용자 승인 필요'
                        : '자동 승인'}
                    </p>
                  </section>
                ) : null}

                {manifest.data ? (
                  <section aria-labelledby="manifest-heading" className="action-card">
                    <h3 id="manifest-heading">매니페스트</h3>
                    <p>
                      매니페스트 {manifest.data.manifest.manifestId} · 리비전{' '}
                      {manifest.data.manifest.manifestRevision}
                    </p>
                  </section>
                ) : null}

                {approval.data ? (
                  <section aria-labelledby="approval-heading" className="action-card">
                    <h3 id="approval-heading">승인</h3>
                    <p>
                      {approval.data.approval.status === 'ACTIVE'
                        ? '활성'
                        : approval.data.approval.status}{' '}
                      · {approval.data.approval.approvalId}
                    </p>
                  </section>
                ) : null}

                {preflight.data ? (
                  <section aria-labelledby="preflight-heading" className="action-card">
                    <h3 id="preflight-heading">사전 점검</h3>
                    <p>
                      {preflight.data.preflight.status === 'READY'
                        ? '준비됨'
                        : preflight.data.preflight.status}
                    </p>
                  </section>
                ) : null}

                {execution.data ? (
                  <section aria-labelledby="execution-heading" className="action-card">
                    <h3 id="execution-heading">실행</h3>
                    <p>
                      실행 {execution.data.execution.executionId} · 시도{' '}
                      {execution.data.execution.attemptCount}
                    </p>
                  </section>
                ) : null}

                {attempts.data && attempts.data.attempts.length > 0 ? (
                  <section aria-labelledby="attempts-heading" className="action-card">
                    <h3 id="attempts-heading">실행 시도</h3>
                    <ol>
                      {attempts.data.attempts.map((attempt) => (
                        <li key={attempt.attemptId}>
                          시도 {attempt.attemptNumber} · {attempt.status}
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {verification.data ? (
                  <section aria-labelledby="verification-heading" className="action-card">
                    <h3 id="verification-heading">검증</h3>
                    <p>
                      {verification.data.verification.status === 'APPLIED'
                        ? '외부 상태가 적용됨'
                        : verification.data.verification.status}
                    </p>
                  </section>
                ) : null}

                {result.data ? (
                  <section aria-labelledby="result-heading" className="action-card">
                    <h3 id="result-heading">결과</h3>
                    <p>결과 {result.data.result.resultId}</p>
                  </section>
                ) : null}

                {audit.data && audit.data.events.length > 0 ? (
                  <section aria-labelledby="audit-heading" className="action-card">
                    <h3 id="audit-heading">감사 기록</h3>
                    <ol>
                      {audit.data.events.slice(0, 20).map((event) => (
                        <li key={event.auditEventId}>
                          {event.occurredAt} · {event.category}
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {/* Non-automatic governed surfaces (contract §9, §10.3). */}
                <section aria-labelledby="governed-commands-heading" className="action-card">
                  <h3 id="governed-commands-heading">거버넌스 명령</h3>
                  {!surfaces.canCancel &&
                  !surfaces.canRollback &&
                  !surfaces.canPrepareCompensation ? (
                    <p>현재 상태에서 실행 가능한 거버넌스 명령이 없습니다.</p>
                  ) : null}
                  {surfaces.canCancel ? (
                    <p className="governed-command-note">
                      취소는 중단 요청일 뿐 외부 상태를 되돌리지 않습니다.
                    </p>
                  ) : null}
                  {surfaces.canRollback ? (
                    <p className="governed-command-note">
                      롤백은 별도의 거버넌스 상태 되돌리기 명령입니다.
                    </p>
                  ) : null}
                  <div className="governed-command-grid">
                    {surfaces.canCancel ? (
                      <button
                        type="button"
                        onClick={() => void submitCommand('CANCEL')}
                        disabled={state.recovery.kind !== 'NONE'}
                      >
                        취소 요청
                      </button>
                    ) : null}
                    {surfaces.canRollback ? (
                      <button
                        type="button"
                        onClick={() => void submitCommand('ROLLBACK')}
                        disabled={state.recovery.kind !== 'NONE'}
                      >
                        롤백
                      </button>
                    ) : null}
                    {surfaces.canPrepareCompensation ? (
                      <button
                        type="button"
                        onClick={() => void submitCommand('PREPARE_COMPENSATION')}
                        disabled={state.recovery.kind !== 'NONE'}
                      >
                        보상 액션 준비
                      </button>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
};
