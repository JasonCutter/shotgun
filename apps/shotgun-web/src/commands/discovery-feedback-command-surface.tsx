import { useEffect, useId, useMemo, useState } from 'react';

import type {
  DiscoveryFeedbackProductStateV1,
  DiscoveryProductFindingDetailV1,
} from '@shotgun/api-client';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { type DiscoveryFeedbackCommandId } from './discovery-command-context.js';
import {
  type DiscoveryFeedbackMutationResult,
  type DiscoveryFeedbackSubmission,
} from './discovery-feedback.js';
import { useProductLocalization } from '../localization/product-localization.js';

type EpistemicFeedbackKind =
  | 'INCORRECT_RELATION'
  | 'INSUFFICIENT_EVIDENCE'
  | 'WRONG_ENTITY'
  | 'TEMPORAL_ERROR'
  | 'MISLEADING_PATTERN'
  | 'MISIDENTIFIED_CONFLICT';

type Scope = 'FINDING' | 'PROJECT';
type SnoozeDuration = 'HOUR' | 'DAY' | 'WEEK';

export type DiscoveryFeedbackCommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: DiscoveryFeedbackCommandId | null;
  readonly finding: DiscoveryProductFindingDetailV1;
  readonly state?: DiscoveryFeedbackProductStateV1;
  readonly statePending: boolean;
  readonly stateError: boolean;
  readonly pending: boolean;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    input: DiscoveryFeedbackSubmission,
  ) => Promise<DiscoveryFeedbackMutationResult>;
  readonly onResolve?: () => Promise<DiscoveryFeedbackMutationResult>;
};

const isHistoryCommand = (commandId: DiscoveryFeedbackCommandId): boolean =>
  commandId === 'discovery.feedback_history';

const isReportCommand = (commandId: DiscoveryFeedbackCommandId): boolean =>
  commandId === 'discovery.report_issue';

const isSuppressionCommand = (commandId: DiscoveryFeedbackCommandId): boolean =>
  commandId === 'discovery.suppress_exact' || commandId === 'discovery.suppress_similar';

const isSnoozeCommand = (commandId: DiscoveryFeedbackCommandId): boolean =>
  commandId === 'discovery.snooze';

const utilityKindForCommand = (
  commandId: DiscoveryFeedbackCommandId,
): 'USEFUL' | 'NOT_RELEVANT' | 'ALREADY_KNOWN' | 'TOO_FREQUENT' | undefined => {
  switch (commandId) {
    case 'discovery.feedback.useful':
      return 'USEFUL';
    case 'discovery.feedback.not_relevant':
      return 'NOT_RELEVANT';
    case 'discovery.feedback.already_known':
      return 'ALREADY_KNOWN';
    case 'discovery.feedback.too_frequent':
      return 'TOO_FREQUENT';
    default:
      return undefined;
  }
};

const commandTitle = (
  t: ReturnType<typeof useProductLocalization>['t'],
  commandId: DiscoveryFeedbackCommandId,
): string => {
  switch (commandId) {
    case 'discovery.feedback.useful':
      return t('discovery.feedback.useful_title');
    case 'discovery.feedback.not_relevant':
      return t('discovery.feedback.not_relevant_title');
    case 'discovery.feedback.already_known':
      return t('discovery.feedback.already_known');
    case 'discovery.feedback.too_frequent':
      return t('discovery.feedback.too_frequent');
    case 'discovery.snooze':
      return t('discovery.feedback.snooze');
    case 'discovery.suppress_exact':
      return t('discovery.feedback.suppress_exact');
    case 'discovery.suppress_similar':
      return t('discovery.feedback.suppress_similar');
    case 'discovery.report_issue':
      return t('discovery.feedback.report_issue');
    case 'discovery.feedback_history':
      return t('discovery.feedback.history_title');
  }
};

const commandDescription = (
  t: ReturnType<typeof useProductLocalization>['t'],
  commandId: DiscoveryFeedbackCommandId,
): string => {
  if (isReportCommand(commandId)) return t('discovery.feedback.report_issue_description');
  if (isHistoryCommand(commandId)) return t('discovery.feedback.history_description');
  if (isSuppressionCommand(commandId)) return t('discovery.feedback.suppression_description');
  if (isSnoozeCommand(commandId)) return t('discovery.feedback.snooze_description');
  return t('discovery.feedback.utility_description');
};

const feedbackKindLabel = (
  t: ReturnType<typeof useProductLocalization>['t'],
  kind: string,
): string => {
  switch (kind) {
    case 'USEFUL':
      return t('discovery.feedback.useful');
    case 'NOT_RELEVANT':
      return t('discovery.feedback.not_relevant');
    case 'ALREADY_KNOWN':
      return t('discovery.feedback.already_known');
    case 'TOO_FREQUENT':
      return t('discovery.feedback.too_frequent');
    case 'SNOOZE':
      return t('discovery.feedback.snooze');
    case 'SUPPRESS_EXACT':
      return t('discovery.feedback.suppress_exact');
    case 'SUPPRESS_SIMILAR':
      return t('discovery.feedback.suppress_similar');
    case 'INCORRECT_RELATION':
      return t('discovery.feedback.issue.incorrect_relation');
    case 'INSUFFICIENT_EVIDENCE':
      return t('discovery.feedback.issue.insufficient_evidence');
    case 'WRONG_ENTITY':
      return t('discovery.feedback.issue.wrong_entity');
    case 'TEMPORAL_ERROR':
      return t('discovery.feedback.issue.temporal_error');
    case 'MISLEADING_PATTERN':
      return t('discovery.feedback.issue.misleading_pattern');
    case 'MISIDENTIFIED_CONFLICT':
      return t('discovery.feedback.issue.misidentified_conflict');
    default:
      return t('discovery.feedback.history_recorded');
  }
};

const epistemicDescription = (
  t: ReturnType<typeof useProductLocalization>['t'],
  kind: EpistemicFeedbackKind,
): string => {
  switch (kind) {
    case 'INCORRECT_RELATION':
      return t('discovery.feedback.issue.incorrect_relation_description');
    case 'INSUFFICIENT_EVIDENCE':
      return t('discovery.feedback.issue.insufficient_evidence_description');
    case 'WRONG_ENTITY':
      return t('discovery.feedback.issue.wrong_entity_description');
    case 'TEMPORAL_ERROR':
      return t('discovery.feedback.issue.temporal_error_description');
    case 'MISLEADING_PATTERN':
      return t('discovery.feedback.issue.misleading_pattern_description');
    case 'MISIDENTIFIED_CONFLICT':
      return t('discovery.feedback.issue.misidentified_conflict_description');
  }
};

const formatDate = (locale: string, value: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

const scopeLabel = (
  t: ReturnType<typeof useProductLocalization>['t'],
  scope: Scope | undefined,
): string =>
  scope === 'PROJECT'
    ? t('discovery.feedback.scope_project')
    : t('discovery.feedback.scope_finding');

const HistoryList = ({
  state,
  locale,
  t,
}: {
  readonly state: DiscoveryFeedbackProductStateV1;
  readonly locale: string;
  readonly t: ReturnType<typeof useProductLocalization>['t'];
}) => {
  const entries = useMemo(
    () =>
      [
        ...state.feedbackHistory.map((entry) => ({
          id: entry.feedbackId,
          kind: entry.feedbackKind,
          scope: entry.scope,
          reason: entry.reason,
          createdAt: entry.createdAt,
          expiresAt: undefined,
          effect:
            entry.feedbackClass === 'EPISTEMIC'
              ? t('discovery.feedback.history_recheck_requested')
              : t('discovery.feedback.history_recorded'),
        })),
        ...state.suppressionHistory.map((entry) => ({
          id: entry.suppressionId,
          kind: entry.suppressionKind,
          scope: entry.scope,
          reason: undefined,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
          effect: entry.expiresAt
            ? Date.parse(entry.expiresAt) > Date.now()
              ? t('discovery.feedback.history_active')
              : t('discovery.feedback.history_expired')
            : t('discovery.feedback.history_active'),
        })),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [state.feedbackHistory, state.suppressionHistory, t],
  );

  if (entries.length === 0) return <p>{t('discovery.feedback.history_empty')}</p>;

  return (
    <ol className="discovery-feedback-history">
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="discovery-feedback-history-heading">
            <strong>{feedbackKindLabel(t, entry.kind)}</strong>
            <time dateTime={entry.createdAt}>{formatDate(locale, entry.createdAt)}</time>
          </div>
          <dl className="discovery-feedback-history-details">
            <dt>{t('discovery.feedback.history_scope')}</dt>
            <dd>{scopeLabel(t, entry.scope)}</dd>
            <dt>{t('discovery.feedback.history_effect')}</dt>
            <dd>
              {entry.effect}
              {entry.expiresAt ? (
                <>
                  {' '}
                  {t('discovery.feedback.history_until')} {formatDate(locale, entry.expiresAt)}
                </>
              ) : null}
            </dd>
            {entry.reason ? (
              <>
                <dt>{t('discovery.feedback.history_reason')}</dt>
                <dd>{entry.reason}</dd>
              </>
            ) : null}
          </dl>
        </li>
      ))}
    </ol>
  );
};

export const DiscoveryFeedbackCommandSurface = ({
  open,
  commandId,
  finding,
  state,
  statePending,
  stateError,
  pending,
  invoker,
  onClose,
  onSubmit,
  onResolve,
}: DiscoveryFeedbackCommandSurfaceProps) => {
  const { locale, t } = useProductLocalization();
  const dialog = useAccessibleDialog({ open, onClose });
  const titleId = useId();
  const [scope, setScope] = useState<Scope>('FINDING');
  const [snoozeDuration, setSnoozeDuration] = useState<SnoozeDuration>('DAY');
  const [issueKind, setIssueKind] = useState<EpistemicFeedbackKind>('INCORRECT_RELATION');
  const [reason, setReason] = useState('');
  const [resultStatus, setResultStatus] = useState<DiscoveryFeedbackMutationResult['status']>();
  const [submitError, setSubmitError] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (open && commandId) dialog.captureInvoker(invoker);
    if (!open || !commandId) return;
    setScope('FINDING');
    setSnoozeDuration('DAY');
    setIssueKind('INCORRECT_RELATION');
    setReason('');
    setResultStatus(undefined);
    setSubmitError(false);
    setResolving(false);
  }, [commandId, invoker, open]);

  if (!open || !commandId) return null;

  const isUtility = utilityKindForCommand(commandId) !== undefined;
  const makeInput = (): DiscoveryFeedbackSubmission | undefined => {
    const utilityKind = utilityKindForCommand(commandId);
    if (utilityKind) return { feedbackClass: 'UTILITY', feedbackKind: utilityKind };
    if (isReportCommand(commandId)) {
      return {
        feedbackClass: 'EPISTEMIC',
        feedbackKind: issueKind,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
    }
    if (isSnoozeCommand(commandId)) {
      const durationMs =
        snoozeDuration === 'HOUR'
          ? 60 * 60 * 1000
          : snoozeDuration === 'DAY'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;
      return {
        feedbackClass: 'UTILITY',
        feedbackKind: 'SNOOZE',
        scope: 'FINDING',
        snoozeUntil: new Date(Date.now() + durationMs).toISOString(),
      };
    }
    if (commandId === 'discovery.suppress_exact' || commandId === 'discovery.suppress_similar') {
      return {
        feedbackClass: 'UTILITY',
        feedbackKind:
          commandId === 'discovery.suppress_exact' ? 'SUPPRESS_EXACT' : 'SUPPRESS_SIMILAR',
        scope,
      };
    }
    return undefined;
  };

  const submit = () => {
    const input = makeInput();
    if (!input) return;
    setSubmitError(false);
    void onSubmit(input)
      .then((result) => {
        setResultStatus(result.status);
        if (result.status !== 'OUTCOME_UNKNOWN') onClose();
      })
      .catch(() => {
        setSubmitError(true);
      });
  };

  const resolve = () => {
    if (!onResolve) return;
    setResolving(true);
    void onResolve()
      .then((result) => {
        setResultStatus(result.status);
        if (result.status !== 'OUTCOME_UNKNOWN') onClose();
      })
      .catch(() => setSubmitError(true))
      .finally(() => setResolving(false));
  };

  const issueKinds: readonly EpistemicFeedbackKind[] = [
    'INCORRECT_RELATION',
    'INSUFFICIENT_EVIDENCE',
    'WRONG_ENTITY',
    'TEMPORAL_ERROR',
    'MISLEADING_PATTERN',
    'MISIDENTIFIED_CONFLICT',
  ];

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
      <div className="modal-card discovery-feedback-surface hfm-command-surface">
        <h2 id={titleId}>{commandTitle(t, commandId)}</h2>
        <p>{commandDescription(t, commandId)}</p>

        {isHistoryCommand(commandId) ? (
          statePending ? (
            <p role="status">{t('discovery.feedback.history_loading')}</p>
          ) : stateError || !state ? (
            <p role="alert">{t('discovery.feedback.history_unavailable')}</p>
          ) : (
            <HistoryList state={state} locale={locale} t={t} />
          )
        ) : (
          <>
            {isUtility ? (
              <p className="discovery-feedback-boundary">
                {t('discovery.feedback.utility_boundary')}
              </p>
            ) : null}
            {isSuppressionCommand(commandId) ? (
              <fieldset>
                <legend>{t('discovery.feedback.scope')}</legend>
                <label>
                  <input
                    type="radio"
                    name={`${titleId}-scope`}
                    value="FINDING"
                    checked={scope === 'FINDING'}
                    onChange={() => setScope('FINDING')}
                  />{' '}
                  {t('discovery.feedback.scope_finding')}
                </label>
                <label>
                  <input
                    type="radio"
                    name={`${titleId}-scope`}
                    value="PROJECT"
                    checked={scope === 'PROJECT'}
                    onChange={() => setScope('PROJECT')}
                  />{' '}
                  {t('discovery.feedback.scope_project')}
                </label>
              </fieldset>
            ) : null}
            {isSnoozeCommand(commandId) ? (
              <>
                <p className="discovery-supporting-copy">
                  {t('discovery.feedback.snooze_finding_only')}
                </p>
                <label htmlFor={`${titleId}-snooze-duration`}>
                  {t('discovery.feedback.snooze_until')}
                  <select
                    id={`${titleId}-snooze-duration`}
                    value={snoozeDuration}
                    onChange={(event) =>
                      setSnoozeDuration(event.currentTarget.value as SnoozeDuration)
                    }
                  >
                    <option value="HOUR">{t('discovery.feedback.snooze_one_hour')}</option>
                    <option value="DAY">{t('discovery.feedback.snooze_one_day')}</option>
                    <option value="WEEK">{t('discovery.feedback.snooze_one_week')}</option>
                  </select>
                </label>
              </>
            ) : null}
            {isReportCommand(commandId) ? (
              <>
                <label htmlFor={`${titleId}-issue-kind`}>
                  {t('discovery.feedback.issue_kind')}
                </label>
                <select
                  id={`${titleId}-issue-kind`}
                  value={issueKind}
                  onChange={(event) =>
                    setIssueKind(event.currentTarget.value as EpistemicFeedbackKind)
                  }
                >
                  {issueKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {feedbackKindLabel(t, kind)}
                    </option>
                  ))}
                </select>
                <p className="discovery-supporting-copy">{epistemicDescription(t, issueKind)}</p>
                <label htmlFor={`${titleId}-reason`}>
                  {t('discovery.feedback.reason_optional')}
                </label>
                <textarea
                  id={`${titleId}-reason`}
                  value={reason}
                  maxLength={500}
                  rows={4}
                  onChange={(event) => setReason(event.currentTarget.value)}
                  aria-describedby={`${titleId}-reason-count`}
                />
                <small id={`${titleId}-reason-count`}>
                  {t('discovery.feedback.reason_count')} {reason.length}/500
                </small>
              </>
            ) : null}
            {submitError ? <p role="alert">{t('discovery.feedback.failed')}</p> : null}
            {resultStatus === 'OUTCOME_UNKNOWN' ? (
              <div className="discovery-feedback-recovery" role="status">
                <p>{t('discovery.feedback.outcome_unknown')}</p>
                {onResolve ? (
                  <button
                    className="hfm-action-secondary"
                    type="button"
                    onClick={resolve}
                    disabled={pending || resolving}
                  >
                    {resolving ? t('common.checking') : t('discovery.feedback.check_result')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <div className="dialog-actions">
          {!isHistoryCommand(commandId) ? (
            <button
              className="hfm-action-primary"
              type="button"
              onClick={submit}
              disabled={pending || resultStatus === 'OUTCOME_UNKNOWN'}
            >
              {pending
                ? t('commands.unavailable.discovery_pending')
                : isReportCommand(commandId)
                  ? t('discovery.feedback.report_submit')
                  : isSuppressionCommand(commandId)
                    ? t('discovery.feedback.hide_confirm')
                    : isSnoozeCommand(commandId)
                      ? t('discovery.feedback.snooze_confirm')
                      : t('discovery.feedback.submit')}
            </button>
          ) : null}
          <button className="hfm-action-secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {isReportCommand(commandId) ? (
          <p className="discovery-feedback-boundary">{t('discovery.feedback.report_boundary')}</p>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {finding.title}
        </p>
      </div>
    </div>
  );
};
