import type {
  ReviewAggregateStateV1,
  ReviewDecisionIntentV1,
  ReviewFailureReasonV1,
} from '@shotgun/api-client';

/**
 * FE-P4-S1 Review Workspace browser state (ADR-119 ownership).
 *
 * This machine owns only route selection, focus and UNSENT decision input
 * (item selections, reasons, comments). It never computes dependency graphs,
 * capabilities, Approval purpose or aggregate state — the server is the
 * Review authority. Recovery resolves by the original command identity and
 * never automatically resubmits a decision.
 */

export type ReviewWorkspacePhase =
  | { kind: 'IDLE' }
  | { kind: 'QUEUE_LOADING' }
  | { kind: 'QUEUE_READY' }
  | { kind: 'CONTEXT_LOADING' }
  | { kind: 'CONTEXT_READY' }
  | {
      kind: 'FAILED';
      reason: ReviewFailureReasonV1 | 'NETWORK_FAILURE';
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

export type ReviewDraftSelection = {
  readonly intent: ReviewDecisionIntentV1;
  readonly reason: string;
};

export type ReviewWorkspaceRecovery =
  { kind: 'NONE' } | { kind: 'RESTORING' } | { kind: 'RESOLVING'; clientRequestId: string };

export type ReviewWorkspaceState = {
  readonly selectedContextId: string | null;
  readonly contextRevision: number | null;
  readonly selectedItemId: string | null;
  readonly focusItemId: string | null;
  readonly phase: ReviewWorkspacePhase;
  /** Route-scoped draft: unsent Item selections only (ADR-119). */
  readonly drafts: Readonly<Record<string, ReviewDraftSelection>>;
  readonly comment: string;
  readonly recovery: ReviewWorkspaceRecovery;
};

export type ReviewWorkspaceAction =
  | { type: 'QUEUE_STARTED' }
  | { type: 'QUEUE_RESOLVED' }
  | { type: 'SELECT_CONTEXT'; reviewContextId: string; contextRevision: number }
  | { type: 'CONTEXT_STARTED' }
  | { type: 'CONTEXT_RESOLVED' }
  | { type: 'SELECT_ITEM'; reviewItemId: string }
  | { type: 'FOCUS_ITEM'; reviewItemId: string }
  | { type: 'SET_DRAFT'; reviewItemId: string; intent: ReviewDecisionIntentV1; reason: string }
  | { type: 'CLEAR_DRAFT'; reviewItemId: string }
  | { type: 'SET_COMMENT'; comment: string }
  | { type: 'CLEAR_DRAFTS' }
  | { type: 'DECISION_STARTED' }
  | { type: 'DECISION_RESOLVED' }
  | {
      type: 'FAILED';
      reason: ReviewFailureReasonV1 | 'NETWORK_FAILURE';
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

export const createInitialReviewWorkspaceState = (): ReviewWorkspaceState => ({
  selectedContextId: null,
  contextRevision: null,
  selectedItemId: null,
  focusItemId: null,
  phase: { kind: 'IDLE' },
  drafts: {},
  comment: '',
  recovery: { kind: 'NONE' },
});

/**
 * Frozen announcement strings (AC-15/AC-27). These exact strings are asserted
 * by browser E2E tests and must not change without a contract revision.
 */
export const REVIEW_ANNOUNCEMENTS = {
  QUEUE_READY: (count: number) => `검토 대기열: ${count}건`,
  CONTEXT_SELECTED: (label: string) => `검토 대상 선택됨: ${label}`,
  ITEM_SELECTED: (label: string) => `항목 선택됨: ${label}`,
  DECISION_RECORDED: (intent: ReviewDecisionIntentV1) => `결정 기록됨: ${intent}`,
  DECISION_REJECTED: '결정이 거부되었습니다.',
  STALE: '검토 대상이 변경되었습니다. 재검증이 필요합니다.',
  ACCESS_RESTRICTED: '검토 접근이 제한되었습니다.',
  UNAVAILABLE: '검토 정보를 사용할 수 없습니다.',
  APPROVAL_ISSUED: (purpose: string) => `승인이 발급되었습니다: ${purpose}`,
  ACCEPTED_FOR_AUTHORING: '작성 후보로 승인되었습니다.',
  REVISION_REQUESTED: '수정 요청이 기록되었습니다.',
  REVISION_RETURN_TARGET: '수정 요청은 작성 워크스페이스로 연결됩니다.',
  OUTCOME_UNKNOWN: '결정 결과를 확인할 수 없습니다. 원래 요청으로 복구합니다.',
  RECOVERY: '검토 상태를 복구합니다.',
} as const;

/** Pure mapping of every aggregate state to a frozen announcement string. */
export const aggregateAnnouncement = (state: ReviewAggregateStateV1): string => {
  switch (state) {
    case 'PENDING':
      return '검토 대기 중입니다.';
    case 'PARTIALLY_DECIDED':
      return '일부 항목이 결정되었습니다.';
    case 'ON_HOLD':
      return '보류 상태입니다.';
    case 'REVISION_REQUESTED':
      return REVIEW_ANNOUNCEMENTS.REVISION_REQUESTED;
    case 'REJECTED':
      return '거절되었습니다.';
    case 'APPROVED_READY':
      return '승인 완료 상태입니다.';
    case 'ACCEPTED_FOR_AUTHORING':
      return REVIEW_ANNOUNCEMENTS.ACCEPTED_FOR_AUTHORING;
    case 'STALE':
      return REVIEW_ANNOUNCEMENTS.STALE;
    case 'ACCESS_RESTRICTED':
      return REVIEW_ANNOUNCEMENTS.ACCESS_RESTRICTED;
    case 'UNAVAILABLE':
      return REVIEW_ANNOUNCEMENTS.UNAVAILABLE;
  }
  return REVIEW_ANNOUNCEMENTS.UNAVAILABLE;
};

export const reduceReviewWorkspaceState = (
  state: ReviewWorkspaceState,
  action: ReviewWorkspaceAction,
): ReviewWorkspaceState => {
  switch (action.type) {
    case 'QUEUE_STARTED':
      return { ...state, phase: { kind: 'QUEUE_LOADING' } };
    case 'QUEUE_RESOLVED':
      return { ...state, phase: { kind: 'QUEUE_READY' } };
    case 'SELECT_CONTEXT':
      return {
        ...state,
        selectedContextId: action.reviewContextId,
        contextRevision: action.contextRevision,
        selectedItemId: null,
        focusItemId: null,
        phase: { kind: 'CONTEXT_LOADING' },
        drafts: {},
        comment: '',
      };
    case 'CONTEXT_STARTED':
      return { ...state, phase: { kind: 'CONTEXT_LOADING' } };
    case 'CONTEXT_RESOLVED':
      return { ...state, phase: { kind: 'CONTEXT_READY' } };
    case 'SELECT_ITEM':
      return { ...state, selectedItemId: action.reviewItemId };
    case 'FOCUS_ITEM':
      return { ...state, focusItemId: action.reviewItemId };
    case 'SET_DRAFT':
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.reviewItemId]: { intent: action.intent, reason: action.reason },
        },
      };
    case 'CLEAR_DRAFT': {
      const next = { ...state.drafts };
      delete next[action.reviewItemId];
      return { ...state, drafts: next };
    }
    case 'SET_COMMENT':
      return { ...state, comment: action.comment };
    case 'CLEAR_DRAFTS':
      return { ...state, drafts: {}, comment: '' };
    case 'DECISION_STARTED':
      return { ...state, phase: { kind: 'CONTEXT_READY' } };
    case 'DECISION_RESOLVED':
      return {
        ...state,
        phase: { kind: 'CONTEXT_READY' },
        drafts: {},
        comment: '',
        recovery: { kind: 'NONE' },
      };
    case 'FAILED':
      return { ...state, phase: { kind: 'FAILED', ...action }, recovery: { kind: 'NONE' } };
    case 'OUTCOME_UNKNOWN':
      return {
        ...state,
        phase: {
          kind: 'OUTCOME_UNKNOWN',
          clientRequestId: action.clientRequestId,
          idempotencyKey: action.idempotencyKey,
          semanticDigest: action.semanticDigest,
        },
        recovery: { kind: 'RESOLVING', clientRequestId: action.clientRequestId },
      };
    case 'RECOVERY_STARTED':
      return { ...state, recovery: { kind: 'RESTORING' } };
    case 'RECOVERY_FINISHED':
      return { ...state, recovery: { kind: 'NONE' } };
    case 'BLOCKED':
      return { ...state, phase: { kind: 'BLOCKED', message: action.message } };
  }
};
