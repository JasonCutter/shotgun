import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useOutletContext } from 'react-router';

import {
  createAskWorkspaceClient,
  decodeAskCitationReturnState,
  type AskCitationReturnState,
  type AskAnswerRunEventsView,
  type AskAnswerRunSnapshot,
  type AskMode,
  type AskQuestionSubmissionOutcomeView,
  type AskQuestionSubmissionView,
  type AskWorkspaceClient,
  type AskWorkspaceView,
  type GlobalShellView,
} from '@shotgun/api-client';

import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';

type PendingAskCommand = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

type OutcomeResolution =
  | { readonly kind: 'COMPLETED'; readonly submission: AskQuestionSubmissionView }
  | { readonly kind: 'REJECTED'; readonly message: string }
  | { readonly kind: 'UNKNOWN' };

export const AskWorkspace = ({ client }: { readonly client?: AskWorkspaceClient }) => {
  const { conversationId } = useParams<{ readonly conversationId?: string }>();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const location = useLocation();
  const ownedClient = useMemo(() => createAskWorkspaceClient(), []);
  const askClient = client ?? ownedClient;
  const { registerLeaveGuard } = useLeaveGuard();
  const [workspace, setWorkspace] = useState<AskWorkspaceView>();
  const [question, setQuestion] = useState('');
  const [draftOwnerProjectId, setDraftOwnerProjectId] = useState<string>();
  const [mode, setMode] = useState<AskMode>('CANONICAL_ONLY');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingAskCommand>();
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [submissionNotice, setSubmissionNotice] = useState<string>();
  const [runOverrides, setRunOverrides] = useState<Record<string, AskAnswerRunSnapshot>>({});
  const [runEvents, setRunEvents] = useState<Record<string, AskAnswerRunEventsView>>({});
  const [exportedContent, setExportedContent] = useState<string>();
  const [error, setError] = useState<unknown>();
  const navigate = useNavigate();

  const questionRef = useRef(question);
  questionRef.current = question;

  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(undefined);
    setQuestion('');
    setDraftOwnerProjectId(undefined);
    setPendingCommand(undefined);
    setOutcomeUnknown(false);
    setSubmissionNotice(undefined);
    setRunOverrides({});
    setRunEvents({});
    setExportedContent(undefined);
    setError(undefined);
    void askClient
      .getWorkspace(conversationId, { signal: controller.signal })
      .then((value) => {
        setWorkspace(value);
        setDraftOwnerProjectId(value.projectId);
        setMode(value.defaultAskMode);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      });
    return () => controller.abort();
  }, [askClient, conversationId, shell.activeProject?.id]);

  useEffect(
    () =>
      registerLeaveGuard(() => ({
        canLeaveCurrentContext: questionRef.current.trim().length === 0 && !outcomeUnknown,
        hasUnsavedDraft: questionRef.current.trim().length > 0,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: outcomeUnknown,
      })),
    [outcomeUnknown, question, registerLeaveGuard],
  );

  const citationReturn = useMemo<AskCitationReturnState | undefined>(() => {
    const candidate =
      typeof location.state === 'object' && location.state !== null
        ? (location.state as { readonly citationReturn?: unknown }).citationReturn
        : undefined;
    if (candidate === undefined) return undefined;
    try {
      return decodeAskCitationReturnState(candidate);
    } catch {
      return undefined;
    }
  }, [location.state]);

  const validatedReturnTargetId = useMemo(() => {
    if (!citationReturn || !workspace?.selectedConversation) return undefined;
    const conversation = workspace.selectedConversation;
    if (
      citationReturn.conversationId !== conversation.conversationId ||
      citationReturn.resourceId !== conversation.conversationId ||
      citationReturn.resourceRevision !== conversation.conversationRevision
    ) {
      return undefined;
    }
    const branch = conversation.branches.find(
      (candidate) => candidate.branchId === citationReturn.branchId,
    );
    const turn = branch?.turns.find((candidate) => candidate.turnId === citationReturn.turnId);
    if (
      !turn ||
      turn.answerRun.answerRunId !== citationReturn.answerRunId ||
      turn.answerRun.answerRevision !== citationReturn.answerRevision
    ) {
      return undefined;
    }
    const citationExists = turn.answerRun.statements.some((statement) =>
      statement.citations.some((citation) => citation.citationId === citationReturn.citationId),
    );
    return citationExists ? `citation-${citationReturn.citationId}` : undefined;
  }, [citationReturn, workspace]);

  useEffect(() => {
    if (!validatedReturnTargetId) return;
    const target = document.getElementById(validatedReturnTargetId);
    target?.scrollIntoView?.({ block: 'center' });
    target?.focus?.();
  }, [validatedReturnTargetId]);

  const latestAnswerRun = useMemo(() => {
    const selected = workspace?.selectedConversation;
    return selected?.branches
      .flatMap((branch) => branch.turns)
      .sort((left, right) => right.ordinal - left.ordinal)[0]?.answerRun;
  }, [workspace?.selectedConversation]);

  useEffect(() => {
    const answerRun = latestAnswerRun;
    if (!answerRun || !askClient.getAnswerRun || !askClient.getAnswerRunEvents) return;
    let cancelled = false;
    let lastOrdinal = -1;
    const terminal = new Set([
      'ACTION_REQUIRED',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'OUTCOME_UNKNOWN',
    ]);
    const poll = async () => {
      try {
        const [current, events] = await Promise.all([
          askClient.getAnswerRun!(answerRun.answerRunId),
          askClient.getAnswerRunEvents!(answerRun.answerRunId, lastOrdinal),
        ]);
        if (cancelled || current.answerRunId !== answerRun.answerRunId) return;
        setRunOverrides((previous) => ({ ...previous, [current.answerRunId]: current }));
        if (events.events.length > 0) {
          lastOrdinal = Math.max(lastOrdinal, ...events.events.map((event) => event.ordinal));
          setRunEvents((previous) => {
            const prior = previous[events.answerRunId];
            const priorEvents = prior?.events ?? [];
            const byOrdinal = new Map(priorEvents.map((event) => [event.ordinal, event]));
            events.events.forEach((event) => byOrdinal.set(event.ordinal, event));
            return {
              ...previous,
              [events.answerRunId]: {
                ...events,
                events: [...byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal),
              },
            };
          });
        }
        if (terminal.has(current.state)) {
          window.clearInterval(timer);
        }
      } catch {
        // The authoritative workspace remains visible while a transient poll fails.
      }
    };
    const timer = window.setInterval(() => void poll(), 750);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [askClient, latestAnswerRun?.answerRunId, workspace?.projectId, shell.activeProject?.id]);

  if (!shell.activeProject && !conversationId) {
    return <p>Create or select a Project before asking questions.</p>;
  }
  if (error) return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  if (!workspace) return <LoadingState message="Loading Ask workspace…" />;

  const expectedDraftProjectId = conversationId ? workspace.projectId : shell.activeProject?.id;
  const draftReady =
    expectedDraftProjectId !== undefined &&
    workspace.projectId === expectedDraftProjectId &&
    draftOwnerProjectId === workspace.projectId;
  const conversation = workspace.selectedConversation;
  const activeBranch = conversation?.branches.find(
    (branch) => branch.branchId === conversation.activeBranchId,
  );
  const followUpReady =
    !conversationId ||
    Boolean(conversation && activeBranch?.branchRevision && conversation.conversationRevision);
  const submissionAvailable = workspace.capabilities.includes('SUBMIT_QUESTION') && followUpReady;

  const applyVerifiedSubmission = (submission: AskQuestionSubmissionView) => {
    setPendingCommand(undefined);
    setOutcomeUnknown(false);
    setSubmissionNotice(undefined);
    setQuestion('');
    questionRef.current = '';
    if (submission.answerRun.conversationId !== conversationId) {
      navigate(`/ask/conversations/${encodeURIComponent(submission.answerRun.conversationId)}`);
    } else {
      setWorkspace(submission.workspace);
    }
  };

  const submissionFromOutcome = async (
    outcome: AskQuestionSubmissionOutcomeView,
  ): Promise<AskQuestionSubmissionView | undefined> => {
    if (outcome.outcomeState !== 'COMPLETED' || !outcome.answerRun || !outcome.conversationId) {
      return undefined;
    }
    const recoveredWorkspace = await askClient.getWorkspace(outcome.conversationId);
    return {
      schemaVersion: '1.0.0',
      answerRun: outcome.answerRun,
      workspace: recoveredWorkspace,
    };
  };

  const resolveExistingOutcome = async (
    command: PendingAskCommand,
    attempts: number,
  ): Promise<OutcomeResolution> => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
      try {
        const outcome = await askClient.getQuestionSubmissionByClientRequestId(
          command.clientRequestId,
        );
        const recoveredSubmission = await submissionFromOutcome(outcome);
        if (recoveredSubmission) {
          return { kind: 'COMPLETED', submission: recoveredSubmission };
        }
        if (outcome.outcomeState === 'REJECTED') {
          return {
            kind: 'REJECTED',
            message:
              outcome.failureMessage ??
              'The question submission was rejected. The Draft was preserved.',
          };
        }
      } catch {
        // Outcome lookup is retried without resubmitting the mutation.
      }
    }
    return { kind: 'UNKNOWN' };
  };

  const applyResolution = (resolution: OutcomeResolution) => {
    if (resolution.kind === 'COMPLETED') {
      applyVerifiedSubmission(resolution.submission);
      return;
    }
    if (resolution.kind === 'REJECTED') {
      setPendingCommand(undefined);
      setOutcomeUnknown(false);
      setSubmissionNotice(resolution.message);
      return;
    }
    setOutcomeUnknown(true);
    setSubmissionNotice(
      'The submission outcome is still unknown. The original request identity and Draft are preserved.',
    );
  };

  const handleResolveOutcome = async () => {
    if (!pendingCommand || isSubmitting) return;
    setIsSubmitting(true);
    setSubmissionNotice('Checking the existing submission outcome…');
    try {
      applyResolution(await resolveExistingOutcome(pendingCommand, 1));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitQuestion = async () => {
    if (
      !draftReady ||
      !submissionAvailable ||
      question.trim().length === 0 ||
      isSubmitting ||
      outcomeUnknown
    ) {
      return;
    }
    setIsSubmitting(true);
    setSubmissionNotice(undefined);
    const command =
      pendingCommand ??
      ({
        clientRequestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        idempotencyKey: `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      } satisfies PendingAskCommand);
    setPendingCommand(command);

    try {
      const followUpRequest =
        conversationId && conversation && activeBranch?.branchRevision
          ? {
              conversationId,
              branchId: activeBranch.branchId,
              expectedConversationRevision: conversation.conversationRevision,
              expectedBranchRevision: activeBranch.branchRevision,
            }
          : {};
      const submission = await askClient.submitQuestion({
        schemaVersion: '1.0.0',
        clientRequestId: command.clientRequestId,
        idempotencyKey: command.idempotencyKey,
        ...followUpRequest,
        question: question.trim(),
        mode,
        sourceSelections: [],
      });
      applyVerifiedSubmission(submission);
    } catch {
      applyResolution(await resolveExistingOutcome(command, 3));
    } finally {
      setIsSubmitting(false);
    }
  };

  const commandIdentity = () => ({
    schemaVersion: '1.0.0' as const,
    clientRequestId: `ask-run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    idempotencyKey: `ask-run-idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  });

  const setRunOverride = (answerRun: AskAnswerRunSnapshot) =>
    setRunOverrides((previous) => ({ ...previous, [answerRun.answerRunId]: answerRun }));

  const handleCancelAnswerRun = async (answerRunId: string) => {
    if (!askClient.cancelAnswerRun) return;
    try {
      setRunOverride(await askClient.cancelAnswerRun(answerRunId, commandIdentity()));
    } catch (reason) {
      setError(reason);
    }
  };

  const handleRetryAnswerRun = async (
    answerRunId: string,
    retryMode: 'SAME_CONTEXT' | 'CURRENT_POLICY',
  ) => {
    if (!askClient.retryAnswerRun) return;
    try {
      setRunOverride(
        await askClient.retryAnswerRun(answerRunId, { ...commandIdentity(), mode: retryMode }),
      );
    } catch (reason) {
      setError(reason);
    }
  };

  const handleExportAnswerRun = async (answerRunId: string) => {
    if (!askClient.exportAnswerRun) return;
    try {
      const exported = await askClient.exportAnswerRun(answerRunId, {
        ...commandIdentity(),
        format: 'MARKDOWN',
      });
      setExportedContent(exported.content);
    } catch (reason) {
      setError(reason);
    }
  };

  const handleFeedback = async (answerRunId: string, kind: 'HELPFUL' | 'NOT_HELPFUL') => {
    if (!askClient.submitAnswerFeedback) return;
    try {
      await askClient.submitAnswerFeedback(answerRunId, { ...commandIdentity(), kind });
      setSubmissionNotice('Feedback recorded for this AnswerRun.');
    } catch (reason) {
      setError(reason);
    }
  };

  const handleTransitionSeed = async (
    answerRunId: string,
    kind: 'INTAKE_DRAFT' | 'DRAFT_CHANGE_SET' | 'USER_DIRECTIVE',
  ) => {
    if (!askClient.createAnswerTransitionSeed) return;
    try {
      await askClient.createAnswerTransitionSeed(answerRunId, { ...commandIdentity(), kind });
      setSubmissionNotice(`${kind} transition seed proposed. Canonical knowledge was not changed.`);
    } catch (reason) {
      setError(reason);
    }
  };

  return (
    <section className="route-page ask-workspace">
      <p className="eyebrow">Knowledge question</p>
      <h1 tabIndex={-1}>Ask</h1>
      <p>
        Project: <strong>{workspace.projectId}</strong>
      </p>

      <section className="action-card" aria-labelledby="ask-draft-heading">
        <h2 id="ask-draft-heading">Question Draft</h2>
        <p>
          This draft remains browser-only until the protected Ask command boundary is active. It is
          never treated as Canonical knowledge or original Evidence.
        </p>
        <label htmlFor="ask-mode">Ask mode</label>
        <select
          id="ask-mode"
          value={mode}
          disabled={!draftReady || outcomeUnknown}
          onChange={(event) => setMode(event.target.value as AskMode)}
        >
          {workspace.availableAskModes.map((availableMode) => (
            <option key={availableMode} value={availableMode}>
              {availableMode}
            </option>
          ))}
        </select>
        <label htmlFor="ask-question">Question</label>
        <textarea
          id="ask-question"
          value={question}
          maxLength={10_000}
          disabled={!draftReady || outcomeUnknown}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="button"
          disabled={
            !draftReady ||
            !submissionAvailable ||
            question.trim().length === 0 ||
            isSubmitting ||
            outcomeUnknown
          }
          onClick={handleSubmitQuestion}
        >
          {isSubmitting ? 'Submitting…' : 'Submit question'}
        </button>
        {outcomeUnknown && pendingCommand ? (
          <button type="button" disabled={isSubmitting} onClick={handleResolveOutcome}>
            Check submission outcome
          </button>
        ) : null}
        {submissionNotice ? <p role="status">{submissionNotice}</p> : null}
        {!submissionAvailable ? (
          <p role="status">
            Server question submission is not available for this Conversation state.
          </p>
        ) : null}
      </section>

      <section className="action-card" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading">Conversations</h2>
        {workspace.conversations.length === 0 ? <p>No conversations yet.</p> : null}
        {workspace.conversations.length > 0 ? (
          <ul aria-label="Conversations">
            {workspace.conversations.map((item) => (
              <li key={item.conversationId}>
                <Link to={`/ask/conversations/${encodeURIComponent(item.conversationId)}`}>
                  <strong>{item.title}</strong>
                </Link>{' '}
                · {item.turnCount} turns · {item.latestRunState}
              </li>
            ))}
          </ul>
        ) : null}

        {conversation ? (
          <section
            aria-label="Selected conversation"
            id={`conversation-${conversation.conversationId}`}
          >
            <h3>{conversation.title}</h3>
            {conversation.branches.map((branch) => (
              <ol key={branch.branchId} id={`branch-${branch.branchId}`} aria-label={branch.label}>
                {branch.turns.map((turn) => {
                  const answerRun = runOverrides[turn.answerRun.answerRunId] ?? turn.answerRun;
                  const events = runEvents[answerRun.answerRunId];
                  const latestPartial =
                    answerRun.partialText ??
                    events?.events
                      .slice()
                      .reverse()
                      .find((event) => event.partialText !== undefined)?.partialText;
                  return (
                    <li key={turn.turnId} id={`turn-${turn.turnId}`} tabIndex={-1}>
                      <p>{turn.userMessage}</p>
                      <p>
                        Answer run: <strong>{answerRun.state}</strong>
                      </p>
                      {latestPartial ? (
                        <p aria-live="polite">Partial answer: {latestPartial}</p>
                      ) : null}
                      {answerRun.failure ? (
                        <p role="alert">
                          {answerRun.failure.message} ({answerRun.failure.code})
                        </p>
                      ) : null}
                      <div className="action-row" aria-label="AnswerRun actions">
                        {answerRun.capabilities.includes('CANCEL') ? (
                          <button
                            type="button"
                            onClick={() => void handleCancelAnswerRun(answerRun.answerRunId)}
                          >
                            Cancel answer
                          </button>
                        ) : null}
                        {answerRun.capabilities.includes('RETRY_SAME_CONTEXT') ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleRetryAnswerRun(answerRun.answerRunId, 'SAME_CONTEXT')
                            }
                          >
                            Retry same context
                          </button>
                        ) : null}
                        {answerRun.capabilities.includes('RETRY_CURRENT_POLICY') ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleRetryAnswerRun(answerRun.answerRunId, 'CURRENT_POLICY')
                            }
                          >
                            Retry current policy
                          </button>
                        ) : null}
                        {answerRun.capabilities.includes('EXPORT') ? (
                          <button
                            type="button"
                            onClick={() => void handleExportAnswerRun(answerRun.answerRunId)}
                          >
                            Export answer
                          </button>
                        ) : null}
                        {answerRun.state === 'SUCCEEDED' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleFeedback(answerRun.answerRunId, 'HELPFUL')}
                            >
                              Helpful
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleFeedback(answerRun.answerRunId, 'NOT_HELPFUL')
                              }
                            >
                              Not helpful
                            </button>
                          </>
                        ) : null}
                        {answerRun.capabilities.includes('CREATE_INTAKE_DRAFT') ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleTransitionSeed(answerRun.answerRunId, 'INTAKE_DRAFT')
                            }
                          >
                            Propose Intake Draft
                          </button>
                        ) : null}
                        {answerRun.capabilities.includes('CREATE_DRAFT_CHANGE_SET') ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleTransitionSeed(answerRun.answerRunId, 'DRAFT_CHANGE_SET')
                            }
                          >
                            Propose Draft ChangeSet
                          </button>
                        ) : null}
                        {answerRun.capabilities.includes('PROPOSE_DIRECTIVE') ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleTransitionSeed(answerRun.answerRunId, 'USER_DIRECTIVE')
                            }
                          >
                            Propose Directive
                          </button>
                        ) : null}
                      </div>
                      {answerRun.statements.map((statement) => (
                        <article
                          key={statement.statementId}
                          id={`statement-${statement.statementId}`}
                        >
                          <p>{statement.text}</p>
                          <ul>
                            {statement.citations.map((citation) => (
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
                                  Open pinned Evidence
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </li>
                  );
                })}
              </ol>
            ))}
          </section>
        ) : null}
      </section>
      {exportedContent ? (
        <section className="action-card" aria-labelledby="ask-export-heading">
          <h2 id="ask-export-heading">Answer export</h2>
          <pre>{exportedContent}</pre>
        </section>
      ) : null}
    </section>
  );
};
