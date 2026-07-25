import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  SettingsDraftState,
  SettingsSnapshot,
  SettingsValidationResult,
  SettingsImpactPreview,
  SettingsCommandResult,
} from '@shotgun/api-client';
import { useLeaveGuard } from './leave-guard-context.js';

export type SettingsDraftController = {
  readonly state: SettingsDraftState;
  readonly targetProjectId: string;
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
      commandId: string;
      clientRequestId: string;
      idempotencyKey: string;
      expectedSettingsRevision: number;
      observedPolicyContextRevision: number;
      settings: Record<string, unknown>;
      targetProjectId?: string;
    }) => Promise<SettingsCommandResult>;
    getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
  }) => Promise<SettingsCommandResult>;
  readonly recoverOutcomeUnknown: (apiClient: {
    getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
  }) => Promise<SettingsCommandResult | null>;
  readonly markStale: (newServerRevision: number) => void;
};

export const useSettingsDraft = (
  snapshot: SettingsSnapshot | null | undefined,
): SettingsDraftController => {
  const targetProjectId = snapshot?.targetProjectId ?? '';
  const expectedSettingsRevision = snapshot?.settingsRevision ?? 1;
  const observedPolicyContextRevision = snapshot?.policyContextRevision ?? expectedSettingsRevision;

  const [state, setState] = useState<SettingsDraftState>('CLEAN');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [validationResult, setValidationResult] = useState<SettingsValidationResult | null>(null);
  const [impactPreview, setImpactPreview] = useState<SettingsImpactPreview | null>(null);
  const [commandResult, setCommandResult] = useState<SettingsCommandResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);

  const isDirty = useMemo(() => Object.keys(draft).length > 0, [draft]);
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

  const setDraftValue = useCallback((key: string, value: unknown) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      return next;
    });
    setState('DIRTY');
    setValidationResult(null);
    setImpactPreview(null);
    setErrorMessage(null);
  }, []);

  const resetDraft = useCallback(() => {
    setDraft({});
    setState('CLEAN');
    setValidationResult(null);
    setImpactPreview(null);
    setCommandResult(null);
    setErrorMessage(null);
    setClientRequestId(null);
    setIdempotencyKey(null);
    setActiveCommandId(null);
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
        commandId: string;
        clientRequestId: string;
        idempotencyKey: string;
        expectedSettingsRevision: number;
        observedPolicyContextRevision: number;
        settings: Record<string, unknown>;
        targetProjectId?: string;
      }) => Promise<SettingsCommandResult>;
      getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
    }): Promise<SettingsCommandResult> => {
      setState('APPLYING');
      const reqId = clientRequestId ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const idemKey = idempotencyKey ?? `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const cmdId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setClientRequestId(reqId);
      setIdempotencyKey(idemKey);
      setActiveCommandId(cmdId);

      try {
        const result = await apiClient.applySettingsCommand({
          commandId: cmdId,
          clientRequestId: reqId,
          idempotencyKey: idemKey,
          expectedSettingsRevision,
          observedPolicyContextRevision,
          settings: draft,
          targetProjectId,
        });

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
        const isConflict =
          (typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code: string }).code === 'CONFLICT') ||
          (typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code: string }).code === 'REVISION_CONFLICT') ||
          (err instanceof Error &&
            (err.message.includes('409') || err.message.includes('REVISION_CONFLICT')));

        const isTimeoutOrNetwork =
          (typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            ['TIMEOUT', 'NETWORK_ERROR', 'FETCH_FAILED'].includes(
              (err as { code: string }).code,
            )) ||
          (typeof err === 'object' &&
            err !== null &&
            'status' in err &&
            [504, 502, 503].includes((err as { status: number }).status)) ||
          (err instanceof Error &&
            (err.message.includes('timeout') ||
              err.message.includes('Network') ||
              err.message.includes('504')));

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
      draft,
      expectedSettingsRevision,
      observedPolicyContextRevision,
      idempotencyKey,
      targetProjectId,
    ],
  );

  const recoverOutcomeUnknown = useCallback(
    async (apiClient: {
      getSettingsCommandStatus: (commandId: string) => Promise<SettingsCommandResult>;
    }): Promise<SettingsCommandResult | null> => {
      const targetCmdId = commandResult?.commandId ?? activeCommandId;
      if (!targetCmdId) return null;
      try {
        const status = await apiClient.getSettingsCommandStatus(targetCmdId);
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
    [commandResult, activeCommandId],
  );

  const markStale = useCallback((newServerRevision: number) => {
    setState('STALE');
    setErrorMessage(`Server settings revision was updated to ${newServerRevision}.`);
  }, []);

  return {
    state,
    targetProjectId,
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
