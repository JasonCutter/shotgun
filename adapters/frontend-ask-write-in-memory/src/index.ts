import {
  ShotgunError,
  AskAnswerRunSnapshot,
  AskBranchView,
  AskConversationView,
  AskQuestionSubmissionOutcomeView,
} from '../../../packages/contracts/src/index.js';
import type { AskConversationRepositoryPort } from '../../../modules/frontend-ask-write/src/index.js';

export class InMemoryAskConversationRepository implements AskConversationRepositoryPort {
  private readonly conversations = new Map<string, AskConversationView>();
  private readonly branches = new Map<string, AskBranchView>();
  private readonly answerRuns = new Map<string, AskAnswerRunSnapshot>();
  private readonly outcomes = new Map<string, AskQuestionSubmissionOutcomeView>();

  public onSave?: (aggregate: {
    conversation: AskConversationView;
    branch: AskBranchView;
    turn: AskBranchView['turns'][0];
    answerRun: AskAnswerRunSnapshot;
  }) => void;

  async transaction<T>(action: (client: unknown) => Promise<T>): Promise<T> {
    // In-memory doesn't actually lock, but we pass a dummy client.
    return action({});
  }

  async saveAggregate(
    client: unknown,
    aggregate: {
      conversation: AskConversationView;
      branch: AskBranchView;
      turn: AskBranchView['turns'][0];
      answerRun: AskAnswerRunSnapshot;
    },
    expectedConversationRevision?: string,
    expectedBranchRevision?: string,
  ): Promise<void> {
    const { conversation, branch, answerRun } = aggregate;

    const existingConv = this.conversations.get(conversation.conversationId);
    if (existingConv && expectedConversationRevision !== undefined) {
      if (existingConv.conversationRevision !== expectedConversationRevision) {
        throw new ShotgunError({
          code: 'REVISION_CONFLICT',
          safeMessage: 'Conversation revision mismatch. Another client may have submitted a question.',
          module: 'frontend-ask-write-in-memory',
          operation: 'start-answer-run',
        });
      }
    }

    const existingBranch = this.branches.get(branch.branchId);
    if (existingBranch && expectedBranchRevision !== undefined) {
      // In-memory branches map just stores the latest branch state for checking revisions.
      // But we aren't maintaining `branchRevision` in AskBranchView directly (it's not in the contract yet),
      // we check it if needed, but since it's not in AskBranchView, we assume it's valid for now.
    }

    // Update in-memory state
    this.conversations.set(conversation.conversationId, conversation);
    this.branches.set(branch.branchId, branch);
    this.answerRuns.set(answerRun.answerRunId, answerRun);

    this.onSave?.(aggregate);
  }

  async getConversationOutcome(
    clientRequestId: string,
    principalId: string,
    projectId: string,
  ): Promise<AskQuestionSubmissionOutcomeView | undefined> {
    return this.outcomes.get(clientRequestId);
  }

  // Helper for test/setup
  setOutcome(clientRequestId: string, outcome: AskQuestionSubmissionOutcomeView) {
    this.outcomes.set(clientRequestId, outcome);
  }
}
