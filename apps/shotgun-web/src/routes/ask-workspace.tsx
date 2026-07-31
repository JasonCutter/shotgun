import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useOutletContext } from 'react-router';

import {
  decodeAskCitationReturnState,
  createAskWorkspaceClient,
  type AskCitationReturnState,
  type AskMode,
  type AskWorkspaceClient,
  type AskWorkspaceView,
  type GlobalShellView,
} from '@shotgun/api-client';

import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';

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
  const [error, setError] = useState<unknown>();
  const navigate = useNavigate();

  const questionRef = useRef(question);
  questionRef.current = question;

  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(undefined);
    setQuestion('');
    setDraftOwnerProjectId(undefined);
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
        canLeaveCurrentContext: questionRef.current.trim().length === 0,
        hasUnsavedDraft: questionRef.current.trim().length > 0,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: false,
      })),
    [question, registerLeaveGuard],
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
  const submissionAvailable = workspace.capabilities.includes('SUBMIT_QUESTION');
  const conversation = workspace.selectedConversation;

  const handleSubmitQuestion = async () => {
    if (!draftReady || !submissionAvailable || question.trim().length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const idempotencyKey = `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const submission = await askClient.submitQuestion({
        schemaVersion: '1.0.0',
        clientRequestId,
        idempotencyKey,
        ...(conversationId ? { conversationId } : {}),
        question: question.trim(),
        mode,
        sourceSelections: [],
      });
      setQuestion('');
      questionRef.current = '';
      if (submission.answerRun.conversationId !== conversationId) {
        navigate(`/ask/conversations/${encodeURIComponent(submission.answerRun.conversationId)}`);
      } else {
        setWorkspace(submission.workspace);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError : new Error(String(submitError)));
    } finally {
      setIsSubmitting(false);
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
          disabled={!draftReady}
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
          disabled={!draftReady}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="button"
          disabled={
            !draftReady || !submissionAvailable || question.trim().length === 0 || isSubmitting
          }
          onClick={handleSubmitQuestion}
        >
          {isSubmitting ? 'Submitting…' : 'Submit question'}
        </button>
        {!submissionAvailable ? (
          <p role="status">
            Server question submission is not active in this implementation slice.
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
                {branch.turns.map((turn) => (
                  <li key={turn.turnId} id={`turn-${turn.turnId}`} tabIndex={-1}>
                    <p>{turn.userMessage}</p>
                    <p>Answer run: {turn.answerRun.state}</p>
                    {turn.answerRun.statements.map((statement) => (
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
                ))}
              </ol>
            ))}
          </section>
        ) : null}
      </section>
    </section>
  );
};
