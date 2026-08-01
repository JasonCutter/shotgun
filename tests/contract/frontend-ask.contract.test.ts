import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryAskConversationRepository } from '../../adapters/frontend-ask-write-in-memory/src/index.js';
import { InMemoryAskWorkspaceProjection } from '../../adapters/frontend-product-read-in-memory/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  FrontendContractError,
  ShotgunError,
  computeSubmitAskQuestionDigest,
  decodeAskAnswerRunSnapshot,
  decodeAskBranchView,
  decodeAskConversationView,
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
  state: 'ACTION_REQUIRED',
  attentionReason: 'MODEL_EXECUTION_NOT_CONFIGURED',
  question: 'What is canonical?',
  statements: [],
  sourceSelections: [],
  capabilities: [],
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
      branchRevision: 'branch-rev-1',
      label: 'Main Branch',
      turns: [
        {
          turnId: 'turn-1',
          turnRevision: 'turn-rev-1',
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

const createCoordinator = () => {
  const projection = new InMemoryAskWorkspaceProjection();
  const commandGateway = new InMemoryFrontendCommandGateway();
  const repository = new InMemoryAskConversationRepository();
  repository.onSave = (aggregate) => projection.addConversation(aggregate.conversation);
  return {
    projection,
    commandGateway,
    repository,
    coordinator: new AskCommandCoordinator(commandGateway, repository, projection),
  };
};

describe('Frontend Ask contracts', () => {
  it('decodes the server workspace and authoritative ACTION_REQUIRED answer-run envelope', () => {
    expect(decodeAskWorkspaceView(workspace)).toEqual(workspace);
    expect(
      decodeAskQuestionSubmissionView({
        schemaVersion: ASK_SCHEMA_VERSION,
        answerRun,
        workspace,
      }),
    ).toMatchObject({
      answerRun: {
        answerRunId: 'run-1',
        state: 'ACTION_REQUIRED',
        attentionReason: 'MODEL_EXECUTION_NOT_CONFIGURED',
      },
      workspace: { projectId: 'project-1' },
    });
  });

  it('requires SourceVersion pinning, rejects browser authority fields, and requires follow-up revisions', () => {
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

    expect(() =>
      decodeSubmitAskQuestionRequest({
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'request-3',
        idempotencyKey: 'idem-3',
        conversationId: 'conversation-1',
        question: 'Follow up without revisions.',
        sourceSelections: [],
      }),
    ).toThrow(FrontendContractError);
  });

  it('preserves ordered SourceSelections and Evidence IDs in the semantic digest', () => {
    const request = decodeSubmitAskQuestionRequest({
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: 'request-digest',
      idempotencyKey: 'idem-digest',
      question: '  Explain this evidence.  ',
      mode: 'CANONICAL_ONLY',
      sourceSelections: [
        {
          sourceId: 'source-2',
          sourceVersionId: 'version-2',
          evidenceIds: ['evidence-2', 'evidence-1'],
        },
        {
          sourceId: 'source-1',
          sourceVersionId: 'version-1',
          evidenceIds: [],
        },
      ],
    });
    expect(JSON.parse(computeSubmitAskQuestionDigest(request))).toMatchObject({
      question: 'Explain this evidence.',
      mode: 'CANONICAL_ONLY',
      sourceSelections: [
        { sourceId: 'source-2', evidenceIds: ['evidence-2', 'evidence-1'] },
        { sourceId: 'source-1', evidenceIds: [] },
      ],
    });
  });

  it('decodes conversation and branch revisions and rejects broken cross-resource invariants', () => {
    expect(decodeAskConversationView(conversation)).toEqual(conversation);
    expect(decodeAskBranchView(conversation.branches[0])).toEqual(conversation.branches[0]);

    expect(() =>
      decodeAskConversationView({
        ...conversation,
        activeBranchId: 'non-existent-branch',
      }),
    ).toThrow(FrontendContractError);

    expect(() =>
      decodeAskAnswerRunSnapshot({
        ...answerRun,
        extraAuthorityField: 'invalid',
      }),
    ).toThrow(FrontendContractError);
  });

  it('blocks zero-project workspace reads with NOT_FOUND', async () => {
    const projection = new InMemoryAskWorkspaceProjection();
    await expect(
      projection.getWorkspace({
        principalId: 'principal-1',
        sessionId: 'session-1',
        activeProject: null,
        accessibleProjects: [],
        accessRevision: '1',
        policyContextRevision: '1',
      }),
    ).rejects.toThrow(ShotgunError);
  });

  it('keeps an accessible resource-project Conversation independent from the Active Project', async () => {
    const projection = new InMemoryAskWorkspaceProjection();
    projection.addConversation(conversation);
    const loadedWorkspace = await projection.getWorkspace({
      ...scope,
      activeProject: {
        id: 'project-2',
        label: 'Project Two',
        isOwner: false,
        sensitivityClearance: 'public',
      },
      accessibleProjects: [
        ...scope.accessibleProjects,
        {
          id: 'project-2',
          label: 'Project Two',
          isOwner: false,
          sensitivityClearance: 'public' as const,
        },
      ],
      conversationId: 'conversation-1',
    });
    expect(loadedWorkspace.projectId).toBe('project-1');
    expect(loadedWorkspace.selectedConversation?.conversationId).toBe('conversation-1');
  });

  it('uses the resource Project authority for a follow-up when Active Project differs', async () => {
    const { projection, commandGateway, repository } = createCoordinator();
    const enqueued: Array<Record<string, unknown>> = [];
    const executionAuthorities = {
      'project-1': {
        projectId: 'project-1',
        accessRevision: 'access-project-1',
        policyContextRevision: 'policy-project-1',
        accessScope: ['project-1:read'],
        sensitivityClearance: 'private' as const,
      },
      'project-2': {
        projectId: 'project-2',
        accessRevision: 'access-project-2',
        policyContextRevision: 'policy-project-2',
        accessScope: ['project-2:read'],
        sensitivityClearance: 'public' as const,
      },
    };
    const coordinator = new AskCommandCoordinator(
      commandGateway,
      repository,
      projection,
      undefined,
      {
        enqueue: async (input) => {
          enqueued.push(input);
        },
      },
    );

    const first = await coordinator.submitQuestion({
      ...scope,
      executionAuthorities,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'req-resource-project-seed',
        idempotencyKey: 'idem-resource-project-seed',
        question: 'Seed the resource project conversation.',
        sourceSelections: [],
      },
    });
    const firstConversation = first.workspace.selectedConversation!;
    const firstBranch = firstConversation.branches[0]!;
    const input = {
      ...scope,
      activeProject: {
        id: 'project-2',
        label: 'Project Two',
        isOwner: false,
        sensitivityClearance: 'public' as const,
      },
      accessibleProjects: [
        ...scope.accessibleProjects,
        {
          id: 'project-2',
          label: 'Project Two',
          isOwner: false,
          sensitivityClearance: 'public' as const,
        },
      ],
      executionAuthorities,
    };

    const followUp = await coordinator.submitQuestion({
      ...input,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'req-resource-project-authority',
        idempotencyKey: 'idem-resource-project-authority',
        conversationId: firstConversation.conversationId,
        branchId: firstBranch.branchId,
        expectedConversationRevision: firstConversation.conversationRevision,
        expectedBranchRevision: firstBranch.branchRevision!,
        question: 'Use the resource project authority.',
        sourceSelections: [],
      },
    });

    expect(followUp.answerRun).toMatchObject({
      projectId: 'project-1',
      accessRevision: 'access-project-1',
      policyContextRevision: 'policy-project-1',
    });
    expect(enqueued.at(-1)).toMatchObject({
      projectId: 'project-1',
      accessRevision: 'access-project-1',
      policyContextRevision: 'policy-project-1',
      accessScope: ['project-1:read'],
      sensitivityClearance: 'private',
    });
  });

  it('creates an atomic aggregate, replays exact command meaning, and resolves the durable outcome', async () => {
    const { coordinator } = createCoordinator();
    const request = {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: 'req-100',
      idempotencyKey: 'idemp-100',
      question: 'New question testing submit command',
      mode: 'CANONICAL_ONLY' as const,
      sourceSelections: [],
    };

    const submission = await coordinator.submitQuestion({ ...scope, request });
    expect(submission.answerRun).toMatchObject({
      state: 'ACTION_REQUIRED',
      attentionReason: 'MODEL_EXECUTION_NOT_CONFIGURED',
      question: request.question,
    });
    expect(submission.workspace.selectedConversation?.branches[0]?.turns).toHaveLength(1);

    const replay = await coordinator.submitQuestion({ ...scope, request });
    expect(replay.answerRun.answerRunId).toBe(submission.answerRun.answerRunId);

    await expect(
      coordinator.submitQuestion({
        ...scope,
        request: { ...request, question: 'Different question payload' },
      }),
    ).rejects.toThrow(ShotgunError);

    const outcome = await coordinator.getQuestionSubmissionByClientRequestId({
      ...scope,
      clientRequestId: request.clientRequestId,
    });
    expect(outcome).toMatchObject({
      outcomeState: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      conversationId: submission.answerRun.conversationId,
      branchId: submission.answerRun.branchId,
      turnId: submission.answerRun.turnId,
      answerRunId: submission.answerRun.answerRunId,
    });
  });

  it('appends a follow-up with revision checks and rejects a stale replay with zero new Turn', async () => {
    const { coordinator, projection } = createCoordinator();
    const first = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'req-first',
        idempotencyKey: 'idem-first',
        question: 'First question',
        sourceSelections: [],
      },
    });
    const initialConversation = first.workspace.selectedConversation!;
    const initialBranch = initialConversation.branches[0]!;

    const followUp = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: 'req-follow-up',
        idempotencyKey: 'idem-follow-up',
        conversationId: initialConversation.conversationId,
        branchId: initialBranch.branchId,
        expectedConversationRevision: initialConversation.conversationRevision,
        expectedBranchRevision: initialBranch.branchRevision!,
        question: 'Follow-up question',
        sourceSelections: [],
      },
    });
    expect(followUp.workspace.selectedConversation?.branches[0]?.turns).toHaveLength(2);
    expect(followUp.workspace.selectedConversation?.branches[0]?.turns[1]?.ordinal).toBe(2);

    await expect(
      coordinator.submitQuestion({
        ...scope,
        request: {
          schemaVersion: ASK_SCHEMA_VERSION,
          clientRequestId: 'req-stale',
          idempotencyKey: 'idem-stale',
          conversationId: initialConversation.conversationId,
          branchId: initialBranch.branchId,
          expectedConversationRevision: initialConversation.conversationRevision,
          expectedBranchRevision: initialBranch.branchRevision!,
          question: 'Stale follow-up',
          sourceSelections: [],
        },
      }),
    ).rejects.toThrow(ShotgunError);

    const current = await projection.getConversation({
      ...scope,
      conversationId: initialConversation.conversationId,
    });
    expect(current.branches[0]?.turns).toHaveLength(2);
  });
});
