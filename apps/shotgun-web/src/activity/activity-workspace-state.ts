import type {
  ActivityAttentionStateV1,
  ActivityDomainKindV1,
  ActivityLifecycleStateV1,
} from '@shotgun/api-client';

import type { ActivityIdentity } from './activity-queries.js';

/**
 * FE-P5-S1 WP4 — Activity Workspace UI state.
 *
 * The browser owns ONLY selection, filters and polling preference (ADR-119 /
 * ADR-130). Everything else — Principal, Project, access, policy, capability,
 * sensitivity, projection revision and Retry/Cancel authority — is
 * server-derived and never authored here.
 */

export const ACTIVITY_DOMAIN_KIND_OPTIONS: readonly ActivityDomainKindV1[] = [
  'SOURCES',
  'ASK',
  'EXTERNAL_ACTION',
  'DISCOVERY',
];

export const ACTIVITY_LIFECYCLE_STATE_OPTIONS: readonly ActivityLifecycleStateV1[] = [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_USER',
  'PARTIAL',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'OUTCOME_UNKNOWN',
];

export type ActivityAttentionFilter = ActivityAttentionStateV1 | 'ANY';

export const ACTIVITY_ATTENTION_FILTER_OPTIONS: readonly ActivityAttentionFilter[] = [
  'ANY',
  'NEEDS_ATTENTION',
  'RESOLVED',
  'NONE',
];

/** Text labels independent of color (Contract Snapshot §9 accessibility). */
export const activityDomainKindLabel: Record<ActivityDomainKindV1, string> = {
  SOURCES: 'Sources',
  ASK: 'Ask',
  EXTERNAL_ACTION: 'External actions',
  DISCOVERY: 'Discovery',
  CONNECTOR_DIAGNOSTICS: 'Connector',
};

export const activityLifecycleStateLabel: Record<ActivityLifecycleStateV1, string> = {
  QUEUED: '대기 중',
  RUNNING: '실행 중',
  WAITING_FOR_USER: '사용자 대기',
  PARTIAL: '부분 완료',
  SUCCEEDED: '성공',
  FAILED: '실패',
  CANCEL_REQUESTED: '취소 요청됨',
  CANCELLED: '취소됨',
  OUTCOME_UNKNOWN: '결과 불명',
};

export const activityAttentionLabel: Record<ActivityAttentionStateV1, string> = {
  NEEDS_ATTENTION: '주의 필요',
  RESOLVED: '해결됨',
  NONE: '없음',
};

export type ActivityWorkspaceState = {
  readonly domainKinds: readonly ActivityDomainKindV1[];
  readonly states: readonly ActivityLifecycleStateV1[];
  readonly attention: ActivityAttentionFilter;
  readonly selected: ActivityIdentity | null;
  readonly pollingEnabled: boolean;
};

export type ActivityWorkspaceAction =
  | { readonly type: 'TOGGLE_DOMAIN_KIND'; readonly domainKind: ActivityDomainKindV1 }
  | { readonly type: 'TOGGLE_STATE'; readonly state: ActivityLifecycleStateV1 }
  | { readonly type: 'SET_ATTENTION'; readonly attention: ActivityAttentionFilter }
  | { readonly type: 'SELECT_ACTIVITY'; readonly identity: ActivityIdentity }
  | { readonly type: 'CLEAR_SELECTION' }
  | { readonly type: 'SET_POLLING'; readonly enabled: boolean };

export const createInitialActivityWorkspaceState = (): ActivityWorkspaceState => ({
  domainKinds: [],
  states: [],
  attention: 'ANY',
  selected: null,
  pollingEnabled: true,
});

const toggle = <T>(list: readonly T[], value: T): readonly T[] =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

export const reduceActivityWorkspaceState = (
  state: ActivityWorkspaceState,
  action: ActivityWorkspaceAction,
): ActivityWorkspaceState => {
  switch (action.type) {
    case 'TOGGLE_DOMAIN_KIND':
      return { ...state, domainKinds: toggle(state.domainKinds, action.domainKind) };
    case 'TOGGLE_STATE':
      return { ...state, states: toggle(state.states, action.state) };
    case 'SET_ATTENTION':
      return { ...state, attention: action.attention };
    case 'SELECT_ACTIVITY':
      return { ...state, selected: action.identity };
    case 'CLEAR_SELECTION':
      return { ...state, selected: null };
    case 'SET_POLLING':
      return { ...state, pollingEnabled: action.enabled };
  }
};

/** Live announcements for meaningful changes only (Contract Snapshot §9). */
export const ACTIVITY_ANNOUNCEMENTS = {
  REFRESHED: '활동 큐를 새로고침했습니다.',
  SELECTED: '활동 세부 정보를 표시합니다.',
  CLEARED: '활동 선택을 해제했습니다.',
  FILTER_CHANGED: '활동 필터를 변경했습니다.',
  CANCELLED: '취소 명령이 owning-Domain으로 전달되었습니다.',
  RETRY_SENT: '재시도 명령이 owning-Domain으로 전달되었습니다.',
} as const;
