import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createFrontendDiscoveryClient,
  ShotgunApiError,
  type AnyFrontendCommandOutcomeView,
  type DiscoveryFeedbackProductCommandRequestV1,
  type DiscoveryFeedbackProductStateV1,
  type DiscoveryProductFindingSummaryV1,
  type FrontendDiscoveryClient,
  type GlobalShellView,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { discoveryFeedbackStateQueryKey, discoveryProjectQueryKey } from '../app/query-keys.js';
import { discoveryScopeFromShell } from '../knowledge/discovery-queries.js';
import { useProductLocalization } from '../localization/product-localization.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';

export type DiscoveryFeedbackSubmission = Pick<
  DiscoveryFeedbackProductCommandRequestV1,
  'feedbackClass' | 'feedbackKind' | 'reason' | 'scope' | 'snoozeUntil'
>;

export type DiscoveryFeedbackMutationStatus =
  'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN' | 'STALE_CONTEXT';

export type DiscoveryFeedbackMutationResult = {
  readonly status: DiscoveryFeedbackMutationStatus;
  readonly state?: DiscoveryFeedbackProductStateV1;
  readonly outcome?: AnyFrontendCommandOutcomeView;
};

type DiscoveryFeedbackRequestTarget = Pick<
  DiscoveryProductFindingSummaryV1,
  'projectId' | 'findingId' | 'findingRevision'
>;

export const createDiscoveryFeedbackRequest = (
  target: Pick<DiscoveryFeedbackProductCommandRequestV1, 'findingId' | 'findingRevision'>,
  input: DiscoveryFeedbackSubmission,
): DiscoveryFeedbackProductCommandRequestV1 => ({
  schemaVersion: '1.0.0',
  clientRequestId: globalThis.crypto.randomUUID(),
  idempotencyKey: globalThis.crypto.randomUUID(),
  findingId: target.findingId,
  findingRevision: target.findingRevision,
  feedbackClass: input.feedbackClass,
  feedbackKind: input.feedbackKind,
  ...(input.reason === undefined ? {} : { reason: input.reason }),
  ...(input.scope === undefined ? {} : { scope: input.scope }),
  ...(input.snoozeUntil === undefined ? {} : { snoozeUntil: input.snoozeUntil }),
});

const statusFromOutcome = (
  outcome: AnyFrontendCommandOutcomeView,
): DiscoveryFeedbackMutationStatus =>
  outcome.outcomeState === 'COMPLETED'
    ? 'COMPLETED'
    : outcome.outcomeState === 'REJECTED'
      ? 'REJECTED'
      : 'OUTCOME_UNKNOWN';

const completedState = async (
  client: FrontendDiscoveryClient,
  request: DiscoveryFeedbackProductCommandRequestV1,
  outcome: AnyFrontendCommandOutcomeView,
): Promise<DiscoveryFeedbackMutationResult> => ({
  status: statusFromOutcome(outcome),
  outcome,
  ...(outcome.outcomeState === 'COMPLETED'
    ? {
        state: await client.readDiscoveryFeedbackState({
          schemaVersion: '1.0.0',
          findingId: request.findingId,
          findingRevision: request.findingRevision,
        }),
      }
    : {}),
});

const isIndeterminateFeedbackError = (
  error: unknown,
  request: DiscoveryFeedbackProductCommandRequestV1,
): error is ShotgunApiError =>
  error instanceof ShotgunApiError &&
  (error.code === 'OUTCOME_INDETERMINATE' || error.code === 'OUTCOME_UNKNOWN') &&
  error.clientRequestId === request.clientRequestId;

/**
 * Resolve an accepted feedback command once. A missing resolver response is
 * kept uncertain so the caller never creates a second event blindly.
 */
export const resolveDiscoveryFeedbackRequest = async (
  client: FrontendDiscoveryClient,
  request: DiscoveryFeedbackProductCommandRequestV1,
): Promise<DiscoveryFeedbackMutationResult> => {
  try {
    return await completedState(
      client,
      request,
      await client.resolveDiscoveryFeedbackCommand(request.clientRequestId),
    );
  } catch {
    return { status: 'OUTCOME_UNKNOWN' };
  }
};

export const submitDiscoveryFeedbackRequest = async (
  client: FrontendDiscoveryClient,
  request: DiscoveryFeedbackProductCommandRequestV1,
): Promise<DiscoveryFeedbackMutationResult> => {
  try {
    const response = await client.submitDiscoveryFeedback(request);
    return {
      status: statusFromOutcome(response.outcome),
      outcome: response.outcome,
      state: response.state,
    };
  } catch (error) {
    if (!isIndeterminateFeedbackError(error, request)) throw error;
    return resolveDiscoveryFeedbackRequest(client, request);
  }
};

export const useDiscoveryFeedbackActions = (
  shell: GlobalShellView,
  target: DiscoveryFeedbackRequestTarget | undefined,
) => {
  const { queryClient } = useAppRuntime();
  const client = useMemo(() => createFrontendDiscoveryClient(), []);
  const projectRef = useRef<string | undefined>(shell.activeProject?.id);
  const scopeRef = useRef(discoveryScopeFromShell(shell));
  projectRef.current = shell.activeProject?.id;
  scopeRef.current = discoveryScopeFromShell(shell);
  const [lastRequest, setLastRequest] = useState<DiscoveryFeedbackProductCommandRequestV1>();
  const [lastResult, setLastResult] = useState<DiscoveryFeedbackMutationResult>();
  const [hasError, setHasError] = useState(false);

  const mutation = useMutation({
    mutationFn: (request: DiscoveryFeedbackProductCommandRequestV1) =>
      submitDiscoveryFeedbackRequest(client, request),
  });

  const isCurrentTarget = useCallback(
    (request: Pick<DiscoveryFeedbackProductCommandRequestV1, 'findingId' | 'findingRevision'>) =>
      Boolean(
        target &&
        shell.activeProject &&
        target.projectId === shell.activeProject.id &&
        target.findingId === request.findingId &&
        target.findingRevision === request.findingRevision &&
        projectRef.current === shell.activeProject.id,
      ),
    [shell.activeProject, target],
  );

  const finalize = useCallback(
    async (
      request: DiscoveryFeedbackProductCommandRequestV1,
      result: DiscoveryFeedbackMutationResult,
    ) => {
      if (!isCurrentTarget(request)) return result;
      setLastResult(result);
      if (result.status === 'COMPLETED') {
        const scope = scopeRef.current;
        if (scope && result.state) {
          queryClient.setQueryData(
            discoveryFeedbackStateQueryKey(scope, request.findingId, request.findingRevision),
            result.state,
          );
          await queryClient.invalidateQueries({ queryKey: discoveryProjectQueryKey(scope) });
        }
      }
      return result;
    },
    [isCurrentTarget, queryClient],
  );

  const submit = useCallback(
    async (input: DiscoveryFeedbackSubmission): Promise<DiscoveryFeedbackMutationResult> => {
      if (!target || !shell.activeProject || target.projectId !== shell.activeProject.id) {
        return { status: 'STALE_CONTEXT' };
      }
      if (lastResult?.status === 'OUTCOME_UNKNOWN') return lastResult;
      const request = createDiscoveryFeedbackRequest(target, input);
      setLastRequest(request);
      setLastResult(undefined);
      setHasError(false);
      try {
        return await finalize(request, await mutation.mutateAsync(request));
      } catch (error) {
        if (isCurrentTarget(request)) setHasError(true);
        throw error;
      }
    },
    [finalize, isCurrentTarget, lastResult, mutation, shell.activeProject, target],
  );

  const resolveLast = useCallback(async (): Promise<DiscoveryFeedbackMutationResult> => {
    const request = lastRequest;
    if (!request || !isCurrentTarget(request)) return { status: 'STALE_CONTEXT' };
    setHasError(false);
    const result = await finalize(request, await resolveDiscoveryFeedbackRequest(client, request));
    return result;
  }, [client, finalize, isCurrentTarget, lastRequest]);

  useEffect(() => {
    setLastRequest(undefined);
    setLastResult(undefined);
    setHasError(false);
  }, [target?.findingId, target?.findingRevision, target?.projectId, shell.activeProject?.id]);

  const pending =
    mutation.isPending &&
    isCurrentTarget({
      findingId: mutation.variables?.findingId ?? '',
      findingRevision: mutation.variables?.findingRevision ?? 0,
    });

  return {
    client,
    submit,
    resolveLast,
    pending,
    lastResult,
    outcomeUnknown: lastResult?.status === 'OUTCOME_UNKNOWN',
    hasError,
  };
};

export type DiscoveryQuickFeedbackActionsProps = {
  readonly finding: DiscoveryFeedbackRequestTarget;
  readonly shell: GlobalShellView;
  readonly className?: string;
};

export const DiscoveryQuickFeedbackActions = ({
  finding,
  shell,
  className,
}: DiscoveryQuickFeedbackActionsProps) => {
  const { t } = useProductLocalization();
  const actions = useDiscoveryFeedbackActions(shell, finding);
  const { registerLeaveGuard } = useLeaveGuard();
  const [announcement, setAnnouncement] = useState<string>();
  const [announcementTone, setAnnouncementTone] = useState<'status' | 'alert'>('status');
  const [resolving, setResolving] = useState(false);
  const outcomeUnknown = actions.outcomeUnknown;

  useEffect(
    () =>
      registerLeaveGuard(() => ({
        canLeaveCurrentContext: !actions.pending && !outcomeUnknown,
        hasUnsavedDraft: false,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: outcomeUnknown,
      })),
    [actions.pending, outcomeUnknown, registerLeaveGuard],
  );

  const submitQuick = async (feedbackKind: 'USEFUL' | 'NOT_RELEVANT') => {
    setAnnouncement(undefined);
    try {
      const result = await actions.submit({ feedbackClass: 'UTILITY', feedbackKind });
      if (result.status === 'COMPLETED') {
        setAnnouncement(t('discovery.feedback.recorded'));
        setAnnouncementTone('status');
      } else if (result.status === 'OUTCOME_UNKNOWN') {
        setAnnouncement(t('discovery.feedback.outcome_unknown'));
        setAnnouncementTone('alert');
      } else if (result.status === 'REJECTED' || result.status === 'STALE_CONTEXT') {
        setAnnouncement(t('discovery.feedback.failed'));
        setAnnouncementTone('alert');
      }
    } catch {
      setAnnouncement(t('discovery.feedback.failed'));
      setAnnouncementTone('alert');
    }
  };

  const resolveQuick = async () => {
    setResolving(true);
    setAnnouncement(undefined);
    try {
      const result = await actions.resolveLast();
      if (result.status === 'COMPLETED') {
        setAnnouncement(t('discovery.feedback.recorded'));
        setAnnouncementTone('status');
      } else if (result.status === 'OUTCOME_UNKNOWN') {
        setAnnouncement(t('discovery.feedback.outcome_unknown'));
        setAnnouncementTone('alert');
      } else {
        setAnnouncement(t('discovery.feedback.failed'));
        setAnnouncementTone('alert');
      }
    } catch {
      setAnnouncement(t('discovery.feedback.failed'));
      setAnnouncementTone('alert');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className={className ?? 'discovery-feedback-quick-actions'}>
      <button
        className="hfm-action-selection"
        type="button"
        onClick={() => void submitQuick('USEFUL')}
        disabled={actions.pending || outcomeUnknown}
        aria-label={t('discovery.feedback.useful')}
      >
        {t('discovery.feedback.useful')}
      </button>
      <button
        className="hfm-action-selection"
        type="button"
        onClick={() => void submitQuick('NOT_RELEVANT')}
        disabled={actions.pending || outcomeUnknown}
        aria-label={t('discovery.feedback.not_relevant')}
      >
        {t('discovery.feedback.not_relevant')}
      </button>
      {actions.pending ? (
        <span role="status">{t('commands.unavailable.discovery_pending')}</span>
      ) : null}
      {outcomeUnknown ? (
        <div className="discovery-feedback-recovery" role="status">
          <p>{t('discovery.feedback.outcome_unknown')}</p>
          <button
            className="hfm-action-secondary"
            type="button"
            onClick={() => void resolveQuick()}
            disabled={resolving}
          >
            {resolving ? t('common.checking') : t('discovery.feedback.check_result')}
          </button>
        </div>
      ) : null}
      {announcement ? <p role={announcementTone}>{announcement}</p> : null}
    </div>
  );
};
