import Ajv, { type AnySchemaObject } from 'ajv';

import askCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/ask-canonical-knowledge.v1.schema.json';
import knowledgeCandidateSchema from '../../../packages/contracts/schemas/knowledge-candidate.v1.schema.json';
import searchCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import submitIntakeSchema from '../../../packages/contracts/schemas/submit-intake.v1.schema.json';
import { ShotgunError, type EntityCandidate } from '../../../packages/kernel/src/index.js';
import type { SubmitIntakePayload } from '../../../modules/intake/src/index.js';

export type SearchRequest = { readonly query: string; readonly limit?: number };
export type AskRequest = { readonly question: string; readonly limit?: number };

export type LoginRequest = {
  readonly accountId: string;
  readonly password: string;
  readonly projectId: string;
};

export type ActionApprovalRequest = { readonly expectedPreviewDigest: string };

export type EntityVaultStageRequest = {
  readonly importId: string;
  readonly sourceVersionId: string;
  readonly entities: readonly EntityCandidate[];
};

export type EntityVaultReviewRequest = {
  readonly importId: string;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'REJECT';
};

type PlainObject = Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, strict: true });

const compile = (schema: unknown) => ajv.compile(schema as AnySchemaObject);

const submitIntakeValidator = compile(submitIntakeSchema);
const searchValidator = compile(searchCanonicalKnowledgeSchema);
const askValidator = compile(askCanonicalKnowledgeSchema);

const candidateSchema = knowledgeCandidateSchema as unknown as {
  readonly $defs: Record<string, unknown>;
  readonly oneOf: readonly unknown[];
};

const entityVaultStageValidator = compile({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $defs: candidateSchema.$defs,
  type: 'object',
  additionalProperties: false,
  required: ['importId', 'sourceVersionId', 'entities'],
  properties: {
    importId: { type: 'string', minLength: 1 },
    sourceVersionId: { type: 'string', minLength: 1 },
    entities: { type: 'array', minItems: 1, items: { oneOf: candidateSchema.oneOf } },
  },
});

const entityVaultReviewValidator = compile({
  type: 'object',
  additionalProperties: false,
  required: ['importId', 'expectedContentDigest', 'decision'],
  properties: {
    importId: { type: 'string', minLength: 1 },
    expectedContentDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    decision: { enum: ['APPROVE', 'REJECT'] },
  },
});

const isPlainObject = (value: unknown): value is PlainObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const validationError = (operation: string, safeMessage: string): never => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage,
    module: 'shotgun-app',
    operation,
  });
};

const requireObject = (body: unknown, operation: string, label: string): PlainObject =>
  isPlainObject(body) ? body : validationError(operation, `${label} body must be a JSON object.`);

const requireExactKeys = (
  input: PlainObject,
  required: readonly string[],
  operation: string,
  label: string,
): void => {
  const allowed = new Set(required);
  if (
    Object.keys(input).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(input, key) || input[key] === undefined)
  ) {
    validationError(operation, `${label} body contains missing or unknown fields.`);
  }
};

const rejectUnknownOwnKeys = (
  input: PlainObject,
  allowed: readonly string[],
  operation: string,
  label: string,
): void => {
  const allowedKeys = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    validationError(operation, `${label} body contains unknown fields.`);
  }
};

const decodeSchema = <T>(
  body: unknown,
  validator: ReturnType<typeof compile>,
  operation: string,
  label: string,
): T => {
  const input = requireObject(body, operation, label);
  let valid = false;
  try {
    valid = validator(input) as boolean;
  } catch {
    valid = false;
  }
  if (!valid) validationError(operation, `${label} body does not match its contract.`);
  return input as T;
};

const requiredNonEmptyString = (
  input: PlainObject,
  key: string,
  operation: string,
  label: string,
): string => {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    validationError(operation, `${label}.${key} must be a non-empty string.`);
  }
  return value as string;
};

export const decodeLoginBody = (body: unknown): LoginRequest => {
  const operation = 'decode-login-body';
  const input = requireObject(body, operation, 'Login');
  requireExactKeys(input, ['accountId', 'password', 'projectId'], operation, 'Login');
  return {
    accountId: requiredNonEmptyString(input, 'accountId', operation, 'Login'),
    // Password is deliberately passed through byte-for-byte; authentication owns its semantics.
    password: requiredNonEmptyString(input, 'password', operation, 'Login'),
    projectId: requiredNonEmptyString(input, 'projectId', operation, 'Login'),
  };
};

export const decodeIntakeBody = (body: unknown): SubmitIntakePayload => {
  const input = decodeSchema<SubmitIntakePayload>(
    body,
    submitIntakeValidator,
    'decode-intake-body',
    'Intake',
  );
  rejectUnknownOwnKeys(
    input,
    ['submissionId', 'sourceId', 'input'],
    'decode-intake-body',
    'Intake',
  );
  const nested = input.input;
  return {
    submissionId: input.submissionId,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    input:
      nested.kind === 'direct_text'
        ? { kind: nested.kind, text: nested.text }
        : {
            kind: nested.kind,
            fileName: nested.fileName,
            mediaType: nested.mediaType,
            contentBase64: nested.contentBase64,
          },
  };
};

export const decodeSearchBody = (body: unknown): SearchRequest => {
  const input = decodeSchema<SearchRequest>(body, searchValidator, 'decode-search-body', 'Search');
  rejectUnknownOwnKeys(input, ['query', 'limit'], 'decode-search-body', 'Search');
  return {
    query: input.query,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
};

export const decodeAskBody = (body: unknown): AskRequest => {
  const input = decodeSchema<AskRequest>(body, askValidator, 'decode-ask-body', 'Ask');
  rejectUnknownOwnKeys(input, ['question', 'limit'], 'decode-ask-body', 'Ask');
  return {
    question: input.question,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
};

export const decodeActionApprovalBody = (body: unknown): ActionApprovalRequest => {
  const operation = 'decode-action-approval-body';
  const input = requireObject(body, operation, 'Action approval');
  requireExactKeys(input, ['expectedPreviewDigest'], operation, 'Action approval');
  const expectedPreviewDigest = requiredNonEmptyString(
    input,
    'expectedPreviewDigest',
    operation,
    'Action approval',
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedPreviewDigest)) {
    validationError(operation, 'Action approval expectedPreviewDigest is invalid.');
  }
  return { expectedPreviewDigest };
};

export const decodeEntityVaultStageBody = (body: unknown): EntityVaultStageRequest => {
  const input = decodeSchema<EntityVaultStageRequest>(
    body,
    entityVaultStageValidator,
    'decode-entity-vault-stage-body',
    'Entity Vault stage',
  );
  rejectUnknownOwnKeys(
    input,
    ['importId', 'sourceVersionId', 'entities'],
    'decode-entity-vault-stage-body',
    'Entity Vault stage',
  );
  if (input.entities.some((candidate) => candidate.candidateType !== 'ENTITY')) {
    validationError(
      'decode-entity-vault-stage-body',
      'Entity Vault stage accepts Entity Candidates only.',
    );
  }
  return {
    importId: input.importId,
    sourceVersionId: input.sourceVersionId,
    entities: [...input.entities],
  };
};

export const decodeEntityVaultReviewBody = (body: unknown): EntityVaultReviewRequest => {
  const input = decodeSchema<EntityVaultReviewRequest>(
    body,
    entityVaultReviewValidator,
    'decode-entity-vault-review-body',
    'Entity Vault review',
  );
  return {
    importId: input.importId,
    expectedContentDigest: input.expectedContentDigest,
    decision: input.decision,
  };
};
