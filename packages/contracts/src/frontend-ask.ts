import { FrontendContractError } from './frontend-foundation.js';

export const ASK_SCHEMA_VERSION = '1.0.0' as const;
export type AskMode = 'CANONICAL_ONLY' | 'SOURCE_EXPLORATION' | 'HYBRID';
export type AskAnswerRunState =
  | 'QUEUED'
  | 'RUNNING'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'OUTCOME_UNKNOWN';
export type AskCapability =
  | 'SUBMIT_QUESTION'
  | 'CANCEL'
  | 'RETRY_SAME_CONTEXT'
  | 'RETRY_CURRENT_POLICY'
  | 'EXPORT'
  | 'CREATE_INTAKE_DRAFT'
  | 'CREATE_DRAFT_CHANGE_SET'
  | 'PROPOSE_DIRECTIVE';

export type AskSourceSelectionView = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
};
export type AskCitationView = AskSourceSelectionView & {
  readonly citationId: string;
  readonly evidenceId: string;
  readonly exactQuote?: string;
};
export type AskAnswerRunSnapshot = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly answerRunId: string;
  readonly conversationId: string;
  readonly branchId: string;
  readonly turnId: string;
  readonly projectId: string;
  readonly mode: AskMode;
  readonly state: AskAnswerRunState;
  readonly question: string;
  readonly statements: readonly {
    readonly statementId: string;
    readonly text: string;
    readonly citations: readonly AskCitationView[];
  }[];
  readonly sourceSelections: readonly AskSourceSelectionView[];
  readonly capabilities: readonly AskCapability[];
  readonly answerRevision: string;
  readonly conversationRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stale: boolean;
};
export type AskConversationView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly activeBranchId: string;
  readonly branches: readonly {
    readonly branchId: string;
    readonly label: string;
    readonly turns: readonly {
      readonly turnId: string;
      readonly ordinal: number;
      readonly userMessage: string;
      readonly createdAt: string;
      readonly answerRun: AskAnswerRunSnapshot;
    }[];
  }[];
  readonly conversationRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};
export type AskWorkspaceView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly defaultAskMode: AskMode;
  readonly availableAskModes: readonly AskMode[];
  readonly conversations: readonly {
    readonly conversationId: string;
    readonly projectId: string;
    readonly title: string;
    readonly activeBranchId: string;
    readonly turnCount: number;
    readonly latestRunState: AskAnswerRunState;
    readonly updatedAt: string;
  }[];
  readonly selectedConversation?: AskConversationView;
  readonly capabilities: readonly AskCapability[];
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
};
export type SubmitAskQuestionRequest = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly conversationId?: string;
  readonly branchId?: string;
  readonly question: string;
  readonly mode?: AskMode;
  readonly sourceSelections: readonly AskSourceSelectionView[];
};
export type AskQuestionSubmissionView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly answerRun: AskAnswerRunSnapshot;
  readonly workspace: AskWorkspaceView;
};

const fail = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};
const object = (value: unknown, path: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${path} must be an object.`);
const text = (value: unknown, path: string): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : fail(`${path} is invalid.`);
const askMode = (value: unknown, path: string): AskMode =>
  ['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'].includes(String(value))
    ? (value as AskMode)
    : fail(`${path} is unsupported.`);
const schema = (value: Record<string, unknown>, path: string): void => {
  if (value.schemaVersion !== ASK_SCHEMA_VERSION) fail(`${path}.schemaVersion is unsupported.`);
};

export const decodeSubmitAskQuestionRequest = (value: unknown): SubmitAskQuestionRequest => {
  const input = object(value, 'request');
  schema(input, 'request');
  const allowed = new Set([
    'schemaVersion',
    'clientRequestId',
    'idempotencyKey',
    'conversationId',
    'branchId',
    'question',
    'mode',
    'sourceSelections',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail('request contains authority fields.');
  if (!Array.isArray(input.sourceSelections) || input.sourceSelections.length > 50) {
    fail('request.sourceSelections is invalid.');
  }
  const sourceSelections = input.sourceSelections.map((item, index) => {
    const selection = object(item, `request.sourceSelections[${index}]`);
    if (!Array.isArray(selection.evidenceIds)) fail('selection.evidenceIds is invalid.');
    return {
      sourceId: text(selection.sourceId, 'selection.sourceId'),
      sourceVersionId: text(selection.sourceVersionId, 'selection.sourceVersionId'),
      evidenceIds: selection.evidenceIds.map((id) => text(id, 'selection.evidenceId')),
    };
  });
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    clientRequestId: text(input.clientRequestId, 'request.clientRequestId'),
    idempotencyKey: text(input.idempotencyKey, 'request.idempotencyKey'),
    ...(input.conversationId === undefined
      ? {}
      : { conversationId: text(input.conversationId, 'request.conversationId') }),
    ...(input.branchId === undefined ? {} : { branchId: text(input.branchId, 'request.branchId') }),
    question: text(input.question, 'request.question'),
    ...(input.mode === undefined ? {} : { mode: askMode(input.mode, 'request.mode') }),
    sourceSelections,
  };
};

export const decodeAskWorkspaceView = (value: unknown): AskWorkspaceView => {
  const input = object(value, 'workspace');
  schema(input, 'workspace');
  return value as AskWorkspaceView;
};
export const decodeAskAnswerRunSnapshot = (value: unknown): AskAnswerRunSnapshot => {
  const input = object(value, 'answerRun');
  schema(input, 'answerRun');
  return value as AskAnswerRunSnapshot;
};
export const decodeAskQuestionSubmissionView = (value: unknown): AskQuestionSubmissionView => {
  const input = object(value, 'submission');
  schema(input, 'submission');
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    answerRun: decodeAskAnswerRunSnapshot(input.answerRun),
    workspace: decodeAskWorkspaceView(input.workspace),
  };
};
