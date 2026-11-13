import type {
  SurferIntakeInboxPort,
  SurferIntakeIdentity,
  SurferIntakeResume,
} from '../../../packages/contracts/src/surfer-intake.js';
import type { SurferDocumentMemoryWorker } from './document-work.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
/** Explicit one-item cycle. No timer, stored credential or provider authority comes from the event. */
export class SurferIntakeWorker {
  private readonly context: Pick<SurferIntakeIdentity, 'runId' | 'profileDigest' | 'leaseMs'>;
  constructor(
    private readonly inbox: SurferIntakeInboxPort,
    private readonly documents: Pick<SurferDocumentMemoryWorker, 'prepareIndexed' | 'run'>,
    private readonly authorize: (
      actor: unknown,
    ) => Promise<Pick<SurferIntakeIdentity, 'projectId' | 'principalId'>>,
    context: Pick<SurferIntakeIdentity, 'runId' | 'profileDigest' | 'leaseMs'>,
  ) {
    assertSurferJson(context);
    if (
      !context ||
      Object.keys(context).sort().join(',') !== 'leaseMs,profileDigest,runId' ||
      !/^[A-Za-z0-9-]{1,40}$/.test(context.runId) ||
      !/^sha256:[a-f0-9]{64}$/.test(context.profileDigest) ||
      !Number.isSafeInteger(context.leaseMs) ||
      context.leaseMs < 1000
    )
      throw surferFailure('Invalid server intake context.');
    this.context = structuredClone(context);
  }
  async cycle(actor: unknown, resume?: SurferIntakeResume) {
    const identity = { ...(await this.authorize(actor)), ...this.context },
      job = resume ? await this.inbox.claim(identity, resume) : await this.inbox.claim(identity);
    if (!job) return { status: 'EMPTY' as const };
    // Ack/SQL/unknown-outcome failures leave the fenced lease for explicit recovery.
    if (!job.prepared) {
      let prepared;
      try {
        prepared = await this.documents.prepareIndexed(actor, {
          schemaVersion: '1.0.0',
          requestId: job.requestId,
          sourceId: job.sourceId,
          sourceVersionId: job.sourceVersionId,
          revisionId: job.revisionId,
        });
      } catch (error) {
        if (
          error instanceof ShotgunError &&
          [
            'VALIDATION_ERROR',
            'STALE_VERSION',
            'POLICY_DENIED',
            'NOT_FOUND',
            'PROJECT_ACCESS_DENIED',
          ].includes(error.code)
        ) {
          await this.inbox.block(job, 'WORK_UNAVAILABLE');
          return {
            status: 'BLOCKED' as const,
            jobId: job.jobId,
            code: 'WORK_UNAVAILABLE' as const,
          };
        }
        throw error;
      }
      await this.inbox.prepared(job, prepared.prepared);
      job.prepared = prepared.prepared;
    }
    let result;
    try {
      result = await this.documents.run(actor, job.prepared);
    } catch (error) {
      if (
        error instanceof ShotgunError &&
        [
          'VALIDATION_ERROR',
          'STALE_VERSION',
          'POLICY_DENIED',
          'NOT_FOUND',
          'PROJECT_ACCESS_DENIED',
        ].includes(error.code)
      ) {
        await this.inbox.block(job, 'WORK_UNAVAILABLE');
        return { status: 'BLOCKED' as const, jobId: job.jobId, code: 'WORK_UNAVAILABLE' as const };
      }
      throw error;
    }
    if (result.status === 'COMPLETED') {
      await this.inbox.complete(job, result.receipt);
      return {
        status: 'COMPLETED' as const,
        jobId: job.jobId,
        receipt: result.receipt,
        replayed: result.replayed,
      };
    }
    const code = result.executionStatus === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'INCOMPLETE';
    await this.inbox.block(job, code);
    return { status: 'BLOCKED' as const, jobId: job.jobId, code };
  }
}
