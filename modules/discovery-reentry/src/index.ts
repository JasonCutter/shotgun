import {
  computeDiscoveryReentryLogicalIdentityV1,
  createDerivedKnowledgeCandidateV1,
  createDiscoveryReentryManifestV1,
  decodeDiscoveryFindingReadyV1,
  deriveDiscoveryReentryEligibilityV1,
  type DerivedKnowledgeCandidateV1,
  type DiscoveryCanonicalBaseIdentityV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingLifecycleState,
  type DiscoveryFindingReadyV1,
  type DiscoveryProjectionBaseIdentityV1,
  type DiscoveryReentryLogicalIdentityResultV1,
  type DiscoveryReentryManifestV1,
  type DiscoveryApprovedResourceRevisionRefV1,
  type DiscoveryResourceRefV1,
} from '../../../packages/contracts/src/index.js';

export const DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION =
  'DERIVED_PROVENANCE_VALIDATION' as const;

export const DISCOVERY_REENTRY_CONSUMPTION_DISPOSITIONS = [
  'PROCESSED',
  'INELIGIBLE',
  'BLOCKED_NON_RETRYABLE',
  'RETRYABLE',
] as const;
export const DISCOVERY_REENTRY_DEFAULT_RETRY_BACKOFF_MS = 1_000;
export type DiscoveryReentryConsumptionDispositionV1 =
  (typeof DISCOVERY_REENTRY_CONSUMPTION_DISPOSITIONS)[number];

export const DISCOVERY_REENTRY_CONSUMPTION_REASON_CODES = [
  'SUCCESS',
  'LIFECYCLE_INELIGIBLE',
  'NO_APPROVED_REENTRY_AUTHORITY',
  'NO_APPROVED_REVISION_AT_FROZEN_BASE',
  'FINDING_NOT_FOUND',
  'IDENTITY_MISMATCH',
  'UNSUPPORTED_RESOURCE_KIND',
  'RETRYABLE_INFRASTRUCTURE_FAILURE',
] as const;
export type DiscoveryReentryConsumptionReasonCodeV1 =
  (typeof DISCOVERY_REENTRY_CONSUMPTION_REASON_CODES)[number];

export type DiscoveryFindingIdentityV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoveryReentryLifecycleCurrentV1 = DiscoveryFindingIdentityV1 & {
  readonly lifecycleState: DiscoveryFindingLifecycleState;
  readonly lifecycleRevision: number;
  readonly updatedAt: string;
};

export type DiscoveryApprovedResourceRevisionResolutionInputV1 = {
  readonly projectId: string;
  readonly finding: DiscoveryFindingEnvelopeV1;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
};

export type DiscoveryApprovedResourceRevisionResolutionResultV1 =
  | {
      readonly status: 'RESOLVED';
      readonly refs: readonly DiscoveryApprovedResourceRevisionRefV1[];
    }
  | {
      readonly status: 'UNRESOLVED';
      readonly reason: string;
      readonly reasonCode?: DiscoveryReentryConsumptionReasonCodeV1;
    };

/** The only authority allowed to turn Finding refs into approved revisions. */
export type DiscoveryApprovedResourceRevisionResolverPort = {
  resolve(
    input: DiscoveryApprovedResourceRevisionResolutionInputV1,
  ): Promise<DiscoveryApprovedResourceRevisionResolutionResultV1>;
};

export type DiscoveryReentryStoredIntakeV1 = {
  readonly logicalIdentityKey: string;
  readonly manifest: DiscoveryReentryManifestV1;
  readonly candidate: DerivedKnowledgeCandidateV1;
  readonly lifecycle: DiscoveryReentryLifecycleCurrentV1;
};

export type DiscoveryReentryConsumptionDispositionRecordV1 = DiscoveryFindingIdentityV1 & {
  readonly requestedReentryPurpose: typeof DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION;
  readonly publicationId: string;
  readonly disposition: DiscoveryReentryConsumptionDispositionV1;
  readonly reasonCode: DiscoveryReentryConsumptionReasonCodeV1;
  readonly reasonDetail: string;
  readonly nextEligibleAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DiscoveryReentryConsumptionDispositionInputV1 = Omit<
  DiscoveryReentryConsumptionDispositionRecordV1,
  'createdAt' | 'updatedAt'
> & {
  readonly occurredAt: string;
};

export type DiscoveryReentryPersistenceResultV1 =
  | ({ readonly status: 'CREATED' | 'IDEMPOTENT' } & DiscoveryReentryStoredIntakeV1)
  | {
      readonly status: 'INELIGIBLE';
      readonly lifecycle: DiscoveryReentryLifecycleCurrentV1;
    }
  | {
      readonly status: 'DISPOSITIONED';
      readonly disposition: 'INELIGIBLE' | 'BLOCKED_NON_RETRYABLE';
      readonly reasonCode: DiscoveryReentryConsumptionReasonCodeV1;
      readonly lifecycle: DiscoveryReentryLifecycleCurrentV1;
    };

export type DiscoveryReentryPersistencePort = {
  listPendingFindingReady(limit: number): Promise<readonly DiscoveryFindingReadyV1[]>;
  findFinding(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined>;
  findLifecycle(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryReentryLifecycleCurrentV1 | undefined>;
  findConsumptionDisposition(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1 | undefined>;
  recordConsumptionDisposition(
    input: DiscoveryReentryConsumptionDispositionInputV1,
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1>;
  findExisting(logicalIdentityKey: string): Promise<DiscoveryReentryStoredIntakeV1 | undefined>;
  persistIntake(input: {
    readonly logicalIdentity: DiscoveryReentryLogicalIdentityResultV1;
    readonly finding: DiscoveryFindingEnvelopeV1;
    readonly manifest: DiscoveryReentryManifestV1;
    readonly candidate: DerivedKnowledgeCandidateV1;
    readonly expectedLifecycleRevision: number;
    readonly publicationId: string;
    readonly occurredAt: string;
  }): Promise<DiscoveryReentryPersistenceResultV1>;
};

export type DiscoveryReentryConsumeResultV1 =
  | {
      readonly status: 'CREATED' | 'IDEMPOTENT';
      readonly logicalIdentityKey: string;
      readonly manifest: DiscoveryReentryManifestV1;
      readonly candidate: DerivedKnowledgeCandidateV1;
    }
  | {
      readonly status: 'INELIGIBLE';
      readonly logicalIdentityKey?: string;
      readonly lifecycleState: DiscoveryFindingLifecycleState;
      readonly disposition: 'INELIGIBLE';
    }
  | {
      readonly status: 'FINDING_NOT_FOUND';
      readonly projectId: string;
      readonly findingId: string;
      readonly findingRevision: number;
    }
  | {
      readonly status: 'IDENTITY_MISMATCH';
      readonly reason: string;
    }
  | {
      readonly status: 'INVALID_PUBLICATION';
      readonly reason: string;
    }
  | {
      readonly status: 'UNRESOLVED_REVISION';
      readonly reason: string;
      readonly reasonCode?: DiscoveryReentryConsumptionReasonCodeV1;
      readonly disposition?: 'BLOCKED_NON_RETRYABLE';
    }
  | {
      readonly status: 'RETRYABLE';
      readonly reason: string;
      readonly reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE';
      readonly disposition: 'RETRYABLE';
      readonly nextEligibleAt: string;
    }
  | {
      readonly status: 'PERSISTENCE_FAILURE';
      readonly reason: string;
    };

export type DiscoveryReentryBatchResultV1 = {
  readonly fetched: number;
  readonly results: readonly DiscoveryReentryConsumeResultV1[];
};

const textOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Discovery re-entry failed closed.';

const isRetryableFailure = (error: unknown): error is { readonly retryable: true } =>
  typeof error === 'object' &&
  error !== null &&
  'retryable' in error &&
  (error as { readonly retryable?: unknown }).retryable === true;

const sameCanonicalBase = (
  left: DiscoveryCanonicalBaseIdentityV1,
  right: DiscoveryCanonicalBaseIdentityV1,
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.canonicalVersion === right.canonicalVersion &&
  left.snapshotDigest === right.snapshotDigest;

const sameDiscoveryBase = (
  left: DiscoveryProjectionBaseIdentityV1,
  right: DiscoveryProjectionBaseIdentityV1,
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.projectionRevision === right.projectionRevision &&
  left.projectionDigest === right.projectionDigest;

const findingIdentity = (publication: DiscoveryFindingReadyV1): DiscoveryFindingIdentityV1 => ({
  projectId: publication.projectId,
  findingId: publication.findingId,
  findingRevision: publication.findingRevision,
});

const dispositionResult = (
  disposition: DiscoveryReentryConsumptionDispositionRecordV1,
  lifecycle: DiscoveryReentryLifecycleCurrentV1,
): DiscoveryReentryConsumeResultV1 | undefined => {
  if (disposition.disposition === 'INELIGIBLE') {
    return {
      status: 'INELIGIBLE',
      lifecycleState: lifecycle.lifecycleState,
      disposition: 'INELIGIBLE',
    };
  }
  if (disposition.disposition === 'BLOCKED_NON_RETRYABLE') {
    return {
      status: 'UNRESOLVED_REVISION',
      reason: disposition.reasonDetail,
      reasonCode: disposition.reasonCode,
      disposition: 'BLOCKED_NON_RETRYABLE',
    };
  }
  return undefined;
};

export class DiscoveryReentryConsumer {
  private readonly retryBackoffMs: number;

  public constructor(
    private readonly persistence: DiscoveryReentryPersistencePort,
    private readonly resolver: DiscoveryApprovedResourceRevisionResolverPort,
    private readonly clock: () => Date = () => new Date(),
    options: { readonly retryBackoffMs?: number } = {},
  ) {
    this.retryBackoffMs = options.retryBackoffMs ?? DISCOVERY_REENTRY_DEFAULT_RETRY_BACKOFF_MS;
    if (
      !Number.isSafeInteger(this.retryBackoffMs) ||
      this.retryBackoffMs < 100 ||
      this.retryBackoffMs > 60_000
    ) {
      throw new TypeError('retryBackoffMs must be between 100ms and 60000ms');
    }
  }

  private async retryableResult(
    identity: DiscoveryFindingIdentityV1,
    publication: DiscoveryFindingReadyV1,
    error: unknown,
    previousDisposition: DiscoveryReentryConsumptionDispositionRecordV1 | undefined,
  ): Promise<DiscoveryReentryConsumeResultV1> {
    try {
      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid Date');
      const occurredAt = now.toISOString();
      const previousEligibleAt = previousDisposition?.nextEligibleAt;
      const previousTime =
        previousEligibleAt === undefined
          ? Number.NEGATIVE_INFINITY
          : Date.parse(previousEligibleAt);
      if (!Number.isFinite(previousTime) && previousTime !== Number.NEGATIVE_INFINITY) {
        throw new TypeError('stored retry disposition has an invalid nextEligibleAt');
      }
      const nextEligibleAt = new Date(
        Math.max(now.getTime() + this.retryBackoffMs, previousTime + this.retryBackoffMs),
      ).toISOString();
      const stored = await this.persistence.recordConsumptionDisposition({
        ...identity,
        requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
        publicationId: publication.publicationId,
        disposition: 'RETRYABLE',
        reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
        reasonDetail: textOf(error),
        nextEligibleAt,
        occurredAt,
      });
      if (stored.disposition !== 'RETRYABLE' || stored.nextEligibleAt === undefined) {
        return {
          status: 'PERSISTENCE_FAILURE',
          reason: 'A concurrent terminal disposition superseded the retryable outcome.',
        };
      }
      return {
        status: 'RETRYABLE',
        reason: textOf(error),
        reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
        disposition: 'RETRYABLE',
        nextEligibleAt: stored.nextEligibleAt,
      };
    } catch (retryError) {
      return { status: 'PERSISTENCE_FAILURE', reason: textOf(retryError) };
    }
  }

  public async consume(input: unknown): Promise<DiscoveryReentryConsumeResultV1> {
    let publication: DiscoveryFindingReadyV1;
    try {
      publication = decodeDiscoveryFindingReadyV1(input);
    } catch (error) {
      return { status: 'INVALID_PUBLICATION', reason: textOf(error) };
    }

    const identity = findingIdentity(publication);
    let finding: DiscoveryFindingEnvelopeV1 | undefined;
    try {
      finding = await this.persistence.findFinding(identity);
    } catch (error) {
      if (isRetryableFailure(error)) {
        return this.retryableResult(identity, publication, error, undefined);
      }
      return { status: 'PERSISTENCE_FAILURE', reason: textOf(error) };
    }
    if (!finding) {
      try {
        await this.persistence.recordConsumptionDisposition({
          ...identity,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'BLOCKED_NON_RETRYABLE',
          reasonCode: 'FINDING_NOT_FOUND',
          reasonDetail: 'FindingReady references no durable Finding.',
          occurredAt: this.clock().toISOString(),
        });
      } catch {
        // An unknown project may fail the project FK; retain the original
        // closed result and let the notification remain diagnosable.
      }
      return { status: 'FINDING_NOT_FOUND', ...identity };
    }

    if (
      finding.projectId !== publication.projectId ||
      finding.findingId !== publication.findingId ||
      finding.findingRevision !== publication.findingRevision ||
      finding.runId !== publication.runId ||
      finding.fingerprint !== publication.fingerprint ||
      finding.fingerprintVersion !== publication.fingerprintVersion ||
      !sameCanonicalBase(finding.canonicalBase, publication.canonicalBase) ||
      !publication.requiredDiscoveryBase ||
      !sameDiscoveryBase(finding.discoveryBase, publication.requiredDiscoveryBase)
    ) {
      await this.persistence.recordConsumptionDisposition({
        ...identity,
        requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
        publicationId: publication.publicationId,
        disposition: 'BLOCKED_NON_RETRYABLE',
        reasonCode: 'IDENTITY_MISMATCH',
        reasonDetail:
          'FindingReady does not match the server-owned Finding identity or frozen bases.',
        occurredAt: this.clock().toISOString(),
      });
      return {
        status: 'IDENTITY_MISMATCH',
        reason: 'FindingReady does not match the server-owned Finding identity or frozen bases.',
      };
    }

    const logicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      findingType: finding.findingType,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: finding.canonicalBase,
      requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
    });

    try {
      const existing = await this.persistence.findExisting(logicalIdentity.logicalIdentityKey);
      if (existing) {
        return {
          status: 'IDEMPOTENT',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          manifest: existing.manifest,
          candidate: existing.candidate,
        };
      }

      const lifecycle = await this.persistence.findLifecycle(identity);
      if (!lifecycle) {
        await this.persistence.recordConsumptionDisposition({
          ...identity,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'BLOCKED_NON_RETRYABLE',
          reasonCode: 'FINDING_NOT_FOUND',
          reasonDetail: 'FindingReady references no durable Finding lifecycle.',
          occurredAt: this.clock().toISOString(),
        });
        return { status: 'FINDING_NOT_FOUND', ...identity };
      }
      const storedDisposition = await this.persistence.findConsumptionDisposition(identity);
      if (storedDisposition) {
        const disposition = dispositionResult(storedDisposition, lifecycle);
        if (disposition) return disposition;
      }
      const eligibility = deriveDiscoveryReentryEligibilityV1(lifecycle.lifecycleState);
      if (lifecycle.lifecycleState !== 'NEW' || eligibility !== 'ELIGIBLE_FOR_VALIDATION') {
        await this.persistence.recordConsumptionDisposition({
          projectId: identity.projectId,
          findingId: identity.findingId,
          findingRevision: identity.findingRevision,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'INELIGIBLE',
          reasonCode: 'LIFECYCLE_INELIGIBLE',
          reasonDetail: `Finding lifecycle is ${lifecycle.lifecycleState}.`,
          occurredAt: this.clock().toISOString(),
        });
        return {
          status: 'INELIGIBLE',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          lifecycleState: lifecycle.lifecycleState,
          disposition: 'INELIGIBLE',
        };
      }

      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid Date');
      const createdAt = now.toISOString();
      const manifest = createDiscoveryReentryManifestV1({
        manifestId: `discovery-reentry-manifest:${logicalIdentity.logicalIdentityKey}`,
        finding,
        requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
        createdAt,
      });
      let resolution: Awaited<ReturnType<DiscoveryApprovedResourceRevisionResolverPort['resolve']>>;
      try {
        resolution = await this.resolver.resolve({
          projectId: finding.projectId,
          finding,
          canonicalBase: finding.canonicalBase,
          discoveryBase: finding.discoveryBase,
          relatedResourceRefs: finding.relatedResourceRefs,
        });
      } catch (error) {
        if (isRetryableFailure(error)) {
          return this.retryableResult(identity, publication, error, storedDisposition);
        }
        throw error;
      }
      if (resolution.status === 'UNRESOLVED') {
        const reasonCode = resolution.reasonCode ?? 'NO_APPROVED_REENTRY_AUTHORITY';
        if (reasonCode === 'RETRYABLE_INFRASTRUCTURE_FAILURE') {
          return this.retryableResult(
            identity,
            publication,
            new Error(resolution.reason),
            storedDisposition,
          );
        }
        await this.persistence.recordConsumptionDisposition({
          projectId: identity.projectId,
          findingId: identity.findingId,
          findingRevision: identity.findingRevision,
          requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
          publicationId: publication.publicationId,
          disposition: 'BLOCKED_NON_RETRYABLE',
          reasonCode,
          reasonDetail: resolution.reason,
          occurredAt: createdAt,
        });
        return {
          status: 'UNRESOLVED_REVISION',
          reason: resolution.reason,
          reasonCode,
          disposition: 'BLOCKED_NON_RETRYABLE',
        };
      }

      const candidate = createDerivedKnowledgeCandidateV1({
        candidateId: `discovery-reentry-candidate:${logicalIdentity.logicalIdentityKey}`,
        finding,
        manifest,
        approvedRelatedResourceRefs: resolution.refs,
        createdAt,
      });
      let persisted: DiscoveryReentryPersistenceResultV1;
      try {
        persisted = await this.persistence.persistIntake({
          logicalIdentity,
          finding,
          manifest,
          candidate,
          expectedLifecycleRevision: lifecycle.lifecycleRevision,
          publicationId: publication.publicationId,
          occurredAt: createdAt,
        });
      } catch (error) {
        if (isRetryableFailure(error)) {
          return this.retryableResult(identity, publication, error, storedDisposition);
        }
        throw error;
      }
      if (persisted.status === 'INELIGIBLE') {
        return {
          status: 'INELIGIBLE',
          logicalIdentityKey: logicalIdentity.logicalIdentityKey,
          lifecycleState: persisted.lifecycle.lifecycleState,
          disposition: 'INELIGIBLE',
        };
      }
      if (persisted.status === 'DISPOSITIONED') {
        if (persisted.disposition === 'INELIGIBLE') {
          return {
            status: 'INELIGIBLE',
            logicalIdentityKey: logicalIdentity.logicalIdentityKey,
            lifecycleState: persisted.lifecycle.lifecycleState,
            disposition: 'INELIGIBLE',
          };
        }
        return {
          status: 'UNRESOLVED_REVISION',
          reason: 'Re-entry was durably blocked by a concurrent deterministic disposition.',
          reasonCode: persisted.reasonCode,
          disposition: 'BLOCKED_NON_RETRYABLE',
        };
      }
      return {
        status: persisted.status,
        logicalIdentityKey: persisted.logicalIdentityKey,
        manifest: persisted.manifest,
        candidate: persisted.candidate,
      };
    } catch (error) {
      return { status: 'PERSISTENCE_FAILURE', reason: textOf(error) };
    }
  }

  public async runOnce(limit = 25): Promise<DiscoveryReentryBatchResultV1> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be between 1 and 100');
    }
    const publications = await this.persistence.listPendingFindingReady(limit);
    const results: DiscoveryReentryConsumeResultV1[] = [];
    for (const publication of publications) results.push(await this.consume(publication));
    return { fetched: publications.length, results };
  }
}

export type PersistentDiscoveryReentryWorkerOptionsV1 = {
  readonly pollIntervalMs?: number;
  readonly batchLimit?: number;
};

export class PersistentDiscoveryReentryWorker {
  private readonly pollIntervalMs: number;
  private readonly batchLimit: number;
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private wakePoll: (() => void) | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly consumer: DiscoveryReentryConsumer,
    options: PersistentDiscoveryReentryWorkerOptionsV1 = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.batchLimit = options.batchLimit ?? 25;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) {
      throw new TypeError('pollIntervalMs must be at least 100ms');
    }
    if (!Number.isSafeInteger(this.batchLimit) || this.batchLimit < 1 || this.batchLimit > 100) {
      throw new TypeError('batchLimit must be between 1 and 100');
    }
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.wakePoll?.();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  public runOnce(): Promise<DiscoveryReentryBatchResultV1> {
    return this.consumer.runOnce(this.batchLimit);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const batch = await this.runOnce();
        for (const result of batch.results) {
          if (
            result.status === 'PERSISTENCE_FAILURE' ||
            result.status === 'INVALID_PUBLICATION' ||
            result.status === 'IDENTITY_MISMATCH'
          ) {
            console.error('[discovery-reentry-worker] item failed closed', result);
          }
        }
      } catch (error) {
        console.error('[discovery-reentry-worker] tick failed', error);
      }
      if (this.running) await this.waitForPoll();
    }
  }

  private async waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (this.pollTimer !== undefined) clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.wakePoll = undefined;
        resolve();
      };
      this.wakePoll = settle;
      this.pollTimer = setTimeout(settle, this.pollIntervalMs);
    });
  }
}
