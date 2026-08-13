import {
  FrontendContractError,
  type FrontendCommandRequest,
  validateFrontendCommandRequest,
} from './frontend-foundation.js';
import {
  SOURCES_FRONTEND_COMMAND_TYPES,
  SOURCES_SCHEMA_VERSION,
  type SourcesFrontendCommandType,
  type SourcesSensitivity,
} from './frontend-sources.js';

export type SourcesStagingInputKind = 'DIRECT_TEXT' | 'FILE' | 'URL';

export type SourcesStagingReceipt = {
  readonly schemaVersion: typeof SOURCES_SCHEMA_VERSION;
  readonly draftId: string;
  readonly itemId: string;
  readonly kind: SourcesStagingInputKind;
  readonly label: string;
  readonly stagingReference: string;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly fileName?: string;
  readonly redactedRequestedUrl?: string;
  readonly expiresAt: string;
};

type SourceClassificationRequest = {
  /** Browser request only; the Server resolves the effective Resource classification. */
  readonly requestedClassification?: SourcesSensitivity;
};

export type StagedSourcesIntakeInput = SourceClassificationRequest &
  (
    | {
        readonly itemId: string;
        readonly kind: 'DIRECT_TEXT';
        readonly label: string;
        readonly stagingReference: string;
      }
    | {
        readonly itemId: string;
        readonly kind: 'FILE';
        readonly label: string;
        readonly fileName: string;
        readonly mediaType: 'text/plain' | 'text/markdown';
        readonly stagingReference: string;
      }
    | {
        readonly itemId: string;
        readonly kind: 'URL';
        readonly label: string;
        readonly stagingReference: string;
      }
  );

export type SubmitStagedSourcesIntakeCommandPayload = {
  readonly draftId: string;
  readonly inputs: readonly StagedSourcesIntakeInput[];
};

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be a plain object.`);
  }
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown, path: string, maximum = 16_384): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path} must be a non-empty string no longer than ${maximum} characters.`,
    );
  }
  return value;
};

const onlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path} contains unsupported fields: ${unexpected.join(', ')}.`,
    );
  }
};

const requestedClassification = (value: unknown, path: string): SourcesSensitivity | undefined => {
  if (value === undefined) return undefined;
  if (value === 'public' || value === 'internal' || value === 'private' || value === 'restricted') {
    return value;
  }
  throw new FrontendContractError('INVALID_REQUEST', `${path} is unsupported.`);
};

const stagingReference = (value: unknown, path: string): string => {
  const decoded = stringValue(value, path, 32_768);
  if (!decoded.startsWith('sources-stage-v1.')) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path} is not a Sources staging reference.`,
    );
  }
  return decoded;
};

export const decodeSubmitStagedSourcesIntakePayload = (
  input: unknown,
): SubmitStagedSourcesIntakeCommandPayload => {
  const value = record(input, 'sources.intake.submit.v1.payload');
  onlyKeys(value, ['draftId', 'inputs'], 'sources.intake.submit.v1.payload');
  if (
    !Array.isArray(value['inputs']) ||
    value['inputs'].length === 0 ||
    value['inputs'].length > 50
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'payload.inputs must contain between 1 and 50 staged items.',
    );
  }
  const inputs = value['inputs'].map((entry, index): StagedSourcesIntakeInput => {
    const path = `payload.inputs[${index}]`;
    const item = record(entry, path);
    const classification = requestedClassification(
      item['requestedClassification'],
      `${path}.requestedClassification`,
    );
    const common = {
      itemId: stringValue(item['itemId'], `${path}.itemId`, 200),
      label: stringValue(item['label'], `${path}.label`, 500),
      stagingReference: stagingReference(item['stagingReference'], `${path}.stagingReference`),
      ...(classification === undefined ? {} : { requestedClassification: classification }),
    };
    if (item['kind'] === 'DIRECT_TEXT') {
      onlyKeys(
        item,
        ['itemId', 'kind', 'label', 'stagingReference', 'requestedClassification'],
        path,
      );
      return { kind: 'DIRECT_TEXT', ...common };
    }
    if (item['kind'] === 'FILE') {
      onlyKeys(
        item,
        [
          'itemId',
          'kind',
          'label',
          'fileName',
          'mediaType',
          'stagingReference',
          'requestedClassification',
        ],
        path,
      );
      const mediaType = item['mediaType'];
      if (mediaType !== 'text/plain' && mediaType !== 'text/markdown') {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `${path}.mediaType must be text/plain or text/markdown.`,
        );
      }
      return {
        kind: 'FILE',
        ...common,
        fileName: stringValue(item['fileName'], `${path}.fileName`, 255),
        mediaType,
      };
    }
    if (item['kind'] === 'URL') {
      onlyKeys(
        item,
        ['itemId', 'kind', 'label', 'stagingReference', 'requestedClassification'],
        path,
      );
      return { kind: 'URL', ...common };
    }
    throw new FrontendContractError('INVALID_REQUEST', `${path}.kind is unsupported.`);
  });
  if (new Set(inputs.map((item) => item.itemId)).size !== inputs.length) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'payload.inputs itemId values must be unique.',
    );
  }
  return {
    draftId: stringValue(value['draftId'], 'payload.draftId', 512),
    inputs,
  };
};

export const validateStagedSourcesFrontendCommandRequest = (
  input: unknown,
  expectedCommandType: SourcesFrontendCommandType = SOURCES_FRONTEND_COMMAND_TYPES.submit,
): FrontendCommandRequest<SubmitStagedSourcesIntakeCommandPayload> => {
  if (expectedCommandType !== SOURCES_FRONTEND_COMMAND_TYPES.submit) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'The staged Sources validator is only valid for the submit command.',
    );
  }
  const request = validateFrontendCommandRequest(input, { isNewResource: true });
  if (request.commandType !== expectedCommandType) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Route requires commandType '${expectedCommandType}', received '${request.commandType}'.`,
    );
  }
  if (request.commandSchemaVersion !== SOURCES_SCHEMA_VERSION) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Unsupported commandSchemaVersion '${request.commandSchemaVersion}'.`,
    );
  }
  return {
    ...request,
    payload: decodeSubmitStagedSourcesIntakePayload(request.payload),
  } as FrontendCommandRequest<SubmitStagedSourcesIntakeCommandPayload>;
};

export const decodeSourcesStagingReceipt = (input: unknown): SourcesStagingReceipt => {
  const value = record(input, 'SourcesStagingReceipt');
  if (value['schemaVersion'] !== SOURCES_SCHEMA_VERSION) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Unsupported Sources staging receipt version.',
    );
  }
  const kind = value['kind'];
  if (kind !== 'DIRECT_TEXT' && kind !== 'FILE' && kind !== 'URL') {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Unsupported Sources staging kind.');
  }
  const mediaType = value['mediaType'];
  if (mediaType !== 'text/plain' && mediaType !== 'text/markdown') {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Unsupported Sources staging media type.',
    );
  }
  const sizeBytes = value['sizeBytes'];
  if (!Number.isInteger(sizeBytes) || Number(sizeBytes) <= 0 || Number(sizeBytes) > 1_048_576) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Invalid Sources staging size.');
  }
  const contentHash = stringValue(value['contentHash'], 'SourcesStagingReceipt.contentHash', 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Invalid Sources staging content hash.');
  }
  const expiresAt = stringValue(value['expiresAt'], 'SourcesStagingReceipt.expiresAt', 64);
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Invalid Sources staging expiry.');
  }
  const fileName =
    value['fileName'] === undefined
      ? undefined
      : stringValue(value['fileName'], 'SourcesStagingReceipt.fileName', 255);
  const redactedRequestedUrl =
    value['redactedRequestedUrl'] === undefined
      ? undefined
      : stringValue(
          value['redactedRequestedUrl'],
          'SourcesStagingReceipt.redactedRequestedUrl',
          8192,
        );
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    draftId: stringValue(value['draftId'], 'SourcesStagingReceipt.draftId', 512),
    itemId: stringValue(value['itemId'], 'SourcesStagingReceipt.itemId', 200),
    kind,
    label: stringValue(value['label'], 'SourcesStagingReceipt.label', 500),
    stagingReference: stagingReference(
      value['stagingReference'],
      'SourcesStagingReceipt.stagingReference',
    ),
    mediaType,
    sizeBytes: Number(sizeBytes),
    contentHash,
    ...(fileName === undefined ? {} : { fileName }),
    ...(redactedRequestedUrl === undefined ? {} : { redactedRequestedUrl }),
    expiresAt,
  };
};
