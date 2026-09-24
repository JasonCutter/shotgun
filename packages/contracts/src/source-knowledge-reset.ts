import { FrontendContractError } from './frontend-foundation.js';

export type KnowledgeResetStateV1 =
  | 'APPROVED'
  | 'FENCING'
  | 'PURGING'
  | 'REBUILDING'
  | 'VERIFYING'
  | 'COMPLETE'
  | 'BLOCKED'
  | 'OUTCOME_UNKNOWN'
  | 'ERASURE_UNVERIFIED';

export type KnowledgeResetBlockerCodeV1 =
  | 'UNCLASSIFIED_CONTENT'
  | 'STALE_PREVIEW'
  | 'ACTIVE_JOB_OUTCOME_UNKNOWN'
  | 'EXTERNAL_ACTION_DEPENDENCY'
  | 'RESET_IN_PROGRESS'
  | 'ERASURE_EXECUTOR_UNAVAILABLE'
  | 'KNOWLEDGE_RESET_JOURNAL_UNAVAILABLE';

export type KnowledgeResetImpactCountsV1 = Readonly<{
  sourceCount: number;
  sourceVersionCount: number;
  sourceDerivedRecordCount: number;
  redactedHistoryRecordCount: number;
  rebuildProjectionCount: number;
  sharedAssetCount: number;
  blockedRecordCount: number;
}>;

export type KnowledgeResetPreviewV1 = Readonly<{
  schemaVersion: '1.0.0';
  previewId: string;
  projectId: string;
  manifestDigest: `sha256:${string}`;
  ownerManifestDigest: `sha256:${string}`;
  projectRevision: number;
  knowledgeEpoch: number;
  expiresAt: string;
  counts: KnowledgeResetImpactCountsV1;
  blockers: readonly KnowledgeResetBlockerCodeV1[];
  preservedConfigurationDigest: `sha256:${string}`;
  canConfirm: boolean;
}>;

export type KnowledgeResetConfirmationV1 = Readonly<{
  previewId: string;
  manifestDigest: `sha256:${string}`;
  expectedProjectRevision: number;
  expectedKnowledgeEpoch: number;
  idempotencyKey: string;
  confirmIrreversibleReset: true;
}>;

export type KnowledgeResetRequestV1 = Readonly<{
  schemaVersion: '1.0.0';
  requestId: string;
  projectId: string;
  projectRevision: number;
  manifestDigest: `sha256:${string}`;
  ownerManifestDigest?: `sha256:${string}`;
  preservedConfigurationDigest?: `sha256:${string}`;
  state: KnowledgeResetStateV1;
  expectedKnowledgeEpoch: number;
  knowledgeEpoch: number;
  blockerCodes: readonly KnowledgeResetBlockerCodeV1[];
  counts: KnowledgeResetImpactCountsV1;
  completedSteps: readonly string[];
  casStatus: 'NOT_STARTED' | 'QUARANTINED_PENDING_SWEEP' | 'COMPLETE' | 'BLOCKED';
  backupStatus: 'PENDING' | 'COMPLETE' | 'BLOCKED';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}>;

export type ConfirmKnowledgeResetResponseV1 = Readonly<{
  request: KnowledgeResetRequestV1;
  replayed: boolean;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isDigest = (value: unknown): value is `sha256:${string}` =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);

const blockerCodes = new Set<KnowledgeResetBlockerCodeV1>([
  'UNCLASSIFIED_CONTENT',
  'STALE_PREVIEW',
  'ACTIVE_JOB_OUTCOME_UNKNOWN',
  'EXTERNAL_ACTION_DEPENDENCY',
  'RESET_IN_PROGRESS',
  'ERASURE_EXECUTOR_UNAVAILABLE',
  'KNOWLEDGE_RESET_JOURNAL_UNAVAILABLE',
]);

const states = new Set<KnowledgeResetStateV1>([
  'APPROVED',
  'FENCING',
  'PURGING',
  'REBUILDING',
  'VERIFYING',
  'COMPLETE',
  'BLOCKED',
  'OUTCOME_UNKNOWN',
  'ERASURE_UNVERIFIED',
]);

const decodeCounts = (value: unknown): KnowledgeResetImpactCountsV1 => {
  if (!isRecord(value))
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Reset counts are invalid.');
  const keys: readonly (keyof KnowledgeResetImpactCountsV1)[] = [
    'sourceCount',
    'sourceVersionCount',
    'sourceDerivedRecordCount',
    'redactedHistoryRecordCount',
    'rebuildProjectionCount',
    'sharedAssetCount',
    'blockedRecordCount',
  ];
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) {
      throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Reset counts are invalid.');
    }
  }
  return value as unknown as KnowledgeResetImpactCountsV1;
};

const decodeBlockers = (value: unknown): readonly KnowledgeResetBlockerCodeV1[] => {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => typeof item !== 'string' || !blockerCodes.has(item as KnowledgeResetBlockerCodeV1),
    )
  ) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'Reset blocker codes are invalid.');
  }
  return value as KnowledgeResetBlockerCodeV1[];
};

export const decodeKnowledgeResetPreviewV1 = (value: unknown): KnowledgeResetPreviewV1 => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== '1.0.0' ||
    !isNonEmptyString(value.previewId) ||
    !isNonEmptyString(value.projectId) ||
    !isDigest(value.manifestDigest) ||
    !isDigest(value.ownerManifestDigest) ||
    !Number.isSafeInteger(value.projectRevision) ||
    !Number.isSafeInteger(value.knowledgeEpoch) ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    typeof value.canConfirm !== 'boolean' ||
    !isDigest(value.preservedConfigurationDigest)
  ) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Source knowledge reset preview is invalid.',
    );
  }
  return {
    schemaVersion: '1.0.0',
    previewId: value.previewId,
    projectId: value.projectId,
    manifestDigest: value.manifestDigest,
    ownerManifestDigest: value.ownerManifestDigest,
    projectRevision: value.projectRevision as number,
    knowledgeEpoch: value.knowledgeEpoch as number,
    expiresAt: value.expiresAt,
    counts: decodeCounts(value.counts),
    blockers: decodeBlockers(value.blockers),
    preservedConfigurationDigest: value.preservedConfigurationDigest,
    canConfirm: value.canConfirm,
  };
};

export const decodeKnowledgeResetRequestV1 = (value: unknown): KnowledgeResetRequestV1 => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== '1.0.0' ||
    !isNonEmptyString(value.requestId) ||
    !isNonEmptyString(value.projectId) ||
    !Number.isSafeInteger(value.projectRevision) ||
    !isDigest(value.manifestDigest) ||
    (value.ownerManifestDigest !== undefined && !isDigest(value.ownerManifestDigest)) ||
    (value.preservedConfigurationDigest !== undefined &&
      !isDigest(value.preservedConfigurationDigest)) ||
    typeof value.state !== 'string' ||
    !states.has(value.state as KnowledgeResetStateV1) ||
    !Number.isSafeInteger(value.expectedKnowledgeEpoch) ||
    !Number.isSafeInteger(value.knowledgeEpoch) ||
    !Array.isArray(value.completedSteps) ||
    value.completedSteps.some((step) => typeof step !== 'string') ||
    !['NOT_STARTED', 'QUARANTINED_PENDING_SWEEP', 'COMPLETE', 'BLOCKED'].includes(
      String(value.casStatus),
    ) ||
    !['PENDING', 'COMPLETE', 'BLOCKED'].includes(String(value.backupStatus)) ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.completedAt !== undefined &&
      (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt))))
  ) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Source knowledge reset request is invalid.',
    );
  }
  return {
    schemaVersion: '1.0.0',
    requestId: value.requestId,
    projectId: value.projectId,
    projectRevision: value.projectRevision as number,
    manifestDigest: value.manifestDigest,
    ...(value.ownerManifestDigest === undefined
      ? {}
      : { ownerManifestDigest: value.ownerManifestDigest }),
    ...(value.preservedConfigurationDigest === undefined
      ? {}
      : { preservedConfigurationDigest: value.preservedConfigurationDigest }),
    state: value.state as KnowledgeResetStateV1,
    expectedKnowledgeEpoch: value.expectedKnowledgeEpoch as number,
    knowledgeEpoch: value.knowledgeEpoch as number,
    blockerCodes: decodeBlockers(value.blockerCodes),
    counts: decodeCounts(value.counts),
    completedSteps: value.completedSteps as string[],
    casStatus: value.casStatus as KnowledgeResetRequestV1['casStatus'],
    backupStatus: value.backupStatus as KnowledgeResetRequestV1['backupStatus'],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.completedAt === undefined ? {} : { completedAt: value.completedAt as string }),
  };
};
