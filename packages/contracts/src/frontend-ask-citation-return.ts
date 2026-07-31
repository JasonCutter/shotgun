import { FrontendContractError } from './frontend-foundation.js';

export const ASK_CITATION_RETURN_SCHEMA_VERSION = '1.0.0' as const;

export type ConversationCitationReturnTarget = {
  readonly schemaVersion: typeof ASK_CITATION_RETURN_SCHEMA_VERSION;
  readonly originRoute: string;
  readonly resourceKind: 'conversation';
  readonly resourceId: string;
  readonly conversationId: string;
  readonly branchId: string;
  readonly turnId: string;
  readonly answerRunId: string;
  readonly answerRevision: string;
  readonly resourceRevision: string;
  readonly citationId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly scrollAnchor: string;
  readonly focusTarget: string;
  readonly panelId?: string;
};

export type AskCitationReturnState = {
  readonly schemaVersion: typeof ASK_CITATION_RETURN_SCHEMA_VERSION;
  readonly resourceKind: 'conversation';
  readonly resourceId: string;
  readonly conversationId: string;
  readonly branchId: string;
  readonly turnId: string;
  readonly answerRunId: string;
  readonly answerRevision: string;
  readonly resourceRevision: string;
  readonly citationId: string;
  readonly scrollAnchor: string;
  readonly focusTarget: string;
  readonly panelId?: string;
};

const fail = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  const object = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${path} contains unknown field '${key}'.`);
  }
  return object;
};

const boundedString = (
  value: unknown,
  path: string,
  maximum = 512,
): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    fail(`${path} must be a non-empty string with at most ${maximum} characters.`);
  }
  return value;
};

const optionalBoundedString = (
  value: unknown,
  path: string,
  maximum = 512,
): string | undefined =>
  value === undefined ? undefined : boundedString(value, path, maximum);

const decodeCommon = (
  object: Record<string, unknown>,
  path: string,
): Omit<AskCitationReturnState, 'panelId'> & { readonly panelId?: string } => {
  if (object.schemaVersion !== ASK_CITATION_RETURN_SCHEMA_VERSION) {
    fail(`${path}.schemaVersion is unsupported.`);
  }
  if (object.resourceKind !== 'conversation') {
    fail(`${path}.resourceKind must be 'conversation'.`);
  }

  const resourceId = boundedString(object.resourceId, `${path}.resourceId`);
  const conversationId = boundedString(object.conversationId, `${path}.conversationId`);
  const citationId = boundedString(object.citationId, `${path}.citationId`);
  const scrollAnchor = boundedString(object.scrollAnchor, `${path}.scrollAnchor`);
  const focusTarget = boundedString(object.focusTarget, `${path}.focusTarget`);
  const panelId = optionalBoundedString(object.panelId, `${path}.panelId`, 128);

  if (resourceId !== conversationId) {
    fail(`${path}.resourceId must match conversationId.`);
  }
  if (scrollAnchor !== citationId || focusTarget !== citationId) {
    fail(`${path}.scrollAnchor and focusTarget must match citationId.`);
  }

  return {
    schemaVersion: ASK_CITATION_RETURN_SCHEMA_VERSION,
    resourceKind: 'conversation',
    resourceId,
    conversationId,
    branchId: boundedString(object.branchId, `${path}.branchId`),
    turnId: boundedString(object.turnId, `${path}.turnId`),
    answerRunId: boundedString(object.answerRunId, `${path}.answerRunId`),
    answerRevision: boundedString(object.answerRevision, `${path}.answerRevision`),
    resourceRevision: boundedString(object.resourceRevision, `${path}.resourceRevision`),
    citationId,
    scrollAnchor,
    focusTarget,
    ...(panelId === undefined ? {} : { panelId }),
  };
};

export const decodeAskCitationReturnState = (input: unknown): AskCitationReturnState => {
  const object = strictObject(
    input,
    [
      'schemaVersion',
      'resourceKind',
      'resourceId',
      'conversationId',
      'branchId',
      'turnId',
      'answerRunId',
      'answerRevision',
      'resourceRevision',
      'citationId',
      'scrollAnchor',
      'focusTarget',
      'panelId',
    ],
    'AskCitationReturnState',
  );
  return decodeCommon(object, 'AskCitationReturnState');
};

export const decodeConversationCitationReturnTarget = (
  input: unknown,
): ConversationCitationReturnTarget => {
  const object = strictObject(
    input,
    [
      'schemaVersion',
      'originRoute',
      'resourceKind',
      'resourceId',
      'conversationId',
      'branchId',
      'turnId',
      'answerRunId',
      'answerRevision',
      'resourceRevision',
      'citationId',
      'sourceId',
      'sourceVersionId',
      'evidenceId',
      'scrollAnchor',
      'focusTarget',
      'panelId',
    ],
    'ConversationCitationReturnTarget',
  );
  const common = decodeCommon(object, 'ConversationCitationReturnTarget');
  const originRoute = boundedString(
    object.originRoute,
    'ConversationCitationReturnTarget.originRoute',
    2048,
  );
  const expectedRoute = `/ask/conversations/${encodeURIComponent(common.conversationId)}`;
  if (originRoute !== expectedRoute) {
    fail('ConversationCitationReturnTarget.originRoute does not match conversationId.');
  }

  return {
    ...common,
    originRoute,
    sourceId: boundedString(object.sourceId, 'ConversationCitationReturnTarget.sourceId'),
    sourceVersionId: boundedString(
      object.sourceVersionId,
      'ConversationCitationReturnTarget.sourceVersionId',
    ),
    evidenceId: boundedString(object.evidenceId, 'ConversationCitationReturnTarget.evidenceId'),
  };
};
