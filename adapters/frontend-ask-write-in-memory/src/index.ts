import {
  ASK_SCHEMA_VERSION,
  ShotgunError,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskConversationView,
} from '../../../packages/contracts/src/index.js';
import type {
  AskCommittedQuestion,
  AskConversationRepositoryPort,
  PersistAskQuestionInput,
} from '../../../modules/frontend-ask-write/src/index.js';

type SavedAggregate = {
  readonly conversation: AskConversationView;
  readonly branch: AskBranchView;
  readonly turn: AskBranchView['turns'][number];
  readonly answerRun: AskAnswerRunSnapshot;
};

export class InMemoryAskConversationRepository implements AskConversationRepositoryPort {
  private conversations = new Map<string, AskConversationView>();
  public onSave?: (aggregate: SavedAggregate) => void;

  async transaction<T>(action: (transaction: unknown) => Promise<T>): Promise<T> {
    const before = new Map(this.conversations);
    try {
      return await action({ kind: 'in-memory-ask-transaction' });
    } catch (error) {
      this.conversations = before;
      throw error;
    }
  }

  async persistQuestion(
    _transaction: unknown,
    input: PersistAskQuestionInput,
  ): Promise<AskCommittedQuestion> {
    return input.conversationId ? this.appendFollowUp(input) : this.createConversation(input);
  }

  private createConversation(input: PersistAskQuestionInput): AskCommittedQuestion {
    const answerRun = this.answerRun(input, {
      conversationId: input.generated.conversationId,
      branchId: input.generated.branchId,
    });
    const turn: AskBranchView['turns'][number] = {
      turnId: input.generated.turnId,
      turnRevision: input.generated.turnRevision,
      ordinal: 1,
      userMessage: input.question,
      createdAt: input.createdAt,
      answerRun,
    };
    const branch: AskBranchView = {
      branchId: input.generated.branchId,
      branchRevision: input.generated.branchRevision,
      label: 'Main Branch',
      turns: [turn],
    };
    const conversation: AskConversationView = {
      schemaVersion: ASK_SCHEMA_VERSION,
      conversationId: input.generated.conversationId,
      projectId: input.projectId,
      title: input.question.slice(0, 256),
      activeBranchId: branch.branchId,
      branches: [branch],
      conversationRevision: input.generated.conversationRevision,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.conversations.set(conversation.conversationId, conversation);
    this.onSave?.({ conversation, branch, turn, answerRun });
    return this.committed(input, conversation.conversationId, branch.branchId);
  }

  private appendFollowUp(input: PersistAskQuestionInput): AskCommittedQuestion {
    const conversation = this.conversations.get(input.conversationId!);
    if (!conversation || conversation.projectId !== input.projectId) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested Conversation was not found.',
        module: 'frontend-ask-write-in-memory',
        operation: 'append-question',
      });
    }
    if (conversation.conversationRevision !== input.expectedConversationRevision) {
      throw this.revisionConflict('Conversation');
    }

    const branchId = input.branchId ?? conversation.activeBranchId;
    const branch = conversation.branches.find((candidate) => candidate.branchId === branchId);
    if (!branch) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested Branch was not found.',
        module: 'frontend-ask-write-in-memory',
        operation: 'append-question',
      });
    }
    if (!branch.branchRevision || branch.branchRevision !== input.expectedBranchRevision) {
      throw this.revisionConflict('Branch');
    }

    const answerRun = this.answerRun(input, {
      conversationId: conversation.conversationId,
      branchId,
    });
    const turn: AskBranchView['turns'][number] = {
      turnId: input.generated.turnId,
      turnRevision: input.generated.turnRevision,
      ordinal: branch.turns.length + 1,
      userMessage: input.question,
      createdAt: input.createdAt,
      answerRun,
    };
    const updatedBranch: AskBranchView = {
      ...branch,
      branchRevision: input.generated.branchRevision,
      turns: [...branch.turns, turn],
    };
    const updatedConversation: AskConversationView = {
      ...conversation,
      branches: conversation.branches.map((candidate) =>
        candidate.branchId === branchId ? updatedBranch : candidate,
      ),
      conversationRevision: input.generated.conversationRevision,
      updatedAt: input.createdAt,
    };
    this.conversations.set(updatedConversation.conversationId, updatedConversation);
    this.onSave?.({
      conversation: updatedConversation,
      branch: updatedBranch,
      turn,
      answerRun,
    });
    return this.committed(input, updatedConversation.conversationId, updatedBranch.branchId);
  }

  private answerRun(
    input: PersistAskQuestionInput,
    identity: { readonly conversationId: string; readonly branchId: string },
  ): AskAnswerRunSnapshot {
    const executionEnabled = input.executionEnabled === true;
    return {
      schemaVersion: ASK_SCHEMA_VERSION,
      answerRunId: input.generated.answerRunId,
      conversationId: identity.conversationId,
      branchId: identity.branchId,
      turnId: input.generated.turnId,
      projectId: input.projectId,
      mode: input.mode,
      state: executionEnabled ? 'QUEUED' : 'ACTION_REQUIRED',
      ...(executionEnabled ? {} : { attentionReason: 'MODEL_EXECUTION_NOT_CONFIGURED' as const }),
      question: input.question,
      statements: [],
      sourceSelections: input.sourceSelections,
      capabilities: executionEnabled ? ['CANCEL'] : [],
      answerRevision: input.generated.answerRevision,
      conversationRevision: input.generated.conversationRevision,
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      stale: false,
    };
  }

  private committed(
    input: PersistAskQuestionInput,
    conversationId: string,
    branchId: string,
  ): AskCommittedQuestion {
    return {
      projectId: input.projectId,
      conversationId,
      branchId,
      turnId: input.generated.turnId,
      answerRunId: input.generated.answerRunId,
      conversationRevision: input.generated.conversationRevision,
      branchRevision: input.generated.branchRevision,
      turnRevision: input.generated.turnRevision,
      answerRevision: input.generated.answerRevision,
    };
  }

  private revisionConflict(resource: string): ShotgunError {
    return new ShotgunError({
      code: 'REVISION_CONFLICT',
      safeMessage: `${resource} revision mismatch. Refresh before submitting again.`,
      module: 'frontend-ask-write-in-memory',
      operation: 'append-question',
    });
  }
}
