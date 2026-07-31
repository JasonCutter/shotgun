import {
  decodeAskQuestionSubmissionView,
  decodeAskWorkspaceView,
  type AskQuestionSubmissionView,
  type AskWorkspaceView,
} from './frontend-ask.js';
import { FrontendContractError } from './frontend-foundation.js';

const fail = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

export const assertAskWorkspaceInvariants = (
  workspace: AskWorkspaceView,
): AskWorkspaceView => {
  for (const conversation of workspace.conversations) {
    if (conversation.projectId !== workspace.projectId) {
      fail('Ask Workspace Conversation summaries must match workspace.projectId.');
    }
  }
  if (
    workspace.selectedConversation &&
    workspace.selectedConversation.projectId !== workspace.projectId
  ) {
    fail('Ask Workspace selected Conversation must match workspace.projectId.');
  }
  return workspace;
};

export const decodeAskWorkspaceViewWithInvariants = (
  input: unknown,
): AskWorkspaceView => assertAskWorkspaceInvariants(decodeAskWorkspaceView(input));

export const assertAskQuestionSubmissionInvariants = (
  submission: AskQuestionSubmissionView,
): AskQuestionSubmissionView => {
  if (submission.answerRun.projectId !== submission.workspace.projectId) {
    fail('Ask submission AnswerRun Project must match Workspace Project.');
  }
  const selectedConversation = submission.workspace.selectedConversation;
  if (
    selectedConversation &&
    submission.answerRun.conversationId !== selectedConversation.conversationId
  ) {
    fail('Ask submission AnswerRun Conversation must match the selected Conversation.');
  }
  return submission;
};

export const decodeAskQuestionSubmissionViewWithInvariants = (
  input: unknown,
): AskQuestionSubmissionView =>
  assertAskQuestionSubmissionInvariants(decodeAskQuestionSubmissionView(input));
