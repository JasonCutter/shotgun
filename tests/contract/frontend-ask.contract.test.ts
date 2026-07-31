import { describe, expect, it } from 'vitest';

import { InMemoryAskWorkspaceProjection } from '../../adapters/frontend-product-read-in-memory/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  FrontendContractError,
  ShotgunError,
  decodeAskAnswerRunSnapshot,
  decodeAskBranchView,
  decodeAskConversationView,
  decodeAskQuestionSubmissionView,
  decodeAskWorkspaceView,
  decodeSubmitAskQuestionRequest,
} from '../../packages/contracts/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryAskConversationRepository } from '../../adapters/frontend-ask-write-in-memory/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';

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

const conversation = {
  schemaVersion: ASK_SCHEMA_VERSION,
  conversationId: 'conversation-1',
  projectId: 'project-1',
  title: 'Canonical Architecture Query',
  activeBranchId: 'branch-1',
  branches: [
    {
      branchId: 'branch-1',
      label: 'Main Branch',
      turns: [
        {
          turnId: 'turn-1',
          ordinal: 1,
          userMessage: 'What is canonical?',
          createdAt: now,
          answerRun,
        },
      ],
    },
  ],
  conversationRevision: 'rev-1',
  createdAt: now,
  updatedAt: now,
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
        sourceSelections: [{ sourceId: 'source-1', sourceVersionId: 'version-2', evidenceIds: [] }],
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

  it('decodes conversation and branch views accurately', () => {
    expect(decodeAskConversationView(conversation)).toEqual(conversation);
    expect(decodeAskBranchView(conversation.branches[0])).toEqual(conversation.branches[0]);
  });

  it('rejects unknown fields in workspace and answer-run decoders', () => {
    expect(() =>
      decodeAskWorkspaceView({
        ...workspace,
        unknownField: 'malicious',
      }),
    ).toThrow(FrontendContractError);

    expect(() =>
      decodeAskAnswerRunSnapshot({
        ...answerRun,
        extraAuthorityField: 'invalid',
      }),
    ).toThrow(FrontendContractError);
  });

  it('enforces cross-field validations, integer constraints, and strict ISO 8601 timestamps', () => {
    expect(() =>
      decodeAskConversationView({
        ...conversation,
        activeBranchId: 'non-existent-branch',
      }),
    ).toThrow(FrontendContractError);

    expect(() =>
      decodeAskWorkspaceView({
        ...workspace,
        defaultAskMode: 'HYBRID',
        availableAskModes: ['CANONICAL_ONLY'],
      }),
    ).toThrow(FrontendContractError);

    expect(() =>
      decodeAskBranchView({
        branchId: 'branch-1',
        label: 'Branch 1',
        turns: [
          {
            turnId: 'turn-1',
            ordinal: 1.5,
            userMessage: 'Test',
            createdAt: now,
            answerRun,
          },
        ],
      }),
    ).toThrow(FrontendContractError);

    expect(() =>
      decodeAskConversationView({
        ...conversation,
        createdAt: 'invalid-date-format',
      }),
    ).toThrow(FrontendContractError);
  });

  it('blocks zero-project workspace reads with NOT_FOUND error', async () => {
    const projection = new InMemoryAskWorkspaceProjection();
    const scope = {
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: null,
      accessibleProjects: [],
      accessRevision: '1',
      policyContextRevision: '1',
    };

    await expect(projection.getWorkspace(scope)).rejects.toThrow(ShotgunError);
  });

  it('supports deep-linking accessible conversation without active project auto-switching', async () => {
    const projection = new InMemoryAskWorkspaceProjection();
    projection.addConversation(conversation);

    const scope = {
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: {
        id: 'project-2',
        label: 'Project Two',
        isOwner: false,
        sensitivityClearance: 'public' as const,
      },
      accessibleProjects: [
        {
          id: 'project-1',
          label: 'Project One',
          isOwner: true,
          sensitivityClearance: 'private' as const,
        },
        {
          id: 'project-2',
          label: 'Project Two',
          isOwner: false,
          sensitivityClearance: 'public' as const,
        },
      ],
      accessRevision: '1',
      policyContextRevision: '1',
    };

    const loadedWorkspace = await projection.getWorkspace({
      ...scope,
      conversationId: 'conversation-1',
    });
    expect(loadedWorkspace.projectId).toBe('project-1');
    expect(loadedWorkspace.selectedConversation?.conversationId).toBe('conversation-1');
  });

  it('supports submitQuestion command creation, idempotency replay, and outcome resolution', async () => {
    const projection = new InMemoryAskWorkspaceProjection();
    const commandGateway = new InMemoryFrontendCommandGateway();
    const repository = new InMemoryAskConversationRepository();
    
    repository.onSave = (agg) => {
      projection.addConversation(agg.conversation);
    };

    const coordinator = new AskCommandCoordinator(commandGateway, repository, projection);

    const scope = {
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: {
        id: 'project-1',
        label: 'Project One',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
      accessibleProjects: [
        {
          id: 'project-1',
          label: 'Project One',
          isOwner: true,
          sensitivityClearance: 'private' as const,
        },
      ],
      accessRevision: '1',
      policyContextRevision: '1',
    };

    const submitRequest = {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: 'req-100',
      idempotencyKey: 'idemp-100',
      question: 'New question testing submit command',
      mode: 'CANONICAL_ONLY' as const,
      sourceSelections: [],
    };

    const submission = await coordinator.submitQuestion({
      ...scope,
      request: submitRequest,
    });

    expect(submission.answerRun.state).toBe('QUEUED'); // QUEUED during creation
    expect(submission.answerRun.question).toBe('New question testing submit command');
    // Because in-memory doesn't actually populate projection yet unless wired, 
    // Wait, InMemoryAskWorkspaceProjection doesn't automatically receive saves from InMemoryAskConversationRepository. 
    // They are separate unless we wire them. But we only care about the returned workspace from coordinator.
    expect(submission.workspace.projectId).toBe('project-1');

    repository.getConversationOutcome = async (clientReqId, prinId, projId) => {
      if (clientReqId === submitRequest.clientRequestId && prinId === scope.principalId) {
        return {
          clientRequestId: clientReqId,
          outcomeState: 'COMPLETED',
          conversationId: submission.workspace.selectedConversation!.conversationId,
          branchId: submission.workspace.selectedConversation!.activeBranchId,
          turnId: submission.workspace.selectedConversation!.branches[0].turns[0].turnId,
          answerRun: submission.answerRun,
        };
      }
      return undefined;
    };

    // Idempotency Replay
    const replayedSubmission = await coordinator.submitQuestion({
      ...scope,
      request: submitRequest,
    });
    // The workspace fetchedAt will be different so we can just check the run
    expect(replayedSubmission.answerRun.answerRunId).toBe(submission.answerRun.answerRunId);

    // Idempotency Conflict check on different payload
    await expect(
      coordinator.submitQuestion({
        ...scope,
        request: { ...submitRequest, question: 'Different question payload' },
      }),
    ).rejects.toThrow(ShotgunError);

    // Outcome Resolution by clientRequestId
    const outcome = await coordinator.getQuestionSubmissionByClientRequestId({
      ...scope,
      clientRequestId: 'req-100',
    });
    expect(outcome.outcomeState).toBe('COMPLETED');
    expect(outcome.clientRequestId).toBe('req-100');
    expect(outcome.conversationId).toBe(submission.answerRun.conversationId);
  });
});
