import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  SettingsDraftState,
  SettingsSnapshot,
  SettingsValidationResult,
  SettingsImpactPreview,
  SettingsCommandResult,
  FrontendCommandOutcomeView,
  FrontendCommandMutationResponse,
} from '@shotgun/api-client';
import { useLeaveGuard } from './leave-guard-context.js';

export type SettingsDraftController = {
  readonly state: SettingsDraftState;
  readonly targetProjectId: string;
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly expectedSettingsRevision: number;
  readonly observedPolicyContextRevision: number;
  readonly draft: Record<string, unknown>;
  readonly isDirty: boolean;
  readonly validationResult: SettingsValidationResult | null;
  readonly impactPreview: SettingsImpactPreview | null;
  readonly commandResult: SettingsCommandResult | null;
  readonly errorMessage: string | null;
  readonly clientRequestId: string | null;
  readonly idempotencyKey: string | null;
  readonly setDraftValue: (key: string, value: unknown) => void;
  readonly resetDraft: () => void;
  readonly validate: (apiClient: {
    validateSettingsDraft: (
      draft: Record<string, unknown>,
      targetProjectId?: string,
    ) => Promise<SettingsValidationResult>;
  }) => Promise<SettingsValidationResult>;
  readonly previewImpact: (apiClient: {
    previewSettingsImpact: (
      expectedSettingsRevision: number,
      observedPolicyContextRevision: number,
      draft: Record<string, unknown>,
      targetProjectId?: string,
    ) => Promise<SettingsImpactPreview>;
  }) => Promise<SettingsImpactPreview | null>;
  readonly applyCommand: (apiClient: {
    applySettingsCommand: (params: {
      activeProjectId: string;
      targetProjectId: string;
      resourceProjectId: string;
      clientRequestId: string;
      idempotencyKey: string;
      expectedSettingsRevision: number;
      observedPolicyContextRevision: number;
      settings: Record<string, unknown>;
    }) => Promise<FrontendCommandMutationResponse<SettingsCommandResult>>;
    getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
  }) => Promise<SettingsCommandResult>;
  readonly recoverOutcomeUnknown: (apiClient: {
    getFrontendCommandOutcomeByClientRequestId: (
      clientRequestId: string,
    ) => Promise<FrontendCommandOutcomeView>;
    getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
  }) => Promise<SettingsCommandResult | null>;
  readonly markStale: (newServerRevision: number) => void;
};

type PinnedSettingsDraftContext = {
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly resourceProjectId: string;
  readonly settingsRevision: number;
  readonly policyContextRevision: number;
};

export const useSettingsDraft = (
  snapshot: SettingsSnapshot | null | undefined,
  sessionActiveProjectId?: string,
): SettingsDraftController => {
  const liveContext = useMemo<PinnedSettingsDraftContext>(() => {
    const targetProjectId = snapshot?.targetProjectId ?? '';
    const settingsRevision = snapshot?.settingsRevision ?? 1;
    return {
      activeProjectId: sessionActiveProjectId ?? targetProjectId,
      targetProjectId,
      resourceProjectId: targetProjectId,
      settingsRevision,
      policyContextRevision: snapshot?.policyContextRevision ?? settingsRevision,
    };
  }, [
    sessionActiveProjectId,
    snapshot?.policyContextRevision,
    snapshot?.settingsRevision,
    snapshot?.targetProjectId,
  ]);

  const [state, setState] = useState<SettingsDraftState>('CLEAN');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [pinnedContext, setPinnedContext] = useState<PinnedSettingsDraftContext | null>(null);
  const [validationResult, setValidationResult] = useState<SettingsValidationResult | null>(null);
  const [impactPreview, setImpactPreview] = useState<SettingsImpactPreview | null>(null);
  const [commandResult, setCommandResult] = useState<SettingsCommandResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const isDirty = useMemo(() => Object.keys(draft).length > 0, [draft]);
  const effectiveContext = pinnedContext ?? liveContext;
  const {
    activeProjectId,
    targetProjectId,
    resourceProjectId,
    settingsRevision: expectedSettingsRevision,
    policyContextRevision: observedPolicyContextRevision,
  } = effectiveContext;
  const { registerLeaveGuard } = useLeaveGuard();

  // Option B Leave Guard: Register dirty state
  useEffect(() => {
    const shouldBlock =
      isDirty ||
      state === 'VALIDATING' ||
      state === 'READY_TO_APPLY' ||
      state === 'APPLYING' ||
      state === 'OUTCOME_UNKNOWN' ||
      state === 'STALE';

    return registerLeaveGuard(() => ({
      canLeaveCurrentContext: !shouldBlock,
      hasUnsavedDraft: isDirty,
      hasBlockingDialog: state === 'READY_TO_APPLY',
      hasOutcomeUnknownCommand: state === 'OUTCOME_UNKNOWN',
    }));
  }, [registerLeaveGuard, isDirty, state]);

  useEffect(() => {
    if (
      !pinnedContext ||
      !isDirty ||
      state === 'STALE' ||
      state === 'APPLYING' ||
      state === 'OUTCOME_UNKNOWN'
    ) {
      return;
    }

    const projectChanged =
      liveContext.activeProjectId !== pinnedContext.activeProjectId ||
      liveContext.targetProjectId !== pinnedContext.targetProjectId ||
      liveContext.resourceProjectId !== pinnedContext.resourceProjectId;
    const revisionChanged =
      liveContext.settingsRevision !== pinnedContext.settingsRevision ||
      liveContext.policyContextRevision !== pinnedContext.policyContextRevision;

    if (!projectChanged && !revisionChanged) return;

    setState('STALE');
    setValidationResult(null);
    setImpactPreview(null);
    setErrorMessage(
      projectChanged
        ? 'Project context changed while this Settings draft was open.'
        : `Server settings or policy revision changed from ${pinnedContext.settingsRevision}/${pinnedContext.policyContextRevision} to ${liveContext.settingsRevision}/${liveContext.policyContextRevision}.`,
    );
  }, [isDirty, liveContext, pinnedContext, state]);

  const setDraftValue = useCallback(
    (key: string, value: unknown) => {
      if (!isDirty) setPinnedContext(liveContext);
      setDraft((prev) => ({ ...prev, [key]: value }));
      setState('DIRTY');
      setValidationResult(null);
      setImpactPreview(null);
      setErrorMessage(null);
    },
    [isDirty, liveContext],
  );

  const resetDraft = useCallback(() => {
    setDraft({});
    setPinnedContext(null);
    setState('CLEAN');
    setValidationResult(null);
    setImpactPreview(null);
    setCommandResult(null);
    setErrorMessage(null);
    setClientRequestId(null);
    setIdempotencyKey(null);
  }, []);

  const validate = useCallback(
    async (apiClient: {
      validateSettingsDraft: (
        draft: Record<string, unknown>,
        targetProjectId?: string,
      ) => Promise<SettingsValidationResult>;
    }): Promise<SettingsValidationResult> => {
      setState('VALIDATING');
      try {
        const res = await apiClient.validateSettingsDraft(draft, targetProjectId);
        setValidationResult(res);
        if (res.isValid) {
          setState('READY_TO_APPLY');
        } else {
          setState('VALIDATION_FAILED');
        }
        return res;
      } catch (err) {
        setState('VALIDATION_FAILED');
        const msg = err instanceof Error ? err.message : 'Validation failed';
        setErrorMessage(msg);
        throw err;
      }
    },
    [draft, targetProjectId],
  );

  const previewImpact = useCallback(
    async (apiClient: {
      previewSettingsImpact: (
        expectedSettingsRevision: number,
        observedPolicyContextRevision: number,
        draft: Record<string, unknown>,
        targetProjectId?: string,
      ) => Promise<SettingsImpactPreview>;
    }): Promise<SettingsImpactPreview | null> => {
      try {
        const preview = await apiClient.previewSettingsImpact(
          expectedSettingsRevision,
          observedPolicyContextRevision,
          draft,
          targetProjectId,
        );
        setImpactPreview(preview);
        return preview;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Impact preview failed';
        setErrorMessage(msg);
        return null;
      }
    },
    [draft, expectedSettingsRevision, observedPolicyContextRevision, targetProjectId],
  );

  const applyCommand = useCallback(
    async (apiClient: {
      applySettingsCommand: (params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId: string;
        clientRequestId: string;
        idempotencyKey: string;
        expectedSettingsRevision: number;
        observedPolicyContextRevision: number;
        settings: Record<string, unknown>;
      }) => Promise<FrontendCommandMutationResponse<SettingsCommandResult>>;
      getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
    }): Promise<SettingsCommandResult> => {
      setState('APPLYING');
      const reqId = clientRequestId ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const idemKey = idempotencyKey ?? `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setClientRequestId(reqId);
      setIdempotencyKey(idemKey);

      try {
        const response = await apiClient.applySettingsCommand({
          activeProjectId,
          targetProjectId,
          resourceProjectId,
          clientRequestId: reqId,
          idempotencyKey: idemKey,
          expectedSettingsRevision,
          observedPolicyContextRevision,
          settings: draft,
        });
        const result = response.resource;

        setCommandResult(result);

        if (result.status === 'APPLIED') {
          setState('APPLIED');
          setDraft({});
        } else if (result.status === 'REVIEW_REQUIRED') {
          setState('REVIEW_REQUIRED');
        } else if (result.status === 'OUTCOME_UNKNOWN') {
          setState('OUTCOME_UNKNOWN');
        } else {
          setState('APPLY_FAILED');
          setErrorMessage(result.errorMessage ?? 'Apply failed.');
        }

        return result;
      } catch (err: unknown) {
        const errorCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code: unknown }).code)
            : '';
        const isConflict = [
          'CONFLICT',
          'REVISION_CONFLICT',
          'DIGEST_MISMATCH',
          'POLICY_CONTEXT_CHANGED',
        ].includes(errorCode);
        const isTimeoutOrNetwork = [
          'OUTCOME_INDETERMINATE',
          'TIMEOUT',
          'NETWORK_ERROR',
          'FETCH_FAILED',
        ].includes(errorCode);

        if (isConflict) {
          setState('STALE');
          setErrorMessage('Revision conflict detected. Server has newer settings.');
        } else if (isTimeoutOrNetwork) {
          setState('OUTCOME_UNKNOWN');
          setErrorMessage('Server outcome unknown due to network error.');
        } else {
          setState('APPLY_FAILED');
          const msg = err instanceof Error ? err.message : 'Apply failed';
          setErrorMessage(msg);
        }
        throw err;
      }
    },
    [
      clientRequestId,
      activeProjectId,
      draft,
      expectedSettingsRevision,
      observedPolicyContextRevision,
      idempotencyKey,
      resourceProjectId,
      targetProjectId,
    ],
  );

  const recoverOutcomeUnknown = useCallback(
    async (apiClient: {
      getFrontendCommandOutcomeByClientRequestId: (
        clientRequestId: string,
      ) => Promise<FrontendCommandOutcomeView>;
      getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
    }): Promise<SettingsCommandResult | null> => {
      if (!clientRequestId) return null;
      try {
        const outcome = await apiClient.getFrontendCommandOutcomeByClientRequestId(clientRequestId);
        const status = await apiClient.getSettingsCommandStatus(outcome.commandId);
        setCommandResult(status);
        if (status.status === 'APPLIED') {
          setState('APPLIED');
          setDraft({});
        } else if (status.status === 'REVIEW_REQUIRED') {
          setState('REVIEW_REQUIRED');
        } else if (status.status === 'FAILED') {
          setState('APPLY_FAILED');
        }
        return status;
      } catch {
        return null;
      }
    },
    [clientRequestId],
  );

  const markStale = useCallback((newServerRevision: number) => {
    setState('STALE');
    setErrorMessage(`Server settings revision was updated to ${newServerRevision}.`);
  }, []);

  return {
    state,
    targetProjectId,
    activeProjectId,
    resourceProjectId,
    expectedSettingsRevision,
    observedPolicyContextRevision,
    draft,
    isDirty,
    validationResult,
    impactPreview,
    commandResult,
    errorMessage,
    clientRequestId,
    idempotencyKey,
    setDraftValue,
    resetDraft,
    validate,
    previewImpact,
    applyCommand,
    recoverOutcomeUnknown,
    markStale,
  };
};
