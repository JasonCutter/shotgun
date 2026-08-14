import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { projectAdminQueryKey } from '../app/query-keys.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import {
  type AnswerCommandContext,
  useOptionalAnswerCommandContext,
} from '../commands/answer-command-context.js';
import { AnswerCommandSurface } from '../commands/answer-command-surface.js';
import { AICommandSurface } from '../commands/ai-command-surface.js';
import { PrivacyCommandSurface } from '../commands/privacy-command-surface.js';
import { PreferencesCommandSurface } from '../commands/preferences-command-surface.js';
import { ProjectCommandSurface } from '../commands/project-command-surface.js';
import { TechnicalCommandSurface } from '../commands/technical-command-surface.js';
import {
  createOwnerCommandRegistry,
  type AnswerCommandId,
  type AICommandId,
  type OwnerCommandDefinition,
  type PreferenceCommandId,
  type PrivacyCommandId,
  type ProjectCommandId,
} from '../commands/owner-command-registry.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { TechnicalDetails } from '../components/technical-details.js';
import { useOptionalTechnicalInspection } from '../components/technical-inspection-context.js';
import { hfmOwnerLabel, useProductLocalization } from '../localization/product-localization.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import { useConnectivityState } from '../shell/use-connectivity-state.js';
import {
  askConversationSourceContextQueryOptions,
  sourcesLibraryQueryOptions,
} from '../sources/sources-queries.js';
import { GlobalSearchDialog } from '../section3/global-search-dialog.js';

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

type SourceLibraryItem = SourceLibraryPageView['items'][number];

type PendingAskCommand = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

type PendingAnswerRunCommand = {
  readonly answerRunId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly operation: 'CANCEL' | 'RETRY' | 'EXPORT' | 'TRANSITION_SEED';
  readonly retryMode?: 'SAME_CONTEXT' | 'CURRENT_POLICY';
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
  const connectivity = useConnectivityState();
  const technicalInspection = useOptionalTechnicalInspection();
  const { t } = useProductLocalization();
  const answerCommandBridge = useOptionalAnswerCommandContext();
  const registerAnswerCommandContext = answerCommandBridge?.register;
  const technicalBlocks = technicalInspection?.blocks ?? [];
  const location = useLocation();
  const ownedClient = useMemo(() => createAskWorkspaceClient(), []);
  const askClient = client ?? ownedClient;
  const { registerLeaveGuard } = useLeaveGuard();
  const [workspace, setWorkspace] = useState<AskWorkspaceView>();
  const [question, setQuestion] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteInvoker, setCommandPaletteInvoker] = useState<HTMLElement | null>(null);
  const [commandPaletteResetSignal, setCommandPaletteResetSignal] = useState(0);
  const [paletteAnswerContext, setPaletteAnswerContext] = useState<AnswerCommandContext>();
  const [answerCommand, setAnswerCommand] = useState<AnswerCommandId | null>(null);
  const [answerCommandContext, setAnswerCommandContext] = useState<AnswerCommandContext>();
  const [answerCommandInvoker, setAnswerCommandInvoker] = useState<HTMLElement | null>(null);
  const [projectCommand, setProjectCommand] = useState<ProjectCommandId | null>(null);
  const [projectCommandInvoker, setProjectCommandInvoker] = useState<HTMLElement | null>(null);
  const [preferenceCommand, setPreferenceCommand] = useState<PreferenceCommandId | null>(null);
  const [preferenceCommandInvoker, setPreferenceCommandInvoker] = useState<HTMLElement | null>(
    null,
  );
  const [aiCommand, setAICommand] = useState<AICommandId | null>(null);
  const [aiCommandInvoker, setAICommandInvoker] = useState<HTMLElement | null>(null);
  const [privacyCommand, setPrivacyCommand] = useState<PrivacyCommandId | null>(null);
  const [privacyCommandInvoker, setPrivacyCommandInvoker] = useState<HTMLElement | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [technicalInvoker, setTechnicalInvoker] = useState<HTMLElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInvoker, setSearchInvoker] = useState<HTMLElement | null>(null);
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
  const projectsQuery = useQuery({
    queryKey: projectAdminQueryKey(shell.principalId),
    queryFn: () => apiClient.getProjects(),
  });

  const activeBranchLatestTurn = useMemo(() => {
    const selected = workspace?.selectedConversation;
    const branch = selected?.branches.find(
      (candidate) => candidate.branchId === selected.activeBranchId,
    );
    return branch?.turns.slice().sort((left, right) => right.ordinal - left.ordinal)[0];
  }, [workspace?.selectedConversation]);
  const latestAnswerRun = activeBranchLatestTurn
    ? (runOverrides[activeBranchLatestTurn.answerRun.answerRunId] ??
      activeBranchLatestTurn.answerRun)
    : undefined;
  const defaultAnswerContext = useMemo<AnswerCommandContext | undefined>(() => {
    const selected = workspace?.selectedConversation;
    if (!workspace || !selected || !activeBranchLatestTurn || !latestAnswerRun) return undefined;
    return {
      projectId: workspace.projectId,
      conversationId: selected.conversationId,
      branchId: selected.activeBranchId,
      turnId: activeBranchLatestTurn.turnId,
      answerRunId: latestAnswerRun.answerRunId,
      answerRevision: latestAnswerRun.answerRevision,
      state: latestAnswerRun.state,
      capabilities: latestAnswerRun.capabilities,
    };
  }, [activeBranchLatestTurn, latestAnswerRun, workspace]);
  const defaultAnswerContextRef = useRef(defaultAnswerContext);
  defaultAnswerContextRef.current = defaultAnswerContext;
  const activeAnswerProjectId = workspace?.projectId;
  const activeAnswerConversationId = workspace?.selectedConversation?.conversationId;
  const activeAnswerBranchId = workspace?.selectedConversation?.activeBranchId;
  const previousActiveAnswerScope = useRef({
    projectId: activeAnswerProjectId,
    conversationId: activeAnswerConversationId,
    branchId: activeAnswerBranchId,
  });
  const openRegisteredAnswerCommand = useCallback(
    (commandId: AnswerCommandId, invoker: HTMLElement | null) => {
      const context = defaultAnswerContextRef.current;
      if (!context) return;
      setAnswerCommandContext(context);
      setAnswerCommandInvoker(invoker);
      setAnswerCommand(commandId);
    },
    [],
  );

  const commandRegistry = useMemo(
    () =>
      createOwnerCommandRegistry({
        shell,
        isOffline: connectivity.isOffline,
        includeProjectSwitch: false,
        includeSearch: true,
        hasTechnicalInspection: technicalBlocks.length > 0,
        answerContext: paletteAnswerContext ?? defaultAnswerContext,
        answerCommandPending: pendingAnswerRunCommand !== undefined,
        projects: projectsQuery.data,
      }),
    [
      connectivity.isOffline,
      defaultAnswerContext,
      paletteAnswerContext,
      pendingAnswerRunCommand,
      projectsQuery.data,
      shell,
      technicalBlocks.length,
    ],
  );

  const questionRef = useRef(question);
  questionRef.current = question;

  useEffect(() => {
    const previous = previousActiveAnswerScope.current;
    const hadPreviousScope =
      previous.projectId !== undefined &&
      previous.conversationId !== undefined &&
      previous.branchId !== undefined;
    if (
      hadPreviousScope &&
      (previous.projectId !== activeAnswerProjectId ||
        previous.conversationId !== activeAnswerConversationId ||
        previous.branchId !== activeAnswerBranchId)
    ) {
      setPaletteAnswerContext(undefined);
      setAnswerCommand(null);
      setAnswerCommandContext(undefined);
      setAnswerCommandInvoker(null);
    }
    previousActiveAnswerScope.current = {
      projectId: activeAnswerProjectId,
      conversationId: activeAnswerConversationId,
      branchId: activeAnswerBranchId,
    };
  }, [activeAnswerBranchId, activeAnswerConversationId, activeAnswerProjectId]);

  useEffect(() => {
    const contextExists = (context: AnswerCommandContext | undefined) =>
      !context ||
      (workspace?.projectId === context.projectId &&
        workspace.selectedConversation?.conversationId === context.conversationId &&
        workspace.selectedConversation.branches.some(
          (branch) =>
            branch.branchId === context.branchId &&
            branch.turns.some(
              (turn) =>
                turn.turnId === context.turnId &&
                turn.answerRun.answerRunId === context.answerRunId &&
                turn.answerRun.answerRevision === context.answerRevision,
            ),
        ));
    if (!contextExists(paletteAnswerContext)) setPaletteAnswerContext(undefined);
    if (!contextExists(answerCommandContext)) {
      setAnswerCommand(null);
      setAnswerCommandContext(undefined);
      setAnswerCommandInvoker(null);
    }
  }, [answerCommandContext, paletteAnswerContext, workspace]);

  useEffect(() => {
    const controller = new AbortController();
    setWorkspace(undefined);
    setQuestion('');
    setCommandPaletteOpen(false);
    setCommandPaletteInvoker(null);
    setPaletteAnswerContext(undefined);
    setAnswerCommand(null);
    setAnswerCommandContext(undefined);
    setAnswerCommandInvoker(null);
    setProjectCommand(null);
    setProjectCommandInvoker(null);
    setTechnicalOpen(false);
    setTechnicalInvoker(null);
    setSearchOpen(false);
    setSearchInvoker(null);
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

  useEffect(() => {
    if (!registerAnswerCommandContext || !defaultAnswerContext) return;
    return registerAnswerCommandContext({
      context: defaultAnswerContext,
      commandPending: pendingAnswerRunCommand !== undefined,
      openCommand: openRegisteredAnswerCommand,
    });
  }, [
    defaultAnswerContext,
    openRegisteredAnswerCommand,
    pendingAnswerRunCommand,
    registerAnswerCommandContext,
  ]);

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
    return <p>{t('ask.create_or_select_project')}</p>;
  }
  if (error) return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  if (!workspace) return <LoadingState message={t('ask.loading_workspace')} />;

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
            message: outcome.failureMessage ?? t('ask.submission_rejected'),
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
    setSubmissionNotice(t('ask.submission_outcome_unknown'));
  };

  const handleResolveOutcome = async () => {
    if (!pendingCommand || isSubmitting) return;
    setIsSubmitting(true);
    setSubmissionNotice(t('ask.checking_submission_outcome'));
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

  const handleAskCommand = (command: OwnerCommandDefinition) => {
    if (command.action.kind === 'OPEN_COMMANDS') {
      setQuestion('');
      questionRef.current = '';
      setCommandPaletteResetSignal((current) => current + 1);
      setCommandPaletteOpen(true);
      return;
    }
    if (command.action.kind === 'OPEN_PROJECT_FLOW') {
      setProjectCommandInvoker(commandPaletteInvoker);
      setProjectCommand(command.action.commandId);
      setCommandPaletteOpen(false);
      setQuestion('');
      questionRef.current = '';
      return;
    }
    if (command.action.kind === 'OPEN_PREFERENCE_FLOW') {
      setPreferenceCommandInvoker(commandPaletteInvoker);
      setPreferenceCommand(command.action.commandId);
      setCommandPaletteOpen(false);
      setQuestion('');
      questionRef.current = '';
      return;
    }
    if (command.action.kind === 'OPEN_AI_FLOW') {
      setAICommandInvoker(commandPaletteInvoker);
      setAICommand(command.action.commandId);
      setCommandPaletteOpen(false);
      setQuestion('');
      questionRef.current = '';
      return;
    }
    if (command.action.kind === 'OPEN_PRIVACY_FLOW') {
      setPrivacyCommandInvoker(commandPaletteInvoker);
      setPrivacyCommand(command.action.commandId);
      setCommandPaletteOpen(false);
      setQuestion('');
      questionRef.current = '';
      return;
    }
    if (command.action.kind === 'OPEN_TECHNICAL_FLOW') {
      setTechnicalInvoker(commandPaletteInvoker);
      setTechnicalOpen(true);
      setCommandPaletteOpen(false);
      setQuestion('');
      questionRef.current = '';
      return;
    }
    if (command.action.kind === 'OPEN_ANSWER_FLOW') {
      const context = paletteAnswerContext ?? defaultAnswerContext;
      if (!context) return;
      setAnswerCommandContext(context);
      setAnswerCommandInvoker(commandPaletteInvoker);
      setAnswerCommand(command.action.commandId);
      setCommandPaletteOpen(false);
      setPaletteAnswerContext(undefined);
      setQuestion('');
      questionRef.current = '';
      return;
    }
    setCommandPaletteOpen(false);
    setQuestion('');
    questionRef.current = '';
    if (command.action.kind === 'NAVIGATE') {
      navigate(command.action.targetRoute.href);
      return;
    }
    if (command.action.kind === 'NAVIGATE_PATH') {
      navigate(command.action.href);
      return;
    }
    if (command.action.kind === 'OPEN_SEARCH') {
      setSearchInvoker(commandPaletteInvoker);
      setSearchOpen(true);
    }
  };

  const handleQuestionChange = (value: string) => {
    setQuestion(value);
    const trigger = value.match(/^\s*\/(.*)$/s);
    if (trigger) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPaletteAnswerContext(undefined);
      setCommandPaletteInvoker(active);
      setCommandPaletteOpen(true);
    } else if (commandPaletteOpen) {
      setCommandPaletteOpen(false);
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
    details: Pick<PendingAnswerRunCommand, 'retryMode' | 'transitionKind'> = {},
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
      setAnswerRunCommandNotice(t('ask.answer_result_unknown'));
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
      setAnswerRunCommandNotice(t('ask.answer_result_still_unknown'));
      return;
    }

    if (outcome.outcomeState === 'REJECTED') {
      setPendingAnswerRunCommand(undefined);
      setAnswerRunOutcomeUnknown(false);
      setAnswerRunCommandNotice(outcome.rejection?.message ?? t('ask.request_rejected'));
      return;
    }
    if (outcome.outcomeState !== 'COMPLETED') {
      setAnswerRunOutcomeUnknown(true);
      setAnswerRunCommandNotice(t('ask.request_pending'));
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
      setAnswerRunCommandNotice(t('ask.result_unavailable'));
      return;
    }

    setPendingAnswerRunCommand(undefined);
    setAnswerRunOutcomeUnknown(false);
    setAnswerRunCommandNotice(t('ask.answer_request_recovered'));
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
      setAnswerRunCommandNotice(t('ask.answer_cancel_requested'));
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
      setAnswerRunCommandNotice(t('ask.answer_retry_accepted'));
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
      setAnswerRunCommandNotice(t('ask.answer_export_completed'));
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
      setAnswerRunCommandNotice(t('ask.transition_proposed'));
    } catch {
      await resolveAnswerRunCommandOutcome(pending);
    }
  };

  return (
    <section className="route-page ask-workspace">
      <p className="eyebrow">{t('ask.eyebrow')}</p>
      <h1 tabIndex={-1}>{t('ask.title')}</h1>

      <section className="action-card" aria-labelledby="ask-draft-heading">
        <h2 id="ask-draft-heading">{t('ask.question_draft')}</h2>
        <p>{t('ask.draft_help')}</p>
        <form
          className="ask-question-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmitQuestion();
          }}
        >
          <label htmlFor="ask-mode">{t('ask.mode')}</label>
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
                {hfmOwnerLabel(t, 'askMode', availableMode)}
              </option>
            ))}
          </select>

          {mode !== 'CANONICAL_ONLY' ? (
            <>
              <span className="ask-form-label" id="ask-source-context-label">
                {t('ask.source_context')}
              </span>
              <fieldset className="ask-source-context" aria-labelledby="ask-source-context-label">
                <legend className="visually-hidden">{t('ask.source_context')}</legend>
                {!sourceContextAvailable ? (
                  <p role="status">{t('ask.source_selection_unavailable')}</p>
                ) : sourceContextPending ? (
                  <p role="status">{t('ask.loading_sources')}</p>
                ) : sourceContextError ? (
                  <p role="alert">{t('ask.sources_load_failed')}</p>
                ) : !sourceContextProjectMatches ? (
                  <p role="alert">{t('ask.source_project_mismatch')}</p>
                ) : sourceOptions.length === 0 ? (
                  <p role="status">{t('ask.no_sources')}</p>
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
                                  ? t('ask.pinned_version')
                                  : `${t('ask.version')} ${source.versionCount}`}
                              </span>
                              <span>
                                {hfmOwnerLabel(t, 'sourceAskUsage', source.askUsageState)}
                              </span>
                              <TechnicalDetails
                                items={[
                                  { label: t('ask.source_id'), value: source.sourceId },
                                  {
                                    label: t('ask.source_version_id'),
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

          <label htmlFor="ask-question">{t('ask.question')}</label>
          <textarea
            id="ask-question"
            value={question}
            maxLength={10_000}
            disabled={!draftReady || outcomeUnknown}
            onChange={(event) => handleQuestionChange(event.target.value)}
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
              {isSubmitting ? t('ask.submitting') : t('ask.submit')}
            </button>
            {outcomeUnknown && pendingCommand ? (
              <button type="button" disabled={isSubmitting} onClick={handleResolveOutcome}>
                {t('ask.check_submission_outcome')}
              </button>
            ) : null}
          </div>
          {sourceSelectionMissing ? (
            <p className="ask-form-status" role="status">
              {t('ask.source_selection_required')}
            </p>
          ) : null}
          {providerEligibility.data && !providerEligibility.data.eligible ? (
            <div className="ask-form-status" role="status">
              <strong>{t('ask.action_required')}</strong> {providerEligibility.data.message}
              {providerEligibility.data.requiredAction === 'REVIEW_PROJECT_PRIVACY_SETTINGS' ? (
                <p>
                  <button
                    type="button"
                    onClick={(event) => {
                      setPrivacyCommandInvoker(event.currentTarget);
                      setPrivacyCommand('privacy.review');
                    }}
                  >
                    {t('ask.review_privacy')}
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}
          {providerEligibility.isError ? (
            <p className="ask-form-status" role="status">
              {t('ask.provider_eligibility_unavailable')}
            </p>
          ) : null}
          {submissionNotice ? (
            <p className="ask-form-status" role="status">
              {submissionNotice}
            </p>
          ) : null}
          {!submissionAvailable && providerEligibility.data?.eligible !== false ? (
            <p className="ask-form-status" role="status">
              {t('ask.submission_unavailable')}
            </p>
          ) : null}
        </form>
      </section>

      <GlobalSearchDialog
        shell={shell}
        open={searchOpen}
        invoker={searchInvoker}
        onClose={() => setSearchOpen(false)}
      />
      <OwnerCommandPalette
        open={commandPaletteOpen}
        commands={commandRegistry}
        initialQuery={paletteAnswerContext ? 'answer' : question.replace(/^\s*\//, '')}
        resetQuerySignal={commandPaletteResetSignal}
        invoker={commandPaletteInvoker}
        onClose={() => {
          setCommandPaletteOpen(false);
          setPaletteAnswerContext(undefined);
        }}
        onSelect={handleAskCommand}
      />
      <AnswerCommandSurface
        open={answerCommand !== null}
        commandId={answerCommand}
        context={answerCommandContext}
        pending={answerRunMutationPending}
        invoker={answerCommandInvoker}
        onClose={() => {
          setAnswerCommand(null);
          setAnswerCommandContext(undefined);
          setAnswerCommandInvoker(null);
        }}
        onExport={handleExportAnswerRun}
        onRetry={handleRetryAnswerRun}
        onPropose={handleTransitionSeed}
      />
      <ProjectCommandSurface
        open={projectCommand !== null}
        commandId={projectCommand}
        shell={shell}
        invoker={projectCommandInvoker}
        onClose={() => setProjectCommand(null)}
      />
      <PreferencesCommandSurface
        open={preferenceCommand !== null}
        commandId={preferenceCommand}
        shell={shell}
        invoker={preferenceCommandInvoker}
        onClose={() => setPreferenceCommand(null)}
      />
      <AICommandSurface
        open={aiCommand !== null}
        commandId={aiCommand}
        shell={shell}
        invoker={aiCommandInvoker}
        onClose={() => setAICommand(null)}
      />
      <PrivacyCommandSurface
        open={privacyCommand !== null}
        commandId={privacyCommand}
        shell={shell}
        invoker={privacyCommandInvoker}
        onClose={() => setPrivacyCommand(null)}
      />
      <TechnicalCommandSurface
        open={technicalOpen}
        blocks={technicalBlocks}
        invoker={technicalInvoker}
        onClose={() => setTechnicalOpen(false)}
      />

      {answerRunCommandNotice ? <p role="status">{answerRunCommandNotice}</p> : null}

      <section className="action-card" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading">{t('ask.conversations')}</h2>
        {workspace.conversations.length === 0 ? <p>{t('ask.no_conversations')}</p> : null}
        {workspace.conversations.length > 0 ? (
          <ul className="ask-conversation-list" aria-label={t('ask.conversation_list')}>
            {workspace.conversations.map((item) => {
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
                  {item.latestRunState === 'SUCCEEDED' ? null : (
                    <> · {hfmOwnerLabel(t, 'answerRun', item.latestRunState)}</>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {conversation ? (
          <section
            aria-label={t('ask.selected_conversation')}
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
                  const turnAnswerContext: AnswerCommandContext = {
                    projectId: workspace.projectId,
                    conversationId: conversation.conversationId,
                    branchId: branch.branchId,
                    turnId: turn.turnId,
                    answerRunId: answerRun.answerRunId,
                    answerRevision: answerRun.answerRevision,
                    state: answerRun.state,
                    capabilities: answerRun.capabilities,
                  };
                  const hasAnswerCommands = answerRun.capabilities.some((capability) =>
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
                    <li key={turn.turnId} id={`turn-${turn.turnId}`} tabIndex={-1}>
                      <p>
                        <strong>{t('ask.question')}:</strong> {turn.userMessage}
                      </p>
                      {latestPartial || answerRun.statements.length > 0 ? (
                        <h4>{t('ask.answer')}</h4>
                      ) : null}
                      {latestPartial ? (
                        <p aria-live="polite">
                          {t('ask.partial_answer')}: {latestPartial}
                        </p>
                      ) : null}
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
                                  {t('ask.open_evidence')}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                      {answerRun.state === 'SUCCEEDED' ? null : (
                        <p>
                          {t('ask.answer_status')}:{' '}
                          <strong>{hfmOwnerLabel(t, 'answerRun', answerRun.state)}</strong>
                        </p>
                      )}
                      {answerRun.failure ? <p role="alert">{answerRun.failure.message}</p> : null}
                      {answerRun.failure ? (
                        <TechnicalDetails
                          items={[{ label: t('ask.failure_code'), value: answerRun.failure.code }]}
                        />
                      ) : null}
                      {answerRun.capabilities.includes('CANCEL') ||
                      (answerRun.state === 'FAILED' &&
                        (answerRun.capabilities.includes('RETRY_SAME_CONTEXT') ||
                          answerRun.capabilities.includes('RETRY_CURRENT_POLICY'))) ||
                      hasAnswerCommands ||
                      (answerRunOutcomeUnknown &&
                        pendingAnswerRunCommand?.answerRunId === answerRun.answerRunId) ? (
                        <div className="answer-action-row">
                          {answerRun.capabilities.includes('CANCEL') ? (
                            <button
                              type="button"
                              disabled={answerRunMutationPending}
                              onClick={() => void handleCancelAnswerRun(answerRun.answerRunId)}
                            >
                              {t('ask.cancel_answer')}
                            </button>
                          ) : null}
                          {answerRun.state === 'FAILED' &&
                          answerRun.capabilities.includes('RETRY_SAME_CONTEXT') ? (
                            <button
                              type="button"
                              disabled={answerRunMutationPending}
                              onClick={() =>
                                void handleRetryAnswerRun(answerRun.answerRunId, 'SAME_CONTEXT')
                              }
                            >
                              {t('answer.retry_same')}
                            </button>
                          ) : null}
                          {answerRun.state === 'FAILED' &&
                          answerRun.capabilities.includes('RETRY_CURRENT_POLICY') ? (
                            <button
                              type="button"
                              disabled={answerRunMutationPending}
                              onClick={() =>
                                void handleRetryAnswerRun(answerRun.answerRunId, 'CURRENT_POLICY')
                              }
                            >
                              {t('answer.retry_policy')}
                            </button>
                          ) : null}
                          {hasAnswerCommands ? (
                            <button
                              type="button"
                              disabled={answerRunMutationPending}
                              aria-label={t('ask.answer_actions')}
                              onClick={(event) => {
                                setPaletteAnswerContext(turnAnswerContext);
                                setCommandPaletteInvoker(event.currentTarget);
                                setCommandPaletteResetSignal((current) => current + 1);
                                setCommandPaletteOpen(true);
                              }}
                            >
                              {t('ask.answer_actions')}
                            </button>
                          ) : null}
                          {answerRunOutcomeUnknown &&
                          pendingAnswerRunCommand?.answerRunId === answerRun.answerRunId ? (
                            <button
                              type="button"
                              onClick={() => void handleResolveAnswerRunCommandOutcome()}
                            >
                              {t('common.check_result')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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
          <h2 id="ask-export-heading">{t('ask.answer_export')}</h2>
          <pre>{exportedContent}</pre>
        </section>
      ) : null}
    </section>
  );
};
