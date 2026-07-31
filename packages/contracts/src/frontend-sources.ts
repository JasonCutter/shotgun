import type {
  SourceSelector,
  TextPositionSelector,
  TextQuoteSelector,
} from './document-evidence.js';
import {
  FrontendContractError,
  type FrontendCommandRequest,
  validateFrontendCommandRequest,
} from './frontend-foundation.js';

export const SOURCES_SCHEMA_VERSION = '1.0.0' as const;

export type SourcesSchemaVersion = typeof SOURCES_SCHEMA_VERSION;
export type SourcesSensitivity = 'public' | 'internal' | 'private' | 'restricted';
export type SourcesCapability =
  | 'SUBMIT'
  | 'CANCEL'
  | 'RETRY_SAME_CONTEXT'
  | 'RETRY_CURRENT_POLICY'
  | 'RESOLVE_DUPLICATE'
  | 'PREVIEW'
  | 'DOWNLOAD_ORIGINAL'
  | 'SELECT_FOR_ASK';

export type IntakeValidationCode =
  | 'VALID'
  | 'UNSUPPORTED_FORMAT'
  | 'ENCRYPTED'
  | 'CORRUPT'
  | 'INACCESSIBLE'
  | 'POLICY_BLOCKED'
  | 'TOO_LARGE'
  | 'INVALID_FILENAME'
  | 'INVALID_URL'
  | 'UNSAFE_DESTINATION';

export type IntakeInputManifest =
  | {
      readonly kind: 'DIRECT_TEXT';
      readonly itemId: string;
      readonly label: string;
      readonly mediaType: 'text/plain';
      readonly sizeBytes: number;
      readonly contentHash?: string;
    }
  | {
      readonly kind: 'FILE';
      readonly itemId: string;
      readonly label: string;
      readonly fileName: string;
      readonly mediaType: string;
      readonly sizeBytes: number;
      readonly contentHash?: string;
    }
  | {
      readonly kind: 'URL';
      readonly itemId: string;
      readonly label: string;
      readonly requestedUrl: string;
      readonly mediaType?: string;
      readonly sizeBytes?: number;
      readonly contentHash?: string;
    };

export type IntakeValidationResultView = {
  readonly code: IntakeValidationCode;
  readonly valid: boolean;
  readonly message: string;
  readonly field?: string;
};

export type ProducedSourceReferenceView = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly projectId: string;
  readonly versionNumber: number;
};

export type IntakeItemState =
  | 'VALIDATING'
  | 'QUEUED'
  | 'RUNNING'
  | 'ACTION_REQUIRED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'OUTCOME_INDETERMINATE';

export type IntakeSubmissionItemView = {
  readonly itemId: string;
  readonly manifest: IntakeInputManifest;
  readonly state: IntakeItemState;
  readonly validation: readonly IntakeValidationResultView[];
  readonly progress?: {
    readonly completedUnits: number;
    readonly totalUnits: number;
    readonly unit: 'BYTES' | 'ITEMS' | 'STEPS';
  };
  readonly producedResource?: ProducedSourceReferenceView;
  readonly duplicateDecisionId?: string;
  readonly safeFailure?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly capabilities: readonly SourcesCapability[];
  readonly attentionReason?: string;
};

export type IntakeSubmissionState =
  | 'VALIDATING'
  | 'QUEUED'
  | 'RUNNING'
  | 'PARTIAL'
  | 'ACTION_REQUIRED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'OUTCOME_INDETERMINATE';

export type IntakeSubmissionSnapshot = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly submissionId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly state: IntakeSubmissionState;
  readonly items: readonly IntakeSubmissionItemView[];
  readonly capabilities: readonly SourcesCapability[];
  readonly acceptedPolicyContextId: string;
  readonly submissionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stale: boolean;
};

export type ExactDuplicateDisposition =
  | 'REUSE_EXISTING_VERSION'
  | 'CREATE_VERSION_CANDIDATE'
  | 'CREATE_SEPARATE_SOURCE'
  | 'CANCEL_SUBMISSION';

export type ExactDuplicateDecisionView = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly decisionId: string;
  readonly submissionId: string;
  readonly itemId: string;
  readonly projectId: string;
  readonly contentHash: string;
  readonly existingSource: {
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly label: string;
    readonly versionNumber: number;
  };
  readonly allowedDispositions: readonly ExactDuplicateDisposition[];
  readonly decisionRevision: string;
  readonly sourceRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly createdAt: string;
};

export type AskUsageState =
  | 'NOT_READY'
  | 'SOURCE_VERSION_READY'
  | 'EVIDENCE_READY'
  | 'ACTION_REQUIRED'
  | 'FAILED'
  | 'ACCESS_RESTRICTED';

export type SourceLifecycle = 'ACTIVE' | 'ARCHIVED' | 'ACTION_REQUIRED' | 'FAILED';
export type SourcePreviewReadiness =
  'NOT_READY' | 'PROCESSING' | 'READY' | 'FAILED' | 'ACCESS_RESTRICTED';

export type SourceLibraryItemView = {
  readonly sourceId: string;
  readonly projectId: string;
  readonly label: string;
  readonly mediaType: string;
  readonly lifecycle: SourceLifecycle;
  readonly previewReadiness: SourcePreviewReadiness;
  readonly askUsageState: AskUsageState;
  readonly askUsageExplanation: string;
  readonly selectedSourceVersionId: string;
  readonly versionCount: number;
  readonly attentionReason?: string;
  readonly capabilities: readonly SourcesCapability[];
  readonly sensitivity: SourcesSensitivity;
  readonly updatedAt: string;
};

export type SourceLibraryQuery = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly query?: string;
  readonly filters: {
    readonly mediaTypes?: readonly string[];
    readonly lifecycle?: readonly SourceLifecycle[];
    readonly askUsageStates?: readonly AskUsageState[];
    readonly attentionOnly?: boolean;
  };
  readonly sort: 'UPDATED_DESC' | 'UPDATED_ASC' | 'LABEL_ASC' | 'LABEL_DESC';
  readonly limit: number;
  readonly cursor?: string;
};

export type SourceLibraryPageView = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly items: readonly SourceLibraryItemView[];
  readonly nextCursor?: string;
  readonly queryDigest: string;
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly fetchedAt: string;
  readonly stale: boolean;
};

export type SourceDetailView = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly sourceId: string;
  readonly projectId: string;
  readonly label: string;
  readonly lifecycle: SourceLifecycle;
  readonly mediaType: string;
  readonly sensitivity: SourcesSensitivity;
  readonly currentSourceVersionId: string;
  readonly versionCount: number;
  readonly previewReadiness: SourcePreviewReadiness;
  readonly askUsageState: AskUsageState;
  readonly askUsageExplanation: string;
  readonly capabilities: readonly SourcesCapability[];
  readonly sourceRevision: string;
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SourceVersionHistoryItemView = {
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly contentHash: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly transformationState: 'NOT_STARTED' | 'RUNNING' | 'READY' | 'FAILED';
  readonly evidenceCount: number;
};

export type SourceVersionHistoryView = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly sourceId: string;
  readonly projectId: string;
  readonly selectedSourceVersionId: string;
  readonly versions: readonly SourceVersionHistoryItemView[];
  readonly nextCursor?: string;
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly fetchedAt: string;
};

export type PreviewLocatorView = TextPositionSelector | TextQuoteSelector | SourceSelector;

export type SourcePreviewView = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly projectId: string;
  readonly mediaType: string;
  readonly contentHash: string;
  readonly mode: 'ORIGINAL' | 'TRANSFORMED';
  readonly readiness: SourcePreviewReadiness;
  readonly text?: string;
  readonly locators: readonly PreviewLocatorView[];
  readonly capabilities: readonly SourcesCapability[];
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly fetchedAt: string;
};

export type EvidenceItemView = {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly label: string;
  readonly origin: 'ORIGINAL' | 'TRANSLATION' | 'SUMMARY' | 'ANNOTATION' | 'AI_OUTPUT';
  readonly exactText?: string;
  readonly locators: readonly PreviewLocatorView[];
  readonly createdAt: string;
};

export type EvidenceListView = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly items: readonly EvidenceItemView[];
  readonly nextCursor?: string;
  readonly projectionRevision: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly fetchedAt: string;
};

export type CitationReturnTarget = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly originRoute: string;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly conversationId?: string;
  readonly branchId?: string;
  readonly turnId?: string;
  readonly answerRunId?: string;
  readonly answerRevision?: string;
  readonly resourceRevision: string;
  readonly citationId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly scrollAnchor?: string;
  readonly focusTarget?: string;
  readonly panelId?: string;
};

export type IntakeDraftSeed = {
  readonly schemaVersion: SourcesSchemaVersion;
  readonly seedId: string;
  readonly projectId: string;
  readonly originatingWorkspace: string;
  readonly input:
    | {
        readonly kind: 'DIRECT_TEXT';
        readonly label: string;
        readonly text: string;
      }
    | {
        readonly kind: 'URL';
        readonly label: string;
        readonly requestedUrl: string;
      }
    | {
        readonly kind: 'FILE_METADATA';
        readonly label: string;
        readonly fileName: string;
        readonly mediaType: string;
        readonly sizeBytes: number;
      };
};

export const SOURCES_FRONTEND_COMMAND_TYPES = {
  submit: 'sources.intake.submit.v1',
  cancel: 'sources.intake.cancel.v1',
  retry: 'sources.intake.retry.v1',
  resolveDuplicate: 'sources.duplicate.resolve.v1',
} as const;

export type SourcesFrontendCommandType =
  (typeof SOURCES_FRONTEND_COMMAND_TYPES)[keyof typeof SOURCES_FRONTEND_COMMAND_TYPES];

export type SubmitSourcesIntakeCommandPayload = {
  readonly draftId: string;
  readonly inputs: readonly (
    | {
        readonly itemId: string;
        readonly kind: 'DIRECT_TEXT';
        readonly label: string;
        readonly text: string;
      }
    | {
        readonly itemId: string;
        readonly kind: 'FILE';
        readonly label: string;
        readonly fileName: string;
        readonly mediaType: string;
        readonly contentBase64: string;
      }
    | {
        readonly itemId: string;
        readonly kind: 'URL';
        readonly label: string;
        readonly requestedUrl: string;
      }
  )[];
};

export type CancelSourcesIntakeCommandPayload = {
  readonly submissionId: string;
};

export type RetrySourcesIntakeCommandPayload = {
  readonly submissionId: string;
  readonly itemIds: readonly string[];
  readonly mode: 'SAME_CONTEXT' | 'CURRENT_POLICY';
};

export type ResolveSourcesDuplicateCommandPayload = {
  readonly decisionId: string;
  readonly disposition: ExactDuplicateDisposition;
  readonly targetSourceId?: string;
};

export type SourcesFrontendCommandPayload =
  | SubmitSourcesIntakeCommandPayload
  | CancelSourcesIntakeCommandPayload
  | RetrySourcesIntakeCommandPayload
  | ResolveSourcesDuplicateCommandPayload;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const record = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(`${path} must be a plain object.`);

const stringValue = (value: unknown, path: string): string =>
  typeof value === 'string' && value.trim().length > 0
    ? value
    : fail(`${path} must be a non-empty string.`);

const optionalString = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : stringValue(value, path);

const boundedString = (value: unknown, path: string, maximum: number): string => {
  const decoded = stringValue(value, path);
  return decoded.length <= maximum
    ? decoded
    : fail(`${path} must contain at most ${maximum} characters.`);
};

const optionalBoundedString = (
  value: unknown,
  path: string,
  maximum: number,
): string | undefined => (value === undefined ? undefined : boundedString(value, path, maximum));

const booleanValue = (value: unknown, path: string): boolean =>
  typeof value === 'boolean' ? value : fail(`${path} must be boolean.`);

const integer = (value: unknown, path: string, minimum = 0): number =>
  Number.isInteger(value) && Number(value) >= minimum
    ? Number(value)
    : fail(`${path} must be an integer greater than or equal to ${minimum}.`);

const finiteNumber = (value: unknown, path: string, minimum = 0): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? value
    : fail(`${path} must be a finite number greater than or equal to ${minimum}.`);

const timestamp = (value: unknown, path: string): string => {
  const result = stringValue(value, path);
  return Number.isNaN(Date.parse(result)) ? fail(`${path} must be ISO 8601.`) : result;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T =>
  values.includes(value as T) ? (value as T) : fail(`${path} is unsupported.`);

const boundedArray = (value: unknown, path: string, maximum: number): readonly unknown[] =>
  Array.isArray(value) && value.length <= maximum
    ? value
    : fail(`${path} must be an array with at most ${maximum} items.`);

const optionalBoundedArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] | undefined =>
  value === undefined ? undefined : boundedArray(value, path, maximum);

const schema = (value: Record<string, unknown>, path: string): void => {
  if (value['schemaVersion'] !== SOURCES_SCHEMA_VERSION) {
    fail(`${path}.schemaVersion is unsupported.`);
  }
};

const digest = (value: unknown, path: string): string => {
  const result = stringValue(value, path);
  return /^sha256:[a-f0-9]{64}$/.test(result) ? result : fail(`${path} must be a sha256 digest.`);
};

const capabilities = (value: unknown, path: string): readonly SourcesCapability[] => {
  const allowed = [
    'SUBMIT',
    'CANCEL',
    'RETRY_SAME_CONTEXT',
    'RETRY_CURRENT_POLICY',
    'RESOLVE_DUPLICATE',
    'PREVIEW',
    'DOWNLOAD_ORIGINAL',
    'SELECT_FOR_ASK',
  ] as const;
  const decoded = boundedArray(value, path, allowed.length).map((entry, index) =>
    enumValue(entry, allowed, `${path}[${index}]`),
  );
  return [...new Set(decoded)];
};

const sensitivity = (value: unknown, path: string): SourcesSensitivity =>
  enumValue(value, ['public', 'internal', 'private', 'restricted'], path);

const sourceLifecycle = (value: unknown, path: string): SourceLifecycle =>
  enumValue(value, ['ACTIVE', 'ARCHIVED', 'ACTION_REQUIRED', 'FAILED'], path);

const previewReadiness = (value: unknown, path: string): SourcePreviewReadiness =>
  enumValue(value, ['NOT_READY', 'PROCESSING', 'READY', 'FAILED', 'ACCESS_RESTRICTED'], path);

const askUsageState = (value: unknown, path: string): AskUsageState =>
  enumValue(
    value,
    [
      'NOT_READY',
      'SOURCE_VERSION_READY',
      'EVIDENCE_READY',
      'ACTION_REQUIRED',
      'FAILED',
      'ACCESS_RESTRICTED',
    ],
    path,
  );

const decodeInputManifest = (input: unknown, path: string): IntakeInputManifest => {
  const value = record(input, path);
  const kind = enumValue(value['kind'], ['DIRECT_TEXT', 'FILE', 'URL'], `${path}.kind`);
  const common = {
    itemId: stringValue(value['itemId'], `${path}.itemId`),
    label: stringValue(value['label'], `${path}.label`),
  };
  const contentHash =
    value['contentHash'] === undefined
      ? undefined
      : digest(value['contentHash'], `${path}.contentHash`);
  if (kind === 'DIRECT_TEXT') {
    if (value['mediaType'] !== 'text/plain') fail(`${path}.mediaType must be text/plain.`);
    return {
      kind,
      ...common,
      mediaType: 'text/plain',
      sizeBytes: integer(value['sizeBytes'], `${path}.sizeBytes`, 1),
      ...(contentHash === undefined ? {} : { contentHash }),
    };
  }
  if (kind === 'FILE') {
    return {
      kind,
      ...common,
      fileName: stringValue(value['fileName'], `${path}.fileName`),
      mediaType: stringValue(value['mediaType'], `${path}.mediaType`),
      sizeBytes: integer(value['sizeBytes'], `${path}.sizeBytes`, 1),
      ...(contentHash === undefined ? {} : { contentHash }),
    };
  }
  const mediaType = optionalString(value['mediaType'], `${path}.mediaType`);
  const sizeBytes =
    value['sizeBytes'] === undefined
      ? undefined
      : integer(value['sizeBytes'], `${path}.sizeBytes`, 1);
  const requestedUrl = stringValue(value['requestedUrl'], `${path}.requestedUrl`);
  try {
    const parsed = new URL(requestedUrl);
    if (!['http:', 'https:'].includes(parsed.protocol))
      fail(`${path}.requestedUrl is unsupported.`);
  } catch {
    fail(`${path}.requestedUrl must be an absolute HTTP(S) URL.`);
  }
  return {
    kind,
    ...common,
    requestedUrl,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(contentHash === undefined ? {} : { contentHash }),
  };
};

const decodeValidation = (input: unknown, path: string): IntakeValidationResultView => {
  const value = record(input, path);
  const code = enumValue(
    value['code'],
    [
      'VALID',
      'UNSUPPORTED_FORMAT',
      'ENCRYPTED',
      'CORRUPT',
      'INACCESSIBLE',
      'POLICY_BLOCKED',
      'TOO_LARGE',
      'INVALID_FILENAME',
      'INVALID_URL',
      'UNSAFE_DESTINATION',
    ],
    `${path}.code`,
  );
  const valid = booleanValue(value['valid'], `${path}.valid`);
  if ((code === 'VALID') !== valid) fail(`${path}.code and valid are inconsistent.`);
  const field = optionalString(value['field'], `${path}.field`);
  return {
    code,
    valid,
    message: stringValue(value['message'], `${path}.message`),
    ...(field === undefined ? {} : { field }),
  };
};

const decodeProducedResource = (input: unknown, path: string): ProducedSourceReferenceView => {
  const value = record(input, path);
  return {
    sourceId: stringValue(value['sourceId'], `${path}.sourceId`),
    sourceVersionId: stringValue(value['sourceVersionId'], `${path}.sourceVersionId`),
    projectId: stringValue(value['projectId'], `${path}.projectId`),
    versionNumber: integer(value['versionNumber'], `${path}.versionNumber`, 1),
  };
};

const decodeSubmissionItem = (input: unknown, path: string): IntakeSubmissionItemView => {
  const value = record(input, path);
  const manifest = decodeInputManifest(value['manifest'], `${path}.manifest`);
  const itemId = stringValue(value['itemId'], `${path}.itemId`);
  if (itemId !== manifest.itemId) fail(`${path}.itemId must match manifest.itemId.`);
  const progressValue = value['progress'];
  let progress: IntakeSubmissionItemView['progress'];
  if (progressValue !== undefined) {
    const progressRecord = record(progressValue, `${path}.progress`);
    const completedUnits = finiteNumber(
      progressRecord['completedUnits'],
      `${path}.progress.completedUnits`,
    );
    const totalUnits = finiteNumber(progressRecord['totalUnits'], `${path}.progress.totalUnits`, 1);
    if (completedUnits > totalUnits) fail(`${path}.progress exceeds totalUnits.`);
    progress = {
      completedUnits,
      totalUnits,
      unit: enumValue(progressRecord['unit'], ['BYTES', 'ITEMS', 'STEPS'], `${path}.progress.unit`),
    };
  }
  const producedResource =
    value['producedResource'] === undefined
      ? undefined
      : decodeProducedResource(value['producedResource'], `${path}.producedResource`);
  const failureValue = value['safeFailure'];
  let safeFailure: IntakeSubmissionItemView['safeFailure'];
  if (failureValue !== undefined) {
    const failure = record(failureValue, `${path}.safeFailure`);
    safeFailure = {
      code: stringValue(failure['code'], `${path}.safeFailure.code`),
      message: stringValue(failure['message'], `${path}.safeFailure.message`),
      retryable: booleanValue(failure['retryable'], `${path}.safeFailure.retryable`),
    };
  }
  const duplicateDecisionId = optionalString(
    value['duplicateDecisionId'],
    `${path}.duplicateDecisionId`,
  );
  const attentionReason = optionalString(value['attentionReason'], `${path}.attentionReason`);
  return {
    itemId,
    manifest,
    state: enumValue(
      value['state'],
      [
        'VALIDATING',
        'QUEUED',
        'RUNNING',
        'ACTION_REQUIRED',
        'SUCCEEDED',
        'FAILED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'OUTCOME_INDETERMINATE',
      ],
      `${path}.state`,
    ),
    validation: boundedArray(value['validation'], `${path}.validation`, 20).map((entry, index) =>
      decodeValidation(entry, `${path}.validation[${index}]`),
    ),
    ...(progress === undefined ? {} : { progress }),
    ...(producedResource === undefined ? {} : { producedResource }),
    ...(duplicateDecisionId === undefined ? {} : { duplicateDecisionId }),
    ...(safeFailure === undefined ? {} : { safeFailure }),
    capabilities: capabilities(value['capabilities'], `${path}.capabilities`),
    ...(attentionReason === undefined ? {} : { attentionReason }),
  };
};

export const decodeIntakeSubmissionSnapshot = (input: unknown): IntakeSubmissionSnapshot => {
  const value = record(input, 'IntakeSubmissionSnapshot');
  schema(value, 'IntakeSubmissionSnapshot');
  const items = boundedArray(value['items'], 'IntakeSubmissionSnapshot.items', 50).map(
    (entry, index) => decodeSubmissionItem(entry, `IntakeSubmissionSnapshot.items[${index}]`),
  );
  if (items.length === 0) fail('IntakeSubmissionSnapshot.items must not be empty.');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    submissionId: stringValue(value['submissionId'], 'IntakeSubmissionSnapshot.submissionId'),
    principalId: stringValue(value['principalId'], 'IntakeSubmissionSnapshot.principalId'),
    sessionId: stringValue(value['sessionId'], 'IntakeSubmissionSnapshot.sessionId'),
    projectId: stringValue(value['projectId'], 'IntakeSubmissionSnapshot.projectId'),
    state: enumValue(
      value['state'],
      [
        'VALIDATING',
        'QUEUED',
        'RUNNING',
        'PARTIAL',
        'ACTION_REQUIRED',
        'SUCCEEDED',
        'FAILED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'OUTCOME_INDETERMINATE',
      ],
      'IntakeSubmissionSnapshot.state',
    ),
    items,
    capabilities: capabilities(value['capabilities'], 'IntakeSubmissionSnapshot.capabilities'),
    acceptedPolicyContextId: stringValue(
      value['acceptedPolicyContextId'],
      'IntakeSubmissionSnapshot.acceptedPolicyContextId',
    ),
    submissionRevision: stringValue(
      value['submissionRevision'],
      'IntakeSubmissionSnapshot.submissionRevision',
    ),
    accessRevision: stringValue(value['accessRevision'], 'IntakeSubmissionSnapshot.accessRevision'),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'IntakeSubmissionSnapshot.policyContextRevision',
    ),
    createdAt: timestamp(value['createdAt'], 'IntakeSubmissionSnapshot.createdAt'),
    updatedAt: timestamp(value['updatedAt'], 'IntakeSubmissionSnapshot.updatedAt'),
    stale: booleanValue(value['stale'], 'IntakeSubmissionSnapshot.stale'),
  };
};

export const decodeExactDuplicateDecisionView = (input: unknown): ExactDuplicateDecisionView => {
  const value = record(input, 'ExactDuplicateDecisionView');
  schema(value, 'ExactDuplicateDecisionView');
  const existing = record(value['existingSource'], 'ExactDuplicateDecisionView.existingSource');
  const allowedDispositions = boundedArray(
    value['allowedDispositions'],
    'ExactDuplicateDecisionView.allowedDispositions',
    4,
  ).map((entry, index) =>
    enumValue<ExactDuplicateDisposition>(
      entry,
      [
        'REUSE_EXISTING_VERSION',
        'CREATE_VERSION_CANDIDATE',
        'CREATE_SEPARATE_SOURCE',
        'CANCEL_SUBMISSION',
      ],
      `ExactDuplicateDecisionView.allowedDispositions[${index}]`,
    ),
  );
  if (allowedDispositions.length === 0) {
    fail('ExactDuplicateDecisionView.allowedDispositions must not be empty.');
  }
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    decisionId: stringValue(value['decisionId'], 'ExactDuplicateDecisionView.decisionId'),
    submissionId: stringValue(value['submissionId'], 'ExactDuplicateDecisionView.submissionId'),
    itemId: stringValue(value['itemId'], 'ExactDuplicateDecisionView.itemId'),
    projectId: stringValue(value['projectId'], 'ExactDuplicateDecisionView.projectId'),
    contentHash: digest(value['contentHash'], 'ExactDuplicateDecisionView.contentHash'),
    existingSource: {
      sourceId: stringValue(
        existing['sourceId'],
        'ExactDuplicateDecisionView.existingSource.sourceId',
      ),
      sourceVersionId: stringValue(
        existing['sourceVersionId'],
        'ExactDuplicateDecisionView.existingSource.sourceVersionId',
      ),
      label: stringValue(existing['label'], 'ExactDuplicateDecisionView.existingSource.label'),
      versionNumber: integer(
        existing['versionNumber'],
        'ExactDuplicateDecisionView.existingSource.versionNumber',
        1,
      ),
    },
    allowedDispositions: [...new Set(allowedDispositions)],
    decisionRevision: stringValue(
      value['decisionRevision'],
      'ExactDuplicateDecisionView.decisionRevision',
    ),
    sourceRevision: stringValue(
      value['sourceRevision'],
      'ExactDuplicateDecisionView.sourceRevision',
    ),
    accessRevision: stringValue(
      value['accessRevision'],
      'ExactDuplicateDecisionView.accessRevision',
    ),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'ExactDuplicateDecisionView.policyContextRevision',
    ),
    createdAt: timestamp(value['createdAt'], 'ExactDuplicateDecisionView.createdAt'),
  };
};

const decodeLibraryItem = (input: unknown, path: string): SourceLibraryItemView => {
  const value = record(input, path);
  const attentionReason = optionalString(value['attentionReason'], `${path}.attentionReason`);
  return {
    sourceId: stringValue(value['sourceId'], `${path}.sourceId`),
    projectId: stringValue(value['projectId'], `${path}.projectId`),
    label: stringValue(value['label'], `${path}.label`),
    mediaType: stringValue(value['mediaType'], `${path}.mediaType`),
    lifecycle: sourceLifecycle(value['lifecycle'], `${path}.lifecycle`),
    previewReadiness: previewReadiness(value['previewReadiness'], `${path}.previewReadiness`),
    askUsageState: askUsageState(value['askUsageState'], `${path}.askUsageState`),
    askUsageExplanation: stringValue(value['askUsageExplanation'], `${path}.askUsageExplanation`),
    selectedSourceVersionId: stringValue(
      value['selectedSourceVersionId'],
      `${path}.selectedSourceVersionId`,
    ),
    versionCount: integer(value['versionCount'], `${path}.versionCount`, 1),
    ...(attentionReason === undefined ? {} : { attentionReason }),
    capabilities: capabilities(value['capabilities'], `${path}.capabilities`),
    sensitivity: sensitivity(value['sensitivity'], `${path}.sensitivity`),
    updatedAt: timestamp(value['updatedAt'], `${path}.updatedAt`),
  };
};

export const decodeSourceLibraryQuery = (input: unknown): SourceLibraryQuery => {
  const value = record(input, 'SourceLibraryQuery');
  schema(value, 'SourceLibraryQuery');
  const filterValue = record(value['filters'], 'SourceLibraryQuery.filters');
  const mediaTypes = optionalBoundedArray(
    filterValue['mediaTypes'],
    'SourceLibraryQuery.filters.mediaTypes',
    12,
  )?.map((entry, index) => stringValue(entry, `SourceLibraryQuery.filters.mediaTypes[${index}]`));
  const lifecycle = optionalBoundedArray(
    filterValue['lifecycle'],
    'SourceLibraryQuery.filters.lifecycle',
    4,
  )?.map((entry, index) =>
    sourceLifecycle(entry, `SourceLibraryQuery.filters.lifecycle[${index}]`),
  );
  const askUsageStates = optionalBoundedArray(
    filterValue['askUsageStates'],
    'SourceLibraryQuery.filters.askUsageStates',
    6,
  )?.map((entry, index) =>
    askUsageState(entry, `SourceLibraryQuery.filters.askUsageStates[${index}]`),
  );
  const attentionOnly =
    filterValue['attentionOnly'] === undefined
      ? undefined
      : booleanValue(filterValue['attentionOnly'], 'SourceLibraryQuery.filters.attentionOnly');
  const query = optionalString(value['query'], 'SourceLibraryQuery.query');
  if (query !== undefined && query.length > 500) {
    fail('SourceLibraryQuery.query exceeds 500 characters.');
  }
  const cursor = optionalString(value['cursor'], 'SourceLibraryQuery.cursor');
  const limit = integer(value['limit'], 'SourceLibraryQuery.limit', 1);
  if (limit > 100) fail('SourceLibraryQuery.limit exceeds 100.');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    ...(query === undefined ? {} : { query }),
    filters: {
      ...(mediaTypes === undefined ? {} : { mediaTypes }),
      ...(lifecycle === undefined ? {} : { lifecycle }),
      ...(askUsageStates === undefined ? {} : { askUsageStates }),
      ...(attentionOnly === undefined ? {} : { attentionOnly }),
    },
    sort: enumValue(
      value['sort'],
      ['UPDATED_DESC', 'UPDATED_ASC', 'LABEL_ASC', 'LABEL_DESC'],
      'SourceLibraryQuery.sort',
    ),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
};

export const decodeSourceLibraryPageView = (input: unknown): SourceLibraryPageView => {
  const value = record(input, 'SourceLibraryPageView');
  schema(value, 'SourceLibraryPageView');
  const nextCursor = optionalString(value['nextCursor'], 'SourceLibraryPageView.nextCursor');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    principalId: stringValue(value['principalId'], 'SourceLibraryPageView.principalId'),
    sessionId: stringValue(value['sessionId'], 'SourceLibraryPageView.sessionId'),
    projectId: stringValue(value['projectId'], 'SourceLibraryPageView.projectId'),
    items: boundedArray(value['items'], 'SourceLibraryPageView.items', 100).map((entry, index) =>
      decodeLibraryItem(entry, `SourceLibraryPageView.items[${index}]`),
    ),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    queryDigest: digest(value['queryDigest'], 'SourceLibraryPageView.queryDigest'),
    projectionRevision: stringValue(
      value['projectionRevision'],
      'SourceLibraryPageView.projectionRevision',
    ),
    accessRevision: stringValue(value['accessRevision'], 'SourceLibraryPageView.accessRevision'),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'SourceLibraryPageView.policyContextRevision',
    ),
    fetchedAt: timestamp(value['fetchedAt'], 'SourceLibraryPageView.fetchedAt'),
    stale: booleanValue(value['stale'], 'SourceLibraryPageView.stale'),
  };
};

export const decodeSourceDetailView = (input: unknown): SourceDetailView => {
  const value = record(input, 'SourceDetailView');
  schema(value, 'SourceDetailView');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    sourceId: stringValue(value['sourceId'], 'SourceDetailView.sourceId'),
    projectId: stringValue(value['projectId'], 'SourceDetailView.projectId'),
    label: stringValue(value['label'], 'SourceDetailView.label'),
    lifecycle: sourceLifecycle(value['lifecycle'], 'SourceDetailView.lifecycle'),
    mediaType: stringValue(value['mediaType'], 'SourceDetailView.mediaType'),
    sensitivity: sensitivity(value['sensitivity'], 'SourceDetailView.sensitivity'),
    currentSourceVersionId: stringValue(
      value['currentSourceVersionId'],
      'SourceDetailView.currentSourceVersionId',
    ),
    versionCount: integer(value['versionCount'], 'SourceDetailView.versionCount', 1),
    previewReadiness: previewReadiness(
      value['previewReadiness'],
      'SourceDetailView.previewReadiness',
    ),
    askUsageState: askUsageState(value['askUsageState'], 'SourceDetailView.askUsageState'),
    askUsageExplanation: stringValue(
      value['askUsageExplanation'],
      'SourceDetailView.askUsageExplanation',
    ),
    capabilities: capabilities(value['capabilities'], 'SourceDetailView.capabilities'),
    sourceRevision: stringValue(value['sourceRevision'], 'SourceDetailView.sourceRevision'),
    projectionRevision: stringValue(
      value['projectionRevision'],
      'SourceDetailView.projectionRevision',
    ),
    accessRevision: stringValue(value['accessRevision'], 'SourceDetailView.accessRevision'),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'SourceDetailView.policyContextRevision',
    ),
    createdAt: timestamp(value['createdAt'], 'SourceDetailView.createdAt'),
    updatedAt: timestamp(value['updatedAt'], 'SourceDetailView.updatedAt'),
  };
};

const decodeHistoryItem = (input: unknown, path: string): SourceVersionHistoryItemView => {
  const value = record(input, path);
  return {
    sourceVersionId: stringValue(value['sourceVersionId'], `${path}.sourceVersionId`),
    versionNumber: integer(value['versionNumber'], `${path}.versionNumber`, 1),
    contentHash: digest(value['contentHash'], `${path}.contentHash`),
    mediaType: stringValue(value['mediaType'], `${path}.mediaType`),
    sizeBytes: integer(value['sizeBytes'], `${path}.sizeBytes`, 1),
    createdAt: timestamp(value['createdAt'], `${path}.createdAt`),
    transformationState: enumValue(
      value['transformationState'],
      ['NOT_STARTED', 'RUNNING', 'READY', 'FAILED'],
      `${path}.transformationState`,
    ),
    evidenceCount: integer(value['evidenceCount'], `${path}.evidenceCount`),
  };
};

export const decodeSourceVersionHistoryView = (input: unknown): SourceVersionHistoryView => {
  const value = record(input, 'SourceVersionHistoryView');
  schema(value, 'SourceVersionHistoryView');
  const versions = boundedArray(value['versions'], 'SourceVersionHistoryView.versions', 100).map(
    (entry, index) => decodeHistoryItem(entry, `SourceVersionHistoryView.versions[${index}]`),
  );
  const selectedSourceVersionId = stringValue(
    value['selectedSourceVersionId'],
    'SourceVersionHistoryView.selectedSourceVersionId',
  );
  if (!versions.some((version) => version.sourceVersionId === selectedSourceVersionId)) {
    fail('SourceVersionHistoryView.selectedSourceVersionId is absent from versions.');
  }
  const nextCursor = optionalString(value['nextCursor'], 'SourceVersionHistoryView.nextCursor');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    sourceId: stringValue(value['sourceId'], 'SourceVersionHistoryView.sourceId'),
    projectId: stringValue(value['projectId'], 'SourceVersionHistoryView.projectId'),
    selectedSourceVersionId,
    versions,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    projectionRevision: stringValue(
      value['projectionRevision'],
      'SourceVersionHistoryView.projectionRevision',
    ),
    accessRevision: stringValue(value['accessRevision'], 'SourceVersionHistoryView.accessRevision'),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'SourceVersionHistoryView.policyContextRevision',
    ),
    fetchedAt: timestamp(value['fetchedAt'], 'SourceVersionHistoryView.fetchedAt'),
  };
};

const decodeLocator = (input: unknown, path: string): PreviewLocatorView => {
  const value = record(input, path);
  const type = enumValue(
    value['type'],
    [
      'TextPositionSelector',
      'TextQuoteSelector',
      'PageSelector',
      'BoundingBoxSelector',
      'CellSelector',
      'ShapeSelector',
      'CssSelector',
    ],
    `${path}.type`,
  );
  if (type === 'TextPositionSelector') {
    const start = integer(value['start'], `${path}.start`);
    const end = integer(value['end'], `${path}.end`);
    if (end < start) fail(`${path}.end must be greater than or equal to start.`);
    if (value['unit'] !== 'unicode-code-point') fail(`${path}.unit is unsupported.`);
    return { type, start, end, unit: 'unicode-code-point' };
  }
  if (type === 'TextQuoteSelector') {
    const prefix = optionalString(value['prefix'], `${path}.prefix`);
    const suffix = optionalString(value['suffix'], `${path}.suffix`);
    return {
      type,
      exact: stringValue(value['exact'], `${path}.exact`),
      ...(prefix === undefined ? {} : { prefix }),
      ...(suffix === undefined ? {} : { suffix }),
    };
  }
  if (type === 'PageSelector') {
    return { type, page: integer(value['page'], `${path}.page`, 1) };
  }
  if (type === 'BoundingBoxSelector') {
    const page =
      value['page'] === undefined ? undefined : integer(value['page'], `${path}.page`, 1);
    const unit = enumValue(value['unit'], ['pt', 'px'], `${path}.unit`);
    return {
      type,
      ...(page === undefined ? {} : { page }),
      x: finiteNumber(value['x'], `${path}.x`),
      y: finiteNumber(value['y'], `${path}.y`),
      width: finiteNumber(value['width'], `${path}.width`),
      height: finiteNumber(value['height'], `${path}.height`),
      unit,
    };
  }
  if (type === 'CellSelector') {
    return {
      type,
      sheet: stringValue(value['sheet'], `${path}.sheet`),
      cell: stringValue(value['cell'], `${path}.cell`),
      row: integer(value['row'], `${path}.row`, 1),
      column: integer(value['column'], `${path}.column`, 1),
    };
  }
  if (type === 'ShapeSelector') {
    return {
      type,
      slide: integer(value['slide'], `${path}.slide`, 1),
      shapeId: stringValue(value['shapeId'], `${path}.shapeId`),
    };
  }
  return { type, value: stringValue(value['value'], `${path}.value`) };
};

export const decodeSourcePreviewView = (input: unknown): SourcePreviewView => {
  const value = record(input, 'SourcePreviewView');
  schema(value, 'SourcePreviewView');
  const text = optionalString(value['text'], 'SourcePreviewView.text');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    sourceId: stringValue(value['sourceId'], 'SourcePreviewView.sourceId'),
    sourceVersionId: stringValue(value['sourceVersionId'], 'SourcePreviewView.sourceVersionId'),
    projectId: stringValue(value['projectId'], 'SourcePreviewView.projectId'),
    mediaType: stringValue(value['mediaType'], 'SourcePreviewView.mediaType'),
    contentHash: digest(value['contentHash'], 'SourcePreviewView.contentHash'),
    mode: enumValue(value['mode'], ['ORIGINAL', 'TRANSFORMED'], 'SourcePreviewView.mode'),
    readiness: previewReadiness(value['readiness'], 'SourcePreviewView.readiness'),
    ...(text === undefined ? {} : { text }),
    locators: boundedArray(value['locators'], 'SourcePreviewView.locators', 2_000).map(
      (entry, index) => decodeLocator(entry, `SourcePreviewView.locators[${index}]`),
    ),
    capabilities: capabilities(value['capabilities'], 'SourcePreviewView.capabilities'),
    projectionRevision: stringValue(
      value['projectionRevision'],
      'SourcePreviewView.projectionRevision',
    ),
    accessRevision: stringValue(value['accessRevision'], 'SourcePreviewView.accessRevision'),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'SourcePreviewView.policyContextRevision',
    ),
    fetchedAt: timestamp(value['fetchedAt'], 'SourcePreviewView.fetchedAt'),
  };
};

const onlyRequestKeys = (
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

const requestString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be a non-empty string.`);
  }
  return value;
};

const boundedRequestString = (value: unknown, path: string, maximum: number): string => {
  const decoded = requestString(value, path);
  if (decoded.length > maximum) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path} must contain at most ${maximum} characters.`,
    );
  }
  return decoded;
};

const requestArray = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path} must contain between 1 and ${maximum} items.`,
    );
  }
  return value;
};

const requestRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be a plain object.`);
  }
  return value;
};

const decodeSubmitCommandPayload = (input: unknown): SubmitSourcesIntakeCommandPayload => {
  const value = requestRecord(input, 'sources.intake.submit.v1.payload');
  onlyRequestKeys(value, ['draftId', 'inputs'], 'sources.intake.submit.v1.payload');
  const inputs = requestArray(value['inputs'], 'payload.inputs', 50).map((entry, index) => {
    const path = `payload.inputs[${index}]`;
    const item = requestRecord(entry, path);
    const kind = item['kind'];
    const common = {
      itemId: requestString(item['itemId'], `${path}.itemId`),
      label: requestString(item['label'], `${path}.label`),
    };
    if (kind === 'DIRECT_TEXT') {
      onlyRequestKeys(item, ['itemId', 'kind', 'label', 'text'], path);
      const text = requestString(item['text'], `${path}.text`);
      if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `${path}.text exceeds the current 10 MiB intake limit.`,
        );
      }
      return { kind: 'DIRECT_TEXT' as const, ...common, text };
    }
    if (kind === 'FILE') {
      onlyRequestKeys(
        item,
        ['itemId', 'kind', 'label', 'fileName', 'mediaType', 'contentBase64'],
        path,
      );
      return {
        kind: 'FILE' as const,
        ...common,
        fileName: requestString(item['fileName'], `${path}.fileName`),
        mediaType: requestString(item['mediaType'], `${path}.mediaType`),
        contentBase64: requestString(item['contentBase64'], `${path}.contentBase64`),
      };
    }
    if (kind === 'URL') {
      onlyRequestKeys(item, ['itemId', 'kind', 'label', 'requestedUrl'], path);
      const requestedUrl = requestString(item['requestedUrl'], `${path}.requestedUrl`);
      let parsed: URL;
      try {
        parsed = new URL(requestedUrl);
      } catch {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `${path}.requestedUrl must be an absolute HTTP(S) URL.`,
        );
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `${path}.requestedUrl protocol is unsupported.`,
        );
      }
      return { kind: 'URL' as const, ...common, requestedUrl };
    }
    throw new FrontendContractError('INVALID_REQUEST', `${path}.kind is unsupported.`);
  });
  if (new Set(inputs.map((item) => item.itemId)).size !== inputs.length) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'payload.inputs itemId values must be unique within the draft.',
    );
  }
  return {
    draftId: requestString(value['draftId'], 'payload.draftId'),
    inputs,
  };
};

export const validateSourcesFrontendCommandRequest = (
  input: unknown,
  expectedCommandType: SourcesFrontendCommandType,
): FrontendCommandRequest<SourcesFrontendCommandPayload> => {
  const request = validateFrontendCommandRequest(input, {
    isNewResource: expectedCommandType === SOURCES_FRONTEND_COMMAND_TYPES.submit,
  });
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
  const rawPayload = requestRecord(request.payload, `${expectedCommandType}.payload`);
  let payload: SourcesFrontendCommandPayload;
  if (expectedCommandType === SOURCES_FRONTEND_COMMAND_TYPES.submit) {
    payload = decodeSubmitCommandPayload(rawPayload);
  } else if (expectedCommandType === SOURCES_FRONTEND_COMMAND_TYPES.cancel) {
    onlyRequestKeys(rawPayload, ['submissionId'], `${expectedCommandType}.payload`);
    payload = {
      submissionId: requestString(rawPayload['submissionId'], 'payload.submissionId'),
    };
  } else if (expectedCommandType === SOURCES_FRONTEND_COMMAND_TYPES.retry) {
    onlyRequestKeys(
      rawPayload,
      ['submissionId', 'itemIds', 'mode'],
      `${expectedCommandType}.payload`,
    );
    const itemIds = requestArray(rawPayload['itemIds'], 'payload.itemIds', 50).map((entry, index) =>
      requestString(entry, `payload.itemIds[${index}]`),
    );
    if (new Set(itemIds).size !== itemIds.length) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'payload.itemIds must not contain duplicates.',
      );
    }
    if (rawPayload['mode'] !== 'SAME_CONTEXT' && rawPayload['mode'] !== 'CURRENT_POLICY') {
      throw new FrontendContractError('INVALID_REQUEST', 'payload.mode is unsupported.');
    }
    payload = {
      submissionId: requestString(rawPayload['submissionId'], 'payload.submissionId'),
      itemIds,
      mode: rawPayload['mode'],
    };
  } else {
    onlyRequestKeys(
      rawPayload,
      ['decisionId', 'disposition', 'targetSourceId'],
      `${expectedCommandType}.payload`,
    );
    const disposition = rawPayload['disposition'];
    if (
      ![
        'REUSE_EXISTING_VERSION',
        'CREATE_VERSION_CANDIDATE',
        'CREATE_SEPARATE_SOURCE',
        'CANCEL_SUBMISSION',
      ].includes(String(disposition))
    ) {
      throw new FrontendContractError('INVALID_REQUEST', 'payload.disposition is unsupported.');
    }
    const targetSourceId =
      rawPayload['targetSourceId'] === undefined
        ? undefined
        : requestString(rawPayload['targetSourceId'], 'payload.targetSourceId');
    if (disposition === 'CREATE_VERSION_CANDIDATE' && targetSourceId === undefined) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'CREATE_VERSION_CANDIDATE requires payload.targetSourceId.',
      );
    }
    if (disposition !== 'CREATE_VERSION_CANDIDATE' && targetSourceId !== undefined) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'payload.targetSourceId is only valid for CREATE_VERSION_CANDIDATE.',
      );
    }
    payload = {
      decisionId: requestString(rawPayload['decisionId'], 'payload.decisionId'),
      disposition: disposition as ExactDuplicateDisposition,
      ...(targetSourceId === undefined ? {} : { targetSourceId }),
    };
  }
  return { ...request, payload };
};

const decodeEvidenceItem = (input: unknown, path: string): EvidenceItemView => {
  const value = record(input, path);
  const exactText = optionalString(value['exactText'], `${path}.exactText`);
  return {
    evidenceId: stringValue(value['evidenceId'], `${path}.evidenceId`),
    sourceId: stringValue(value['sourceId'], `${path}.sourceId`),
    sourceVersionId: stringValue(value['sourceVersionId'], `${path}.sourceVersionId`),
    revisionId: stringValue(value['revisionId'], `${path}.revisionId`),
    label: stringValue(value['label'], `${path}.label`),
    origin: enumValue(
      value['origin'],
      ['ORIGINAL', 'TRANSLATION', 'SUMMARY', 'ANNOTATION', 'AI_OUTPUT'],
      `${path}.origin`,
    ),
    ...(exactText === undefined ? {} : { exactText }),
    locators: boundedArray(value['locators'], `${path}.locators`, 20).map((entry, index) =>
      decodeLocator(entry, `${path}.locators[${index}]`),
    ),
    createdAt: timestamp(value['createdAt'], `${path}.createdAt`),
  };
};

export const decodeEvidenceListView = (input: unknown): EvidenceListView => {
  const value = record(input, 'EvidenceListView');
  schema(value, 'EvidenceListView');
  const sourceId = stringValue(value['sourceId'], 'EvidenceListView.sourceId');
  const sourceVersionId = stringValue(value['sourceVersionId'], 'EvidenceListView.sourceVersionId');
  const items = boundedArray(value['items'], 'EvidenceListView.items', 500).map((entry, index) =>
    decodeEvidenceItem(entry, `EvidenceListView.items[${index}]`),
  );
  if (
    items.some((item) => item.sourceId !== sourceId || item.sourceVersionId !== sourceVersionId)
  ) {
    fail('EvidenceListView items must match the pinned Source and SourceVersion.');
  }
  const nextCursor = optionalString(value['nextCursor'], 'EvidenceListView.nextCursor');
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    projectId: stringValue(value['projectId'], 'EvidenceListView.projectId'),
    sourceId,
    sourceVersionId,
    items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    projectionRevision: stringValue(
      value['projectionRevision'],
      'EvidenceListView.projectionRevision',
    ),
    accessRevision: stringValue(value['accessRevision'], 'EvidenceListView.accessRevision'),
    policyContextRevision: stringValue(
      value['policyContextRevision'],
      'EvidenceListView.policyContextRevision',
    ),
    fetchedAt: timestamp(value['fetchedAt'], 'EvidenceListView.fetchedAt'),
  };
};

export const decodeCitationReturnTarget = (input: unknown): CitationReturnTarget => {
  const value = record(input, 'CitationReturnTarget');
  schema(value, 'CitationReturnTarget');
  const originRoute = boundedString(value['originRoute'], 'CitationReturnTarget.originRoute', 2048);
  if (!originRoute.startsWith('/') || originRoute.startsWith('//')) {
    fail('CitationReturnTarget.originRoute must be an internal absolute route.');
  }
  const conversationId = optionalBoundedString(
    value['conversationId'],
    'CitationReturnTarget.conversationId',
    512,
  );
  const branchId = optionalBoundedString(value['branchId'], 'CitationReturnTarget.branchId', 512);
  const turnId = optionalBoundedString(value['turnId'], 'CitationReturnTarget.turnId', 512);
  const answerRunId = optionalBoundedString(
    value['answerRunId'],
    'CitationReturnTarget.answerRunId',
    512,
  );
  const answerRevision = optionalBoundedString(
    value['answerRevision'],
    'CitationReturnTarget.answerRevision',
    512,
  );
  const scrollAnchor = optionalBoundedString(
    value['scrollAnchor'],
    'CitationReturnTarget.scrollAnchor',
    512,
  );
  const focusTarget = optionalBoundedString(
    value['focusTarget'],
    'CitationReturnTarget.focusTarget',
    512,
  );
  const panelId = optionalBoundedString(value['panelId'], 'CitationReturnTarget.panelId', 512);
  return {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    originRoute,
    resourceKind: boundedString(value['resourceKind'], 'CitationReturnTarget.resourceKind', 200),
    resourceId: boundedString(value['resourceId'], 'CitationReturnTarget.resourceId', 512),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(branchId === undefined ? {} : { branchId }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(answerRunId === undefined ? {} : { answerRunId }),
    ...(answerRevision === undefined ? {} : { answerRevision }),
    resourceRevision: boundedString(
      value['resourceRevision'],
      'CitationReturnTarget.resourceRevision',
      512,
    ),
    citationId: boundedString(value['citationId'], 'CitationReturnTarget.citationId', 512),
    sourceId: boundedString(value['sourceId'], 'CitationReturnTarget.sourceId', 512),
    sourceVersionId: boundedString(
      value['sourceVersionId'],
      'CitationReturnTarget.sourceVersionId',
      512,
    ),
    evidenceId: boundedString(value['evidenceId'], 'CitationReturnTarget.evidenceId', 512),
    ...(scrollAnchor === undefined ? {} : { scrollAnchor }),
    ...(focusTarget === undefined ? {} : { focusTarget }),
    ...(panelId === undefined ? {} : { panelId }),
  };
};

export const decodeIntakeDraftSeed = (input: unknown): IntakeDraftSeed => {
  const value = record(input, 'IntakeDraftSeed');
  schema(value, 'IntakeDraftSeed');
  onlyRequestKeys(
    value,
    ['schemaVersion', 'seedId', 'projectId', 'originatingWorkspace', 'input'],
    'IntakeDraftSeed',
  );
  const inputValue = requestRecord(value['input'], 'IntakeDraftSeed.input');
  const common = {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    seedId: boundedRequestString(value['seedId'], 'IntakeDraftSeed.seedId', 512),
    projectId: boundedRequestString(value['projectId'], 'IntakeDraftSeed.projectId', 512),
    originatingWorkspace: boundedRequestString(
      value['originatingWorkspace'],
      'IntakeDraftSeed.originatingWorkspace',
      200,
    ),
  };
  const kind = inputValue['kind'];
  if (kind === 'DIRECT_TEXT') {
    onlyRequestKeys(inputValue, ['kind', 'label', 'text'], 'IntakeDraftSeed.input');
    const text = boundedRequestString(
      inputValue['text'],
      'IntakeDraftSeed.input.text',
      10 * 1024 * 1024,
    );
    if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'IntakeDraftSeed.input.text exceeds the current 10 MiB intake limit.',
      );
    }
    return {
      ...common,
      input: {
        kind,
        label: boundedRequestString(inputValue['label'], 'IntakeDraftSeed.input.label', 200),
        text,
      },
    };
  }
  if (kind === 'URL') {
    onlyRequestKeys(inputValue, ['kind', 'label', 'requestedUrl'], 'IntakeDraftSeed.input');
    const requestedUrl = requestString(
      inputValue['requestedUrl'],
      'IntakeDraftSeed.input.requestedUrl',
    );
    if (requestedUrl.length > 2048) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'IntakeDraftSeed.input.requestedUrl must contain at most 2048 characters.',
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(requestedUrl);
    } catch {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'IntakeDraftSeed.input.requestedUrl must be an absolute HTTP(S) URL.',
      );
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'IntakeDraftSeed.input.requestedUrl protocol is unsupported.',
      );
    }
    return {
      ...common,
      input: {
        kind,
        label: boundedRequestString(inputValue['label'], 'IntakeDraftSeed.input.label', 200),
        requestedUrl,
      },
    };
  }
  if (kind === 'FILE_METADATA') {
    onlyRequestKeys(
      inputValue,
      ['kind', 'label', 'fileName', 'mediaType', 'sizeBytes'],
      'IntakeDraftSeed.input',
    );
    const sizeBytes = integer(inputValue['sizeBytes'], 'IntakeDraftSeed.input.sizeBytes', 1);
    if (sizeBytes > 10 * 1024 * 1024) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'IntakeDraftSeed.input.sizeBytes exceeds the current 10 MiB intake limit.',
      );
    }
    return {
      ...common,
      input: {
        kind,
        label: boundedRequestString(inputValue['label'], 'IntakeDraftSeed.input.label', 200),
        fileName: boundedRequestString(
          inputValue['fileName'],
          'IntakeDraftSeed.input.fileName',
          255,
        ),
        mediaType: boundedRequestString(
          inputValue['mediaType'],
          'IntakeDraftSeed.input.mediaType',
          200,
        ),
        sizeBytes,
      },
    };
  }
  throw new FrontendContractError('INVALID_REQUEST', 'IntakeDraftSeed.input.kind is unsupported.');
};
