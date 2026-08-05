import type {
  ExternalActionAggregateStatusV1,
  ExternalActionFailureReasonV1,
} from '@shotgun/api-client';

/**
 * FE-P4-S2 WP5 External Action Governance Workspace — route-scoped Browser
 * Draft State Machine (ADR-119).
 *
 * The machine owns ONLY route selection, focus and UNSENT governed-command
 * input (the command kind and an optional reason). It never computes
 * capability, policy, risk, credential, budget or aggregate state — the server
 * is the External Action authority (ADR-129). Governed commands are submitted
 * exactly once; `OUTCOME_UNKNOWN` recovers by the ORIGINAL command identity and
 * never re-executes or auto-reruns (contract §7, §10.3). Cancel is an abort
 * request that never implies rollback; Rollback and Compensating Action are
 * separate governed surfaces (contract §9).
 */

export type ExternalActionWorkspacePhase =
  | { kind: 'IDLE' }
  | { kind: 'QUEUE_LOADING' }
  | { kind: 'QUEUE_READY' }
  | { kind: 'DETAIL_LOADING' }
  | { kind: 'DETAIL_READY' }
  | {
      kind: 'FAILED';
      reason: ExternalActionFailureReasonV1 | 'NETWORK_FAILURE';
      message: string;
      retryable: boolean;
    }
  | {
      kind: 'OUTCOME_UNKNOWN';
      clientRequestId: string;
      idempotencyKey: string;
      semanticDigest: string;
    }
  | { kind: 'BLOCKED'; message: string };

export type ExternalActionCommandKind =
  | 'VALIDATE'
  | 'PREPARE'
  | 'APPROVE'
  | 'PREFLIGHT'
  | 'EXECUTE'
  | 'RETRY'
  | 'VERIFY'
  | 'CANCEL'
  | 'ROLLBACK'
  | 'PREPARE_COMPENSATION';

export type ExternalActionCommandDraft = {
  readonly command: ExternalActionCommandKind;
  readonly reason: string;
};

export type ExternalActionWorkspaceRecovery =
  { kind: 'NONE' } | { kind: 'RESTORING' } | { kind: 'RESOLVING'; clientRequestId: string };

export type ExternalActionWorkspaceState = {
  readonly selectedActionId: string | null;
  readonly actionRevision: number | null;
  readonly externalRevision: string | null;
  readonly selectedManifestId: string | null;
  readonly selectedExecutionId: string | null;
  readonly selectedAttemptId: string | null;
  readonly selectedVerificationId: string | null;
  readonly focusTarget: string | null;
  readonly phase: ExternalActionWorkspacePhase;
  /** Route-scoped draft: unsent governed-command input only (ADR-119). */
  readonly draft: ExternalActionCommandDraft | null;
  /** In-flight governed command (submission in progress) — locks all surfaces. */
  readonly submitting: ExternalActionCommandKind | null;
  readonly recovery: ExternalActionWorkspaceRecovery;
};

export type ExternalActionWorkspaceAction =
  | { type: 'QUEUE_STARTED' }
  | { type: 'QUEUE_RESOLVED' }
  | {
      type: 'SELECT_ACTION';
      actionId: string;
      actionRevision: number;
      externalRevision: string;
    }
  | { type: 'DETAIL_STARTED' }
  | { type: 'DETAIL_RESOLVED' }
  | { type: 'SELECT_MANIFEST'; manifestId: string }
  | { type: 'SELECT_EXECUTION'; executionId: string }
  | { type: 'SELECT_ATTEMPT'; attemptId: string }
  | { type: 'SELECT_VERIFICATION'; verificationId: string }
  | { type: 'FOCUS'; target: string }
  | { type: 'CLEAR_FOCUS' }
  | { type: 'SET_COMMAND_DRAFT'; command: ExternalActionCommandKind; reason: string }
  | { type: 'CLEAR_COMMAND_DRAFT' }
  | { type: 'SUBMITTING_STARTED'; command: ExternalActionCommandKind }
  | { type: 'SUBMITTING_FINISHED' }
  | { type: 'COMMAND_STARTED' }
  | { type: 'COMMAND_RESOLVED' }
  | {
      type: 'FAILED';
      reason: ExternalActionFailureReasonV1 | 'NETWORK_FAILURE';
      message: string;
      retryable: boolean;
    }
  | {
      type: 'OUTCOME_UNKNOWN';
      clientRequestId: string;
      idempotencyKey: string;
      semanticDigest: string;
    }
  | { type: 'RECOVERY_STARTED' }
  | { type: 'RECOVERY_FINISHED' }
  | { type: 'BLOCKED'; message: string };

export const createInitialExternalActionWorkspaceState = (): ExternalActionWorkspaceState => ({
  selectedActionId: null,
  actionRevision: null,
  externalRevision: null,
  selectedManifestId: null,
  selectedExecutionId: null,
  selectedAttemptId: null,
  selectedVerificationId: null,
  focusTarget: null,
  phase: { kind: 'IDLE' },
  draft: null,
  submitting: null,
  recovery: { kind: 'NONE' },
});

/**
 * Frozen announcement strings (contract §10.6 / FE-P4-S1 accessibility
 * contract). These exact strings are asserted by workspace tests and must not
 * change without a contract revision.
 */
export const EXTERNAL_ACTION_ANNOUNCEMENTS = {
  QUEUE_READY: (count: number) => `외부 액션 대기열: ${count}건`,
  ACTION_SELECTED: (label: string) => `외부 액션 선택됨: ${label}`,
  DETAIL_READY: '외부 액션 상세가 로드되었습니다.',
  ACCESS_RESTRICTED: '외부 액션 접근이 제한되었습니다. 보호된 정보는 표시되지 않습니다.',
  STALE: '외부 액션이 변경되었습니다. 재검증이 필요합니다.',
  CANCEL_REQUESTED: '취소 요청이 기록되었습니다. (외부 상태는 되돌려지지 않습니다)',
  ROLLBACK_REQUESTED: '롤백 요청이 기록되었습니다.',
  COMPENSATION_REQUESTED: '보상 액션 준비가 요청되었습니다.',
  COMMAND_REJECTED: '외부 액션 명령이 거부되었습니다.',
  OUTCOME_UNKNOWN: '외부 액션 결과를 확인할 수 없습니다. 원래 요청으로 복구합니다.',
  RECOVERY: '외부 액션 상태를 복구합니다.',
  VERIFIED: '외부 상태가 검증되었습니다.',
} as const;

export const externalActionAggregateCue = (state: ExternalActionAggregateStatusV1): string => {
  switch (state) {
    case 'VERIFIED':
    case 'ROLLED_BACK':
    case 'COMPENSATED':
      return '완료';
    case 'FAILED':
    case 'VERIFICATION_FAILED':
    case 'PREFLIGHT_FAILED':
    case 'CANCELLED':
    case 'OUTCOME_UNKNOWN':
      return '차단';
    case 'CANCELLING':
    case 'ROLLING_BACK':
    case 'COMPENSATING':
    case 'EXECUTING':
    case 'VERIFYING':
      return '진행 중';
    case 'COMPENSATION_REQUIRED':
      return '보상 필요';
    case 'ROLLBACK_AVAILABLE':
      return '롤백 가능';
    case 'READY_TO_EXECUTE':
      return '실행 준비';
    default:
      return '대기';
  }
};

/**
 * Governed command availability for the workspace (browser-side affordance
 * only). The server is still the capability/policy/state authority — this map
 * only decides which non-automatic surfaces are rendered, never whether a
 * command succeeds.
 */
export const externalActionCommandSurfaces = (
  status: ExternalActionAggregateStatusV1,
): Readonly<{
  readonly canCancel: boolean;
  readonly canRollback: boolean;
  readonly canPrepareCompensation: boolean;
  readonly canExecute: boolean;
  readonly canVerify: boolean;
}> => {
  const executing = status === 'EXECUTING' || status === 'VERIFYING';
  return {
    // Cancel is an abort request; never available as rollback (contract §9).
    canCancel: status === 'READY_TO_EXECUTE' || status === 'EXECUTING' || status === 'VERIFYING',
    // Rollback is a separate governed state-reversal; never assumed available.
    canRollback: status === 'VERIFIED' || status === 'VERIFICATION_FAILED' || status === 'FAILED',
    // Compensating Action is an independent governed External Action.
    canPrepareCompensation:
      status === 'VERIFIED' || status === 'VERIFICATION_FAILED' || status === 'FAILED',
    canExecute: status === 'READY_TO_EXECUTE',
    canVerify: executing || status === 'OUTCOME_UNKNOWN',
  };
};

export const reduceExternalActionWorkspaceState = (
  state: ExternalActionWorkspaceState,
  action: ExternalActionWorkspaceAction,
): ExternalActionWorkspaceState => {
  switch (action.type) {
    case 'QUEUE_STARTED':
      return { ...state, phase: { kind: 'QUEUE_LOADING' } };
    case 'QUEUE_RESOLVED':
      return { ...state, phase: { kind: 'QUEUE_READY' } };
    case 'SELECT_ACTION':
      return {
        ...state,
        selectedActionId: action.actionId,
        actionRevision: action.actionRevision,
        externalRevision: action.externalRevision,
        selectedManifestId: null,
        selectedExecutionId: null,
        selectedAttemptId: null,
        selectedVerificationId: null,
        draft: null,
        submitting: null,
        phase: { kind: 'DETAIL_LOADING' },
        recovery: { kind: 'NONE' },
      };
    case 'DETAIL_STARTED':
      return { ...state, phase: { kind: 'DETAIL_LOADING' } };
    case 'DETAIL_RESOLVED':
      return { ...state, phase: { kind: 'DETAIL_READY' } };
    case 'SELECT_MANIFEST':
      return { ...state, selectedManifestId: action.manifestId };
    case 'SELECT_EXECUTION':
      return { ...state, selectedExecutionId: action.executionId };
    case 'SELECT_ATTEMPT':
      return { ...state, selectedAttemptId: action.attemptId };
    case 'SELECT_VERIFICATION':
      return { ...state, selectedVerificationId: action.verificationId };
    case 'FOCUS':
      return { ...state, focusTarget: action.target };
    case 'CLEAR_FOCUS':
      return { ...state, focusTarget: null };
    case 'SET_COMMAND_DRAFT':
      return { ...state, draft: { command: action.command, reason: action.reason } };
    case 'CLEAR_COMMAND_DRAFT':
      return { ...state, draft: null };
    case 'SUBMITTING_STARTED':
      return { ...state, submitting: action.command, draft: null };
    case 'SUBMITTING_FINISHED':
      return { ...state, submitting: null };
    case 'COMMAND_STARTED':
      return { ...state, draft: null };
    case 'COMMAND_RESOLVED':
      return { ...state, phase: { kind: 'DETAIL_READY' } };
    case 'FAILED':
      return {
        ...state,
        phase: {
          kind: 'FAILED',
          reason: action.reason,
          message: action.message,
          retryable: action.retryable,
        },
      };
    case 'OUTCOME_UNKNOWN':
      return {
        ...state,
        phase: {
          kind: 'OUTCOME_UNKNOWN',
          clientRequestId: action.clientRequestId,
          idempotencyKey: action.idempotencyKey,
          semanticDigest: action.semanticDigest,
        },
      };
    case 'RECOVERY_STARTED':
      return { ...state, recovery: { kind: 'RESTORING' } };
    case 'RECOVERY_FINISHED':
      return { ...state, recovery: { kind: 'NONE' } };
    case 'BLOCKED':
      return { ...state, phase: { kind: 'BLOCKED', message: action.message } };
  }
};
