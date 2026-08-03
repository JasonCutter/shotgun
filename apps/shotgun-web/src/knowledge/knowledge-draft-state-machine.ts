import type {
  FrontendKnowledgeDraftChangeSetV1,
  FrontendKnowledgeOperationV1,
  ResolveKnowledgeDraftCommandOutcomeResultV1,
  SaveKnowledgeDraftResultV1,
  TypedFrontendFailure,
} from '@shotgun/api-client';

/**
 * FE-P3-S2 Browser Draft State Machine (pure reducer).
 *
 * Owned per route (ADR-119): the browser Draft State Machine owns user edits,
 * dirty state, the immutable first-edit Project/access/policy binding, save
 * status, STALE/conflict transitions and OUTCOME_UNKNOWN recovery. The server
 * Draft is always authoritative: the reducer never merges, auto-refreshes or
 * auto-submits a stale base, and a background refetch can never overwrite a
 * dirty Draft.
 *
 * Command lifecycle (ACCEPTED / COMPLETED / REJECTED / OUTCOME_UNKNOWN) is
 * tracked separately from the Draft lifecycle status. An OUTCOME_UNKNOWN
 * command is resolved exclusively through its original command identity
 * (clientRequestId + idempotencyKey + semanticDigest) and is never resubmitted.
 */

export type KnowledgeDraftBrowserState =
  | 'CLEAN' // no unsaved edits; the Draft is in sync with the server
  | 'DIRTY' // unsaved local edits
  | 'SAVING' // a Save command is in flight
  | 'SAVE_FAILED' // deterministic failure (validation, not-found, access)
  | 'STALE' // Project / access / policy / base revision drift detected
  | 'CONFLICT' // the server rejected the Save with DRAFT_REVISION_CONFLICT
  | 'OUTCOME_UNKNOWN'; // command outcome unknown; recover by original identity

/** Original command identity kept for OUTCOME_UNKNOWN recovery. */
export type KnowledgeDraftCommandIdentityV1 = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly semanticDigest: string;
};

/** Immutable server context pinned on the first edit. */
export type KnowledgeDraftPinnedContextV1 = {
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly baseCanonicalSnapshotId: string;
  readonly baseCanonicalVersion: number;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly serverDraftRevision: number;
};

export type KnowledgeDraftBrowserStateSnapshot = {
  readonly state: KnowledgeDraftBrowserState;
  /** Last server-synced Draft. Server Draft is always authoritative. */
  readonly draft: FrontendKnowledgeDraftChangeSetV1 | null;
  /** Unsaved local operations (never merged into `draft` until a Save). */
  readonly localOperations: readonly FrontendKnowledgeOperationV1[];
  readonly isDirty: boolean;
  readonly pinnedContext: KnowledgeDraftPinnedContextV1 | null;
  readonly commandIdentity: KnowledgeDraftCommandIdentityV1 | null;
  readonly failure: TypedFrontendFailure | null;
  readonly errorMessage: string | null;
  readonly isRecovering: boolean;
  readonly lastSaveResult: SaveKnowledgeDraftResultV1 | null;
};

export const createKnowledgeDraftState = (
  draft: FrontendKnowledgeDraftChangeSetV1 | null,
): KnowledgeDraftBrowserStateSnapshot => ({
  state: 'CLEAN',
  draft,
  localOperations: [],
  isDirty: false,
  pinnedContext: null,
  commandIdentity: null,
  failure: null,
  errorMessage: null,
  isRecovering: false,
  lastSaveResult: null,
});

/** Derives the immutable context snapshot from a server Draft. */
export const contextFromDraft = (
  draft: FrontendKnowledgeDraftChangeSetV1,
  activeProjectId: string,
): KnowledgeDraftPinnedContextV1 => ({
  activeProjectId,
  resourceProjectId: draft.resourceProjectId,
  draftProjectId: draft.draftProjectId,
  effectiveProjectId: draft.effectiveProjectId,
  baseCanonicalSnapshotId: draft.base.canonicalSnapshotId,
  baseCanonicalVersion: draft.base.canonicalVersion,
  accessRevision: draft.base.accessRevision,
  policyContextRevision: draft.base.policyContextRevision,
  serverDraftRevision: draft.revision,
});

export type KnowledgeDraftAction =
  | {
      readonly type: 'SYNC_SERVER_DRAFT';
      readonly draft: FrontendKnowledgeDraftChangeSetV1;
      readonly liveContext: KnowledgeDraftPinnedContextV1;
    }
  | {
      readonly type: 'EDIT';
      readonly operations: readonly FrontendKnowledgeOperationV1[];
      readonly liveContext: KnowledgeDraftPinnedContextV1;
    }
  | { readonly type: 'SAVE_START'; readonly identity: KnowledgeDraftCommandIdentityV1 }
  | { readonly type: 'SAVE_SUCCEEDED'; readonly result: SaveKnowledgeDraftResultV1 }
  | {
      readonly type: 'SAVE_FAILED';
      readonly failure: TypedFrontendFailure | null;
      readonly message: string;
    }
  | { readonly type: 'DETECT_DRIFT'; readonly liveContext: KnowledgeDraftPinnedContextV1 }
  | { readonly type: 'MARK_STALE'; readonly message: string }
  | { readonly type: 'RESET' }
  | { readonly type: 'RECOVER_START' }
  | {
      readonly type: 'RECOVER_SUCCEEDED';
      readonly result: ResolveKnowledgeDraftCommandOutcomeResultV1;
    }
  | { readonly type: 'RECOVER_UNRESOLVED'; readonly message: string };

const contextEquals = (
  left: KnowledgeDraftPinnedContextV1,
  right: KnowledgeDraftPinnedContextV1,
): boolean =>
  left.activeProjectId === right.activeProjectId &&
  left.resourceProjectId === right.resourceProjectId &&
  left.draftProjectId === right.draftProjectId &&
  left.effectiveProjectId === right.effectiveProjectId &&
  left.baseCanonicalSnapshotId === right.baseCanonicalSnapshotId &&
  left.baseCanonicalVersion === right.baseCanonicalVersion &&
  left.accessRevision === right.accessRevision &&
  left.policyContextRevision === right.policyContextRevision &&
  left.serverDraftRevision === right.serverDraftRevision;

const driftMessage = (
  pinned: KnowledgeDraftPinnedContextV1,
  live: KnowledgeDraftPinnedContextV1,
): string => {
  const projectChanged =
    pinned.activeProjectId !== live.activeProjectId ||
    pinned.resourceProjectId !== live.resourceProjectId ||
    pinned.draftProjectId !== live.draftProjectId ||
    pinned.effectiveProjectId !== live.effectiveProjectId;
  if (projectChanged) {
    return 'Project context changed while this Knowledge Draft was open.';
  }
  const revisionChanged =
    pinned.baseCanonicalSnapshotId !== live.baseCanonicalSnapshotId ||
    pinned.baseCanonicalVersion !== live.baseCanonicalVersion ||
    pinned.serverDraftRevision !== live.serverDraftRevision;
  if (revisionChanged) {
    return `The Canonical base changed from ${pinned.baseCanonicalVersion} to ${live.baseCanonicalVersion}.`;
  }
  return 'Access or policy context changed while this Knowledge Draft was open.';
};

const stateAfterFailure = (
  failure: TypedFrontendFailure | null,
): Exclude<KnowledgeDraftBrowserState, 'CLEAN' | 'DIRTY' | 'SAVING'> => {
  if (failure?.state === 'OUTCOME_UNKNOWN') return 'OUTCOME_UNKNOWN';
  if (failure?.code === 'DRAFT_REVISION_CONFLICT') return 'CONFLICT';
  if (failure?.state === 'STALE') return 'STALE';
  return 'SAVE_FAILED';
};

export const knowledgeDraftReducer = (
  state: KnowledgeDraftBrowserStateSnapshot,
  action: KnowledgeDraftAction,
): KnowledgeDraftBrowserStateSnapshot => {
  switch (action.type) {
    case 'SYNC_SERVER_DRAFT': {
      // Background refetch protection: a dirty Draft is never overwritten.
      if (state.isDirty) {
        // Do not disturb an in-flight Save or an unresolved command.
        if (state.state === 'SAVING' || state.state === 'OUTCOME_UNKNOWN') return state;
        if (
          state.pinnedContext &&
          !contextEquals(state.pinnedContext, action.liveContext) &&
          state.state !== 'STALE' &&
          state.state !== 'CONFLICT'
        ) {
          return {
            ...state,
            state: 'STALE',
            failure: null,
            errorMessage: driftMessage(state.pinnedContext, action.liveContext),
          };
        }
        return state;
      }
      return {
        ...state,
        draft: action.draft,
        state: 'CLEAN',
        localOperations: [],
        isDirty: false,
        pinnedContext: null,
        commandIdentity: null,
        failure: null,
        errorMessage: null,
        isRecovering: false,
        lastSaveResult: null,
      };
    }
    case 'EDIT': {
      if (!state.draft) {
        return { ...state, errorMessage: 'No Knowledge Draft is open for editing.' };
      }
      const firstEdit = !state.isDirty;
      return {
        ...state,
        state: 'DIRTY',
        localOperations: [...state.localOperations, ...action.operations],
        isDirty: true,
        // Immutable first-edit pinning: the context is pinned on the first
        // edit and released only by an explicit RESET / successful Save.
        pinnedContext: firstEdit ? action.liveContext : (state.pinnedContext ?? action.liveContext),
        failure: null,
        errorMessage: null,
      };
    }
    case 'SAVE_START': {
      if (!state.isDirty || state.state === 'SAVING') return state;
      return {
        ...state,
        state: 'SAVING',
        commandIdentity: action.identity,
        failure: null,
        errorMessage: null,
        isRecovering: false,
      };
    }
    case 'SAVE_SUCCEEDED': {
      // The server Draft is authoritative: adopt it and release the pin.
      return {
        ...state,
        state: 'CLEAN',
        draft: action.result.draft,
        localOperations: [],
        isDirty: false,
        pinnedContext: null,
        commandIdentity: null,
        failure: null,
        errorMessage: null,
        isRecovering: false,
        lastSaveResult: action.result,
      };
    }
    case 'SAVE_FAILED': {
      const outcomeUnknown = action.failure?.state === 'OUTCOME_UNKNOWN';
      return {
        ...state,
        state: stateAfterFailure(action.failure),
        failure: action.failure,
        errorMessage: action.message,
        // The original command identity is kept only for OUTCOME_UNKNOWN
        // recovery; deterministic failures clear it.
        commandIdentity: outcomeUnknown ? state.commandIdentity : null,
        isRecovering: false,
      };
    }
    case 'DETECT_DRIFT': {
      if (!state.pinnedContext || !state.isDirty) return state;
      if (contextEquals(state.pinnedContext, action.liveContext)) return state;
      if (
        state.state === 'STALE' ||
        state.state === 'CONFLICT' ||
        state.state === 'OUTCOME_UNKNOWN' ||
        state.state === 'SAVING'
      ) {
        return state;
      }
      return {
        ...state,
        state: 'STALE',
        failure: null,
        errorMessage: driftMessage(state.pinnedContext, action.liveContext),
      };
    }
    case 'MARK_STALE': {
      return {
        ...state,
        state: 'STALE',
        failure: null,
        errorMessage: action.message,
      };
    }
    case 'RESET': {
      // Explicit reset: discards local edits and releases the pin. The
      // server Draft is never touched; the next SYNC re-adopts it.
      return {
        ...state,
        state: 'CLEAN',
        localOperations: [],
        isDirty: false,
        pinnedContext: null,
        commandIdentity: null,
        failure: null,
        errorMessage: null,
        isRecovering: false,
        lastSaveResult: null,
      };
    }
    case 'RECOVER_START': {
      return { ...state, isRecovering: true, errorMessage: null };
    }
    case 'RECOVER_SUCCEEDED': {
      if (action.result.outcome === 'COMPLETED' && action.result.draft) {
        return {
          ...state,
          state: 'CLEAN',
          draft: action.result.draft,
          localOperations: [],
          isDirty: false,
          pinnedContext: null,
          commandIdentity: null,
          failure: null,
          errorMessage: null,
          isRecovering: false,
        };
      }
      if (action.result.outcome === 'REJECTED') {
        // The Save was rejected; the edits are preserved for the user.
        return {
          ...state,
          state: 'DIRTY',
          commandIdentity: null,
          failure: null,
          errorMessage: 'The previous Save was rejected by the server; the edits are preserved.',
          isRecovering: false,
        };
      }
      // Still OUTCOME_UNKNOWN: the command outcome remains unresolved.
      return {
        ...state,
        state: 'OUTCOME_UNKNOWN',
        isRecovering: false,
        errorMessage: 'The command outcome is still unresolved.',
      };
    }
    case 'RECOVER_UNRESOLVED': {
      return {
        ...state,
        state: 'OUTCOME_UNKNOWN',
        isRecovering: false,
        errorMessage: action.message,
      };
    }
    default:
      // All actions are handled above; this arm is unreachable by
      // construction because the action union is fully covered.
      return state;
  }
};
