import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useOutletContext } from 'react-router';

import {
  createAskWorkspaceClient,
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
  const [draftOwnerProjectId, setDraftOwnerProjectId] = useState<string | undefined>();
  const [mode, setMode] = useState<AskMode>('CANONICAL_ONLY');
  const [error, setError] = useState<unknown>();

  const questionRef = useRef(question);
  questionRef.current = question;

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void askClient
      .getWorkspace(conversationId, { signal: controller.signal })
      .then((value) => {
        setWorkspace(value);
        setMode(value.defaultAskMode);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      });
    return () => controller.abort();
  }, [askClient, conversationId, shell.activeProject?.id]);

  useEffect(() => {
    if (workspace && draftOwnerProjectId !== workspace.projectId) {
      setQuestion('');
      setDraftOwnerProjectId(workspace.projectId);
    }
  }, [workspace, draftOwnerProjectId]);

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

  const citationReturn = useMemo(() => {
    if (typeof location.state === 'object' && location.state !== null) {
      return (location.state as { readonly citationReturn?: Record<string, unknown> })
        .citationReturn;
    }
    return undefined;
  }, [location.state]);

  useEffect(() => {
    if (!citationReturn || !workspace) return;
    const targetId =
      (citationReturn.focusTarget as string) ||
      (citationReturn.scrollAnchor as string) ||
      (citationReturn.citationId as string) ||
      (citationReturn.turnId as string);
    if (targetId) {
      const el =
        document.getElementById(`citation-${targetId}`) ||
        document.getElementById(`turn-${targetId}`) ||
        document.getElementById(targetId);
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus?.();
    }
  }, [citationReturn, workspace]);

  if (!shell.activeProject && !conversationId) {
    return <p>Create or select a Project before asking questions.</p>;
  }
  if (error) return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  if (!workspace) return <LoadingState message="Loading Ask workspace…" />;

  const submissionAvailable = workspace.capabilities.includes('SUBMIT_QUESTION');
  const conversation = workspace.selectedConversation;

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
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="button" disabled={!submissionAvailable || question.trim().length === 0}>
          Submit question
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
                                    originRoute: `/ask/conversations/${conversation.conversationId}`,
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
