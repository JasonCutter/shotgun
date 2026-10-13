import {
  ShotgunError,
  type SourcesSensitivity,
  type IntakeSubmissionSnapshot,
} from '../../../packages/contracts/src/index.js';
import type {
  SourcesProductWriteScope,
  SourcesProductWriteServicePort,
  SourcesStagingServicePort,
} from './product-service.js';
import { assertSourcesResourceSecurityContinuation } from './resource-security.js';

export type SourceRefreshPhase =
  'READY' | 'ACQUIRING' | 'STAGED' | 'SUBMITTING' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export type SourceRefreshJob = {
  readonly jobId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly principalId: string;
  /** Historical intake session reference, not renewed login/authorization. */
  readonly sessionId: string;
  readonly requestedUrl: string;
  readonly label: string;
  readonly sensitivity: SourcesSensitivity;
  readonly accessScope: readonly string[];
  readonly phase: SourceRefreshPhase;
  readonly stagingReference?: string;
  readonly submissionId: string;
  readonly itemId: string;
  readonly commandId: string;
  readonly leaseToken: string;
};

/** All phase changes require an unexpired lease and exact execution token. */
export type SourceRefreshStorePort = {
  claimNext(workerId: string): Promise<SourceRefreshJob | undefined>;
  transition(input: {
    readonly job: SourceRefreshJob;
    readonly phase: SourceRefreshPhase;
    readonly stagingReference?: string;
    readonly producedSourceVersionId?: string;
    readonly safeFailureCode?: string;
    readonly release?: boolean;
  }): Promise<void>;
};

export type SourceRefreshAuthorizationPort = {
  /** Resolve CURRENT membership, source visibility, standing policy and egress.
   * Absence denies acquisition and processing; a prior intake is not consent. */
  authorize(job: SourceRefreshJob): Promise<SourcesProductWriteScope | undefined>;
  /** Accept the exact Sources command through the existing command gateway;
   * never bypass its principal/project/policy checks or fabricate a receipt. */
  prepareSubmission(job: SourceRefreshJob, scope: SourcesProductWriteScope): Promise<void>;
  /** Bind the accepted command to its durable submission using normal readback.
   * Never treat a submission ACK as a fresh permission to execute it again. */
  recordSubmission?(job: SourceRefreshJob, result: IntakeSubmissionSnapshot): Promise<void>;
};

export class SourceRefreshCoordinator {
  constructor(
    private readonly store: SourceRefreshStorePort,
    private readonly authorization: SourceRefreshAuthorizationPort,
    private readonly staging: SourcesStagingServicePort,
    private readonly product: SourcesProductWriteServicePort,
  ) {}

  async drainOnce(workerId: string): Promise<'IDLE' | 'SUCCEEDED' | 'PENDING' | 'FAILED'> {
    let job = await this.store.claimNext(workerId);
    if (!job) return 'IDLE';
    let scope: SourcesProductWriteScope | undefined;
    try {
      scope = await this.authorize(job);
    } catch {
      scope = undefined;
    }
    if (!scope) {
      await this.store.transition({
        job,
        phase: 'FAILED',
        safeFailureCode: 'REFRESH_AUTHORITY_DENIED',
        release: true,
      });
      return 'FAILED';
    }

    if (job.phase === 'READY') {
      await this.store.transition({ job, phase: 'ACQUIRING' });
      job = { ...job, phase: 'ACQUIRING' };
      let receipt: Awaited<ReturnType<SourcesStagingServicePort['stageUrl']>>;
      try {
        receipt = await this.staging.stageUrl({
          draftId: job.jobId,
          itemId: job.itemId,
          projectId: job.projectId,
          principalId: job.principalId,
          label: job.label,
          requestedUrl: job.requestedUrl,
        });
      } catch (error) {
        const knownAcquisitionFailure =
          error instanceof ShotgunError &&
          ['url-acquisition', 'url-acquisition-node'].includes(error.module) &&
          !['OUTCOME_UNKNOWN', 'OUTCOME_INDETERMINATE'].includes(error.code);
        await this.store.transition({
          job,
          phase: knownAcquisitionFailure ? 'FAILED' : 'OUTCOME_UNKNOWN',
          safeFailureCode: knownAcquisitionFailure
            ? error.retryable
              ? 'URL_REFRESH_ACQUISITION_FAILED'
              : 'URL_REFRESH_ACQUISITION_REJECTED'
            : 'URL_REFRESH_STAGING_OUTCOME_UNKNOWN',
          release: true,
        });
        return 'FAILED';
      }
      // A failed/ambiguous checkpoint is not a failed fetch. Leave ACQUIRING
      // recoverably UNKNOWN, or reuse a committed STAGED receipt after ACK loss.
      await this.store.transition({
        job,
        phase: 'STAGED',
        stagingReference: receipt.stagingReference,
      });
      job = { ...job, phase: 'STAGED', stagingReference: receipt.stagingReference };
    }

    // After SUBMITTING the exact existing submission is authoritative. Never
    // restage or automatically resubmit a possibly committed/provider-bearing run.
    if (job.phase === 'SUBMITTING') {
      const saved = await this.product.getSubmission(scope, job.submissionId);
      if (!saved) {
        await this.store.transition({
          job,
          phase: 'OUTCOME_UNKNOWN',
          safeFailureCode: 'REFRESH_SUBMISSION_OUTCOME_UNKNOWN',
          release: true,
        });
        return 'FAILED';
      }
      return this.finalize(job, saved);
    }

    if (job.phase !== 'STAGED' || !job.stagingReference) {
      throw new Error('Source refresh lease returned a non-executable phase.');
    }
    // Source security and standing authority may have changed during acquisition.
    try {
      scope = await this.authorize(job);
    } catch {
      scope = undefined;
    }
    if (!scope) {
      await this.store.transition({
        job,
        phase: 'FAILED',
        safeFailureCode: 'REFRESH_AUTHORITY_DENIED',
        release: true,
      });
      return 'FAILED';
    }
    const artifact = await this.staging.resolve({
      stagingReference: job.stagingReference,
      draftId: job.jobId,
      itemId: job.itemId,
      projectId: job.projectId,
      principalId: job.principalId,
      kind: 'URL',
    });
    await this.authorization.prepareSubmission(job, scope);
    await this.store.transition({ job, phase: 'SUBMITTING' });
    job = { ...job, phase: 'SUBMITTING' };
    let result;
    try {
      result = await this.product.submit({
        submissionId: job.submissionId,
        commandId: job.commandId,
        correlationId: job.jobId,
        draftId: job.jobId,
        scope,
        items: [
          {
            ...artifact,
            requestedSourceId: job.sourceId,
            expectedSourceVersionId: job.sourceVersionId,
            requestedClassification: job.sensitivity,
          },
        ],
        duplicateHandling: 'AUTOMATIC',
        createdAt: artifact.issuedAt,
      });
    } catch (error) {
      if (error instanceof ShotgunError && error.code === 'STALE_VERSION') {
        await this.store.transition({
          job,
          phase: 'FAILED',
          safeFailureCode: 'REFRESH_SOURCE_VERSION_CHANGED',
          release: true,
        });
        return 'FAILED';
      }
      // The same durable submission may have committed before ACK loss or a
      // Stage 3 failure. Resume through getSubmission, never a new command.
      await this.store.transition({
        job,
        phase: 'SUBMITTING',
        safeFailureCode: 'REFRESH_SUBMISSION_READBACK_REQUIRED',
        release: true,
      });
      return 'PENDING';
    }
    return this.finalize(job, result);
  }

  private async authorize(job: SourceRefreshJob): Promise<SourcesProductWriteScope | undefined> {
    const scope = await this.authorization.authorize(job);
    if (!scope) return undefined;
    if (scope.projectId !== job.projectId || scope.principalId !== job.principalId) {
      throw new Error('Source refresh authorization identity mismatch.');
    }
    assertSourcesResourceSecurityContinuation(
      {
        principalId: scope.principalId,
        sensitivityClearance: scope.sensitivityClearance,
        policy: scope.resourceSecurityPolicy,
      },
      { sensitivity: job.sensitivity, accessScope: job.accessScope },
    );
    return scope;
  }

  private async finalize(
    job: SourceRefreshJob,
    result: Awaited<ReturnType<SourcesProductWriteServicePort['getSubmission']>>,
  ): Promise<'SUCCEEDED' | 'PENDING' | 'FAILED'> {
    if (!result || result.submissionId !== job.submissionId || result.projectId !== job.projectId) {
      throw new Error('Source refresh submission readback identity mismatch.');
    }
    try {
      await this.authorization.recordSubmission?.(job, result);
    } catch {
      await this.store.transition({
        job,
        phase: 'SUBMITTING',
        safeFailureCode: 'REFRESH_COMMAND_READBACK_REQUIRED',
        release: true,
      });
      return 'PENDING';
    }
    if (result.state === 'SUCCEEDED') {
      const produced = result.items[0]?.producedResource;
      if (
        result.items.length !== 1 ||
        !produced ||
        produced.sourceId !== job.sourceId ||
        produced.projectId !== job.projectId
      ) {
        throw new Error('Source refresh produced a different Source identity.');
      }
      await this.store.transition({
        job,
        phase: 'SUCCEEDED',
        producedSourceVersionId: produced.sourceVersionId,
        release: true,
      });
      return 'SUCCEEDED';
    }
    if (['FAILED', 'CANCELLED', 'ACTION_REQUIRED'].includes(result.state)) {
      await this.store.transition({
        job,
        phase: 'FAILED',
        safeFailureCode: 'REFRESH_INTAKE_FAILED',
        release: true,
      });
      return 'FAILED';
    }
    await this.store.transition({ job, phase: 'SUBMITTING', release: true });
    return 'PENDING';
  }
}
