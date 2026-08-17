import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';

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
import {
  type AnswerCommandContext,
  useOptionalAnswerCommandContext,
} from '../commands/answer-command-context.js';
import { AnswerCommandSurface } from '../commands/answer-command-surface.js';
import { type AnswerCommandId } from '../commands/owner-command-registry.js';
import { ErrorState } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { useProductLocalization } from '../localization/product-localization.js';
import { useLeaveGuard } from '../session/leave-guard-context.js';
import {
  askConversationSourceContextQueryOptions,
  sourcesLibraryQueryOptions,
} from '../sources/sources-queries.js';
import { useOwnerCommandController } from '../section3/global-tools.js';
import { AskSupportControls, ConversationPane, GlobalComposer } from './ask-shell-presentation.js';

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

export type AskShellContextValue = {
  readonly shell: GlobalShellView;
  readonly workspace?: AskWorkspaceView;
  readonly activeConversationId?: string;
  readonly question: string;
  readonly mode?: AskMode;
  readonly sourceSelections: readonly AskSourceSelectionView[];
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
  readonly runOverrides: Readonly<Record<string, AskAnswerRunSnapshot>>;
  readonly runEvents: Readonly<Record<string, AskAnswerRunEventsView>>;
  readonly answerRunMutationPending: boolean;
  readonly answerRunOutcomeUnknown: boolean;
  readonly pendingAnswerRunCommand?: PendingAnswerRunCommand;
  readonly answerRunCommandNotice?: string;
  readonly exportedContent?: string;
  readonly error?: unknown;
  readonly sourceOptions: readonly SourceLibraryItem[];
  readonly sourceContextAvailable: boolean;
  readonly sourceContextPending: boolean;
  readonly sourceContextError: boolean;
  readonly sourceContextProjectMatches: boolean;
  readonly answerCommand: AnswerCommandId | null;
  readonly answerCommandContext?: AnswerCommandContext;
  readonly answerCommandInvoker: HTMLElement | null;
  readonly handleQuestionChange: (
    value: string,
    isComposing: boolean,
    invoker: HTMLElement | null,
  ) => void;
  readonly handleModeChange: (mode: AskMode) => void;
  readonly toggleSourceSelection: (source: SourceLibraryItem) => void;
  readonly handleSubmitQuestion: () => Promise<void>;
  readonly handleResolveOutcome: () => Promise<void>;
  readonly handleCancelAnswerRun: (answerRunId: string) => Promise<void>;
  readonly handleRetryAnswerRun: (
    answerRunId: string,
    mode: 'SAME_CONTEXT' | 'CURRENT_POLICY',
  ) => Promise<void>;
  readonly handleExportAnswerRun: (answerRunId: string) => Promise<void>;
  readonly handleTransitionSeed: (
    answerRunId: string,
    kind: 'INTAKE_DRAFT' | 'DRAFT_CHANGE_SET' | 'USER_DIRECTIVE',
  ) => Promise<void>;
  readonly handleResolveAnswerRunCommandOutcome: () => Promise<void>;
  readonly openAnswerActions: (context: AnswerCommandContext, invoker: HTMLElement) => void;
  readonly closeAnswerCommand: () => void;
};

const AskShellContext = createContext<AskShellContextValue | undefined>(undefined);

export const useAskShell = (): AskShellContextValue => {
  const context = useContext(AskShellContext);
  if (!context) throw new Error('useAskShell must be used within an AskShellProvider.');
  return context;
};

export const useOptionalAskShell = (): AskShellContextValue | undefined =>
  useContext(AskShellContext);

export const AskShellProvider = ({
  children,
  client,
  shell: shellProp,
}: {
  readonly children: ReactNode;
  readonly client?: AskWorkspaceClient;
  readonly shell?: GlobalShellView;
}) => {
  const outletContext = useOutletContext<{ readonly shell: GlobalShellView } | undefined>();
  const shell = shellProp ?? outletContext?.shell;
  if (!shell) throw new Error('Ask shell provider requires a Global Shell.');
  const { apiClient } = useAppRuntime();
  const { t } = useProductLocalization();
  const answerCommandBridge = useOptionalAnswerCommandContext();
  const registerAnswerCommandContext = answerCommandBridge?.register;
  const commandController = useOwnerCommandController();
  const location = useLocation();
  const routeConversationId = useMemo(() => {
    const match = location.pathname.match(/^\/ask\/conversations\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]!) : undefined;
  }, [location.pathname]);
  const ownedClient = useMemo(() => createAskWorkspaceClient(), []);
  const askClient = client ?? ownedClient;
  const { registerLeaveGuard } = useLeaveGuard();
  const [workspace, setWorkspace] = useState<AskWorkspaceView>();
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    routeConversationId,
  );
  const [question, setQuestion] = useState('');
  const questionRef = useRef(question);
  questionRef.current = question;
  const [answerCommand, setAnswerCommand] = useState<AnswerCommandId | null>(null);
  const [answerCommandContext, setAnswerCommandContext] = useState<AnswerCommandContext>();
  const [answerCommandInvoker, setAnswerCommandInvoker] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<AskMode | undefined>(undefined);
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

  useEffect(() => {
    if (routeConversationId !== undefined) {
      if (routeConversationId !== activeConversationId) {
        setActiveConversationId(routeConversationId);
      }
      return;
    }

    const isExactAskRoot = location.pathname === '/ask' || location.pathname === '/ask/';
    if (isExactAskRoot) {
      const hasUnsavedDraft = questionRef.current.trim().length > 0;
      const isUnsafePending =
        outcomeUnknown ||
        answerRunOutcomeUnknown ||
        pendingCommand !== undefined ||
        pendingAnswerRunCommand !== undefined;

      if (!hasUnsavedDraft && !isUnsafePending) {
        if (activeConversationId !== undefined) {
          setActiveConversationId(undefined);
        }
      }
    }
  }, [
    activeConversationId,
    answerRunOutcomeUnknown,
    location.pathname,
    outcomeUnknown,
    pendingAnswerRunCommand,
    pendingCommand,
    routeConversationId,
  ]);

  const askScopeKey = useMemo(() => {
    if (activeConversationId !== undefined) {
      return `conversation:${activeConversationId}`;
    }
    if (shell.activeProject?.id !== undefined) {
      return `project:${shell.activeProject.id}`;
    }
    return 'none';
  }, [activeConversationId, shell.activeProject?.id]);

  const previousAskScopeKeyRef = useRef<string | undefined>(undefined);

  const sourceLibrary = useQuery({
    ...sourcesLibraryQueryOptions(apiClient, shell, SOURCE_CONTEXT_QUERY),
    enabled:
      mode !== undefined &&
      mode !== 'CANONICAL_ONLY' &&
      workspace !== undefined &&
      activeConversationId === undefined &&
      shell.activeProject?.id === workspace.projectId,
  });

  const conversationSourceContext = useQuery({
    ...askConversationSourceContextQueryOptions(
      askClient,
      shell,
      workspace,
      activeConversationId,
      SOURCE_CONTEXT_QUERY,
    ),
    enabled:
      mode !== undefined &&
      mode !== 'CANONICAL_ONLY' &&
      workspace !== undefined &&
      activeConversationId !== undefined &&
      workspace.selectedConversation?.conversationId === activeConversationId,
  });

  const providerEligibility = useQuery<AskProviderEligibilityView>({
    queryKey: [
      'ask',
      'provider-eligibility',
      workspace?.projectId,
      activeConversationId,
      mode,
      sourceSelections,
    ],
    queryFn: () => {
      if (!mode) throw new Error('Cannot query provider eligibility without an authoritative mode');
      return askClient.getProviderEligibility({
        schemaVersion: '1.0.0',
        ...(activeConversationId ? { conversationId: activeConversationId } : {}),
        mode,
        sourceSelections: mode === 'CANONICAL_ONLY' ? [] : sourceSelections,
      });
    },
    enabled:
      workspace !== undefined &&
      mode !== undefined &&
      workspace.availableAskModes.includes(mode) &&
      (activeConversationId !== undefined
        ? workspace.selectedConversation?.conversationId === activeConversationId
        : shell.activeProject?.id === workspace.projectId),
  });

  const activeBranchLatestTurn = useMemo(() => {
    const selected = workspace?.selectedConversation;
    const branch = selected?.branches?.find(
      (candidate) => candidate.branchId === selected.activeBranchId,
    );
    return branch?.turns?.slice().sort((left, right) => right.ordinal - left.ordinal)[0];
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

  const openAnswerCommandForContext = useCallback(
    (context: AnswerCommandContext, commandId: AnswerCommandId, invoker: HTMLElement | null) => {
      setAnswerCommandContext(context);
      setAnswerCommandInvoker(invoker);
      setAnswerCommand(commandId);
    },
    [],
  );

  const openRegisteredAnswerCommand = useCallback(
    (commandId: AnswerCommandId, invoker: HTMLElement | null) => {
      const context = defaultAnswerContextRef.current;
      if (!context) return;
      openAnswerCommandForContext(context, commandId, invoker);
    },
    [openAnswerCommandForContext],
  );

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
    if (!contextExists(answerCommandContext)) {
      setAnswerCommand(null);
      setAnswerCommandContext(undefined);
      setAnswerCommandInvoker(null);
    }
  }, [answerCommandContext, workspace]);

  useEffect(() => {
    const controller = new AbortController();
    if (askScopeKey === 'none') {
      previousAskScopeKeyRef.current = 'none';
      setWorkspace(undefined);
      setMode(undefined);
      return;
    }

    const scopeChanged =
      previousAskScopeKeyRef.current !== undefined &&
      previousAskScopeKeyRef.current !== askScopeKey;
    const isConversationScope = activeConversationId !== undefined;
    const isAlreadyLoaded = isConversationScope
      ? workspace?.selectedConversation?.conversationId === activeConversationId
      : workspace !== undefined &&
        workspace.projectId === shell.activeProject?.id &&
        workspace.selectedConversation === undefined;

    if (scopeChanged || !isAlreadyLoaded) {
      previousAskScopeKeyRef.current = askScopeKey;
      setAnswerCommand(null);
      setAnswerCommandContext(undefined);
      setAnswerCommandInvoker(null);
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
        .getWorkspace(activeConversationId, { signal: controller.signal })
        .then((value) => {
          setWorkspace(value);
          setMode(value.defaultAskMode);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(reason);
          }
        });
    } else {
      previousAskScopeKeyRef.current = askScopeKey;
    }

    return () => controller.abort();
  }, [
    activeConversationId,
    askClient,
    askScopeKey,
    shell.activeProject?.id,
    workspace?.projectId,
    workspace?.selectedConversation?.conversationId,
  ]);

  useEffect(() => {
    if (!registerAnswerCommandContext || !defaultAnswerContext) return;
    return registerAnswerCommandContext({
      context: defaultAnswerContext,
      commandPending: pendingAnswerRunCommand !== undefined,
      openCommand: openRegisteredAnswerCommand,
      openCommandForContext: openAnswerCommandForContext,
    });
  }, [
    defaultAnswerContext,
    openAnswerCommandForContext,
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
    const timer = setTimeout(() => {
      const target = document.getElementById(validatedReturnTargetId);
      target?.scrollIntoView?.({ block: 'center' });
      target?.focus?.();
    }, 50);
    return () => clearTimeout(timer);
  }, [location.key, validatedReturnTargetId]);

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
            const refreshedWorkspace = await askClient.getWorkspace(activeConversationId, {
              signal: controller.signal,
            });
            if (
              cancelled ||
              refreshedWorkspace.projectId !== workspace?.projectId ||
              (activeConversationId !== undefined &&
                refreshedWorkspace.selectedConversation?.conversationId !== activeConversationId)
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
    activeConversationId,
  ]);

  const targetProjectId = activeConversationId ? workspace?.projectId : shell.activeProject?.id;
  const draftReady =
    targetProjectId !== undefined &&
    (workspace === undefined || workspace.projectId === targetProjectId);
  const conversation = workspace?.selectedConversation;
  const activeBranch = conversation?.branches.find(
    (branch) => branch.branchId === conversation.activeBranchId,
  );
  const followUpReady =
    !activeConversationId ||
    Boolean(conversation && activeBranch?.branchRevision && conversation.conversationRevision);
  const isWorkspaceAuthoritative =
    workspace !== undefined &&
    mode !== undefined &&
    workspace.availableAskModes.includes(mode) &&
    (activeConversationId !== undefined
      ? workspace.selectedConversation?.conversationId === activeConversationId
      : shell.activeProject?.id === workspace.projectId);
  const submissionAvailable =
    isWorkspaceAuthoritative &&
    workspace.capabilities.includes('SUBMIT_QUESTION') &&
    followUpReady &&
    providerEligibility.data?.eligible === true;
  const answerRunMutationPending = pendingAnswerRunCommand !== undefined;
  const sourceLibraryPage = sourceLibrary.data;
  const conversationSourceContextView = conversationSourceContext.data;
  const sourceContextProjectMatches = activeConversationId
    ? conversationSourceContextView?.resourceProjectId === workspace?.projectId
    : sourceLibraryPage?.projectId === (workspace?.projectId ?? shell.activeProject?.id);
  const sourceOptions = sourceContextProjectMatches
    ? (conversationSourceContextView?.items ?? sourceLibraryPage?.items ?? []).filter(
        (source) => source.projectId === (workspace?.projectId ?? shell.activeProject?.id),
      )
    : [];
  const sourceContextAvailable =
    activeConversationId !== undefined || shell.activeProject?.id === workspace?.projectId;
  const sourceContextPending = activeConversationId
    ? conversationSourceContext.isPending
    : sourceLibrary.isPending;
  const sourceContextError = activeConversationId
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
    setWorkspace(submission.workspace);
    const newConversationId = submission.answerRun.conversationId;
    previousAskScopeKeyRef.current = `conversation:${newConversationId}`;
    setMode((currentMode) => {
      if (currentMode && submission.workspace.availableAskModes.includes(currentMode)) {
        return currentMode;
      }
      return submission.workspace.defaultAskMode;
    });
    if (newConversationId !== activeConversationId) {
      setActiveConversationId(newConversationId);
      if (location.pathname.startsWith('/ask')) {
        navigate(`/ask/conversations/${encodeURIComponent(newConversationId)}`);
      }
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
      !mode ||
      !workspace ||
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
        activeConversationId && conversation && activeBranch?.branchRevision
          ? {
              conversationId: activeConversationId,
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

  const handleQuestionChange = (
    value: string,
    isComposing: boolean,
    invoker: HTMLElement | null,
  ) => {
    const trigger = value.match(/^\s*\/(.*)$/s);
    if (!isComposing && trigger) {
      setQuestion('');
      questionRef.current = '';
      commandController?.openCommandMode?.(trigger[1] ?? '', invoker);
      return;
    }
    setQuestion(value);
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

  const value: AskShellContextValue = {
    shell,
    workspace,
    activeConversationId,
    question,
    mode,
    sourceSelections,
    draftReady,
    outcomeUnknown,
    isSubmitting,
    submissionAvailable,
    sourceSelectionMissing,
    providerEligibility,
    submissionNotice,
    runOverrides,
    runEvents,
    answerRunMutationPending,
    answerRunOutcomeUnknown,
    pendingAnswerRunCommand,
    answerRunCommandNotice,
    exportedContent,
    error,
    sourceOptions,
    sourceContextAvailable,
    sourceContextPending,
    sourceContextError,
    sourceContextProjectMatches,
    answerCommand,
    answerCommandContext,
    answerCommandInvoker,
    handleQuestionChange,
    handleModeChange: (nextMode) => {
      setMode(nextMode);
      setSubmissionNotice(undefined);
    },
    toggleSourceSelection,
    handleSubmitQuestion,
    handleResolveOutcome,
    handleCancelAnswerRun,
    handleRetryAnswerRun,
    handleExportAnswerRun,
    handleTransitionSeed,
    handleResolveAnswerRunCommandOutcome,
    openAnswerActions: (context, invoker) =>
      commandController?.openCommandMode?.('answer', invoker, context),
    closeAnswerCommand: () => {
      setAnswerCommand(null);
      setAnswerCommandContext(undefined);
      setAnswerCommandInvoker(null);
    },
  };

  return <AskShellContext.Provider value={value}>{children}</AskShellContext.Provider>;
};

export const AskShellGlobalComposer = () => {
  const {
    workspace,
    question,
    mode,
    draftReady,
    outcomeUnknown,
    isSubmitting,
    submissionAvailable,
    sourceSelectionMissing,
    providerEligibility,
    submissionNotice,
    handleQuestionChange,
    handleModeChange,
    handleSubmitQuestion,
    handleResolveOutcome,
  } = useAskShell();
  const { t } = useProductLocalization();

  return (
    <GlobalComposer
      workspace={workspace}
      question={question}
      mode={mode}
      draftReady={draftReady}
      outcomeUnknown={outcomeUnknown}
      isSubmitting={isSubmitting}
      submissionAvailable={submissionAvailable}
      sourceSelectionMissing={sourceSelectionMissing}
      providerEligibility={providerEligibility}
      submissionNotice={submissionNotice}
      onQuestionChange={handleQuestionChange}
      onModeChange={handleModeChange}
      onSubmit={() => void handleSubmitQuestion()}
      onResolveOutcome={() => void handleResolveOutcome()}
      t={t}
    />
  );
};

export const AskShellConversationPane = () => {
  const {
    workspace,
    runOverrides,
    runEvents,
    answerRunMutationPending,
    answerRunOutcomeUnknown,
    pendingAnswerRunCommand,
    exportedContent,
    openAnswerActions,
    handleCancelAnswerRun,
    handleRetryAnswerRun,
    handleResolveAnswerRunCommandOutcome,
    answerRunCommandNotice,
    answerCommand,
    answerCommandContext,
    answerCommandInvoker,
    closeAnswerCommand,
    handleExportAnswerRun,
    handleTransitionSeed,
  } = useAskShell();
  const { t } = useProductLocalization();

  return (
    <>
      <ConversationPane
        workspace={workspace}
        runOverrides={runOverrides}
        runEvents={runEvents}
        pending={answerRunMutationPending}
        outcomeUnknown={answerRunOutcomeUnknown}
        pendingAnswerRunId={pendingAnswerRunCommand?.answerRunId}
        exportedContent={exportedContent}
        onAnswerActions={openAnswerActions}
        onCancel={(answerRunId) => void handleCancelAnswerRun(answerRunId)}
        onRetry={(answerRunId, retryMode) => void handleRetryAnswerRun(answerRunId, retryMode)}
        onResolveOutcome={() => void handleResolveAnswerRunCommandOutcome()}
        t={t}
      />
      {answerRunCommandNotice ? (
        <p className="ask-command-notice hfm-status-info" role="status">
          {answerRunCommandNotice}
        </p>
      ) : null}
      <AnswerCommandSurface
        open={answerCommand !== null}
        commandId={answerCommand}
        context={answerCommandContext}
        pending={answerRunMutationPending}
        invoker={answerCommandInvoker}
        onClose={closeAnswerCommand}
        onExport={handleExportAnswerRun}
        onRetry={handleRetryAnswerRun}
        onPropose={handleTransitionSeed}
      />
    </>
  );
};

export const AskCenterWorkspace = () => {
  const {
    shell,
    workspace,
    activeConversationId,
    error,
    mode,
    sourceContextAvailable,
    sourceContextPending,
    sourceContextError,
    sourceContextProjectMatches,
    sourceOptions,
    sourceSelections,
    draftReady,
    outcomeUnknown,
    toggleSourceSelection,
  } = useAskShell();
  const { t } = useProductLocalization();

  if (!shell.activeProject && !activeConversationId) {
    return <p>{t('ask.create_or_select_project')}</p>;
  }
  if (error) return <ErrorState error={error} onRetry={() => window.location.reload()} />;
  if (!workspace) return <LoadingState message={t('ask.loading_workspace')} />;

  const hasVisibleSupportControls = Boolean(mode && mode !== 'CANONICAL_ONLY');
  const showEmptyLanding = !activeConversationId && !hasVisibleSupportControls;

  return (
    <section className="route-page hfm-route-page ask-workspace">
      <p className="eyebrow">{t('ask.eyebrow')}</p>
      <h1 tabIndex={-1}>{t('ask.title')}</h1>
      {showEmptyLanding ? (
        <p className="ask-empty-landing-hint">{t('ask.empty_landing_hint')}</p>
      ) : null}
      <AskSupportControls
        mode={mode}
        sourceContextAvailable={sourceContextAvailable}
        sourceContextPending={sourceContextPending}
        sourceContextError={sourceContextError}
        sourceContextProjectMatches={sourceContextProjectMatches}
        sourceOptions={sourceOptions}
        sourceSelections={sourceSelections}
        draftReady={draftReady}
        outcomeUnknown={outcomeUnknown}
        onToggleSource={toggleSourceSelection}
        t={t}
      />
    </section>
  );
};

export const AskWorkspace = (props: {
  readonly client?: AskWorkspaceClient;
  readonly shell?: GlobalShellView;
}) => {
  const existingShell = useOptionalAskShell();
  if (existingShell) {
    return <AskCenterWorkspace />;
  }
  return (
    <AskShellProvider client={props.client} shell={props.shell}>
      <AskCenterWorkspace />
      <AskShellConversationPane />
      <AskShellGlobalComposer />
    </AskShellProvider>
  );
};
