import { createHash, randomUUID } from 'node:crypto';

/**
 * Project-wide Source knowledge reset boundary (ADR-171).
 *
 * These contracts intentionally expose opaque digests, aggregates, and stable
 * blocker codes only. They must never carry Source text or table-level SQL.
 */

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

export type KnowledgeResetProjectContextV1 = Readonly<{
  projectId: string;
  projectRevision: number;
  knowledgeEpoch: number;
  resetState: 'READY' | 'RESET_PENDING' | 'RESET_FAILED' | 'RESET_UNVERIFIED';
  actorPrincipalId: string;
}>;

/** Owner ports classify content without leaking schema/table names upward. */
export type KnowledgeResetImpactPort = {
  inspectProjectSourceKnowledge(projectId: string): Promise<{
    counts: KnowledgeResetImpactCountsV1;
    blockers: readonly KnowledgeResetBlockerCodeV1[];
    manifestDigest: `sha256:${string}`;
  }>;
};

export type KnowledgeResetProjectStatePort = {
  readProjectResetContext(input: {
    projectId: string;
    actorPrincipalId: string;
  }): Promise<KnowledgeResetProjectContextV1 | null>;
  readKnowledgeEpoch(projectId: string): Promise<number>;
};

export type KnowledgeResetRequestRepositoryPort = {
  insertApproved(input: {
    requestId: string;
    previewId: string;
    projectId: string;
    actorPrincipalId: string;
    projectRevision: number;
    expectedKnowledgeEpoch: number;
    manifestDigest: `sha256:${string}`;
    ownerManifestDigest: `sha256:${string}`;
    preservedConfigurationDigest: `sha256:${string}`;
    idempotencyKey: string;
    counts: KnowledgeResetImpactCountsV1;
  }): Promise<{ request: KnowledgeResetRequestV1; replayed: boolean }>;
  findById(projectId: string, requestId: string): Promise<KnowledgeResetRequestV1 | null>;
  findByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<KnowledgeResetRequestV1 | null>;
};

export type KnowledgeResetConfigurationFingerprintPort = {
  fingerprintPreservedProjectConfiguration(projectId: string): Promise<`sha256:${string}`>;
};

export type KnowledgeResetCoordinatorPort = {
  preview(input: { projectId: string; actorPrincipalId: string }): Promise<KnowledgeResetPreviewV1>;
  confirm(input: {
    projectId: string;
    actorPrincipalId: string;
    confirmation: KnowledgeResetConfirmationV1;
  }): Promise<{ request: KnowledgeResetRequestV1; replayed: boolean }>;
  getRequest(input: {
    projectId: string;
    requestId: string;
  }): Promise<KnowledgeResetRequestV1 | null>;
};

export type KnowledgeResetCoordinatorDependencies = Readonly<{
  projectState: KnowledgeResetProjectStatePort;
  impact: KnowledgeResetImpactPort;
  requests: KnowledgeResetRequestRepositoryPort;
  configurationFingerprint: KnowledgeResetConfigurationFingerprintPort;
  now?: () => Date;
  previewTtlMs?: number;
  id?: () => string;
}>;

export * from './execution.js';

export class KnowledgeResetContractError extends Error {
  constructor(
    readonly code:
      | 'NOT_PROJECT_OWNER'
      | 'STALE_PREVIEW'
      | KnowledgeResetBlockerCodeV1
      | 'INVALID_CONFIRMATION'
      | 'IDEMPOTENCY_KEY_REUSE_MISMATCH'
      | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeResetContractError';
  }
}

const validOpaqueId = (value: string): boolean => value.length > 0 && value.length <= 200;
const isDigest = (value: string): value is `sha256:${string}` =>
  /^sha256:[a-f0-9]{64}$/u.test(value);

const validCounts = (counts: KnowledgeResetImpactCountsV1): boolean =>
  Object.values(counts).every((value) => Number.isSafeInteger(value) && value >= 0);

/** Stable JSON hashing input; explicitly assembled to avoid accidental lineage inheritance. */
const manifestInput = (input: {
  projectId: string;
  projectRevision: number;
  knowledgeEpoch: number;
  ownerManifestDigest: string;
  preservedConfigurationDigest: string;
  counts: KnowledgeResetImpactCountsV1;
  blockers: readonly KnowledgeResetBlockerCodeV1[];
}): string =>
  JSON.stringify({
    schemaVersion: '1.0.0',
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    knowledgeEpoch: input.knowledgeEpoch,
    ownerManifestDigest: input.ownerManifestDigest,
    preservedConfigurationDigest: input.preservedConfigurationDigest,
    counts: input.counts,
    blockers: [...input.blockers].sort(),
  });

const manifestDigestFor = (input: Parameters<typeof manifestInput>[0]): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(manifestInput(input)).digest('hex')}`;

export const createKnowledgeResetCoordinator = (
  dependencies: KnowledgeResetCoordinatorDependencies,
): KnowledgeResetCoordinatorPort => {
  const previews = new Map<string, KnowledgeResetPreviewV1>();
  const now = dependencies.now ?? (() => new Date());
  const ttlMs = dependencies.previewTtlMs ?? 5 * 60_000;
  const id = dependencies.id ?? randomUUID;

  return {
    async preview({ projectId, actorPrincipalId }) {
      const context = await dependencies.projectState.readProjectResetContext({
        projectId,
        actorPrincipalId,
      });
      if (!context) {
        throw new KnowledgeResetContractError(
          'NOT_PROJECT_OWNER',
          'Project Owner access is required.',
        );
      }
      const [impact, preservedConfigurationDigest] = await Promise.all([
        dependencies.impact.inspectProjectSourceKnowledge(projectId),
        dependencies.configurationFingerprint.fingerprintPreservedProjectConfiguration(projectId),
      ]);
      if (
        !isDigest(impact.manifestDigest) ||
        !isDigest(preservedConfigurationDigest) ||
        !validCounts(impact.counts)
      ) {
        throw new KnowledgeResetContractError(
          'UNCLASSIFIED_CONTENT',
          'Reset impact evidence is invalid.',
        );
      }
      const blockers = [
        ...new Set([
          ...impact.blockers,
          ...(context.resetState === 'READY' ? [] : ['RESET_IN_PROGRESS' as const]),
        ]),
      ].sort();
      const manifestDigest = manifestDigestFor({
        projectId,
        projectRevision: context.projectRevision,
        knowledgeEpoch: context.knowledgeEpoch,
        ownerManifestDigest: impact.manifestDigest,
        preservedConfigurationDigest,
        counts: impact.counts,
        blockers,
      });
      const createdAt = now();
      const preview: KnowledgeResetPreviewV1 = {
        schemaVersion: '1.0.0',
        previewId: id(),
        projectId,
        manifestDigest,
        ownerManifestDigest: impact.manifestDigest,
        projectRevision: context.projectRevision,
        knowledgeEpoch: context.knowledgeEpoch,
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        counts: impact.counts,
        blockers,
        preservedConfigurationDigest,
        canConfirm: blockers.length === 0,
      };
      previews.set(preview.previewId, preview);
      return preview;
    },

    async confirm({ projectId, actorPrincipalId, confirmation }) {
      if (
        !validOpaqueId(confirmation.idempotencyKey) ||
        confirmation.confirmIrreversibleReset !== true ||
        !isDigest(confirmation.manifestDigest)
      ) {
        throw new KnowledgeResetContractError(
          'INVALID_CONFIRMATION',
          'Reset confirmation is invalid.',
        );
      }
      const current = await dependencies.projectState.readProjectResetContext({
        projectId,
        actorPrincipalId,
      });
      if (!current) {
        throw new KnowledgeResetContractError(
          'NOT_PROJECT_OWNER',
          'Project Owner access is required.',
        );
      }
      const replay = await dependencies.requests.findByIdempotencyKey(
        projectId,
        confirmation.idempotencyKey,
      );
      if (replay) {
        if (
          replay.manifestDigest !== confirmation.manifestDigest ||
          replay.projectRevision !== confirmation.expectedProjectRevision ||
          replay.expectedKnowledgeEpoch !== confirmation.expectedKnowledgeEpoch
        ) {
          throw new KnowledgeResetContractError(
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            'Idempotency key was reused for a different reset confirmation.',
          );
        }
        return { request: replay, replayed: true };
      }
      if (current.resetState !== 'READY') {
        throw new KnowledgeResetContractError(
          'RESET_IN_PROGRESS',
          'A Project knowledge reset is already active.',
        );
      }

      const preview = previews.get(confirmation.previewId);
      if (
        !preview ||
        preview.projectId !== projectId ||
        preview.manifestDigest !== confirmation.manifestDigest ||
        preview.projectRevision !== confirmation.expectedProjectRevision ||
        preview.knowledgeEpoch !== confirmation.expectedKnowledgeEpoch ||
        new Date(preview.expiresAt).getTime() <= now().getTime()
      ) {
        throw new KnowledgeResetContractError(
          'STALE_PREVIEW',
          'Reset preview is stale; create a new preview.',
        );
      }
      if (!preview.canConfirm) {
        throw new KnowledgeResetContractError(
          preview.blockers[0] ?? 'UNCLASSIFIED_CONTENT',
          'Reset preview contains blocking impacts.',
        );
      }
      if (
        current.projectRevision !== preview.projectRevision ||
        current.knowledgeEpoch !== preview.knowledgeEpoch
      ) {
        throw new KnowledgeResetContractError(
          'STALE_PREVIEW',
          'Project access or knowledge changed; preview again.',
        );
      }
      const currentImpact = await dependencies.impact.inspectProjectSourceKnowledge(projectId);
      const currentPreservedDigest =
        await dependencies.configurationFingerprint.fingerprintPreservedProjectConfiguration(
          projectId,
        );
      if (
        !isDigest(currentImpact.manifestDigest) ||
        !isDigest(currentPreservedDigest) ||
        !validCounts(currentImpact.counts)
      ) {
        throw new KnowledgeResetContractError(
          'UNCLASSIFIED_CONTENT',
          'Reset impact evidence is invalid.',
        );
      }
      const currentManifest = manifestDigestFor({
        projectId,
        projectRevision: current.projectRevision,
        knowledgeEpoch: current.knowledgeEpoch,
        ownerManifestDigest: currentImpact.manifestDigest,
        preservedConfigurationDigest: currentPreservedDigest,
        counts: currentImpact.counts,
        blockers: [...new Set(currentImpact.blockers)].sort(),
      });
      if (currentManifest !== preview.manifestDigest || !validCounts(currentImpact.counts)) {
        throw new KnowledgeResetContractError(
          'STALE_PREVIEW',
          'Source knowledge changed; preview again.',
        );
      }
      if (
        !isDigest(currentPreservedDigest) ||
        currentPreservedDigest !== preview.preservedConfigurationDigest
      ) {
        throw new KnowledgeResetContractError(
          'STALE_PREVIEW',
          'Preserved configuration changed; preview again.',
        );
      }
      return dependencies.requests.insertApproved({
        requestId: id(),
        previewId: preview.previewId,
        projectId,
        actorPrincipalId,
        projectRevision: preview.projectRevision,
        expectedKnowledgeEpoch: preview.knowledgeEpoch,
        manifestDigest: preview.manifestDigest,
        ownerManifestDigest: currentImpact.manifestDigest,
        preservedConfigurationDigest: preview.preservedConfigurationDigest,
        idempotencyKey: confirmation.idempotencyKey,
        counts: preview.counts,
      });
    },

    async getRequest({ projectId, requestId }) {
      return dependencies.requests.findById(projectId, requestId);
    },
  };
};
