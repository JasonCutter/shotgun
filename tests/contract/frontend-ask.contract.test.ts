import { describe, expect, it } from 'vitest';

import {
  ASK_SCHEMA_VERSION,
  FrontendContractError,
  decodeAskQuestionSubmissionView,
  decodeAskWorkspaceView,
  decodeSubmitAskQuestionRequest,
} from '../../packages/contracts/src/index.js';

const now = '2026-07-31T07:00:00.000Z';

const workspace = {
  schemaVersion: ASK_SCHEMA_VERSION,
  principalId: 'principal-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  defaultAskMode: 'CANONICAL_ONLY',
  availableAskModes: ['CANONICAL_ONLY'],
  conversations: [],
  capabilities: [],
  projectionRevision: 'ask-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  fetchedAt: now,
  stale: false,
} as const;

const answerRun = {
  schemaVersion: ASK_SCHEMA_VERSION,
  answerRunId: 'run-1',
  conversationId: 'conversation-1',
  branchId: 'branch-1',
  turnId: 'turn-1',
  projectId: 'project-1',
  mode: 'CANONICAL_ONLY',
  state: 'QUEUED',
  question: 'What is canonical?',
  statements: [],
  sourceSelections: [],
  capabilities: ['CANCEL'],
  answerRevision: 'answer-1',
  conversationRevision: 'conversation-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: now,
  updatedAt: now,
  stale: false,
} as const;

describe('Frontend Ask contracts', () => {
  it('decodes the server workspace and answer-run envelope', () => {
    expect(decodeAskWorkspaceView(workspace)).toEqual(workspace);
    expect(
      decodeAskQuestionSubmissionView({
        schemaVersion: ASK_SCHEMA_VERSION,
        answerRun,
        workspace,
      }),
    ).toMatchObject({ answerRun: { answerRunId: 'run-1' }, workspace: { projectId: 'project-1' } });
  });

  it('requires SourceVersion pinning and rejects browser authority fields', () => {
    expect(
      decodeSubmitAskQuestionRequest({
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'request-1',
        idempotencyKey: 'idem-1',
        question: 'Use this source.',
        sourceSelections: [
          { sourceId: 'source-1', sourceVersionId: 'version-2', evidenceIds: [] },
        ],
      }),
    ).toMatchObject({ sourceSelections: [{ sourceVersionId: 'version-2' }] });

    expect(() =>
      decodeSubmitAskQuestionRequest({
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'request-2',
        idempotencyKey: 'idem-2',
        question: 'Do not trust this project id.',
        projectId: 'browser-authority',
        sourceSelections: [],
      }),
    ).toThrow(FrontendContractError);
  });
});
