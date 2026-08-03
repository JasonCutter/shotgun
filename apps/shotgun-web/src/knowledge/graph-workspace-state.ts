import type {
  GraphBaseViewKindV1,
  GraphNodeReferenceV1,
  GraphOverlayKindV1,
  GraphResultCompletenessV1,
  GraphTruncationStateV1,
  GraphUnavailableReasonV1,
} from '@shotgun/api-client';

/**
 * FE-P3-S3 Graph Workspace browser state (ADR-119 ownership).
 *
 * This state machine owns selection, focus, filters, overlays and recovery
 * only. It never performs a graph write: every mutation here is a pure,
 * replayable transition over read-derived data. Layout/zoom/pan state never
 * leaves the browser and is not part of this machine.
 */

export const GRAPH_BASE_VIEWS: readonly GraphBaseViewKindV1[] = [
  'KNOWLEDGE_SEMANTIC',
  'GOVERNANCE_IMPACT',
  'OPERATIONAL_DEPENDENCY',
] as const;

export const GRAPH_OVERLAY_KINDS: readonly GraphOverlayKindV1[] = [
  'CONFLICT',
  'KNOWLEDGE_GAP',
  'RECURSIVE_IMPACT',
] as const;

export type GraphViewKind = 'canvas' | 'list' | 'table' | 'path';

export const GRAPH_VIEW_KINDS: readonly GraphViewKind[] = [
  'canvas',
  'list',
  'table',
  'path',
] as const;

export type GraphWorkspacePhase =
  | { kind: 'IDLE' }
  | { kind: 'SNAPSHOT_LOADING' }
  | { kind: 'SNAPSHOT_READY' }
  | { kind: 'OPERATION_LOADING' }
  | { kind: 'FAILED'; reason: GraphUnavailableReasonV1; message: string; retryable: boolean }
  | { kind: 'BLOCKED'; message: string };

export type GraphRecoveryState =
  | { kind: 'NONE' }
  | { kind: 'RESTORING'; targetRef: GraphNodeReferenceV1 }
  | { kind: 'REFRESHING' };

export type GraphWorkspaceState = {
  readonly viewKind: GraphViewKind;
  readonly baseView: GraphBaseViewKindV1;
  readonly overlayKinds: readonly GraphOverlayKindV1[];
  readonly selectedRef: GraphNodeReferenceV1 | null;
  readonly focusedRef: GraphNodeReferenceV1 | null;
  readonly snapshotId: string | null;
  readonly projectionRevision: string | null;
  readonly pathId: string | null;
  readonly phase: GraphWorkspacePhase;
  readonly recovery: GraphRecoveryState;
};

export type GraphWorkspaceAction =
  | { type: 'SET_VIEW'; view: GraphViewKind }
  | { type: 'SET_BASE_VIEW'; baseView: GraphBaseViewKindV1 }
  | { type: 'TOGGLE_OVERLAY'; overlay: GraphOverlayKindV1 }
  | { type: 'SELECT_NODE'; ref: GraphNodeReferenceV1 }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'FOCUS_NODE'; ref: GraphNodeReferenceV1 }
  | { type: 'SET_PATH'; pathId: string }
  | { type: 'CLEAR_PATH' }
  | { type: 'SNAPSHOT_STARTED' }
  | { type: 'SNAPSHOT_RESOLVED'; snapshotId: string; projectionRevision: string }
  | { type: 'OPERATION_STARTED' }
  | { type: 'FAILED'; reason: GraphUnavailableReasonV1; message: string; retryable: boolean }
  | { type: 'BLOCKED'; message: string }
  | { type: 'RECOVERY_STARTED'; targetRef?: GraphNodeReferenceV1 }
  | { type: 'RECOVERY_FINISHED' };

export const createInitialGraphWorkspaceState = (): GraphWorkspaceState => ({
  viewKind: 'canvas',
  baseView: 'KNOWLEDGE_SEMANTIC',
  overlayKinds: [],
  selectedRef: null,
  focusedRef: null,
  snapshotId: null,
  projectionRevision: null,
  pathId: null,
  phase: { kind: 'IDLE' },
  recovery: { kind: 'NONE' },
});

/**
 * Frozen announcement strings (AC-21). These exact strings are asserted by
 * browser E2E tests and must not change without a contract revision.
 */
export const GRAPH_ANNOUNCEMENTS = {
  SELECTION: (label: string) => `선택됨: ${label}`,
  DESELECTION: (label: string) => `선택 해제됨: ${label}`,
  EXPANSION: (label: string) => `확장됨: ${label}`,
  PATH: (summary: string) => `경로: ${summary}`,
  TRUNCATION: (truncation: GraphTruncationStateV1) =>
    `결과가 잘렸습니다: 노드 ${truncation.omittedNodeCount}개, 엣지 ${truncation.omittedEdgeCount}개 생략`,
  STALE: '스냅샷이 오래되었습니다. 새로 고침이 필요합니다.',
  REBUILDING: '투영이 재구축 중입니다.',
  PARTIAL: '결과가 부분적입니다.',
  UNAVAILABLE: '그래프를 사용할 수 없습니다.',
  ACCESS_RESTRICTED: '그래프 접근이 제한되었습니다.',
  RECOVERY: '읽기 복구를 수행합니다.',
  REFRESH: '스냅샷을 새로 고칩니다.',
  VIEW: (view: GraphViewKind) => `뷰 전환: ${view}`,
} as const;

export const completenessAnnouncement = (completeness: GraphResultCompletenessV1): string => {
  if (completeness === 'TRUNCATED') return '결과가 잘렸습니다.';
  if (completeness === 'PARTIAL') return GRAPH_ANNOUNCEMENTS.PARTIAL;
  return '';
};

export const reduceGraphWorkspaceState = (
  state: GraphWorkspaceState,
  action: GraphWorkspaceAction,
): GraphWorkspaceState => {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, viewKind: action.view };
    case 'SET_BASE_VIEW':
      return {
        ...state,
        baseView: action.baseView,
        selectedRef: null,
        focusedRef: null,
        snapshotId: null,
        projectionRevision: null,
        pathId: null,
        phase: { kind: 'IDLE' },
      };
    case 'TOGGLE_OVERLAY': {
      const enabled = state.overlayKinds.includes(action.overlay);
      const overlayKinds = enabled
        ? state.overlayKinds.filter((kind) => kind !== action.overlay)
        : [...state.overlayKinds, action.overlay];
      return { ...state, overlayKinds };
    }
    case 'SELECT_NODE':
      return { ...state, selectedRef: action.ref, focusedRef: action.ref };
    case 'CLEAR_SELECTION':
      return { ...state, selectedRef: null };
    case 'FOCUS_NODE':
      return { ...state, focusedRef: action.ref };
    case 'SET_PATH':
      return { ...state, pathId: action.pathId, viewKind: 'path' };
    case 'CLEAR_PATH':
      return { ...state, pathId: null, viewKind: 'canvas' };
    case 'SNAPSHOT_STARTED':
      return { ...state, phase: { kind: 'SNAPSHOT_LOADING' }, recovery: { kind: 'NONE' } };
    case 'SNAPSHOT_RESOLVED':
      return {
        ...state,
        snapshotId: action.snapshotId,
        projectionRevision: action.projectionRevision,
        phase: { kind: 'SNAPSHOT_READY' },
      };
    case 'OPERATION_STARTED':
      return { ...state, phase: { kind: 'OPERATION_LOADING' } };
    case 'FAILED':
      return {
        ...state,
        phase: { kind: 'FAILED', ...action },
      };
    case 'BLOCKED':
      return { ...state, phase: { kind: 'BLOCKED', message: action.message } };
    case 'RECOVERY_STARTED':
      return {
        ...state,
        recovery: action.targetRef
          ? { kind: 'RESTORING', targetRef: action.targetRef }
          : { kind: 'REFRESHING' },
        phase: { kind: 'OPERATION_LOADING' },
      };
    case 'RECOVERY_FINISHED':
      return { ...state, recovery: { kind: 'NONE' } };
    default:
      return state;
  }
};
