import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';

import {
  createFrontendExternalActionClient,
  frontendExternalActionCancelDigest,
  frontendExternalActionCompensationDigest,
  frontendExternalActionRollbackDigest,
  frontendExternalActionVerifyDigest,
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
 * reads, Cancel (abort only), separate Rollback, governed Compensating Action
 * and Verify surfaces (explicitly non-automatic), and `OUTCOME_UNKNOWN`
 * recovery by the ORIGINAL command identity (never a re-execute button).
 * Browser owns only selection, focus and unsent command input (ADR-119);
 * governed commands enter a SUBMITTING lock so they are sent exactly once.
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParameters] = useSearchParams();
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
    if (deepLink.manifestId) dispatch({ type: 'SELECT_MANIFEST', manifestId: deepLink.manifestId });
    if (deepLink.executionId) {
      dispatch({ type: 'SELECT_EXECUTION', executionId: deepLink.executionId });
    }
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
    deepLink.manifestId,
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
  // the detail payload and then binds every child read so cache isolation holds
  // across action revision AND external revision (WP5). Memoized so the phase
  // effects never observe a fresh object identity (which would re-dispatch and
  // loop).
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

  // Child reads are gated until the detail resolves AND the action is not
  // access-restricted (Review 4865177355 item 3): the external revision is
  // learned from the detail payload before any child read fires, and no
  // protected resource read is issued for a Hidden/Restricted action.
  const knownExternalRevision =
    detail.data?.manifest?.externalRevision ?? state.externalRevision ?? '';
  const detailRestricted =
    detail.data?.action.aggregateState === 'ACCESS_RESTRICTED' ||
    detail.data?.action.accessMasking === 'HIDDEN';
  const childIdentity = useMemo(
    () =>
      detail.data && !detailRestricted && state.selectedActionId && state.actionRevision !== null
        ? {
            actionId: state.selectedActionId,
            actionRevision: state.actionRevision,
            externalRevision: knownExternalRevision,
          }
        : null,
    [
      detail.data,
      detailRestricted,
      state.selectedActionId,
      state.actionRevision,
      knownExternalRevision,
    ],
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
      if (detailRestricted) {
        announce(EXTERNAL_ACTION_ANNOUNCEMENTS.ACCESS_RESTRICTED);
      }
    }
  }, [
    identity,
    detail.isPending,
    detail.isError,
    detail.data,
    detail.error,
    detailRestricted,
    announce,
  ]);

  const selectAction = useCallback(
    (actionId: string, actionRevision: number) => {
      dispatch({ type: 'SELECT_ACTION', actionId, actionRevision, externalRevision: '' });
      // navigate with the full deep-link href — never a raw href handed to
      // setSearchParameters (Review 4865177355 item 2).
      navigate(externalActionDeepLinkHref({ actionId }));
      announce(EXTERNAL_ACTION_ANNOUNCEMENTS.ACTION_SELECTED(actionId));
    },
    [navigate, announce],
  );

  const selectManifest = useCallback(
    (manifestId: string) => {
      dispatch({ type: 'SELECT_MANIFEST', manifestId });
      navigate(
        externalActionDeepLinkHref({
          actionId: state.selectedActionId ?? undefined,
          manifestId,
        }),
      );
    },
    [navigate, state.selectedActionId],
  );

  const surfaces = detail.data
    ? externalActionCommandSurfaces(detail.data.action.status)
    : {
        canCancel: false,
        canRollback: false,
        canPrepareCompensation: false,
        canExecute: false,
        canVerify: false,
      };

  const commandsAvailable = Object.values(surfaces).some(Boolean);
  const locked = state.submitting !== null || state.recovery.kind !== 'NONE';

  const submitCommand = useCallback(
    async (command: ExternalActionCommandKind) => {
      if (!identity || !detail.data) return;
      if (state.submitting !== null) return; // exactly-once guard
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
          // Original identity + exact digest are captured BEFORE the call so
          // OUTCOME_UNKNOWN recovery always has them (Review 4865177355 item 5).
          lastCommandRef.current = {
            clientRequestId,
            idempotencyKey,
            semanticDigest: frontendExternalActionCancelDigest(request),
          };
          dispatch({ type: 'SUBMITTING_STARTED', command });
          await externalActionClient.cancelExternalAction(request);
          dispatch({ type: 'SUBMITTING_FINISHED' });
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.CANCEL_REQUESTED);
          // Focus preserved after cancel (Review 4865177355 item 6).
          dispatch({ type: 'FOCUS', target: 'governed-commands-heading' });
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
          lastCommandRef.current = {
            clientRequestId,
            idempotencyKey,
            semanticDigest: frontendExternalActionRollbackDigest(request),
          };
          dispatch({ type: 'SUBMITTING_STARTED', command });
          await externalActionClient.rollbackExternalAction(request);
          dispatch({ type: 'SUBMITTING_FINISHED' });
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.ROLLBACK_REQUESTED);
          dispatch({ type: 'FOCUS', target: 'governed-commands-heading' });
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
          lastCommandRef.current = {
            clientRequestId,
            idempotencyKey,
            semanticDigest: frontendExternalActionCompensationDigest(request),
          };
          dispatch({ type: 'SUBMITTING_STARTED', command });
          await externalActionClient.prepareCompensatingAction(request);
          dispatch({ type: 'SUBMITTING_FINISHED' });
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.COMPENSATION_REQUESTED);
          dispatch({ type: 'FOCUS', target: 'governed-commands-heading' });
        } else if (command === 'VERIFY') {
          const executionId =
            state.selectedExecutionId ?? action.latestExecutionRef?.resourceId ?? '';
          const request = {
            schemaVersion: '1.0.0' as const,
            clientRequestId,
            idempotencyKey,
            actionId: action.actionId,
            executionId,
            expectedTargetRevision: manifest.data?.manifest.targetRevision ?? '',
            expectedExternalRevision: manifest.data?.manifest.externalRevision ?? '',
            reason,
          };
          lastCommandRef.current = {
            clientRequestId,
            idempotencyKey,
            semanticDigest: frontendExternalActionVerifyDigest(request),
          };
          dispatch({ type: 'SUBMITTING_STARTED', command });
          await externalActionClient.verifyExternalAction(request);
          dispatch({ type: 'SUBMITTING_FINISHED' });
          dispatch({ type: 'COMMAND_RESOLVED' });
          announce(EXTERNAL_ACTION_ANNOUNCEMENTS.VERIFIED);
          dispatch({ type: 'FOCUS', target: 'verification-heading' });
        }
      } catch (error) {
        dispatch({ type: 'SUBMITTING_FINISHED' });
        const failure = error as { code?: string; category?: string; message?: string };
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
    [
      identity,
      detail.data,
      state.submitting,
      state.draft,
      state.selectedExecutionId,
      manifest.data,
      externalActionClient,
      announce,
    ],
  );

  const resolveOutcome = useCallback(async () => {
    const phase = state.phase;
    if (phase.kind !== 'OUTCOME_UNKNOWN') return;
    dispatch({ type: 'RECOVERY_STARTED' });
    announce(EXTERNAL_ACTION_ANNOUNCEMENTS.RECOVERY);
    try {
      const resolved = await externalActionClient.resolveExternalActionOutcome({
        schemaVersion: '1.0.0',
        clientRequestId: phase.clientRequestId,
        idempotencyKey: phase.idempotencyKey,
        semanticDigest: phase.semanticDigest,
      });
      // Adjudicate the three contract outcomes (Review 4865177355 item 5):
      // COMPLETED -> refetch; REJECTED -> typed failure; OUTCOME_UNKNOWN ->
      // remain recoverable (never a re-execute).
      if (resolved.outcome === 'COMPLETED') {
        dispatch({ type: 'RECOVERY_FINISHED' });
        dispatch({ type: 'DETAIL_RESOLVED' });
        if (identity && scope) {
          await queryClient.invalidateQueries({
            queryKey: [
              'project',
              scope.principalId,
              'external-action',
              'action',
              identity.actionId,
            ],
          });
        }
        announce(EXTERNAL_ACTION_ANNOUNCEMENTS.DETAIL_READY);
      } else if (resolved.outcome === 'REJECTED') {
        dispatch({ type: 'RECOVERY_FINISHED' });
        dispatch({
          type: 'FAILED',
          reason: 'NETWORK_FAILURE',
          message: resolved.rejection?.message ?? EXTERNAL_ACTION_ANNOUNCEMENTS.COMMAND_REJECTED,
          retryable: false,
        });
        announce(EXTERNAL_ACTION_ANNOUNCEMENTS.COMMAND_REJECTED);
      } else {
        // Still OUTCOME_UNKNOWN — keep the recovery state (original identity).
        dispatch({ type: 'RECOVERY_FINISHED' });
        announce(EXTERNAL_ACTION_ANNOUNCEMENTS.OUTCOME_UNKNOWN);
      }
    } catch (error) {
      dispatch({
        type: 'FAILED',
        reason: 'NETWORK_FAILURE',
        message: error instanceof Error ? error.message : '복구하지 못했습니다.',
        retryable: true,
      });
    }
  }, [state.phase, identity, scope, queryClient, externalActionClient, announce]);

  // Focus preservation (contract §10.5): focus the named target once. The
  // focus target may only be mounted after a child read resolves (e.g. the
  // manifest heading), so the effect re-runs when the detail subtree's data
  // lands; it self-terminates via CLEAR_FOCUS once the target is found.
  useEffect(() => {
    if (!state.focusTarget) return;
    const target = document.getElementById(state.focusTarget);
    if (target && 'focus' in target) {
      (target as HTMLElement).focus();
      dispatch({ type: 'CLEAR_FOCUS' });
    }
  }, [
    state.focusTarget,
    detail.data,
    manifest.data,
    verification.data,
    execution.data,
    attempts.data,
    approval.data,
    preflight.data,
    result.data,
    riskDecision.data,
    audit.data,
  ]);

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
            <h2 id="external-action-queue-heading" tabIndex={-1}>
              Queue
            </h2>
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
            <h2 id="external-action-detail-heading" tabIndex={-1}>
              {detail.data.action.actionId}
            </h2>
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
                <dd>{knownExternalRevision || '—'}</dd>
              </div>
            </dl>

            {detailRestricted ? (
              <p className="restricted-shell" role="status">
                {EXTERNAL_ACTION_ANNOUNCEMENTS.ACCESS_RESTRICTED}
              </p>
            ) : null}

            {state.phase.kind === 'OUTCOME_UNKNOWN' ? (
              <section aria-labelledby="outcome-recovery-heading" className="recovery-card">
                <h3 id="outcome-recovery-heading" tabIndex={-1}>
                  결과 확인
                </h3>
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

            {!detailRestricted ? (
              <>
                {riskDecision.data ? (
                  <section aria-labelledby="risk-heading" className="action-card">
                    <h3 id="risk-heading" tabIndex={-1}>
                      위험 결정
                    </h3>
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
                    <h3 id="manifest-heading" tabIndex={-1}>
                      매니페스트
                    </h3>
                    <p>
                      매니페스트 {manifest.data.manifest.manifestId} · 리비전{' '}
                      {manifest.data.manifest.manifestRevision}
                    </p>
                    <button
                      type="button"
                      onClick={() => selectManifest(manifest.data.manifest.manifestId)}
                      aria-pressed={state.selectedManifestId === manifest.data.manifest.manifestId}
                    >
                      {state.selectedManifestId === manifest.data.manifest.manifestId
                        ? '선택됨'
                        : '선택'}
                    </button>
                  </section>
                ) : null}

                {approval.data ? (
                  <section aria-labelledby="approval-heading" className="action-card">
                    <h3 id="approval-heading" tabIndex={-1}>
                      승인
                    </h3>
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
                    <h3 id="preflight-heading" tabIndex={-1}>
                      사전 점검
                    </h3>
                    <p>
                      {preflight.data.preflight.status === 'READY'
                        ? '준비됨'
                        : preflight.data.preflight.status}
                    </p>
                  </section>
                ) : null}

                {execution.data ? (
                  <section aria-labelledby="execution-heading" className="action-card">
                    <h3 id="execution-heading" tabIndex={-1}>
                      실행
                    </h3>
                    <p>
                      실행 {execution.data.execution.executionId} · 시도{' '}
                      {execution.data.execution.attemptCount}
                    </p>
                  </section>
                ) : null}

                {attempts.data && attempts.data.attempts.length > 0 ? (
                  <section aria-labelledby="attempts-heading" className="action-card">
                    <h3 id="attempts-heading" tabIndex={-1}>
                      실행 시도
                    </h3>
                    <ol>
                      {attempts.data.attempts.map((attempt) => (
                        <li key={attempt.attemptId}>
                          <button
                            type="button"
                            onClick={() =>
                              dispatch({ type: 'SELECT_ATTEMPT', attemptId: attempt.attemptId })
                            }
                            aria-pressed={state.selectedAttemptId === attempt.attemptId}
                          >
                            시도 {attempt.attemptNumber} · {attempt.status}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {verification.data ? (
                  <section aria-labelledby="verification-heading" className="action-card">
                    <h3 id="verification-heading" tabIndex={-1}>
                      검증
                    </h3>
                    <p>
                      {verification.data.verification.status === 'APPLIED'
                        ? '외부 상태가 적용됨'
                        : verification.data.verification.status}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'SELECT_VERIFICATION',
                          verificationId: verification.data.verification.verificationId,
                        })
                      }
                      aria-pressed={
                        state.selectedVerificationId ===
                        verification.data.verification.verificationId
                      }
                    >
                      {state.selectedVerificationId ===
                      verification.data.verification.verificationId
                        ? '선택됨'
                        : '선택'}
                    </button>
                  </section>
                ) : null}

                {result.data ? (
                  <section aria-labelledby="result-heading" className="action-card">
                    <h3 id="result-heading" tabIndex={-1}>
                      결과
                    </h3>
                    <p>결과 {result.data.result.resultId}</p>
                  </section>
                ) : null}

                {audit.data && audit.data.events.length > 0 ? (
                  <section aria-labelledby="audit-heading" className="action-card">
                    <h3 id="audit-heading" tabIndex={-1}>
                      감사 기록
                    </h3>
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
                  <h3 id="governed-commands-heading" tabIndex={-1}>
                    거버넌스 명령
                  </h3>
                  {!commandsAvailable ? (
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
                        disabled={locked}
                      >
                        취소 요청
                      </button>
                    ) : null}
                    {surfaces.canRollback ? (
                      <button
                        type="button"
                        onClick={() => void submitCommand('ROLLBACK')}
                        disabled={locked}
                      >
                        롤백
                      </button>
                    ) : null}
                    {surfaces.canPrepareCompensation ? (
                      <button
                        type="button"
                        onClick={() => void submitCommand('PREPARE_COMPENSATION')}
                        disabled={locked}
                      >
                        보상 액션 준비
                      </button>
                    ) : null}
                    {surfaces.canVerify ? (
                      <button
                        type="button"
                        onClick={() => void submitCommand('VERIFY')}
                        disabled={locked}
                      >
                        검증 실행
                      </button>
                    ) : null}
                  </div>
                  {/* Route-scoped reason draft (ADR-119): unsent input only. */}
                  <label className="reason-input">
                    사유
                    <input
                      type="text"
                      value={state.draft?.reason ?? ''}
                      onChange={(event) =>
                        dispatch({
                          type: 'SET_COMMAND_DRAFT',
                          command: 'CANCEL',
                          reason: event.target.value,
                        })
                      }
                      aria-label="거버넌스 명령 사유"
                    />
                  </label>
                </section>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
};
