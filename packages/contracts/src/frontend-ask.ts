import { FrontendContractError } from './frontend-foundation.js';

export const ASK_SCHEMA_VERSION = '1.0.0' as const;
export type AskMode = 'CANONICAL_ONLY' | 'SOURCE_EXPLORATION' | 'HYBRID';
export type AskAnswerRunState =
  | 'QUEUED'
  | 'RUNNING'
  | 'STREAMING'
  | 'ACTION_REQUIRED'
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

export type AskCitationView = {
  readonly citationId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly evidenceIds?: readonly string[];
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

export type AskBranchView = {
  readonly branchId: string;
  readonly label: string;
  readonly turns: readonly {
    readonly turnId: string;
    readonly ordinal: number;
    readonly userMessage: string;
    readonly createdAt: string;
    readonly answerRun: AskAnswerRunSnapshot;
  }[];
};

export type AskConversationView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly activeBranchId: string;
  readonly branches: readonly AskBranchView[];
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

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  const obj = object(value, path);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(`${path} contains unknown field '${key}'.`);
    }
  }
  return obj;
};

const text = (value: unknown, path: string, minLen = 1, maxLen = 10000): string => {
  if (typeof value !== 'string') fail(`${path} must be a string.`);
  const val = value as string;
  const trimmed = val.trim();
  if (trimmed.length < minLen || val.length > maxLen) {
    fail(`${path} length out of bounds [${minLen}, ${maxLen}].`);
  }
  return val;
};

const idString = (value: unknown, path: string): string => text(value, path, 1, 256);

const timestamp = (value: unknown, path: string): string => {
  const val = text(value, path, 1, 100);
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (!iso8601Regex.test(val) || isNaN(Date.parse(val))) {
    fail(`${path} is not a valid ISO 8601 timestamp.`);
  }
  return val;
};

const booleanVal = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean.`);
  return value as boolean;
};

const askMode = (value: unknown, path: string): AskMode => {
  const valid: AskMode[] = ['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'];
  if (!valid.includes(value as AskMode)) fail(`${path} is unsupported AskMode.`);
  return value as AskMode;
};

const askAnswerRunState = (value: unknown, path: string): AskAnswerRunState => {
  const valid: AskAnswerRunState[] = [
    'QUEUED',
    'RUNNING',
    'STREAMING',
    'ACTION_REQUIRED',
    'PARTIAL',
    'SUCCEEDED',
    'FAILED',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'OUTCOME_UNKNOWN',
  ];
  if (!valid.includes(value as AskAnswerRunState))
    fail(`${path} is unsupported AskAnswerRunState.`);
  return value as AskAnswerRunState;
};

const askCapability = (value: unknown, path: string): AskCapability => {
  const valid: AskCapability[] = [
    'SUBMIT_QUESTION',
    'CANCEL',
    'RETRY_SAME_CONTEXT',
    'RETRY_CURRENT_POLICY',
    'EXPORT',
    'CREATE_INTAKE_DRAFT',
    'CREATE_DRAFT_CHANGE_SET',
    'PROPOSE_DIRECTIVE',
  ];
  if (!valid.includes(value as AskCapability)) fail(`${path} is unsupported AskCapability.`);
  return value as AskCapability;
};

const schema = (input: Record<string, unknown>, path: string): void => {
  if (input.schemaVersion !== ASK_SCHEMA_VERSION) fail(`${path}.schemaVersion is unsupported.`);
};

const array = <T>(
  value: unknown,
  path: string,
  decoder: (item: unknown, index: number) => T,
  maxLen = 500,
): readonly T[] => {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  const arr = value as readonly unknown[];
  if (arr.length > maxLen) fail(`${path} array size exceeds limit of ${maxLen}.`);
  return arr.map((item: unknown, i: number) => decoder(item, i));
};

export const decodeAskSourceSelectionView = (
  value: unknown,
  path = 'sourceSelection',
): AskSourceSelectionView => {
  const obj = strictObject(value, ['sourceId', 'sourceVersionId', 'evidenceIds'], path);
  return {
    sourceId: idString(obj.sourceId, `${path}.sourceId`),
    sourceVersionId: idString(obj.sourceVersionId, `${path}.sourceVersionId`),
    evidenceIds: array(obj.evidenceIds, `${path}.evidenceIds`, (item, i) =>
      idString(item, `${path}.evidenceIds[${i}]`),
    ),
  };
};

export const decodeAskCitationView = (value: unknown, path = 'citation'): AskCitationView => {
  const obj = strictObject(
    value,
    ['citationId', 'sourceId', 'sourceVersionId', 'evidenceId', 'evidenceIds', 'exactQuote'],
    path,
  );
  const citationId = idString(obj.citationId, `${path}.citationId`);
  const sourceId = idString(obj.sourceId, `${path}.sourceId`);
  const sourceVersionId = idString(obj.sourceVersionId, `${path}.sourceVersionId`);

  let evidenceIds: readonly string[] | undefined;
  if (obj.evidenceIds !== undefined) {
    evidenceIds = array(obj.evidenceIds, `${path}.evidenceIds`, (item, i) =>
      idString(item, `${path}.evidenceIds[${i}]`),
    );
  }

  let evidenceId = '';
  if (obj.evidenceId !== undefined) {
    evidenceId = idString(obj.evidenceId, `${path}.evidenceId`);
  } else if (evidenceIds && evidenceIds.length > 0 && typeof evidenceIds[0] === 'string') {
    evidenceId = evidenceIds[0];
  } else {
    fail(`${path} must contain evidenceId or non-empty evidenceIds.`);
  }

  if (obj.evidenceId !== undefined && evidenceIds && evidenceIds.length > 0) {
    if (evidenceIds[0] !== evidenceId) {
      fail(`${path}.evidenceId '${evidenceId}' does not match evidenceIds[0] '${evidenceIds[0]}'.`);
    }
  }

  const exactQuote =
    obj.exactQuote !== undefined ? text(obj.exactQuote, `${path}.exactQuote`, 0, 10000) : undefined;

  return {
    citationId,
    sourceId,
    sourceVersionId,
    evidenceId,
    ...(evidenceIds ? { evidenceIds } : {}),
    ...(exactQuote !== undefined ? { exactQuote } : {}),
  };
};

export const decodeAskAnswerRunSnapshot = (
  value: unknown,
  path = 'answerRun',
): AskAnswerRunSnapshot => {
  const obj = strictObject(
    value,
    [
      'schemaVersion',
      'answerRunId',
      'conversationId',
      'branchId',
      'turnId',
      'projectId',
      'mode',
      'state',
      'question',
      'statements',
      'sourceSelections',
      'capabilities',
      'answerRevision',
      'conversationRevision',
      'accessRevision',
      'policyContextRevision',
      'createdAt',
      'updatedAt',
      'stale',
    ],
    path,
  );
  schema(obj, path);
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    answerRunId: idString(obj.answerRunId, `${path}.answerRunId`),
    conversationId: idString(obj.conversationId, `${path}.conversationId`),
    branchId: idString(obj.branchId, `${path}.branchId`),
    turnId: idString(obj.turnId, `${path}.turnId`),
    projectId: idString(obj.projectId, `${path}.projectId`),
    mode: askMode(obj.mode, `${path}.mode`),
    state: askAnswerRunState(obj.state, `${path}.state`),
    question: text(obj.question, `${path}.question`, 1, 10000),
    statements: array(obj.statements, `${path}.statements`, (stmt, i) => {
      const stmtObj = strictObject(
        stmt,
        ['statementId', 'text', 'citations'],
        `${path}.statements[${i}]`,
      );
      return {
        statementId: idString(stmtObj.statementId, `${path}.statements[${i}].statementId`),
        text: text(stmtObj.text, `${path}.statements[${i}].text`, 1, 20000),
        citations: array(stmtObj.citations, `${path}.statements[${i}].citations`, (cit, j) =>
          decodeAskCitationView(cit, `${path}.statements[${i}].citations[${j}]`),
        ),
      };
    }),
    sourceSelections: array(obj.sourceSelections, `${path}.sourceSelections`, (sel, i) =>
      decodeAskSourceSelectionView(sel, `${path}.sourceSelections[${i}]`),
    ),
    capabilities: array(obj.capabilities, `${path}.capabilities`, (cap, i) =>
      askCapability(cap, `${path}.capabilities[${i}]`),
    ),
    answerRevision: idString(obj.answerRevision, `${path}.answerRevision`),
    conversationRevision: idString(obj.conversationRevision, `${path}.conversationRevision`),
    accessRevision: idString(obj.accessRevision, `${path}.accessRevision`),
    policyContextRevision: idString(obj.policyContextRevision, `${path}.policyContextRevision`),
    createdAt: timestamp(obj.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(obj.updatedAt, `${path}.updatedAt`),
    stale: booleanVal(obj.stale, `${path}.stale`),
  };
};

export const decodeAskBranchView = (value: unknown, path = 'branch'): AskBranchView => {
  const obj = strictObject(value, ['branchId', 'label', 'turns'], path);
  return {
    branchId: idString(obj.branchId, `${path}.branchId`),
    label: text(obj.label, `${path}.label`, 1, 256),
    turns: array(obj.turns, `${path}.turns`, (turn, i) => {
      const turnObj = strictObject(
        turn,
        ['turnId', 'ordinal', 'userMessage', 'createdAt', 'answerRun'],
        `${path}.turns[${i}]`,
      );
      const ordinal =
        typeof turnObj.ordinal === 'number' &&
        Number.isInteger(turnObj.ordinal) &&
        turnObj.ordinal >= 1
          ? turnObj.ordinal
          : fail(`${path}.turns[${i}].ordinal must be a positive integer.`);
      return {
        turnId: idString(turnObj.turnId, `${path}.turns[${i}].turnId`),
        ordinal,
        userMessage: text(turnObj.userMessage, `${path}.turns[${i}].userMessage`, 1, 10000),
        createdAt: timestamp(turnObj.createdAt, `${path}.turns[${i}].createdAt`),
        answerRun: decodeAskAnswerRunSnapshot(turnObj.answerRun, `${path}.turns[${i}].answerRun`),
      };
    }),
  };
};

export const decodeAskConversationView = (
  value: unknown,
  path = 'conversation',
): AskConversationView => {
  const obj = strictObject(
    value,
    [
      'schemaVersion',
      'conversationId',
      'projectId',
      'title',
      'activeBranchId',
      'branches',
      'conversationRevision',
      'createdAt',
      'updatedAt',
    ],
    path,
  );
  schema(obj, path);
  const conversationId = idString(obj.conversationId, `${path}.conversationId`);
  const projectId = idString(obj.projectId, `${path}.projectId`);
  const title = text(obj.title, `${path}.title`, 1, 256);
  const activeBranchId = idString(obj.activeBranchId, `${path}.activeBranchId`);
  const branches = array(obj.branches, `${path}.branches`, (br, i) =>
    decodeAskBranchView(br, `${path}.branches[${i}]`),
  );

  const activeBranchExists = branches.some((b) => b.branchId === activeBranchId);
  if (!activeBranchExists) {
    fail(`${path}.activeBranchId '${activeBranchId}' does not exist in branches.`);
  }

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    if (!branch) continue;
    for (let j = 0; j < branch.turns.length; j++) {
      const turn = branch.turns[j];
      if (!turn) continue;
      if (turn.answerRun.conversationId !== conversationId) {
        fail(
          `${path}.branches[${i}].turns[${j}].answerRun.conversationId must match conversationId.`,
        );
      }
      if (turn.answerRun.branchId !== branch.branchId) {
        fail(`${path}.branches[${i}].turns[${j}].answerRun.branchId must match branch.branchId.`);
      }
      if (turn.answerRun.turnId !== turn.turnId) {
        fail(`${path}.branches[${i}].turns[${j}].answerRun.turnId must match turn.turnId.`);
      }
      if (turn.answerRun.projectId !== projectId) {
        fail(
          `${path}.branches[${i}].turns[${j}].answerRun.projectId must match conversation.projectId.`,
        );
      }
    }
  }

  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    conversationId,
    projectId,
    title,
    activeBranchId,
    branches,
    conversationRevision: idString(obj.conversationRevision, `${path}.conversationRevision`),
    createdAt: timestamp(obj.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(obj.updatedAt, `${path}.updatedAt`),
  };
};

export const decodeAskWorkspaceView = (value: unknown, path = 'workspace'): AskWorkspaceView => {
  const obj = strictObject(
    value,
    [
      'schemaVersion',
      'principalId',
      'sessionId',
      'projectId',
      'defaultAskMode',
      'availableAskModes',
      'conversations',
      'selectedConversation',
      'capabilities',
      'projectionRevision',
      'accessRevision',
      'policyContextRevision',
      'fetchedAt',
      'stale',
    ],
    path,
  );
  schema(obj, path);
  const projectId = idString(obj.projectId, `${path}.projectId`);
  const defaultAskMode = askMode(obj.defaultAskMode, `${path}.defaultAskMode`);
  const availableAskModes = array(obj.availableAskModes, `${path}.availableAskModes`, (mode, i) =>
    askMode(mode, `${path}.availableAskModes[${i}]`),
  );

  if (!availableAskModes.includes(defaultAskMode)) {
    fail(`${path}.defaultAskMode '${defaultAskMode}' is not in availableAskModes.`);
  }

  const selectedConversation =
    obj.selectedConversation !== undefined
      ? decodeAskConversationView(obj.selectedConversation, `${path}.selectedConversation`)
      : undefined;

  if (selectedConversation && selectedConversation.projectId !== projectId) {
    fail(`${path}.selectedConversation.projectId must match workspace.projectId.`);
  }

  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    principalId: idString(obj.principalId, `${path}.principalId`),
    sessionId: idString(obj.sessionId, `${path}.sessionId`),
    projectId,
    defaultAskMode,
    availableAskModes,
    conversations: array(obj.conversations, `${path}.conversations`, (conv, i) => {
      const convObj = strictObject(
        conv,
        [
          'conversationId',
          'projectId',
          'title',
          'activeBranchId',
          'turnCount',
          'latestRunState',
          'updatedAt',
        ],
        `${path}.conversations[${i}]`,
      );
      const turnCount =
        typeof convObj.turnCount === 'number' &&
        Number.isInteger(convObj.turnCount) &&
        convObj.turnCount >= 0
          ? convObj.turnCount
          : fail(`${path}.conversations[${i}].turnCount must be a non-negative integer.`);
      return {
        conversationId: idString(
          convObj.conversationId,
          `${path}.conversations[${i}].conversationId`,
        ),
        projectId: idString(convObj.projectId, `${path}.conversations[${i}].projectId`),
        title: text(convObj.title, `${path}.conversations[${i}].title`, 1, 256),
        activeBranchId: idString(
          convObj.activeBranchId,
          `${path}.conversations[${i}].activeBranchId`,
        ),
        turnCount,
        latestRunState: askAnswerRunState(
          convObj.latestRunState,
          `${path}.conversations[${i}].latestRunState`,
        ),
        updatedAt: timestamp(convObj.updatedAt, `${path}.conversations[${i}].updatedAt`),
      };
    }),
    ...(selectedConversation ? { selectedConversation } : {}),
    capabilities: array(obj.capabilities, `${path}.capabilities`, (cap, i) =>
      askCapability(cap, `${path}.capabilities[${i}]`),
    ),
    projectionRevision: idString(obj.projectionRevision, `${path}.projectionRevision`),
    accessRevision: idString(obj.accessRevision, `${path}.accessRevision`),
    policyContextRevision: idString(obj.policyContextRevision, `${path}.policyContextRevision`),
    fetchedAt: timestamp(obj.fetchedAt, `${path}.fetchedAt`),
    stale: booleanVal(obj.stale, `${path}.stale`),
  };
};

export const decodeSubmitAskQuestionRequest = (value: unknown): SubmitAskQuestionRequest => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'conversationId',
      'branchId',
      'question',
      'mode',
      'sourceSelections',
    ],
    'request',
  );
  schema(input, 'request');
  const sourceSelections = array(input.sourceSelections, 'request.sourceSelections', (sel, i) =>
    decodeAskSourceSelectionView(sel, `request.sourceSelections[${i}]`),
  );
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    clientRequestId: idString(input.clientRequestId, 'request.clientRequestId'),
    idempotencyKey: idString(input.idempotencyKey, 'request.idempotencyKey'),
    ...(input.conversationId === undefined
      ? {}
      : { conversationId: idString(input.conversationId, 'request.conversationId') }),
    ...(input.branchId === undefined
      ? {}
      : { branchId: idString(input.branchId, 'request.branchId') }),
    question: text(input.question, 'request.question', 1, 10000),
    ...(input.mode === undefined ? {} : { mode: askMode(input.mode, 'request.mode') }),
    sourceSelections,
  };
};

export type AskQuestionSubmissionOutcomeView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly outcomeState: 'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandId: string;
  readonly conversationId: string;
  readonly branchId: string;
  readonly turnId: string;
  readonly answerRunId: string;
  readonly answerRun?: AskAnswerRunSnapshot;
  readonly failureCode?: string;
  readonly failureMessage?: string;
};

export const decodeAskQuestionSubmissionView = (value: unknown): AskQuestionSubmissionView => {
  const input = strictObject(value, ['schemaVersion', 'answerRun', 'workspace'], 'submission');
  schema(input, 'submission');
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    answerRun: decodeAskAnswerRunSnapshot(input.answerRun, 'submission.answerRun'),
    workspace: decodeAskWorkspaceView(input.workspace, 'submission.workspace'),
  };
};

export const decodeAskQuestionSubmissionOutcomeView = (
  value: unknown,
): AskQuestionSubmissionOutcomeView => {
  const input = strictObject(
    value,
    [
      'schemaVersion',
      'outcomeState',
      'clientRequestId',
      'idempotencyKey',
      'commandId',
      'conversationId',
      'branchId',
      'turnId',
      'answerRunId',
      'answerRun',
      'failureCode',
      'failureMessage',
    ],
    'outcome',
  );
  schema(input, 'outcome');
  const outcomeStateStr = text(input.outcomeState, 'outcome.outcomeState', 1, 32);
  const validStates = new Set(['ACCEPTED', 'COMPLETED', 'REJECTED', 'OUTCOME_UNKNOWN']);
  if (!validStates.has(outcomeStateStr)) {
    fail(`outcome.outcomeState '${outcomeStateStr}' is invalid.`);
  }
  const outcomeState = outcomeStateStr as AskQuestionSubmissionOutcomeView['outcomeState'];
  const answerRun =
    input.answerRun === undefined
      ? undefined
      : decodeAskAnswerRunSnapshot(input.answerRun, 'outcome.answerRun');
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    outcomeState,
    clientRequestId: idString(input.clientRequestId, 'outcome.clientRequestId'),
    idempotencyKey: idString(input.idempotencyKey, 'outcome.idempotencyKey'),
    commandId: idString(input.commandId, 'outcome.commandId'),
    conversationId: idString(input.conversationId, 'outcome.conversationId'),
    branchId: idString(input.branchId, 'outcome.branchId'),
    turnId: idString(input.turnId, 'outcome.turnId'),
    answerRunId: idString(input.answerRunId, 'outcome.answerRunId'),
    ...(answerRun === undefined ? {} : { answerRun }),
    ...(input.failureCode === undefined
      ? {}
      : { failureCode: idString(input.failureCode, 'outcome.failureCode') }),
    ...(input.failureMessage === undefined
      ? {}
      : { failureMessage: text(input.failureMessage, 'outcome.failureMessage', 1, 1000) }),
  };
};
