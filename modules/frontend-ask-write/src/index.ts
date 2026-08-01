import { randomUUID } from 'node:crypto';

import {
  ASK_SCHEMA_VERSION,
  FrontendContractError,
  ShotgunError,
  computeSubmitAskQuestionDigest,
  type AcceptedPolicyContext,
  type AnyFrontendCommandOutcomeView,
  type AnyFrontendCommandRequest,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskConversationView,
  type AskQuestionSubmissionOutcomeView,
  type AskQuestionSubmissionView,
  type AskSourceSelectionView,
  type AskWorkspaceView,
  type ErrorCode,
  type ProducedResourceRef,
  type SubmitAskQuestionRequest,
  type TypedPrecondition,
} from '../../../packages/contracts/src/index.js';

export const ASK_RESOURCE_KIND = {
  conversation: 'ASK_CONVERSATION',
  branch: 'ASK_BRANCH',
  turn: 'ASK_TURN',
  answerRun: 'ASK_ANSWER_RUN',
} as const;

export type AskAuthorizedProjectSummary = {
  readonly id: string;
  readonly label: string;
  readonly isOwner: boolean;
  readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
};

export type AskReadScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProject: AskAuthorizedProjectSummary | null;
  readonly accessibleProjects: readonly AskAuthorizedProjectSummary[];
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type AskWorkspaceQueryPort = {
  getWorkspace(
    input: AskReadScope & { readonly conversationId?: string },
  ): Promise<AskWorkspaceView>;
  getConversation(
    input: AskReadScope & { readonly conversationId: string },
  ): Promise<AskConversationView>;
  getBranch(
    input: AskReadScope & { readonly conversationId: string; readonly branchId: string },
  ): Promise<AskBranchView>;
  getAnswerRun(
    input: AskReadScope & { readonly answerRunId: string },
  ): Promise<AskAnswerRunSnapshot>;
};

export type AskFrontendCommandGatewayPort = {
  accept(input: {
    readonly commandId: string;
    readonly commandRevision: string;
    readonly principalId: string;
    readonly request: AnyFrontendCommandRequest;
    readonly commandSemanticDigest: string;
    readonly acceptedPolicyContext: AcceptedPolicyContext;
    readonly correlationId: string;
    readonly traceId: string;
    readonly receivedAt: string;
    readonly acceptedAt: string;
  }): Promise<{
    readonly outcome: AnyFrontendCommandOutcomeView;
    readonly replayed: boolean;
  }>;
  lockAcceptedForExecution(
    transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView>;
  completeInTransaction(
    transaction: unknown,
    input: {
      readonly commandId: string;
      readonly producedResources: readonly ProducedResourceRef[];
      readonly completedAt: string;
    },
  ): Promise<AnyFrontendCommandOutcomeView>;
  reject(input: {
    readonly commandId: string;
    readonly code: ErrorCode;
    readonly message: string;
    readonly correlationId?: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  findByClientRequestId(
    principalId: string,
    clientRequestId: string,
  ): Promise<AnyFrontendCommandOutcomeView | null>;
};

export type AskCommittedQuestion = {
  readonly projectId: string;
  readonly conversationId: string;
  readonly branchId: string;
  readonly turnId: string;
  readonly answerRunId: string;
  readonly conversationRevision: string;
  readonly branchRevision: string;
  readonly turnRevision: string;
  readonly answerRevision: string;
};

export type PersistAskQuestionInput = {
  readonly commandId: string;
  readonly projectId: string;
  readonly question: string;
  readonly mode: NonNullable<SubmitAskQuestionRequest['mode']>;
  readonly sourceSelections: readonly AskSourceSelectionView[];
  readonly conversationId: string;
  readonly branchId: string;
  readonly expectedConversationRevision?: string;
  readonly expectedBranchRevision?: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly executionEnabled?: boolean;
  readonly createdAt: string;
  readonly generated: {
    readonly conversationId: string;
    readonly branchId: string;
    readonly turnId: string;
    readonly answerRunId: string;
    readonly conversationRevision: string;
    readonly branchRevision: string;
    readonly turnRevision: string;
    readonly answerRevision: string;
  };
};

export type AskConversationRepositoryPort = {
  transaction<T>(action: (transaction: unknown) => Promise<T>): Promise<T>;
  persistQuestion(
    transaction: unknown,
    input: PersistAskQuestionInput,
  ): Promise<AskCommittedQuestion>;
};

export type AskQuestionExecutionTrigger = {
  enqueue(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly answerRunId: string;
    readonly accessRevision: string;
    readonly policyContextRevision: string;
    readonly sensitivityClearance: AskAuthorizedProjectSummary['sensitivityClearance'];
  }): Promise<void>;
};

export type AskSourceSelectionValidatorPort = {
  validate(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly sensitivityClearance: AskAuthorizedProjectSummary['sensitivityClearance'];
    readonly mode: NonNullable<SubmitAskQuestionRequest['mode']>;
    readonly policyContextRevision: string;
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<void>;
};

export class EmptyOnlyAskSourceSelectionValidator implements AskSourceSelectionValidatorPort {
  async validate(input: {
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<void> {
    if (input.sourceSelections.length > 0) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Source selections require an authoritative Source validator.',
        module: 'frontend-ask-write',
        operation: 'validate-source-selections',
      });
    }
  }
}

const generatedIdentity = (prefix: string): string => `${prefix}-${randomUUID()}`;

const generatedRevision = (kind: string): string => `${kind}-rev-${randomUUID()}`;

const findProducedResource = (
  outcome: AnyFrontendCommandOutcomeView,
  resourceKind: string,
): { readonly resourceId: string; readonly resourceRevision?: string } | undefined =>
  outcome.producedResources.find((resource) => resource.resourceKind === resourceKind);

const targetProjectIdFromOutcome = (outcome: AnyFrontendCommandOutcomeView): string => {
  const context = outcome.acceptedProjectContext;
  if ('targetProjectId' in context && typeof context.targetProjectId === 'string') {
    return context.targetProjectId;
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'The Ask command outcome is missing its target Project binding.',
    module: 'frontend-ask-write',
    operation: 'resolve-question-outcome',
  });
};

export class AskCommandCoordinator {
  constructor(
    private readonly commandGateway: AskFrontendCommandGatewayPort,
    private readonly repository: AskConversationRepositoryPort,
    private readonly askWorkspace: AskWorkspaceQueryPort,
    private readonly sourceValidator: AskSourceSelectionValidatorPort = new EmptyOnlyAskSourceSelectionValidator(),
    private readonly answerExecution?: AskQuestionExecutionTrigger,
  ) {}

  async submitQuestion(
    input: AskReadScope & { readonly request: SubmitAskQuestionRequest },
  ): Promise<AskQuestionSubmissionView> {
    const request = input.request;
    const mode = request.mode ?? 'CANONICAL_ONLY';
    const authority = await this.resolveAuthority(input);
    const now = new Date().toISOString();
    const semanticDigest = computeSubmitAskQuestionDigest(request);
    const preconditions = this.buildPreconditions(request);
    const commandId = generatedIdentity('cmd');
    const commandRequest: AnyFrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: 'SUBMIT_QUESTION',
      commandSchemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      projectContext: {
        activeProjectId: input.activeProject?.id ?? authority.targetProjectId,
        targetProjectId: authority.targetProjectId,
        ...(request.conversationId ? { resourceProjectId: authority.targetProjectId } : {}),
        observedProjectAccessRevision: input.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: input.policyContextRevision,
      },
      preconditions,
      clientIssuedAt: now,
      payload: request,
    };

    let accepted;
    try {
      accepted = await this.commandGateway.accept({
        commandId,
        commandRevision: '1',
        principalId: input.principalId,
        request: commandRequest,
        commandSemanticDigest: semanticDigest,
        acceptedPolicyContext: {
          policyContextId: 'frontend-ask-current-policy',
          policyContextRevision: input.policyContextRevision,
          acceptedAt: now,
        },
        correlationId: generatedIdentity('corr'),
        traceId: generatedIdentity('trace'),
        receivedAt: now,
        acceptedAt: now,
      });
    } catch (error) {
      if (
        error instanceof FrontendContractError &&
        (error.code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' ||
          error.code === 'CLIENT_REQUEST_MEANING_MISMATCH')
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The request identity is already bound to different command meaning.',
          module: 'frontend-ask-write',
          operation: 'accept-question',
        });
      }
      throw error;
    }

    if (accepted.outcome.outcomeState === 'COMPLETED') {
      return this.submissionFromCompletedOutcome(input, accepted.outcome);
    }
    if (accepted.outcome.outcomeState === 'REJECTED') {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: accepted.outcome.rejection?.message ?? 'The question command was rejected.',
        module: 'frontend-ask-write',
        operation: 'replay-question',
      });
    }

    const effectiveCommandId = accepted.outcome.commandId;
    let committed: AskCommittedQuestion | undefined;
    let completedByConcurrentExecution: AnyFrontendCommandOutcomeView | undefined;

    try {
      await this.sourceValidator.validate({
        principalId: input.principalId,
        projectId: authority.targetProjectId,
        sensitivityClearance: authority.sensitivityClearance,
        mode,
        policyContextRevision: input.policyContextRevision,
        sourceSelections: request.sourceSelections,
      });

      await this.repository.transaction(async (transaction) => {
        const locked = await this.commandGateway.lockAcceptedForExecution(
          transaction,
          effectiveCommandId,
        );
        if (locked.outcomeState === 'COMPLETED') {
          completedByConcurrentExecution = locked;
          return;
        }

        committed = await this.repository.persistQuestion(transaction, {
          commandId: effectiveCommandId,
          projectId: authority.targetProjectId,
          question: request.question.trim(),
          mode,
          sourceSelections: request.sourceSelections,
          conversationId: request.conversationId ?? '',
          branchId: authority.branchId ?? '',
          ...(request.expectedConversationRevision
            ? { expectedConversationRevision: request.expectedConversationRevision }
            : {}),
          ...(request.expectedBranchRevision
            ? { expectedBranchRevision: request.expectedBranchRevision }
            : {}),
          accessRevision: input.accessRevision,
          policyContextRevision: input.policyContextRevision,
          executionEnabled: this.answerExecution !== undefined,
          createdAt: now,
          generated: {
            conversationId: generatedIdentity('conv'),
            branchId: generatedIdentity('branch'),
            turnId: generatedIdentity('turn'),
            answerRunId: generatedIdentity('run'),
            conversationRevision: generatedRevision('conversation'),
            branchRevision: generatedRevision('branch'),
            turnRevision: generatedRevision('turn'),
            answerRevision: generatedRevision('answer'),
          },
        });

        await this.commandGateway.completeInTransaction(transaction, {
          commandId: effectiveCommandId,
          producedResources: [
            {
              resourceKind: ASK_RESOURCE_KIND.conversation,
              resourceId: committed.conversationId,
              resourceRevision: committed.conversationRevision,
            },
            {
              resourceKind: ASK_RESOURCE_KIND.branch,
              resourceId: committed.branchId,
              resourceRevision: committed.branchRevision,
            },
            {
              resourceKind: ASK_RESOURCE_KIND.turn,
              resourceId: committed.turnId,
              resourceRevision: committed.turnRevision,
            },
            {
              resourceKind: ASK_RESOURCE_KIND.answerRun,
              resourceId: committed.answerRunId,
              resourceRevision: committed.answerRevision,
            },
          ],
          completedAt: new Date().toISOString(),
        });
      });
    } catch (error) {
      const rejectionCode: ErrorCode =
        error instanceof ShotgunError && error.code === 'REVISION_CONFLICT'
          ? 'REVISION_CONFLICT'
          : error instanceof ShotgunError && error.code === 'INVALID_REQUEST'
            ? 'INVALID_REQUEST'
            : 'INTERNAL_UNCLASSIFIED';
      try {
        await this.commandGateway.reject({
          commandId: effectiveCommandId,
          code: rejectionCode,
          message: error instanceof Error ? error.message : 'Question command failed.',
          completedAt: new Date().toISOString(),
        });
      } catch {
        // The transaction may have been completed concurrently. Preserve the original error.
      }
      throw error;
    }

    if (completedByConcurrentExecution) {
      return this.submissionFromCompletedOutcome(input, completedByConcurrentExecution);
    }
    if (!committed) {
      throw new ShotgunError({
        code: 'INTERNAL_UNCLASSIFIED',
        safeMessage: 'The question command completed without authoritative resources.',
        module: 'frontend-ask-write',
        operation: 'submit-question',
      });
    }

    if (this.answerExecution) {
      await this.answerExecution.enqueue({
        principalId: input.principalId,
        projectId: committed.projectId,
        answerRunId: committed.answerRunId,
        accessRevision: input.accessRevision,
        policyContextRevision: input.policyContextRevision,
        sensitivityClearance: authority.sensitivityClearance,
      });
    }

    const answerRun = await this.askWorkspace.getAnswerRun({
      ...input,
      answerRunId: committed.answerRunId,
    });
    const workspace = await this.askWorkspace.getWorkspace({
      ...input,
      conversationId: committed.conversationId,
    });
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      answerRun,
      workspace,
    };
  }

  async getQuestionSubmissionByClientRequestId(
    input: AskReadScope & { readonly clientRequestId: string },
  ): Promise<AskQuestionSubmissionOutcomeView> {
    const outcome = await this.commandGateway.findByClientRequestId(
      input.principalId,
      input.clientRequestId,
    );
    if (!outcome || outcome.commandType !== 'SUBMIT_QUESTION') {
      throw this.notFoundOutcome();
    }

    const targetProjectId = targetProjectIdFromOutcome(outcome);
    if (!input.accessibleProjects.some((project) => project.id === targetProjectId)) {
      throw this.notFoundOutcome();
    }

    if (outcome.outcomeState === 'COMPLETED') {
      return this.outcomeFromCompletedCommand(input, outcome);
    }

    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      outcomeState: outcome.outcomeState === 'ACCEPTED' ? 'OUTCOME_UNKNOWN' : outcome.outcomeState,
      clientRequestId: outcome.clientRequestId,
      idempotencyKey: outcome.idempotencyKey,
      commandId: outcome.commandId,
      ...(outcome.rejection
        ? {
            failureCode: outcome.rejection.code,
            failureMessage: outcome.rejection.message,
          }
        : {}),
    };
  }

  private async resolveAuthority(
    input: AskReadScope & { readonly request: SubmitAskQuestionRequest },
  ): Promise<{
    readonly targetProjectId: string;
    readonly branchId?: string;
    readonly sensitivityClearance: AskAuthorizedProjectSummary['sensitivityClearance'];
  }> {
    if (!input.request.conversationId) {
      if (!input.activeProject) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'An active Project is required for a new question.',
          module: 'frontend-ask-write',
          operation: 'resolve-question-project',
        });
      }
      return {
        targetProjectId: input.activeProject.id,
        sensitivityClearance: input.activeProject.sensitivityClearance,
      };
    }

    if (!input.request.expectedConversationRevision || !input.request.expectedBranchRevision) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Follow-up questions require Conversation and Branch revisions.',
        module: 'frontend-ask-write',
        operation: 'resolve-follow-up',
      });
    }

    const conversation = await this.askWorkspace.getConversation({
      ...input,
      conversationId: input.request.conversationId,
    });
    const project = input.accessibleProjects.find(
      (candidate) => candidate.id === conversation.projectId,
    );
    if (!project) throw this.notFoundOutcome();

    const branchId = input.request.branchId ?? conversation.activeBranchId;
    const branch = conversation.branches.find((candidate) => candidate.branchId === branchId);
    if (!branch) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested Conversation Branch was not found.',
        module: 'frontend-ask-write',
        operation: 'resolve-follow-up',
      });
    }

    return {
      targetProjectId: conversation.projectId,
      branchId,
      sensitivityClearance: project.sensitivityClearance,
    };
  }

  private buildPreconditions(request: SubmitAskQuestionRequest): readonly TypedPrecondition[] {
    if (!request.conversationId) return [];
    return [
      {
        purpose: 'TARGET',
        subject: {
          resourceKind: ASK_RESOURCE_KIND.conversation,
          resourceId: request.conversationId,
        },
        expectedRevision: request.expectedConversationRevision,
      },
      {
        purpose: 'TARGET',
        subject: {
          resourceKind: ASK_RESOURCE_KIND.branch,
          resourceId: request.branchId ?? 'ACTIVE_BRANCH',
        },
        expectedRevision: request.expectedBranchRevision,
      },
    ];
  }

  private async submissionFromCompletedOutcome(
    input: AskReadScope,
    outcome: AnyFrontendCommandOutcomeView,
  ): Promise<AskQuestionSubmissionView> {
    const completed = await this.outcomeFromCompletedCommand(input, outcome);
    if (!completed.answerRun || !completed.conversationId) {
      throw new ShotgunError({
        code: 'INTERNAL_UNCLASSIFIED',
        safeMessage: 'The completed command is missing its Ask resources.',
        module: 'frontend-ask-write',
        operation: 'replay-question',
      });
    }
    const workspace = await this.askWorkspace.getWorkspace({
      ...input,
      conversationId: completed.conversationId,
    });
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      answerRun: completed.answerRun,
      workspace,
    };
  }

  private async outcomeFromCompletedCommand(
    input: AskReadScope,
    outcome: AnyFrontendCommandOutcomeView,
  ): Promise<AskQuestionSubmissionOutcomeView> {
    const conversation = findProducedResource(outcome, ASK_RESOURCE_KIND.conversation);
    const branch = findProducedResource(outcome, ASK_RESOURCE_KIND.branch);
    const turn = findProducedResource(outcome, ASK_RESOURCE_KIND.turn);
    const answerRunResource = findProducedResource(outcome, ASK_RESOURCE_KIND.answerRun);
    if (!conversation || !branch || !turn || !answerRunResource) {
      throw new ShotgunError({
        code: 'INTERNAL_UNCLASSIFIED',
        safeMessage: 'The command outcome does not contain the required Ask resources.',
        module: 'frontend-ask-write',
        operation: 'resolve-question-outcome',
      });
    }
    const answerRun = await this.askWorkspace.getAnswerRun({
      ...input,
      answerRunId: answerRunResource.resourceId,
    });
    if (answerRun.projectId !== targetProjectIdFromOutcome(outcome)) {
      throw this.notFoundOutcome();
    }
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      outcomeState: 'COMPLETED',
      clientRequestId: outcome.clientRequestId,
      idempotencyKey: outcome.idempotencyKey,
      commandId: outcome.commandId,
      conversationId: conversation.resourceId,
      branchId: branch.resourceId,
      turnId: turn.resourceId,
      answerRunId: answerRunResource.resourceId,
      answerRun,
    };
  }

  private notFoundOutcome(): ShotgunError {
    return new ShotgunError({
      code: 'NOT_FOUND',
      safeMessage: 'The requested question submission was not found.',
      module: 'frontend-ask-write',
      operation: 'resolve-question-outcome',
    });
  }
}
