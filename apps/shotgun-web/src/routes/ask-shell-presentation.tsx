import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { Link } from 'react-router';

import type {
  AskAnswerRunEventsView,
  AskAnswerRunSnapshot,
  AskMode,
  AskProviderEligibilityView,
  AskSourceSelectionView,
  AskWorkspaceView,
  SourceLibraryPageView,
} from '@shotgun/api-client';

import type { AnswerCommandContext } from '../commands/answer-command-context.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { hfmOwnerLabel, type ProductTranslator } from '../localization/product-localization.js';

type SourceLibraryItem = SourceLibraryPageView['items'][number];

export type GlobalComposerProps = {
  readonly workspace?: AskWorkspaceView;
  readonly availableModes?: readonly AskMode[];
  readonly question: string;
  readonly mode: AskMode;
  readonly draftReady: boolean;
  readonly outcomeUnknown: boolean;
  readonly isSubmitting: boolean;
  readonly submissionAvailable: boolean;
  readonly sourceSelectionMissing: boolean;
  readonly providerEligibility: {
    readonly data?: AskProviderEligibilityView;
    readonly isPending: boolean;
    readonly isError: boolean;
  };
  readonly submissionNotice?: string;
  readonly onQuestionChange: (
    value: string,
    isComposing: boolean,
    invoker: HTMLElement | null,
  ) => void;
  readonly onModeChange: (mode: AskMode) => void;
  readonly onSubmit: () => void;
  readonly onResolveOutcome: () => void;
  readonly t: ProductTranslator;
};

export const GlobalComposer = ({
  workspace,
  availableModes = workspace?.availableAskModes ?? ['CANONICAL_ONLY', 'SOURCE_EXPLORATION'],
  question,
  mode,
  draftReady,
  outcomeUnknown,
  isSubmitting,
  submissionAvailable,
  sourceSelectionMissing,
  providerEligibility,
  submissionNotice,
  onQuestionChange,
  onModeChange,
  onSubmit,
  onResolveOutcome,
  t,
}: GlobalComposerProps) => {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };
  const isComposing = (event: { readonly nativeEvent: Event }) =>
    'isComposing' in event.nativeEvent && event.nativeEvent.isComposing === true;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposing(event) || !(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    event.preventDefault();
    void onSubmit();
  };
  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onQuestionChange(event.currentTarget.value, isComposing(event), event.currentTarget);
  };

  return (
    <form className="global-composer" aria-label="Global Composer" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="global-ask-mode">
        {t('ask.mode')}
      </label>
      <select
        id="global-ask-mode"
        aria-label={t('ask.mode')}
        value={mode}
        disabled={!draftReady || outcomeUnknown}
        onChange={(event) => onModeChange(event.currentTarget.value as AskMode)}
      >
        {availableModes.map((availableMode) => (
          <option key={availableMode} value={availableMode}>
            {hfmOwnerLabel(t, 'askMode', availableMode)}
          </option>
        ))}
      </select>
      <label className="visually-hidden" htmlFor="global-ask-question">
        {t('ask.question')}
      </label>
      <textarea
        id="global-ask-question"
        aria-label={t('ask.question')}
        value={question}
        maxLength={10_000}
        disabled={!draftReady || outcomeUnknown}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <button
        className="hfm-action-primary"
        type="submit"
        disabled={
          !draftReady ||
          !submissionAvailable ||
          question.trim().length === 0 ||
          sourceSelectionMissing ||
          providerEligibility.isPending ||
          isSubmitting ||
          outcomeUnknown
        }
      >
        {isSubmitting ? t('ask.submitting') : t('ask.submit')}
      </button>
      {outcomeUnknown ? (
        <button
          className="hfm-action-secondary"
          type="button"
          disabled={isSubmitting}
          onClick={onResolveOutcome}
        >
          {t('ask.check_submission_outcome')}
        </button>
      ) : null}
      {sourceSelectionMissing ? (
        <p className="ask-form-status hfm-status-attention" role="status">
          {t('ask.source_selection_required')}
        </p>
      ) : null}
      {providerEligibility.data && !providerEligibility.data.eligible ? (
        <p className="ask-form-status hfm-status-attention" role="status">
          {providerEligibility.data.message}
        </p>
      ) : null}
      {providerEligibility.isError ? (
        <p className="ask-form-status hfm-status-attention" role="status">
          {t('ask.provider_eligibility_unavailable')}
        </p>
      ) : null}
      {submissionNotice ? (
        <p className="ask-form-status hfm-status-info" role="status">
          {submissionNotice}
        </p>
      ) : null}
    </form>
  );
};

export type AskSupportControlsProps = {
  readonly mode: AskMode;
  readonly sourceContextAvailable: boolean;
  readonly sourceContextPending: boolean;
  readonly sourceContextError: boolean;
  readonly sourceContextProjectMatches: boolean;
  readonly sourceOptions: readonly SourceLibraryItem[];
  readonly sourceSelections: readonly AskSourceSelectionView[];
  readonly draftReady: boolean;
  readonly outcomeUnknown: boolean;
  readonly onToggleSource: (source: SourceLibraryItem) => void;
  readonly t: ProductTranslator;
};

export const AskSupportControls = ({
  mode,
  sourceContextAvailable,
  sourceContextPending,
  sourceContextError,
  sourceContextProjectMatches,
  sourceOptions = [],
  sourceSelections = [],
  draftReady,
  outcomeUnknown,
  onToggleSource,
  t,
}: AskSupportControlsProps) => {
  if (mode === 'CANONICAL_ONLY') return null;
  return (
    <section className="ask-support-controls" aria-labelledby="ask-source-context-label">
      <h2 id="ask-source-context-label">{t('ask.source_context')}</h2>
      {!sourceContextAvailable ? (
        <p role="status">{t('ask.source_selection_unavailable')}</p>
      ) : sourceContextPending ? (
        <p role="status">{t('ask.loading_sources')}</p>
      ) : sourceContextError ? (
        <p role="alert">{t('ask.sources_load_failed')}</p>
      ) : !sourceContextProjectMatches ? (
        <p role="alert">{t('ask.source_project_mismatch')}</p>
      ) : (sourceOptions ?? []).length === 0 ? (
        <p role="status">{t('ask.no_sources')}</p>
      ) : (
        <ul className="ask-source-list">
          {(sourceOptions ?? []).map((source) => {
            const pinnedSelection = (sourceSelections ?? []).find(
              (selection) => selection.sourceId === source.sourceId,
            );
            const selectable = (source.capabilities ?? []).includes('SELECT_FOR_ASK');
            const versionLabel =
              pinnedSelection && pinnedSelection.sourceVersionId !== source.selectedSourceVersionId
                ? t('ask.pinned_version')
                : `${t('ask.version')} ${source.versionCount}`;
            return (
              <li key={source.sourceId}>
                <label className="ask-source-option">
                  <input
                    type="checkbox"
                    checked={pinnedSelection !== undefined}
                    disabled={!selectable || !draftReady || outcomeUnknown}
                    onChange={() => onToggleSource(source)}
                  />
                  <span>
                    <strong>{source.label}</strong>
                    <span>{versionLabel}</span>
                    <span>{hfmOwnerLabel(t, 'sourceAskUsage', source.askUsageState)}</span>
                    <TechnicalDetails
                      items={[
                        { label: t('ask.source_id'), value: source.sourceId },
                        {
                          label: t('ask.source_version_id'),
                          value: pinnedSelection?.sourceVersionId ?? source.selectedSourceVersionId,
                        },
                      ]}
                    />
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export type ConversationPaneProps = {
  readonly workspace?: AskWorkspaceView;
  readonly runOverrides: Readonly<Record<string, AskAnswerRunSnapshot>>;
  readonly runEvents: Readonly<Record<string, AskAnswerRunEventsView>>;
  readonly pending: boolean;
  readonly outcomeUnknown: boolean;
  readonly pendingAnswerRunId?: string;
  readonly exportedContent?: string;
  readonly onAnswerActions: (context: AnswerCommandContext, invoker: HTMLElement) => void;
  readonly onCancel: (answerRunId: string) => void;
  readonly onRetry: (answerRunId: string, mode: 'SAME_CONTEXT' | 'CURRENT_POLICY') => void;
  readonly onResolveOutcome: () => void;
  readonly t: ProductTranslator;
};

export const ConversationPane = ({
  workspace,
  runOverrides,
  runEvents,
  pending,
  outcomeUnknown,
  pendingAnswerRunId,
  exportedContent,
  onAnswerActions,
  onCancel,
  onRetry,
  onResolveOutcome,
  t,
}: ConversationPaneProps) => {
  const conversation = workspace?.selectedConversation;
  return (
    <section className="conversation-pane" aria-label={t('ask.conversations')}>
      {workspace && (workspace.conversations ?? []).length > 0 ? (
        <ul className="ask-conversation-list" aria-label={t('ask.conversation_list')}>
          {(workspace.conversations ?? []).map((item) => {
            const selected = item.conversationId === conversation?.conversationId;
            return (
              <li key={item.conversationId}>
                {selected ? (
                  <span className="ask-conversation-current" aria-current="page">
                    <strong>{item.title}</strong>
                    <span className="visually-hidden"> {t('ask.current_conversation')}</span>
                  </span>
                ) : (
                  <Link to={`/ask/conversations/${encodeURIComponent(item.conversationId)}`}>
                    <strong>{item.title}</strong>
                  </Link>
                )}
                {item.latestRunState === 'SUCCEEDED'
                  ? null
                  : ` · ${hfmOwnerLabel(t, 'answerRun', item.latestRunState)}`}
              </li>
            );
          })}
        </ul>
      ) : null}
      {conversation ? (
        <section className="ask-selected-conversation" aria-label={t('ask.selected_conversation')}>
          <h3>{conversation.title}</h3>
          {(conversation.branches ?? []).map((branch) => (
            <ol key={branch.branchId} aria-label={branch.label} className="ask-branch-turns">
              {(branch.turns ?? []).map((turn) => {
                const answerRun = runOverrides[turn.answerRun.answerRunId] ?? turn.answerRun;
                const events = runEvents[answerRun.answerRunId];
                const latestPartial =
                  answerRun.partialText ??
                  events?.events
                    .slice()
                    .reverse()
                    .find((event) => event.partialText !== undefined)?.partialText;
                const context: AnswerCommandContext = {
                  projectId: workspace?.projectId ?? '',
                  conversationId: conversation.conversationId,
                  branchId: branch.branchId,
                  turnId: turn.turnId,
                  answerRunId: answerRun.answerRunId,
                  answerRevision: answerRun.answerRevision,
                  state: answerRun.state,
                  capabilities: answerRun.capabilities ?? [],
                };
                const hasAnswerCommands = (answerRun.capabilities ?? []).some((capability) =>
                  [
                    'EXPORT',
                    'RETRY_SAME_CONTEXT',
                    'RETRY_CURRENT_POLICY',
                    'CREATE_INTAKE_DRAFT',
                    'CREATE_DRAFT_CHANGE_SET',
                    'PROPOSE_DIRECTIVE',
                  ].includes(capability),
                );
                return (
                  <li className="ask-turn" key={turn.turnId} tabIndex={-1}>
                    <p className="ask-turn-question">
                      <strong>{t('ask.question')}:</strong> {turn.userMessage}
                    </p>
                    {latestPartial || (answerRun.statements ?? []).length > 0 ? (
                      <div className="ask-answer-content">
                        <h3>{t('ask.answer')}</h3>
                        {latestPartial ? <p aria-live="polite">{latestPartial}</p> : null}
                        {(answerRun.statements ?? []).map((statement) => (
                          <article key={statement.statementId}>
                            <p>{statement.text}</p>
                            <ul className="ask-citation-list">
                              {(statement.citations ?? []).map((citation) => (
                                <li
                                  key={citation.citationId}
                                  id={`citation-${citation.citationId}`}
                                  tabIndex={-1}
                                >
                                  <Link
                                    to={`/sources/${encodeURIComponent(citation.sourceId)}?version=${encodeURIComponent(citation.sourceVersionId)}`}
                                    state={{
                                      citationReturnTarget: {
                                        schemaVersion: '1.0.0',
                                        originRoute: `/ask/conversations/${encodeURIComponent(conversation.conversationId)}`,
                                        resourceKind: 'conversation',
                                        resourceId: conversation.conversationId,
                                        conversationId: conversation.conversationId,
                                        branchId: branch.branchId,
                                        turnId: turn.turnId,
                                        answerRunId: turn.answerRun.answerRunId,
                                        answerRevision: turn.answerRun.answerRevision,
                                        resourceRevision: conversation.conversationRevision,
                                        citationId: citation.citationId,
                                        sourceId: citation.sourceId,
                                        sourceVersionId: citation.sourceVersionId,
                                        evidenceId: citation.evidenceId,
                                        scrollAnchor: citation.citationId,
                                        focusTarget: citation.citationId,
                                        panelId: 'conversations',
                                      },
                                    }}
                                  >
                                    {t('ask.open_evidence')}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {answerRun.state === 'SUCCEEDED' ? null : (
                      <p className="ask-answer-status" role="status">
                        {t('ask.answer_status')}: {hfmOwnerLabel(t, 'answerRun', answerRun.state)}
                      </p>
                    )}
                    {answerRun.failure ? (
                      <p className="ask-answer-failure" role="alert">
                        {answerRun.failure.message}
                      </p>
                    ) : null}
                    {(answerRun.capabilities ?? []).includes('CANCEL') ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onCancel(answerRun.answerRunId)}
                      >
                        {t('ask.cancel_answer')}
                      </button>
                    ) : null}
                    {answerRun.state === 'FAILED' &&
                    (answerRun.capabilities ?? []).includes('RETRY_SAME_CONTEXT') ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onRetry(answerRun.answerRunId, 'SAME_CONTEXT')}
                      >
                        {t('answer.retry_same')}
                      </button>
                    ) : null}
                    {answerRun.state === 'FAILED' &&
                    (answerRun.capabilities ?? []).includes('RETRY_CURRENT_POLICY') ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onRetry(answerRun.answerRunId, 'CURRENT_POLICY')}
                      >
                        {t('answer.retry_policy')}
                      </button>
                    ) : null}
                    {hasAnswerCommands ? (
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={t('ask.answer_actions')}
                        onClick={(event) => onAnswerActions(context, event.currentTarget)}
                      >
                        {t('ask.answer_actions')}
                      </button>
                    ) : null}
                    {outcomeUnknown && pendingAnswerRunId === answerRun.answerRunId ? (
                      <button type="button" onClick={onResolveOutcome}>
                        {t('common.check_result')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ))}
        </section>
      ) : null}
      {exportedContent ? <pre>{exportedContent}</pre> : null}
    </section>
  );
};
