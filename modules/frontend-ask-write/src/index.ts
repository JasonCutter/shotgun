import { randomUUID } from 'node:crypto';

import {
  ASK_SCHEMA_VERSION,
  FrontendContractError,
  ShotgunError,
  computeSubmitAskQuestionDigest,
  type AnyFrontendCommandOutcomeView,
  type AnyFrontendCommandRequest,
  type AskQuestionSubmissionOutcomeView,
  type AskQuestionSubmissionView,
  type AskSourceSelectionView,
  type SubmitAskQuestionRequest,
  type TypedPrecondition,
} from '../../../packages/contracts/src/index.js';
import type { FrontendCommandGatewayPort } from '../../frontend-command-gateway/src/index.js';
import type {
  AskWorkspaceProjectionPort,
  FrontendReadScope,
} from '../../frontend-product-read/src/index.js';

export const ASK_RESOURCE_KIND = {
  conversation: 'ASK_CONVERSATION',
  branch: 'ASK_BRANCH',
  turn: 'ASK_TURN',
  answerRun: 'ASK_ANSWER_RUN',
} as const;

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
  readonly conversationId?: string;
  readonly branchId?: string;
  readonly expectedConversationRevision?: string;
  readonly expectedBranchRevision?: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
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

export type AskSourceSelectionValidatorPort = {
  validate(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly sensitivityClearance: FrontendReadScope['accessibleProjects'][number]['sensitivityClearance'];
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

export class AskCommandCoordinator {
  constructor(
    private readonly commandGateway: FrontendCommandGatewayPort,
    private readonly repository: AskConversationRepositoryPort,
    private readonly askWorkspace: AskWorkspaceProjectionPort,
    private readonly sourceValidator: AskSourceSelectionValidatorPort =
      new EmptyOnlyAskSourceSelectionValidator(),
  ) {}

  async submitQuestion(
    input: FrontendReadScope & { readonly request: SubmitAskQuestionRequest },
  ): Promise<AskQuestionSubmissionView> {
    const request = input.request;
    const mode = request.mode ?? 'CANONICAL_ONLY';
    const authority = await this.resolveAuthority(input);

    await this.sourceValidator.validate({
      principalId: input.principalId,
      projectId: authority.targetProjectId,
      sensitivityClearance: authority.sensitivityClearance,
      mode,
      policyContextRevision: input.policyContextRevision,
      sourceSelections: request.sourceSelections,
    });

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
        ...(request.conversationId
          ? { resourceProjectId: authority.targetProjectId }
          : {}),
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
          ...(request.conversationId ? { conversationId: request.conversationId } : {}),
          ...(authority.branchId ? { branchId: authority.branchId } : {}),
          ...(request.expectedConversationRevision
            ? { expectedConversationRevision: request.expectedConversationRevision }
            : {}),
          ...(request.expectedBranchRevision
            ? { expectedBranchRevision: request.expectedBranchRevision }
            : {}),
          accessRevision: input.accessRevision,
          policyContextRevision: input.policyContextRevision,
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
      const rejectionCode =
        error instanceof ShotgunError && error.code === 'REVISION_CONFLICT'
          ? 'REVISION_CONFLICT'
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
    input: FrontendReadScope & { readonly clientRequestId: string },
  ): Promise<AskQuestionSubmissionOutcomeView> {
    const outcome = await this.commandGateway.findByClientRequestId(
      input.principalId,
      input.clientRequestId,
    );
    if (!outcome || outcome.commandType !== 'SUBMIT_QUESTION') {
      throw this.notFoundOutcome();
    }

    const targetProjectId = outcome.acceptedProjectContext.targetProjectId;
    if (!input.accessibleProjects.some((project) => project.id === targetProjectId)) {
      throw this.notFoundOutcome();
    }

    if (outcome.outcomeState === 'COMPLETED') {
      const completed = await this.outcomeFromCompletedCommand(input, outcome);
      return completed;
    }

    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      outcomeState:
        outcome.outcomeState === 'ACCEPTED' ? 'OUTCOME_UNKNOWN' : outcome.outcomeState,
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
    input: FrontendReadScope & { readonly request: SubmitAskQuestionRequest },
  ): Promise<{
    readonly targetProjectId: string;
    readonly branchId?: string;
    readonly sensitivityClearance: FrontendReadScope['accessibleProjects'][number]['sensitivityClearance'];
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

    if (
      !input.request.expectedConversationRevision ||
      !input.request.expectedBranchRevision
    ) {
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
    if (
      conversation.conversationRevision !== input.request.expectedConversationRevision ||
      branch.branchRevision !== input.request.expectedBranchRevision
    ) {
      throw new ShotgunError({
        code: 'REVISION_CONFLICT',
        safeMessage: 'The Conversation changed. Refresh before submitting the follow-up.',
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
        subject: { resourceKind: ASK_RESOURCE_KIND.conversation, resourceId: request.conversationId },
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
    input: FrontendReadScope,
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
    input: FrontendReadScope,
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
    if (answerRun.projectId !== outcome.acceptedProjectContext.targetProjectId) {
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
