import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ShotgunApiError,
  deriveFrontendFailure,
  frontendKnowledgeDraftRevisionDigest,
  frontendKnowledgeDraftSaveDigest,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeDraftClient,
  type FrontendKnowledgeOperationV1,
  type ResolveKnowledgeDraftCommandOutcomeResultV1,
  type SaveKnowledgeDraftResultV1,
  type TypedFrontendFailure,
} from '@shotgun/api-client';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import {
  contextFromDraft,
  createKnowledgeDraftState,
  knowledgeDraftReducer,
  type KnowledgeDraftBrowserStateSnapshot,
  type KnowledgeDraftPinnedContextV1,
} from './knowledge-draft-state-machine.js';
import {
  clearPendingKnowledgeDraftCommandIdentity,
  readPendingKnowledgeDraftCommandIdentity,
  writePendingKnowledgeDraftCommandIdentity,
  type PendingCommandStorage,
} from './pending-draft-command-storage.js';

const typedFailureFrom = (error: unknown): TypedFrontendFailure | null =>
  error instanceof ShotgunApiError && error.failure
    ? deriveFrontendFailure(error.failure.code)
    : null;

const freshRequestId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** sessionStorage is best-effort: unavailable storage never breaks editing. */
const getSessionStorage = (): PendingCommandStorage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export type KnowledgeDraftSaveClient = Pick<FrontendKnowledgeDraftClient, 'saveDraft'>;
export type KnowledgeDraftResolveClient = Pick<
  FrontendKnowledgeDraftClient,
  'resolveCommandOutcome'
>;
export type KnowledgeDraftReloadClient = Pick<FrontendKnowledgeDraftClient, 'readDraft'>;

/**
 * Route-scoped FE-P3-S2 Browser Draft State Machine controller hook.
 *
 * The server Draft is authoritative: the hook never auto-merges or
 * auto-refreshes a stale base, a background refetch can never overwrite a
 * dirty Draft, Project/access/policy drift fails closed to STALE, and an
 * OUTCOME_UNKNOWN command is recovered exclusively through its original
 * command identity (never resubmitted). Edits are expressed as typed
 * operations and persisted only through an explicit Save.
 */
export type KnowledgeDraftController = {
  readonly draftState: KnowledgeDraftBrowserStateSnapshot;
  readonly editOperations: (operations: readonly FrontendKnowledgeOperationV1[]) => void;
  readonly save: (client: KnowledgeDraftSaveClient) => Promise<SaveKnowledgeDraftResultV1 | null>;
  readonly recoverOutcomeUnknown: (
    client: KnowledgeDraftResolveClient,
  ) => Promise<ResolveKnowledgeDraftCommandOutcomeResultV1 | null>;
  readonly reset: () => void;
  readonly reload: (
    client: KnowledgeDraftReloadClient,
  ) => Promise<FrontendKnowledgeDraftChangeSetV1 | null>;
  readonly markStale: (message?: string) => void;
};

export const useKnowledgeDraft = (
  serverDraft: FrontendKnowledgeDraftChangeSetV1 | null | undefined,
  sessionActiveProjectId?: string,
  sessionId?: string,
): KnowledgeDraftController => {
  const liveContext = useMemo<KnowledgeDraftPinnedContextV1 | null>(() => {
    if (!serverDraft) return null;
    return contextFromDraft(serverDraft, sessionActiveProjectId ?? serverDraft.activeProjectId);
  }, [serverDraft, sessionActiveProjectId]);

  const [draftState, dispatch] = useReducer(
    knowledgeDraftReducer,
    serverDraft ?? null,
    createKnowledgeDraftState,
  );

  // Keep a ref so async actions read the latest state synchronously.
  const draftStateRef = useRef(draftState);
  draftStateRef.current = draftState;
  const liveContextRef = useRef(liveContext);
  liveContextRef.current = liveContext;

  const { registerLeaveGuard } = useLeaveGuard();

  // Adopt server Draft updates (background refetch) — the reducer protects a
  // dirty Draft from being overwritten.
  useEffect(() => {
    if (serverDraft && liveContext) {
      dispatch({ type: 'SYNC_SERVER_DRAFT', draft: serverDraft, liveContext });
    }
  }, [serverDraft, liveContext]);

  // Project / access / policy / base revision drift detection.
  useEffect(() => {
    if (liveContext) {
      dispatch({ type: 'DETECT_DRIFT', liveContext });
    }
  }, [liveContext]);

  // Leave guard: block navigation while there are unsaved edits (isDirty —
  // DIRTY / SAVING / SAVE_FAILED) or the Draft is stale / conflicted /
  // unresolved.
  useEffect(() => {
    const current = draftStateRef.current;
    const hasUnsavedDraft = current.isDirty;
    const blocks =
      hasUnsavedDraft ||
      current.state === 'STALE' ||
      current.state === 'CONFLICT' ||
      current.state === 'OUTCOME_UNKNOWN';

    return registerLeaveGuard(() => ({
      canLeaveCurrentContext: !blocks,
      hasUnsavedDraft,
      hasBlockingDialog: false,
      hasOutcomeUnknownCommand: current.state === 'OUTCOME_UNKNOWN',
    }));
  }, [registerLeaveGuard, draftState.state, draftState.isDirty]);

  const projectId = draftState.draft?.activeProjectId ?? null;
  const draftId = draftState.draft?.draftId ?? null;

  // Restore a pending OUTCOME_UNKNOWN command identity after a page reload.
  // The identity is scoped to this Session / Project / Draft; recovery only
  // resolves the original command and never resubmits a Save.
  useEffect(() => {
    const storage = getSessionStorage();
    if (!storage || !sessionId || !projectId || !draftId) return;
    const current = draftStateRef.current;
    if (current.state === 'OUTCOME_UNKNOWN' && current.commandIdentity) return;
    const pending = readPendingKnowledgeDraftCommandIdentity(
      storage,
      sessionId,
      projectId,
      draftId,
    );
    if (!pending) return;
    dispatch({
      type: 'RESTORE_PENDING_COMMAND',
      identity: {
        clientRequestId: pending.clientRequestId,
        idempotencyKey: pending.idempotencyKey,
        semanticDigest: pending.semanticDigest,
      },
    });
  }, [sessionId, projectId, draftId]);

  // Persist the pending identity only while OUTCOME_UNKNOWN; clear it on
  // COMPLETED, REJECTED, reset or any terminal state.
  useEffect(() => {
    const storage = getSessionStorage();
    if (!storage || !sessionId || !projectId || !draftId) return;
    if (draftState.state === 'OUTCOME_UNKNOWN' && draftState.commandIdentity) {
      writePendingKnowledgeDraftCommandIdentity(storage, {
        clientRequestId: draftState.commandIdentity.clientRequestId,
        idempotencyKey: draftState.commandIdentity.idempotencyKey,
        semanticDigest: draftState.commandIdentity.semanticDigest,
        sessionId,
        projectId,
        draftId,
      });
      return;
    }
    clearPendingKnowledgeDraftCommandIdentity(storage, sessionId, projectId, draftId);
  }, [draftState.state, draftState.commandIdentity, sessionId, projectId, draftId]);

  const editOperations = useCallback((operations: readonly FrontendKnowledgeOperationV1[]) => {
    const live = liveContextRef.current;
    if (!live) return;
    if (operations.length === 0) return;
    dispatch({ type: 'EDIT', operations, liveContext: live });
  }, []);

  const save = useCallback(
    async (client: KnowledgeDraftSaveClient): Promise<SaveKnowledgeDraftResultV1 | null> => {
      const current = draftStateRef.current;
      if (!current.draft || !current.isDirty) return null;
      // Fail closed: an unresolved, stale or conflicted Draft must be
      // recovered or reset first; the server Draft is never auto-refreshed.
      if (
        current.state === 'OUTCOME_UNKNOWN' ||
        current.state === 'STALE' ||
        current.state === 'CONFLICT' ||
        current.state === 'SAVING'
      ) {
        return null;
      }

      const draft = current.draft;
      const draftId = draft.draftId;
      const expectedDraftRevision = draft.revision;
      const expectedBaseRevision = draft.base.canonicalVersion;
      const operationRevision = expectedDraftRevision + 1;
      const operations = [...draft.operations, ...current.localOperations];
      const contentDigest = frontendKnowledgeDraftRevisionDigest({
        draftId,
        revision: operationRevision,
        base: draft.base,
        operations,
      });
      const clientRequestId = freshRequestId('draft-req');
      const idempotencyKey = freshRequestId('draft-idem');
      const semanticDigest = frontendKnowledgeDraftSaveDigest({
        schemaVersion: '1.0.0',
        clientRequestId,
        idempotencyKey,
        draftId,
        expectedDraftRevision,
        expectedBaseRevision,
        operationRevision,
        operations,
        contentDigest,
      });

      dispatch({
        type: 'SAVE_START',
        identity: { clientRequestId, idempotencyKey, semanticDigest },
      });

      try {
        const result = await client.saveDraft({
          schemaVersion: '1.0.0',
          clientRequestId,
          idempotencyKey,
          draftId,
          expectedDraftRevision,
          expectedBaseRevision,
          operationRevision,
          operations,
          contentDigest,
        });
        dispatch({ type: 'SAVE_SUCCEEDED', result });
        return result;
      } catch (error) {
        const failure = typedFailureFrom(error);
        dispatch({
          type: 'SAVE_FAILED',
          failure,
          message: error instanceof Error ? error.message : 'Save failed.',
        });
        throw error;
      }
    },
    [],
  );

  const recoverOutcomeUnknown = useCallback(
    async (
      client: KnowledgeDraftResolveClient,
    ): Promise<ResolveKnowledgeDraftCommandOutcomeResultV1 | null> => {
      const identity = draftStateRef.current.commandIdentity;
      if (!identity) return null;
      dispatch({ type: 'RECOVER_START' });
      try {
        let lastResult: ResolveKnowledgeDraftCommandOutcomeResultV1 | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          lastResult = await client.resolveCommandOutcome({
            schemaVersion: '1.0.0',
            clientRequestId: identity.clientRequestId,
            idempotencyKey: identity.idempotencyKey,
            semanticDigest: identity.semanticDigest,
          });
          dispatch({ type: 'RECOVER_SUCCEEDED', result: lastResult });
          if (lastResult.outcome !== 'OUTCOME_UNKNOWN') {
            return lastResult;
          }
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        return lastResult;
      } catch (error) {
        dispatch({
          type: 'RECOVER_UNRESOLVED',
          message:
            error instanceof Error ? error.message : 'The command outcome could not be resolved.',
        });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const reload = useCallback(
    async (
      client: KnowledgeDraftReloadClient,
    ): Promise<FrontendKnowledgeDraftChangeSetV1 | null> => {
      const current = draftStateRef.current;
      // A dirty Draft is never overwritten by a reload.
      if (!current.draft || current.isDirty) return null;
      const clientRequestId = freshRequestId('draft-reload');
      const idempotencyKey = freshRequestId('draft-reload');
      const result = await client.readDraft({
        schemaVersion: '1.0.0',
        clientRequestId,
        idempotencyKey,
        draftId: current.draft.draftId,
      });
      const fresh = result.draft;
      dispatch({
        type: 'SYNC_SERVER_DRAFT',
        draft: fresh,
        liveContext: contextFromDraft(fresh, current.draft.activeProjectId),
      });
      return fresh;
    },
    [],
  );

  const markStale = useCallback((message?: string) => {
    dispatch({
      type: 'MARK_STALE',
      message: message ?? 'The Knowledge Draft is stale; reset to continue editing.',
    });
  }, []);

  return {
    draftState,
    editOperations,
    save,
    recoverOutcomeUnknown,
    reset,
    reload,
    markStale,
  };
};
