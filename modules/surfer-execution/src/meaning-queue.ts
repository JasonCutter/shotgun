import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type {
  SurferMeaningVerificationWork,
  SurferMeaningVerificationResult,
} from '../../../packages/contracts/src/surfer-meaning-verification.js';
import {
  assertSurferMeaningQueueIdentity,
  type SurferMeaningQueueIdentity,
  type SurferMeaningQueuePort,
} from '../../../packages/contracts/src/surfer-meaning-queue.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type { SurferInterpretationTask, SurferInterpretationResult } from './provider-executor.js';
type Verifier = {
  verify(
    actor: unknown,
    work: SurferMeaningVerificationWork,
    task: Omit<SurferInterpretationTask, 'basis' | 'selections'>,
  ): Promise<SurferInterpretationResult<SurferMeaningVerificationResult>>;
};
/** Same job always uses the original preparation and execution operation, including after lease expiry. */
export class SurferMeaningQueueWorker {
  private readonly context: Pick<SurferMeaningQueueIdentity, 'runId' | 'profileDigest' | 'leaseMs'>;
  constructor(
    private readonly queue: SurferMeaningQueuePort,
    private readonly verifier: Verifier,
    private readonly authorize: (
      actor: unknown,
    ) => Promise<Pick<SurferMeaningQueueIdentity, 'projectId' | 'principalId'>>,
    context: Pick<SurferMeaningQueueIdentity, 'runId' | 'profileDigest' | 'leaseMs'>,
  ) {
    assertSurferJson(context);
    if (!context || Object.keys(context).sort().join(',') !== 'leaseMs,profileDigest,runId')
      throw surferFailure('Meaning queue context cannot override actor authority.');
    assertSurferMeaningQueueIdentity({
      projectId: 'configuration',
      principalId: 'configuration',
      ...context,
    });
    this.context = structuredClone(context);
  }
  async cycle(actor: unknown) {
    const identity = { ...(await this.authorize(actor)), ...this.context },
      job = await this.queue.claim(identity);
    if (!job) return { status: 'EMPTY' as const };
    let result;
    try {
      await this.authorize(actor);
      result = await this.verifier.verify(actor, job.work, {
        schemaVersion: '1.0.0',
        operationId: job.jobId,
        runId: identity.runId,
        stepId: 'meaning-review',
        attempt: 1,
        priority: 'BACKGROUND',
      });
    } catch (e) {
      if (
        !(e instanceof ShotgunError) ||
        ![
          'VALIDATION_ERROR',
          'STALE_VERSION',
          'POLICY_DENIED',
          'NOT_FOUND',
          'PROJECT_ACCESS_DENIED',
        ].includes(e.code)
      )
        throw e;
      await this.queue.block(job, 'WORK_UNAVAILABLE');
      return { status: 'BLOCKED' as const, jobId: job.jobId, code: 'WORK_UNAVAILABLE' as const };
    }
    if (result.status === 'CANDIDATE_NOT_SEMANTICALLY_VALIDATED' && result.frame) {
      await this.queue.complete(job, result.frame);
      return { status: 'COMPLETED' as const, jobId: job.jobId };
    }
    const code =
      result.status === 'OUTCOME_UNKNOWN' || result.status === 'USAGE_UNKNOWN'
        ? 'OUTCOME_UNKNOWN'
        : result.status === 'SOURCE_UNAVAILABLE'
          ? 'WORK_UNAVAILABLE'
          : 'INCOMPLETE';
    await this.queue.block(job, code);
    return { status: 'BLOCKED' as const, jobId: job.jobId, code };
  }
}
