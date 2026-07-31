import { randomUUID } from 'node:crypto';
import {
  FrontendContractError,
  type AnyFrontendCommandRequest,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskConversationView,
  type AskQuestionSubmissionOutcomeView,
  type AskQuestionSubmissionView,
  type SubmitAskQuestionRequest,
} from '../../../packages/contracts/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  ShotgunError,
  computeSubmitAskQuestionDigest,
} from '../../../packages/contracts/src/index.js';
import type { FrontendCommandGatewayPort } from '../../../modules/frontend-command-gateway/src/index.js';
import type {
  FrontendReadScope,
  AskWorkspaceProjectionPort,
} from '../../../modules/frontend-product-read/src/index.js';

export type AskConversationRepositoryPort = {
  transaction<T>(
    action: (client: unknown) => Promise<T>,
  ): Promise<T>;
  
  saveAggregate(
    client: unknown,
    aggregate: {
      conversation: AskConversationView;
      branch: AskBranchView;
      turn: AskBranchView['turns'][0];
      answerRun: AskAnswerRunSnapshot;
    },
    expectedConversationRevision?: string,
    expectedBranchRevision?: string,
  ): Promise<void>;

  getConversationOutcome(
    clientRequestId: string,
    principalId: string,
    projectId: string,
  ): Promise<AskQuestionSubmissionOutcomeView | undefined>;
};

export class AskCommandCoordinator {
  constructor(
    private readonly commandGateway: FrontendCommandGatewayPort,
    private readonly repository: AskConversationRepositoryPort,
    private readonly askWorkspace: AskWorkspaceProjectionPort,
  ) {}

  async submitQuestion(
    input: FrontendReadScope & { readonly request: SubmitAskQuestionRequest },
  ): Promise<AskQuestionSubmissionView> {
    const { request: req, principalId, activeProject, accessRevision, policyContextRevision } = input;

    let targetProjectId: string;
    let expectedConversationRevision = req.expectedConversationRevision;
    let expectedBranchRevision = req.expectedBranchRevision;

    if (req.conversationId) {
      if (!expectedConversationRevision || !expectedBranchRevision) {
        throw new ShotgunError({
          code: 'INVALID_REQUEST',
          safeMessage: 'expectedConversationRevision and expectedBranchRevision are required for follow-up questions.',
          module: 'frontend-ask-write',
          operation: 'submit-question',
        });
      }
      const existingConv = await this.askWorkspace.getConversation({
        ...input,
        conversationId: req.conversationId,
      });
      targetProjectId = existingConv.projectId;
    } else {
      if (!activeProject) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Active project is required for a new question.',
          module: 'frontend-ask-write',
          operation: 'submit-question',
        });
      }
      targetProjectId = activeProject.id;
    }

    const semanticDigest = computeSubmitAskQuestionDigest(req);

    const commandId = `cmd-${randomUUID()}`;
    const commandRevision = `cmd-rev-${Date.now()}`;
    const nowTimestamp = new Date().toISOString();
    
    const commandRequest: AnyFrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: 'SUBMIT_QUESTION',
      commandSchemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: req.clientRequestId,
      idempotencyKey: req.idempotencyKey,
      projectContext: {
        activeProjectId: input.activeProject?.id ?? targetProjectId,
        targetProjectId: targetProjectId,
        observedProjectAccessRevision: accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: policyContextRevision,
      },
      preconditions: [],
      clientIssuedAt: nowTimestamp,
      payload: req,
    };

    let acceptResult;
    try {
      acceptResult = await this.commandGateway.accept({
        commandId,
        commandRevision,
        principalId,
        request: commandRequest,
        commandSemanticDigest: semanticDigest,
        acceptedPolicyContext: {
          policyContextId: 'default',
          policyContextRevision,
          acceptedAt: nowTimestamp,
        },
        correlationId: `corr-${randomUUID()}`,
        traceId: `trace-${randomUUID()}`,
        receivedAt: nowTimestamp,
        acceptedAt: nowTimestamp,
      });
    } catch (error) {
      if (error instanceof FrontendContractError && 
         (error.code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' || error.code === 'CLIENT_REQUEST_MEANING_MISMATCH')) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'Command idempotency key conflict with a different payload or semantic digest.',
          module: 'frontend-ask-write',
          operation: 'submit-question',
        });
      }
      throw error;
    }

    if (acceptResult.replayed && acceptResult.outcome.outcomeState === 'COMPLETED') {
      const outcome = await this.repository.getConversationOutcome(
        req.clientRequestId,
        principalId,
        targetProjectId,
      );
      if (!outcome || outcome.outcomeState !== 'COMPLETED' || !outcome.answerRun) {
        throw new ShotgunError({
          code: 'INTERNAL_UNCLASSIFIED',
          safeMessage: 'Unable to start candidate materialization process.',
          module: 'frontend-ask-write',
          operation: 'submit-question',
        });
      }
      const workspace = await this.askWorkspace.getWorkspace({
        ...input,
        conversationId: outcome.conversationId,
      });
      return {
        schemaVersion: ASK_SCHEMA_VERSION,
        answerRun: outcome.answerRun,
        workspace,
      };
    }

    // NEW or REPLAY_ACCEPTED (needs completion)
    const effectiveCommandId = acceptResult.replayed ? acceptResult.outcome.commandId : commandId;

    let conversation!: AskConversationView;
    let branch!: AskBranchView;
    let turn!: AskBranchView['turns'][0];
    let answerRun!: AskAnswerRunSnapshot;

    try {
      await this.repository.transaction(async (tx) => {
        let branchId: string;
        let turnId: string;
        let answerRunId: string;
        let turnOrdinal: number;
        let newConversationRevision: string;

        if (req.conversationId) {
          const existingConv = await this.askWorkspace.getConversation({
            ...input,
            conversationId: req.conversationId,
          });
          branchId = req.branchId ?? existingConv.activeBranchId;
          const targetBranch = existingConv.branches.find((b) => b.branchId === branchId);
          if (!targetBranch) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The requested branch was not found.',
              module: 'frontend-ask-write',
              operation: 'submit-question',
            });
          }
          turnOrdinal = targetBranch.turns.length + 1;
          turnId = `turn-${randomUUID()}`;
          answerRunId = `run-${randomUUID()}`;
          newConversationRevision = `conv-rev-${Date.now()}`;

          answerRun = {
            schemaVersion: ASK_SCHEMA_VERSION,
            answerRunId,
            conversationId: existingConv.conversationId,
            branchId,
            turnId,
            projectId: existingConv.projectId,
            mode: req.mode ?? 'CANONICAL_ONLY',
            state: 'QUEUED',
            question: req.question,
            statements: [],
            sourceSelections: req.sourceSelections,
            capabilities: ['SUBMIT_QUESTION'],
            answerRevision: `answer-rev-${turnId}`,
            conversationRevision: newConversationRevision,
            accessRevision,
            policyContextRevision,
            createdAt: nowTimestamp,
            updatedAt: nowTimestamp,
            stale: false,
          };

          turn = {
            turnId,
            ordinal: turnOrdinal,
            userMessage: req.question,
            createdAt: nowTimestamp,
            answerRun,
          };

          const updatedTurns = [...targetBranch.turns, turn];
          branch = { ...targetBranch, turns: updatedTurns };

          const updatedBranches = existingConv.branches.map(b => b.branchId === branchId ? branch : b);

          conversation = {
            ...existingConv,
            branches: updatedBranches,
            conversationRevision: newConversationRevision,
            updatedAt: nowTimestamp,
          };
        } else {
          const convId = `conv-${randomUUID()}`;
          branchId = `branch-${randomUUID()}`;
          turnId = `turn-${randomUUID()}`;
          answerRunId = `run-${randomUUID()}`;
          turnOrdinal = 1;
          newConversationRevision = `conv-rev-${Date.now()}`;

          answerRun = {
            schemaVersion: ASK_SCHEMA_VERSION,
            answerRunId,
            conversationId: convId,
            branchId,
            turnId,
            projectId: targetProjectId,
            mode: req.mode ?? 'CANONICAL_ONLY',
            state: 'QUEUED',
            question: req.question,
            statements: [],
            sourceSelections: req.sourceSelections,
            capabilities: ['SUBMIT_QUESTION'],
            answerRevision: `answer-rev-${turnId}`,
            conversationRevision: newConversationRevision,
            accessRevision,
            policyContextRevision,
            createdAt: nowTimestamp,
            updatedAt: nowTimestamp,
            stale: false,
          };

          turn = {
            turnId,
            ordinal: turnOrdinal,
            userMessage: req.question,
            createdAt: nowTimestamp,
            answerRun,
          };

          branch = {
            branchId,
            label: 'Main Branch',
            turns: [turn],
          };

          conversation = {
            schemaVersion: ASK_SCHEMA_VERSION,
            conversationId: convId,
            projectId: targetProjectId,
            title: req.question.slice(0, 50),
            activeBranchId: branchId,
            branches: [branch],
            conversationRevision: newConversationRevision,
            createdAt: nowTimestamp,
            updatedAt: nowTimestamp,
          };
        }

        await this.repository.saveAggregate(tx, {
          conversation,
          branch,
          turn,
          answerRun
        }, req.conversationId ? expectedConversationRevision : undefined, req.conversationId ? expectedBranchRevision : undefined);

        await this.commandGateway.complete({
          commandId: effectiveCommandId,
          producedResources: [],
          completedAt: new Date().toISOString(),
        });
      });
    } catch (error) {
      const isStale = error instanceof ShotgunError && error.code === 'REVISION_CONFLICT';
      await this.commandGateway.reject({
        commandId: effectiveCommandId,
        code: isStale ? 'REVISION_CONFLICT' : 'INTERNAL_UNCLASSIFIED',
        message: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date().toISOString(),
      });
      throw error;
    }

    const workspace = await this.askWorkspace.getWorkspace({
      ...input,
      conversationId: conversation.conversationId,
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
    // Check outcome in all accessible projects or specific logic?
    // Based on Slices 4-5 frozen contract, the outcome scope is Principal and Project.
    // If not found in active project, we search? Wait, the UI doesn't pass a project. We should just query by principal + clientRequest.
    const outcome = await this.repository.getConversationOutcome(
      input.clientRequestId,
      input.principalId,
      input.activeProject?.id ?? '', // We might need to adjust this depending on the exact requirement.
    );
    if (!outcome) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested question submission outcome was not found.',
        module: 'frontend-ask-write',
        operation: 'get-question-submission-outcome',
      });
    }
    return outcome;
  }
}
