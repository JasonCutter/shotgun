import { FrontendContractError } from './frontend-foundation.js';
import {
  ASK_SCHEMA_VERSION,
  type AskAnswerRunSnapshot,
  type AskAnswerRunState,
  type AskCitationView,
} from './frontend-ask.js';
import { decodeAskCitationView } from './frontend-ask.js';

export type AskAnswerRunEventKind = 'STATE' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type AskAnswerRunEventView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly eventId: string;
  readonly answerRunId: string;
  readonly attemptId?: string;
  readonly projectId: string;
  readonly ordinal: number;
  readonly kind: AskAnswerRunEventKind;
  readonly state: AskAnswerRunState;
  readonly partialText?: string;
  readonly answerRevision: string;
  readonly createdAt: string;
};

export type AskAnswerRunEventsView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly answerRunId: string;
  readonly events: readonly AskAnswerRunEventView[];
};

export type AskAnswerRunRetryMode = 'SAME_CONTEXT' | 'CURRENT_POLICY';
export type AskAnswerExportFormat = 'MARKDOWN' | 'JSON';
export type AskAnswerFeedbackKind = 'HELPFUL' | 'NOT_HELPFUL' | 'REPORT_ISSUE';
export type AskTransitionSeedKind = 'INTAKE_DRAFT' | 'DRAFT_CHANGE_SET' | 'USER_DIRECTIVE';

export type AskAnswerRunCommandIdentity = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

export type AskAnswerRunRetryRequest = AskAnswerRunCommandIdentity & {
  readonly mode: AskAnswerRunRetryMode;
};

export type AskAnswerRunExportRequest = AskAnswerRunCommandIdentity & {
  readonly format: AskAnswerExportFormat;
};

export type AskAnswerRunFeedbackRequest = AskAnswerRunCommandIdentity & {
  readonly kind: AskAnswerFeedbackKind;
  readonly comment?: string;
};

export type AskAnswerRunTransitionSeedRequest = AskAnswerRunCommandIdentity & {
  readonly kind: AskTransitionSeedKind;
};

export type AskAnswerRunExportView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly exportId: string;
  readonly answerRunId: string;
  readonly projectId: string;
  readonly format: AskAnswerExportFormat;
  readonly content: string;
  readonly createdAt: string;
};

export type AskAnswerRunFeedbackView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly feedbackId: string;
  readonly answerRunId: string;
  readonly projectId: string;
  readonly kind: AskAnswerFeedbackKind;
  readonly comment?: string;
  readonly createdAt: string;
};

export type AskTransitionSeedPayload = {
  readonly question: string;
  readonly answer: string;
  readonly citations: readonly AskCitationView[];
};

export type AskTransitionSeedView = {
  readonly schemaVersion: typeof ASK_SCHEMA_VERSION;
  readonly seedId: string;
  readonly answerRunId: string;
  readonly projectId: string;
  readonly kind: AskTransitionSeedKind;
  readonly state: 'PROPOSED';
  readonly payload: AskTransitionSeedPayload;
  readonly createdAt: string;
};

const fail = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
};

const strict = (
  value: unknown,
  allowed: readonly string[],
  path: string,
): Record<string, unknown> => {
  const input = record(value, path);
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) fail(`${path} contains unknown field '${key}'.`);
  }
  return input;
};

const stringValue = (value: unknown, path: string, max = 10000): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    fail(`${path} must be a non-empty string of at most ${max} characters.`);
  }
  return value as string;
};

const id = (value: unknown, path: string): string => stringValue(value, path, 256);
const timestamp = (value: unknown, path: string): string => {
  const result = stringValue(value, path, 100);
  if (Number.isNaN(Date.parse(result))) fail(`${path} must be an ISO timestamp.`);
  return result;
};
const integer = (value: unknown, path: string, min = 0): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail(`${path} must be an integer >= ${min}.`);
  }
  return value as number;
};
const schema = (value: Record<string, unknown>, path: string): void => {
  if (value.schemaVersion !== ASK_SCHEMA_VERSION) fail(`${path}.schemaVersion is unsupported.`);
};

const eventKind = (value: unknown, path: string): AskAnswerRunEventKind => {
  const valid: readonly AskAnswerRunEventKind[] = [
    'STATE',
    'PARTIAL',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ];
  if (!valid.includes(value as AskAnswerRunEventKind)) fail(`${path} is unsupported.`);
  return value as AskAnswerRunEventKind;
};

const state = (value: unknown, path: string): AskAnswerRunState => {
  const valid: readonly AskAnswerRunState[] = [
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
  if (!valid.includes(value as AskAnswerRunState)) fail(`${path} is unsupported.`);
  return value as AskAnswerRunState;
};

export const decodeAskAnswerRunEventView = (
  value: unknown,
  path = 'event',
): AskAnswerRunEventView => {
  const input = strict(
    value,
    [
      'schemaVersion',
      'eventId',
      'answerRunId',
      'attemptId',
      'projectId',
      'ordinal',
      'kind',
      'state',
      'partialText',
      'answerRevision',
      'createdAt',
    ],
    path,
  );
  schema(input, path);
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    eventId: id(input.eventId, `${path}.eventId`),
    answerRunId: id(input.answerRunId, `${path}.answerRunId`),
    ...(input.attemptId === undefined
      ? {}
      : { attemptId: id(input.attemptId, `${path}.attemptId`) }),
    projectId: id(input.projectId, `${path}.projectId`),
    ordinal: integer(input.ordinal, `${path}.ordinal`, 0),
    kind: eventKind(input.kind, `${path}.kind`),
    state: state(input.state, `${path}.state`),
    ...(input.partialText === undefined
      ? {}
      : { partialText: stringValue(input.partialText, `${path}.partialText`, 20000) }),
    answerRevision: id(input.answerRevision, `${path}.answerRevision`),
    createdAt: timestamp(input.createdAt, `${path}.createdAt`),
  };
};

export const decodeAskAnswerRunEventsView = (value: unknown): AskAnswerRunEventsView => {
  const input = strict(value, ['schemaVersion', 'answerRunId', 'events'], 'events');
  schema(input, 'events');
  if (!Array.isArray(input.events) || input.events.length > 2000) fail('events.events is invalid.');
  const events = (input.events as readonly unknown[]).map((event: unknown, index: number) =>
    decodeAskAnswerRunEventView(event, `events.events[${index}]`),
  );
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    answerRunId: id(input.answerRunId, 'events.answerRunId'),
    events,
  };
};

const commandIdentity = (value: unknown, path: string): AskAnswerRunCommandIdentity => {
  const input = strict(value, ['schemaVersion', 'clientRequestId', 'idempotencyKey'], path);
  schema(input, path);
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    clientRequestId: id(input.clientRequestId, `${path}.clientRequestId`),
    idempotencyKey: id(input.idempotencyKey, `${path}.idempotencyKey`),
  };
};

export const decodeAskAnswerRunCommandIdentity = (value: unknown): AskAnswerRunCommandIdentity =>
  commandIdentity(value, 'command');

export const decodeAskAnswerRunRetryRequest = (value: unknown): AskAnswerRunRetryRequest => {
  const input = strict(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'mode'],
    'retry',
  );
  const identity = commandIdentity(
    {
      schemaVersion: input.schemaVersion,
      clientRequestId: input.clientRequestId,
      idempotencyKey: input.idempotencyKey,
    },
    'retry',
  );
  if (input.mode !== 'SAME_CONTEXT' && input.mode !== 'CURRENT_POLICY')
    fail('retry.mode is unsupported.');
  return { ...identity, mode: input.mode as AskAnswerRunRetryMode };
};

export const decodeAskAnswerRunExportRequest = (value: unknown): AskAnswerRunExportRequest => {
  const input = strict(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'format'],
    'export',
  );
  const identity = commandIdentity(
    {
      schemaVersion: input.schemaVersion,
      clientRequestId: input.clientRequestId,
      idempotencyKey: input.idempotencyKey,
    },
    'export',
  );
  if (input.format !== 'MARKDOWN' && input.format !== 'JSON') fail('export.format is unsupported.');
  return { ...identity, format: input.format as AskAnswerExportFormat };
};

export const decodeAskAnswerRunFeedbackRequest = (value: unknown): AskAnswerRunFeedbackRequest => {
  const input = strict(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'kind', 'comment'],
    'feedback',
  );
  const identity = commandIdentity(
    {
      schemaVersion: input.schemaVersion,
      clientRequestId: input.clientRequestId,
      idempotencyKey: input.idempotencyKey,
    },
    'feedback',
  );
  if (!['HELPFUL', 'NOT_HELPFUL', 'REPORT_ISSUE'].includes(input.kind as string)) {
    fail('feedback.kind is unsupported.');
  }
  return {
    ...identity,
    kind: input.kind as AskAnswerRunFeedbackRequest['kind'],
    ...(input.comment === undefined
      ? {}
      : { comment: stringValue(input.comment, 'feedback.comment', 2000) }),
  };
};

export const decodeAskAnswerRunTransitionSeedRequest = (
  value: unknown,
): AskAnswerRunTransitionSeedRequest => {
  const input = strict(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'kind'],
    'transitionSeed',
  );
  const identity = commandIdentity(
    {
      schemaVersion: input.schemaVersion,
      clientRequestId: input.clientRequestId,
      idempotencyKey: input.idempotencyKey,
    },
    'transitionSeed',
  );
  if (!['INTAKE_DRAFT', 'DRAFT_CHANGE_SET', 'USER_DIRECTIVE'].includes(input.kind as string)) {
    fail('transitionSeed.kind is unsupported.');
  }
  return { ...identity, kind: input.kind as AskTransitionSeedKind };
};

export const decodeAskAnswerRunExportView = (value: unknown): AskAnswerRunExportView => {
  const input = strict(
    value,
    ['schemaVersion', 'exportId', 'answerRunId', 'projectId', 'format', 'content', 'createdAt'],
    'exportView',
  );
  schema(input, 'exportView');
  if (input.format !== 'MARKDOWN' && input.format !== 'JSON')
    fail('exportView.format is unsupported.');
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    exportId: id(input.exportId, 'exportView.exportId'),
    answerRunId: id(input.answerRunId, 'exportView.answerRunId'),
    projectId: id(input.projectId, 'exportView.projectId'),
    format: input.format as AskAnswerExportFormat,
    content: stringValue(input.content, 'exportView.content', 1000000),
    createdAt: timestamp(input.createdAt, 'exportView.createdAt'),
  };
};

export const decodeAskAnswerRunFeedbackView = (value: unknown): AskAnswerRunFeedbackView => {
  const input = strict(
    value,
    ['schemaVersion', 'feedbackId', 'answerRunId', 'projectId', 'kind', 'comment', 'createdAt'],
    'feedbackView',
  );
  schema(input, 'feedbackView');
  if (!['HELPFUL', 'NOT_HELPFUL', 'REPORT_ISSUE'].includes(input.kind as string)) {
    fail('feedbackView.kind is unsupported.');
  }
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    feedbackId: id(input.feedbackId, 'feedbackView.feedbackId'),
    answerRunId: id(input.answerRunId, 'feedbackView.answerRunId'),
    projectId: id(input.projectId, 'feedbackView.projectId'),
    kind: input.kind as AskAnswerRunFeedbackRequest['kind'],
    ...(input.comment === undefined
      ? {}
      : { comment: stringValue(input.comment, 'feedbackView.comment', 2000) }),
    createdAt: timestamp(input.createdAt, 'feedbackView.createdAt'),
  };
};

export const decodeAskTransitionSeedView = (value: unknown): AskTransitionSeedView => {
  const input = strict(
    value,
    [
      'schemaVersion',
      'seedId',
      'answerRunId',
      'projectId',
      'kind',
      'state',
      'payload',
      'createdAt',
    ],
    'transitionSeedView',
  );
  schema(input, 'transitionSeedView');
  if (!['INTAKE_DRAFT', 'DRAFT_CHANGE_SET', 'USER_DIRECTIVE'].includes(input.kind as string)) {
    fail('transitionSeedView.kind is unsupported.');
  }
  if (input.state !== 'PROPOSED') fail('transitionSeedView.state is unsupported.');
  const payload = strict(
    input.payload,
    ['question', 'answer', 'citations'],
    'transitionSeedView.payload',
  );
  if (!Array.isArray(payload.citations) || payload.citations.length > 500) {
    fail('transitionSeedView.payload.citations is invalid.');
  }
  const citations = payload.citations as readonly unknown[];
  return {
    schemaVersion: ASK_SCHEMA_VERSION,
    seedId: id(input.seedId, 'transitionSeedView.seedId'),
    answerRunId: id(input.answerRunId, 'transitionSeedView.answerRunId'),
    projectId: id(input.projectId, 'transitionSeedView.projectId'),
    kind: input.kind as AskTransitionSeedKind,
    state: 'PROPOSED',
    payload: {
      question: stringValue(payload.question, 'transitionSeedView.payload.question'),
      answer: stringValue(payload.answer, 'transitionSeedView.payload.answer', 20000),
      citations: citations.map((citation: unknown, index: number) =>
        decodeAskCitationView(citation, `transitionSeedView.payload.citations[${index}]`),
      ),
    },
    createdAt: timestamp(input.createdAt, 'transitionSeedView.createdAt'),
  };
};

export type AskAnswerExecutionResult = {
  readonly answerRun: AskAnswerRunSnapshot;
};
