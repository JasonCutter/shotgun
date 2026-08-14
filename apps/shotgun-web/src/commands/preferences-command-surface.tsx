import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';

import type { GlobalShellView } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
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

const preferenceQueryKey = (principalId: string) =>
  ['settings', 'preferences', principalId] as const;

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
    queryKey: preferenceQueryKey(shell.principalId),
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
    await queryClient.invalidateQueries({ queryKey: preferenceQueryKey(shell.principalId) });
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
      setMessage('Preferences updated.');
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
        setMessage('Preferences updated.');
      } else if (outcome.outcomeState === 'REJECTED') {
        setOutcomeRecovery(undefined);
        setErrorMessage(outcome.rejection?.message ?? 'Preference change was rejected.');
      } else {
        setMessage('The preference change is not final yet. Check the result again.');
      }
    } catch {
      setErrorMessage('The preference result could not be checked. Try again.');
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
      ? 'Locale Preferences'
      : commandId === 'preferences.timezone'
        ? 'Timezone Preferences'
        : 'Display Preferences';
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
            {isResolvingOutcome ? 'Checking...' : 'Check result'}
          </button>
        ) : null}
        {preferencesQuery.isLoading ? <p>Loading preferences...</p> : null}
        {preferencesQuery.isError ? (
          <p role="alert">{safeErrorMessage(preferencesQuery.error)}</p>
        ) : null}
        {!preferencesQuery.isLoading && !preferencesQuery.isError ? (
          <form onSubmit={handleSave}>
            {commandId === 'preferences.locale' ? (
              <div>
                <label htmlFor="preferences-command-locale">Locale</label>
                <select
                  id="preferences-command-locale"
                  value={locale}
                  onChange={(event) => setLocale(event.currentTarget.value)}
                  disabled={pending}
                >
                  <option value="ko-KR">ko-KR</option>
                  <option value="en-US">en-US</option>
                  <option value="ja-JP">ja-JP</option>
                </select>
              </div>
            ) : null}
            {commandId === 'preferences.timezone' ? (
              <div>
                <label htmlFor="preferences-command-timezone">Timezone</label>
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
                  <label htmlFor="preferences-command-date-display">Date &amp; Time Format</label>
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
                  <label htmlFor="preferences-command-density">Screen Density</label>
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
                  Reduce Motion / Animations
                </label>
              </>
            ) : null}
            <div className="dialog-actions">
              <button type="submit" disabled={pending || preferencesQuery.data === undefined}>
                {mutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={onClose} disabled={mutation.isPending}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
};
