import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeAskQuestionSubmissionViewWithInvariants,
  decodeAskWorkspaceViewWithInvariants,
} from '../../packages/contracts/src/index.js';

const now = '2026-07-31T12:00:00.000Z';
const answerRun = {
  schemaVersion: '1.0.0',
  answerRunId: 'run-1',
  conversationId: 'conversation-1',
  branchId: 'branch-1',
  turnId: 'turn-1',
  projectId: 'project-1',
  mode: 'CANONICAL_ONLY',
  state: 'SUCCEEDED',
  question: 'What is Canonical?',
  statements: [],
  sourceSelections: [],
  capabilities: [],
  answerRevision: 'answer-1',
  conversationRevision: 'conversation-revision-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: now,
  updatedAt: now,
  stale: false,
} as const;
const conversation = {
  schemaVersion: '1.0.0',
  conversationId: 'conversation-1',
  projectId: 'project-1',
  title: 'Canonical Architecture',
  activeBranchId: 'branch-1',
  branches: [
    {
      branchId: 'branch-1',
      label: 'Main',
      turns: [
        {
          turnId: 'turn-1',
          ordinal: 1,
          userMessage: answerRun.question,
          createdAt: now,
          answerRun,
        },
      ],
    },
  ],
  conversationRevision: 'conversation-revision-1',
  createdAt: now,
  updatedAt: now,
} as const;
const workspace = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  defaultAskMode: 'CANONICAL_ONLY',
  availableAskModes: ['CANONICAL_ONLY'],
  conversations: [
    {
      conversationId: 'conversation-1',
      projectId: 'project-1',
      title: conversation.title,
      activeBranchId: 'branch-1',
      turnCount: 1,
      latestRunState: 'SUCCEEDED',
      updatedAt: now,
    },
  ],
  selectedConversation: conversation,
  capabilities: [],
  projectionRevision: 'projection-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
  stale: false,
} as const;

describe('Ask cross-resource invariant decoders', () => {
  it('accepts a Project-bound workspace and submission envelope', () => {
    expect(decodeAskWorkspaceViewWithInvariants(workspace)).toEqual(workspace);
    expect(
      decodeAskQuestionSubmissionViewWithInvariants({
        schemaVersion: '1.0.0',
        answerRun,
        workspace,
      }),
    ).toMatchObject({ answerRun: { projectId: 'project-1' } });
  });

  it('rejects Conversation summaries from another Project', () => {
    expect(() =>
      decodeAskWorkspaceViewWithInvariants({
        ...workspace,
        conversations: [{ ...workspace.conversations[0], projectId: 'project-2' }],
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects submission Project and selected Conversation mismatches', () => {
    expect(() =>
      decodeAskQuestionSubmissionViewWithInvariants({
        schemaVersion: '1.0.0',
        answerRun: { ...answerRun, projectId: 'project-2' },
        workspace,
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeAskQuestionSubmissionViewWithInvariants({
        schemaVersion: '1.0.0',
        answerRun: { ...answerRun, conversationId: 'conversation-2' },
        workspace,
      }),
    ).toThrow(FrontendContractError);
  });
});
