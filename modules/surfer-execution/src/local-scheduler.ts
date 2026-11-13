import { performance } from 'node:perf_hooks';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferReservation,
  zeroSurferUsage,
  type SurferExecutionRecord,
  type SurferLocalWorkerPort,
} from '../../../packages/contracts/src/surfer-execution.js';
import type { SurferExecutionLedger } from './index.js';

type Job = {
  record: SurferExecutionRecord;
  input: unknown;
  controller: AbortController;
  resolve: (record: SurferExecutionRecord) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};
/** Local deterministic scheduling only. Provider dispatch is deliberately not wired here. */
export class SurferLocalScheduler {
  private queue: Job[] = [];
  private running = new Set<Job>();
  private pending = new Set<string>();
  private closed = false;
  constructor(
    private readonly ledger: SurferExecutionLedger,
    private readonly worker: SurferLocalWorkerPort,
  ) {}
  async submit(
    requestInput: unknown,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<SurferExecutionRecord> {
    if (this.closed) throw surferFailure('Scheduler is closed.');
    const request = decodeSurferReservation(requestInput);
    assertSurferJson(input);
    // Snapshot before the first await: callers cannot change work after its digest was reserved.
    const payload = structuredClone(input);
    if (
      request.executionKind !== 'LOCAL_DETERMINISTIC' ||
      request.inputDigest !== surferDigest(payload)
    )
      throw surferFailure('Local scheduler accepts only bound deterministic input.');
    const reserved = await this.ledger.reserve(request),
      record = reserved.record;
    if (record.state !== 'RESERVED') return record; // replay never dispatches prior work
    if (this.pending.has(record.reservationId))
      throw surferFailure('Step already queued in this scheduler.');
    if (signal?.aborted || this.closed)
      return this.ledger.cancelBeforeDispatch(record.reservationId, request.spaceId);
    return new Promise<SurferExecutionRecord>((resolve, reject) => {
      const controller = new AbortController();
      const cancel = () => {
        controller.abort();
        void this.drain();
      };
      const job: Job = {
        record,
        input: payload,
        controller,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', cancel),
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) controller.abort();
      this.pending.add(record.reservationId);
      this.queue.push(job);
      this.queue.sort(
        (a, b) =>
          Number(b.record.request.priority === 'FOREGROUND') -
          Number(a.record.request.priority === 'FOREGROUND'),
      );
      if (request.priority === 'FOREGROUND')
        for (const active of this.running)
          if (active.record.request.priority === 'BACKGROUND') active.controller.abort();
      void this.drain();
    });
  }
  private async drain(): Promise<void> {
    // Removing/starting a job is synchronous before the first await; concurrent drains cannot claim it twice.
    for (let i = 0; i < this.queue.length;) {
      const job = this.queue[i]!;
      if (job.controller.signal.aborted) {
        this.queue.splice(i, 1);
        void this.ledger
          .cancelBeforeDispatch(job.record.reservationId, job.record.request.spaceId)
          .then(job.resolve, job.reject)
          .finally(() => this.finish(job));
      } else if (
        this.running.size < this.ledger.policy.maxConcurrent &&
        (job.record.request.priority !== 'BACKGROUND' ||
          [...this.running].filter((j) => j.record.request.priority === 'BACKGROUND').length <
            this.ledger.policy.maxBackgroundConcurrent)
      ) {
        this.queue.splice(i, 1);
        this.running.add(job);
        void this.execute(job);
      } else i++;
    }
  }
  private finish(job: Job): void {
    this.running.delete(job);
    this.pending.delete(job.record.reservationId);
    job.cleanup();
    void this.drain();
  }
  private async execute(job: Job): Promise<void> {
    let dispatched: SurferExecutionRecord | undefined;
    try {
      const claim = await this.ledger.dispatch(
        job.record.reservationId,
        job.record.request.spaceId,
      );
      if (!claim.granted) {
        job.resolve(claim.record);
        return;
      }
      dispatched = claim.record;
      const started = performance.now();
      const result = await this.worker.run(
        job.input,
        dispatched.checkpoint,
        job.controller.signal,
        {
          unitMaxMs: dispatched.request.maximum.elapsedMs,
          workerMemoryMb: this.ledger.policy.workerMemoryMb,
        },
        async (checkpoint, sequence) => {
          await this.ledger.saveCheckpoint(
            dispatched!.reservationId,
            dispatched!.request.spaceId,
            dispatched!.dispatchToken!,
            sequence,
            checkpoint,
          );
        },
      );
      const usage = zeroSurferUsage();
      usage.elapsedMs = Math.ceil(performance.now() - started);
      job.resolve(
        await this.ledger.settle(
          dispatched.reservationId,
          dispatched.request.spaceId,
          dispatched.dispatchToken!,
          usage,
          result,
        ),
      );
    } catch (error) {
      if (dispatched) {
        try {
          await this.ledger.markUnknown(
            dispatched.reservationId,
            dispatched.request.spaceId,
            dispatched.dispatchToken!,
          );
        } catch {
          /* Durable readback remains required; never release/retry. */
        }
      }
      job.reject(error);
    } finally {
      this.finish(job);
    }
  }
  /** Stops intake and yields local workers; await submitted jobs to observe durable finalization. */
  close(): void {
    this.closed = true;
    for (const j of [...this.queue, ...this.running]) j.controller.abort();
    void this.drain();
  }
}
