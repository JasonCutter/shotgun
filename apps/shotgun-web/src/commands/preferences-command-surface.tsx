import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { principalPreferencesQueryKey } from '../app/query-keys.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import { useProductLocalization } from '../localization/product-localization.js';
import type { PreferenceCommandId } from './owner-command-registry.js';

type CommandIdentity = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

type PreferenceSubmission = CommandIdentity & {
  readonly expectedPreferenceRevision: number;
  readonly preferences: Record<string, unknown>;
};

type OutcomeRecovery = CommandIdentity;

const identity = (): CommandIdentity => ({
  clientRequestId: crypto.randomUUID(),
  idempotencyKey: crypto.randomUUID(),
});

const isOutcomeIndeterminateError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly recovery?: unknown };
  return (
    candidate.code === 'OUTCOME_INDETERMINATE' ||
    candidate.code === 'OUTCOME_UNKNOWN' ||
    candidate.recovery === 'RESOLVE_EXISTING_OUTCOME'
  );
};

export type PreferencesCommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: PreferenceCommandId | null;
  readonly shell: GlobalShellView;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

export const PreferencesCommandSurface = ({
  open,
  commandId,
  shell,
  invoker,
  onClose,
}: PreferencesCommandSurfaceProps) => {
  const { apiClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const [locale, setLocale] = useState('ko-KR');
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [dateDisplay, setDateDisplay] = useState('YYYY-MM-DD');
  const [screenDensity, setScreenDensity] = useState('COMFORTABLE');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [message, setMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [outcomeRecovery, setOutcomeRecovery] = useState<OutcomeRecovery>();
  const [isResolvingOutcome, setIsResolvingOutcome] = useState(false);

  const preferencesQuery = useQuery({
    queryKey: principalPreferencesQueryKey(shell.principalId),
    queryFn: () => apiClient.getPrincipalPreferences(),
    enabled: open,
  });
  const persistedPreferences = preferencesQuery.data?.preferences;

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setMessage(undefined);
    setErrorMessage(undefined);
    setOutcomeRecovery(undefined);
    setIsResolvingOutcome(false);
  }, [commandId, invoker, open]);

  useEffect(() => {
    if (!persistedPreferences) return;
    if (typeof persistedPreferences.locale === 'string') setLocale(persistedPreferences.locale);
    if (typeof persistedPreferences.timezone === 'string') {
      setTimezone(persistedPreferences.timezone);
    }
    if (typeof persistedPreferences.dateDisplay === 'string') {
      setDateDisplay(persistedPreferences.dateDisplay);
    }
    if (typeof persistedPreferences.screenDensity === 'string') {
      setScreenDensity(persistedPreferences.screenDensity);
    }
    if (typeof persistedPreferences.reducedMotion === 'boolean') {
      setReducedMotion(persistedPreferences.reducedMotion);
    }
  }, [persistedPreferences]);

  const refreshPreferences = async () => {
    await queryClient.invalidateQueries({
      queryKey: principalPreferencesQueryKey(shell.principalId),
    });
    await preferencesQuery.refetch();
  };

  const mutation = useMutation({
    mutationFn: (input: PreferenceSubmission) => {
      const activeProjectId = shell.activeProject?.id;
      if (!activeProjectId) throw new Error('An active Project is required.');
      return apiClient.updatePrincipalPreferences({
        activeProjectId,
        targetProjectId: activeProjectId,
        resourceProjectId: activeProjectId,
        expectedPreferenceRevision: input.expectedPreferenceRevision,
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
        preferences: input.preferences,
      });
    },
    onSuccess: async () => {
      await refreshPreferences();
      setOutcomeRecovery(undefined);
      setMessage(t('preferences.updated'));
      setErrorMessage(undefined);
    },
    onError: (error, input) => {
      if (isOutcomeIndeterminateError(error)) {
        setOutcomeRecovery({
          clientRequestId: input.clientRequestId,
          idempotencyKey: input.idempotencyKey,
        });
        setErrorMessage(undefined);
        return;
      }
      setErrorMessage(safeErrorMessage(error));
    },
  });

  const resolveOutcome = async () => {
    if (!outcomeRecovery || isResolvingOutcome) return;
    setIsResolvingOutcome(true);
    setErrorMessage(undefined);
    try {
      const outcome = await apiClient.getFrontendCommandOutcomeByClientRequestId(
        outcomeRecovery.clientRequestId,
      );
      if (outcome.outcomeState === 'COMPLETED') {
        await refreshPreferences();
        setOutcomeRecovery(undefined);
        setMessage(t('preferences.updated'));
      } else if (outcome.outcomeState === 'REJECTED') {
        setOutcomeRecovery(undefined);
        setErrorMessage(outcome.rejection?.message ?? t('preferences.rejected'));
      } else {
        setMessage(t('preferences.not_final'));
      }
    } catch {
      setErrorMessage(t('preferences.check_failed'));
    } finally {
      setIsResolvingOutcome(false);
    }
  };

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !commandId ||
      !persistedPreferences ||
      preferencesQuery.data?.revision === undefined ||
      mutation.isPending ||
      outcomeRecovery
    ) {
      return;
    }

    const focusedChanges =
      commandId === 'preferences.locale'
        ? { locale }
        : commandId === 'preferences.timezone'
          ? { timezone }
          : { dateDisplay, screenDensity, reducedMotion };
    setMessage(undefined);
    setErrorMessage(undefined);
    mutation.mutate({
      ...identity(),
      expectedPreferenceRevision: preferencesQuery.data.revision,
      preferences: { ...persistedPreferences, ...focusedChanges },
    });
  };

  if (!open || !commandId) return null;

  const title =
    commandId === 'preferences.locale'
      ? t('preferences.locale_title')
      : commandId === 'preferences.timezone'
        ? t('preferences.timezone_title')
        : t('preferences.display_title');
  const pending = mutation.isPending || isResolvingOutcome || outcomeRecovery !== undefined;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={dialog.onDialogKeyDown}
    >
      <div className="modal-card preferences-command-surface">
        <h2 id={titleId}>{title}</h2>
        {message ? (
          <p className="preferences-command-message" role="status">
            {message}
          </p>
        ) : null}
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        {outcomeRecovery ? (
          <button type="button" onClick={() => void resolveOutcome()} disabled={isResolvingOutcome}>
            {isResolvingOutcome ? t('common.checking') : t('common.check_result')}
          </button>
        ) : null}
        {preferencesQuery.isLoading ? <p>{t('common.loading_preferences')}</p> : null}
        {preferencesQuery.isError ? (
          <p role="alert">{safeErrorMessage(preferencesQuery.error)}</p>
        ) : null}
        {!preferencesQuery.isLoading && !preferencesQuery.isError ? (
          <form onSubmit={handleSave}>
            {commandId === 'preferences.locale' ? (
              <div>
                <label htmlFor="preferences-command-locale">{t('preferences.locale')}</label>
                <select
                  id="preferences-command-locale"
                  value={locale}
                  onChange={(event) => setLocale(event.currentTarget.value)}
                  disabled={pending}
                >
                  <option value="ko-KR">ko-KR</option>
                  <option value="en-US">en-US</option>
                  <option value="ja-JP">ja-JP ({t('preferences.japanese_fallback')})</option>
                </select>
              </div>
            ) : null}
            {commandId === 'preferences.timezone' ? (
              <div>
                <label htmlFor="preferences-command-timezone">{t('preferences.timezone')}</label>
                <select
                  id="preferences-command-timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.currentTarget.value)}
                  disabled={pending}
                >
                  <option value="Asia/Seoul">Asia/Seoul</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </div>
            ) : null}
            {commandId === 'preferences.display' ? (
              <>
                <div>
                  <label htmlFor="preferences-command-date-display">
                    {t('preferences.date_format')}
                  </label>
                  <select
                    id="preferences-command-date-display"
                    value={dateDisplay}
                    onChange={(event) => setDateDisplay(event.currentTarget.value)}
                    disabled={pending}
                  >
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="preferences-command-density">
                    {t('preferences.screen_density')}
                  </label>
                  <select
                    id="preferences-command-density"
                    value={screenDensity}
                    onChange={(event) => setScreenDensity(event.currentTarget.value)}
                    disabled={pending}
                  >
                    <option value="COMFORTABLE">COMFORTABLE</option>
                    <option value="COMPACT">COMPACT</option>
                  </select>
                </div>
                <label htmlFor="preferences-command-reduced-motion">
                  <input
                    id="preferences-command-reduced-motion"
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={(event) => setReducedMotion(event.currentTarget.checked)}
                    disabled={pending}
                  />
                  {t('preferences.reduced_motion')}
                </label>
              </>
            ) : null}
            <div className="dialog-actions">
              <button type="submit" disabled={pending || preferencesQuery.data === undefined}>
                {mutation.isPending ? t('common.saving') : t('common.save')}
              </button>
              <button type="button" onClick={onClose} disabled={mutation.isPending}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
};
