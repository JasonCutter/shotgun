import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useOutletContext } from 'react-router';

import {
  createAskWorkspaceClient,
  decodeAskCitationReturnState,
  type AskCitationReturnState,
  type AskAnswerRunEventsView,
  type AskAnswerRunSnapshot,
  type AskMode,
  type AskProviderEligibilityView,
  type AskQuestionSubmissionOutcomeView,
  type AskQuestionSubmissionView,
  type AskSourceSelectionView,
  type AskWorkspaceClient,
  type AskWorkspaceView,
  type GlobalShellView,
  type SourceLibraryPageView,
  type SourceLibraryQuery,
} from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import {
  answerRunLabel,
  askModeLabel,
  sourceAskUsageLabel,
} from '../presentation/product-labels.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import {
  askConversationSourceContextQueryOptions,
  sourcesLibraryQueryOptions,
} from '../sources/sources-queries.js';

const SOURCE_CONTEXT_QUERY: SourceLibraryQuery = {
  schemaVersion: '1.0.0',
  filters: {},
  sort: 'UPDATED_DESC',
  limit: 100,
};

const ANSWER_RUN_POLLING_COMPLETE_STATES = new Set<AskAnswerRunSnapshot['state']>([
  'ACTION_REQUIRED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'OUTCOME_UNKNOWN',
]);

const conversationTurnCountLabel = (turnCount: number): string =>
  `${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}`;

type SourceLibraryItem = SourceLibraryPageView['items'][number];

type PendingAskCommand = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

type PendingAnswerRunCommand = {
  readonly answerRunId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly operation: 'CANCEL' | 'RETRY' | 'EXPORT' | 'FEEDBACK' | 'TRANSITION_SEED';
  readonly retryMode?: 'SAME_CONTEXT' | 'CURRENT_POLICY';
  readonly feedbackKind?: 'HELPFUL' | 'NOT_HELPFUL';
  readonly transitionKind?: 'INTAKE_DRAFT' | 'DRAFT_CHANGE_SET' | 'USER_DIRECTIVE';
};

type OutcomeResolution =
  | { readonly kind: 'COMPLETED'; readonly submission: AskQuestionSubmissionView }
  | { readonly kind: 'REJECTED'; readonly message: string }
  | { readonly kind: 'UNKNOWN' };

export const AskWorkspace = ({ client }: { readonly client?: AskWorkspaceClient }) => {
  const { conversationId } = useParams<{ readonly conversationId?: string }>();
  const { shell } = useOutletContext<{ readonly shell: GlobalShellView }>();
  const { apiClient } = useAppRuntime();
  const location = useLocation();
  const ownedClient = useMemo(() => createAskWorkspaceClient(), []);
  const askClient = client ?? ownedClient;
  const { registerLeaveGuard } = useLeaveGuard();
  const [workspace, setWorkspace] = useState<AskWorkspaceView>();
  const [question, setQuestion] = useState('');
  const [draftOwnerProjectId, setDraftOwnerProjectId] = useState<string>();
  const [mode, setMode] = useState<AskMode>('CANONICAL_ONLY');
  const [sourceSelections, setSourceSelections] = useState<readonly AskSourceSelectionView[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingAskCommand>();
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [pendingAnswerRunCommand, setPendingAnswerRunCommand] = useState<PendingAnswerRunCommand>();
  const [answerRunOutcomeUnknown, setAnswerRunOutcomeUnknown] = useState(false);
  const [answerRunCommandNotice, setAnswerRunCommandNotice] = useState<string>();
  const [pollingGeneration, setPollingGeneration] = useState(0);
  const [submissionNotice, setSubmissionNotice] = useState<string>();
  const [runOverrides, setRunOverrides] = useState<Record<string, AskAnswerRunSnapshot>>({});
  const [runEvents, setRunEvents] = useState<Record<string, AskAnswerRunEventsView>>({});
  const [exportedContent, setExportedContent] = useState<string>();
  const [error, setError] = useState<unknown>();
  const navigate = useNavigate();
  const sourceLibrary = useQuery({
    ...sourcesLibraryQueryOptions(apiClient, shell, SOURCE_CONTEXT_QUERY),
    enabled:
      mode !== 'CANONICAL_ONLY' &&
      workspace !== undefined &&
      conversationId === undefined &&
      shell.activeProject?.id === workspace.projectId,
  });
  const workspaceProjectLabel = workspace
    ? (shell.accessibleProjects.find((project) => project.id === workspace.projectId)?.label ??
      'Conversation project')
    : 'Project';
  const conversationSourceContext = useQuery({
    ...askConversationSourceContextQueryOptions(
      askClient,
      shell,
      workspace,
      conversationId,
      SOURCE_CONTEXT_QUERY,
    ),
    enabled: mode !== 'CANONICAL_ONLY' && workspace !== undefined && conversationId !== undefined,
  });
  const providerEligibility = useQuery<AskProviderEligibilityView>({
    queryKey: [
      'ask',
      'provider-eligibility',
      workspace?.projectId,
      conversationId,
      mode,
      sourceSelections,
    ],
    queryFn: () =>
      askClient.getProviderEligibility({
        schemaVersion: '1.0.0',
        ...(conversationId ? { conversationId } : {}),
        mode,
        sourceSelections: mode === 'CANONICAL_ONLY' ? [] : sourceSelections,
      }),
    enabled: workspace !== undefined,
  });

  const questionRef = useRef(question);
  questionRef.current = question;

  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(undefined);
    setQuestion('');
    setDraftOwnerProjectId(undefined);
    setSourceSelections([]);
    setPendingCommand(undefined);
    setOutcomeUnknown(false);
    setPendingAnswerRunCommand(undefined);
    setAnswerRunOutcomeUnknown(false);
    setAnswerRunCommandNotice(undefined);
    setPollingGeneration(0);
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
        canLeaveCurrentContext:
          questionRef.current.trim().length === 0 && !outcomeUnknown && !answerRunOutcomeUnknown,
        hasUnsavedDraft: questionRef.current.trim().length > 0,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: outcomeUnknown || answerRunOutcomeUnknown,
      })),
    [answerRunOutcomeUnknown, outcomeUnknown, question, registerLeaveGuard],
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
    const latestTurn = selected?.branches
      .flatMap((branch) => branch.turns)
      .sort((left, right) => right.ordinal - left.ordinal)[0];
    return latestTurn
      ? (runOverrides[latestTurn.answerRun.answerRunId] ?? latestTurn.answerRun)
      : undefined;
  }, [runOverrides, workspace?.selectedConversation]);

  useEffect(() => {
    const answerRun = latestAnswerRun;
    if (!answerRun || !askClient.getAnswerRun || !askClient.getAnswerRunEvents) return;
    let cancelled = false;
    let lastOrdinal = -1;
    let polling = false;
    let shouldContinue = true;
    let timer: number | undefined;
    const controller = new AbortController();
    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), 750);
    };
    const poll = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const eventsRequest =
          lastOrdinal < 0
            ? askClient.getAnswerRunEvents!(answerRun.answerRunId, undefined, {
                signal: controller.signal,
              })
            : askClient.getAnswerRunEvents!(answerRun.answerRunId, lastOrdinal, {
                signal: controller.signal,
              });
        const [current, events] = await Promise.all([
          askClient.getAnswerRun!(answerRun.answerRunId, { signal: controller.signal }),
          eventsRequest,
        ]);
        if (
          cancelled ||
          current.answerRunId !== answerRun.answerRunId ||
          (answerRun.attemptId !== undefined &&
            current.attemptId !== undefined &&
            current.attemptId !== answerRun.attemptId)
        )
          return;
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
        if (ANSWER_RUN_POLLING_COMPLETE_STATES.has(current.state)) {
          if (!ANSWER_RUN_POLLING_COMPLETE_STATES.has(answerRun.state)) {
            const refreshedWorkspace = await askClient.getWorkspace(conversationId, {
              signal: controller.signal,
            });
            if (
              cancelled ||
              refreshedWorkspace.projectId !== workspace?.projectId ||
              (conversationId !== undefined &&
                refreshedWorkspace.selectedConversation?.conversationId !== conversationId)
            ) {
              return;
            }
            setWorkspace(refreshedWorkspace);
          }
          shouldContinue = false;
          return;
        }
      } catch {
        // The authoritative workspace remains visible while a transient poll fails.
      } finally {
        polling = false;
        if (shouldContinue) schedule();
      }
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    askClient,
    latestAnswerRun?.answerRunId,
    latestAnswerRun?.attemptId,
    latestAnswerRun?.attemptNumber,
    pollingGeneration,
    workspace?.projectId,
    shell.activeProject?.id,
  ]);

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
  const submissionAvailable =
    workspace.capabilities.includes('SUBMIT_QUESTION') &&
    followUpReady &&
    providerEligibility.data?.eligible === true;
  const answerRunMutationPending = pendingAnswerRunCommand !== undefined;
  const sourceLibraryPage = sourceLibrary.data;
  const conversationSourceContextView = conversationSourceContext.data;
  const sourceContextProjectMatches = conversationId
    ? conversationSourceContextView?.resourceProjectId === workspace.projectId
    : sourceLibraryPage?.projectId === workspace.projectId;
  const sourceOptions = sourceContextProjectMatches
    ? (conversationSourceContextView?.items ?? sourceLibraryPage?.items ?? []).filter(
        (source) => source.projectId === workspace.projectId,
      )
    : [];
  const sourceContextAvailable =
    conversationId !== undefined || shell.activeProject?.id === workspace.projectId;
  const sourceContextPending = conversationId
    ? conversationSourceContext.isPending
    : sourceLibrary.isPending;
  const sourceContextError = conversationId
    ? conversationSourceContext.isError
    : sourceLibrary.isError;
  const sourceSelectionMissing = mode === 'SOURCE_EXPLORATION' && sourceSelections.length === 0;

  const toggleSourceSelection = (source: SourceLibraryItem) => {
    setSourceSelections((previous) => {
      const existing = previous.find((selection) => selection.sourceId === source.sourceId);
      if (existing) {
        return previous.filter((selection) => selection.sourceId !== source.sourceId);
      }
      return [
        ...previous,
        {
          sourceId: source.sourceId,
          sourceVersionId: source.selectedSourceVersionId,
          evidenceIds: [],
        },
      ];
    });
  };

  const applyVerifiedSubmission = (submission: AskQuestionSubmissionView) => {
    setPendingCommand(undefined);
    setOutcomeUnknown(false);
    setSubmissionNotice(undefined);
    setQuestion('');
    setSourceSelections([]);
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
      sourceSelectionMissing ||
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
        sourceSelections: mode === 'CANONICAL_ONLY' ? [] : sourceSelections,
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

  const beginAnswerRunCommand = (
    answerRunId: string,
    operation: PendingAnswerRunCommand['operation'],
    details: Pick<PendingAnswerRunCommand, 'retryMode' | 'feedbackKind' | 'transitionKind'> = {},
  ): PendingAnswerRunCommand | undefined => {
    if (answerRunMutationPending) return undefined;
    const identity = commandIdentity();
    const pending: PendingAnswerRunCommand = {
      answerRunId,
      clientRequestId: identity.clientRequestId,
      idempotencyKey: identity.idempotencyKey,
      operation,
      ...details,
    };
    setPendingAnswerRunCommand(pending);
    setAnswerRunOutcomeUnknown(false);
    setAnswerRunCommandNotice(undefined);
    return pending;
  };

  const answerRunCommandIdentity = (pending: PendingAnswerRunCommand) => ({
    schemaVersion: '1.0.0' as const,
    clientRequestId: pending.clientRequestId,
    idempotencyKey: pending.idempotencyKey,
  });

  const resolveAnswerRunCommandOutcome = async (
    pending: PendingAnswerRunCommand,
  ): Promise<void> => {
    if (!askClient.getAnswerRunCommandOutcome) {
      setAnswerRunOutcomeUnknown(true);
      setAnswerRunCommandNotice(
        'The AnswerRun command outcome is unknown. The original command identity is preserved.',
      );
      return;
    }

    let outcome;
    try {
      outcome = await askClient.getAnswerRunCommandOutcome(
        pending.answerRunId,
        pending.clientRequestId,
      );
    } catch {
      setAnswerRunOutcomeUnknown(true);
      setAnswerRunCommandNotice(
        'The AnswerRun command outcome is still unknown. Retry the outcome check without submitting a new command.',
      );
      return;
    }

    if (outcome.outcomeState === 'REJECTED') {
      setPendingAnswerRunCommand(undefined);
      setAnswerRunOutcomeUnknown(false);
      setAnswerRunCommandNotice(
        outcome.rejection?.message ??
          'The AnswerRun command was rejected. No new command was sent.',
      );
      return;
    }
    if (outcome.outcomeState !== 'COMPLETED') {
      setAnswerRunOutcomeUnknown(true);
      setAnswerRunCommandNotice(
        'The AnswerRun command is accepted but not resolved. No automatic retry was started.',
      );
      return;
    }

    try {
      const identity = answerRunCommandIdentity(pending);
      switch (pending.operation) {
        case 'CANCEL':
          if (!askClient.cancelAnswerRun) throw new Error('Cancel replay is unavailable.');
          setRunOverride(await askClient.cancelAnswerRun(pending.answerRunId, identity));
          break;
        case 'RETRY':
          if (!askClient.retryAnswerRun || !pending.retryMode)
            throw new Error('Retry replay is unavailable.');
          setRunOverride(
            await askClient.retryAnswerRun(pending.answerRunId, {
              ...identity,
              mode: pending.retryMode,
            }),
          );
          setPollingGeneration((generation) => generation + 1);
          break;
        case 'EXPORT': {
          if (!askClient.exportAnswerRun) throw new Error('Export replay is unavailable.');
          const exported = await askClient.exportAnswerRun(pending.answerRunId, {
            ...identity,
            format: 'MARKDOWN',
          });
          setExportedContent(exported.content);
          break;
        }
        case 'FEEDBACK':
          if (!askClient.submitAnswerFeedback || !pending.feedbackKind)
            throw new Error('Feedback replay is unavailable.');
          await askClient.submitAnswerFeedback(pending.answerRunId, {
            ...identity,
            kind: pending.feedbackKind,
          });
          break;
        case 'TRANSITION_SEED':
          if (!askClient.createAnswerTransitionSeed || !pending.transitionKind)
            throw new Error('Transition seed replay is unavailable.');
          await askClient.createAnswerTransitionSeed(pending.answerRunId, {
            ...identity,
            kind: pending.transitionKind,
          });
          break;
      }
    } catch {
      setPendingAnswerRunCommand(undefined);
      setAnswerRunOutcomeUnknown(false);
      setAnswerRunCommandNotice(
        'The command is completed, but its resource could not be recovered yet. The original command identity was retained.',
      );
      return;
    }

    setPendingAnswerRunCommand(undefined);
    setAnswerRunOutcomeUnknown(false);
    setAnswerRunCommandNotice('The completed AnswerRun command and its resource were recovered.');
  };

  const handleResolveAnswerRunCommandOutcome = async () => {
    if (!pendingAnswerRunCommand || !answerRunOutcomeUnknown) return;
    await resolveAnswerRunCommandOutcome(pendingAnswerRunCommand);
  };

  const handleCancelAnswerRun = async (answerRunId: string) => {
    if (!askClient.cancelAnswerRun) return;
    const pending = beginAnswerRunCommand(answerRunId, 'CANCEL');
    if (!pending) return;
    try {
      setRunOverride(
        await askClient.cancelAnswerRun(answerRunId, answerRunCommandIdentity(pending)),
      );
      setPendingAnswerRunCommand(undefined);
      setAnswerRunCommandNotice('AnswerRun cancellation requested.');
    } catch {
      await resolveAnswerRunCommandOutcome(pending);
    }
  };

  const handleRetryAnswerRun = async (
    answerRunId: string,
    retryMode: 'SAME_CONTEXT' | 'CURRENT_POLICY',
  ) => {
    if (!askClient.retryAnswerRun) return;
    const pending = beginAnswerRunCommand(answerRunId, 'RETRY', { retryMode });
    if (!pending) return;
    try {
      setRunOverride(
        await askClient.retryAnswerRun(answerRunId, {
          ...answerRunCommandIdentity(pending),
          mode: retryMode,
        }),
      );
      setPollingGeneration((generation) => generation + 1);
      setPendingAnswerRunCommand(undefined);
      setAnswerRunCommandNotice('AnswerRun retry accepted with a new attempt.');
    } catch {
      await resolveAnswerRunCommandOutcome(pending);
    }
  };

  const handleExportAnswerRun = async (answerRunId: string) => {
    if (!askClient.exportAnswerRun) return;
    const pending = beginAnswerRunCommand(answerRunId, 'EXPORT');
    if (!pending) return;
    try {
      const exported = await askClient.exportAnswerRun(answerRunId, {
        ...answerRunCommandIdentity(pending),
        format: 'MARKDOWN',
      });
      setExportedContent(exported.content);
      setPendingAnswerRunCommand(undefined);
      setAnswerRunCommandNotice('AnswerRun export completed.');
    } catch {
      await resolveAnswerRunCommandOutcome(pending);
    }
  };

  const handleFeedback = async (answerRunId: string, kind: 'HELPFUL' | 'NOT_HELPFUL') => {
    if (!askClient.submitAnswerFeedback) return;
    const pending = beginAnswerRunCommand(answerRunId, 'FEEDBACK', { feedbackKind: kind });
    if (!pending) return;
    try {
      await askClient.submitAnswerFeedback(answerRunId, {
        ...answerRunCommandIdentity(pending),
        kind,
      });
      setPendingAnswerRunCommand(undefined);
      setAnswerRunCommandNotice('Feedback recorded for this AnswerRun.');
    } catch {
      await resolveAnswerRunCommandOutcome(pending);
    }
  };

  const handleTransitionSeed = async (
    answerRunId: string,
    kind: 'INTAKE_DRAFT' | 'DRAFT_CHANGE_SET' | 'USER_DIRECTIVE',
  ) => {
    if (!askClient.createAnswerTransitionSeed) return;
    const pending = beginAnswerRunCommand(answerRunId, 'TRANSITION_SEED', {
      transitionKind: kind,
    });
    if (!pending) return;
    try {
      await askClient.createAnswerTransitionSeed(answerRunId, {
        ...answerRunCommandIdentity(pending),
        kind,
      });
      setPendingAnswerRunCommand(undefined);
      setAnswerRunCommandNotice(
        'A draft transition was proposed. Verified knowledge was not changed.',
      );
    } catch {
      await resolveAnswerRunCommandOutcome(pending);
    }
  };

  return (
    <section className="route-page ask-workspace">
      <p className="eyebrow">Knowledge question</p>
      <h1 tabIndex={-1}>Ask</h1>
      <p>
        Project: <strong>{workspaceProjectLabel}</strong>
      </p>

      <section className="action-card" aria-labelledby="ask-draft-heading">
        <h2 id="ask-draft-heading">Question Draft</h2>
        <p>
          This draft remains browser-only until the protected Ask command boundary is active. It is
          never treated as Canonical knowledge or original Evidence.
        </p>
        <form
          className="ask-question-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmitQuestion();
          }}
        >
          <label htmlFor="ask-mode">Ask mode</label>
          <select
            id="ask-mode"
            value={mode}
            disabled={!draftReady || outcomeUnknown}
            onChange={(event) => {
              setMode(event.target.value as AskMode);
              setSubmissionNotice(undefined);
            }}
          >
            {workspace.availableAskModes.map((availableMode) => (
              <option key={availableMode} value={availableMode}>
                {askModeLabel(availableMode)}
              </option>
            ))}
          </select>

          {mode !== 'CANONICAL_ONLY' ? (
            <>
              <span className="ask-form-label" id="ask-source-context-label">
                Source context
              </span>
              <fieldset className="ask-source-context" aria-labelledby="ask-source-context-label">
                <legend className="visually-hidden">Source context</legend>
                {!sourceContextAvailable ? (
                  <p role="status">Source selection is unavailable for this question context.</p>
                ) : sourceContextPending ? (
                  <p role="status">Loading server-authorized Sources…</p>
                ) : sourceContextError ? (
                  <p role="alert">Server-authorized Sources could not be loaded.</p>
                ) : !sourceContextProjectMatches ? (
                  <p role="alert">The Source Library Project does not match this Ask resource.</p>
                ) : sourceOptions.length === 0 ? (
                  <p role="status">No Sources are available for Ask in this Project.</p>
                ) : (
                  <ul className="ask-source-list">
                    {sourceOptions.map((source) => {
                      const pinnedSelection = sourceSelections.find(
                        (selection) => selection.sourceId === source.sourceId,
                      );
                      const selectable = source.capabilities.includes('SELECT_FOR_ASK');
                      return (
                        <li key={source.sourceId}>
                          <label className="ask-source-option">
                            <input
                              type="checkbox"
                              checked={pinnedSelection !== undefined}
                              disabled={!selectable || !draftReady || outcomeUnknown}
                              onChange={() => toggleSourceSelection(source)}
                            />
                            <span>
                              <strong>{source.label}</strong>
                              <span>
                                {pinnedSelection &&
                                pinnedSelection.sourceVersionId !== source.selectedSourceVersionId
                                  ? 'Pinned version'
                                  : `Version ${source.versionCount}`}
                              </span>
                              <span>{sourceAskUsageLabel(source.askUsageState)}</span>
                              <TechnicalDetails
                                items={[
                                  { label: 'Source ID', value: source.sourceId },
                                  {
                                    label: 'SourceVersion ID',
                                    value:
                                      pinnedSelection?.sourceVersionId ??
                                      source.selectedSourceVersionId,
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
              </fieldset>
            </>
          ) : null}

          <label htmlFor="ask-question">Question</label>
          <textarea
            id="ask-question"
            value={question}
            maxLength={10_000}
            disabled={!draftReady || outcomeUnknown}
            onChange={(event) => setQuestion(event.target.value)}
          />

          <div className="ask-question-actions">
            <button
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
              {isSubmitting ? 'Submitting…' : 'Submit question'}
            </button>
            {outcomeUnknown && pendingCommand ? (
              <button type="button" disabled={isSubmitting} onClick={handleResolveOutcome}>
                Check submission outcome
              </button>
            ) : null}
          </div>
          {sourceSelectionMissing ? (
            <p className="ask-form-status" role="status">
              Select at least one Source before using selected sources.
            </p>
          ) : null}
          {providerEligibility.data && !providerEligibility.data.eligible ? (
            <div className="ask-form-status" role="status">
              <strong>Action required:</strong> {providerEligibility.data.message}
              {providerEligibility.data.requiredAction === 'REVIEW_PROJECT_PRIVACY_SETTINGS' ? (
                <p>Open Project Privacy settings to request and approve external AI transfer.</p>
              ) : null}
            </div>
          ) : null}
          {providerEligibility.isError ? (
            <p className="ask-form-status" role="status">
              Provider eligibility could not be verified. Submission remains unavailable.
            </p>
          ) : null}
          {submissionNotice ? (
            <p className="ask-form-status" role="status">
              {submissionNotice}
            </p>
          ) : null}
          {!submissionAvailable && providerEligibility.data?.eligible !== false ? (
            <p className="ask-form-status" role="status">
              Server question submission is not available for this Conversation state.
            </p>
          ) : null}
        </form>
      </section>

      {answerRunCommandNotice ? <p role="status">{answerRunCommandNotice}</p> : null}

      <section className="action-card" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading">Conversations</h2>
        {workspace.conversations.length === 0 ? <p>No conversations yet.</p> : null}
        {workspace.conversations.length > 0 ? (
          <ul className="ask-conversation-list" aria-label="Conversations">
            {workspace.conversations.map((item) => {
              const selected = item.conversationId === conversation?.conversationId;
              return (
                <li key={item.conversationId}>
                  {selected ? (
                    <span className="ask-conversation-current" aria-current="page">
                      <strong>{item.title}</strong>
                      <span className="visually-hidden"> (current conversation)</span>
                    </span>
                  ) : (
                    <Link to={`/ask/conversations/${encodeURIComponent(item.conversationId)}`}>
                      <strong>{item.title}</strong>
                    </Link>
                  )}{' '}
                  · {conversationTurnCountLabel(item.turnCount)} ·{' '}
                  {answerRunLabel(item.latestRunState)}
                </li>
              );
            })}
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
                        Answer: <strong>{answerRunLabel(answerRun.state)}</strong>
                      </p>
                      {latestPartial ? (
                        <p aria-live="polite">Partial answer: {latestPartial}</p>
                      ) : null}
                      {answerRun.failure ? <p role="alert">{answerRun.failure.message}</p> : null}
                      {answerRun.failure ? (
                        <TechnicalDetails
                          items={[{ label: 'Failure code', value: answerRun.failure.code }]}
                        />
                      ) : null}
                      <div className="answer-action-row" aria-label="AnswerRun actions">
                        {answerRun.capabilities.includes('CANCEL') ? (
                          <button
                            type="button"
                            disabled={answerRunMutationPending}
                            onClick={() => void handleCancelAnswerRun(answerRun.answerRunId)}
                          >
                            Cancel answer
                          </button>
                        ) : null}
                        {answerRun.capabilities.includes('RETRY_SAME_CONTEXT') ? (
                          <button
                            type="button"
                            disabled={answerRunMutationPending}
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
                            disabled={answerRunMutationPending}
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
                            disabled={answerRunMutationPending}
                            onClick={() => void handleExportAnswerRun(answerRun.answerRunId)}
                          >
                            Export answer
                          </button>
                        ) : null}
                        {answerRun.state === 'SUCCEEDED' ? (
                          <>
                            <button
                              type="button"
                              disabled={answerRunMutationPending}
                              onClick={() => void handleFeedback(answerRun.answerRunId, 'HELPFUL')}
                            >
                              Helpful
                            </button>
                            <button
                              type="button"
                              disabled={answerRunMutationPending}
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
                            disabled={answerRunMutationPending}
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
                            disabled={answerRunMutationPending}
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
                            disabled={answerRunMutationPending}
                            onClick={() =>
                              void handleTransitionSeed(answerRun.answerRunId, 'USER_DIRECTIVE')
                            }
                          >
                            Propose Directive
                          </button>
                        ) : null}
                        {answerRunOutcomeUnknown &&
                        pendingAnswerRunCommand?.answerRunId === answerRun.answerRunId ? (
                          <button
                            type="button"
                            onClick={() => void handleResolveAnswerRunCommandOutcome()}
                          >
                            Check existing command outcome
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
